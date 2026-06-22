import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "./browserProfileManager";
import type { BrowserEngine, RenderedPage } from "./browserEngine";

const DEFAULT_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

export function findNativeChromeExecutable(): string {
  const configured = process.env.NATIVE_CHROME_PATH?.trim();
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const found = DEFAULT_CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Native Chrome was not found. Set NATIVE_CHROME_PATH in .env.");
  }

  return found;
}

function screenshotPath(bot: Bot): string {
  const dir = path.resolve(process.cwd(), "data", "screenshots", String(bot.id));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-chrome.png`);
}

function proxyConfig(proxy: string | null): { server: string } | undefined {
  return proxy ? { server: proxy } : undefined;
}

export function killOrphanChromeForProfile(profilePath: string): number {
  const normalized = profilePath.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  let killed = 0;

  try {
    const output = execFileSync(
      "wmic",
      ["process", "where", "name='chrome.exe' or name='chromium.exe'", "get", "ProcessId,CommandLine", "/format:csv"],
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );

    for (const line of output.split(/\r?\n/)) {
      const parts = line.trim().split(",");
      if (parts.length < 3) {
        continue;
      }
      const pid = Number(parts.at(-1));
      const commandLine = parts.slice(1, -1).join(",").replace(/\//g, "\\").toLowerCase();
      if (Number.isFinite(pid) && commandLine.includes(normalized)) {
        try {
          process.kill(pid);
          killed += 1;
        } catch {
          // Process may already be gone.
        }
      }
    }
  } catch {
    return killed;
  }

  return killed;
}

async function humanPause(ms = 1000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * 900)));
}

async function clickVisibleText(page: Page, labels: string[], maxPerLabel: number): Promise<void> {
  for (const label of labels) {
    const buttons = await page.getByText(label, { exact: false }).all().catch(() => []);
    for (const button of buttons.slice(0, maxPerLabel)) {
      await button.click({ timeout: 1200 }).catch(() => undefined);
      await humanPause(250);
    }
  }
}

async function expandFacebookContent(page: Page): Promise<void> {
  await clickVisibleText(page, ["See more"], 12);
  await clickVisibleText(
    page,
    ["View more comments", "See more comments", "View previous comments", "Most relevant", "All comments"],
    12
  );
}

async function extractFacebookPosts(
  page: Page
): Promise<Array<{ index: number; text: string; permalink: string | null; comments: Array<{ author: string | null; text: string }> }>> {
  return page
    .evaluate(() => {
      const stopPhrases = [
        "active status",
        "news feed",
        "home",
        "watch",
        "marketplace",
        "groups",
        "notifications",
        "messenger",
        "write a comment",
        "leave a comment",
        "all reactions"
      ];

      function normalize(text: string): string {
        return text
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      function looksLikePost(text: string): boolean {
        const normalized = normalize(text).toLowerCase();
        if (normalized.length < 80) {
          return false;
        }
        const blockedHits = stopPhrases.filter((phrase) => normalized.includes(phrase)).length;
        return blockedHits < 4;
      }

      function permalinkFor(node: Element): string | null {
        const anchors = Array.from(node.querySelectorAll("a[href]")) as HTMLAnchorElement[];
        const candidate = anchors.find((anchor) =>
          /\/posts\/|\/videos\/|\/photos\/|story_fbid=|permalink\.php|\/reel\//.test(anchor.href)
        );
        return candidate?.href || null;
      }

      function visibleComments(node: Element): Array<{ author: string | null; text: string }> {
        const text = normalize((node as HTMLElement).innerText || "");
        const lines = text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const comments: Array<{ author: string | null; text: string }> = [];

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!/^Like$/i.test(line) && !/^Reply$/i.test(line)) {
            continue;
          }
          const maybeText = lines[index - 1];
          const maybeAuthor = lines[index - 2];
          if (maybeText && maybeAuthor && maybeText.length > 1 && maybeAuthor.length <= 80) {
            comments.push({ author: maybeAuthor, text: maybeText });
          }
        }

        return comments.slice(0, 20);
      }

      const seen = new Set<string>();
      return Array.from(document.querySelectorAll('[role="article"]'))
        .map((node, index) => ({
          index: index + 1,
          text: normalize((node as HTMLElement).innerText || ""),
          permalink: permalinkFor(node),
          comments: visibleComments(node)
        }))
        .filter((post) => {
          const key = post.text.slice(0, 180);
          if (!looksLikePost(post.text) || seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, 10);
    })
    .catch(() => []);
}

export class NativeChromeEngine implements BrowserEngine {
  name = "native-chrome";

  async render(bot: Bot, profile: BrowserProfileRuntime): Promise<RenderedPage> {
    const executablePath = findNativeChromeExecutable();
    const headless = bot.targetDomain.includes("facebook.com") ? false : process.env.NATIVE_CHROME_HEADLESS === "true";

    let context;
    try {
      context = await chromium.launchPersistentContext(profile.userDataDir, {
        executablePath,
        headless,
        proxy: proxyConfig(bot.proxyUrl),
        args: ["--disable-blink-features=AutomationControlled"],
        viewport: { width: 1365, height: 768 },
        userAgent: bot.userAgent || undefined
      });
    } catch (error) {
      killOrphanChromeForProfile(profile.userDataDir);
      context = await chromium.launchPersistentContext(profile.userDataDir, {
        executablePath,
        headless,
        proxy: proxyConfig(bot.proxyUrl),
        args: ["--disable-blink-features=AutomationControlled"],
        viewport: { width: 1365, height: 768 },
        userAgent: bot.userAgent || undefined
      });
    }

    const page = context.pages()[0] ?? (await context.newPage());
    const imagePath = screenshotPath(bot);

    try {
      const response = await page.goto(bot.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });
      await humanPause();
      const isFacebook = bot.targetDomain.includes("facebook.com") || bot.targetDomain.includes("fb.watch");
      const scrollCount = isFacebook ? 5 : 1;
      for (let index = 0; index < scrollCount; index += 1) {
        await page.mouse.wheel(0, 900).catch(() => undefined);
        await humanPause(isFacebook ? 900 : 500);
      }
      if (isFacebook) {
        await expandFacebookContent(page);
        await humanPause(800);
      }

      const title = await page.title().catch(() => null);
      const rawHtml = await page.content();
      const rawText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      const facebookPosts = isFacebook ? await extractFacebookPosts(page) : [];
      const postText = facebookPosts.length
        ? `Extracted Facebook Posts\n\n${facebookPosts.map((post) => `#${post.index}\n${post.text}`).join("\n\n---\n\n")}\n\n`
        : "";
      await page.screenshot({ path: imagePath, fullPage: true }).catch(() => undefined);

      return {
        url: bot.targetUrl,
        title,
        rawHtml,
        rawText: `${postText}${rawText}`,
        screenshotPath: fs.existsSync(imagePath) ? imagePath : null,
        httpStatus: response?.status() ?? null,
        engine: this.name,
        extractedData: facebookPosts.length ? { facebookPosts } : undefined
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

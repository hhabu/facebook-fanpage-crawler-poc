import fs from "node:fs";
import path from "node:path";
import type { Bot } from "../lib/botTypes";
import { buildCloakBrowserLaunchPlan, launchCloakPersistentContext } from "../integrations/cloakBrowserClient";
import type { BrowserProfileRuntime } from "./browserProfileManager";
import type { BrowserEngine, RenderedPage } from "./browserEngine";

function ensureScreenshotPath(bot: Bot): string {
  const dir = path.resolve(process.cwd(), "data", "screenshots", String(bot.id));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}.png`);
}

async function randomDelay(): Promise<void> {
  const ms = 600 + Math.floor(Math.random() * 1400);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickVisibleText(page: any, labels: string[], maxPerLabel: number): Promise<void> {
  for (const label of labels) {
    const locator = page.getByText?.(label, { exact: false });
    const buttons = locator?.all ? await locator.all().catch(() => []) : [];
    for (const button of buttons.slice(0, maxPerLabel)) {
      await button.click?.({ timeout: 1200 }).catch?.(() => undefined);
      await randomDelay();
    }
  }
}

async function prepareFacebookPage(page: any): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await page.mouse?.wheel?.(0, 900).catch?.(() => undefined);
    await randomDelay();
  }

  await clickVisibleText(page, ["See more"], 12);
  await clickVisibleText(
    page,
    ["View more comments", "See more comments", "View previous comments", "Most relevant", "All comments"],
    12
  );
}

export class CloakBrowserEngine implements BrowserEngine {
  name = "cloak";

  async render(bot: Bot, profile: BrowserProfileRuntime): Promise<RenderedPage> {
    const plan = buildCloakBrowserLaunchPlan(bot, profile);
    const context = (await launchCloakPersistentContext({
      ...plan,
      proxy: bot.proxyUrl || plan.proxy
    })) as any;
    const page = await context.newPage();
    const screenshotPath = ensureScreenshotPath(bot);

    try {
      const response = await page.goto(bot.targetUrl, {
        waitUntil: bot.targetDomain.includes("facebook.com") ? "domcontentloaded" : "networkidle",
        timeout: 60000
      });
      await randomDelay();
      if (bot.targetDomain.includes("facebook.com") || bot.targetDomain.includes("fb.watch")) {
        await prepareFacebookPage(page);
      } else {
        await page.mouse?.wheel?.(0, 450).catch?.(() => undefined);
        await randomDelay();
      }

      const title = await page.title().catch(() => null);
      const rawHtml = await page.content();
      const rawText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

      return {
        url: bot.targetUrl,
        title,
        rawHtml,
        rawText,
        screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
        httpStatus: response?.status?.() ?? null,
        engine: this.name
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

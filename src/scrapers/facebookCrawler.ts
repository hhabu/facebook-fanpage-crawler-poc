import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext, Page } from "playwright-core";
import { getBrowserProfileRuntime, type BrowserProfileRuntime } from "../browser/browserProfileManager";
import { findNativeChromeExecutable, killOrphanChromeForProfile } from "../browser/nativeChromeEngine";
import type { Bot } from "../lib/botTypes";
import type { SocialCommentSnapshot, SocialPostSnapshot, SocialSnapshot } from "../lib/scraperTypes";

export interface FacebookCrawlOutput {
  rendered: {
    title: string | null;
    rawText: string;
    rawHtml: string;
    screenshotPath: string | null;
    httpStatus: number | null;
    engine: string;
  };
  socialSnapshot: Omit<SocialSnapshot, "id" | "crawlResultId">;
  socialPosts: Array<Omit<SocialPostSnapshot, "id" | "crawlResultId" | "comments" | "createdAt"> & {
    comments: Array<Omit<SocialCommentSnapshot, "id" | "socialPostId" | "createdAt">>;
  }>;
}

interface ParsedPost {
  postUrl: string;
  postId: string | null;
  author: string | null;
  content: string;
  publishedAt: string | null;
  reactionCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  viewCount: number | null;
  rawText: string | null;
  comments: Array<Omit<SocialCommentSnapshot, "id" | "socialPostId" | "createdAt">>;
}

function screenshotPath(bot: Bot): string {
  const dir = path.resolve(process.cwd(), "data", "screenshots", String(bot.id));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-facebook-detail.png`);
}

function proxyConfig(proxy: string | null): { server: string } | undefined {
  return proxy ? { server: proxy } : undefined;
}

async function pause(ms = 900): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * 700)));
}

async function launchContext(bot: Bot, profile: BrowserProfileRuntime): Promise<BrowserContext> {
  const executablePath = findNativeChromeExecutable();
  const launchOptions = {
    executablePath,
    headless: false,
    proxy: proxyConfig(bot.proxyUrl),
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1365, height: 768 },
    userAgent: bot.userAgent || undefined
  };

  try {
    return await chromium.launchPersistentContext(profile.userDataDir, launchOptions);
  } catch {
    killOrphanChromeForProfile(profile.userDataDir);
    return chromium.launchPersistentContext(profile.userDataDir, launchOptions);
  }
}

function toMobileFacebookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("facebook.com")) {
      parsed.hostname = "m.facebook.com";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeFacebookUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.facebook.com");
    if (!url.hostname.includes("facebook.com")) {
      return null;
    }
    const hasPostId =
      Boolean(url.searchParams.get("story_fbid")) ||
      Boolean(url.pathname.match(/\/(?:posts|videos|photos|reel)\/[^/?#]+/)) ||
      Boolean(url.pathname.includes("photo.php")) ||
      Boolean(url.pathname.match(/\/share\/[pvr]\/[^/?#]+/)) ||
      url.pathname.includes("permalink.php");
    if (!hasPostId) {
      return null;
    }
    url.searchParams.delete("__cft__");
    url.searchParams.delete("__tn__");
    return url.toString();
  } catch {
    return null;
  }
}

async function collectPostUrls(page: Page, targetUrl: string, limit: number): Promise<string[]> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pause();

  const seen = new Set<string>();
  for (let index = 0; index < 8 && seen.size < limit; index += 1) {
    const links = await page
      .evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((link) => (link as HTMLAnchorElement).href))
      .catch(() => []);
    for (const link of links) {
      const normalized = normalizeFacebookUrl(link);
      if (normalized) {
        seen.add(normalized);
      }
    }
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await pause();
  }

  return [...seen].slice(0, limit);
}

async function postUrlFromArticle(article: ReturnType<Page["locator"]>): Promise<string | null> {
  const links = await article
    .evaluate((root) => Array.from(root.querySelectorAll("a[href]")).map((link) => (link as HTMLAnchorElement).href))
    .catch(() => []);

  for (const link of links) {
    const normalized = normalizeFacebookUrl(link);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

async function clickText(page: Page, labels: string[], maxClicks = 20): Promise<number> {
  let clicked = 0;
  for (const label of labels) {
    const locators = await page.getByText(label, { exact: false }).all().catch(() => []);
    for (const locator of locators.slice(0, maxClicks - clicked)) {
      await locator.click({ timeout: 1200 }).catch(() => undefined);
      clicked += 1;
      await pause(250);
      if (clicked >= maxClicks) {
        return clicked;
      }
    }
  }
  return clicked;
}

async function expandPostComments(page: Page): Promise<void> {
  await clickText(page, ["See more", "Xem thêm"], 12);
  for (let index = 0; index < 8; index += 1) {
    const clicked = await clickText(
      page,
      [
        "View more comments",
        "See more comments",
        "View previous comments",
        "All comments",
        "Most relevant",
        "Xem thêm bình luận",
        "Xem các bình luận trước",
        "Tất cả bình luận"
      ],
      16
    );
    await page.mouse.wheel(0, 700).catch(() => undefined);
    await pause(450);
    if (clicked === 0 && index > 2) {
      break;
    }
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metricValue(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`([0-9][0-9.,]*\\s*[kKmM]?)\\s+${label}|${label}\\s*[:\\-]?\\s*([0-9][0-9.,]*\\s*[kKmM]?)`, "i");
    const match = text.match(pattern);
    const value = match?.[1] ?? match?.[2];
    if (value) {
      return normalizeMetric(value);
    }
  }
  return null;
}

function normalizeMetric(value: string): number | null {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, "");
  const multiplier = trimmed.endsWith("k") ? 1000 : trimmed.endsWith("m") ? 1000000 : 1;
  const numeric = Number(trimmed.replace(/[km]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
}

function postIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("story_fbid") ||
      parsed.pathname.match(/\/(?:posts|videos|reel)\/([^/?]+)/)?.[1] ||
      parsed.pathname.match(/\/share\/[pv]\/([^/?]+)/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}

function extractPublishedAt(lines: string[]): string | null {
  return lines.find((line) => /^(\d+[smhdw]|yesterday|just now|\d+\s*(min|hr|day|week)s?)/i.test(line)) ?? null;
}

function isNoiseLine(line: string): boolean {
  return [
    /^online status indicator$/i,
    /^active$/i,
    /^like$/i,
    /^reply$/i,
    /^share$/i,
    /^comment$/i,
    /^comments$/i,
    /^write a comment/i,
    /^view more comments/i,
    /^see more/i,
    /^see less$/i,
    /^see translation$/i,
    /^all comments$/i,
    /^most relevant$/i,
    /^facebook$/i,
    /^\d[\d,.]*[kKmM]?$/,
    /^\d+[smhdw]$/i
  ].some((pattern) => pattern.test(line));
}

function isTimestampLine(line: string): boolean {
  return /^(\d+[smhdw]|yesterday|just now|\d+\s*(min|hr|day|week)s?|vừa xong|\d+\s*(phút|giờ|ngày|tuần))$/i.test(line.trim());
}

async function expandFeedCaptions(page: Page): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await clickText(page, ["See more", "Xem thêm"], 18);
    await page
      .evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("div, span, a, [role='button']")) as HTMLElement[];
        for (const element of candidates) {
          const text = (element.innerText || element.textContent || "").trim();
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && /^(see more|xem th[eê]m)$/i.test(text)) {
            element.click();
          }
        }
      })
      .catch(() => undefined);
    await page.mouse.wheel(0, 900).catch(() => undefined);
    await pause(500);
  }
}

async function expandArticleCaption(article: ReturnType<Page["locator"]>): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    const clicked = await article
      .evaluate((root) => {
        const candidates = Array.from(root.querySelectorAll("div, span, a, [role='button']")) as HTMLElement[];
        const target = candidates.find((element) => {
          const text = (element.innerText || element.textContent || "").trim();
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && /^(see more|xem th[eê]m)$/i.test(text);
        });
        if (!target) {
          return false;
        }
        target.click();
        return true;
      })
      .catch(() => false);

    if (!clicked) {
      break;
    }
    await pause(350);
  }
}

function parseVisibleComments(rawText: string): ParsedPost["comments"] {
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map((line) => line.replace(/\s*See less\b/gi, "").replace(/…\s*See more\b/gi, "").replace(/\s*See more\b/gi, "").trim())
    .filter(Boolean);
  const comments: ParsedPost["comments"] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^(Like|Reply|Thích|Trả lời)$/i.test(line) && !/(Like|Reply|Thích|Trả lời)/i.test(line)) {
      continue;
    }
    const previousLine = lines[index - 1];
    const content = previousLine && isTimestampLine(previousLine) ? lines[index - 2] : previousLine;
    const author = previousLine && isTimestampLine(previousLine) ? lines[index - 3] : lines[index - 2];
    if (
      !content ||
      !author ||
      isNoiseLine(content) ||
      isNoiseLine(author) ||
      content.startsWith("@") ||
      content.length < 2 ||
      author.length > 90
    ) {
      continue;
    }
    const key = `${author}:${content}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    comments.push({
      commentId: null,
      authorName: author,
      authorUrl: null,
      content,
      reactionCount: null,
      createdAtText: null,
      parentCommentId: null
    });
  }

  return comments.slice(0, 250);
}

function hasCommentMetric(text: string): boolean {
  return /(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bình luận)/i.test(text) || trailingMetricNumbers(text).length >= 2;
}

function isLikelyCommentOnlyArticle(text: string): boolean {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasCommentActions = lines.some((line) => /^(Like|Reply|ThÃ­ch|Tráº£ lá»i)$/i.test(line));
  return hasCommentActions && trailingMetricNumbers(text).length === 0 && lines.length <= 9;
}

async function visibleDialogText(page: Page): Promise<string> {
  const dialogs = page.locator('[role="dialog"]');
  const count = await dialogs.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index);
    if (await dialog.isVisible().catch(() => false)) {
      return dialog.innerText({ timeout: 3000 }).catch(() => "");
    }
  }
  return "";
}

async function scrollCommentsSurface(page: Page): Promise<void> {
  const scrolledDialog = await page
    .locator('[role="dialog"]')
    .last()
    .evaluate((dialog) => {
      const candidates = [dialog, ...Array.from(dialog.querySelectorAll("*"))] as HTMLElement[];
      const scrollable = candidates.find((node) => node.scrollHeight > node.clientHeight + 80);
      if (!scrollable) {
        return false;
      }
      scrollable.scrollTop = scrollable.scrollHeight;
      return true;
    })
    .catch(() => false);

  if (!scrolledDialog) {
    await page.mouse.wheel(0, 900).catch(() => undefined);
  }
}

async function scrollCommentsSurfaceToTop(page: Page): Promise<void> {
  const scrolledDialog = await page
    .locator('[role="dialog"]')
    .last()
    .evaluate((dialog) => {
      const candidates = [dialog, ...Array.from(dialog.querySelectorAll("*"))] as HTMLElement[];
      const scrollable = candidates.find((node) => node.scrollHeight > node.clientHeight + 80);
      if (!scrollable) {
        return false;
      }
      scrollable.scrollTop = 0;
      return true;
    })
    .catch(() => false);

  if (!scrolledDialog) {
    await page.mouse.wheel(0, -1200).catch(() => undefined);
  }
}

async function closeCommentsDialog(page: Page, originalUrl: string): Promise<void> {
  const closeClicked = await page
    .locator('[role="dialog"] [aria-label="Close"], [role="dialog"] [aria-label="Close dialog"]')
    .last()
    .click({ timeout: 1200 })
    .then(() => true)
    .catch(() => false);

  if (!closeClicked) {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await pause(350);

  if (await visibleDialogText(page)) {
    const dialogBox = await page.locator('[role="dialog"]').last().boundingBox().catch(() => null);
    if (dialogBox) {
      await page.mouse.click(dialogBox.x + dialogBox.width - 32, dialogBox.y + 32).catch(() => undefined);
      await pause(450);
    }
  }

  if (page.url() !== originalUrl) {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
  }
}

async function selectAllComments(page: Page): Promise<void> {
  if (!(await visibleDialogText(page))) {
    return;
  }

  await clickText(page, ["Most relevant", "Newest", "All comments", "Phù hợp nhất", "Mới nhất", "Tất cả bình luận"], 1);
  await pause(450);
  await clickText(page, ["All comments", "Tất cả bình luận"], 1);
  await pause(600);
}

async function loadAllVisibleComments(page: Page): Promise<void> {
  let stableRounds = 0;
  let previousTextLength = 0;

  for (let round = 0; round < 24; round += 1) {
    await clickText(
      page,
      [
        "View more comments",
        "See more comments",
        "View previous comments",
        "View more replies",
        "See more replies",
        "Xem thêm bình luận",
        "Xem các bình luận trước",
        "Xem thêm phản hồi"
      ],
      10
    );
    await scrollCommentsSurface(page);
    await pause(450);

    const textLength = (await visibleDialogText(page)).length;
    stableRounds = textLength <= previousTextLength + 20 ? stableRounds + 1 : 0;
    previousTextLength = Math.max(previousTextLength, textLength);
    if (stableRounds >= 4 && round >= 6) {
      break;
    }
  }
}

async function clickCommentControl(page: Page, article: ReturnType<Page["locator"]>, beforeText: string): Promise<boolean> {
  const trailingMetrics = trailingMetricNumbers(beforeText);
  const commentCount = trailingMetrics[1];

  const commentIconPoint = await article
    .evaluate((root, expectedCommentCount) => {
      const rootRect = (root as HTMLElement).getBoundingClientRect();
      const elements = Array.from(root.querySelectorAll("*")) as HTMLElement[];
      const boundaryItems = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: (element.innerText || "").trim(), top: rect.top, width: rect.width, height: rect.height };
        })
        .filter((item) => item.width > 0 && item.height > 0)
        .filter((item) => /view more comments|write a comment|xem thêm bình luận|viết bình luận/i.test(item.text));
      const boundaryY = boundaryItems.length ? Math.min(...boundaryItems.map((item) => item.top)) : rootRect.bottom;
      const numericItems = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || "").trim();
          return {
            text,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            left: rect.left,
            width: rect.width,
            height: rect.height
          };
        })
        .filter((item) => item.width > 0 && item.height > 0)
        .filter((item) => item.y - rootRect.top > rootRect.height * 0.35)
        .filter((item) => item.y < boundaryY - 4)
        .filter((item) => /^\d[\d,.]*[kKmM]?$/.test(item.text));

      const metricLabel = expectedCommentCount ? String(expectedCommentCount) : null;
      const exactMetric = metricLabel ? numericItems.find((item) => item.text === metricLabel) : null;
      if (exactMetric) {
        return { x: Math.max(rootRect.left + 8, exactMetric.left - 24), y: exactMetric.y };
      }

      const rowMap = new Map<number, typeof numericItems>();
      for (const item of numericItems) {
        const rowKey = Math.round(item.y / 18) * 18;
        rowMap.set(rowKey, [...(rowMap.get(rowKey) ?? []), item]);
      }
      const metricRow = [...rowMap.values()]
        .map((items) => items.sort((a, b) => a.x - b.x))
        .sort((a, b) => Math.max(...b.map((item) => item.y)) - Math.max(...a.map((item) => item.y)))
        .find((items) => items.length >= 2);
      const commentMetric = metricRow?.[1];
      return commentMetric ? { x: Math.max(rootRect.left + 8, commentMetric.left - 24), y: commentMetric.y } : null;
    }, commentCount ?? null)
    .catch(() => null);

  if (commentIconPoint) {
    await page.mouse.click(commentIconPoint.x, commentIconPoint.y).catch(() => undefined);
    await pause(1000);
    if ((await visibleDialogText(page)).length > 40) {
      return true;
    }
  }

  return false;

  const clickedInDom = await article
    .evaluate((root, expectedCommentCount) => {
      const rootRect = (root as HTMLElement).getBoundingClientRect();
      const clickElement = (element: Element): boolean => {
        const clickable = element.closest('[role="button"], a[href], [tabindex="0"]') ?? element;
        const rect = (clickable as HTMLElement).getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        (clickable as HTMLElement).click();
        return true;
      };

      const elements = Array.from(root.querySelectorAll('[role="button"], a[href], [tabindex="0"], span, div')) as HTMLElement[];
      const labeled = elements
        .map((element) => ({
          element,
          text: (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim(),
          rect: element.getBoundingClientRect()
        }))
        .filter((item) => item.rect.width > 0 && item.rect.height > 0)
        .filter((item) => /comment|comments|bình luận|binh luan/i.test(item.text));

      const metricLabel = expectedCommentCount ? String(expectedCommentCount) : null;
      const metricCandidate = metricLabel
        ? labeled.find((item) => item.text === metricLabel || item.text.includes(`${metricLabel} comment`))
        : null;
      if (metricCandidate && clickElement(metricCandidate.element)) {
        return "metric-label";
      }

      const exactMetric = metricLabel
        ? elements
            .map((element) => ({
              element,
              text: (element.innerText || "").trim(),
              rect: element.getBoundingClientRect()
            }))
            .filter((item) => item.rect.width > 0 && item.rect.height > 0)
            .find((item) => item.text === metricLabel)
        : null;
      if (exactMetric && clickElement(exactMetric.element)) {
        return "exact-comment-count";
      }

      const commentLabel = labeled.find((item) => !/write a comment/i.test(item.text));
      if (commentLabel && clickElement(commentLabel.element)) {
        return "comment-label";
      }

      const candidates = Array.from(root.querySelectorAll('[role="button"], a[href], [tabindex="0"]')) as HTMLElement[];
      const actionCandidates = candidates
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.getAttribute("aria-label") || "").trim();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return { element, rect, text, centerX, centerY };
        })
        .filter((item) => {
          if (item.rect.width <= 0 || item.rect.height <= 0) {
            return false;
          }
          const relativeY = item.centerY - rootRect.top;
          const relativeX = item.centerX - rootRect.left;
          return relativeY > rootRect.height * 0.35 && relativeX > rootRect.width * 0.08 && relativeX < rootRect.width * 0.75;
        })
        .filter((item) => !/like|share|send|write a comment|thích|chia sẻ/i.test(item.text))
        .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

      const rowMap = new Map<number, typeof actionCandidates>();
      for (const item of actionCandidates) {
        const rowKey = Math.round(item.centerY / 18) * 18;
        rowMap.set(rowKey, [...(rowMap.get(rowKey) ?? []), item]);
      }

      const row = [...rowMap.values()]
        .map((items) => items.sort((a, b) => a.centerX - b.centerX))
        .find((items) => items.length >= 2);
      const target = row?.[1] ?? actionCandidates[0];
      if (target && clickElement(target.element)) {
        return "action-row";
      }

      return null;
    }, commentCount ?? null)
    .catch(() => null);

  if (clickedInDom) {
    await pause(1000);
    if ((await visibleDialogText(page)).length > 40) {
      return true;
    }
  }

  const commentPoint = await article
    .evaluate((root, expectedCommentCount) => {
      const rootRect = (root as HTMLElement).getBoundingClientRect();
      const center = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      };

      const elements = Array.from(root.querySelectorAll("*")) as HTMLElement[];
      const metricLabel = expectedCommentCount ? String(expectedCommentCount) : null;
      if (metricLabel) {
        const exact = elements.find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (element.innerText || "").trim() === metricLabel;
        });
        const point = exact ? center(exact) : null;
        if (point) {
          return point;
        }
      }

      const buttons = Array.from(root.querySelectorAll('[role="button"], a[href], [tabindex="0"]')) as HTMLElement[];
      const candidates = buttons
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.getAttribute("aria-label") || "").trim();
          return {
            element,
            text,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
          };
        })
        .filter((item) => item.width > 0 && item.height > 0)
        .filter((item) => item.y - rootRect.top > rootRect.height * 0.35)
        .filter((item) => !/like|share|send|write a comment|thích|chia sẻ/i.test(item.text))
        .sort((a, b) => a.y - b.y || a.x - b.x);

      const commentText = candidates.find((item) => /comment|comments|bình luận|binh luan/i.test(item.text));
      if (commentText) {
        return { x: commentText.x, y: commentText.y };
      }

      const rowMap = new Map<number, typeof candidates>();
      for (const item of candidates) {
        const rowKey = Math.round(item.y / 18) * 18;
        rowMap.set(rowKey, [...(rowMap.get(rowKey) ?? []), item]);
      }
      const row = [...rowMap.values()]
        .map((items) => items.sort((a, b) => a.x - b.x))
        .find((items) => items.length >= 2);
      const target = row?.[1] ?? candidates[0];
      return target ? { x: target.x, y: target.y } : null;
    }, commentCount ?? null)
    .catch(() => null);

  if (commentPoint) {
    await page.mouse.click(commentPoint!.x, commentPoint!.y).catch(() => undefined);
    await pause(1000);
    if ((await visibleDialogText(page)).length > 40) {
      return true;
    }
  }

  const box = await article.boundingBox().catch(() => null);
  if (!box) {
    return false;
  }

  const yCandidates = [box!.y + box!.height - 112, box!.y + box!.height - 150, box!.y + box!.height * 0.72];
  const xCandidates = [0.33, 0.42, 0.26, 0.5];
  for (const y of yCandidates) {
    for (const xRatio of xCandidates) {
      await page.mouse.click(box!.x + box!.width * xRatio, Math.max(box!.y + 25, y)).catch(() => undefined);
      await pause(700);
      if ((await visibleDialogText(page)).length > 40) {
        return true;
      }
    }
  }

  return false;
}

async function openCommentThread(page: Page, article: ReturnType<Page["locator"]>, beforeText: string): Promise<boolean> {
  if (await clickCommentControl(page, article, beforeText)) {
    return true;
  }

  return false;

  await clickCommentMetricArea(page, article, beforeText);
  await pause(800);
  if ((await visibleDialogText(page)).length > 40) {
    return true;
  }

  const clickedMetricText = await article
    .getByText(/(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bÃ¬nh luáº­n)/i)
    .first()
    .click({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (clickedMetricText) {
    await pause(900);
  }
  if ((await visibleDialogText(page)).length > 40) {
    return true;
  }

  await article
    .getByRole("button", { name: /Comment|BÃ¬nh luáº­n/i })
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
  await pause(900);

  const afterText = await article.innerText({ timeout: 1200 }).catch(() => "");
  return (await visibleDialogText(page)).length > 40 || parseVisibleComments(afterText).length > 0;
}

async function clickCommentMetricArea(page: Page, article: ReturnType<Page["locator"]>, beforeText: string): Promise<void> {
  const trailingMetrics = trailingMetricNumbers(beforeText);
  const commentCount = trailingMetrics[1];

  const domPoint = await article
    .evaluate((root) => {
      const isNumeric = (value: string) => /^\d[\d,.]*[kKmM]?$/.test(value.trim());
      const elements = Array.from(root.querySelectorAll("*"))
        .map((node) => {
          const element = node as HTMLElement;
          const text = (element.innerText || "").trim();
          const rect = element.getBoundingClientRect();
          return { text, rect, visible: rect.width > 0 && rect.height > 0 };
        })
        .filter((item) => item.visible && isNumeric(item.text) && item.rect.top > 0)
        .map((item) => ({
          text: item.text,
          x: item.rect.left + item.rect.width / 2,
          y: item.rect.top + item.rect.height / 2
        }));

      const rows = new Map<number, Array<{ text: string; x: number; y: number }>>();
      for (const item of elements) {
        const key = Math.round(item.y / 12) * 12;
        rows.set(key, [...(rows.get(key) ?? []), item]);
      }

      const candidateRows = [...rows.values()]
        .map((row) => row.sort((a, b) => a.x - b.x))
        .filter((row) => row.length >= 2)
        .sort((a, b) => Math.max(...b.map((item) => item.y)) - Math.max(...a.map((item) => item.y)));
      const row = candidateRows[0];
      const item = row?.[1];
      return item ? { x: item.x, y: item.y } : null;
    })
    .catch(() => null);

  if (domPoint) {
    await page.mouse.click(domPoint.x, domPoint.y).catch(() => undefined);
    await pause(700);
    const dialogText = await visibleDialogText(page);
    const afterText = await article.innerText({ timeout: 1200 }).catch(() => "");
    if (dialogText.length > 40 || parseVisibleComments(afterText).length > 0) {
      return;
    }
  }

  if (commentCount && commentCount > 1) {
    const exactNumberClick = await article
      .getByText(String(commentCount), { exact: true })
      .first()
      .click({ timeout: 900 })
      .then(() => true)
      .catch(() => false);
    if (exactNumberClick) {
      await pause(700);
      return;
    }
  }

  const box = await article.boundingBox().catch(() => null);
  if (!box) {
    return;
  }

  const metricY = Math.max(box.y + 20, box.y + box.height - 128);
  for (const ratio of [0.2, 0.28, 0.36, 0.44]) {
    await page.mouse.click(box.x + box.width * ratio, metricY).catch(() => undefined);
    await pause(450);
    const dialogText = await visibleDialogText(page);
    const afterText = await article.innerText({ timeout: 1200 }).catch(() => "");
    if (dialogText.length > 40 || parseVisibleComments(afterText).length > 0) {
      return;
    }
  }
}

async function expandVisiblePostComments(page: Page, maxPosts: number): Promise<string[]> {
  const originalUrl = page.url();
  const snapshots: string[] = [];
  const seen = new Set<string>();

  for (let scan = 0; scan < maxPosts * 3 && snapshots.length < maxPosts; scan += 1) {
    const articles = page.locator('[role="article"]');
    const count = await articles.count().catch(() => 0);

    for (let index = 0; index < count && snapshots.length < maxPosts; index += 1) {
      const article = articles.nth(index);
      const beforeText = await article.innerText({ timeout: 2500 }).catch(() => "");
      const signature = normalizeText(beforeText).slice(0, 220).toLowerCase();
      if (signature.length < 40 || seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      await article.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await pause(250);
      await article.getByText(/See more|Xem thêm/i).first().click({ timeout: 1000 }).catch(() => undefined);
      await pause(250);

      if (hasCommentMetric(beforeText)) {
        await clickCommentMetricArea(page, article, beforeText);
        const clickedCommentText = await article
          .getByText(/(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bình luận)/i)
          .first()
          .click({ timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (!clickedCommentText) {
          const box = await article.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width * 0.2, Math.max(box.y + 20, box.y + box.height - 128)).catch(() => undefined);
            await pause(500);
          }
        }
        if (!clickedCommentText && !(await visibleDialogText(page))) {
          await article
            .getByRole("button", { name: /Comment|Bình luận/i })
            .first()
            .click({ timeout: 1500 })
            .catch(() => undefined);
        }
        await pause(700);

        for (let round = 0; round < 10; round += 1) {
          const clicked = await clickText(
            page,
            [
              "View more comments",
              "See more comments",
              "View previous comments",
              "Xem thêm bình luận",
              "Xem các bình luận trước"
            ],
            8
          );
          await scrollCommentsSurface(page);
          await pause(350);
          if (clicked === 0 && round > 3) {
            break;
          }
        }
      }

      const afterArticleText = await article.innerText({ timeout: 3000 }).catch(() => "");
      const dialogText = await visibleDialogText(page);
      snapshots.push(`${afterArticleText}\n${dialogText}`);

      await page.keyboard.press("Escape").catch(() => undefined);
      if (page.url() !== originalUrl) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
      }
      await pause(350);
    }

    if (snapshots.length < maxPosts) {
      await page.mouse.wheel(0, 900).catch(() => undefined);
      await pause(600);
    }
  }

  return snapshots;
}

async function expandVisiblePostCommentsWithModal(page: Page, maxPosts: number): Promise<string[]> {
  const originalUrl = page.url();
  const snapshots: string[] = [];
  const seen = new Set<string>();

  for (let scan = 0; scan < maxPosts * 4 && snapshots.length < maxPosts; scan += 1) {
    const articles = page.locator('[role="article"]');
    const count = await articles.count().catch(() => 0);

    for (let index = 0; index < count && snapshots.length < maxPosts; index += 1) {
      const article = articles.nth(index);
      const beforeText = await article.innerText({ timeout: 2500 }).catch(() => "");
      if (isLikelyCommentOnlyArticle(beforeText)) {
        continue;
      }
      const signature = normalizeText(beforeText).slice(0, 240).toLowerCase();
      if (signature.length < 40 || seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      await article.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await pause(300);

      const snapshotParts = [beforeText];
      let openMode = "not_attempted";
      const opened = await openCommentThread(page, article, beforeText);
      if (opened) {
        openMode = "popup";
        await scrollCommentsSurfaceToTop(page);
        await pause(300);
        snapshotParts.push(await visibleDialogText(page));

        await loadAllVisibleComments(page);
        snapshotParts.push(await visibleDialogText(page));

        await selectAllComments(page);
        await loadAllVisibleComments(page);
        snapshotParts.push(await visibleDialogText(page));
      } else {
        const postUrl = await postUrlFromArticle(article);
        if (postUrl) {
          openMode = `permalink:${postUrl}`;
          await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
          await pause(900);
          await expandPostComments(page);
          await loadAllVisibleComments(page);
          const postDetailText = await page.locator("body").innerText({ timeout: 6000 }).catch(() => "");
          snapshotParts.push(postDetailText);
          await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
          await pause(900);
        } else {
          openMode = "failed_no_permalink";
        }
      }

      const afterArticleText = await article.innerText({ timeout: 3000 }).catch(() => "");
      snapshots.push([`[facebook-crawler openMode=${openMode}]`, ...snapshotParts, afterArticleText].filter(Boolean).join("\n\n--- FACEBOOK POST SNAPSHOT STEP ---\n\n"));

      await closeCommentsDialog(page, originalUrl);
      await pause(450);
    }

    if (snapshots.length < maxPosts) {
      await page.mouse.wheel(0, 950).catch(() => undefined);
      await pause(700);
    }
  }

  return snapshots;
}

async function collectFeedMetricSnapshots(page: Page, maxPosts: number): Promise<string[]> {
  const snapshots: string[] = [];
  const seen = new Set<string>();

  for (let scan = 0; scan < maxPosts * 4 && snapshots.length < maxPosts; scan += 1) {
    const articles = page.locator('[role="article"]');
    const count = await articles.count().catch(() => 0);

    for (let index = 0; index < count && snapshots.length < maxPosts; index += 1) {
      const article = articles.nth(index);
      const beforeText = await article.innerText({ timeout: 2500 }).catch(() => "");
      if (isLikelyCommentOnlyArticle(beforeText)) {
        continue;
      }

      const signature = normalizeText(beforeText).slice(0, 240).toLowerCase();
      if (signature.length < 40 || seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      await article.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await pause(250);
      await expandArticleCaption(article);

      const afterText = await article.innerText({ timeout: 3000 }).catch(() => beforeText);
      snapshots.push(afterText || beforeText);
    }

    if (snapshots.length < maxPosts) {
      await page.mouse.wheel(0, 950).catch(() => undefined);
      await pause(650);
    }
  }

  return snapshots;
}

function fallbackPostsFromFeed(rawText: string, targetUrl: string, limit = 10): ParsedPost[] {
  const text = rawText.replace(/\r\n/g, "\n");
  const posts: ParsedPost[] = [];
  const seen = new Set<string>();

  function addPost(segment: string, author: string | null): void {
    const end = segment.search(/\n(?:Write a comment|Facebook\nFacebook|Online status indicator|Posts\nFilters)\n/i);
    const cleanSegment = end >= 0 ? segment.slice(0, end) : segment;
    const postText = extractMainContent(cleanSegment);
    const trailingMetrics = trailingMetricNumbers(cleanSegment);
    const key = postText.slice(0, 180).toLowerCase();
    if (postText.length >= 20 && !seen.has(key)) {
      seen.add(key);
      posts.push({
        postUrl: targetUrl,
        postId: null,
        author,
        content: postText,
        publishedAt: null,
        reactionCount: metricValue(cleanSegment, ["reactions", "reaction", "likes", "like"]) ?? trailingMetrics[0] ?? null,
        likeCount: metricValue(cleanSegment, ["likes", "like"]) ?? trailingMetrics[0] ?? null,
        commentCount: metricValue(cleanSegment, ["comments", "comment"]) ?? trailingMetrics[1] ?? null,
        shareCount: metricValue(cleanSegment, ["shares", "share"]) ?? trailingMetrics[2] ?? null,
        viewCount: metricValue(cleanSegment, ["views", "view"]),
        rawText: normalizeText(cleanSegment),
        comments: parseVisibleComments(cleanSegment)
      });
    }
  }

  const statusMarker = /\nOnline status indicator\nActive\n[^\n]{2,120}\n\s*(?:·|Â·)\n/g;
  const matches = [...text.matchAll(statusMarker)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    addPost(text.slice(start, nextStart), null);
  }

  if (!posts.length) {
    const blocks = text.split(/(?:\nFacebook){4,}\n/g);
    for (const block of blocks) {
      const dotIndex = block.lastIndexOf("\n·\n");
      if (dotIndex < 0) {
        continue;
      }
      const beforeDot = block.slice(0, dotIndex).split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const author = beforeDot.find((line) => line.length > 3 && !isNoiseLine(line)) ?? null;
      addPost(block.slice(dotIndex + 3), author);
    }
  }

  return posts.slice(0, limit);
}

function postsFromExpandedSnapshots(snapshots: string[], targetUrl: string, limit: number): ParsedPost[] {
  const posts: ParsedPost[] = [];
  const seen = new Set<string>();

  for (const snapshot of snapshots) {
    const text = normalizeText(snapshot);
    const postText = extractMainContent(text);
    const key = postText.slice(0, 180).toLowerCase();
    if (postText.length < 20 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const trailingMetrics = trailingMetricNumbers(text);
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    posts.push({
      postUrl: targetUrl,
      postId: null,
      author: lines.find((line) => line.length > 3 && !isNoiseLine(line)) ?? null,
      content: postText,
      publishedAt: null,
      reactionCount: metricValue(text, ["reactions", "reaction", "likes", "like"]) ?? trailingMetrics[0] ?? null,
      likeCount: metricValue(text, ["likes", "like"]) ?? trailingMetrics[0] ?? null,
      commentCount: metricValue(text, ["comments", "comment"]) ?? trailingMetrics[1] ?? null,
      shareCount: metricValue(text, ["shares", "share"]) ?? trailingMetrics[2] ?? null,
      viewCount: metricValue(text, ["views", "view"]),
      rawText: text,
      comments: parseVisibleComments(text)
    });
  }

  return posts.slice(0, limit);
}

function extractMainContent(rawText: string): string {
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map((line) => line.replace(/\s*See less\b/gi, "").replace(/â€¦\s*See more\b/gi, "").replace(/\s*See more\b/gi, "").trim())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));
  const metricIndex = lines.findIndex((line) => /\b(comments?|shares?|likes?|reactions?)\b/i.test(line));
  const body = (metricIndex > 2 ? lines.slice(0, metricIndex) : lines).slice(0, 30);
  return body.join("\n").slice(0, 4000) || normalizeText(rawText).slice(0, 4000);
}

function trailingMetricNumbers(text: string): number[] {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^\d[\d,.]*[kKmM]?$/.test(line))
    .map((line) => normalizeMetric(line))
    .filter((value): value is number => value !== null)
    .slice(-3);
}

async function parsePostPage(page: Page, postUrl: string): Promise<ParsedPost> {
  const rawText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  const text = normalizeText(rawText);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return {
    postUrl,
    postId: postIdFromUrl(postUrl),
    author: lines.find((line) => line.length > 2 && !isNoiseLine(line)) ?? null,
    content: extractMainContent(text),
    publishedAt: extractPublishedAt(lines),
    reactionCount: metricValue(text, ["reactions", "reaction", "likes", "like"]),
    likeCount: metricValue(text, ["likes", "like"]),
    commentCount: metricValue(text, ["comments", "comment"]),
    shareCount: metricValue(text, ["shares", "share"]),
    viewCount: metricValue(text, ["views", "view"]),
    rawText: text,
    comments: parseVisibleComments(text)
  };
}

function summarizeSocial(posts: ParsedPost[], sourceUrl: string): Omit<SocialSnapshot, "id" | "crawlResultId"> {
  const totals = posts.reduce(
    (acc, post) => ({
      views: acc.views + (post.viewCount ?? 0),
      likes: acc.likes + (post.likeCount ?? post.reactionCount ?? 0),
      comments: acc.comments + (post.commentCount ?? post.comments.length),
      shares: acc.shares + (post.shareCount ?? 0)
    }),
    { views: 0, likes: 0, comments: 0, shares: 0 }
  );
  const interactions = totals.likes + totals.comments + totals.shares;
  const engagementRate = totals.views > 0 ? Number(((interactions / totals.views) * 100).toFixed(2)) : null;

  return {
    platform: new URL(sourceUrl).hostname,
    postCount: posts.length,
    postsJson: JSON.stringify(posts),
    commentsJson: JSON.stringify(posts.flatMap((post) => post.comments.map((comment) => ({ postId: post.postId, ...comment })))),
    views: totals.views || null,
    likes: totals.likes || null,
    comments: totals.comments || null,
    shares: totals.shares || null,
    saves: null,
    downloads: null,
    engagementRate,
    unavailableReason: posts.length ? null : "post_detail_not_visible"
  };
}

export async function crawlFacebookPage(bot: Bot, maxPosts = 5): Promise<FacebookCrawlOutput> {
  const profile = getBrowserProfileRuntime(bot);
  const context = await launchContext(bot, profile);
  const page = context.pages()[0] ?? (await context.newPage());
  const imagePath = screenshotPath(bot);

  try {
    const posts: ParsedPost[] = [];
    let rawHtml = "";
    let rawText = "";
    let title: string | null = null;
    let httpStatus: number | null = null;

    const response = await page.goto(bot.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    httpStatus = response?.status() ?? httpStatus;
    await pause();
    await expandFeedCaptions(page);
    const expandedSnapshots = await collectFeedMetricSnapshots(page, maxPosts);
    title = await page.title().catch(() => title);
    rawHtml = await page.content().catch(() => rawHtml);
    rawText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
    posts.push(...fallbackPostsFromFeed(rawText, bot.targetUrl, maxPosts));
    if (posts.length < maxPosts) {
      const seenKeys = new Set(posts.map((post) => post.content.slice(0, 180).toLowerCase()));
      for (const post of postsFromExpandedSnapshots(expandedSnapshots, bot.targetUrl, maxPosts)) {
        const key = post.content.slice(0, 180).toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          posts.push(post);
        }
        if (posts.length >= maxPosts) {
          break;
        }
      }
    }
    for (let index = 0; index < posts.length; index += 1) {
      posts[index].comments = [];
      posts[index].rawText = `${posts[index].rawText ?? ""}\n\n${expandedSnapshots[index] ?? ""}`.trim();
    }

    await page.screenshot({ path: imagePath, fullPage: true }).catch(() => undefined);
    const socialSnapshot = summarizeSocial(posts, bot.targetUrl);

    return {
      rendered: {
        title: title || "Facebook social crawl",
        rawText: normalizeText(`${expandedSnapshots.join("\n\n--- EXPANDED POST ---\n\n")}\n\n${rawText}`),
        rawHtml,
        screenshotPath: fs.existsSync(imagePath) ? imagePath : null,
        httpStatus,
        engine: "native-facebook-feed-metrics"
      },
      socialSnapshot,
      socialPosts: posts
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

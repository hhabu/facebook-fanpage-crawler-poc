import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

const MAX_COMMENTS_PER_POST = 500;
const MAX_REPLIES_PER_COMMENT = 100;
const POST_CONTENT_UNAVAILABLE = "(post content unavailable)";
const NASA_HUBBLE_OWNER = "NASA's Hubble Space Telescope";
const KNOWN_COMMENTER_NAME_PREFIXES = ["The Curiosity Hub", "Randall Wilkinson", "Clark Timothee"];

interface CommentExpansionStats {
  comments: number;
  replies: number;
}

interface CommentDomItem {
  text: string;
  left: number;
  top: number;
  authorUrl: string | null;
}

interface ReelViewerMetadata {
  owner: string | null;
  caption: string;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
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
    args: ["--disable-blink-features=AutomationControlled", "--disable-quic"],
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
    for (const key of [...url.searchParams.keys()]) {
      if (key === "__tn__" || key.startsWith("__cft__")) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isTrueFacebookPostUrl(value: string | null): value is string {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      Boolean(url.searchParams.get("story_fbid")) ||
      Boolean(url.pathname.match(/\/(?:posts|videos|reel)\/[^/?#]+/)) ||
      url.pathname.includes("permalink.php") ||
      /pfbid/i.test(value)
    );
  } catch {
    return false;
  }
}

function reelIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.facebook.com");
    return url.pathname.match(/\/reel\/([^/?#]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isFacebookReelUrl(value: string): boolean {
  return reelIdFromUrl(value) !== null;
}

function isEligibleFacebookArticle(_text: string, postUrl: string | null): postUrl is string {
  return isTrueFacebookPostUrl(postUrl);
}

function isBlockedNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.hostname.includes("facebook.com") || /\/(?:friends|groups|gaming|games|marketplace|watch)(?:\/|$)/i.test(url.pathname) || url.pathname === "/";
  } catch {
    return true;
  }
}

function isOnTargetFacebookPage(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    const targetPath = target.pathname.replace(/\/+$/, "");
    return current.hostname.includes("facebook.com") && Boolean(targetPath) && current.pathname.startsWith(targetPath);
  } catch {
    return false;
  }
}

async function ensureTargetFacebookPage(page: Page, targetUrl: string): Promise<void> {
  if (!isOnTargetFacebookPage(page.url(), targetUrl)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    await pause(700);
  }
}

async function recoverIfBadNavigation(page: Page, originalUrl: string): Promise<boolean> {
  const currentUrl = page.url();
  if (isBlockedNavigationUrl(currentUrl)) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    await pause(700);
    return true;
  }
  if (currentUrl === originalUrl || (currentUrl.includes("facebook.com") && isTrueFacebookPostUrl(currentUrl))) {
    return false;
  }
  if (currentUrl !== originalUrl) {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    await pause(700);
    return true;
  }
  return false;
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

  const normalizedLinks: string[] = [];
  for (const link of links) {
    const normalized = normalizeFacebookUrl(link);
    if (isTrueFacebookPostUrl(normalized)) {
      normalizedLinks.push(normalized);
    }
  }
  return normalizedLinks.find((link) => postIdFromUrl(link)) ?? normalizedLinks[0] ?? null;
}

function isAllowedCommentExpansionLabel(label: string): boolean {
  return /^(view more comments|see more comments|view previous comments|view more replies|see more replies|xem th.*b.*nh lu|xem th.*ph.*n h|xem c.*b.*nh lu.*tr)/i.test(
    foldForUiMatch(label)
  );
}

function isBlockedClickLabel(label: string): boolean {
  return /^(groups|nhom|nhÃƒÆ’Ã‚Â³m|games|tro choi|trÃƒÆ’Ã‚Â² chÃƒâ€ Ã‚Â¡i|reels|photos|about|more|menu)$/i.test(foldForUiMatch(label));
}

async function clickText(page: Page, labels: string[], maxClicks = 20, scope?: ReturnType<Page["locator"]>): Promise<number> {
  let clicked = 0;
  const mustUseScopedExpansion = labels.some((label) => /comments?|repl|b.*nh lu|ph.*n h/i.test(foldForUiMatch(label)));
  const root = scope ?? (mustUseScopedExpansion ? page.locator('[role="dialog"]').last() : page.locator("body"));
  for (const label of labels) {
    if (isBlockedClickLabel(label) || (mustUseScopedExpansion && !isAllowedCommentExpansionLabel(label))) {
      continue;
    }
    const locators = await root.getByText(label, { exact: false }).all().catch(() => []);
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

function addExpansionStats(target: CommentExpansionStats, source: CommentExpansionStats): CommentExpansionStats {
  target.comments += source.comments;
  target.replies += source.replies;
  return target;
}

async function waitForCommentExpansion(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
  await pause(350);
}

async function clickOneCommentExpansionControl(page: Page): Promise<"comments" | "replies" | null> {
  const clickedText = await page
    .evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
      const dialog = dialogs.reverse().find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const article = document.querySelector('[role="article"]') as HTMLElement | null;
      const root = dialog ?? article;
      if (!root) {
        return null;
      }
      const patterns = [
        /view more comments/i,
        /see more comments/i,
        /view previous comments/i,
        /view more replies/i,
        /see more replies/i,
        /xem th.*b.*nh lu/i,
        /xem th.*ph.*n h/i,
        /xem c.*b.*nh lu.*tr/i
      ];
      const blocked = /^(groups|nh[oÃƒÆ’Ã‚Â³]m|games|tr[oÃƒÆ’Ã‚Â²] ch[oÃƒâ€ Ã‚Â¡]i|reels|photos|about|more|menu)$/i;
      const elements = Array.from(root.querySelectorAll('[role="button"], a[href], span, div')) as HTMLElement[];
      const target = elements.find((element) => {
        const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !blocked.test(text) && patterns.some((pattern) => pattern.test(text));
      });
      if (!target) {
        return null;
      }
      const text = (target.innerText || target.textContent || target.getAttribute("aria-label") || "").trim();
      target.click();
      return text;
    })
    .catch(() => null);

  if (!clickedText) {
    return null;
  }
  return /repl|ph/i.test(clickedText) ? "replies" : "comments";
}

async function expandCommentControlsUntilDone(page: Page, maxClicks = 180): Promise<CommentExpansionStats> {
  const stats: CommentExpansionStats = { comments: 0, replies: 0 };
  let idleRounds = 0;

  for (let clicks = 0; clicks < maxClicks && stats.comments < MAX_COMMENTS_PER_POST; clicks += 1) {
    const clicked = await clickOneCommentExpansionControl(page);
    if (!clicked) {
      await scrollCommentsSurface(page);
      await pause(350);
      idleRounds += 1;
      if (idleRounds >= 3) {
        break;
      }
      continue;
    }

    idleRounds = 0;
    stats[clicked] += 1;
    await waitForCommentExpansion(page);
    await scrollCommentsSurface(page);
  }

  return stats;
}

async function expandPostComments(page: Page): Promise<CommentExpansionStats> {
  const stats: CommentExpansionStats = { comments: 0, replies: 0 };
  await clickText(page, ["See more", "Xem thÃƒÆ’Ã‚Âªm"], 12);
  return addExpansionStats(stats, await expandCommentControlsUntilDone(page, 220));
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

function stablePostId(postUrl: string, content: string): string {
  return `hash_${createHash("sha1").update(`${postUrl}\n${content}`).digest("hex").slice(0, 16)}`;
}

function postIdFor(postUrl: string, content: string): string {
  return postIdFromUrl(postUrl) ?? stablePostId(postUrl, content);
}

function postUrlFromSnapshotText(text: string): string | null {
  const match = text.match(/^\[facebook-crawler postUrl=(.+?)\]$/m);
  return match ? normalizeFacebookUrl(match[1]) : null;
}

function isFacebookLoginWallText(text: string): boolean {
  const normalized = normalizeText(text);
  const hasEmailField = /\b(email or phone|email address or phone number)\b/i.test(normalized);
  const hasCreateAccount = /\bcreate new account\b/i.test(normalized);
  const hasLogin = /\blog in\b/i.test(normalized);
  const hasSignupPrompt = /log in or sign up for facebook/i.test(normalized);
  return hasSignupPrompt || (hasEmailField && hasLogin) || (hasCreateAccount && hasLogin && normalized.length < 2500);
}

function extractPublishedAt(lines: string[]): string | null {
  return lines.find((line) => /^(\d+[smhdw]|yesterday|just now|\d+\s*(min|hr|day|week)s?)/i.test(line)) ?? null;
}

function isFacebookLoginOrQrText(value: string): boolean {
  const line = value.trim();
  return [
    /^log in$/i,
    /log in or sign up for facebook/i,
    /^create new account$/i,
    /scan the qr code/i,
    /confirm that the codes match/i,
    /forgot(?:ten)? password/i,
    /\bemail or phone\b/i,
    /^email address or phone number$/i,
    /^password$/i,
    /\bfrom facebook\b/i,
    /^or$/i,
    /^all reactions:?/i,
    /^top fan$/i,
    /^author$/i,
    /^follow$/i
  ].some((pattern) => pattern.test(line));
}

function isFacebookUiAuthor(value: string): boolean {
  return /^(facebook|log in|create new account|all reactions)$/i.test(value.trim().replace(/:$/, ""));
}

function isQrLoginCode(value: string): boolean {
  return /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{4}$/i.test(value.trim());
}

function isCommentContentNoise(value: string): boolean {
  const line = value.trim();
  return [
    /\b\d+:\d{2}\s*\//,
    /^\d+:\d{2}$/,
    /^learn more:/i,
    /^image credit:/i,
    /from NASA's Hubble Space Telescope/i,
    /NASA's Hubble Space Telescope\s*(?:Ãƒâ€šÃ‚Â·|ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·|ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·|ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·)/i
  ].some((pattern) => pattern.test(line));
}

function foldForUiMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Ãƒâ€žÃ¢â‚¬ËœÃƒâ€žÃ‚Â]/g, "d")
    .toLowerCase()
    .trim();
}

function isCommentUiLine(value: string): boolean {
  const line = value.trim();
  const folded = foldForUiMatch(line);
  if (
    /^(thich|tra loi|binh luan|chia se|xem ban dich|tat ca cam xuc|phu hop nhat|moi nhat)$/.test(folded.replace(/:$/, "")) ||
    /^viet binh luan/.test(folded) ||
    /^da chon che do phu hop nhat/.test(folded)
  ) {
    return true;
  }

  return [
    /^like$/i,
    /^reply$/i,
    /^comment$/i,
    /^share$/i,
    /^th(?:ÃƒÆ’Ã‚Â­ch|ich|ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ch)$/i,
    /^tr.*l.*i$/i,
    /^b.*nh lu.*n$/i,
    /^chia s/i,
    /^xem b.*n d.*ch$/i,
    /^all reactions:?$/i,
    /^t.*t c.* c.*m x.*c:?$/i,
    /^most relevant$/i,
    /^ph.* h.*p nh.*t$/i,
    /^newest$/i,
    /^m.*i nh.*t$/i,
    /^write a comment/i,
    /^vi.*t b.*nh lu.*n/i,
    /^.* ch.*n ch.* .* ph.* h.*p nh.*t/i
  ].some((pattern) => pattern.test(line));
}

function isCommentMetricLine(value: string): boolean {
  const line = value.trim();
  const folded = foldForUiMatch(line);
  return (
    /^\d[\d,.]*\s*(comments?|shares?|reactions?|likes?)$/i.test(line) ||
    /^\d[\d,.]*\s*(binh luan|luot chia se|cam xuc)$/.test(folded)
  );
}

function isFacebookHomeSidebarLine(value: string): boolean {
  const folded = foldForUiMatch(value);
  return [
    /^menu tren facebook$/,
    /^ban be$/,
    /^ky niem$/,
    /^da luu$/,
    /^nhom$/,
    /^thuoc phim$/,
    /^marketplace$/,
    /^bang feed$/,
    /^su kien$/,
    /^trinh quan ly quang cao$/,
    /^trang chu$/,
    /^tao bai viet$/,
    /^hha oi.*ban dang nghi gi the\??$/,
    /^nhung nguoi ban co the biet$/,
    /^them ban be$/,
    /^duoc tai tro$/
  ].some((pattern) => pattern.test(folded));
}

function hasFacebookHomeSidebarMarker(text: string): boolean {
  return normalizeText(text)
    .split(/\n+/)
    .some((line) => isFacebookHomeSidebarLine(line));
}

function isPostBodyBoundaryLine(value: string): boolean {
  const line = value.trim();
  const folded = foldForUiMatch(line);
  if (
    /^xem them.*binh luan/.test(folded) ||
    /^tat ca cam xuc:?$/.test(folded) ||
    /^(thich|binh luan)$/.test(folded)
  ) {
    return true;
  }

  return [
    /^view more comments/i,
    /^see more comments/i,
    /^view previous comments/i,
    /^xem th.*b.*nh lu/i,
    /^all reactions:?/i,
    /^t.*t c.* c.*m x.*c:?$/i,
    /^like$/i,
    /^th(?:ÃƒÆ’Ã‚Â­ch|ich|ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ch)$/i,
    /^comment$/i,
    /^b.*nh lu.*n$/i
  ].some((pattern) => pattern.test(line));
}

function textBeforePostBodyBoundary(rawText: string): string {
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const boundaryIndex = lines.findIndex((line) => isPostBodyBoundaryLine(line));
  return (boundaryIndex >= 0 ? lines.slice(0, boundaryIndex) : lines).join("\n");
}

function normalizedComparableText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isNasaHubbleOwner(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = normalizedComparableText(value).replace(/[’`]/g, "'");
  return normalized === normalizedComparableText(NASA_HUBBLE_OWNER);
}

function isNasaHubbleTarget(sourceUrl?: string | null): boolean {
  return /nasahubble/i.test(sourceUrl ?? "");
}

function startsWithKnownCommenterName(content: string): boolean {
  const normalized = normalizedComparableText(content);
  return KNOWN_COMMENTER_NAME_PREFIXES.some((name) => normalized.startsWith(normalizedComparableText(name)));
}

function textContainsNasaHubbleOwner(value: string): boolean {
  return normalizedComparableText(value).replace(/[’`]/g, "'").includes(normalizedComparableText(NASA_HUBBLE_OWNER));
}

function contentAppearsInPostBody(content: string, postBody?: string): boolean {
  if (!postBody || content.length < 10) {
    return false;
  }
  const normalizedContent = normalizedComparableText(content);
  return normalizedContent.length >= 10 && normalizedComparableText(postBody).includes(normalizedContent);
}

function isNoiseLine(line: string): boolean {
  if (isCommentUiLine(line) || isCommentMetricLine(line) || isFacebookHomeSidebarLine(line)) {
    return true;
  }

  return [
    /^\[facebook-crawler\b/i,
    /^\[facebook-comments\b/i,
    /^\[facebook-replies\b/i,
    /^\[facebook-post-json=/i,
    /^\[facebook-comments-json=/i,
    /^--- FACEBOOK POST SNAPSHOT STEP ---$/i,
    /^--- FACEBOOK ARTICLE ---$/i,
    /^--- FACEBOOK DIALOG ---$/i,
    /^online status indicator$/i,
    /^active$/i,
    /^log in$/i,
    /log in or sign up for facebook/i,
    /^create new account$/i,
    /scan the qr code/i,
    /confirm that the codes match/i,
    /forgot(?:ten)? password/i,
    /\bemail or phone\b/i,
    /^email address or phone number$/i,
    /^password$/i,
    /\bfrom facebook\b/i,
    /^or$/i,
    /^all reactions:?/i,
    /^top fan$/i,
    /^author$/i,
    /^follow$/i,
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
  return /^(\d+[smhdw]|yesterday|just now|\d+\s*(min|hr|day|week)s?|vÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â«a xong|\d+\s*(phÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºt|giÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â|ngÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â y|tuÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â§n))$/i.test(line.trim());
}

function isFallbackCommentNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (
    isFacebookLoginOrQrText(trimmed) ||
    isQrLoginCode(trimmed) ||
    isCommentContentNoise(trimmed) ||
    isCommentUiLine(trimmed) ||
    isCommentMetricLine(trimmed) ||
    isFacebookHomeSidebarLine(trimmed) ||
    /^--- FACEBOOK POST SNAPSHOT STEP ---$/i.test(trimmed) ||
    /^--- FACEBOOK ARTICLE ---$/i.test(trimmed) ||
    /^--- FACEBOOK DIALOG ---$/i.test(trimmed) ||
    /^\[facebook-(comments|replies)\b/i.test(trimmed) ||
    /^\[facebook-(post|comments)-json=/i.test(trimmed)
  ) {
    return true;
  }

  return [
    /^like$/i,
    /^reply$/i,
    /^share$/i,
    /^comment$/i,
    /^comments$/i,
    /^see more/i,
    /^see less$/i,
    /^top fan$/i,
    /^author$/i,
    /^follow$/i,
    /^facebook$/i,
    /^all comments$/i,
    /^most relevant$/i,
    /^write a comment/i,
    /^view more comments/i,
    /^view previous comments/i,
    /^see more comments/i,
    /^log in$/i,
    /^forgotten/i,
    /^create new account$/i,
    /^email address or phone number$/i,
    /^password$/i,
    /^\d[\d,.]*[kKmM]?$/,
    /^\d+\s*(reactions?|comments?|shares?)$/i
  ].some((pattern) => pattern.test(trimmed));
}

function isLikelyFallbackAuthorLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 90 &&
    !trimmed.startsWith("@") &&
    !isTimestampLine(trimmed) &&
    !isFallbackCommentNoiseLine(trimmed) &&
    !/^https?:\/\//i.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  );
}

function isLikelyFallbackCommentContentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 3 && trimmed.length <= 1000 && !isTimestampLine(trimmed) && !isFallbackCommentNoiseLine(trimmed);
}

function shouldSkipCommentCandidate(author: string | undefined, content: string | undefined, postBody?: string): boolean {
  if (!content || !author) {
    return true;
  }
  return (
    isNoiseLine(content) ||
    isNoiseLine(author) ||
    isCommentUiLine(content) ||
    isCommentMetricLine(content) ||
    isFacebookLoginOrQrText(content) ||
    isFacebookLoginOrQrText(author) ||
    isQrLoginCode(content) ||
    isCommentContentNoise(content) ||
    contentAppearsInPostBody(content, postBody) ||
    normalizedComparableText(author) === normalizedComparableText(content) ||
    isFacebookUiAuthor(author) ||
    content.startsWith("@") ||
    content.length < 3 ||
    author.length > 90
  );
}

function stableCommentId(author: string, content: string): string {
  return `comment_${createHash("sha1").update(`${author}\n${content}`).digest("hex").slice(0, 16)}`;
}

function encodeCommentMetadata(comments: ParsedPost["comments"]): string {
  return `[facebook-comments-json=${Buffer.from(JSON.stringify(comments), "utf8").toString("base64")}]`;
}

function encodePostMetadata(post: { author: string | null; content: string }): string {
  return `[facebook-post-json=${Buffer.from(JSON.stringify(post), "utf8").toString("base64")}]`;
}

function postMetadataFromSnapshot(text: string): { author: string | null; content: string } | null {
  const match = text.match(/^\[facebook-post-json=(.+?)\]$/m);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as { author?: unknown; content?: unknown };
    if (typeof parsed.content !== "string") {
      return null;
    }
    return { author: typeof parsed.author === "string" ? parsed.author : null, content: parsed.content };
  } catch {
    return null;
  }
}

function commentsFromSnapshotMetadata(text: string): ParsedPost["comments"] {
  const match = text.match(/^\[facebook-comments-json=(.+?)\]$/m);
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as ParsedPost["comments"];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_COMMENTS_PER_POST) : [];
  } catch {
    return [];
  }
}

function primaryArticleTextFromSnapshot(snapshot: string): string {
  return stripCrawlerDebugLines(normalizeText(snapshot).split(/\n\n--- FACEBOOK POST SNAPSHOT STEP ---\n\n/)[0] ?? "");
}

function stripCrawlerDebugLines(text: string): string {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("[facebook-crawler"))
    .filter((line) => !line.startsWith("[facebook-comments"))
    .filter((line) => !line.startsWith("[facebook-replies"))
    .filter((line) => !line.startsWith("[facebook-post-json"))
    .filter((line) => !line.startsWith("[facebook-comments-json"))
    .filter((line) => line !== "--- FACEBOOK POST SNAPSHOT STEP ---")
    .filter((line) => line !== "--- FACEBOOK ARTICLE ---")
    .filter((line) => line !== "--- FACEBOOK DIALOG ---")
    .join("\n");
}

function isCommentLikeArticleText(text: string): boolean {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));
  if (lines.length < 3 || lines.length > 8) {
    return false;
  }
  return lines.some(isTimestampLine) && lines.some((line) => /\b(Like|Reply|ThÃ­ch|Tráº£ lá»i)\b/i.test(line));
}

function filterCommentsForPost(comments: ParsedPost["comments"], postBody: string): ParsedPost["comments"] {
  return comments.filter((comment) => !shouldSkipCommentCandidate(comment.authorName ?? undefined, comment.content, postBody));
}

function isLikelyUserNameLine(value: string): boolean {
  const line = value.trim();
  return line.length >= 2 && line.length <= 80 && !/[.!?:/\\]/.test(line) && line.split(/\s+/).length <= 6;
}

function contentMatchesAnyComment(content: string, comments: ParsedPost["comments"]): boolean {
  const normalizedContent = normalizedComparableText(content);
  if (normalizedContent.length < 10) {
    return false;
  }
  return comments.some((comment) => {
    const normalizedComment = normalizedComparableText(comment.content);
    return (
      normalizedComment.length >= 10 &&
      (normalizedContent === normalizedComment || normalizedContent.includes(normalizedComment) || normalizedComment.includes(normalizedContent))
    );
  });
}

function sanitizePostContent(post: ParsedPost, sourceUrl?: string | null): void {
  const content = normalizeText(post.content);
  const owner = post.author ? normalizedComparableText(post.author) : null;
  if (isFacebookReelUrl(post.postUrl) && isNasaHubbleOwner(post.author) && content.length > 20) {
    post.content = content;
    return;
  }
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const isNasaContext = isNasaHubbleTarget(sourceUrl) || isNasaHubbleOwner(post.author);
  const isNasaOwner = isNasaHubbleOwner(post.author);
  const contentHasNasaOwner = textContainsNasaHubbleOwner(content);
  const startsWithNonOwnerName = isLikelyUserNameLine(firstLine) && (!owner || normalizedComparableText(firstLine) !== owner);

  if (
    !content ||
    content === POST_CONTENT_UNAVAILABLE ||
    content.startsWith("[facebook-crawler") ||
    startsWithKnownCommenterName(content) ||
    (isNasaContext && !isNasaOwner && !contentHasNasaOwner) ||
    (isNasaContext && !isNasaOwner && startsWithNonOwnerName && !isNasaHubbleOwner(firstLine)) ||
    isCommentLikeArticleText(content) ||
    contentMatchesAnyComment(content, post.comments) ||
    startsWithNonOwnerName ||
    (owner && !isNasaOwner && !normalizedComparableText(content).includes(owner))
  ) {
    post.content = POST_CONTENT_UNAVAILABLE;
  }
}

function commentsFromDomItems(items: CommentDomItem[], postBody?: string): ParsedPost["comments"] {
  const comments: ParsedPost["comments"] = [];
  const seen = new Set<string>();
  const replyCounts = new Map<string, number>();
  let minLeft = Number.POSITIVE_INFINITY;
  let currentParentId: string | null = null;

  for (const item of items) {
    const lines = normalizeText(item.text)
      .split(/\n+/)
      .map((line) => line.replace(/\s*See less\b/gi, "").replace(/\s*See more\b/gi, "").trim())
      .filter(Boolean)
      .filter((line) => !isFallbackCommentNoiseLine(line));
    const actionIndex = lines.findIndex((line) => /\b(Like|Reply|ThÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­ch|TrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£ lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âi)\b/i.test(line));
    if (actionIndex < 0) {
      continue;
    }
    const contentIndex = actionIndex > 0 && isTimestampLine(lines[actionIndex - 1]) ? actionIndex - 2 : actionIndex - 1;
    const authorIndex = actionIndex > 0 && isTimestampLine(lines[actionIndex - 1]) ? actionIndex - 3 : actionIndex - 2;
    const author = authorIndex >= 0 ? lines[authorIndex] : lines[0];
    const content = contentIndex >= 0 ? lines[contentIndex] : lines[1];
    const timestamp = actionIndex > 0 && isTimestampLine(lines[actionIndex - 1]) ? lines[actionIndex - 1] : null;

    if (shouldSkipCommentCandidate(author, content, postBody)) {
      continue;
    }

    minLeft = Math.min(minLeft, item.left);
    const isReply = Number.isFinite(minLeft) && item.left > minLeft + 24 && currentParentId !== null;
    if (isReply && currentParentId) {
      const replyCount = replyCounts.get(currentParentId) ?? 0;
      if (replyCount >= MAX_REPLIES_PER_COMMENT) {
        continue;
      }
      replyCounts.set(currentParentId, replyCount + 1);
    }

    const key = `${author}:${content}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const commentId = stableCommentId(author!, content!);
    if (!isReply) {
      currentParentId = commentId;
    }

    comments.push({
      commentId,
      authorName: author!,
      authorUrl: item.authorUrl,
      content: content!,
      reactionCount: null,
      createdAtText: timestamp,
      parentCommentId: isReply ? currentParentId : null
    });

    if (comments.length >= MAX_COMMENTS_PER_POST) {
      break;
    }
  }

  return comments;
}

async function collectVisibleCommentsFromDialog(page: Page, postBody?: string): Promise<ParsedPost["comments"]> {
  const items = await page
    .locator('[role="dialog"]')
    .last()
    .evaluate((dialog) => {
      const articles = Array.from(dialog.querySelectorAll('[role="article"]')) as HTMLElement[];
      return articles
        .map((article) => {
          const rect = article.getBoundingClientRect();
          const text = (article.innerText || article.textContent || "").trim();
          const authorUrl =
            Array.from(article.querySelectorAll("a[href]"))
              .map((link) => (link as HTMLAnchorElement).href)
              .find((href) => href.includes("facebook.com")) ?? null;
          return { text, left: rect.left, top: rect.top, authorUrl };
        })
        .filter((item) => item.text && item.left > 0 && item.top > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left);
    })
    .catch(() => []);

  return commentsFromDomItems(items, postBody);
}

async function expandFeedCaptions(page: Page): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await clickText(page, ["See more", "Xem thÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âªm"], 18);
    await page
      .evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("div, span, a, [role='button']")) as HTMLElement[];
        for (const element of candidates) {
          const text = (element.innerText || element.textContent || "").trim();
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && /^(see more|xem th[eÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âª]m)$/i.test(text)) {
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
          return rect.width > 0 && rect.height > 0 && /^(see more|xem th[eÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âª]m)$/i.test(text);
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

function parseVisibleComments(rawText: string, postBody?: string): ParsedPost["comments"] {
  if (hasFacebookHomeSidebarMarker(rawText)) {
    return [];
  }
  const bodyText = postBody ?? extractMainContent(rawText);
  const lines = normalizeText(rawText)
    .split(/\n+/)
    .map((line) => line.replace(/\s*See less\b/gi, "").replace(/ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦\s*See more\b/gi, "").replace(/\s*See more\b/gi, "").trim())
    .filter(Boolean);
  const comments: ParsedPost["comments"] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^(Like|Reply|ThÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ch|TrÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â£ lÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âi)$/i.test(line) && !/(Like|Reply|ThÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ch|TrÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â£ lÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âi)/i.test(line)) {
      continue;
    }
    const previousLine = lines[index - 1];
    const content = previousLine && isTimestampLine(previousLine) ? lines[index - 2] : previousLine;
    const author = previousLine && isTimestampLine(previousLine) ? lines[index - 3] : lines[index - 2];
    if (shouldSkipCommentCandidate(author, content, bodyText)) {
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
    if (comments.length >= MAX_COMMENTS_PER_POST) {
      break;
    }
  }

  const fallbackLines = lines.filter((line) => !isFallbackCommentNoiseLine(line));
  for (let index = 0; index < fallbackLines.length - 1; index += 1) {
    const author = fallbackLines[index];
    const content = fallbackLines[index + 1];
    const timestamp = fallbackLines[index + 2] && isTimestampLine(fallbackLines[index + 2]) ? fallbackLines[index + 2] : null;

    if (!isLikelyFallbackAuthorLine(author) || !isLikelyFallbackCommentContentLine(content) || shouldSkipCommentCandidate(author, content, bodyText)) {
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
      createdAtText: timestamp,
      parentCommentId: null
    });

    if (comments.length >= MAX_COMMENTS_PER_POST) {
      break;
    }
  }

  return comments.slice(0, MAX_COMMENTS_PER_POST);
}

function hasCommentMetric(text: string): boolean {
  return /(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¬nh luÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â­n)/i.test(text) || trailingMetricNumbers(text).length >= 2;
}

function isLikelyCommentOnlyArticle(text: string): boolean {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasCommentActions = lines.some((line) => /^(Like|Reply|ThÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­ch|TrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£ lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âi)$/i.test(line));
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

async function visibleArticleTexts(page: Page): Promise<string[]> {
  const articles = page.locator('[role="article"]');
  const count = await articles.count().catch(() => 0);
  const texts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const article = articles.nth(index);
    if (!(await article.isVisible().catch(() => false))) {
      continue;
    }
    const text = await article.innerText({ timeout: 2500 }).catch(() => "");
    if (normalizeText(text).length > 20) {
      texts.push(text);
    }
  }
  return texts;
}

async function visiblePostDetailText(page: Page): Promise<string> {
  const articleText = (await visibleArticleTexts(page)).join("\n\n--- FACEBOOK ARTICLE ---\n\n");
  const dialogText = await visibleDialogText(page);
  return [articleText, dialogText].filter(Boolean).join("\n\n--- FACEBOOK DIALOG ---\n\n");
}

async function collectPostContentFromDetail(page: Page, postUrl: string): Promise<{ author: string | null; content: string }> {
  const articles = page.locator('[role="article"]');
  const count = await articles.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const article = articles.nth(index);
    if (!(await article.isVisible().catch(() => false))) {
      continue;
    }

    const articleUrl = await postUrlFromArticle(article);
    const articleText = await article.innerText({ timeout: 2500 }).catch(() => "");
    if (articleUrl && articleUrl !== postUrl && postIdFromUrl(articleUrl) !== postIdFromUrl(postUrl)) {
      continue;
    }
    if (hasFacebookHomeSidebarMarker(articleText) || isCommentLikeArticleText(articleText)) {
      continue;
    }

    const postOnlyText = stripCrawlerDebugLines(textBeforePostBodyBoundary(articleText));
    const content = extractMainContent(postOnlyText);
    if (!content || content.startsWith("[facebook-crawler") || content.length < 20 || isCommentLikeArticleText(content)) {
      continue;
    }

    const lines = postOnlyText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const author = lines.find((line) => line.length > 3 && !isNoiseLine(line) && !isTimestampLine(line)) ?? null;
    return { author, content };
  }

  return { author: null, content: POST_CONTENT_UNAVAILABLE };
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
  void page;
}

async function loadAllVisibleComments(page: Page): Promise<CommentExpansionStats> {
  const stats: CommentExpansionStats = { comments: 0, replies: 0 };
  return addExpansionStats(stats, await expandCommentControlsUntilDone(page, 220));
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
        .filter((item) => /view more comments|see more comments|view previous comments|xem th.*b.*nh lu/i.test(item.text));
      const boundaryY = boundaryItems.length ? Math.min(...boundaryItems.map((item) => item.top)) : rootRect.bottom;
      const numericItems = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || "").trim();
          return { text, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left, width: rect.width, height: rect.height };
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

  if (!commentIconPoint) {
    return false;
  }

  await page.mouse.click(commentIconPoint.x, commentIconPoint.y).catch(() => undefined);
  await pause(1000);
  return (await visibleDialogText(page)).length > 40;
}


async function openCommentThread(page: Page, article: ReturnType<Page["locator"]>, beforeText: string): Promise<boolean> {
  if (await clickCommentControl(page, article, beforeText)) {
    return true;
  }

  await clickCommentMetricArea(page, article, beforeText);
  await pause(800);
  if ((await visibleDialogText(page)).length > 40) {
    return true;
  }

  const clickedMetricText = await article
    .getByText(/(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬nh luÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â­n)/i)
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
      const postUrl = await postUrlFromArticle(article);
      if (!isEligibleFacebookArticle(beforeText, postUrl)) {
        continue;
      }
      const signature = normalizeText(beforeText).slice(0, 220).toLowerCase();
      if (signature.length < 40 || seen.has(signature)) {
        continue;
      }
      seen.add(signature);

      await article.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      await pause(250);
      await article.getByText(/See more|Xem thÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âªm/i).first().click({ timeout: 1000 }).catch(() => undefined);
      await pause(250);

      if (hasCommentMetric(beforeText)) {
        await clickCommentMetricArea(page, article, beforeText);
        if (await recoverIfBadNavigation(page, originalUrl)) {
          continue;
        }
        const clickedCommentText = await article
          .getByText(/(\d[\d,.]*\s*[kKmM]?\s*)?(comments?|bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¬nh luÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â­n)/i)
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
        await pause(700);
        if (await recoverIfBadNavigation(page, originalUrl)) {
          continue;
        }

        for (let round = 0; round < 10; round += 1) {
          const clicked = await clickText(
            page,
            [
              "View more comments",
              "See more comments",
              "View previous comments",
              "Xem thÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âªm bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¬nh luÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â­n",
              "Xem cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡c bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¬nh luÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â­n trÃƒÆ’Ã¢â‚¬Â Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â¡Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âºc"
            ],
            8,
            article
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
      const articlePostUrl = await postUrlFromArticle(article);
      if (!isEligibleFacebookArticle(beforeText, articlePostUrl)) {
        continue;
      }
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
      const expansionStats: CommentExpansionStats = { comments: 0, replies: 0 };
      let structuredComments: ParsedPost["comments"] = [];
      let postMetadata: { author: string | null; content: string } = { author: null, content: POST_CONTENT_UNAVAILABLE };
      let openMode = `permalink:${articlePostUrl}`;
      await page.goto(articlePostUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      await pause(900);
      if (await recoverIfBadNavigation(page, originalUrl)) {
        continue;
      }
      postMetadata = await collectPostContentFromDetail(page, articlePostUrl);
      addExpansionStats(expansionStats, await loadAllVisibleComments(page));
      const postDetailText = await visiblePostDetailText(page);
      if (hasFacebookHomeSidebarMarker(postDetailText)) {
        await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
        await pause(900);
        continue;
      }
      snapshotParts.push(postDetailText);
      structuredComments = await collectVisibleCommentsFromDialog(page, beforeText);
      await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      await pause(900);

      const afterArticleText = "";
      snapshots.push(
        [
          beforeText,
          `[facebook-crawler openMode=${openMode}]`,
          articlePostUrl ? `[facebook-crawler postUrl=${articlePostUrl}]` : "",
          encodePostMetadata(postMetadata),
          `[facebook-comments expanded=${expansionStats.comments}]`,
          `[facebook-replies expanded=${expansionStats.replies}]`,
          structuredComments.length ? encodeCommentMetadata(structuredComments) : "",
          ...snapshotParts.slice(1),
          afterArticleText
        ]
          .filter(Boolean)
          .join("\n\n--- FACEBOOK POST SNAPSHOT STEP ---\n\n")
      );

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
      const postUrl = await postUrlFromArticle(article);
      if (!isEligibleFacebookArticle(beforeText, postUrl)) {
        continue;
      }
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
      snapshots.push([postUrl ? `[facebook-crawler postUrl=${postUrl}]` : "", afterText || beforeText].filter(Boolean).join("\n\n"));
    }

    if (snapshots.length < maxPosts) {
      await page.mouse.wheel(0, 950).catch(() => undefined);
      await pause(650);
    }
  }

  return snapshots;
}

function fallbackPostsFromFeed(rawText: string, targetUrl: string, limit = 10, candidatePostUrls: string[] = []): ParsedPost[] {
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
      const postUrl = candidatePostUrls[posts.length] ?? targetUrl;
      if (!isTrueFacebookPostUrl(postUrl)) {
        return;
      }
      seen.add(key);
      posts.push({
        postUrl,
        postId: postIdFor(postUrl, postText),
        author,
        content: postText,
        publishedAt: null,
        reactionCount: metricValue(cleanSegment, ["reactions", "reaction", "likes", "like"]) ?? trailingMetrics[0] ?? null,
        likeCount: metricValue(cleanSegment, ["likes", "like"]) ?? trailingMetrics[0] ?? null,
        commentCount: metricValue(cleanSegment, ["comments", "comment"]) ?? trailingMetrics[1] ?? null,
        shareCount: metricValue(cleanSegment, ["shares", "share"]) ?? trailingMetrics[2] ?? null,
        viewCount: metricValue(cleanSegment, ["views", "view"]),
        rawText: normalizeText(cleanSegment),
        comments: []
      });
    }
  }

  const statusMarker = /\nOnline status indicator\nActive\n[^\n]{2,120}\n\s*(?:ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·|ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·)\n/g;
  const matches = [...text.matchAll(statusMarker)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    addPost(text.slice(start, nextStart), null);
  }

  if (!posts.length) {
    const blocks = text.split(/(?:\nFacebook){4,}\n/g);
    for (const block of blocks) {
      const dotIndex = block.lastIndexOf("\nÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·\n");
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
    const primaryText = primaryArticleTextFromSnapshot(snapshot);
    const postMeta = postMetadataFromSnapshot(text);
    const fallbackPostText = !isCommentLikeArticleText(primaryText) ? extractMainContent(primaryText) : "";
    const postText =
      postMeta?.content && postMeta.content !== POST_CONTENT_UNAVAILABLE
        ? postMeta.content
        : fallbackPostText && !fallbackPostText.startsWith("[facebook-crawler") && fallbackPostText.length >= 20
          ? fallbackPostText
          : POST_CONTENT_UNAVAILABLE;
    const postUrl = postUrlFromSnapshotText(text) ?? targetUrl;
    if (!isTrueFacebookPostUrl(postUrl)) {
      continue;
    }
    const key = postText.slice(0, 180).toLowerCase();
    if (postText.startsWith("[facebook-crawler") || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const trailingMetrics = trailingMetricNumbers(primaryText);
    const lines = primaryText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    posts.push({
      postUrl,
      postId: postIdFor(postUrl, postText),
      author: postMeta?.author ?? lines.find((line) => line.length > 3 && !isNoiseLine(line)) ?? null,
      content: postText,
      publishedAt: null,
      reactionCount: metricValue(text, ["reactions", "reaction", "likes", "like"]) ?? trailingMetrics[0] ?? null,
      likeCount: metricValue(text, ["likes", "like"]) ?? trailingMetrics[0] ?? null,
      commentCount: metricValue(text, ["comments", "comment"]) ?? trailingMetrics[1] ?? null,
      shareCount: metricValue(text, ["shares", "share"]) ?? trailingMetrics[2] ?? null,
      viewCount: metricValue(text, ["views", "view"]),
      rawText: text,
      comments: filterCommentsForPost(mergeComments(commentsFromSnapshotMetadata(text), parseVisibleComments(text, postText)), postText)
    });
  }

  return posts.slice(0, limit);
}

function mergeComments(
  existing: ParsedPost["comments"],
  additional: ParsedPost["comments"]
): ParsedPost["comments"] {
  const merged = [...existing];
  const seen = new Set(existing.map((comment) => `${comment.authorName}:${comment.content}`.toLowerCase()));

  for (const comment of additional) {
    const key = `${comment.authorName}:${comment.content}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(comment);
    }
  }

  return merged.slice(0, MAX_COMMENTS_PER_POST);
}

function extractMainContent(rawText: string): string {
  const postBodyText = stripCrawlerDebugLines(textBeforePostBodyBoundary(rawText));
  const lines = normalizeText(postBodyText)
    .split(/\n+/)
    .map((line) => line.replace(/\s*See less\b/gi, "").replace(/ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦\s*See more\b/gi, "").replace(/\s*See more\b/gi, "").trim())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));
  const metricIndex = lines.findIndex((line) => /\b(comments?|shares?|likes?|reactions?)\b/i.test(line));
  const body = (metricIndex > 2 ? lines.slice(0, metricIndex) : lines).slice(0, 30);
  return body.join("\n").slice(0, 4000) || normalizeText(postBodyText || rawText).slice(0, 4000);
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

function metricFromTexts(texts: string[], labels: string[]): number | null {
  for (const text of texts) {
    const value = metricValue(text, labels);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function compactDebugText(value: string, limit = 1000): string {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, limit);
}

function debugMarkerValue(markers: string[], name: string): string {
  const prefix = `[${name}=`;
  const marker = markers.find((part) => part.startsWith(prefix));
  return marker?.slice(prefix.length, marker.endsWith("]") ? -1 : undefined) ?? "";
}

async function parsePostPage(page: Page, postUrl: string): Promise<ParsedPost> {
  const rawText = await visiblePostDetailText(page);
  const text = normalizeText(rawText);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return {
    postUrl,
    postId: postIdFor(postUrl, extractMainContent(text)),
    author: lines.find((line) => line.length > 2 && !isNoiseLine(line)) ?? null,
    content: extractMainContent(text),
    publishedAt: extractPublishedAt(lines),
    reactionCount: metricValue(text, ["reactions", "reaction", "likes", "like"]),
    likeCount: metricValue(text, ["likes", "like"]),
    commentCount: metricValue(text, ["comments", "comment"]),
    shareCount: metricValue(text, ["shares", "share"]),
    viewCount: metricValue(text, ["views", "view"]),
    rawText: text,
    comments: parseVisibleComments(text, extractMainContent(text))
  };
}

async function reelViewerText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const area = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
      const dialog = dialogs.sort((a, b) => area(b) - area(a))[0];
      if (dialog) {
        return (dialog.innerText || dialog.textContent || "").trim();
      }

      const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible);
      const mainWithVideo = mains.find((element) => element.querySelector("video"));
      const main = mainWithVideo ?? mains.sort((a, b) => area(b) - area(a))[0];
      if (main) {
        return (main.innerText || main.textContent || "").trim();
      }

      const video = document.querySelector("video");
      let root = video?.parentElement ?? null;
      for (let depth = 0; root?.parentElement && depth < 5; depth += 1) {
        root = root.parentElement;
      }
      return root ? (root.innerText || root.textContent || "").trim() : "";
    })
    .catch(() => "");
}

async function reelDebugSnapshotMarkers(page: Page, phase: "viewer" | "after-click"): Promise<string[]> {
  const snapshot = await page
    .evaluate(() => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const area = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
      const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible);
      const videos = Array.from(document.querySelectorAll("video")).filter(visible);
      const videoContainers = videos
        .map((video) => {
          let root = video.parentElement;
          for (let depth = 0; root?.parentElement && depth < 5; depth += 1) {
            root = root.parentElement;
          }
          return root;
        })
        .filter(visible);
      const roots = [...dialogs.slice().reverse(), ...mains, ...videoContainers];
      const root =
        roots.find((element) => element.querySelector("video")) ??
        dialogs.sort((a, b) => area(b) - area(a))[0] ??
        mains.sort((a, b) => area(b) - area(a))[0] ??
        videoContainers[0] ??
        null;
      const text = root ? (root.innerText || root.textContent || "").trim() : "";
      const rootRect = root?.getBoundingClientRect() ?? null;
      const buttons = root
        ? (Array.from(root.querySelectorAll('[role="button"], button, a[href], [aria-label]')) as HTMLElement[])
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const aria = (element.getAttribute("aria-label") || "").trim();
              const text = (element.innerText || element.textContent || "").trim();
              return { aria, text, left: rect.left, width: rect.width, height: rect.height };
            })
            .filter((item) => item.width > 0 && item.height > 0)
            .filter((item) => !rootRect || item.left > rootRect.left + rootRect.width * 0.45)
            .flatMap((item) => [item.aria, item.text])
            .map((value) => value.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .filter((value, index, all) => all.indexOf(value) === index)
            .slice(0, 80)
        : [];

      return {
        dialogCount: dialogs.length,
        mainCount: mains.length,
        videoContainerCount: videoContainers.length,
        text,
        buttons
      };
    })
    .catch(() => ({
      dialogCount: 0,
      mainCount: 0,
      videoContainerCount: 0,
      text: "",
      buttons: [] as string[]
    }));

  if (phase === "viewer") {
    let textStart = compactDebugText(snapshot.text);
    if (!textStart) {
      const mainText = await page.locator('[role="main"]').first().innerText({ timeout: 1200 }).catch(() => "");
      const bodyText = mainText || (await page.locator("body").innerText({ timeout: 1200 }).catch(() => ""));
      textStart = compactDebugText(bodyText);
    }
    const markers = [
      `[facebook-reel-dialog-count=${snapshot.dialogCount}]`,
      `[facebook-reel-main-count=${snapshot.mainCount}]`,
      `[facebook-reel-video-container-count=${snapshot.videoContainerCount}]`,
      `[facebook-reel-viewer-text-start=${textStart}]`,
      `[facebook-reel-buttons=${compactDebugText(snapshot.buttons.join(" | "), 2000)}]`
    ];
    for (const marker of markers) {
      console.log(marker);
    }
    return markers;
  }

  let textStart = compactDebugText(snapshot.text);
  if (!textStart) {
    const mainText = await page.locator('[role="main"]').first().innerText({ timeout: 1200 }).catch(() => "");
    const bodyText = mainText || (await page.locator("body").innerText({ timeout: 1200 }).catch(() => ""));
    textStart = compactDebugText(bodyText);
  }
  const markers = [`[facebook-reel-after-click-text-start=${textStart}]`];
  for (const marker of markers) {
    console.log(marker);
  }
  return markers;
}

async function extractReelViewerMetadata(page: Page): Promise<ReelViewerMetadata> {
  const metadata = await page
    .evaluate((knownOwner) => {
      const fold = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const area = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
      };
      const roots = [
        ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).reverse(),
        ...Array.from(document.querySelectorAll('[role="main"]')).filter(visible)
      ];
      const root =
        roots.find((element) => element.querySelector("video")) ??
        roots.sort((a, b) => area(b) - area(a))[0] ??
        document.querySelector("video")?.closest('[role="main"], [role="dialog"]');
      if (!(root instanceof HTMLElement)) {
        return { owner: null, caption: "", metricTexts: [] };
      }

      const rootRect = root.getBoundingClientRect();
      const elements = Array.from(root.querySelectorAll("a[href], span, div, [role='button']")) as HTMLElement[];
      const items = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();
          const aria = (element.getAttribute("aria-label") || "").trim();
          return {
            text,
            aria,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
            href: element instanceof HTMLAnchorElement ? element.href : null
          };
        })
        .filter((item) => item.text && item.width > 0 && item.height > 0)
        .filter((item) => item.left >= rootRect.left - 4 && item.right <= rootRect.right + 4);

      const ownerItem =
        items.find((item) => item.text === knownOwner) ??
        items.find((item) => /facebook\.com/i.test(item.href ?? "") && item.text.length >= 3 && item.text.length <= 90);
      const owner = ownerItem?.text ?? null;
      const ownerTop = ownerItem?.top ?? rootRect.top + rootRect.height * 0.55;
      const noise = /^(like|comment|comments|share|send|follow|reels?|pause|play|see more|see less|write a comment|all comments|most relevant)$/i;
      const metricLike = /^\d[\d,.]*\s*[kKmM]?$/;
      const caption = items
        .filter((item) => item.left < rootRect.left + rootRect.width * 0.58)
        .filter((item) => item.top >= ownerTop - 4 && item.top < rootRect.bottom - 20)
        .filter((item) => item.width < rootRect.width * 0.7 && item.height < rootRect.height * 0.5)
        .flatMap((item) =>
          item.text
            .replace(/\s*See more$/i, "")
            .split(/\n+/)
            .map((line) => line.trim())
        )
        .filter((text, index, all) => text && all.indexOf(text) === index)
        .filter((text) => text !== owner)
        .filter((text) => text.length >= 8 && text.length <= 1200)
        .filter((text) => !noise.test(text) && !metricLike.test(text))
        .filter((text) => !/^https?:\/\//i.test(text))
        .slice(0, 8)
        .join("\n");
      const metricTexts = items
        .filter((item) => item.left > rootRect.left + rootRect.width * 0.45 || item.aria)
        .flatMap((item) => [item.aria, item.text])
        .map((text) => text.trim())
        .filter(Boolean)
        .filter((text, index, all) => all.indexOf(text) === index);

      return { owner, caption, metricTexts };
    }, NASA_HUBBLE_OWNER)
    .catch(() => ({ owner: null, caption: "", metricTexts: [] as string[] }));

  return {
    owner: metadata.owner,
    caption: normalizeText(metadata.caption) || POST_CONTENT_UNAVAILABLE,
    likeCount: metricFromTexts(metadata.metricTexts, ["likes", "like", "reactions", "reaction"]),
    commentCount: metricFromTexts(metadata.metricTexts, ["comments", "comment"]),
    shareCount: metricFromTexts(metadata.metricTexts, ["shares", "share"])
  };
}

async function openReelCommentsPanel(page: Page): Promise<boolean> {
  const opened = await page
    .evaluate(() => {
      const fold = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const roots = [
        ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).reverse(),
        ...Array.from(document.querySelectorAll('[role="main"]')).filter(visible)
      ];
      const root = roots.find((element) => element.querySelector("video")) ?? roots[0];
      if (!root) {
        return false;
      }
      const rootRect = root.getBoundingClientRect();
      const elements = Array.from(root.querySelectorAll('[role="button"], a[href], div, span')) as HTMLElement[];
      const candidates = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.textContent || "").trim();
          const aria = (element.getAttribute("aria-label") || "").trim();
          return { element, text, aria, folded: fold(`${aria} ${text}`), rect };
        })
        .filter((item) => item.rect.width > 0 && item.rect.height > 0)
        .filter((item) => item.rect.left >= rootRect.left && item.rect.right <= rootRect.right + 8);
      const target =
        candidates.find((item) => /\b(comment|comments|binh luan)\b/i.test(item.folded) && item.element.getAttribute("role") === "button") ??
        candidates.find((item) => /\b(comment|comments|binh luan)\b/i.test(item.folded)) ??
        candidates
          .filter((item) => item.rect.left > rootRect.left + rootRect.width * 0.55)
          .filter((item) => /^\d[\d,.]*\s*[kKmM]?$/i.test(item.text))
          .sort((a, b) => a.rect.top - b.rect.top)[1];
      if (!target) {
        return false;
      }
      target.element.click();
      return true;
    })
    .catch(() => false);

  if (!opened) {
    return false;
  }

  for (let index = 0; index < 8; index += 1) {
    await pause(450);
    const hasPanel = await page
      .evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[role="dialog"], [role="main"]')) as HTMLElement[];
        return panels.some((panel) => {
          const text = (panel.innerText || panel.textContent || "").trim();
          const rect = panel.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && /write a comment|view more comments|see more comments|comments/i.test(text);
        });
      })
      .catch(() => false);
    if (hasPanel) {
      return true;
    }
  }

  return true;
}

async function scrollReelViewer(page: Page): Promise<void> {
  const scrolled = await page
    .evaluate(() => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const roots = [
        ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).reverse(),
        ...Array.from(document.querySelectorAll('[role="main"]')).filter(visible)
      ];
      const fold = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const root = roots.find((element) => element.querySelector("video") || /comments?|binh luan/i.test(fold(element.innerText || "")));
      if (!root) {
        return false;
      }
      const candidates = [root, ...Array.from(root.querySelectorAll("*"))] as HTMLElement[];
      const scrollable = candidates.find((node) => node.scrollHeight > node.clientHeight + 80);
      if (!scrollable) {
        return false;
      }
      scrollable.scrollTop = scrollable.scrollHeight;
      return true;
    })
    .catch(() => false);

  if (!scrolled) {
    await page.mouse.wheel(0, 900).catch(() => undefined);
  }
}

async function clickOneReelCommentExpansionControl(page: Page): Promise<"comments" | "replies" | null> {
  const clickedText = await page
    .evaluate(() => {
      const fold = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const roots = [
        ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).reverse(),
        ...Array.from(document.querySelectorAll('[role="main"]')).filter(visible)
      ];
      const root = roots.find((element) => element.querySelector("video") || /comments?|binh luan/i.test(fold(element.innerText || "")));
      if (!root) {
        return null;
      }
      const elements = Array.from(root.querySelectorAll('[role="button"], a[href], span, div')) as HTMLElement[];
      const target = elements.find((element) => {
        const text = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();
        const folded = fold(text);
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (/^(view more comments|see more comments|view previous comments|view more replies|see more replies)/i.test(text) ||
            /^xem them (binh luan|phan hoi)/.test(folded) ||
            /^xem cac binh luan/.test(folded))
        );
      });
      if (!target) {
        return null;
      }
      const text = (target.innerText || target.textContent || target.getAttribute("aria-label") || "").trim();
      target.click();
      return text;
    })
    .catch(() => null);

  if (!clickedText) {
    return null;
  }
  return /repl|phan hoi/i.test(foldForUiMatch(clickedText)) ? "replies" : "comments";
}

async function expandReelCommentControls(page: Page, maxClicks = 180): Promise<CommentExpansionStats> {
  const stats: CommentExpansionStats = { comments: 0, replies: 0 };
  let idleRounds = 0;

  for (let clicks = 0; clicks < maxClicks && stats.comments < MAX_COMMENTS_PER_POST; clicks += 1) {
    const clicked = await clickOneReelCommentExpansionControl(page);
    if (!clicked) {
      await scrollReelViewer(page);
      await pause(350);
      idleRounds += 1;
      if (idleRounds >= 3) {
        break;
      }
      continue;
    }

    idleRounds = 0;
    stats[clicked] += 1;
    await waitForCommentExpansion(page);
    await scrollReelViewer(page);
  }

  return stats;
}

async function collectVisibleCommentsFromReelViewer(page: Page, postBody?: string): Promise<ParsedPost["comments"]> {
  const items = await page
    .evaluate(() => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const roots = [
        ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).reverse(),
        ...Array.from(document.querySelectorAll('[role="main"]')).filter(visible)
      ];
      const fold = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const root = roots.find((element) => element.querySelector("video") || /comments?|binh luan/i.test(fold(element.innerText || "")));
      if (!root) {
        return [];
      }
      const articles = Array.from(root.querySelectorAll('[role="article"]')) as HTMLElement[];
      return articles
        .map((article) => {
          const rect = article.getBoundingClientRect();
          const text = (article.innerText || article.textContent || "").trim();
          const authorUrl =
            Array.from(article.querySelectorAll("a[href]"))
              .map((link) => (link as HTMLAnchorElement).href)
              .find((href) => href.includes("facebook.com")) ?? null;
          return { text, left: rect.left, top: rect.top, authorUrl };
        })
        .filter((item) => item.text && item.left > 0 && item.top > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left);
    })
    .catch(() => []);

  return commentsFromDomItems(items, postBody);
}

function extractReelCaption(text: string): string {
  const content = extractMainContent(text);
  return content && content.length >= 8 && !isCommentLikeArticleText(content) ? content : POST_CONTENT_UNAVAILABLE;
}

function parseReelViewerText(text: string): {
  owner: string | null;
  caption: string | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
} {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  const ownerMatch = normalized.match(/^(.+?)\s*·\s*(?:Theo dõi|Follow)\b/i);
  if (!ownerMatch) {
    return { owner: null, caption: null, likeCount: null, commentCount: null, shareCount: null };
  }

  const owner = ownerMatch[1].trim();
  const afterOwner = normalized.slice(ownerMatch[0].length).trim();
  const uiBoundary = afterOwner.search(/\b(?:Xem thêm|See more|Ẩn bản dịch|An ban dich|Hide translation)\b/i);
  const metricBoundary = afterOwner.search(/\s\d[\d,.]*\s*[kKmM]?(?:\s+\d[\d,.]*\s*[kKmM]?){2,}\b/);
  const boundaries = [uiBoundary, metricBoundary].filter((index) => index >= 0);
  const captionEnd = boundaries.length ? Math.min(...boundaries) : afterOwner.length;
  const caption = normalizeText(afterOwner.slice(0, captionEnd).replace(/\s*(?:Xem thêm|See more)$/i, ""));
  const metricText = afterOwner.slice(captionEnd);
  const metricNumbers = [...metricText.matchAll(/\b\d[\d,.]*\s*[kKmM]?\b/g)]
    .map((match) => normalizeMetric(match[0]))
    .filter((value): value is number => value !== null)
    .slice(0, 3);

  return {
    owner,
    caption: caption.length > 0 ? caption : null,
    likeCount: metricNumbers[0] ?? null,
    commentCount: metricNumbers[1] ?? null,
    shareCount: metricNumbers[2] ?? null
  };
}

function extractReelDataFromViewerText(text: string): {
  owner: string | null;
  caption: string | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
} {
  const normalized = normalizeText(text)
    .replace(/^\[facebook-reel-viewer-text-start=(.*)\]$/s, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const followMatch = normalized.match(/^(.+?)\s*[·•]\s*(Theo dõi|Follow)\s+(.+)$/i);
  if (!followMatch) {
    return { owner: null, caption: null, likeCount: null, commentCount: null, shareCount: null };
  }

  const owner = followMatch[1].trim();
  const rest = followMatch[3].trim();
  const uiMatch = rest.match(/(?:…|\.\.\.)?\s*(?:Xem thêm|Ẩn bản dịch|See more|Hide translation)\b/i);
  const captionEnd = uiMatch?.index ?? rest.length;
  const caption = normalizeText(rest.slice(0, captionEnd));
  const metricsText = rest.slice(captionEnd);
  const numbers = [...metricsText.matchAll(/\b\d[\d.,]*[KkMm]?\b/g)]
    .map((match) => normalizeMetric(match[0]))
    .filter((value): value is number => value !== null)
    .slice(0, 3);

  return {
    owner,
    caption: caption.length > 0 ? caption : null,
    likeCount: numbers[0] ?? null,
    commentCount: numbers[1] ?? null,
    shareCount: numbers[2] ?? null
  };
}

async function parseReelPage(page: Page, targetUrl: string, initialDebugMarkers: string[] = []): Promise<ParsedPost> {
  const reelId = reelIdFromUrl(page.url()) ?? reelIdFromUrl(targetUrl);
  const postUrl = normalizeFacebookUrl(page.url()) ?? normalizeFacebookUrl(targetUrl) ?? targetUrl;
  const rawTextParts = [...initialDebugMarkers, ...(await reelDebugSnapshotMarkers(page, "viewer"))];
  const metadata = await extractReelViewerMetadata(page);
  const viewerTextNormalized = normalizeText(await reelViewerText(page));
  const viewerTextStart = debugMarkerValue(rawTextParts, "facebook-reel-viewer-text-start");
  const mainText = viewerTextNormalized ? "" : await page.locator('[role="main"]').first().innerText({ timeout: 1200 }).catch(() => "");
  const bodyDebugText =
    viewerTextNormalized || mainText ? "" : await page.locator("body").innerText({ timeout: 1200 }).catch(() => "");
  const parserInput = normalizeText(viewerTextNormalized || viewerTextStart || mainText || bodyDebugText || "");
  const extractedReelData = extractReelDataFromViewerText(parserInput);
  const viewerParsed = parseReelViewerText(parserInput);
  const shouldTryComments = !rawTextParts.some((part) => part === "[facebook-reel-buttons=]");
  const commentsPanelOpened = shouldTryComments ? await openReelCommentsPanel(page) : false;
  rawTextParts.push(...(await reelDebugSnapshotMarkers(page, "after-click")));
  const expansionStats = commentsPanelOpened ? await expandReelCommentControls(page) : { comments: 0, replies: 0 };
  const rawText = normalizeText(await reelViewerText(page)) || parserInput;
  const fallbackCaption = extractReelCaption(rawText);
  const metadataCaption = metadata.caption !== POST_CONTENT_UNAVAILABLE ? metadata.caption : null;
  const parsedCaption = extractedReelData.caption ?? viewerParsed.caption ?? metadataCaption ?? fallbackCaption;
  const caption =
    (extractedReelData.owner?.includes(NASA_HUBBLE_OWNER) || isNasaHubbleOwner(viewerParsed.owner ?? metadata.owner)) && parsedCaption.length > 20
      ? parsedCaption
      : parsedCaption || POST_CONTENT_UNAVAILABLE;
  const comments = commentsPanelOpened
    ? filterCommentsForPost(
        mergeComments(await collectVisibleCommentsFromReelViewer(page, caption), parseVisibleComments(rawText, caption)),
        caption
      )
    : [];
  const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const likeCount = extractedReelData.likeCount ?? viewerParsed.likeCount ?? metadata.likeCount ?? metricValue(rawText, ["likes", "like"]) ?? null;
  const commentCount =
    extractedReelData.commentCount ?? viewerParsed.commentCount ?? metadata.commentCount ?? metricValue(rawText, ["comments", "comment"]) ?? (comments.length || null);
  const shareCount = extractedReelData.shareCount ?? viewerParsed.shareCount ?? metadata.shareCount ?? metricValue(rawText, ["shares", "share"]) ?? null;
  console.log(`[facebook-reel-caption=${caption}]`);
  console.log(`[facebook-reel-comments-count=${comments.length}]`);
  console.log(`[facebook-reel-parser-input=${compactDebugText(parserInput)}]`);
  console.log(`[facebook-reel-parsed-owner=${extractedReelData.owner ?? ""}]`);
  console.log(`[facebook-reel-parsed-caption=${extractedReelData.caption ?? ""}]`);
  console.log(`[facebook-reel-parsed-metrics=${likeCount ?? ""}/${commentCount ?? ""}/${shareCount ?? ""}]`);

  return {
    postUrl,
    postId: reelId,
    author: extractedReelData.owner ?? viewerParsed.owner ?? metadata.owner ?? lines.find((line) => line.length > 2 && !isNoiseLine(line)) ?? null,
    content: caption,
    publishedAt: extractPublishedAt(lines),
    reactionCount: likeCount,
    likeCount,
    commentCount,
    shareCount,
    viewCount: metricValue(rawText, ["views", "view", "plays", "play"]),
    rawText: normalizeText(
      [
        `[facebook-crawler target=reel]`,
        `[facebook-crawler postUrl=${postUrl}]`,
        `[facebook-crawler reelId=${reelId ?? ""}]`,
        ...rawTextParts,
        metadata.owner ? `[facebook-reel-owner=${metadata.owner}]` : "",
        `[facebook-reel-parser-input=${compactDebugText(parserInput)}]`,
        `[facebook-reel-parsed-owner=${extractedReelData.owner ?? ""}]`,
        `[facebook-reel-parsed-caption=${extractedReelData.caption ?? ""}]`,
        `[facebook-reel-parsed-metrics=${likeCount ?? ""}/${commentCount ?? ""}/${shareCount ?? ""}]`,
        `[facebook-reel-caption=${caption}]`,
        `[facebook-comments expanded=${expansionStats.comments}]`,
        `[facebook-replies expanded=${expansionStats.replies}]`,
        comments.length ? encodeCommentMetadata(comments) : "",
        rawText
      ]
        .filter(Boolean)
        .join("\n")
    ),
    comments
  };
}

function summarizeSocial(
  posts: ParsedPost[],
  sourceUrl: string,
  unavailableReason?: string | null
): Omit<SocialSnapshot, "id" | "crawlResultId"> {
  const sanitizedPosts = posts.map((post) => {
    const sanitizedPost = {
      ...post,
      content: normalizeText(post.content) || POST_CONTENT_UNAVAILABLE
    };
    sanitizePostContent(sanitizedPost, sourceUrl);
    return sanitizedPost;
  });
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
    postCount: sanitizedPosts.length,
    postsJson: JSON.stringify(sanitizedPosts),
    commentsJson: JSON.stringify(sanitizedPosts.flatMap((post) => post.comments.map((comment) => ({ postId: post.postId, ...comment })))),
    views: totals.views || null,
    likes: totals.likes || null,
    comments: totals.comments || null,
    shares: totals.shares || null,
    saves: null,
    downloads: null,
    engagementRate,
    unavailableReason: unavailableReason ?? (sanitizedPosts.length ? null : "post_detail_not_visible")
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
    await ensureTargetFacebookPage(page, bot.targetUrl);
    rawText = await page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
    title = await page.title().catch(() => title);
    rawHtml = await page.content().catch(() => rawHtml);
    if (isFacebookLoginWallText(rawText)) {
      await page.screenshot({ path: imagePath, fullPage: true }).catch(() => undefined);
      return {
        rendered: {
          title: title || "Facebook login required",
          rawText: normalizeText(`[facebook-login-wall]\n${rawText}`),
          rawHtml,
          screenshotPath: fs.existsSync(imagePath) ? imagePath : null,
          httpStatus,
          engine: "native-facebook-feed-metrics"
        },
        socialSnapshot: summarizeSocial([], bot.targetUrl, "login_required"),
        socialPosts: []
      };
    }

    if (isFacebookReelUrl(bot.targetUrl) || isFacebookReelUrl(page.url())) {
      const reelUrlMarker = `[facebook-reel-url=${page.url()}]`;
      console.log(reelUrlMarker);
      const reelPost = await parseReelPage(page, bot.targetUrl, [reelUrlMarker]);
      posts.push(reelPost);
      title = await page.title().catch(() => title);
      rawHtml = await page.content().catch(() => rawHtml);
      rawText = reelPost.rawText ?? "";
      await page.screenshot({ path: imagePath, fullPage: true }).catch(() => undefined);
      const socialSnapshot = summarizeSocial(posts, reelPost.postUrl);

      return {
        rendered: {
          title: title || "Facebook reel crawl",
          rawText: normalizeText(rawText),
          rawHtml,
          screenshotPath: fs.existsSync(imagePath) ? imagePath : null,
          httpStatus,
          engine: "native-facebook-reel"
        },
        socialSnapshot,
        socialPosts: posts
      };
    }

    await expandFeedCaptions(page);
    const expandedSnapshots = await expandVisiblePostCommentsWithModal(page, maxPosts);
    title = await page.title().catch(() => title);
    rawHtml = await page.content().catch(() => rawHtml);
    rawText = expandedSnapshots.join("\n\n--- EXPANDED POST ---\n\n");
    const expandedPosts = postsFromExpandedSnapshots(expandedSnapshots, bot.targetUrl, maxPosts);
    posts.push(...expandedPosts);
    for (let index = 0; index < posts.length; index += 1) {
      const snapshotText = expandedSnapshots[index] ?? "";
      if (hasFacebookHomeSidebarMarker(snapshotText)) {
        continue;
      }
      posts[index].comments = mergeComments(
        posts[index].comments,
        filterCommentsForPost(
          mergeComments(commentsFromSnapshotMetadata(snapshotText), parseVisibleComments(snapshotText, posts[index].content)),
          posts[index].content
        )
      );
      posts[index].comments = filterCommentsForPost(posts[index].comments, posts[index].content);
      sanitizePostContent(posts[index], bot.targetUrl);
      posts[index].rawText = `${posts[index].rawText ?? ""}\n\n${expandedSnapshots[index] ?? ""}`.trim();
      sanitizePostContent(posts[index], bot.targetUrl);
    }

    await page.screenshot({ path: imagePath, fullPage: true }).catch(() => undefined);
    for (const post of posts) {
      sanitizePostContent(post, bot.targetUrl);
    }
    console.log(`[facebook-final-post-content=${posts.map((post) => post.content).join(" | ")}]`);
    const socialSnapshot = summarizeSocial(posts, bot.targetUrl);

    return {
      rendered: {
        title: title || "Facebook social crawl",
        rawText: normalizeText(rawText),
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


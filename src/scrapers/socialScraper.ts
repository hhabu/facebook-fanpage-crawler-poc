import type { SocialSnapshot } from "../lib/scraperTypes";
import type { RenderedPage } from "../browser/browserEngine";

interface ExtractedSocialComment {
  author: string | null;
  text: string;
}

interface ExtractedSocialPost {
  index: number;
  text: string;
  permalink: string | null;
  comments: ExtractedSocialComment[];
}

function parseMetric(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`([0-9][0-9,.]*\\s*[kKmM]?)\\s+${label}|${label}\\s*[:\\-]?\\s*([0-9][0-9,.]*\\s*[kKmM]?)`, "i");
    const match = text.match(pattern);
    const value = match?.[1] ?? match?.[2];
    if (value) {
      return normalizeMetric(value);
    }
  }

  return null;
}

function normalizeMetric(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  const multiplier = trimmed.endsWith("k") ? 1000 : trimmed.endsWith("m") ? 1000000 : 1;
  const numeric = Number(trimmed.replace(/[km]/g, "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
}

function computeEngagement(snapshot: Omit<SocialSnapshot, "engagementRate">): number | null {
  if (!snapshot.views || snapshot.views <= 0) {
    return null;
  }

  const interactions = (snapshot.likes ?? 0) + (snapshot.comments ?? 0) + (snapshot.shares ?? 0) + (snapshot.saves ?? 0);
  return Number(((interactions / snapshot.views) * 100).toFixed(2));
}

function unavailableReason(snapshot: Omit<SocialSnapshot, "engagementRate" | "unavailableReason">): string | null {
  const hasMetric =
    [snapshot.views, snapshot.likes, snapshot.comments, snapshot.shares, snapshot.saves, snapshot.downloads].some(
      (value) => value !== null
    ) || Boolean(snapshot.postCount);
  return hasMetric ? null : "metric_not_visible";
}

function normalizeLine(value: string): string {
  return value.replace(/\u00a0/g, " ").trim();
}

function isNoiseLine(line: string): boolean {
  return [
    /^facebook$/i,
    /^active$/i,
    /^online status indicator$/i,
    /^see translation$/i,
    /^see less$/i,
    /^messenger$/i,
    /^send message$/i,
    /^write a comment/i,
    /^view more comments/i,
    /^author$/i,
    /^like$/i,
    /^reply$/i,
    /^filters$/i,
    /^posts$/i,
    /^photos$/i,
    /^all comments$/i,
    /^most relevant$/i,
    /^top comments$/i,
    /^\d+$/,
    /^\d+[wdhm]$/i,
    /^\d+:\d+\s*\/\s*\d+:\d+$/
  ].some((pattern) => pattern.test(line));
}

function cleanTextBlock(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/…\s*See more/gi, "")
    .replace(/\bSee more\b/gi, "")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 1)
    .filter((line) => !isNoiseLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractedPosts(rendered: RenderedPage): ExtractedSocialPost[] {
  const value = rendered.extractedData?.facebookPosts;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const post = item as { index?: unknown; text?: unknown; permalink?: unknown; comments?: unknown };
      const text = typeof post.text === "string" ? cleanTextBlock(post.text) : "";
      if (!text) {
        return null;
      }
      return {
        index: typeof post.index === "number" ? post.index : index + 1,
        text,
        permalink: typeof post.permalink === "string" ? post.permalink : null,
        comments: Array.isArray(post.comments) ? (post.comments as ExtractedSocialComment[]) : []
      } satisfies ExtractedSocialPost;
    })
    .filter((item): item is ExtractedSocialPost => item !== null);
}

function extractCommentsFromSegment(segment: string): ExtractedSocialComment[] {
  const commentsStart = segment.search(/\n(?:View more comments|Most relevant|All comments|Author)\n/i);
  if (commentsStart < 0) {
    return [];
  }

  const commentArea = segment.slice(commentsStart);
  const end = commentArea.search(/\n(?:Write a comment|Facebook\nFacebook|Online status indicator|Posts\nFilters)\n/i);
  const lines = (end >= 0 ? commentArea.slice(0, end) : commentArea)
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 1)
    .filter((line) => !isNoiseLine(line));

  const comments: ExtractedSocialComment[] = [];
  let buffer: string[] = [];
  let author: string | null = null;

  for (const line of lines) {
    if (line.startsWith("@") || /^@\S+/.test(line)) {
      continue;
    }
    if (/^\d+[wdhm]$/i.test(line)) {
      if (buffer.length) {
        comments.push({ author, text: cleanTextBlock(buffer.join("\n")) });
      }
      buffer = [];
      author = null;
      continue;
    }
    if (!author && line.length <= 80 && !/[.!?。！？]$/.test(line)) {
      author = line;
      continue;
    }
    buffer.push(line);
  }

  if (buffer.length) {
    comments.push({ author, text: cleanTextBlock(buffer.join("\n")) });
  }

  return comments.filter((comment) => comment.text.length >= 2).slice(0, 20);
}

function extractPostTextFromSegment(segment: string): string {
  const endMatch = segment.search(/\n(?:Write a comment|View more comments|Most relevant|All comments|Author|Facebook\nFacebook|Posts\nFilters|Privacy\n|Details\n)/i);
  return cleanTextBlock(endMatch >= 0 ? segment.slice(0, endMatch) : segment);
}

function extractedPostsFromRawText(rawText: string): ExtractedSocialPost[] {
  const text = rawText.replace(/\r\n/g, "\n");
  const marker = /\nOnline status indicator\nActive\n[^\n]{2,120}\n\s*(?:·|Â·)\n/g;
  const matches = [...text.matchAll(marker)];
  const posts: ExtractedSocialPost[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const segment = text.slice(start, nextStart);
    const candidate = extractPostTextFromSegment(segment);
    const key = candidate.slice(0, 180).toLowerCase();
    if (candidate.length >= 20 && !seen.has(key)) {
      seen.add(key);
      posts.push({
        index: posts.length + 1,
        text: candidate,
        permalink: null,
        comments: extractCommentsFromSegment(segment)
      });
    }
  }

  return posts.slice(0, 10);
}

function flattenComments(posts: ExtractedSocialPost[]): Array<ExtractedSocialComment & { postIndex: number }> {
  return posts.flatMap((post) =>
    post.comments.map((comment) => ({
      postIndex: post.index,
      ...comment
    }))
  );
}

export function extractSocialFromRendered(sourceUrl: string, rendered: RenderedPage): SocialSnapshot {
  const text = rendered.rawText || rendered.rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const domPosts = extractedPosts(rendered);
  const rawPosts = domPosts.length ? domPosts : extractedPostsFromRawText(text);
  const comments = flattenComments(rawPosts);
  const partial = {
    platform: new URL(sourceUrl).hostname,
    postCount: rawPosts.length,
    postsJson: rawPosts.length ? JSON.stringify(rawPosts) : null,
    commentsJson: comments.length ? JSON.stringify(comments) : null,
    views: parseMetric(text, ["views", "view", "luot xem"]),
    likes: parseMetric(text, ["likes", "like", "thich"]),
    comments: parseMetric(text, ["comments", "comment", "binh luan"]),
    shares: parseMetric(text, ["shares", "share", "chia se"]),
    saves: parseMetric(text, ["saves", "save", "luu"]),
    downloads: parseMetric(text, ["downloads", "download", "tai xuong"])
  };

  return {
    ...partial,
    engagementRate: computeEngagement(partial),
    unavailableReason: unavailableReason(partial)
  };
}

export async function scrapeSocial(sourceUrl: string): Promise<SocialSnapshot> {
  const response = await fetch(sourceUrl, { headers: { "user-agent": "MultiBotMVP/0.1" } });
  const html = await response.text();
  return extractSocialFromRendered(sourceUrl, {
    url: sourceUrl,
    title: null,
    rawHtml: html,
    rawText: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    screenshotPath: null,
    httpStatus: response.status,
    engine: "fetch"
  });
}

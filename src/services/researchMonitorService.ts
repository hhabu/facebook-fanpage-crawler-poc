import { analyzeScrapeResult } from "./aiAnalysisService";
import { createBot, getBots } from "./botService";
import { saveCrawlResult } from "./crawlResultService";
import { getDb } from "../lib/db";
import type { ArticleSnapshot } from "../lib/scraperTypes";

export interface ResearchMonitorInput {
  query?: string;
  limit?: number;
}

export interface ResearchMonitorItem {
  crawlResultId: number;
  title: string;
  url: string;
  publishedAt: string | null;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstTag(item: string, tag: string): string | null {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1].trim()) : null;
}

function normalizeGoogleNewsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("url") || url;
  } catch {
    return url;
  }
}

export async function runResearchMonitor(input: ResearchMonitorInput = {}): Promise<ResearchMonitorItem[]> {
  const query =
    input.query?.trim() ||
    "Vietnam logistics shipping policy tax customs import export vận chuyển chính sách thuế";
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
  const bot =
    getBots().find((item) => item.name === "Daily Logistics Policy Monitor") ||
    createBot({
      name: "Daily Logistics Policy Monitor",
      type: "article",
      targetUrl: rssUrl,
      targetDomain: "news.google.com",
      browserProfile: "daily-logistics-policy-monitor",
      scheduleCron: "0 8 * * *",
      status: "active"
    });

  const response = await fetch(rssUrl, { headers: { "user-agent": "MultiBotMVP/0.1" } });
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit);

  const output: ResearchMonitorItem[] = [];

  for (const match of items) {
    const item = match[1];
    const title = firstTag(item, "title") || "Untitled logistics update";
    const link = normalizeGoogleNewsUrl(firstTag(item, "link") || rssUrl);
    const publishedAt = firstTag(item, "pubDate");
    const description = firstTag(item, "description") || title;
    const articleSnapshot: ArticleSnapshot = {
      title,
      publishDate: publishedAt,
      author: firstTag(item, "source"),
      content: description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      imagesJson: null
    };
    const existing = getDb()
      .prepare("SELECT id FROM crawl_results WHERE url = ? AND type = 'article' AND status = 'success' LIMIT 1")
      .get(link) as { id: number } | undefined;

    if (existing) {
      output.push({
        crawlResultId: existing.id,
        title,
        url: link,
        publishedAt
      });
      continue;
    }

    const analysisResult = analyzeScrapeResult(bot, articleSnapshot);
    const crawlResult = saveCrawlResult({
      botId: bot.id,
      type: "article",
      url: link,
      title,
      rawText: articleSnapshot.content,
      rawHtml: item,
      status: "success",
      articleSnapshot,
      analysisResult
    });

    output.push({
      crawlResultId: crawlResult.id,
      title,
      url: link,
      publishedAt
    });
  }

  return output;
}

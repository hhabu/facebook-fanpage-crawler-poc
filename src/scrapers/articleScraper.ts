import type { ArticleSnapshot } from "../lib/scraperTypes";
import type { RenderedPage } from "../browser/browserEngine";

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1].trim());
    }
  }

  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
}

export function extractArticleFromRendered(rendered: RenderedPage): ArticleSnapshot {
  const html = rendered.rawHtml;

  const title =
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    ]) ?? "Untitled article";

  const publishDate =
    firstMatch(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<time[^>]+datetime=["']([^"']+)["']/i,
      /"datePublished"\s*:\s*"([^"]+)"/i
    ]) ?? null;

  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 40)
    .slice(0, 12);

  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((src) => !src.startsWith("data:"))
    .slice(0, 8);

  return {
    title,
    publishDate,
    author: null,
    content: paragraphs.join("\n\n") || rendered.rawText || stripTags(html).replace(/\s+/g, " ").trim().slice(0, 2000),
    imagesJson: JSON.stringify(images)
  };
}

export async function scrapeArticle(sourceUrl: string): Promise<ArticleSnapshot> {
  const response = await fetch(sourceUrl, { headers: { "user-agent": "MultiBotMVP/0.1" } });
  const html = await response.text();
  return extractArticleFromRendered({
    url: sourceUrl,
    title: null,
    rawHtml: html,
    rawText: stripTags(html).replace(/\s+/g, " ").trim(),
    screenshotPath: null,
    httpStatus: response.status,
    engine: "fetch"
  });
}

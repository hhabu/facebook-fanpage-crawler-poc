import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "./browserProfileManager";
import type { BrowserEngine, RenderedPage } from "./browserEngine";

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  return (
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ??
    null
  );
}

export class FetchEngine implements BrowserEngine {
  name = "fetch";

  async render(bot: Bot, _profile: BrowserProfileRuntime): Promise<RenderedPage> {
    const response = await fetch(bot.targetUrl, {
      headers: {
        "user-agent": bot.userAgent || "MultiBotProductionCrawler/0.2",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const rawHtml = await response.text();

    return {
      url: bot.targetUrl,
      title: extractTitle(rawHtml),
      rawHtml,
      rawText: stripTags(rawHtml),
      screenshotPath: null,
      httpStatus: response.status,
      engine: this.name
    };
  }
}

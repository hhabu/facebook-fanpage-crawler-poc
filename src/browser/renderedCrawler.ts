import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "./browserProfileManager";
import { detectBlockPage } from "./blockDetection";
import type { BrowserEngine, RenderedPage } from "./browserEngine";
import { CloakBrowserEngine } from "./cloakBrowserEngine";
import { FetchEngine } from "./fetchEngine";
import { NativeChromeEngine } from "./nativeChromeEngine";
import { PlaywrightEngine } from "./playwrightEngine";

export interface RenderedCrawlResult extends RenderedPage {
  blocked: boolean;
  blockReason: string | null;
  fallbackUsed: boolean;
}

function shouldPreferBrowser(bot: Bot): boolean {
  return bot.browserEngine === "cloak" || bot.browserEngine === "playwright" || bot.type === "product" || bot.type === "social";
}

function engineFor(bot: Bot): BrowserEngine {
  if (bot.browserEngine === "fetch") {
    return new FetchEngine();
  }
  if (bot.browserEngine === "playwright") {
    return new PlaywrightEngine();
  }
  if (bot.browserEngine === "cloak") {
    return new CloakBrowserEngine();
  }
  if (bot.targetDomain.includes("facebook.com") || bot.targetDomain.includes("fb.watch")) {
    return new NativeChromeEngine();
  }
  if (shouldPreferBrowser(bot)) {
    return new CloakBrowserEngine();
  }
  return new FetchEngine();
}

export async function renderTarget(bot: Bot, profile: BrowserProfileRuntime): Promise<RenderedCrawlResult> {
  const primary = engineFor(bot);
  let rendered: RenderedPage;
  let fallbackUsed = false;

  try {
    rendered = await primary.render(bot, profile);
  } catch (error) {
    if (primary.name === "fetch" || bot.browserEngine !== "auto") {
      throw error;
    }
    fallbackUsed = true;
    rendered = await new FetchEngine().render(bot, profile);
  }

  const block = detectBlockPage(rendered.rawText, rendered.rawHtml);
  return {
    ...rendered,
    blocked: block.blocked,
    blockReason: block.reason,
    fallbackUsed
  };
}

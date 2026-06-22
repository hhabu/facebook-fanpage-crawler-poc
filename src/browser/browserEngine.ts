import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "./browserProfileManager";

export interface RenderedPage {
  url: string;
  title: string | null;
  rawHtml: string;
  rawText: string;
  screenshotPath: string | null;
  httpStatus: number | null;
  engine: string;
  extractedData?: Record<string, unknown>;
}

export interface BrowserEngine {
  name: string;
  render(bot: Bot, profile: BrowserProfileRuntime): Promise<RenderedPage>;
}

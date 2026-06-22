import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "./browserProfileManager";
import type { BrowserEngine, RenderedPage } from "./browserEngine";
import { CloakBrowserEngine } from "./cloakBrowserEngine";

/*
 * PlaywrightEngine currently delegates to CloakBrowserEngine because the project
 * installs playwright-core without bundled browsers. Keeping this class gives us
 * the requested abstraction and a clean place to wire a managed Chromium path.
 */
export class PlaywrightEngine implements BrowserEngine {
  name = "playwright";

  async render(bot: Bot, profile: BrowserProfileRuntime): Promise<RenderedPage> {
    const rendered = await new CloakBrowserEngine().render(bot, profile);
    return { ...rendered, engine: this.name };
  }
}

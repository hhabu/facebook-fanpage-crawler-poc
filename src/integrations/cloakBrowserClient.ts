import type { Bot } from "../lib/botTypes";
import type { BrowserProfileRuntime } from "../browser/browserProfileManager";
import { getConfig } from "../config/env";
import fs from "node:fs";

/*
 * Source repo: https://github.com/CloakHQ/CloakBrowser
 * Reuse reason: CloakBrowser publishes an MIT-licensed npm package with Playwright-compatible
 * launchPersistentContext/buildLaunchOptions APIs. We import the package at runtime instead of
 * copying its launcher, binary download, fingerprint, proxy, and humanization code.
 */

export interface CloakBrowserLaunchPlan {
  provider: "cloakbrowser";
  userDataDir: string;
  headless: boolean;
  proxy?: string;
  locale?: string;
  timezone?: string;
  humanize: boolean;
  targetDomain: string;
  args: string[];
  executablePath?: string;
  stealthArgs: boolean;
}

type CloakBrowserModule = {
  launchPersistentContext?: (options: Record<string, unknown>) => Promise<unknown>;
  buildLaunchOptions?: (options?: Record<string, unknown>) => Record<string, unknown>;
};

async function importCloakBrowser(): Promise<CloakBrowserModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<CloakBrowserModule>;
  return dynamicImport("cloakbrowser");
}

export function buildCloakBrowserLaunchPlan(
  bot: Bot,
  profile: BrowserProfileRuntime,
  env: NodeJS.ProcessEnv = process.env
): CloakBrowserLaunchPlan {
  const config = getConfig();
  const chromePath = env.NATIVE_CHROME_PATH?.trim();
  const useNativeChrome = Boolean(chromePath && fs.existsSync(chromePath));
  return {
    provider: "cloakbrowser",
    userDataDir: profile.userDataDir,
    headless: env.CLOAK_HEADLESS ? env.CLOAK_HEADLESS !== "false" : config.cloakHeadless,
    proxy: env.CLOAK_PROXY || config.cloakProxy || undefined,
    locale: env.CLOAK_LOCALE || config.cloakLocale || undefined,
    timezone: env.CLOAK_TIMEZONE || config.cloakTimezone || undefined,
    humanize: bot.targetDomain.includes("facebook.com")
      ? false
      : env.CLOAK_HUMANIZE
      ? env.CLOAK_HUMANIZE === "true"
      : config.cloakHumanize,
    targetDomain: bot.targetDomain,
    args: useNativeChrome ? [] : ["--disable-quic", "--disable-features=UseDnsHttpsSvcbAlpn,EncryptedClientHello"],
    executablePath: useNativeChrome ? chromePath : undefined,
    stealthArgs: !useNativeChrome
  };
}

export async function isCloakBrowserAvailable(): Promise<boolean> {
  try {
    const module = await importCloakBrowser();
    return typeof module.launchPersistentContext === "function";
  } catch {
    return false;
  }
}

export async function launchCloakPersistentContext(plan: CloakBrowserLaunchPlan): Promise<unknown> {
  const module = await importCloakBrowser();
  if (typeof module.launchPersistentContext !== "function") {
    throw new Error("cloakbrowser launchPersistentContext API is unavailable.");
  }

  return module.launchPersistentContext({
    userDataDir: plan.userDataDir,
    headless: plan.headless,
    proxy: plan.proxy,
    locale: plan.locale,
    timezone: plan.timezone,
    humanize: plan.humanize,
    args: plan.args,
    stealthArgs: plan.stealthArgs,
    geoip: false,
    launchOptions: plan.executablePath ? { executablePath: plan.executablePath } : undefined
  });
}

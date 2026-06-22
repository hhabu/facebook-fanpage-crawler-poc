import type { BrowserProfileRuntime } from "../browser/browserProfileManager";
import { getBrowserProfileRuntime, markBrowserProfileWarmup, testBrowserProfile } from "../browser/browserProfileManager";
import { getConfig } from "../config/env";
import type { Bot } from "../lib/botTypes";
import { findNativeChromeExecutable, killOrphanChromeForProfile } from "../browser/nativeChromeEngine";
import { chromium } from "playwright-core";

interface ActiveWarmup {
  botId: number;
  profile: BrowserProfileRuntime;
  context: any;
  page: any;
  startedAt: string;
  targetUrl: string;
}

const activeWarmups = new Map<number, ActiveWarmup>();

export async function startProfileWarmup(bot: Bot, targetUrl?: string): Promise<{
  botId: number;
  profile: BrowserProfileRuntime;
  startedAt: string;
  targetUrl: string;
  alreadyRunning: boolean;
}> {
  const existing = activeWarmups.get(bot.id);
  if (existing) {
    return {
      botId: bot.id,
      profile: existing.profile,
      startedAt: existing.startedAt,
      targetUrl: existing.targetUrl,
      alreadyRunning: true
    };
  }

  const profile = getBrowserProfileRuntime(bot);
  const warmupUrl = targetUrl || (bot.targetDomain.includes("facebook.com") ? "https://www.facebook.com" : bot.targetUrl);
  const config = getConfig();
  const launchOptions = {
    executablePath: findNativeChromeExecutable(),
    headless: false,
    proxy: bot.proxyUrl || config.cloakProxy ? { server: bot.proxyUrl || config.cloakProxy! } : undefined,
    args: ["--disable-blink-features=AutomationControlled"],
    viewport: { width: 1365, height: 768 },
    userAgent: bot.userAgent || undefined
  };
  let context: any;
  try {
    context = await chromium.launchPersistentContext(profile.userDataDir, launchOptions);
  } catch {
    killOrphanChromeForProfile(profile.userDataDir);
    context = await chromium.launchPersistentContext(profile.userDataDir, launchOptions);
  }
  const page = await context.newPage();

  await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);

  const startedAt = new Date().toISOString();
  activeWarmups.set(bot.id, {
    botId: bot.id,
    profile,
    context,
    page,
    startedAt,
    targetUrl: warmupUrl
  });

  return {
    botId: bot.id,
    profile,
    startedAt,
    targetUrl: warmupUrl,
    alreadyRunning: false
  };
}

export async function closeProfileWarmup(bot: Bot): Promise<{
  botId: number;
  profile: BrowserProfileRuntime;
  session: ReturnType<typeof testBrowserProfile>;
  closed: boolean;
}> {
  const active = activeWarmups.get(bot.id);
  const profile = active?.profile ?? getBrowserProfileRuntime(bot);

  if (active) {
    await active.context.close().catch(() => undefined);
    activeWarmups.delete(bot.id);
  }

  markBrowserProfileWarmup(profile);

  return {
    botId: bot.id,
    profile,
    session: testBrowserProfile(profile),
    closed: Boolean(active)
  };
}

export function getActiveProfileWarmups(): Array<{
  botId: number;
  profileName: string;
  startedAt: string;
  targetUrl: string;
}> {
  return [...activeWarmups.values()].map((warmup) => ({
    botId: warmup.botId,
    profileName: warmup.profile.name,
    startedAt: warmup.startedAt,
    targetUrl: warmup.targetUrl
  }));
}

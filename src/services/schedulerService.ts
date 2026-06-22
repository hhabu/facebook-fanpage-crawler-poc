import { runBot } from "../scrapers/runBot";
import { getConfig } from "../config/env";
import { getBots } from "./botService";

let started = false;
let activeRuns = 0;
let timer: NodeJS.Timeout | null = null;

function cronPartMatches(part: string, value: number): boolean {
  if (part === "*") {
    return true;
  }
  if (part.startsWith("*/")) {
    const interval = Number(part.slice(2));
    return Number.isFinite(interval) && interval > 0 && value % interval === 0;
  }
  return part
    .split(",")
    .map((item) => Number(item.trim()))
    .some((item) => item === value);
}

export function cronMatchesNow(cron: string, now = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  return cronPartMatches(parts[0], now.getMinutes()) && cronPartMatches(parts[1], now.getHours());
}

export async function tickScheduler(): Promise<void> {
  const maxConcurrency = getConfig().crawlerMaxConcurrency;
  const dueBots = getBots().filter((bot) => bot.status === "active" && bot.scheduleCron && cronMatchesNow(bot.scheduleCron));

  for (const bot of dueBots) {
    if (activeRuns >= maxConcurrency) {
      return;
    }

    activeRuns += 1;
    runBot(bot.id)
      .catch(() => undefined)
      .finally(() => {
        activeRuns -= 1;
      });
  }
}

export function startScheduler(): void {
  if (started || !getConfig().schedulerEnabled) {
    return;
  }

  started = true;
  timer = setInterval(() => {
    tickScheduler().catch(() => undefined);
  }, 60000);
}

export function schedulerStatus(): { enabled: boolean; started: boolean; activeRuns: number } {
  return {
    enabled: getConfig().schedulerEnabled,
    started,
    activeRuns
  };
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
  }
  timer = null;
  started = false;
}

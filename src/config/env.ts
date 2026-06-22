import fs from "node:fs";
import path from "node:path";

let loaded = false;

export interface AppConfig {
  port: number;
  schedulerEnabled: boolean;
  crawlerMaxConcurrency: number;
  cloakHeadless: boolean;
  cloakHumanize: boolean;
  cloakLocale: string | null;
  cloakTimezone: string | null;
  cloakProxy: string | null;
  defaultRetryLimit: number;
  defaultCooldownSeconds: number;
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function loadEnvFile(envPath = path.resolve(process.cwd(), ".env")): void {
  if (loaded) {
    return;
  }

  loaded = true;
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
}

function stringEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getConfig(): AppConfig {
  loadEnvFile();

  return {
    port: numberEnv("PORT", 4000),
    schedulerEnabled: boolEnv("SCHEDULER_ENABLED", false),
    crawlerMaxConcurrency: numberEnv("CRAWLER_MAX_CONCURRENCY", 2),
    cloakHeadless: boolEnv("CLOAK_HEADLESS", true),
    cloakHumanize: boolEnv("CLOAK_HUMANIZE", true),
    cloakLocale: stringEnv("CLOAK_LOCALE"),
    cloakTimezone: stringEnv("CLOAK_TIMEZONE"),
    cloakProxy: stringEnv("CLOAK_PROXY"),
    defaultRetryLimit: numberEnv("DEFAULT_RETRY_LIMIT", 2),
    defaultCooldownSeconds: numberEnv("DEFAULT_COOLDOWN_SECONDS", 60)
  };
}

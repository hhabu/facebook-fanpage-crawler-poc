import { getDb } from "../lib/db";
import { inferTargetDomain, type Bot, type BotStatus, type CreateBotInput, type UpdateBotInput } from "../lib/botTypes";
import { getConfig } from "../config/env";

interface BotRow {
  id: number;
  name: string;
  type: Bot["type"];
  target_url: string;
  target_domain: string;
  browser_profile: string;
  browser_engine: Bot["browserEngine"];
  proxy_url: string | null;
  user_agent: string | null;
  viewport_json: string | null;
  retry_limit: number;
  cooldown_seconds: number;
  last_run_at: string | null;
  next_run_at: string | null;
  schedule_cron: string | null;
  status: BotStatus;
  created_at: string;
  updated_at: string;
}

function mapBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    targetUrl: row.target_url,
    targetDomain: row.target_domain,
    browserProfile: row.browser_profile,
    browserEngine: row.browser_engine,
    proxyUrl: row.proxy_url,
    userAgent: row.user_agent,
    viewportJson: row.viewport_json,
    retryLimit: row.retry_limit,
    cooldownSeconds: row.cooldown_seconds,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    scheduleCron: row.schedule_cron,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getBots(): Bot[] {
  const rows = getDb().prepare("SELECT * FROM bots ORDER BY created_at DESC").all() as BotRow[];
  return rows.map(mapBot);
}

export function getBotById(id: number): Bot | null {
  const row = getDb().prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  return row ? mapBot(row) : null;
}

export function createBot(input: CreateBotInput): Bot {
  const config = getConfig();
  const targetDomain = input.targetDomain ?? inferTargetDomain(input.targetUrl);
  const result = getDb()
    .prepare(
      `INSERT INTO bots (
        name, type, target_url, target_domain, browser_profile, browser_engine, proxy_url,
        user_agent, viewport_json, retry_limit, cooldown_seconds, last_run_at, next_run_at,
        schedule_cron, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.type,
      input.targetUrl,
      targetDomain,
      input.browserProfile,
      input.browserEngine ?? "auto",
      input.proxyUrl ?? null,
      input.userAgent ?? null,
      input.viewportJson ?? null,
      input.retryLimit ?? config.defaultRetryLimit,
      input.cooldownSeconds ?? config.defaultCooldownSeconds,
      input.lastRunAt ?? null,
      input.nextRunAt ?? null,
      input.scheduleCron ?? null,
      input.status ?? "active"
    );

  return getBotById(Number(result.lastInsertRowid))!;
}

export function updateBot(id: number, input: UpdateBotInput): Bot | null {
  const existing = getBotById(id);
  if (!existing) {
    return null;
  }

  const nextTargetUrl = input.targetUrl ?? existing.targetUrl;
  const nextTargetDomain = input.targetDomain ?? (input.targetUrl ? inferTargetDomain(nextTargetUrl) : existing.targetDomain);

  getDb()
    .prepare(
      `UPDATE bots
       SET name = ?,
           type = ?,
           target_url = ?,
           target_domain = ?,
           browser_profile = ?,
           browser_engine = ?,
           proxy_url = ?,
           user_agent = ?,
           viewport_json = ?,
           retry_limit = ?,
           cooldown_seconds = ?,
           last_run_at = ?,
           next_run_at = ?,
           schedule_cron = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      input.name ?? existing.name,
      input.type ?? existing.type,
      nextTargetUrl,
      nextTargetDomain,
      input.browserProfile ?? existing.browserProfile,
      input.browserEngine ?? existing.browserEngine,
      input.proxyUrl === undefined ? existing.proxyUrl : input.proxyUrl,
      input.userAgent === undefined ? existing.userAgent : input.userAgent,
      input.viewportJson === undefined ? existing.viewportJson : input.viewportJson,
      input.retryLimit ?? existing.retryLimit,
      input.cooldownSeconds ?? existing.cooldownSeconds,
      input.lastRunAt === undefined ? existing.lastRunAt : input.lastRunAt,
      input.nextRunAt === undefined ? existing.nextRunAt : input.nextRunAt,
      input.scheduleCron === undefined ? existing.scheduleCron : input.scheduleCron,
      input.status ?? existing.status,
      id
    );

  return getBotById(id);
}

export function updateBotStatus(id: number, status: BotStatus): Bot | null {
  getDb()
    .prepare("UPDATE bots SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id);

  return getBotById(id);
}

export function deleteBot(id: number): boolean {
  const result = getDb().prepare("DELETE FROM bots WHERE id = ?").run(id);
  return result.changes > 0;
}

export const listBots = getBots;
export const getBot = getBotById;

import { getDb } from "../lib/db";

export type JobStatus = "pending" | "running" | "success" | "failed" | "blocked" | "retrying";
export type JobLogStatus = "started" | "success" | "failed" | "blocked" | "retrying" | "info";

export interface BotJob {
  id: number;
  botId: number;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
  blockReason: string | null;
  crawlResultId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotJobLog {
  id: number;
  jobId: number;
  stage: string;
  status: JobLogStatus;
  message: string | null;
  createdAt: string;
}

interface BotJobRow {
  id: number;
  bot_id: number;
  status: JobStatus;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  block_reason: string | null;
  crawl_result_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BotJobLogRow {
  id: number;
  job_id: number;
  stage: string;
  status: JobLogStatus;
  message: string | null;
  created_at: string;
}

function mapJob(row: BotJobRow): BotJob {
  return {
    id: row.id,
    botId: row.bot_id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    blockReason: row.block_reason,
    crawlResultId: row.crawl_result_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLog(row: BotJobLogRow): BotJobLog {
  return {
    id: row.id,
    jobId: row.job_id,
    stage: row.stage,
    status: row.status,
    message: row.message,
    createdAt: row.created_at
  };
}

export function createJob(botId: number, maxAttempts: number): BotJob {
  const result = getDb()
    .prepare("INSERT INTO bot_jobs (bot_id, status, max_attempts) VALUES (?, 'pending', ?)")
    .run(botId, maxAttempts);
  return getJobById(Number(result.lastInsertRowid))!;
}

export function getJobById(id: number): BotJob | null {
  const row = getDb().prepare("SELECT * FROM bot_jobs WHERE id = ?").get(id) as BotJobRow | undefined;
  return row ? mapJob(row) : null;
}

export function getJobs(limit = 50): BotJob[] {
  const rows = getDb()
    .prepare("SELECT * FROM bot_jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as BotJobRow[];
  return rows.map(mapJob);
}

export function getJobLogs(jobId: number): BotJobLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM bot_job_logs WHERE job_id = ? ORDER BY created_at ASC, id ASC")
    .all(jobId) as BotJobLogRow[];
  return rows.map(mapLog);
}

export function updateJob(
  id: number,
  patch: Partial<Pick<BotJob, "status" | "attempt" | "errorMessage" | "blockReason" | "crawlResultId" | "startedAt" | "finishedAt">>
): BotJob | null {
  const existing = getJobById(id);
  if (!existing) {
    return null;
  }

  getDb()
    .prepare(
      `UPDATE bot_jobs
       SET status = ?,
           attempt = ?,
           error_message = ?,
           block_reason = ?,
           crawl_result_id = ?,
           started_at = ?,
           finished_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      patch.status ?? existing.status,
      patch.attempt ?? existing.attempt,
      patch.errorMessage === undefined ? existing.errorMessage : patch.errorMessage,
      patch.blockReason === undefined ? existing.blockReason : patch.blockReason,
      patch.crawlResultId === undefined ? existing.crawlResultId : patch.crawlResultId,
      patch.startedAt === undefined ? existing.startedAt : patch.startedAt,
      patch.finishedAt === undefined ? existing.finishedAt : patch.finishedAt,
      id
    );

  return getJobById(id);
}

export function addJobLog(jobId: number, stage: string, status: JobLogStatus, message?: string): void {
  getDb()
    .prepare("INSERT INTO bot_job_logs (job_id, stage, status, message) VALUES (?, ?, ?, ?)")
    .run(jobId, stage, status, message ?? null);
}

export function hasRunningJobForBot(botId: number): boolean {
  const row = getDb()
    .prepare("SELECT id FROM bot_jobs WHERE bot_id = ? AND status IN ('pending', 'running', 'retrying') LIMIT 1")
    .get(botId);
  return Boolean(row);
}

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databaseDir = path.resolve(process.cwd(), "database");
const databasePath = path.join(databaseDir, "mvp.sqlite");
const schemaPath = path.join(databaseDir, "schema.sql");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(databaseDir, { recursive: true });
    db = new Database(databasePath);
    db.pragma("foreign_keys = ON");
  }

  return db;
}

export function initializeDatabase(): void {
  migrateIncompatibleMvpSchema();
  const schema = fs.readFileSync(schemaPath, "utf8");
  getDb().exec(schema);
  migrateAdditiveSchema();
}

function migrateIncompatibleMvpSchema(): void {
  const database = getDb();
  const hasOldBotsTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bots'")
    .get();

  if (!hasOldBotsTable) {
    return;
  }

  const botColumns = database.prepare("PRAGMA table_info(bots)").all() as Array<{ name: string }>;
  const hasTargetDomain = botColumns.some((column) => column.name === "target_domain");
  const hasBrowserProfile = botColumns.some((column) => column.name === "browser_profile");
  const hasBrowserEngine = botColumns.some((column) => column.name === "browser_engine");

  const crawlSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'crawl_results'")
    .get() as { sql?: string } | undefined;
  const supportsBlockedStatus = crawlSql?.sql?.includes("'blocked'") ?? false;

  if (hasTargetDomain && hasBrowserProfile && hasBrowserEngine && supportsBlockedStatus) {
    return;
  }

  database.exec(`
    DROP TABLE IF EXISTS bot_job_logs;
    DROP TABLE IF EXISTS bot_jobs;
    DROP TABLE IF EXISTS analysis_results;
    DROP TABLE IF EXISTS social_snapshots;
    DROP TABLE IF EXISTS product_snapshots;
    DROP TABLE IF EXISTS product_price_history;
    DROP TABLE IF EXISTS article_snapshots;
    DROP TABLE IF EXISTS crawl_results;
    DROP TABLE IF EXISTS bots;
  `);
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const database = getDb();
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function migrateAdditiveSchema(): void {
  addColumnIfMissing("social_snapshots", "post_count", "post_count INTEGER");
  addColumnIfMissing("social_snapshots", "posts_json", "posts_json TEXT");
  addColumnIfMissing("social_snapshots", "comments_json", "comments_json TEXT");
  const schema = fs.readFileSync(schemaPath, "utf8");
  getDb().exec(schema);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

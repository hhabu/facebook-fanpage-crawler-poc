PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('article', 'product', 'social', 'custom')),
  target_url TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  browser_profile TEXT NOT NULL,
  browser_engine TEXT NOT NULL DEFAULT 'auto' CHECK (browser_engine IN ('auto', 'fetch', 'playwright', 'cloak')),
  proxy_url TEXT,
  user_agent TEXT,
  viewport_json TEXT,
  retry_limit INTEGER NOT NULL DEFAULT 2,
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  last_run_at TEXT,
  next_run_at TEXT,
  schedule_cron TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crawl_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('article', 'product', 'social', 'custom')),
  url TEXT NOT NULL,
  title TEXT,
  raw_text TEXT,
  raw_html TEXT,
  screenshot_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'blocked')),
  error_message TEXT,
  block_reason TEXT,
  render_engine TEXT,
  http_status INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bot_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'blocked', 'retrying')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  block_reason TEXT,
  crawl_result_id INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bot_job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed', 'blocked', 'retrying', 'info')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES bot_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_result_id INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  publish_date TEXT,
  author TEXT,
  content TEXT NOT NULL,
  images_json TEXT,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_result_id INTEGER NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  price REAL,
  currency TEXT,
  availability TEXT,
  image_url TEXT,
  price_changed INTEGER NOT NULL DEFAULT 0,
  previous_price REAL,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  crawl_result_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  price REAL,
  currency TEXT,
  availability TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_result_id INTEGER NOT NULL UNIQUE,
  platform TEXT,
  post_count INTEGER,
  posts_json TEXT,
  comments_json TEXT,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  downloads INTEGER,
  engagement_rate REAL,
  unavailable_reason TEXT,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_post_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_result_id INTEGER NOT NULL,
  post_url TEXT NOT NULL,
  post_id TEXT,
  author TEXT,
  content TEXT NOT NULL,
  published_at TEXT,
  reaction_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  share_count INTEGER,
  view_count INTEGER,
  raw_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_comment_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  social_post_id INTEGER NOT NULL,
  comment_id TEXT,
  author_name TEXT,
  author_url TEXT,
  content TEXT NOT NULL,
  reaction_count INTEGER,
  created_at_text TEXT,
  parent_comment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (social_post_id) REFERENCES social_post_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_result_id INTEGER NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  key_message TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  content_structure TEXT NOT NULL,
  viewer_reaction TEXT NOT NULL,
  competitor_insight TEXT NOT NULL,
  value_score REAL,
  viral_score REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crawl_result_id) REFERENCES crawl_results(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bots_type ON bots(type);
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_target_domain ON bots(target_domain);
CREATE INDEX IF NOT EXISTS idx_bots_next_run_at ON bots(next_run_at);
CREATE INDEX IF NOT EXISTS idx_crawl_results_bot_id ON crawl_results(bot_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_type ON crawl_results(type);
CREATE INDEX IF NOT EXISTS idx_crawl_results_status ON crawl_results(status);
CREATE INDEX IF NOT EXISTS idx_crawl_results_created_at ON crawl_results(created_at);
CREATE INDEX IF NOT EXISTS idx_bot_jobs_bot_id ON bot_jobs(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_jobs_status ON bot_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bot_job_logs_job_id ON bot_job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_crawl_result_id ON social_post_snapshots(crawl_result_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_post_id ON social_comment_snapshots(social_post_id);

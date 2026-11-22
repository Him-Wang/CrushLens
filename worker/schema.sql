-- CrushLens cloud schema (Cloudflare D1 / SQLite).
-- Only ACCOUNT METADATA lives here. Chat content (messages/partners/reports)
-- is NEVER uploaded — it stays in the browser's IndexedDB.
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  name          TEXT,
  password_hash TEXT,
  salt          TEXT,
  provider      TEXT NOT NULL DEFAULT 'password',   -- 'password' | 'github'
  github_id     TEXT,
  avatar        TEXT,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER,
  login_count   INTEGER NOT NULL DEFAULT 0,
  partner_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_accounts_github ON accounts(github_id);

CREATE TABLE IF NOT EXISTS codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

-- Rate limiting lives in D1 (Workers Free has no KV in this project).
-- bucket is like 'code:1m:user@example.com' / 'ip:user@example.com'.
CREATE TABLE IF NOT EXISTS rate (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

-- Failed-login lockout buckets reuse the `rate` table with prefix 'fail:'.

-- Anonymous usage telemetry. NO chat content, NO email, NO name, NO account id.
-- Server-side signup/login events are recorded automatically by the Worker;
-- browser-reported events (imports etc.) require explicit user opt-in.
CREATE TABLE IF NOT EXISTS usage_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,             -- signup|login|password_reset|import|app_open
  platform   TEXT,                      -- only for import: wechat|qq|json|paste|...
  msg_bucket INTEGER,                   -- bucketed message count, never exact volume
  app_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_kind_time ON usage_events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at);

-- 已有部署执行：wrangler d1 execute crushlens --file=worker/schema.sql --remote
-- （CREATE TABLE IF NOT EXISTS 不会破坏现有数据。）

-- GitHub 透明镜像：把上面的汇总快照推到仓库，token 只作为 Worker secret 存在，
-- 绝不下发到浏览器。需要的 secret：GH_MIRROR_TOKEN、变量 GH_MIRROR_REPO=owner/repo。

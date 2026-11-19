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

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('builtin','anthropic','openai','custom')),
  label TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE task_routes (
  task TEXT PRIMARY KEY,
  provider_id TEXT,
  model TEXT
);

CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT,
  provider_id TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

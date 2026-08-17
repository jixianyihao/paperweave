CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('highlight','note','ai_summary','ai_explain','ai_translate','ai_qa','voice_digest')),
  page INTEGER,
  position TEXT,
  content TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sort_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX annotations_item ON annotations(item_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  annotation_id TEXT REFERENCES annotations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  citations TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX messages_conversation ON messages(conversation_id);

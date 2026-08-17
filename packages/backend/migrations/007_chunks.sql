CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  page INTEGER NOT NULL, chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL, embedding BLOB,           -- Float32Array 字节
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX chunks_item ON chunks(item_id);

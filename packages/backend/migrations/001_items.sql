CREATE TABLE items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creators TEXT NOT NULL DEFAULT '[]',
  year INTEGER,
  venue TEXT,
  doi TEXT,
  arxiv_id TEXT,
  url TEXT,
  abstract TEXT,
  file_path TEXT,
  reading_status TEXT NOT NULL DEFAULT 'unread'
    CHECK (reading_status IN ('unread','reading','read')),
  starred INTEGER NOT NULL DEFAULT 0,
  date_added TEXT NOT NULL DEFAULT (datetime('now')),
  date_modified TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE items_fts USING fts5(
  title, abstract, venue, creators,
  content='items', content_rowid='rowid'
);

CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, abstract, venue, creators)
    VALUES (new.rowid, new.title, new.abstract, new.venue, new.creators);
END;

CREATE TRIGGER items_fts_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, abstract, venue, creators)
    VALUES ('delete', old.rowid, old.title, old.abstract, old.venue, old.creators);
END;

CREATE TRIGGER items_fts_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, abstract, venue, creators)
    VALUES ('delete', old.rowid, old.title, old.abstract, old.venue, old.creators);
  INSERT INTO items_fts(rowid, title, abstract, venue, creators)
    VALUES (new.rowid, new.title, new.abstract, new.venue, new.creators);
END;

INSERT INTO items_fts(items_fts) VALUES ('rebuild');

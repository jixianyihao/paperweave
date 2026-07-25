import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function dataDir(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), "data");
}

export function openDb(dir: string = dataDir()): Database.Database {
  mkdirSync(join(dir, "files"), { recursive: true });
  const db = new Database(join(dir, "library.sqlite"));
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(
  db: Database.Database,
  migrationsDir: string = join(import.meta.dirname, "..", "migrations"),
): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map(r => r.name),
  );
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
  }
}

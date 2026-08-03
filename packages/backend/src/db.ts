import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveDataDir(startDir: string = import.meta.dirname): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "data");
    const parent = dirname(dir);
    if (parent === dir) return join(process.cwd(), "data");
    dir = parent;
  }
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? resolveDataDir();
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
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    })();
  }
}

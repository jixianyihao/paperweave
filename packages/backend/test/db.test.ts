import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDb, migrate, dataDir, resolveDataDir } from "../src/db.js";

describe("openDb", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("creates data dir, files subdir, and applies migrations", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    expect(existsSync(join(dir, "files"))).toBe(true);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    expect(tables).toContain("items");
    expect(tables).toContain("_migrations");
    db.close();
  });

  it("is idempotent across restarts", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    openDb(dir).close();
    const db = openDb(dir);
    const row = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    const migrationFiles = readdirSync(join(import.meta.dirname, "..", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(row.n).toBe(migrationFiles.length);
    db.close();
  });

  it("has metadata_status column after migrations", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const cols = (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("metadata_status");
    db.close();
  });

  it("enables WAL journal mode", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const row = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(row[0].journal_mode).toBe("wal");
    db.close();
  });

  it("enforces foreign keys", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    expect(() =>
      db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('nope', 'nope')").run(),
    ).toThrow();
    db.close();
  });
});

describe("migrate", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("rolls back a failed migration atomically", () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const migrationsDir = mkdtempSync(join(tmpdir(), "pw-migrations-"));
    writeFileSync(
      join(migrationsDir, "001_bad.sql"),
      "CREATE TABLE from_bad_migration (id TEXT);\nTHIS IS NOT VALID SQL;\n",
    );
    const db = new Database(join(dir, "test.sqlite"));
    expect(() => migrate(db, migrationsDir)).toThrow();
    const ledger = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    expect(ledger.n).toBe(0);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
    expect(tables).not.toContain("from_bad_migration");
    db.close();
    rmSync(migrationsDir, { recursive: true, force: true });
  });
});

describe("dataDir", () => {
  const original = process.env.DATA_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = original;
  });

  it("honors the DATA_DIR env override", () => {
    process.env.DATA_DIR = "/tmp/pw-custom-data";
    expect(dataDir()).toBe("/tmp/pw-custom-data");
  });

  it("resolves the default to the monorepo root data dir", () => {
    const resolved = resolveDataDir();
    expect(resolved.endsWith(join("data"))).toBe(true);
    const parent = resolved.slice(0, -"data".length).replace(/[/\\]$/, "");
    expect(existsSync(join(parent, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("walks up to the workspace root without creating dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-root-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    const resolved = resolveDataDir(join(root, "a", "b"));
    expect(resolved).toBe(join(root, "data"));
    expect(existsSync(resolved)).toBe(false); // resolution must not create the dir
    rmSync(root, { recursive: true, force: true });
  });
});

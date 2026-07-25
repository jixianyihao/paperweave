import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";

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
    expect(row.n).toBe(1);
    db.close();
  });
});

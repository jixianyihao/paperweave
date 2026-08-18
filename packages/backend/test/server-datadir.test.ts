import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("buildServer default dataDir honors DATA_DIR env", () => {
  let dir = "";
  const original = process.env.DATA_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = original;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("serves /api/items/:id/pdf from DATA_DIR when no opts.dataDir is given", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-env-test-"));
    process.env.DATA_DIR = dir;
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('T1', 't', 'files/T1.pdf')").run();
    writeFileSync(join(dir, "files", "T1.pdf"), "%PDF-dummy");
    const app = buildServer(db); // 不传 opts.dataDir —— 必须走 DATA_DIR
    const res = await app.inject({ method: "GET", url: "/api/items/T1/pdf" });
    expect(res.statusCode).toBe(200);
    await app.close();
    db.close();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("GET /api/items", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns inserted rows", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run("abc123", "Attention Is All You Need");
    const app = buildServer(db);
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { title: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Attention Is All You Need");
    await app.close();
    db.close();
  });

  it("returns empty array when library is empty", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir));
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.json()).toEqual([]);
    await app.close();
  });
});

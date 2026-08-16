import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("tag routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("adds, lists (with counts) and removes tags", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const itemId = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(itemId, "Paper");
    const app = buildServer(db, { dataDir: dir });

    const put = await app.inject({ method: "PUT", url: `/api/items/${itemId}/tags/NLP` });
    expect(put.statusCode).toBe(204);
    const again = await app.inject({ method: "PUT", url: `/api/items/${itemId}/tags/NLP` });
    expect(again.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/tags" });
    expect(list.json()).toEqual([{ name: "NLP", item_count: 1 }]);

    const del = await app.inject({ method: "DELETE", url: `/api/items/${itemId}/tags/NLP` });
    expect(del.statusCode).toBe(204);
    const empty = await app.inject({ method: "GET", url: "/api/tags" });
    expect(empty.json()).toEqual([]);
    await app.close();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("collection routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const itemId = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(itemId, "Paper");
    const app = buildServer(db, { dataDir: dir });
    return { db, app, itemId };
  }

  it("creates, lists (with item counts), renames and deletes collections", async () => {
    const { app, itemId } = await setup();
    const created = await app.inject({ method: "POST", url: "/api/collections", payload: { name: "Transformer" } });
    expect(created.statusCode).toBe(200);
    const col = created.json();
    expect(col.name).toBe("Transformer");

    const put = await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    expect(put.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/collections" });
    expect(list.json()).toEqual([expect.objectContaining({ name: "Transformer", item_count: 1 })]);

    const renamed = await app.inject({ method: "PATCH", url: `/api/collections/${col.id}`, payload: { name: "LLM" } });
    expect(renamed.json().name).toBe("LLM");

    const del = await app.inject({ method: "DELETE", url: `/api/collections/${col.id}` });
    expect(del.statusCode).toBe(204);
    await app.close();
  });

  it("PUT membership is idempotent", async () => {
    const { app, itemId } = await setup();
    const col = (await app.inject({ method: "POST", url: "/api/collections", payload: { name: "C" } })).json();
    await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    const again = await app.inject({ method: "PUT", url: `/api/collections/${col.id}/items/${itemId}` });
    expect(again.statusCode).toBe(204);
    await app.close();
  });

  it("rejects empty collection name with 400", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/collections", payload: { name: "  " } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

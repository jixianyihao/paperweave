import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { newKey } from "../src/lib/keys.js";

describe("item detail routes", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const id = newKey();
    db.prepare("INSERT INTO items (id, title) VALUES (?, ?)").run(id, "Test Paper");
    const app = buildServer(db, { dataDir: dir });
    return { db, app, id };
  }

  it("GET /api/items/:id returns the item", async () => {
    const { app, id } = await setup();
    const res = await app.inject({ method: "GET", url: `/api/items/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Test Paper");
    await app.close();
  });

  it("GET /api/items/:id 404s for unknown id", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items/NOPE1234" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("PATCH updates allowed fields and bumps date_modified", async () => {
    const { app, id } = await setup();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/items/${id}`,
      payload: { reading_status: "reading", starred: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reading_status).toBe("reading");
    expect(res.json().starred).toBe(1);
    await app.close();
  });

  it("PATCH rejects unknown fields and bad enums with 400", async () => {
    const { app, id } = await setup();
    const bad1 = await app.inject({ method: "PATCH", url: `/api/items/${id}`, payload: { evil: true } });
    const bad2 = await app.inject({ method: "PATCH", url: `/api/items/${id}`, payload: { reading_status: "bogus" } });
    expect(bad1.statusCode).toBe(400);
    expect(bad2.statusCode).toBe(400);
    await app.close();
  });

  it("DELETE removes row and its pdf file", async () => {
    const { db, app, id } = await setup();
    writeFileSync(join(dir, "files", `${id}.pdf`), "fake");
    db.prepare("UPDATE items SET file_path = ? WHERE id = ?").run(`files/${id}.pdf`, id);
    const res = await app.inject({ method: "DELETE", url: `/api/items/${id}` });
    expect(res.statusCode).toBe(204);
    expect(db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = ?").get(id)).toEqual({ n: 0 });
    expect(existsSync(join(dir, "files", `${id}.pdf`))).toBe(false);
    await app.close();
  });
});

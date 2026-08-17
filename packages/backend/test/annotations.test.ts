import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pw-test-"));
  const db = openDb(dir);
  db.prepare("INSERT INTO items (id, title) VALUES ('itm00001', 'Paper One')").run();
  const app = buildServer(db, { dataDir: dir });
  return { dir, db, app };
}

describe("annotations CRUD", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("creates and lists annotations for an item, sorted by page, sort_index, created_at, id", async () => {
    const s = await setup();
    dir = s.dir;
    const mk = (payload: unknown) =>
      s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: payload as Record<string, unknown> });
    const a = await mk({ type: "highlight", content: "page 2 text", page: 2 });
    expect(a.statusCode).toBe(200);
    const b = await mk({ type: "note", content: "page 1 note", page: 1, color: "yellow" });
    const c = await mk({ type: "note", content: "no page" });
    const res = await s.app.inject({ method: "GET", url: "/api/items/itm00001/annotations" });
    expect(res.statusCode).toBe(200);
    const anns = res.json() as { id: string; content: string; page: number | null; type: string; color: string | null }[];
    expect(anns).toHaveLength(3);
    // page NULL 在前（SQLite ASC 默认 NULLS FIRST），其后按 page 升序
    expect(anns.map((x) => x.content)).toEqual(["no page", "page 1 note", "page 2 text"]);
    expect(anns[1].color).toBe("yellow");
    expect(anns[0].type).toBe("note");
    expect(a.json().id).toHaveLength(8);
    await s.app.close();
    s.db.close();
  });

  it("404s when creating an annotation for a missing item", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "POST", url: "/api/items/nope/annotations", payload: { type: "note", content: "x" } });
    expect(res.statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });

  it("400s on unknown fields and bad type (zod strict)", async () => {
    const s = await setup();
    dir = s.dir;
    const extra = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "note", content: "x", bogus: 1 } });
    expect(extra.statusCode).toBe(400);
    const badType = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "scribble", content: "x" } });
    expect(badType.statusCode).toBe(400);
    const empty = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "note", content: "" } });
    expect(empty.statusCode).toBe(400);
    await s.app.close();
    s.db.close();
  });

  it("patches content and color", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "note", content: "old" } });
    const id = created.json().id as string;
    const res = await s.app.inject({ method: "PATCH", url: `/api/annotations/${id}`, payload: { content: "new", color: "red" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, content: "new", color: "red" });
    await s.app.close();
    s.db.close();
  });

  it("patch 400s on empty body / unknown fields, 404s on missing annotation", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "note", content: "x" } });
    const id = created.json().id as string;
    expect((await s.app.inject({ method: "PATCH", url: `/api/annotations/${id}`, payload: {} })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: `/api/annotations/${id}`, payload: { page: 3 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: "PATCH", url: "/api/annotations/nope", payload: { content: "y" } })).statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });

  it("deletes annotations (204) and 404s on missing", async () => {
    const s = await setup();
    dir = s.dir;
    const created = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "note", content: "x" } });
    const id = created.json().id as string;
    expect((await s.app.inject({ method: "DELETE", url: `/api/annotations/${id}` })).statusCode).toBe(204);
    expect((await s.app.inject({ method: "DELETE", url: `/api/annotations/${id}` })).statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });

  it("accepts ai_* types and stores position opaquely", async () => {
    const s = await setup();
    dir = s.dir;
    const position = JSON.stringify({ start: { page: 1, offset: 10 }, end: { page: 1, offset: 42 } });
    const res = await s.app.inject({ method: "POST", url: "/api/items/itm00001/annotations", payload: { type: "ai_summary", content: "Summary", position } });
    expect(res.statusCode).toBe(200);
    expect(res.json().position).toBe(position);
    await s.app.close();
    s.db.close();
  });
});

describe("GET /api/conversations/:id", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns conversation with ordered messages", async () => {
    const s = await setup();
    dir = s.dir;
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'highlight', 'hl')").run();
    s.db.prepare("INSERT INTO conversations (id, annotation_id, item_id) VALUES ('conv1', 'ann1', 'itm00001')").run();
    s.db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m1', 'conv1', 'user', 'q', '2026-01-01 00:00:00')").run();
    s.db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('m2', 'conv1', 'assistant', 'a', '2026-01-01 00:00:01')").run();
    const res = await s.app.inject({ method: "GET", url: "/api/conversations/conv1" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { id: string }; messages: { id: string }[] };
    expect(body.conversation.id).toBe("conv1");
    expect(body.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    await s.app.close();
    s.db.close();
  });

  it("orders same-second messages by insertion order (rowid tiebreaker), not random id", async () => {
    const s = await setup();
    dir = s.dir;
    s.db.prepare("INSERT INTO annotations (id, item_id, type, content) VALUES ('ann1', 'itm00001', 'highlight', 'hl')").run();
    s.db.prepare("INSERT INTO conversations (id, annotation_id, item_id) VALUES ('conv1', 'ann1', 'itm00001')").run();
    const ins = s.db.prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, 'conv1', 'user', ?, '2026-01-01 00:00:00')");
    ins.run("zzzzzzzz", "first inserted");
    ins.run("aaaaaaaa", "second inserted");
    const res = await s.app.inject({ method: "GET", url: "/api/conversations/conv1" });
    const body = res.json() as { messages: { content: string }[] };
    expect(body.messages.map((m) => m.content)).toEqual(["first inserted", "second inserted"]);
    await s.app.close();
    s.db.close();
  });

  it("404s on missing conversation", async () => {
    const s = await setup();
    dir = s.dir;
    const res = await s.app.inject({ method: "GET", url: "/api/conversations/nope" });
    expect(res.statusCode).toBe(404);
    await s.app.close();
    s.db.close();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("GET /api/items filters", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const insert = db.prepare(
      "INSERT INTO items (id, title, abstract, reading_status, starred, date_added) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("itm00001", "Attention Is All You Need", "Transformer architecture", "unread", 1, "2026-01-01 00:00:00");
    insert.run("itm00002", "BERT Pre-training", "Masked language model", "reading", 0, "2026-01-02 00:00:00");
    insert.run("itm00003", "GPT-4 Technical Report", "Large multimodal model", "read", 0, "2026-01-03 00:00:00");
    db.prepare("INSERT INTO collections (id, name) VALUES ('col1', 'NLP')").run();
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('col1', 'itm00001')").run();
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('col1', 'itm00002')").run();
    db.prepare("INSERT INTO tags (id, name) VALUES (1, 'transformer')").run();
    db.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES ('itm00001', 1)").run();
    db.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES ('itm00003', 1)").run();
    const app = buildServer(db, { dataDir: dir });
    return { db, app };
  }

  it("filters by reading status", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?status=unread" });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00001"]);
    await app.close();
  });

  it("filters by starred=1", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?starred=1" });
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00001"]);
    await app.close();
  });

  it("filters by collection", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?collection=col1" });
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00002", "itm00001"]);
    await app.close();
  });

  it("filters by tag", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?tag=transformer" });
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00003", "itm00001"]);
    await app.close();
  });

  it("combines filters", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?collection=col1&status=reading" });
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00002"]);
    await app.close();
  });

  it("filters by q via FTS", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?q=masked" });
    const items = res.json() as { id: string }[];
    expect(items.map((i) => i.id)).toEqual(["itm00002"]);
    await app.close();
  });

  it("400s on invalid status", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?status=bogus" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400s on invalid starred", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items?starred=yes" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/collections/:id/items", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("returns member items sorted date_added DESC, id DESC", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO collections (id, name) VALUES ('col1', 'NLP')").run();
    const insert = db.prepare("INSERT INTO items (id, title, date_added) VALUES (?, ?, ?)");
    insert.run("aaa111", "First", "2026-01-01 00:00:00");
    insert.run("bbb222", "Second", "2026-01-01 00:00:00");
    insert.run("ccc333", "Third", "2026-01-02 00:00:00");
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('col1', 'aaa111')").run();
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('col1', 'bbb222')").run();
    db.prepare("INSERT INTO collection_items (collection_id, item_id) VALUES ('col1', 'ccc333')").run();
    const app = buildServer(db, { dataDir: dir });
    const res = await app.inject({ method: "GET", url: "/api/collections/col1/items" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["ccc333", "bbb222", "aaa111"]);
    await app.close();
    db.close();
  });

  it("404s when collection does not exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir });
    const res = await app.inject({ method: "GET", url: "/api/collections/nope/items" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /api/search", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const insert = db.prepare(
      "INSERT INTO items (id, title, creators, abstract, venue) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("itm00001", "Attention Is All You Need", '["Ashish Vaswani"]', "We propose the Transformer.", "NeurIPS");
    insert.run("itm00002", "BERT", '["Jacob Devlin"]', "Bidirectional encoder representations.", "NAACL");
    insert.run("itm00003", "ResNet", '["Kaiming He"]', "Deep residual learning for image recognition.", "CVPR");
    const app = buildServer(db, { dataDir: dir });
    return { db, app };
  }

  it("matches by title", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/search?q=attention" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual(["itm00001"]);
    await app.close();
  });

  it("matches by abstract, venue, and creators", async () => {
    const { app } = await setup();
    const byAbstract = await app.inject({ method: "GET", url: "/api/search?q=bidirectional" });
    expect((byAbstract.json() as { items: { id: string }[] }).items[0].id).toBe("itm00002");
    const byVenue = await app.inject({ method: "GET", url: "/api/search?q=CVPR" });
    expect((byVenue.json() as { items: { id: string }[] }).items[0].id).toBe("itm00003");
    const byCreator = await app.inject({ method: "GET", url: "/api/search?q=Vaswani" });
    expect((byCreator.json() as { items: { id: string }[] }).items[0].id).toBe("itm00001");
    await app.close();
  });

  it("handles FTS-special characters without erroring", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent('attention " OR (')}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns empty items for no match", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/search?q=zzzznotfound" });
    expect((res.json() as { items: unknown[] }).items).toEqual([]);
    await app.close();
  });

  it("400s when q is missing", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/search" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("updates the index on update and delete", async () => {
    const { db, app } = await setup();
    db.prepare("UPDATE items SET title = 'Retrieval Augmented Generation' WHERE id = 'itm00003'").run();
    const after = await app.inject({ method: "GET", url: "/api/search?q=retrieval" });
    expect((after.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["itm00003"]);
    const stale = await app.inject({ method: "GET", url: "/api/search?q=resnet" });
    expect((stale.json() as { items: unknown[] }).items).toEqual([]);
    db.prepare("DELETE FROM items WHERE id = 'itm00001'").run();
    const gone = await app.inject({ method: "GET", url: "/api/search?q=attention" });
    expect((gone.json() as { items: unknown[] }).items).toEqual([]);
    await app.close();
    db.close();
  });

  it("backfills pre-migration rows via rebuild", async () => {
    // 建库时 004 迁移里的 rebuild 应覆盖触发器创建前插入的数据；
    // 用新库模拟：迁移在一次 openDb 内按序应用，验证 rebuild 幂等且不丢数据。
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title) VALUES ('late1', 'Late Indexed Paper')").run();
    db.exec("INSERT INTO items_fts(items_fts) VALUES ('rebuild')");
    const app = buildServer(db, { dataDir: dir });
    const res = await app.inject({ method: "GET", url: "/api/search?q=indexed" });
    expect((res.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["late1"]);
    await app.close();
    db.close();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

describe("GET /api/items/:id/pdf", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const app = buildServer(db, { dataDir: dir });
    return { db, app };
  }

  it("streams the pdf with application/pdf content type", async () => {
    const { db, app } = await setup();
    const bytes = new TextEncoder().encode("%PDF-1.7 fake body");
    writeFileSync(join(dir, "files", "itm00001.pdf"), bytes);
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00001', 'Paper', 'files/itm00001.pdf')").run();
    const res = await app.inject({ method: "GET", url: "/api/items/itm00001/pdf" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.toString()).toBe("%PDF-1.7 fake body");
    await app.close();
    db.close();
  });

  it("404s when item does not exist", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/items/nope/pdf" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("404s when item has no file_path", async () => {
    const { db, app } = await setup();
    db.prepare("INSERT INTO items (id, title) VALUES ('itm00002', 'No Pdf')").run();
    const res = await app.inject({ method: "GET", url: "/api/items/itm00002/pdf" });
    expect(res.statusCode).toBe(404);
    await app.close();
    db.close();
  });

  it("404s when file is missing on disk", async () => {
    const { db, app } = await setup();
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00003', 'Ghost', 'files/itm00003.pdf')").run();
    const res = await app.inject({ method: "GET", url: "/api/items/itm00003/pdf" });
    expect(res.statusCode).toBe(404);
    await app.close();
    db.close();
  });

  it("refuses file_path values outside the files/<id>.pdf shape (traversal guard)", async () => {
    const { db, app } = await setup();
    mkdirSync(join(dir, "secret"), { recursive: true });
    writeFileSync(join(dir, "secret", "evil.pdf"), "%PDF-evil");
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00004', 'Evil', 'secret/evil.pdf')").run();
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00005', 'Evil2', '../secret/evil.pdf')").run();
    db.prepare("INSERT INTO items (id, title, file_path) VALUES ('itm00006', 'Evil3', 'files/other.pdf')").run();
    for (const id of ["itm00004", "itm00005", "itm00006"]) {
      const res = await app.inject({ method: "GET", url: `/api/items/${id}/pdf` });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
    db.close();
  });
});

describe("POST /api/items/:id/refetch-metadata", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const crossrefJson = {
    message: {
      title: ["Refetched Title"],
      author: [{ given: "Jane", family: "Doe" }],
      issued: { "date-parts": [[2022]] },
      "container-title": ["Science"],
      DOI: "10.1000/xyz123",
    },
  };

  function fetchOk() {
    return (async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.crossref.org")) {
        return { ok: true, status: 200, json: async () => crossrefJson, text: async () => JSON.stringify(crossrefJson) };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }) as unknown as typeof fetch;
  }

  it("re-runs the doi pipeline and updates the item", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title, doi, metadata_status) VALUES ('itm00001', 'Old Title', '10.1000/xyz123', 'failed')").run();
    const app = buildServer(db, { dataDir: dir, fetchImpl: fetchOk() });
    const res = await app.inject({ method: "POST", url: "/api/items/itm00001/refetch-metadata" });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(item.title).toBe("Refetched Title");
    expect(item.year).toBe(2022);
    expect(metadata_status).toBe("complete");
    await app.close();
    db.close();
  });

  it("falls back to arxiv when doi lookup fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title, doi, arxiv_id, metadata_status) VALUES ('itm00002', 'Old', '10.1000/bad', '1706.03762', 'failed')").run();
    const arxivXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>http://arxiv.org/abs/1706.03762v5</id><title>Arxiv Title</title><published>2017-06-12T00:00:00Z</published>
      <summary>S</summary><author><name>A. Vaswani</name></author></entry></feed>`;
    const fetchArxiv = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("export.arxiv.org")) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => arxivXml };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }) as unknown as typeof fetch;
    const app = buildServer(db, { dataDir: dir, fetchImpl: fetchArxiv });
    const res = await app.inject({ method: "POST", url: "/api/items/itm00002/refetch-metadata" });
    const { item, metadata_status } = res.json();
    expect(item.title).toBe("Arxiv Title");
    expect(metadata_status).toBe("complete");
    await app.close();
    db.close();
  });

  it("marks metadata_status failed when lookups fail", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title, doi, metadata_status) VALUES ('itm00003', 'Old', '10.1000/bad', 'pending')").run();
    const fetchFail = (async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" })) as unknown as typeof fetch;
    const app = buildServer(db, { dataDir: dir, fetchImpl: fetchFail });
    const res = await app.inject({ method: "POST", url: "/api/items/itm00003/refetch-metadata" });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(metadata_status).toBe("failed");
    expect(item.metadata_status).toBe("failed");
    expect(item.title).toBe("Old");
    await app.close();
    db.close();
  });

  it("400s when item has neither doi nor arxiv_id", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    db.prepare("INSERT INTO items (id, title) VALUES ('itm00004', 'No Ids')").run();
    const app = buildServer(db, { dataDir: dir, fetchImpl: fetchOk() });
    const res = await app.inject({ method: "POST", url: "/api/items/itm00004/refetch-metadata" });
    expect(res.statusCode).toBe(400);
    await app.close();
    db.close();
  });

  it("404s when item does not exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchOk() });
    const res = await app.inject({ method: "POST", url: "/api/items/nope/refetch-metadata" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

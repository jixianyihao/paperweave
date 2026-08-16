import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";

const crossrefJson = {
  message: {
    title: ["Some DOI Paper"],
    author: [{ given: "Jane", family: "Doe" }],
    issued: { "date-parts": [[2021]] },
    "container-title": ["Nature"],
    DOI: "10.1000/xyz123",
  },
};

const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <title>Attention Is All You Need</title>
    <published>2017-06-12T17:57:34Z</published>
    <summary>Dominant…</summary>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`;

function fakeFetch() {
  return (async (url: unknown) => {
    const u = String(url);
    if (u.includes("api.crossref.org")) {
      return { ok: true, status: 200, json: async () => crossrefJson, text: async () => JSON.stringify(crossrefJson), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (u.includes("export.arxiv.org")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => arxivXml, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (u.includes("arxiv.org/pdf")) {
      const bytes = new TextEncoder().encode("%PDF-fake-arxiv");
      return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  }) as unknown as typeof fetch;
}

describe("POST /api/import/identifier", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const db = openDb(dir);
    const app = buildServer(db, { dataDir: dir, fetchImpl: fakeFetch() });
    return { db, app };
  }

  it("imports by DOI (metadata only, no pdf)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    expect(res.statusCode).toBe(200);
    const { item, pdf_downloaded, duplicate } = res.json();
    expect(item.title).toBe("Some DOI Paper");
    expect(item.venue).toBe("Nature");
    expect(pdf_downloaded).toBe(false);
    expect(duplicate).toBe(false);
    await app.close();
  });

  it("imports by arXiv id and downloads the pdf", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "1706.03762" } });
    const { item, pdf_downloaded } = res.json();
    expect(item.title).toBe("Attention Is All You Need");
    expect(pdf_downloaded).toBe(true);
    expect(existsSync(join(dir, "files", `${item.id}.pdf`))).toBe(true);
    await app.close();
  });

  it("detects duplicates by doi and returns the existing item", async () => {
    const { app } = await setup();
    const first = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    const second = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "10.1000/xyz123" } });
    expect(second.json().duplicate).toBe(true);
    expect(second.json().item.id).toBe(first.json().item.id);
    await app.close();
  });

  it("classifies https://doi.org/... as a doi and resolves via crossref", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "https://doi.org/10.1000/xyz123" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.title).toBe("Some DOI Paper");
    expect(res.json().duplicate).toBe(false);
    await app.close();
  });

  it("400s on unrecognizable input", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/identifier", payload: { input: "hello world" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

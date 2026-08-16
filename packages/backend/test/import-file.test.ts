import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import FormData from "form-data";

const sample = readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf"));

const crossrefJson = {
  message: {
    title: ["Attention Is All You Need"],
    author: [{ given: "Ashish", family: "Vaswani" }],
    issued: { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.48550/arXiv.1706.03762",
  },
};

function fetchOk() {
  return (async () => ({
    ok: true, status: 200,
    json: async () => crossrefJson,
    text: async () => JSON.stringify(crossrefJson),
  })) as unknown as typeof fetch;
}
function fetchBoom() {
  return (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
}

describe("POST /api/import/file", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function multipart() {
    const form = new FormData();
    form.append("file", sample, { filename: "attention.pdf", contentType: "application/pdf" });
    return form;
  }

  it("imports a pdf, stores it, fills metadata from crossref", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchOk() });
    const form = multipart();
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(metadata_status).toBe("complete");
    expect(item.title).toBe("Attention Is All You Need");
    expect(item.year).toBe(2017);
    expect(item.file_path).toBe(`files/${item.id}.pdf`);
    expect(existsSync(join(dir, "files", `${item.id}.pdf`))).toBe(true);
    await app.close();
  });

  it("still imports with provisional title when metadata lookup fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchBoom() });
    const form = multipart();
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(200);
    const { item, metadata_status } = res.json();
    expect(metadata_status).toBe("failed");
    expect(item.title).toBe("attention");
    await app.close();
  });

  it("rejects non-pdf uploads with 400", async () => {
    dir = mkdtempSync(join(tmpdir(), "pw-test-"));
    const app = buildServer(openDb(dir), { dataDir: dir, fetchImpl: fetchOk() });
    const form = new FormData();
    form.append("file", Buffer.from("hello"), { filename: "note.txt", contentType: "text/plain" });
    const res = await app.inject({ method: "POST", url: "/api/import/file", payload: form.getBuffer(), headers: form.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

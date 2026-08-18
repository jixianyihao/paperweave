import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { detectFormat, parseRis, parseBibtex, importRisBib } from "../src/lib/risbib.js";

// ---- 内嵌夹具 ----

const RIS_FIXTURE = `TY  - JOUR
TI  - Attention Is All You Need
AU  - Vaswani, Ashish
AU  - Shazeer, Noam
PY  - 2017
JO  - Advances in Neural Information Processing Systems
DO  - 10.48550/arXiv.1706.03762
ER  -

TY  - JOUR
TI  - BERT: Pre-training of Deep Bidirectional Transformers
AU  - Devlin, Jacob
AU  - Chang, Ming-Wei
PY  - 2019/05
JO  - NAACL
ER  -
`;

const RIS_MISSING_TITLE = `TY  - JOUR
AU  - Doe, Jane
PY  - 2020
ER  -
`;

const BIBTEX_FIXTURE = `@article{vaswani2017attention,
  title   = {Attention Is All You Need},
  author  = {Vaswani, Ashish and Shazeer, Noam},
  year    = {2017},
  journal = {NeurIPS},
  doi     = {10.48550/arXiv.1706.03762}
}

@inproceedings{devlin2019bert,
  title     = "BERT: {P}re-training of Deep Bidirectional Transformers",
  author    = "Devlin, Jacob and Chang, Ming-Wei",
  year      = 2019,
  booktitle = {NAACL}
}
`;

describe("detectFormat", () => {
  it("detects RIS and BibTeX, returns null for garbage", () => {
    expect(detectFormat(RIS_FIXTURE)).toBe("ris");
    expect(detectFormat(BIBTEX_FIXTURE)).toBe("bibtex");
    expect(detectFormat("hello world\nnothing here")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });
});

describe("parseRis", () => {
  it("parses TY/TI/AU/PY/JO/DO tags into entries", () => {
    const entries = parseRis(RIS_FIXTURE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      title: "Attention Is All You Need",
      creators: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      venue: "Advances in Neural Information Processing Systems",
      doi: "10.48550/arXiv.1706.03762",
      url: undefined,
      abstract: undefined,
    });
    expect(entries[1]).toMatchObject({
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      creators: ["Jacob Devlin", "Ming-Wei Chang"],
      year: 2019,
      venue: "NAACL",
    });
  });

  it("keeps entries with missing title (import layer decides failure)", () => {
    const entries = parseRis(RIS_MISSING_TITLE);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBeUndefined();
    expect(entries[0].creators).toEqual(["Jane Doe"]);
  });
});

describe("parseBibtex", () => {
  it("parses @entries with braced, quoted, and bare values", () => {
    const entries = parseBibtex(BIBTEX_FIXTURE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      title: "Attention Is All You Need",
      creators: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      venue: "NeurIPS",
      doi: "10.48550/arXiv.1706.03762",
      url: undefined,
      abstract: undefined,
    });
    expect(entries[1]).toMatchObject({
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      creators: ["Jacob Devlin", "Ming-Wei Chang"],
      year: 2019,
      venue: "NAACL",
    });
  });
});

describe("importRisBib", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-ris-"));
    return openDb(dir);
  }

  it("imports RIS entries as metadata-complete items without PDF", () => {
    const db = setup();
    const result = importRisBib(db, RIS_FIXTURE);
    expect(result).toEqual({ imported: 2, failed: 0 });
    const rows = db.prepare("SELECT * FROM items ORDER BY title").all() as {
      title: string; creators: string; year: number; venue: string; doi: string | null;
      file_path: string | null; metadata_status: string;
    }[];
    expect(rows).toHaveLength(2);
    const attn = rows.find((r) => r.title === "Attention Is All You Need")!;
    expect(attn.creators).toBe(JSON.stringify(["Ashish Vaswani", "Noam Shazeer"]));
    expect(attn.year).toBe(2017);
    expect(attn.venue).toBe("Advances in Neural Information Processing Systems");
    expect(attn.doi).toBe("10.48550/arXiv.1706.03762");
    expect(attn.file_path).toBeNull();
    expect(attn.metadata_status).toBe("complete");
    db.close();
  });

  it("imports BibTeX entries", () => {
    const db = setup();
    const result = importRisBib(db, BIBTEX_FIXTURE);
    expect(result).toEqual({ imported: 2, failed: 0 });
    const bert = db.prepare("SELECT * FROM items WHERE title LIKE 'BERT%'").get() as { creators: string; venue: string };
    expect(JSON.parse(bert.creators)).toEqual(["Jacob Devlin", "Ming-Wei Chang"]);
    expect(bert.venue).toBe("NAACL");
    db.close();
  });

  it("counts entries without title as failed and skips doi duplicates", () => {
    const db = setup();
    db.prepare("INSERT INTO items (id, title, doi) VALUES ('dup00001', 'Existing', '10.48550/arxiv.1706.03762')").run();
    const mixed = `${RIS_FIXTURE}${RIS_MISSING_TITLE}`;
    const result = importRisBib(db, mixed);
    // 3 条记录：1 条 doi 重复跳过、1 条正常导入、1 条无标题失败
    expect(result).toEqual({ imported: 1, failed: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 2 });
    db.close();
  });

  it("returns 0/0 for unrecognized content", () => {
    const db = setup();
    expect(importRisBib(db, "not a reference format")).toEqual({ imported: 0, failed: 0 });
    db.close();
  });
});

describe("POST /api/import/ris", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function setup() {
    dir = mkdtempSync(join(tmpdir(), "pw-ris-route-"));
    const db = openDb(dir);
    const app = buildServer(db, { dataDir: dir });
    return { db, app };
  }

  it("imports a batch of RIS records and returns counts", async () => {
    const { db, app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/ris", payload: { content: RIS_FIXTURE } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, failed: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 2 });
    await app.close();
    db.close();
  });

  it("imports BibTeX content through the same endpoint", async () => {
    const { db, app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/import/ris", payload: { content: BIBTEX_FIXTURE } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, failed: 0 });
    await app.close();
    db.close();
  });

  it("400s on empty body, extra fields, and unrecognized content", async () => {
    const { db, app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/import/ris", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/import/ris", payload: { content: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/import/ris", payload: { content: RIS_FIXTURE, nope: 1 } })).statusCode).toBe(400);
    const bad = await app.inject({ method: "POST", url: "/api/import/ris", payload: { content: "random prose" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
    db.close();
  });
});

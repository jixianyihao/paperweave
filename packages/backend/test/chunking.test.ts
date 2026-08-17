import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkPages, extractPages, DEFAULT_MAX_CHARS } from "../src/lib/chunking.js";

const sample = new Uint8Array(
  readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf")),
);

describe("chunkPages", () => {
  it("splits on paragraph boundaries and never merges across pages", () => {
    const para = (n: number, ch: string) => ch.repeat(n);
    const pages = [
      { page: 1, text: `${para(700, "a")}\n\n${para(700, "b")}\n\n${para(700, "c")}` },
      { page: 2, text: para(100, "d") },
    ];
    const chunks = chunkPages(pages, 1500);
    // page 1: a+b fits (700+2+700=1402), c overflows into its own chunk
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ page: 1, chunkIndex: 0 });
    expect(chunks[0].text).toContain("a");
    expect(chunks[0].text).toContain("b");
    expect(chunks[0].text).not.toContain("c");
    expect(chunks[1]).toMatchObject({ page: 1, chunkIndex: 1, text: para(700, "c") });
    expect(chunks[2]).toMatchObject({ page: 2, chunkIndex: 2, text: para(100, "d") });
  });

  it("hard-splits paragraphs longer than maxChars", () => {
    const long = "x".repeat(3200);
    const chunks = chunkPages([{ page: 5, text: long }], 1500);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.text.length)).toEqual([1500, 1500, 200]);
    expect(chunks.every((c) => c.page === 5)).toBe(true);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("flushes the current chunk before a long paragraph and resumes after it", () => {
    const pages = [{ page: 1, text: `short\n\n${"y".repeat(2000)}\n\ntail` }];
    const chunks = chunkPages(pages, 1500);
    expect(chunks.map((c) => c.text)).toEqual(["short", "y".repeat(1500), "y".repeat(500), "tail"]);
  });

  it("drops empty paragraphs and blank pages", () => {
    const chunks = chunkPages([
      { page: 1, text: "\n\n  \n\n" },
      { page: 2, text: "real text" },
    ]);
    expect(chunks).toEqual([{ page: 2, chunkIndex: 0, text: "real text" }]);
  });

  it("defaults to ~1500 chars per chunk", () => {
    expect(DEFAULT_MAX_CHARS).toBe(1500);
  });
});

describe("extractPages", () => {
  it("extracts per-page text from the sample pdf", async () => {
    const pages = await extractPages(sample);
    expect(pages.length).toBeGreaterThan(5);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain("Attention Is All You Need");
    // 段落重建：页面文本中应有空行分隔
    expect(pages[0].text).toMatch(/\n\s*\n/);
  });

  it("returns empty pages for a garbage buffer instead of throwing", async () => {
    const pages = await extractPages(new Uint8Array([37, 80, 68, 70]));
    expect(pages).toEqual([]);
  });
});

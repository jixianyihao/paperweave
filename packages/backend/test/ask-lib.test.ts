import { describe, it, expect } from "vitest";
import { cosine, topK, fullTextQaMessages, parseCitations, quoteOf } from "../src/lib/ask.js";

describe("cosine", () => {
  it("computes similarity for known vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
    expect(cosine(new Float32Array([1, 1]), new Float32Array([1, 0]))).toBeCloseTo(Math.SQRT1_2);
  });

  it("returns 0 for zero-norm or mismatched vectors", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosine(new Float32Array([1, 2, 3]), new Float32Array([1, 2]))).toBe(0);
  });
});

describe("topK", () => {
  const chunks = [
    { page: 1, text: "a", embedding: new Float32Array([1, 0]) },
    { page: 2, text: "b", embedding: new Float32Array([0.9, 0.1]) },
    { page: 3, text: "c", embedding: new Float32Array([0, 1]) },
    { page: 4, text: "d", embedding: new Float32Array([0.9, 0.1]) },
  ];

  it("ranks by cosine desc, ties keep document order, and caps at k", () => {
    const top = topK(chunks, new Float32Array([1, 0]), 3);
    expect(top.map((c) => c.text)).toEqual(["a", "b", "d"]);
  });

  it("returns all chunks when k exceeds the pool", () => {
    expect(topK(chunks, new Float32Array([0, 1]), 8)).toHaveLength(4);
  });
});

describe("fullTextQaMessages", () => {
  it("labels excerpts with [P{page}] markers and instructs citation output", () => {
    const msgs = fullTextQaMessages("什么是注意力？", [
      { page: 3, text: "Attention is..." },
      { page: 5, text: "The decoder..." },
    ]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("[P");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("[P3] Attention is...");
    expect(msgs[1].content).toContain("[P5] The decoder...");
    expect(msgs[1].content).toContain("什么是注意力？");
  });
});

describe("quoteOf", () => {
  it("keeps short text whole", () => {
    expect(quoteOf("short quote")).toBe("short quote");
  });

  it("keeps the first and last 80 chars of long text", () => {
    const text = "h".repeat(80) + "m".repeat(100) + "t".repeat(80);
    const q = quoteOf(text);
    expect(q).toBe(`${"h".repeat(80)}…${"t".repeat(80)}`);
    expect(q).not.toContain("m");
  });
});

describe("parseCitations", () => {
  const chunks = [
    { page: 3, text: "chunk on page three" },
    { page: 5, text: "chunk on page five" },
  ];

  it("parses [P{page}] markers in order and dedupes by page", () => {
    const citations = parseCitations("如[P5]所述，并且[P3]也提到[P5]……", chunks);
    expect(citations).toEqual([
      { page: 5, quote: "chunk on page five" },
      { page: 3, quote: "chunk on page three" },
    ]);
  });

  it("skips markers for pages not among the retrieved chunks", () => {
    expect(parseCitations("引用[P99]和[P3]", chunks)).toEqual([{ page: 3, quote: "chunk on page three" }]);
  });

  it("returns an empty array when there are no markers", () => {
    expect(parseCitations("没有引用", chunks)).toEqual([]);
  });
});

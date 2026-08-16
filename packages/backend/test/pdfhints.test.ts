import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfHints } from "../src/lib/pdfhints.js";

const sample = new Uint8Array(
  readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf")),
);

describe("extractPdfHints", () => {
  it("extracts text and finds the arXiv id in the Attention paper", async () => {
    const hints = await extractPdfHints(sample);
    expect(hints.firstText).toContain("Attention Is All You Need");
    expect(hints.arxivId).toBe("1706.03762");
  });

  it("returns nulls for a text-free buffer", async () => {
    const hints = await extractPdfHints(new Uint8Array([37, 80, 68, 70])); // "%PDF" garbage
    expect(hints.doi).toBeNull();
    expect(hints.arxivId).toBeNull();
  });
});

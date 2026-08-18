import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfHints, cleanDoi } from "../src/lib/pdfhints.js";

const sample = new Uint8Array(
  readFileSync(join(import.meta.dirname, "../../../apps/web/public/samples/sample.pdf")),
);

describe("extractPdfHints", () => {
  it("extracts text and finds the arXiv id in the Attention paper", async () => {
    const hints = await extractPdfHints(sample);
    expect(hints.firstText).toContain("Attention Is All You Need");
    expect(hints.arxivId).toBe("1706.03762");
  });

  it("does not detach the caller's buffer (pdfjs may transfer ownership)", async () => {
    const bytes = new Uint8Array(sample);
    const before = bytes.byteLength;
    await extractPdfHints(bytes);
    expect(bytes.byteLength).toBe(before);
  });

  it("returns nulls for a text-free buffer", async () => {
    const hints = await extractPdfHints(new Uint8Array([37, 80, 68, 70])); // "%PDF" garbage
    expect(hints.doi).toBeNull();
    expect(hints.arxivId).toBeNull();
  });
});

describe("cleanDoi", () => {
  it("strips trailing punctuation", () => {
    expect(cleanDoi("10.1000/xyz123).")).toBe("10.1000/xyz123");
    expect(cleanDoi("10.1000/xyz123,")).toBe("10.1000/xyz123");
    expect(cleanDoi("10.1000/xyz123;")).toBe("10.1000/xyz123");
    expect(cleanDoi("10.1000/xyz123]")).toBe("10.1000/xyz123");
    expect(cleanDoi("10.1000/xyz123")).toBe("10.1000/xyz123");
  });

  it("keeps interior punctuation that is part of the doi", () => {
    expect(cleanDoi("10.1000/x(1)y_z")).toBe("10.1000/x(1)y_z");
  });
});

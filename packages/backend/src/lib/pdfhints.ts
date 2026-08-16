import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
const ARXIV_RE = /(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/;

export interface PdfHints {
  doi: string | null;
  arxivId: string | null;
  firstText: string;
}

export async function extractPdfHints(pdfBytes: Uint8Array): Promise<PdfHints> {
  const none: PdfHints = { doi: null, arxivId: null, firstText: "" };
  let text = "";
  try {
    const doc = await getDocument({ data: pdfBytes, isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, 2);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    await doc.destroy();
  } catch {
    return none;
  }
  const doi = text.match(DOI_RE)?.[1] ?? null;
  const arxivId = text.match(ARXIV_RE)?.[1] ?? null;
  return { doi, arxivId, firstText: text.slice(0, 2000) };
}

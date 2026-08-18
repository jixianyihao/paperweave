import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
const ARXIV_RE = /(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/;

export interface PdfHints {
  doi: string | null;
  arxivId: string | null;
  firstText: string;
}

const DOI_TRAILING = new Set([".", ",", ";", ")", "]"]);

export function cleanDoi(s: string): string {
  let out = s;
  while (out.length > 0 && DOI_TRAILING.has(out[out.length - 1])) out = out.slice(0, -1);
  return out;
}

export async function extractPdfHints(pdfBytes: Uint8Array): Promise<PdfHints> {
  const none: PdfHints = { doi: null, arxivId: null, firstText: "" };
  let text = "";
  try {
    // 传副本：pdfjs 可能 detach（转移）传入 buffer 的所有权，
    // 调用方在提取后仍要用原始字节（如落盘保存）
    const doc = await getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false }).promise;
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
  const doiMatch = text.match(DOI_RE)?.[1] ?? null;
  const doi = doiMatch ? cleanDoi(doiMatch) : null;
  const arxivId = text.match(ARXIV_RE)?.[1] ?? null;
  return { doi, arxivId, firstText: text.slice(0, 2000) };
}

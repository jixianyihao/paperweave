import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const DEFAULT_MAX_CHARS = 1500;

export interface PageText {
  page: number;
  text: string;
}

export interface ChunkDraft {
  page: number;
  chunkIndex: number;
  text: string;
}

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
  transform?: unknown;
}

interface Line {
  text: string;
  y: number | null;
}

// pdfjs text items → 行（hasEOL 标记）→ 按行间垂直间距（> 1.5× 中位间距）重组段落
function itemsToText(items: TextItemLike[]): string {
  const lines: Line[] = [];
  let cur = "";
  for (const it of items) {
    if (typeof it.str === "string") cur += it.str;
    if (it.hasEOL === true) {
      const t = Array.isArray(it.transform) ? it.transform : null;
      const y = t && typeof t[5] === "number" ? (t[5] as number) : null;
      lines.push({ text: cur, y });
      cur = "";
    }
  }
  if (cur.trim()) lines.push({ text: cur, y: null });

  const gaps: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i].y;
    const b = lines[i + 1].y;
    if (a !== null && b !== null) gaps.push(Math.abs(a - b));
  }
  gaps.sort((x, y) => x - y);
  const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
  const threshold = median > 0 ? median * 1.5 : Number.POSITIVE_INFINITY;

  const paras: string[] = [];
  let para: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (t) para.push(t);
    const a = lines[i].y;
    const b = i + 1 < lines.length ? lines[i + 1].y : null;
    const gap = a !== null && b !== null ? Math.abs(a - b) : 0;
    if (para.length > 0 && (gap > threshold || i + 1 === lines.length)) {
      paras.push(para.join("\n"));
      para = [];
    }
  }
  return paras.join("\n\n");
}

// 逐页提取全文；无法解析的输入返回空数组而不是抛错（与 extractPdfHints 一致）
export async function extractPages(pdfBytes: Uint8Array): Promise<PageText[]> {
  try {
    const doc = await getDocument({ data: pdfBytes, isEvalSupported: false }).promise;
    try {
      const pages: PageText[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        pages.push({ page: p, text: itemsToText(content.items as TextItemLike[]) });
      }
      return pages;
    } finally {
      await doc.destroy();
    }
  } catch {
    return [];
  }
}

// 段落感知切块：不超过 maxChars，不跨页；超长段落按 maxChars 硬切
export function chunkPages(pages: PageText[], maxChars: number = DEFAULT_MAX_CHARS): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let idx = 0;
  for (const { page, text } of pages) {
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let cur = "";
    const flush = () => {
      if (cur) {
        out.push({ page, chunkIndex: idx++, text: cur });
        cur = "";
      }
    };
    for (const p of paras) {
      if (p.length > maxChars) {
        flush();
        for (let start = 0; start < p.length; start += maxChars) {
          out.push({ page, chunkIndex: idx++, text: p.slice(start, start + maxChars) });
        }
        continue;
      }
      if (cur && cur.length + 2 + p.length > maxChars) flush();
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    flush();
  }
  return out;
}

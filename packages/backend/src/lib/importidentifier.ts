import type Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchByDoi, fetchByArxiv, fetchByUrl, type PaperMeta, type FetchLike } from "./metadata.js";
import { insertItem, applyMeta } from "./importfile.js";
import type { ItemRow } from "../routes/items.js";

const DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const ARXIV_RE = /^(?:arXiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i;

export interface IdentifierResult {
  item: ItemRow;
  pdf_downloaded: boolean;
  duplicate: boolean;
}

export function classifyInput(input: string): { kind: "doi" | "arxiv" | "url"; value: string } | null {
  const s = input.trim();
  if (DOI_RE.test(s)) return { kind: "doi", value: s };
  const ax = s.match(ARXIV_RE);
  if (ax) return { kind: "arxiv", value: ax[1] };
  const doiInUrl = s.match(/(?:doi\.org\/)(10\.\d{4,9}\/[^\s]+)/i);
  if (doiInUrl) return { kind: "doi", value: doiInUrl[1] };
  if (/^https?:\/\//i.test(s)) return { kind: "url", value: s };
  return null;
}

function findDuplicate(db: Database.Database, meta: PaperMeta): ItemRow | null {
  if (meta.doi) {
    const row = db.prepare("SELECT * FROM items WHERE doi = ?").get(meta.doi) as ItemRow | undefined;
    if (row) return row;
  }
  if (meta.arxivId) {
    const row = db.prepare("SELECT * FROM items WHERE arxiv_id = ?").get(meta.arxivId) as ItemRow | undefined;
    if (row) return row;
  }
  return null;
}

async function tryDownloadPdf(
  pdfUrl: string, dataDir: string, itemId: string, fetchImpl: FetchLike,
): Promise<string | null> {
  try {
    const res = await fetchImpl(pdfUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // 校验 %PDF 魔数，过滤掉 HTML 错误页等非 PDF 响应
    if (buf.byteLength < 5 || String.fromCharCode(...buf.subarray(0, 5)) !== "%PDF-") return null;
    const filePath = `files/${itemId}.pdf`;
    writeFileSync(join(dataDir, filePath), buf);
    return filePath;
  } catch {
    return null;
  }
}

export async function importIdentifier(
  db: Database.Database, dataDir: string, input: string, fetchImpl: FetchLike,
): Promise<IdentifierResult | null> {
  const c = classifyInput(input);
  if (!c) return null;

  let meta: PaperMeta | null = null;
  if (c.kind === "doi") meta = await fetchByDoi(c.value, fetchImpl);
  else if (c.kind === "arxiv") meta = await fetchByArxiv(c.value, fetchImpl);
  else meta = await fetchByUrl(c.value, fetchImpl);
  if (!meta?.title) return null;

  const dup = findDuplicate(db, meta);
  if (dup) return { item: dup, pdf_downloaded: false, duplicate: true };

  const item = insertItem(db, { title: meta.title, doi: meta.doi ?? null, arxivId: meta.arxivId ?? null });
  applyMeta(db, item.id, meta);

  let pdf_downloaded = false;
  if (meta.pdfUrl) {
    const filePath = await tryDownloadPdf(meta.pdfUrl, dataDir, item.id, fetchImpl);
    if (filePath) {
      db.prepare("UPDATE items SET file_path = ? WHERE id = ?").run(filePath, item.id);
      pdf_downloaded = true;
    }
  }
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(item.id) as ItemRow;
  return { item: row, pdf_downloaded, duplicate: false };
}

import type Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { newKey } from "./keys.js";
import { extractPdfHints } from "./pdfhints.js";
import { fetchByDoi, fetchByArxiv, type PaperMeta, type FetchLike } from "./metadata.js";
import type { ItemRow } from "../routes/items.js";

export interface ImportResult {
  item: ItemRow;
  metadata_status: "complete" | "failed";
}

export function applyMeta(db: Database.Database, id: string, meta: PaperMeta): void {
  db.prepare(`
    UPDATE items SET title = ?, creators = ?, year = ?, venue = ?, doi = COALESCE(?, doi),
      arxiv_id = COALESCE(?, arxiv_id), abstract = COALESCE(?, abstract), url = COALESCE(?, url),
      metadata_status = 'complete', date_modified = datetime('now')
    WHERE id = ?
  `).run(
    meta.title ?? "Untitled",
    JSON.stringify(meta.creators ?? []),
    meta.year ?? null,
    meta.venue ?? null,
    meta.doi ?? null,
    meta.arxivId ?? null,
    meta.abstract ?? null,
    meta.url ?? null,
    id,
  );
}

function insertItemRow(
  db: Database.Database,
  fields: {
    id?: string;
    title: string;
    filePath?: string | null;
    doi?: string | null;
    arxivId?: string | null;
  },
): string {
  const id = fields.id ?? newKey();
  db.prepare(`
    INSERT INTO items (id, title, file_path, doi, arxiv_id, metadata_status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, fields.title, fields.filePath ?? null, fields.doi ?? null, fields.arxivId ?? null);
  return id;
}

export function insertItem(db: Database.Database, fields: {
  title: string; filePath?: string | null; doi?: string | null; arxivId?: string | null;
}): ItemRow {
  const id = insertItemRow(db, fields);
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
}

export async function importPdf(
  db: Database.Database,
  dataDir: string,
  pdfBytes: Uint8Array,
  filename: string,
  fetchImpl: FetchLike,
): Promise<ImportResult> {
  const provisional = filename.replace(/\.pdf$/i, "");
  const id = newKey();
  const filePath = `files/${id}.pdf`;
  writeFileSync(join(dataDir, filePath), pdfBytes);

  const hints = await extractPdfHints(pdfBytes);
  insertItemRow(db, { id, title: provisional, filePath, doi: hints.doi, arxivId: hints.arxivId });

  let meta: PaperMeta | null = null;
  if (hints.doi) meta = await fetchByDoi(hints.doi, fetchImpl);
  if (!meta && hints.arxivId) meta = await fetchByArxiv(hints.arxivId, fetchImpl);

  if (meta?.title) {
    applyMeta(db, id, meta);
  } else {
    db.prepare("UPDATE items SET metadata_status = 'failed' WHERE id = ?").run(id);
  }
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  return { item: row, metadata_status: row.metadata_status === "complete" ? "complete" : "failed" };
}

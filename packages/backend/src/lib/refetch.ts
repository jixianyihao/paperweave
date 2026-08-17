import type Database from "better-sqlite3";
import { fetchByDoi, fetchByArxiv, type PaperMeta, type FetchLike } from "./metadata.js";
import { applyMeta } from "./importfile.js";
import type { ItemRow } from "../routes/items.js";

export type RefetchResult =
  | { kind: "not_found" }
  | { kind: "no_identifier" }
  | { kind: "ok"; item: ItemRow };

export async function refetchMetadata(
  db: Database.Database,
  id: string,
  fetchImpl: FetchLike,
): Promise<RefetchResult> {
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
  if (!row) return { kind: "not_found" };
  if (!row.doi && !row.arxiv_id) return { kind: "no_identifier" };

  let meta: PaperMeta | null = null;
  if (row.doi) meta = await fetchByDoi(row.doi, fetchImpl);
  if (!meta?.title && row.arxiv_id) meta = await fetchByArxiv(row.arxiv_id, fetchImpl);

  if (meta?.title) {
    applyMeta(db, id, meta);
  } else {
    db.prepare("UPDATE items SET metadata_status = 'failed', date_modified = datetime('now') WHERE id = ?").run(id);
  }
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  return { kind: "ok", item };
}

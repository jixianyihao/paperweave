import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface ItemRow {
  id: string;
  title: string;
  creators: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  abstract: string | null;
  file_path: string | null;
  reading_status: "unread" | "reading" | "read";
  starred: number;
  date_added: string;
  date_modified: string;
}

export function registerItemRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/items", async (): Promise<ItemRow[]> => {
    return db.prepare("SELECT * FROM items ORDER BY date_added DESC, id DESC").all() as ItemRow[];
  });
}

import { XMLParser } from "fast-xml-parser";

export interface PaperMeta {
  title?: string;
  creators: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  abstract?: string;
  url?: string;
  pdfUrl?: string;
}

export type FetchLike = typeof fetch;

export async function fetchByDoi(doi: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!res.ok) return null;
    const { message: m } = await res.json();
    if (!m?.title?.[0]) return null;
    return {
      title: m.title[0],
      creators: (m.author ?? []).map((a: { given?: string; family?: string }) =>
        [a.given, a.family].filter(Boolean).join(" ")),
      year: m.issued?.["date-parts"]?.[0]?.[0],
      venue: m["container-title"]?.[0],
      doi: m.DOI ?? doi,
      abstract: typeof m.abstract === "string" ? m.abstract.replace(/<[^>]+>/g, "") : undefined,
      url: m.URL,
      pdfUrl: (m.link ?? []).find((l: { "content-type"?: string }) => l["content-type"] === "application/pdf")?.URL,
    };
  } catch {
    return null;
  }
}

export async function fetchByArxiv(arxivId: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
    const entry = parsed?.feed?.entry;
    if (!entry?.title) return null;
    const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
    return {
      title: String(entry.title).replace(/\s+/g, " ").trim(),
      creators: authors.filter(Boolean).map((a: { name: string }) => a.name),
      year: entry.published ? Number(String(entry.published).slice(0, 4)) : undefined,
      arxivId,
      abstract: entry.summary ? String(entry.summary).replace(/\s+/g, " ").trim() : undefined,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  } catch {
    return null;
  }
}

export async function fetchByUrl(url: string, fetchImpl: FetchLike = fetch): Promise<PaperMeta | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const html = await res.text();
    const tags = new Map<string, string[]>();
    for (const match of html.matchAll(/<meta[^>]+name=["'](citation_[a-z_]+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi)) {
      const key = match[1].toLowerCase();
      tags.set(key, [...(tags.get(key) ?? []), match[2]]);
    }
    // content 在 name 之前的写法也兼容
    for (const match of html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["'](citation_[a-z_]+)["'][^>]*>/gi)) {
      const key = match[2].toLowerCase();
      tags.set(key, [...(tags.get(key) ?? []), match[1]]);
    }
    const title = tags.get("citation_title")?.[0];
    if (!title) return null;
    const yearRaw = tags.get("citation_publication_date")?.[0] ?? tags.get("citation_date")?.[0];
    return {
      title,
      creators: tags.get("citation_author") ?? [],
      year: yearRaw ? Number(yearRaw.slice(0, 4)) : undefined,
      venue: tags.get("citation_journal_title")?.[0] ?? tags.get("citation_conference_title")?.[0],
      doi: tags.get("citation_doi")?.[0],
      arxivId: tags.get("citation_arxiv_id")?.[0],
      abstract: tags.get("citation_abstract")?.[0],
      url,
      pdfUrl: tags.get("citation_pdf_url")?.[0],
    };
  } catch {
    return null;
  }
}

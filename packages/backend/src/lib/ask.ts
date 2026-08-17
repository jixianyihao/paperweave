import type { ChatMessage } from "./llm/common.js";

export interface ScoredChunk {
  page: number;
  text: string;
  embedding: Float32Array;
}

export interface Citation {
  page: number;
  quote: string;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// brute-force cosine top-k；分数相同保持文档顺序（确定性）
export function topK<T extends ScoredChunk>(chunks: T[], query: Float32Array, k: number): T[] {
  return chunks
    .map((c, i) => ({ c, i, score: cosine(c.embedding, query) }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, k)
    .map((s) => s.c);
}

const QUOTE_HALF = 80;

// 引用片段：chunk 首尾各 80 字符
export function quoteOf(text: string): string {
  if (text.length <= QUOTE_HALF * 2) return text;
  return `${text.slice(0, QUOTE_HALF)}…${text.slice(text.length - QUOTE_HALF)}`;
}

export function fullTextQaMessages(
  question: string,
  chunks: { page: number; text: string }[],
): ChatMessage[] {
  const excerpts = chunks.map((c) => `[P${c.page}] ${c.text}`).join("\n\n");
  return [
    {
      role: "system",
      content: "You are an expert academic reading assistant. Answer the user's question using only the provided excerpts from the paper. "
        + "Each excerpt is prefixed with its page marker like [P3]. Whenever you use information from an excerpt, cite it by appending its marker (e.g. [P3]) to the sentence. "
        + "If the excerpts do not contain the answer, say so instead of guessing.",
    },
    { role: "user", content: `Excerpts from the paper:\n\n${excerpts}\n\nQuestion: ${question}` },
  ];
}

const MARKER_RE = /\[P(\d+)\]/g;

// 把回答里的 [P{page}] 标记解析成 citations（按出现顺序去重，忽略未检索到的页）
export function parseCitations(answer: string, chunks: { page: number; text: string }[]): Citation[] {
  const byPage = new Map<number, string>();
  for (const c of chunks) {
    if (!byPage.has(c.page)) byPage.set(c.page, c.text);
  }
  const seen = new Set<number>();
  const out: Citation[] = [];
  for (const m of answer.matchAll(MARKER_RE)) {
    const page = Number(m[1]);
    const text = byPage.get(page);
    if (text === undefined || seen.has(page)) continue;
    seen.add(page);
    out.push({ page, quote: quoteOf(text) });
  }
  return out;
}

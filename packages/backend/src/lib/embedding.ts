import type Database from "better-sqlite3";
import { resolveRoute } from "./llm/router.js";
import { httpError, type FetchLike } from "./llm/common.js";

export const EMBEDDING_UNCONFIGURED = "未配置 embedding 模型，全文问答不可用";

export type EmbedResult =
  | { ok: true; vectors: Float32Array[] }
  | { ok: false; error: string };

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function blobToVector(b: Uint8Array): Float32Array {
  const buf = Buffer.from(b);
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy);
}

interface EmbeddingsResponse {
  data?: { embedding?: unknown; index?: unknown }[];
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
}

// 走任务路由 embedding 的服务商，OpenAI 兼容 POST {base}/embeddings
export async function embedTexts(
  db: Database.Database,
  texts: string[],
  opts: { fetchImpl: FetchLike },
): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, vectors: [] };
  const resolved = resolveRoute(db, "embedding");
  if (!resolved.ok) return { ok: false, error: EMBEDDING_UNCONFIGURED };
  const { llm } = resolved;
  if (llm.client !== "openai") return { ok: false, error: EMBEDDING_UNCONFIGURED };
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (llm.apiKey) headers.authorization = `Bearer ${llm.apiKey}`;
    const res = await opts.fetchImpl(`${llm.baseUrl.replace(/\/+$/, "")}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: llm.model, input: texts }),
    });
    if (!res.ok) throw await httpError(res, "openai-compatible embeddings");
    const json = (await res.json()) as EmbeddingsResponse;
    const data = json.data ?? [];
    const vectors: (Float32Array | undefined)[] = new Array(texts.length);
    data.forEach((d, i) => {
      const idx = typeof d.index === "number" ? d.index : i;
      if (Array.isArray(d.embedding) && idx >= 0 && idx < texts.length) {
        vectors[idx] = new Float32Array(d.embedding as number[]);
      }
    });
    if (vectors.some((v) => v === undefined)) {
      throw new Error("embeddings response is missing vectors");
    }
    db.prepare("INSERT INTO usage_log (task, provider_id, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?)")
      .run("embedding", llm.providerId, llm.model,
        typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null, null);
    return { ok: true, vectors: vectors as Float32Array[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

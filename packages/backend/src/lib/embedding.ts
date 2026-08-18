import type Database from "better-sqlite3";
import { resolveRoute } from "./llm/router.js";
import { httpError, type FetchLike } from "./llm/common.js";
import { embedLocal, E5_PREFIX, LOCAL_EMBEDDING_MODEL, type EmbedRole } from "./embedding-local.js";

export type EmbedResult =
  | { ok: true; vectors: Float32Array[] }
  // reason 区分"本地兜底失败"与"上游瞬时失败"，调用方据此决定错误帧文案与是否可重试
  | { ok: false; reason: "local" | "upstream"; error: string };

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
  opts: { fetchImpl: FetchLike; role?: EmbedRole },
): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, vectors: [] };
  const resolved = resolveRoute(db, "embedding");
  // 用户显式配置的 OpenAI 兼容 embedding 路由优先；否则回落本地 ONNX 模型（无需 key/网络）
  if (!resolved.ok || resolved.llm.client !== "openai") {
    return embedTextsLocal(db, texts, opts.role ?? "passage");
  }
  const { llm } = resolved;
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
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "upstream", error: `embedding 调用失败: ${msg}` };
  }
}

// 本地兜底：进程内 ONNX 模型（e5 要求按用途加 query:/passage: 前缀）
async function embedTextsLocal(db: Database.Database, texts: string[], role: EmbedRole): Promise<EmbedResult> {
  const prefix = E5_PREFIX[role];
  try {
    const vecs = await embedLocal(texts.map((t) => prefix + t));
    db.prepare("INSERT INTO usage_log (task, provider_id, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?)")
      .run("embedding", null, LOCAL_EMBEDDING_MODEL, null, null);
    return { ok: true, vectors: vecs.map((v) => new Float32Array(v)) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "local", error: msg };
  }
}

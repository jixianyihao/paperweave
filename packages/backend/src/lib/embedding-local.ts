import { join } from "node:path";
import { existsSync } from "node:fs";
import { dataDir } from "../db.js";

// 多语言小模型（~120MB），首次使用从 huggingface.co 下载，之后完全离线
export const LOCAL_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

// e5 系列模型要求按用途加前缀，否则检索质量显著下降
export const E5_PREFIX = { query: "query: ", passage: "passage: " } as const;
export type EmbedRole = keyof typeof E5_PREFIX;

// 结构化的最小类型，避免静态依赖 @xenova/transformers 的类型（动态 import 才加载）
export interface TensorLike {
  tolist(): number[][];
}
export type LocalPipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: true },
) => Promise<TensorLike>;
export type PipelineFactory = (task: "feature-extraction", model: string) => Promise<LocalPipeline>;

async function defaultFactory(task: "feature-extraction", model: string): Promise<LocalPipeline> {
  const mod = await import("@xenova/transformers");
  // 必须在首次 pipeline 调用前设置缓存目录：模型落在 <dataDir>/models/
  const cacheDir = join(dataDir(), "models");
  mod.env.cacheDir = cacheDir;
  // HF_ENDPOINT 可覆盖下载源（如国内用 https://hf-mirror.com）
  if (process.env.HF_ENDPOINT) mod.env.remoteHost = process.env.HF_ENDPOINT;
  // 缓存里已有模型时强制纯本地加载，避免 transformers.js 联网校验在受限网络下失败
  if (existsSync(join(cacheDir, model, "config.json"))) {
    mod.env.localModelPath = cacheDir;
    mod.env.allowRemoteModels = false;
  }
  const pipe = await mod.pipeline(task, model);
  return pipe as unknown as LocalPipeline;
}

let factory: PipelineFactory = defaultFactory;
let embedderPromise: Promise<LocalPipeline> | null = null;

// 测试注入：替换 pipeline 工厂（传 null 还原默认实现）。切换工厂会丢弃已缓存的 embedder。
export function setLocalPipelineFactory(f: PipelineFactory | null): void {
  factory = f ?? defaultFactory;
  embedderPromise = null;
}

// 懒加载单例：首次调用才动态 import 重库并下载/加载模型；
// 加载失败不缓存 rejected promise，下次调用自动重试（如下载网络恢复后）
export function getEmbedder(): Promise<LocalPipeline> {
  if (!embedderPromise) {
    const p = factory("feature-extraction", LOCAL_EMBEDDING_MODEL);
    embedderPromise = p;
    p.catch(() => { if (embedderPromise === p) embedderPromise = null; });
  }
  return embedderPromise;
}

export async function embedLocal(texts: string[]): Promise<number[][]> {
  let pipe: LocalPipeline;
  try {
    pipe = await getEmbedder();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`本地 embedding 模型下载失败: ${msg}`);
  }
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

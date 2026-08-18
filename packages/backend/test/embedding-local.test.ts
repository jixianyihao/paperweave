import { describe, it, expect, afterEach } from "vitest";
import {
  embedLocal,
  getEmbedder,
  setLocalPipelineFactory,
  LOCAL_EMBEDDING_MODEL,
  type LocalPipeline,
} from "../src/lib/embedding-local.js";

afterEach(() => { setLocalPipelineFactory(null); });

function fakePipeline(vectors: number[][], capture?: { texts: string[]; opts: unknown }): LocalPipeline {
  return (async (texts: string[], opts: unknown) => {
    if (capture) { capture.texts = texts; capture.opts = opts; }
    return { tolist: () => vectors };
  }) as LocalPipeline;
}

describe("embedding-local", () => {
  it("getEmbedder is a lazy singleton: factory runs once across calls", async () => {
    let calls = 0;
    setLocalPipelineFactory(async (task, model) => {
      calls += 1;
      expect(task).toBe("feature-extraction");
      expect(model).toBe(LOCAL_EMBEDDING_MODEL);
      return fakePipeline([[1, 0]]);
    });
    const [a, b] = await Promise.all([getEmbedder(), getEmbedder()]);
    expect(a).toBe(b);
    await getEmbedder();
    expect(calls).toBe(1);
  });

  it("embedLocal requests mean pooling + normalization and returns tolist() rows", async () => {
    const capture: { texts: string[]; opts: unknown } = { texts: [], opts: null };
    const n = Math.SQRT1_2;
    setLocalPipelineFactory(async () => fakePipeline([[n, n, 0], [0, 1, 0]], capture));
    const out = await embedLocal(["passage: hello", "passage: world"]);
    expect(capture.opts).toEqual({ pooling: "mean", normalize: true });
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(3);
    // 归一化向量：点积即余弦相似度，模长为 1
    for (const v of out) {
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
  });

  it("download failure produces a clear error and the next call retries the factory", async () => {
    let calls = 0;
    setLocalPipelineFactory(async () => {
      calls += 1;
      if (calls === 1) throw new Error("getaddrinfo ENOTFOUND huggingface.co");
      return fakePipeline([[1, 0]]);
    });
    await expect(embedLocal(["x"])).rejects.toThrow("本地 embedding 模型下载失败: getaddrinfo ENOTFOUND huggingface.co");
    // 失败后不缓存 rejected promise → 重试成功
    await expect(embedLocal(["x"])).resolves.toEqual([[1, 0]]);
    expect(calls).toBe(2);
  });

  it("inference errors propagate without the download prefix", async () => {
    setLocalPipelineFactory(async () => (async () => { throw new Error("onnx runtime boom"); }) as LocalPipeline);
    await expect(embedLocal(["x"])).rejects.toThrow("onnx runtime boom");
  });
});

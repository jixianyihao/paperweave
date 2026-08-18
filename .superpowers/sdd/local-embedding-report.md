# Local Embedding Provider — Report

Date: 2026-08-19

## Status

Complete. Full-text Q&A (`POST /api/items/:id/ask`) now works with zero API keys:
when no embedding provider is configured, an in-process ONNX model
(`Xenova/multilingual-e5-small`, ~120MB, multilingual) is used via
`@xenova/transformers` v2.17.2. An explicitly configured OpenAI-compatible
embedding provider still wins.

## What changed

- `packages/backend/src/lib/embedding-local.ts` (new)
  - Lazy singleton `getEmbedder()`: dynamic `import("@xenova/transformers")` only
    on first use; `env.cacheDir = <dataDir>/models` set before the first pipeline call.
  - Failed loads are NOT cached — the next call retries automatically (download recovery).
  - `embedLocal(texts)` → mean-pooled, normalized `number[][]` (`pooling: "mean", normalize: true`).
  - `setLocalPipelineFactory()` lets tests inject a fake pipeline (zero network in tests).
  - E5 prefixes exported as `E5_PREFIX` (`query: ` / `passage: `).
- `packages/backend/src/lib/embedding.ts`
  - `embedTexts(db, texts, { fetchImpl, role? })`: resolves the embedding route; if it
    fails or isn't an OpenAI client → local fallback with the e5 prefix for `role`
    (default `passage`). The `EMBEDDING_UNCONFIGURED` error path is removed.
  - Local failures return `{ ok: false, reason: "local" }`; model-load failures carry
    the message `本地 embedding 模型下载失败: <cause>`.
  - Local embeddings are logged to `usage_log` with `provider_id = NULL`,
    `model = Xenova/multilingual-e5-small`.
- `packages/backend/src/routes/ask.ts`: the question embedding is tagged `role: "query"`.
- `pnpm-workspace.yaml`: `allowBuilds` entries for new transitive deps
  (`protobufjs: false`, `sharp: false` — neither build script is needed for text
  embeddings). Without this the pnpm wrapper's deps check failed every command.

## Commits (master)

1. `45c14a4` chore(backend): add @xenova/transformers
2. `536c6ae` feat(backend): local ONNX embedding module with lazy injectable pipeline
3. `f1b84c3` chore: decline build scripts for protobufjs/sharp
4. `25a87ad` feat(backend): fall back to local ONNX embeddings when no route configured

## Tests

`pnpm -F @paperweave/backend test`: 25 files, 201 tests, all green (was 195).
`pnpm -F @paperweave/backend build` (tsc): clean.

New/updated coverage:
- `test/embedding-local.test.ts` (new, 4 tests): lazy singleton (factory called once,
  concurrent calls share it), mean-pool/normalize options + unit-norm output shape,
  download failure message + retry, inference error passthrough.
- `test/embedding.test.ts`: unconfigured/anthropic routes now fall back to local;
  verifies passage/query prefixing, usage_log attribution, download-failure error frame.
- `test/ask.test.ts`: the old "unconfigured → error frame" test is replaced by an
  end-to-end test with NO embedding provider (qa routed to a fake OpenAI provider):
  chunks embedded locally, `passage: `-prefixed inputs, `query: `-prefixed question,
  `/embeddings` never fetched, citations returned. The backfill test now simulates a
  failed model download, then recovery via a configured remote route.

## Operational notes / concerns

- First real (non-test) ask downloads ~120MB from huggingface.co into
  `<dataDir>/models/`. Machines behind a proxy/firewall need HF access (set
  `HF_ENDPOINT` or standard proxy env vars if needed). After download it is fully offline.
- Cold-start latency: model load + first inference takes seconds; subsequent asks reuse
  the singleton. The SSE stream just starts later — no timeout logic was changed.
- onnxruntime-node ships prebuilt binaries for mac/linux/win x64+arm64; no build
  script approval was needed for it (verified in install output).
- If a previously-embedded library used a remote model and later falls back to local
  (or vice versa), old chunk vectors and new query vectors live in different spaces —
  retrieval degrades silently. Only affects items whose chunks were embedded before a
  provider change; re-embedding on provider switch is out of scope.

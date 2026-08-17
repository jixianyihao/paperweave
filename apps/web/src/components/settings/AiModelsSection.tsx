import { useCallback, useEffect, useState } from "react";
import {
  createProvider,
  deleteProvider,
  listProviders,
  listTaskRoutes,
  patchTaskRoute,
  testProvider,
  updateProvider,
} from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { parseModels, type AiTask, type Provider, type ProviderKind, type TaskRoute } from "../../api/types";
import { useToastStore } from "../../stores/toastStore";

const TASK_LABEL: Record<AiTask, string> = {
  translate: "翻译",
  summarize: "摘要",
  explain: "讲解",
  qa: "问答",
  voice: "语音摘要",
  embedding: "向量嵌入",
};

const KIND_LABEL: Record<ProviderKind, string> = {
  builtin: "内置",
  anthropic: "Anthropic",
  openai: "OpenAI",
  custom: "自定义",
};

function ProviderForm({ onCreated }: { onCreated: () => void }) {
  const push = useToastStore((s) => s.push);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !label.trim()) return;
    setBusy(true);
    try {
      await createProvider({
        kind,
        label: label.trim(),
        ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        models: models
          .split(/[,\n]/)
          .map((m) => m.trim())
          .filter(Boolean),
      });
      push("服务商已添加", "success");
      setLabel("");
      setBaseUrl("");
      setApiKey("");
      setModels("");
      onCreated();
    } catch (e) {
      push(e instanceof ApiError ? `添加失败：${e.message}` : "添加失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    "rounded border border-line dark:border-dline bg-paper dark:bg-dcream px-2 py-1 text-sm outline-none focus:border-navy dark:focus:border-dnavy";

  return (
    <form
      aria-label="添加服务商"
      className="rounded border border-line dark:border-dline p-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        <select
          aria-label="类型"
          value={kind}
          onChange={(e) => setKind(e.target.value as ProviderKind)}
          className={fieldCls}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="custom">自定义（OpenAI 兼容）</option>
          <option value="builtin">内置</option>
        </select>
        <input aria-label="显示名" placeholder="显示名，如：我的 DeepSeek" value={label} onChange={(e) => setLabel(e.target.value)} className={`flex-1 ${fieldCls}`} />
      </div>
      <input
        aria-label="Base URL"
        placeholder={kind === "custom" ? "Base URL（自定义必填）" : "Base URL（可选，留空用默认）"}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        className={fieldCls}
      />
      <input
        aria-label="API Key"
        placeholder="API Key（仅存本地）"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        className={fieldCls}
      />
      <input
        aria-label="模型列表"
        placeholder="模型列表，逗号分隔，如：deepseek-chat, deepseek-reasoner"
        value={models}
        onChange={(e) => setModels(e.target.value)}
        className={fieldCls}
      />
      <div className="text-right">
        <button
          type="submit"
          disabled={busy || !label.trim() || (kind === "custom" && !baseUrl.trim())}
          className="px-3 py-1 rounded bg-navy text-paper dark:bg-dnavy dark:text-dpaper text-sm disabled:opacity-50"
        >
          {busy ? "添加中…" : "添加服务商"}
        </button>
      </div>
    </form>
  );
}

/** AI 与模型：服务商列表 + 任务路由（对接契约 A6） */
export default function AiModelsSection() {
  const push = useToastStore((s) => s.push);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [routes, setRoutes] = useState<TaskRoute[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, r] = await Promise.all([listProviders(), listTaskRoutes()]);
      setProviders(p);
      setRoutes(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败");
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onTest = async (p: Provider) => {
    try {
      const res = await testProvider(p.id);
      push(res.ok ? `${p.label} 连接正常` : `${p.label} 连接失败：${res.error ?? "未知错误"}`, res.ok ? "success" : "error");
    } catch (e) {
      push(e instanceof ApiError ? `测试失败：${e.message}` : "测试失败", "error");
    }
  };

  const onDelete = async (p: Provider) => {
    try {
      await deleteProvider(p.id);
      push(`已删除 ${p.label}`, "info");
      void load();
    } catch (e) {
      push(e instanceof ApiError ? `删除失败：${e.message}` : "删除失败", "error");
    }
  };

  const onToggleEnabled = async (p: Provider) => {
    try {
      await updateProvider(p.id, { enabled: p.enabled === 1 ? 0 : 1 });
      void load();
    } catch (e) {
      push(e instanceof ApiError ? `更新失败：${e.message}` : "更新失败", "error");
    }
  };

  const onRouteChange = async (task: AiTask, providerId: string | null, model: string | null) => {
    try {
      await patchTaskRoute(task, providerId, model);
      setRoutes((rs) => rs.map((r) => (r.task === task ? { ...r, provider_id: providerId, model } : r)));
      push(`已更新「${TASK_LABEL[task]}」路由`, "success");
    } catch (e) {
      push(e instanceof ApiError ? `路由更新失败：${e.message}` : "路由更新失败", "error");
    }
  };

  return (
    <section aria-label="AI 与模型设置" className="flex flex-col gap-6">
      <h2 className="text-lg font-bold">AI 与模型</h2>

      <div>
        <h3 className="text-sm font-bold mb-2">服务商</h3>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400 mb-2">{error}</p>}
        {providers === null && <p className="text-sm text-muted dark:text-dmuted">加载中…</p>}
        {providers !== null && providers.length === 0 && (
          <p className="text-sm text-muted dark:text-dmuted mb-2">还没有服务商，请在下方添加。</p>
        )}
        <ul aria-label="服务商列表" className="flex flex-col gap-2 mb-3">
          {(providers ?? []).map((p) => (
            <li
              key={p.id}
              className="rounded border border-line dark:border-dline p-3 flex items-center gap-3 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {p.label}
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-line dark:border-dline text-muted dark:text-dmuted">
                    {KIND_LABEL[p.kind]}
                  </span>
                  {p.enabled === 0 && (
                    <span className="ml-1 text-xs text-muted dark:text-dmuted">（已停用）</span>
                  )}
                </div>
                <div className="text-xs text-muted dark:text-dmuted truncate">
                  {p.base_url ?? "默认端点"} · {p.has_key ? "已配置密钥" : "未配置密钥"}
                  {parseModels(p).length > 0 && ` · 模型：${parseModels(p).join(", ")}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onToggleEnabled(p)}
                className="text-xs px-2 py-1 rounded border border-line dark:border-dline hover:bg-hoverbg dark:hover:bg-dhover"
              >
                {p.enabled === 1 ? "停用" : "启用"}
              </button>
              <button
                type="button"
                onClick={() => void onTest(p)}
                className="text-xs px-2 py-1 rounded border border-line dark:border-dline hover:bg-hoverbg dark:hover:bg-dhover"
              >
                测试连接
              </button>
              <button
                type="button"
                onClick={() => void onDelete(p)}
                className="text-xs px-2 py-1 rounded border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
        <ProviderForm onCreated={() => void load()} />
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">任务路由</h3>
        <p className="text-xs text-muted dark:text-dmuted mb-2">为每类 AI 任务指定服务商与模型；「内置默认」使用 PaperWeave 内置额度。</p>
        <ul aria-label="任务路由" className="flex flex-col gap-2">
          {routes.map((r) => {
            const provider = (providers ?? []).find((p) => p.id === r.provider_id);
            const models = provider ? parseModels(provider) : [];
            return (
              <li key={r.task} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0">{TASK_LABEL[r.task]}</span>
                <select
                  aria-label={`${TASK_LABEL[r.task]}服务商`}
                  value={r.provider_id ?? ""}
                  onChange={(e) => {
                    const pid = e.target.value || null;
                    void onRouteChange(r.task, pid, null);
                  }}
                  className="rounded border border-line dark:border-dline bg-paper dark:bg-dcream px-2 py-1 text-sm"
                >
                  <option value="">内置默认</option>
                  {(providers ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${TASK_LABEL[r.task]}模型`}
                  value={r.model ?? ""}
                  disabled={!r.provider_id}
                  onChange={(e) => void onRouteChange(r.task, r.provider_id, e.target.value || null)}
                  className="rounded border border-line dark:border-dline bg-paper dark:bg-dcream px-2 py-1 text-sm disabled:opacity-50"
                >
                  <option value="">默认模型</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

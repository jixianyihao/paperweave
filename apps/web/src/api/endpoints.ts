// 契约端点的类型化封装；组件只调用这里或 apiFetch，绝不裸写 fetch。
import { apiFetch, apiSse, jsonInit, type SseFrame, type SseOptions } from "./client";
import type {
  AiTask,
  Annotation,
  Collection,
  Conversation,
  ExplainLevel,
  FileImportResult,
  IdentifierImportResult,
  Item,
  Message,
  Provider,
  ProviderKind,
  RisImportResult,
  Tag,
  TaskRoute,
  UsageSummary,
} from "./types";

export interface ItemFilterParams {
  collection?: string;
  tag?: string;
  status?: "unread" | "reading" | "read";
  starred?: 1;
  q?: string;
}

export function listItems(filter: ItemFilterParams = {}): Promise<Item[]> {
  const params = new URLSearchParams();
  if (filter.collection) params.set("collection", filter.collection);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.status) params.set("status", filter.status);
  if (filter.starred === 1) params.set("starred", "1");
  if (filter.q) params.set("q", filter.q);
  const qs = params.toString();
  return apiFetch<Item[]>(`/api/items${qs ? `?${qs}` : ""}`);
}

export function getItem(id: string): Promise<Item> {
  return apiFetch<Item>(`/api/items/${encodeURIComponent(id)}`);
}

export function searchItems(q: string): Promise<{ items: Item[] }> {
  return apiFetch<{ items: Item[] }>(`/api/search?q=${encodeURIComponent(q)}`);
}

export function listCollections(): Promise<Collection[]> {
  return apiFetch<Collection[]>("/api/collections");
}

export function listTags(): Promise<Tag[]> {
  return apiFetch<Tag[]>("/api/tags");
}

export function refetchMetadata(id: string): Promise<{ item: Item; metadata_status: Item["metadata_status"] }> {
  return apiFetch(`/api/items/${encodeURIComponent(id)}/refetch-metadata`, { method: "POST" });
}

export function importFile(file: File): Promise<FileImportResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiFetch<FileImportResult>("/api/import/file", { method: "POST", body: form });
}

export function importIdentifier(input: string): Promise<IdentifierImportResult> {
  return apiFetch<IdentifierImportResult>("/api/import/identifier", jsonInit("POST", { input }));
}

/** RIS / BibTeX 迁移导入：后端契约要求 JSON body { content }（非 multipart） */
export function importRis(content: string): Promise<RisImportResult> {
  return apiFetch<RisImportResult>("/api/import/ris", jsonInit("POST", { content }));
}

// ---- A6 LLM 网关 ----

export function listProviders(): Promise<Provider[]> {
  return apiFetch<Provider[]>("/api/providers");
}

export interface CreateProviderInput {
  kind: ProviderKind;
  label: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
}

export function createProvider(input: CreateProviderInput): Promise<Provider> {
  return apiFetch<Provider>("/api/providers", jsonInit("POST", input));
}

export function updateProvider(
  id: string,
  patch: Partial<{ label: string; base_url: string; api_key: string; models: string[]; enabled: 0 | 1 }>,
): Promise<Provider> {
  return apiFetch<Provider>(`/api/providers/${encodeURIComponent(id)}`, jsonInit("PATCH", patch));
}

export function deleteProvider(id: string): Promise<void> {
  return apiFetch<void>(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testProvider(id: string): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(`/api/providers/${encodeURIComponent(id)}/test`, { method: "POST" });
}

export function listTaskRoutes(): Promise<TaskRoute[]> {
  return apiFetch<TaskRoute[]>("/api/task-routes");
}

export function patchTaskRoute(task: AiTask, providerId: string | null, model: string | null): Promise<TaskRoute> {
  return apiFetch<TaskRoute>("/api/task-routes", jsonInit("PATCH", { task, provider_id: providerId, model }));
}

export function getUsage(): Promise<UsageSummary> {
  return apiFetch<UsageSummary>("/api/usage");
}

// ---- A5 标注与时间流 ----

export function listAnnotations(itemId: string): Promise<Annotation[]> {
  return apiFetch<Annotation[]>(`/api/items/${encodeURIComponent(itemId)}/annotations`);
}

export interface CreateAnnotationInput {
  type: Annotation["type"];
  content: string;
  page?: number | null;
  position?: string | null;
  color?: string | null;
}

export function createAnnotation(itemId: string, input: CreateAnnotationInput): Promise<Annotation> {
  return apiFetch<Annotation>(`/api/items/${encodeURIComponent(itemId)}/annotations`, jsonInit("POST", input));
}

export function getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  return apiFetch<{ conversation: Conversation; messages: Message[] }>(
    `/api/conversations/${encodeURIComponent(id)}`,
  );
}

// ---- A6 AI SSE + 阶段4+5 追问/全文问答 ----

export interface AiSelectionInput {
  text: string;
  itemId?: string;
  page?: number | null;
}

export function aiSummarize(
  input: AiSelectionInput & { level?: "brief" | "bullets" },
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse("/api/ai/summarize", input, onFrame, opts);
}

export function aiExplain(
  input: AiSelectionInput & { level?: ExplainLevel },
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse("/api/ai/explain", input, onFrame, opts);
}

export function aiTranslate(
  input: AiSelectionInput & { targetLang?: "zh" | "en" },
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse("/api/ai/translate", input, onFrame, opts);
}

/** 截图（图/表/公式区域）解释：多模态端点，image 为 data URL */
export function aiExplainImage(
  input: { image: string; level?: ExplainLevel; itemId?: string; page?: number },
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse("/api/ai/explain-image", input, onFrame, opts);
}

/** 追问：创建/复用该标注的 conversation，SSE 流式返回 assistant 回复 */
export function sendAnnotationMessage(
  annotationId: string,
  content: string,
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse(`/api/annotations/${encodeURIComponent(annotationId)}/messages`, { content }, onFrame, opts);
}

/** 全文问答（流 C 端点）：done 帧带 citations */
export function askItem(
  itemId: string,
  question: string,
  onFrame: (f: SseFrame) => void,
  opts?: SseOptions,
): Promise<void> {
  return apiSse(`/api/items/${encodeURIComponent(itemId)}/ask`, { question }, onFrame, opts);
}

// ---- 语音模式（阶段 5.5+6，流 V）----

export interface VoiceSessionInfo {
  client_secret: string;
  url: string;
  model: string;
}

export interface VoiceSessionContextInput {
  itemId?: string;
  page?: number | null;
  selectedText?: string;
}

/** 后端代理协商 realtime 会话，返回 ephemeral token（BYOK key 不出后端） */
export function createVoiceSession(input: VoiceSessionContextInput = {}): Promise<VoiceSessionInfo> {
  return apiFetch<VoiceSessionInfo>("/api/voice/session", jsonInit("POST", input));
}

/** 会话时长上报（写入 usage_log task=voice） */
export function reportVoiceUsage(seconds: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/voice/usage", jsonInit("POST", { seconds }));
}

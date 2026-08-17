// 契约端点的类型化封装；组件只调用这里或 apiFetch，绝不裸写 fetch。
import { apiFetch, jsonInit } from "./client";
import type {
  AiTask,
  Collection,
  FileImportResult,
  IdentifierImportResult,
  Item,
  Provider,
  ProviderKind,
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

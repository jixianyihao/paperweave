// 与契约「数据形状」一一对应的前端类型（见 docs/superpowers/plans/2026-08-17-paperweave-phase23-contract.md）

export interface Item {
  id: string;
  title: string;
  creators: string; // JSON: string[]
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string | null;
  abstract: string | null;
  file_path: string | null;
  reading_status: "unread" | "reading" | "read";
  starred: 0 | 1;
  metadata_status: "pending" | "complete" | "failed";
  date_added: string;
  date_modified: string;
}

export interface Collection {
  id: string;
  parent_id: string | null;
  name: string;
  item_count: number;
}

export interface Tag {
  name: string;
  item_count: number;
}

export interface Annotation {
  id: string;
  item_id: string;
  type: "highlight" | "note" | "ai_summary" | "ai_explain" | "ai_translate" | "ai_qa" | "voice_digest";
  page: number | null;
  position: string | null;
  content: string;
  color: string | null;
  created_at: string;
  sort_index: number;
}

export interface Citation {
  page: number;
  quote: string;
}

export interface Conversation {
  id: string;
  annotation_id: string | null;
  item_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: string | null; // JSON: Citation[]
  created_at: string;
}

export type ExplainLevel = "eli5" | "undergrad" | "grad" | "expert";

export function parseCitations(json: string | null): Citation[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Citation =>
        !!c && typeof c === "object" && typeof (c as Citation).page === "number" && typeof (c as Citation).quote === "string",
    );
  } catch {
    return [];
  }
}

export type ProviderKind = "builtin" | "anthropic" | "openai" | "custom";

export interface Provider {
  id: string;
  kind: ProviderKind;
  label: string;
  base_url: string | null;
  has_key: boolean;
  models: string; // JSON: string[]
  enabled: 0 | 1;
}

export type AiTask = "translate" | "summarize" | "explain" | "qa" | "voice" | "embedding";

export interface TaskRoute {
  task: AiTask;
  provider_id: string | null;
  model: string | null;
}

export interface UsageSummary {
  today_tokens: number;
  month_tokens: number;
  by_task: { task: string; tokens: number }[];
}

// 导入结果（与 packages/backend 现有端点一致）
export interface FileImportResult {
  item: Item;
  metadata_status: "complete" | "failed";
  duplicate: boolean;
}

export interface IdentifierImportResult {
  item: Item;
  pdf_downloaded: boolean;
  duplicate: boolean;
}

export function parseCreators(item: Item): string[] {
  try {
    const parsed: unknown = JSON.parse(item.creators);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export function parseModels(provider: Provider): string[] {
  try {
    const parsed: unknown = JSON.parse(provider.models);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

// 唯一允许的 API 出入口：组件一律通过 apiFetch（或 endpoints.ts 的封装）访问后端。
// mock 模式：`?mock=1` 显式开启（记 sessionStorage，当次会话有效，可用顶栏标识退出）。
// 额外安全网：仅 DEV 下的 GET 请求在网络失败时回退 mock；写操作网络失败一律抛错，绝不冒充后端。
import { MockApiError, mockApiFetch, mockApiSse } from "./mock";

const MOCK_STORAGE_KEY = "pw-mock";

let mockOverride: boolean | null = null;

/** 显式开启 mock 模式（写入 sessionStorage，仅当次会话） */
export function enableMockMode(): void {
  mockOverride = true;
  try {
    sessionStorage.setItem(MOCK_STORAGE_KEY, "1");
  } catch {
    /* jsdom / 隐私模式下忽略 */
  }
}

/** 退出 mock 模式（顶栏 mock 标识点击时调用） */
export function disableMockMode(): void {
  mockOverride = false;
  try {
    sessionStorage.removeItem(MOCK_STORAGE_KEY);
    localStorage.removeItem(MOCK_STORAGE_KEY); // 清理旧版本遗留的粘滞标记
  } catch {
    /* ignore */
  }
}

export function isMockMode(): boolean {
  if (typeof window !== "undefined") {
    if (new URLSearchParams(window.location.search).get("mock") === "1") {
      enableMockMode();
      return true;
    }
    try {
      if (sessionStorage.getItem(MOCK_STORAGE_KEY) === "1") return true;
    } catch {
      /* ignore */
    }
  }
  if (mockOverride !== null) return mockOverride;
  return false;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `请求失败（${res.status}）`;
  let body: unknown;
  try {
    body = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
      message = (body as { error: string }).error;
    }
  } catch {
    /* 非 JSON 错误体 */
  }
  return new ApiError(res.status, message, body);
}

async function fromMock<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await mockApiFetch<T>(path, init);
  } catch (e) {
    if (e instanceof MockApiError) throw new ApiError(e.status, e.message);
    throw e;
  }
}

function isReadOnly(init?: RequestInit): boolean {
  return (init?.method ?? "GET").toUpperCase() === "GET";
}

// ---- 桌面端运行时 baseURL 覆盖（流 P 追加）----
// Tauri sidecar 可能因 8471 被占用而改用其他端口；Rust 侧通过 initialization_script
// 注入 window.__PAPERWEAVE_API_BASE__，此处自动接管。Web 开发/生产环境该全局不存在，
// apiBase 保持空串，行为与之前完全一致（相对路径）。
let apiBase = "";

/** 运行时覆盖 API base（desktop sidecar 用）；传空串恢复相对路径 */
export function setApiBase(base: string): void {
  apiBase = base.replace(/\/+$/, "");
}

declare global {
  interface Window {
    __PAPERWEAVE_API_BASE__?: string;
  }
}

if (typeof window !== "undefined" && typeof window.__PAPERWEAVE_API_BASE__ === "string") {
  setApiBase(window.__PAPERWEAVE_API_BASE__);
}

function withBase(path: string): string {
  return apiBase ? apiBase + path : path;
}

/**
 * 所有 API 调用的统一入口。path 以 "/api/..." 开头。
 * - 显式 mock 模式：全部请求走 mock。
 * - 非 mock 模式：GET 在 DEV 下网络失败回退 mock（便于无后端浏览）；写操作网络失败抛 ApiError(0)。
 * - HTTP 4xx/5xx 一律抛 ApiError，不回退。
 */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (isMockMode()) return fromMock<T>(path, init);
  let res: Response;
  try {
    res = await fetch(withBase(path), init);
  } catch (e) {
    if (isReadOnly(init) && import.meta.env.DEV) {
      return fromMock<T>(path, init);
    }
    throw new ApiError(0, "无法连接后端服务，请确认后端已启动", e);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ---- SSE（阶段 4+5：AI 操作 / 追问 / 全文问答均为 text/event-stream）----

/** 单条 SSE data 帧的通用形状；各端点附加字段见契约（done/error/annotation_id/message_id/citations…） */
export interface SseFrame {
  delta?: string;
  done?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface SseOptions {
  /** 传入 AbortSignal 以支持中止（组件卸载时应 abort，避免卸载后继续 setState 与浪费 LLM 调用） */
  signal?: AbortSignal;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * SSE 统一入口（与 apiFetch 同级，组件不裸写 fetch）。
 * POST JSON → 逐行解析 `data: {...}` 帧回调 onFrame；error 帧不抛异常，原样透传给调用方展示。
 * HTTP 层错误（4xx/5xx/网络失败）抛 ApiError；signal 中止抛 AbortError（调用方用 isAbortError 识别后静默）。
 */
export async function apiSse(
  path: string,
  body: unknown,
  onFrame: (frame: SseFrame) => void,
  options?: SseOptions,
): Promise<void> {
  const signal = options?.signal;
  if (signal?.aborted) throw abortError();
  if (isMockMode()) return mockApiSse(path, body, onFrame, options);
  let res: Response;
  try {
    res = await fetch(withBase(path), { ...jsonInit("POST", body), signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError(0, "无法连接后端服务，请确认后端已启动", e);
  }
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new ApiError(0, "响应体不可流式读取");

  const emitLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trim();
    if (!payload) return;
    try {
      onFrame(JSON.parse(payload) as SseFrame);
    } catch {
      /* 非 JSON 帧忽略 */
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw abortError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      emitLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) emitLine(buf);
}

// 唯一允许的 API 出入口：组件一律通过 apiFetch（或 endpoints.ts 的封装）访问后端。
// mock 模式：URL 带 ?mock=1、localStorage "pw-mock"="1"、或真实请求网络失败时自动回退到 mock。
import { MockApiError, mockApiFetch } from "./mock";

const MOCK_STORAGE_KEY = "pw-mock";

let mockOverride: boolean | null = null;

/** 显式开启 mock 模式（写入 localStorage，供 ?mock=1 进入后保持） */
export function enableMockMode(): void {
  mockOverride = true;
  try {
    localStorage.setItem(MOCK_STORAGE_KEY, "1");
  } catch {
    /* jsdom / 隐私模式下忽略 */
  }
}

/** 关闭 mock 模式 */
export function disableMockMode(): void {
  mockOverride = false;
  try {
    localStorage.removeItem(MOCK_STORAGE_KEY);
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
      if (localStorage.getItem(MOCK_STORAGE_KEY) === "1") return true;
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

/**
 * 所有 API 调用的统一入口。path 以 "/api/..." 开头。
 * 网络层失败（后端未启动等）自动回退 mock；HTTP 错误（4xx/5xx）抛 ApiError，不回退。
 */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  if (isMockMode()) {
    try {
      return await mockApiFetch<T>(path, init);
    } catch (e) {
      if (e instanceof MockApiError) throw new ApiError(e.status, e.message);
      throw e;
    }
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    // 网络失败（后端未启动等）→ 回退 mock，保证演示流程可用
    try {
      return await mockApiFetch<T>(path, init);
    } catch (e) {
      if (e instanceof MockApiError) throw new ApiError(e.status, e.message);
      throw e;
    }
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

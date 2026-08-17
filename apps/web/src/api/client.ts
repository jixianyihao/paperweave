// 唯一允许的 API 出入口：组件一律通过 apiFetch（或 endpoints.ts 的封装）访问后端。
// mock 模式：`?mock=1` 显式开启（记 sessionStorage，当次会话有效，可用顶栏标识退出）。
// 额外安全网：仅 DEV 下的 GET 请求在网络失败时回退 mock；写操作网络失败一律抛错，绝不冒充后端。
import { MockApiError, mockApiFetch } from "./mock";

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
    res = await fetch(path, init);
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

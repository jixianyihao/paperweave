import type { FetchLike } from "../metadata.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  tokensIn: number | null;
  tokensOut: number | null;
}

export type DeltaHandler = (delta: string) => void;

// 读取 fetch Response 的 SSE 体，逐个 data: 负载回调
export async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) onData(line.slice(5).trimStart());
      }
    }
  }
  buf += decoder.decode();
  for (const line of buf.split("\n")) {
    if (line.startsWith("data:")) onData(line.slice(5).trimStart());
  }
}

export async function httpError(res: Response, label: string): Promise<Error> {
  let snippet = "";
  try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
  return new Error(`${label} request failed: ${res.status}${snippet ? ` ${snippet}` : ""}`);
}

export type { FetchLike };

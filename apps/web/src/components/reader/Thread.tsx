// 追问线程：AI 条目就地展开对话（契约 流B-4）。
// 注意：后端只提供 POST /api/annotations/:id/messages（创建/复用 conversation，SSE 返回），
// 没有按 annotation 查历史 conversation 的端点，因此线程历史为会话内本地状态（V1 取舍，见流 B 报告）。
import { useState, type FormEvent } from "react";
import { sendAnnotationMessage } from "../../api/endpoints";
import { useReaderBridge } from "../../reader/bridgeContext";
import { CitedText } from "./citations";

interface ThreadMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
}

let seq = 0;

export default function Thread({ annotationId, defaultOpen = false }: { annotationId: string; defaultOpen?: boolean }) {
  const bridge = useReaderBridge();
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const onCite = bridge ? (page: number) => bridge.jumpTo({ page }) : undefined;

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    setStreaming(true);
    seq += 1;
    const userId = seq;
    seq += 1;
    const assistantId = seq;
    setMessages((ms) => [
      ...ms,
      { id: userId, role: "user", content },
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);
    const patch = (f: (m: ThreadMessage) => ThreadMessage) =>
      setMessages((ms) => ms.map((m) => (m.id === assistantId ? f(m) : m)));
    try {
      await sendAnnotationMessage(annotationId, content, (frame) => {
        if (typeof frame.delta === "string") {
          patch((m) => ({ ...m, content: m.content + frame.delta }));
        } else if (typeof frame.error === "string") {
          patch((m) => ({ ...m, content: frame.error as string, error: true }));
        }
      });
    } catch (err) {
      patch((m) => ({ ...m, content: err instanceof Error ? err.message : "请求失败", error: true }));
    } finally {
      patch((m) => ({ ...m, pending: false }));
      setStreaming(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs font-sans text-navy dark:text-dnavy underline underline-offset-2"
      >
        追问 / 展开对话
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-line dark:border-dline bg-paper dark:bg-dpaper p-2" data-testid="thread">
      {messages.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {messages.map((m) => (
            <li
              key={m.id}
              className={
                m.role === "user"
                  ? "self-end max-w-[85%] rounded bg-cream dark:bg-dcream px-2 py-1 text-sm"
                  : `self-start max-w-[95%] rounded px-2 py-1 text-sm ${
                      m.error ? "text-red-700 dark:text-red-400" : ""
                    }`
              }
            >
              {m.role === "assistant" ? <CitedText text={m.content} onCite={onCite} /> : m.content}
              {m.pending && <span data-streaming className="ml-1 animate-pulse text-muted dark:text-dmuted">▍</span>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="flex gap-1">
        <input
          aria-label="追问输入"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="就这段内容继续追问…"
          className="flex-1 rounded border border-line dark:border-dline bg-paper dark:bg-dcream px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded bg-navy dark:bg-dnavy px-2 py-1 text-sm text-paper dark:text-dpaper disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  );
}

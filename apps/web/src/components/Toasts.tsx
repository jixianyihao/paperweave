import { useEffect } from "react";
import { useToastStore, type Toast } from "../stores/toastStore";

const KIND_CLS: Record<Toast["kind"], string> = {
  info: "border-line dark:border-dline bg-cream dark:bg-dcream",
  success: "border-green-700 bg-green-50 dark:bg-green-950 dark:border-green-700",
  error: "border-red-700 bg-red-50 dark:bg-red-950 dark:border-red-800",
};

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded border px-3 py-2 text-sm shadow ${KIND_CLS[toast.kind]}`}
      onClick={() => dismiss(toast.id)}
    >
      {toast.message}
    </div>
  );
}

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div aria-label="通知" className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

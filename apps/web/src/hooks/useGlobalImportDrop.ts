import { useEffect } from "react";
import { importFile } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useLibraryStore } from "../stores/libraryStore";
import { useToastStore } from "../stores/toastStore";

/** 全局拖拽导入：任意位置拖入 PDF → 静默上传 + toast 汇报结果 */
export function useGlobalImportDrop(): void {
  const push = useToastStore((s) => s.push);

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
      );
      if (files.length === 0) {
        push("只支持 PDF 文件", "error");
        return;
      }
      for (const file of files) {
        void (async () => {
          try {
            const result = await importFile(file);
            push(
              result.duplicate
                ? `重复条目：${result.item.title}`
                : result.metadata_status === "complete"
                  ? `已导入：${result.item.title}`
                  : `已导入：${result.item.title}（元数据抓取失败）`,
              result.metadata_status === "complete" || result.duplicate ? "success" : "error",
            );
          } catch (err) {
            push(`导入失败：${err instanceof ApiError ? err.message : file.name}`, "error");
          }
        })();
      }
      void useLibraryStore.getState().refresh();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [push]);
}

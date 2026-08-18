// pdf.js 初始化：打包（SEA）形态下 worker 文件不在 bundle 里，
// 必须显式指向 resources 里 staged 的 pdf.worker.mjs，否则
// "Setting up fake worker failed" 且静默导致提取返回空。
import { getDocument as pdfjsGetDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const home = process.env.PAPERWEAVE_BACKEND_HOME;
if (home) {
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(home, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ).href;
}

export const getDocument = pdfjsGetDocument;

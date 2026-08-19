import type { ChatMessage } from "./common.js";

export type SummarizeLevel = "brief" | "bullets";
export type ExplainLevel = "eli5" | "undergrad" | "grad" | "expert";
export type TargetLang = "zh" | "en";

export interface PaperContext {
  title?: string;
  abstract?: string | null;
}

function contextBlock(ctx?: PaperContext): string {
  if (!ctx?.title) return "";
  const parts = [`Paper title: ${ctx.title}`];
  if (ctx.abstract) parts.push(`Paper abstract: ${ctx.abstract}`);
  return `\n\nContext from the paper:\n${parts.join("\n")}`;
}

export function summarizeMessages(text: string, level: SummarizeLevel, ctx?: PaperContext): ChatMessage[] {
  const instruction = level === "brief"
    ? "Summarize the following passage from an academic paper in one single sentence."
    : "Summarize the following passage from an academic paper as a concise bullet list of its key points.";
  return [
    { role: "system", content: `You are an expert academic reading assistant. ${instruction} Be faithful to the source text; do not add information it does not contain.` },
    { role: "user", content: `${text}${contextBlock(ctx)}` },
  ];
}

const EXPLAIN_AUDIENCE: Record<ExplainLevel, string> = {
  eli5: "a curious five-year-old, using simple everyday analogies and no jargon",
  undergrad: "an undergraduate student who knows the basics of the field but not this specific topic",
  grad: "a graduate student in a related field who wants a precise but accessible explanation",
  expert: "an expert researcher who wants the technical crux, assumptions, and limitations",
};

export function explainMessages(text: string, level: ExplainLevel, ctx?: PaperContext): ChatMessage[] {
  return [
    { role: "system", content: `You are an expert academic reading assistant. Explain the following passage from an academic paper to ${EXPLAIN_AUDIENCE[level]}. Stay faithful to the source text.` },
    { role: "user", content: `${text}${contextBlock(ctx)}` },
  ];
}

export function translateMessages(text: string, targetLang: TargetLang, ctx?: PaperContext): ChatMessage[] {
  const target = targetLang === "zh" ? "Simplified Chinese" : "English";
  return [
    { role: "system", content: `You are a professional academic translator. Translate the following passage into ${target}. Preserve technical terminology accurately, keep the original meaning, and output only the translation.` },
    { role: "user", content: `${text}${contextBlock(ctx)}` },
  ];
}

/** 截图（图/表/公式）解释：多模态消息，图片以 data URL 传入 */
export function imageExplainMessages(imageDataUrl: string, level: ExplainLevel, ctx?: PaperContext): ChatMessage[] {
  return [
    { role: "system", content: `You are an expert academic reading assistant. The user captured a figure, table, or formula region from an academic paper. Explain what the image shows to ${EXPLAIN_AUDIENCE[level]}. If it is a chart, read axes/units/trends; if a table, summarize its structure and key values; if a formula, explain each symbol and the overall meaning. Stay faithful to the image.` },
    {
      role: "user",
      content: [
        { type: "text", text: `Please explain this captured region.${contextBlock(ctx)}` },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

export function qaMessages(
  annotationContent: string,
  history: { role: "user" | "assistant"; content: string }[],
  ctx?: PaperContext,
): ChatMessage[] {
  return [
    { role: "system", content: `You are an expert academic reading assistant. Answer the user's questions about the selected passage faithfully and concisely. If the answer is not in the passage, say so.` },
    { role: "user", content: `Selected passage:\n${annotationContent}${contextBlock(ctx)}` },
    { role: "assistant", content: "I have read the passage. What would you like to know?" },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
}

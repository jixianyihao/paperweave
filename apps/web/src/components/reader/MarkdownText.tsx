// Markdown 渲染：AI 产出（摘要/解释/翻译/问答）里的 markdown 排版。
// 基于 react-markdown，限制为行内安全元素 + 常见块级元素，禁 HTML。
import Markdown from "react-markdown";

export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="pw-md">
      <Markdown
        allowedElements={[
          "p", "strong", "em", "code", "pre", "ul", "ol", "li",
          "blockquote", "h1", "h2", "h3", "h4", "a", "hr", "br",
        ]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-navy dark:text-dnavy underline">
              {children}
            </a>
          ),
          code: ({ className, children }) =>
            className ? (
              <code className="block overflow-x-auto rounded bg-cream dark:bg-dpaper p-2 text-xs font-mono">{children}</code>
            ) : (
              <code className="rounded bg-cream dark:bg-dpaper px-1 py-0.5 text-xs font-mono">{children}</code>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

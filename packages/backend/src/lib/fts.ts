// 把用户输入转成安全的 FTS5 MATCH 表达式：
// 分词后逐个加双引号（转义内部引号）并加前缀通配，词间为 AND。
export function toFtsQuery(q: string): string | null {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

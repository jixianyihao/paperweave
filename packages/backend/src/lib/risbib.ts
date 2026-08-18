// RIS / BibTeX 批量迁移导入（spec §3.2）：解析纯文本参考文献格式，
// 批量建立 metadata_status=complete 的无 PDF 条目；doi 重复跳过，无标题计为失败。
import type Database from "better-sqlite3";
import { insertItem, applyMeta } from "./importfile.js";
import { findDuplicate } from "./importidentifier.js";
import type { PaperMeta } from "./metadata.js";

export interface BibImportResult {
  imported: number;
  failed: number;
}

// "Vaswani, Ashish" → "Ashish Vaswani"；无逗号则原样保留
function normalizeName(name: string): string {
  const s = name.trim().replace(/\s+/g, " ");
  const idx = s.indexOf(",");
  if (idx === -1) return s;
  const family = s.slice(0, idx).trim();
  const given = s.slice(idx + 1).trim();
  return given ? `${given} ${family}` : family;
}

function yearOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

// ---- RIS ----

const RIS_TAG_RE = /^([A-Z][A-Z0-9]) {2}-(?: (.*))?$/;

export function parseRis(text: string): PaperMeta[] {
  const entries: PaperMeta[] = [];
  let cur: PaperMeta | null = null;
  let lastTag = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(RIS_TAG_RE);
    if (!m) {
      // 续行：并入上一个字段
      if (cur && lastTag && line.trim()) {
        appendRis(cur, lastTag, line.trim());
      }
      continue;
    }
    const [, tag, rawValue] = m;
    const value = (rawValue ?? "").trim();
    lastTag = tag;
    if (tag === "TY") {
      cur = { creators: [] };
      entries.push(cur);
      continue;
    }
    if (!cur) continue;
    if (tag === "ER") {
      cur = null;
      lastTag = "";
      continue;
    }
    appendRis(cur, tag, value);
  }
  return entries;
}

function appendRis(cur: PaperMeta, tag: string, value: string): void {
  switch (tag) {
    case "TI":
    case "T1":
      cur.title = cur.title ? `${cur.title} ${value}` : value;
      break;
    case "AU":
      cur.creators.push(normalizeName(value));
      break;
    case "PY":
    case "Y1": {
      const y = yearOf(value);
      if (y !== undefined) cur.year = y;
      break;
    }
    case "JO":
    case "JF":
    case "T2":
      if (!cur.venue) cur.venue = value;
      break;
    case "DO":
      cur.doi = value;
      break;
    case "UR":
      if (!cur.url) cur.url = value;
      break;
    case "AB":
    case "N2":
      cur.abstract = cur.abstract ? `${cur.abstract} ${value}` : value;
      break;
    default:
      break;
  }
}

// ---- BibTeX ----

interface BibRawEntry {
  fields: Record<string, string>;
}

// 基本解析：@type{key, field = {value} | "value" | bare, ...}，支持嵌套花括号
export function scanBibtexEntries(text: string): BibRawEntry[] {
  const entries: BibRawEntry[] = [];
  const atRe = /@\w+\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = atRe.exec(text))) {
    // 从 opening brace 后开始按字段解析，直到与之配对的 closing brace
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    if (depth !== 0) break; // 未闭合，放弃剩余内容
    const body = text.slice(start, i - 1);
    // body = "key, field = value, ..."；去掉 citation key（第一个逗号前）
    const comma = body.indexOf(",");
    if (comma === -1) continue;
    entries.push({ fields: parseBibFields(body.slice(comma + 1)) });
    atRe.lastIndex = i;
  }
  return entries;
}

function parseBibFields(s: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  while (i < n) {
    // 跳过分隔符
    while (i < n && /[\s,]/.test(s[i])) i += 1;
    if (i >= n) break;
    // 字段名
    const nameMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(s.slice(i));
    if (!nameMatch) break;
    const name = nameMatch[0].toLowerCase();
    i += name.length;
    while (i < n && /\s/.test(s[i])) i += 1;
    if (s[i] !== "=") {
      // 无值字段，跳过到下一个逗号
      while (i < n && s[i] !== ",") i += 1;
      continue;
    }
    i += 1;
    while (i < n && /\s/.test(s[i])) i += 1;
    // 字段值：{...} / "..." / bare
    let value = "";
    if (s[i] === "{") {
      let depth = 0;
      const vStart = i;
      while (i < n) {
        if (s[i] === "{") depth += 1;
        else if (s[i] === "}") {
          depth -= 1;
          if (depth === 0) { i += 1; break; }
        }
        i += 1;
      }
      value = s.slice(vStart + 1, i - 1);
    } else if (s[i] === '"') {
      const vStart = ++i;
      while (i < n && s[i] !== '"') i += 1;
      value = s.slice(vStart, i);
      i += 1;
    } else {
      const vStart = i;
      while (i < n && s[i] !== "," && s[i] !== "\n") i += 1;
      value = s.slice(vStart, i).trim();
    }
    fields[name] = value;
  }
  return fields;
}

function cleanBibValue(v: string): string {
  return v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function parseBibtex(text: string): PaperMeta[] {
  const out: PaperMeta[] = [];
  for (const { fields } of scanBibtexEntries(text)) {
    const meta: PaperMeta = { creators: [] };
    if (fields.title) meta.title = cleanBibValue(fields.title);
    if (fields.author) {
      meta.creators = fields.author
        .split(/\s+and\s+/i)
        .map((a) => normalizeName(cleanBibValue(a)))
        .filter(Boolean);
    }
    const y = yearOf(fields.year);
    if (y !== undefined) meta.year = y;
    const venue = fields.journal ?? fields.journaltitle ?? fields.booktitle;
    if (venue) meta.venue = cleanBibValue(venue);
    if (fields.doi) meta.doi = cleanBibValue(fields.doi);
    if (fields.url) meta.url = cleanBibValue(fields.url);
    if (fields.abstract) meta.abstract = cleanBibValue(fields.abstract);
    out.push(meta);
  }
  return out;
}

// ---- 批量导入 ----

export function detectFormat(text: string): "ris" | "bibtex" | null {
  if (/^TY {2}-/m.test(text)) return "ris";
  if (/@(?:article|inproceedings|book|incollection|proceedings|phdthesis|mastersthesis|misc|techreport|unpublished|conference)\s*\{/i.test(text)) return "bibtex";
  return null;
}

export function importRisBib(db: Database.Database, text: string): BibImportResult {
  const format = detectFormat(text);
  if (!format) return { imported: 0, failed: 0 };
  const entries = format === "ris" ? parseRis(text) : parseBibtex(text);
  let imported = 0;
  let failed = 0;
  for (const meta of entries) {
    if (!meta.title) {
      failed += 1;
      continue;
    }
    // doi 命中已有条目 → 跳过（既非导入也非失败）
    if (findDuplicate(db, meta)) continue;
    const item = insertItem(db, { title: meta.title, doi: meta.doi ?? null });
    applyMeta(db, item.id, meta);
    imported += 1;
  }
  return { imported, failed };
}

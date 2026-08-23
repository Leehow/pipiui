/**
 * Symbol extraction (D6). Pure functions for index.ts hooks.
 * tree-sitter ≠ type system (D4): name-based, no overload / cross-file inference.
 */

import { compileQuery, createParser, isTreeSitterReady, langFromPath, type TsNode } from "./treesitter.js";
import { extraCallQuerySourceFor, querySourceFor } from "./queries.js";
import {
  lastNameSegment,
  type SourceFile,
  type SupportedLang,
  type SymbolInfo,
  type SymbolKind,
} from "./types.js";

const queryCache = new Map<SupportedLang, ReturnType<typeof compileQuery>>();
const extraCallQueryCache = new Map<SupportedLang, ReturnType<typeof compileQuery> | null>();
const parserCache = new Map<SupportedLang, ReturnType<typeof createParser>>();

function parserFor(lang: SupportedLang) {
  let parser = parserCache.get(lang);
  if (!parser) {
    parser = createParser(lang);
    if (parser) parserCache.set(lang, parser);
  }
  return parser;
}

function queryFor(lang: SupportedLang) {
  let query = queryCache.get(lang);
  if (query === undefined) {
    query = compileQuery(lang, querySourceFor(lang));
    queryCache.set(lang, query);
  }
  return query;
}

function extraCallQueryFor(lang: SupportedLang) {
  if (extraCallQueryCache.has(lang)) return extraCallQueryCache.get(lang) ?? null;
  const src = extraCallQuerySourceFor(lang);
  if (!src) {
    extraCallQueryCache.set(lang, null);
    return null;
  }
  const query = compileQuery(lang, src);
  extraCallQueryCache.set(lang, query);
  return query;
}

function kindFromCapture(name: string): SymbolKind | null {
  if (name.includes("definition.class")) return "class";
  if (name.includes("definition.method")) return "method";
  if (name.includes("definition.function")) return "function";
  if (name.includes("definition.interface")) return "interface";
  if (name.includes("definition.module")) return "module";
  if (name.includes("definition.import") || name === "definition.import" || name === "import.module") {
    return "import";
  }
  if (name.includes("reference.call")) return "call";
  return null;
}

const CONTAINER_TYPES = new Set([
  "class_definition",
  "class_declaration",
  "class",
  "impl_item",
  "trait_item",
  "interface_declaration",
  "abstract_class_declaration",
]);

const FUNCTION_TYPES = new Set([
  "function_definition",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "function_expression",
  "arrow_function",
  "function_item",
]);

function containerName(node: TsNode): string | undefined {
  let cur: TsNode | null = node.parent;
  while (cur) {
    if (CONTAINER_TYPES.has(cur.type)) {
      const named = cur.childForFieldName("name") ?? cur.childForFieldName("type");
      if (named?.text) return named.text;
    }
    cur = cur.parent;
  }
  return undefined;
}

function nameFromDeclarator(fnNode: TsNode): string | undefined {
  let cur: TsNode | null = fnNode.parent;
  while (cur) {
    if (
      cur.type === "variable_declarator" ||
      cur.type === "pair" ||
      cur.type === "public_field_definition" ||
      cur.type === "field_definition" ||
      cur.type === "pair_pattern"
    ) {
      const named = cur.childForFieldName("name") ?? cur.childForFieldName("key");
      if (named?.text) return named.text.replace(/['"]/g, "");
    }
    if (FUNCTION_TYPES.has(cur.type) || CONTAINER_TYPES.has(cur.type)) break;
    cur = cur.parent;
  }
  return undefined;
}

/** Nearest enclosing function / method, qualified with class/impl when known. */
function enclosingCaller(node: TsNode): string | undefined {
  let cur: TsNode | null = node.parent;
  let funcName: string | undefined;
  let className: string | undefined;
  while (cur) {
    if (!funcName && FUNCTION_TYPES.has(cur.type)) {
      const named = cur.childForFieldName("name");
      funcName = named?.text?.trim() || nameFromDeclarator(cur);
    } else if (CONTAINER_TYPES.has(cur.type) && !className) {
      const named = cur.childForFieldName("name") ?? cur.childForFieldName("type");
      if (named?.text) className = named.text.trim();
    }
    cur = cur.parent;
  }
  if (!funcName) return undefined;
  if (className && !funcName.includes(".")) return `${className}.${funcName}`;
  return funcName;
}

function signatureOf(node: TsNode, source: string): string {
  const body = node.childForFieldName("body");
  const raw = body
    ? source.slice(node.startIndex, body.startIndex)
    : node.text.split(/\r?\n/, 3).join(" ");
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function toSymbol(
  path: string,
  lang: SupportedLang,
  source: string,
  nameNode: TsNode,
  spanNode: TsNode,
  kind: SymbolKind,
): SymbolInfo {
  const container = kind === "import" || kind === "call" ? undefined : containerName(spanNode);
  let kindOut = kind;
  if (kind === "function" && container) kindOut = "method";
  const name = nameNode.text.trim();
  const caller = kind === "call" ? enclosingCaller(spanNode) : undefined;
  return {
    name,
    kind: kindOut,
    path,
    startLine: spanNode.startPosition.row + 1,
    endLine: spanNode.endPosition.row + 1,
    startColumn: spanNode.startPosition.column,
    endColumn: spanNode.endPosition.column,
    signature: kindOut === "call" ? name : signatureOf(spanNode, source),
    container,
    caller,
    lang,
  };
}

/**
 * Extract function / class / method / import / call symbols from one file.
 * Requires `await initTreeSitter()` first; otherwise returns [].
 */
export function extractSymbols(path: string, source: string, lang: SupportedLang): SymbolInfo[] {
  if (!isTreeSitterReady()) return [];
  const parser = parserFor(lang);
  const query = queryFor(lang);
  if (!parser || !query) return [];
  const tree = parser.parse(source);
  if (!tree) return [];

  const out: SymbolInfo[] = [];
  const seen = new Set<string>();
  try {
    collectQuerySymbols(query, tree.rootNode, path, lang, source, seen, out);
    const extra = extraCallQueryFor(lang);
    if (extra) collectQuerySymbols(extra, tree.rootNode, path, lang, source, seen, out);
    return out;
  } finally {
    try {
      tree.delete();
    } catch {
      /* WASM tree already gone */
    }
  }
}

function collectQuerySymbols(
  query: NonNullable<ReturnType<typeof compileQuery>>,
  root: TsNode,
  path: string,
  lang: SupportedLang,
  source: string,
  seen: Set<string>,
  out: SymbolInfo[],
): void {
  for (const match of query.matches(root)) {
    let span: TsNode | null = null;
    let nameNode: TsNode | null = null;
    let kind: SymbolKind | null = null;
    for (const cap of match.captures) {
      if (cap.name.startsWith("definition.") || cap.name.startsWith("reference.")) {
        span = cap.node;
        const k = kindFromCapture(cap.name);
        if (k) kind = k;
      }
      if (cap.name.startsWith("name.") || cap.name === "import.module" || cap.name === "impl.type") {
        nameNode = cap.node;
        const k = kindFromCapture(cap.name);
        if (k && !kind) kind = k;
      }
    }
    if (!span) {
      const first = match.captures[0];
      if (first) span = first.node;
    }
    if (!nameNode) nameNode = span;
    if (!span || !nameNode || !kind) continue;
    const sym = toSymbol(path, lang, source, nameNode, span, kind);
    if (!sym.name) continue;
    const key = `${sym.kind}:${sym.name}:${sym.startLine}:${sym.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sym);
  }
}

export function extractFile(file: SourceFile): SymbolInfo[] {
  return extractSymbols(file.path, file.source, file.lang);
}

export function extractMany(files: SourceFile[]): SymbolInfo[] {
  const all: SymbolInfo[] = [];
  for (const file of files) all.push(...extractFile(file));
  return all;
}

export interface FindOptions {
  path?: string;
  lang?: SupportedLang;
  limit?: number;
}

function nameMatches(symbol: SymbolInfo, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (symbol.name === q) return true;
  if (symbol.container && `${symbol.container}.${symbol.name}` === q) return true;
  if (symbol.container && `${symbol.container}::${symbol.name}` === q) return true;
  const tail = lastNameSegment(q);
  return symbol.name === tail;
}

const DEFINITION_KINDS = new Set<SymbolKind>([
  "function",
  "class",
  "method",
  "interface",
  "module",
]);

export function findDefinition(
  name: string,
  symbols: SymbolInfo[],
  opts: FindOptions = {},
): SymbolInfo[] {
  const limit = opts.limit ?? 50;
  const hits = symbols.filter((s) => {
    if (!DEFINITION_KINDS.has(s.kind)) return false;
    if (opts.path && s.path !== opts.path && !s.path.endsWith(opts.path)) return false;
    if (opts.lang && s.lang !== opts.lang) return false;
    return nameMatches(s, name);
  });
  hits.sort((a, b) => {
    const aq = a.container && name.includes(".") ? 0 : 1;
    const bq = b.container && name.includes(".") ? 0 : 1;
    if (aq !== bq) return aq - bq;
    return a.path.localeCompare(b.path) || a.startLine - b.startLine;
  });
  return hits.slice(0, limit);
}

export function findReferences(
  name: string,
  symbols: SymbolInfo[],
  opts: FindOptions = {},
): SymbolInfo[] {
  const limit = opts.limit ?? 80;
  const hits = symbols.filter((s) => {
    if (s.kind !== "call" && s.kind !== "import") return false;
    if (opts.path && s.path !== opts.path && !s.path.endsWith(opts.path)) return false;
    if (opts.lang && s.lang !== opts.lang) return false;
    return nameMatches(s, name);
  });
  hits.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);
  return hits.slice(0, limit);
}

export { langFromPath };

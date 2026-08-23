/**
 * web-tree-sitter loader. WASM + JS are vendored under ../sidecar (D6 / D7).
 * Missing assets → not ready. Never pretend grammars are built-in.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { SupportedLang } from "./types.js";

export interface TsPoint {
  row: number;
  column: number;
}

export interface TsNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TsPoint;
  endPosition: TsPoint;
  parent: TsNode | null;
  childForFieldName(field: string): TsNode | null;
}

export interface TsTree {
  rootNode: TsNode;
  delete(): void;
}

export interface TsQuery {
  matches(node: TsNode): Array<{
    captures: Array<{ name: string; node: TsNode }>;
  }>;
  delete(): void;
}

export interface TsParser {
  setLanguage(language: unknown): unknown;
  parse(source: string): TsTree | null;
  delete(): void;
}

interface WebTreeSitter {
  Parser: {
    init(moduleOptions?: { locateFile?: (file: string, prefix: string) => string }): Promise<void>;
    new (): TsParser;
  };
  Language: {
    load(input: string | Uint8Array): Promise<unknown>;
  };
  Query: new (language: unknown, source: string) => TsQuery;
}

const GRAMMAR_FILE: Record<SupportedLang, string> = {
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  rust: "tree-sitter-rust.wasm",
};

let wts: WebTreeSitter | null = null;
let initPromise: Promise<void> | null = null;
let ready = false;
let initError: string | null = null;
const languages = new Map<SupportedLang, unknown>();

export function resolveSidecarDir(fromDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "sidecar");
    if (existsSync(join(candidate, "wasm", "tree-sitter-python.wasm"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(fromDir, "..", "sidecar");
}

export function sidecarAssetStatus(sidecarDir = resolveSidecarDir()): {
  ok: boolean;
  missing: string[];
  sidecarDir: string;
} {
  const required = [
    join("vendor", "web-tree-sitter", "tree-sitter.js"),
    join("vendor", "web-tree-sitter", "tree-sitter.wasm"),
    ...Object.values(GRAMMAR_FILE).map((name) => join("wasm", name)),
  ];
  const missing = required.filter((rel) => !existsSync(join(sidecarDir, rel)));
  return { ok: missing.length === 0, missing, sidecarDir };
}

export function isTreeSitterReady(): boolean {
  return ready;
}

export function treeSitterInitError(): string | null {
  return initError;
}

export async function initTreeSitter(): Promise<void> {
  if (ready) return;
  if (initPromise) return initPromise;
  initPromise = doInit();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

async function doInit(): Promise<void> {
  const status = sidecarAssetStatus();
  if (!status.ok) {
    initError = `tree-sitter sidecar assets missing: ${status.missing.join(", ")} (see sidecar/ASSETS.md)`;
    ready = false;
    return;
  }
  const vendorDir = join(status.sidecarDir, "vendor", "web-tree-sitter");
  const runtimeJs = join(vendorDir, "tree-sitter.js");
  const runtimeWasm = join(vendorDir, "tree-sitter.wasm");
  try {
    wts = (await import(pathToFileURL(runtimeJs).href)) as WebTreeSitter;
    await wts.Parser.init({
      locateFile: (file: string) => (file.endsWith(".wasm") ? runtimeWasm : join(vendorDir, file)),
    });
    for (const lang of Object.keys(GRAMMAR_FILE) as SupportedLang[]) {
      const wasmPath = join(status.sidecarDir, "wasm", GRAMMAR_FILE[lang]);
      languages.set(lang, await wts.Language.load(wasmPath));
    }
    ready = true;
    initError = null;
  } catch (err) {
    ready = false;
    initError = err instanceof Error ? err.message : String(err);
    wts = null;
    languages.clear();
  }
}

export function getLanguage(lang: SupportedLang): unknown | null {
  return languages.get(lang) ?? null;
}

export function createParser(lang: SupportedLang): TsParser | null {
  if (!ready || !wts) return null;
  const language = languages.get(lang);
  if (!language) return null;
  const parser = new wts.Parser();
  parser.setLanguage(language);
  return parser;
}

export function compileQuery(lang: SupportedLang, source: string): TsQuery | null {
  if (!ready || !wts) return null;
  const language = languages.get(lang);
  if (!language) return null;
  try {
    return new wts.Query(language, source);
  } catch {
    return null;
  }
}

export function langFromPath(filePath: string): SupportedLang | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") && !lower.endsWith(".d.ts")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".jsx")) {
    return "javascript";
  }
  if (lower.endsWith(".rs")) return "rust";
  return null;
}

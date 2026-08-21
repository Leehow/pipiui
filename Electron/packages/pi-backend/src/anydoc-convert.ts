import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ANYDOC_VERSION = "0.2.3";
export const MAX_ANYDOC_BYTES = 50 * 1024 * 1024;

const ANYDOC_FORMATS = new Set([
  "doc",
  "docx",
  "odt",
  "ppt",
  "pptx",
  "rtf",
  "epub",
  "xlsx",
  "ods",
  "odp",
  "csv",
]);

export function shippedAnydocRoot(): string {
  return join(fileURLToPath(new URL("../../../resources/runtime/anydoc", import.meta.url)));
}

export function anydocNodeModules(anydocRoot?: string): string {
  const root = anydocRoot?.trim() || process.env.PIPIUI_ANYDOC_ROOT?.trim() || shippedAnydocRoot();
  return join(root, "node_modules");
}

function formatFromPath(path: string): string | undefined {
  const extension = extname(path).replace(/^\./, "").toLowerCase();
  if (ANYDOC_FORMATS.has(extension)) return extension;
  if (extension === "docm") return "docx";
  if (extension === "pptm" || extension === "pps" || extension === "ppsx" || extension === "ppsm" || extension === "pot") return "pptx";
  if (extension === "xlsm" || extension === "xlsb" || extension === "xls") return "xlsx";
  return undefined;
}

type WasmAnydoc = {
  initSync: (input: { module: Buffer } | Buffer) => unknown;
  toMarkdownBytes: (bytes: Uint8Array, format?: string | null) => string;
  formatFromPath?: (path: string) => string | undefined;
};

type NativeAnydoc = {
  toMarkdownBytes: (bytes: Uint8Array, format?: string | null) => Promise<string> | string;
  formatFromPath?: (path: string) => string | null | undefined;
};

let wasmApi: Promise<WasmAnydoc> | undefined;

async function loadWasm(nodeModules: string): Promise<WasmAnydoc> {
  const wasmRoot = join(nodeModules, "@firecrawl", "anydoc-wasm");
  const wasmModule = await import(pathToFileURL(join(wasmRoot, "anydoc_wasm.js")).href) as WasmAnydoc;
  wasmModule.initSync({ module: await readFile(join(wasmRoot, "anydoc_wasm_bg.wasm")) });
  return wasmModule;
}

async function convertBytes(bytes: Uint8Array, path: string, nodeModules: string): Promise<string> {
  const wasmFile = join(nodeModules, "@firecrawl", "anydoc-wasm", "anydoc_wasm_bg.wasm");
  if (existsSync(wasmFile)) {
    try {
      wasmApi ??= loadWasm(nodeModules);
      const wasm = await wasmApi;
      const format = wasm.formatFromPath?.(path) || formatFromPath(path);
      const markdown = wasm.toMarkdownBytes(bytes, format ?? null);
      return typeof markdown === "string" ? markdown : "";
    } catch {
      wasmApi = undefined;
    }
  }
  const nativeManifest = join(nodeModules, "@firecrawl", "anydoc", "package.json");
  if (!existsSync(nativeManifest)) throw new Error("anydoc has no usable engine");
  const native = createRequire(nativeManifest)("@firecrawl/anydoc") as NativeAnydoc;
  const format = native.formatFromPath?.(path) || formatFromPath(path);
  const markdown = await native.toMarkdownBytes(bytes, format ?? null);
  return typeof markdown === "string" ? markdown : "";
}

/** Host-side local convert for prompt injection. Never uploads. Returns undefined on failure. */
export async function convertDocumentFileToMarkdown(
  path: string,
  options: { anydocRoot?: string } = {},
): Promise<string | undefined> {
  const target = path.trim();
  if (!target || !isAbsolute(target)) return undefined;
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_ANYDOC_BYTES) return undefined;
    const bytes = await readFile(target);
    const markdown = (await convertBytes(bytes, target, anydocNodeModules(options.anydocRoot))).trim();
    return markdown || undefined;
  } catch {
    return undefined;
  }
}

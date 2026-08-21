import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ANYDOC_VERSION = "0.2.3";
export const MAX_ANYDOC_BYTES = 50 * 1024 * 1024;

export type LocalAnydocEngine = "native" | "wasm";

export type LocalAnydocResult = {
  engine: LocalAnydocEngine;
  markdown: string;
  format?: string;
};

/** Anydoc formats the local tool accepts. PDF stays on `pipiui_firecrawl_pdf`. */
export const ANYDOC_TOOL_EXTENSIONS = [
  ".doc",
  ".docx",
  ".docm",
  ".ppt",
  ".pps",
  ".pot",
  ".pptx",
  ".pptm",
  ".ppsx",
  ".ppsm",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlsb",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".epub",
  ".csv",
] as const;

export type AnydocToolExtension = (typeof ANYDOC_TOOL_EXTENSIONS)[number];

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

export function anydocNodeModules(fromUrl = import.meta.url): string {
  const fromEnv = process.env.PIPIUI_ANYDOC_ROOT?.trim();
  if (fromEnv) return join(fromEnv, "node_modules");
  return join(dirname(fileURLToPath(fromUrl)), "..", "anydoc", "node_modules");
}

export function anydocNativePackageName(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin" && arch === "arm64") return "@firecrawl/anydoc-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "@firecrawl/anydoc-darwin-x64";
  if (platform === "linux" && arch === "x64") return "@firecrawl/anydoc-linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "@firecrawl/anydoc-linux-arm64-gnu";
  if (platform === "win32" && arch === "x64") return "@firecrawl/anydoc-win32-x64-msvc";
  return undefined;
}

export function anydocEngineAvailability(
  nodeModules: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { native: boolean; wasm: boolean; nativePackage?: string } {
  const nativePackage = anydocNativePackageName(platform, arch);
  return {
    native: Boolean(nativePackage && existsSync(join(nodeModules, nativePackage))),
    wasm: existsSync(join(nodeModules, "@firecrawl", "anydoc-wasm", "anydoc_wasm_bg.wasm")),
    nativePackage,
  };
}

export function anydocExtensionForName(name: string): AnydocToolExtension | null {
  const normalized = name.toLowerCase().split("?")[0] ?? "";
  let matched: AnydocToolExtension | undefined;
  for (const extension of ANYDOC_TOOL_EXTENSIONS) {
    if (!normalized.endsWith(extension)) continue;
    if (!matched || extension.length > matched.length) matched = extension;
  }
  return matched ?? null;
}

export function looksLikeAnydocName(name: string): boolean {
  return anydocExtensionForName(name) !== null;
}

type AnydocFormat = "doc" | "docx" | "odt" | "ppt" | "pptx" | "rtf" | "epub" | "xlsx" | "ods" | "odp" | "csv";

export function anydocFormatFromPath(path: string): AnydocFormat | undefined {
  const extension = (anydocExtensionForName(path) ?? extname(path)).replace(/^\./, "").toLowerCase();
  if (ANYDOC_FORMATS.has(extension)) return extension as AnydocFormat;
  if (extension === "docm") return "docx";
  if (extension === "pptm" || extension === "pps" || extension === "ppsx" || extension === "ppsm" || extension === "pot") return "pptx";
  if (extension === "xlsm" || extension === "xlsb" || extension === "xls") return "xlsx";
  return undefined;
}

type WasmAnydoc = {
  initSync: (input: { module: Buffer } | Buffer) => unknown;
  toMarkdownBytes: (bytes: Uint8Array, format?: string | null) => string;
  formatFromPath?: (path: string) => string | undefined;
  formatFromExtension?: (extension: string) => string | undefined;
};

type NativeAnydoc = {
  toMarkdownBytes: (bytes: Uint8Array, format?: string | null) => Promise<string> | string;
  formatFromPath?: (path: string) => string | null | undefined;
  formatFromExtension?: (extension: string) => string | null | undefined;
};

let wasmApi: Promise<WasmAnydoc> | undefined;

async function loadWasm(nodeModules: string): Promise<WasmAnydoc> {
  const wasmRoot = join(nodeModules, "@firecrawl", "anydoc-wasm");
  const wasmModule = await import(pathToFileURL(join(wasmRoot, "anydoc_wasm.js")).href) as WasmAnydoc;
  wasmModule.initSync({ module: await readFile(join(wasmRoot, "anydoc_wasm_bg.wasm")) });
  return wasmModule;
}

function loadNative(nodeModules: string): NativeAnydoc {
  const require = createRequire(join(nodeModules, "@firecrawl", "anydoc", "package.json"));
  return require("@firecrawl/anydoc") as NativeAnydoc;
}

function resolveFormat(path: string, api?: { formatFromPath?: (path: string) => string | null | undefined; formatFromExtension?: (extension: string) => string | null | undefined }): AnydocFormat | undefined {
  const fromApi = api?.formatFromPath?.(path) || api?.formatFromExtension?.(extname(path).replace(/^\./, ""));
  if (fromApi && ANYDOC_FORMATS.has(fromApi)) return fromApi as AnydocFormat;
  return anydocFormatFromPath(path);
}

export async function convertBytesWithAnydoc(
  bytes: Uint8Array,
  options: { path?: string; format?: string; nodeModules?: string; platform?: NodeJS.Platform; arch?: string } = {},
): Promise<LocalAnydocResult> {
  const nodeModules = options.nodeModules ?? anydocNodeModules();
  const availability = anydocEngineAvailability(nodeModules, options.platform ?? process.platform, options.arch ?? process.arch);
  const path = options.path ?? "";
  if (availability.wasm) {
    try {
      wasmApi ??= loadWasm(nodeModules);
      const wasm = await wasmApi;
      const format = options.format ?? resolveFormat(path, wasm);
      const markdown = wasm.toMarkdownBytes(bytes, format ?? null);
      return { engine: "wasm", markdown: typeof markdown === "string" ? markdown : "", format };
    } catch {
      wasmApi = undefined;
      // Fall through to native when wasm init/convert fails.
    }
  }
  if (availability.native) {
    const native = loadNative(nodeModules);
    const format = options.format ?? resolveFormat(path, native);
    const markdown = await native.toMarkdownBytes(bytes, format ?? null);
    return { engine: "native", markdown: typeof markdown === "string" ? markdown : "", format };
  }
  throw new Error(
    availability.nativePackage
      ? `anydoc has no usable engine: native ${availability.nativePackage} is not installed and wasm is missing`
      : "anydoc has no usable engine on this platform (native vendor not shipped; wasm missing)",
  );
}

export async function convertLocalFileToMarkdown(
  path: string,
  options: { nodeModules?: string } = {},
): Promise<string> {
  if (!path.trim() || !isAbsolute(path)) throw new Error("本地文档必须是绝对路径");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("路径不是普通文件");
  if (info.size > MAX_ANYDOC_BYTES) throw new Error(`本地文档超过 50MB 上限（${info.size} 字节）`);
  const bytes = await readFile(path);
  const result = await convertBytesWithAnydoc(bytes, { path, nodeModules: options.nodeModules });
  return result.markdown;
}

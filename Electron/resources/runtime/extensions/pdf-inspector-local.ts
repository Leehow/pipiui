import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PDF_INSPECTOR_VERSION = "1.15.0";

export type LocalInspectEngine = "native" | "wasm";

export type LocalInspectResult = {
  engine: LocalInspectEngine;
  pdfType: string;
  markdown: string;
  pageCount: number;
  pagesNeedingOcr: number[];
  confidence?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function pdfInspectorNodeModules(fromUrl = import.meta.url): string {
  const fromEnv = process.env.PIPIUI_PDF_INSPECTOR_ROOT?.trim();
  if (fromEnv) return join(fromEnv, "node_modules");
  return join(dirname(fileURLToPath(fromUrl)), "..", "pdf-inspector", "node_modules");
}

/** Optional native vendor; win32-x64-msvc is in the lockfile but not committed. */
export function pdfInspectorNativePackageName(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin" && arch === "arm64") return "@firecrawl/pdf-inspector-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "@firecrawl/pdf-inspector-darwin-x64";
  if (platform === "linux" && arch === "x64") return "@firecrawl/pdf-inspector-linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "@firecrawl/pdf-inspector-linux-arm64-gnu";
  if (platform === "win32" && arch === "x64") return "@firecrawl/pdf-inspector-win32-x64-msvc";
  return undefined;
}

export function pdfInspectorEngineAvailability(
  nodeModules: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { native: boolean; wasm: boolean; nativePackage?: string } {
  const nativePackage = pdfInspectorNativePackageName(platform, arch);
  return {
    native: Boolean(nativePackage && existsSync(join(nodeModules, nativePackage))),
    wasm: existsSync(join(nodeModules, "@firecrawl", "pdf-inspector-wasm", "pdf_inspector_wasm_bg.wasm")),
    nativePackage,
  };
}

function pageList(maxPages?: number): number[] | undefined {
  if (!maxPages || maxPages < 1) return undefined;
  return Array.from({ length: maxPages }, (_, index) => index + 1);
}

export function normalizeInspectorResult(raw: unknown, engine: LocalInspectEngine): LocalInspectResult {
  const object = asRecord(raw) ?? {};
  const markdown = typeof object.markdown === "string" ? object.markdown : "";
  const pdfType = typeof object.pdfType === "string" ? object.pdfType : typeof object.pdf_type === "string" ? object.pdf_type : "Unknown";
  const pageCount = typeof object.pageCount === "number" ? object.pageCount : typeof object.page_count === "number" ? object.page_count : 0;
  const pages = Array.isArray(object.pagesNeedingOcr)
    ? object.pagesNeedingOcr
    : Array.isArray(object.pages_needing_ocr)
      ? object.pages_needing_ocr
      : [];
  const pagesNeedingOcr = pages.filter((page): page is number => typeof page === "number");
  const confidence = typeof object.confidence === "number" ? object.confidence : undefined;
  return { engine, pdfType, markdown, pageCount, pagesNeedingOcr, confidence };
}

export function isScanLike(result: LocalInspectResult): boolean {
  const type = result.pdfType.replace(/_/g, "").toLowerCase();
  return type === "scanned" || type === "imagebased";
}

export function indicatesOcr(result: LocalInspectResult): boolean {
  return isScanLike(result) || result.pagesNeedingOcr.length > 0;
}

export async function inspectPdfWithOfficial(
  bytes: Uint8Array,
  options: { maxPages?: number; nodeModules?: string; platform?: NodeJS.Platform; arch?: string } = {},
): Promise<LocalInspectResult> {
  const nodeModules = options.nodeModules ?? pdfInspectorNodeModules();
  const availability = pdfInspectorEngineAvailability(nodeModules, options.platform ?? process.platform, options.arch ?? process.arch);
  const processOptions = options.maxPages ? { pages: pageList(options.maxPages) } : undefined;
  if (availability.native) {
    try {
      const require = createRequire(join(nodeModules, "@firecrawl", "pdf-inspector", "package.json"));
      const native = require("@firecrawl/pdf-inspector") as { processPdf: (buffer: Buffer, opts?: unknown) => unknown };
      let result: unknown;
      try {
        result = processOptions ? native.processPdf(Buffer.from(bytes), processOptions) : native.processPdf(Buffer.from(bytes));
      } catch {
        result = native.processPdf(Buffer.from(bytes));
      }
      return normalizeInspectorResult(result, "native");
    } catch {
      // Fall through to wasm when the optional native binding fails to load.
    }
  }
  if (!availability.wasm) {
    throw new Error(
      availability.nativePackage
        ? `pdf-inspector has no usable engine: native ${availability.nativePackage} is not installed and wasm is missing`
        : "pdf-inspector has no usable engine on this platform (native vendor not shipped; wasm missing)",
    );
  }
  const wasmRoot = join(nodeModules, "@firecrawl", "pdf-inspector-wasm");
  const wasmModule = await import(pathToFileURL(join(wasmRoot, "pdf_inspector_wasm.js")).href) as {
    initSync: (input: { module: Buffer }) => unknown;
    processPdf: (data: Uint8Array, opts?: unknown) => unknown;
  };
  wasmModule.initSync({ module: await readFile(join(wasmRoot, "pdf_inspector_wasm_bg.wasm")) });
  const result = wasmModule.processPdf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), processOptions);
  return normalizeInspectorResult(result, "wasm");
}

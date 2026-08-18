import { createRequire } from "node:module";
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
  options: { maxPages?: number; nodeModules?: string } = {},
): Promise<LocalInspectResult> {
  const nodeModules = options.nodeModules ?? pdfInspectorNodeModules();
  const require = createRequire(join(nodeModules, "@firecrawl", "pdf-inspector", "package.json"));
  const processOptions = options.maxPages ? { pages: pageList(options.maxPages) } : undefined;
  try {
    const native = require("@firecrawl/pdf-inspector") as { processPdf: (buffer: Buffer, opts?: unknown) => unknown };
    let result: unknown;
    try {
      result = processOptions ? native.processPdf(Buffer.from(bytes), processOptions) : native.processPdf(Buffer.from(bytes));
    } catch {
      result = native.processPdf(Buffer.from(bytes));
    }
    return normalizeInspectorResult(result, "native");
  } catch {
    const wasmRoot = join(nodeModules, "@firecrawl", "pdf-inspector-wasm");
    const wasmModule = await import(pathToFileURL(join(wasmRoot, "pdf_inspector_wasm.js")).href) as {
      initSync: (input: { module: Buffer }) => unknown;
      processPdf: (data: Uint8Array, opts?: unknown) => unknown;
    };
    wasmModule.initSync({ module: await readFile(join(wasmRoot, "pdf_inspector_wasm_bg.wasm")) });
    const result = wasmModule.processPdf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), processOptions);
    return normalizeInspectorResult(result, "wasm");
  }
}

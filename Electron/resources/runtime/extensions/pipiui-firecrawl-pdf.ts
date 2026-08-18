import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { open, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectPdfWithOfficial,
  indicatesOcr,
  type LocalInspectResult,
} from "./pdf-inspector-local.ts";

export const FIRECRAWL_PDF_TOOL = "pipiui_firecrawl_pdf";
export const FIRECRAWL_PARSE_URL = "https://api.firecrawl.dev/v2/parse";
export const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MIN_PAGES = 1;
export const MAX_PAGES = 10_000;
export const MAX_ERROR_CHARS = 400;
export const WEB_SEARCH_CONFIG_NAME = "web-search.json";
export const FIRECRAWL_API_KEY_FIELD = "firecrawlApiKey";
export const OCR_KEY_HINT =
  "这是扫描件/图片页，本地文本提取没有可用正文。可选：在设置 → 通用 → Firecrawl OCR Key（选填）中配置密钥后，用 mode=ocr 或 auto 走云端 OCR。普通文字型 PDF 无需 Key，可继续用 auto/fast 本地解析。";
export const OCR_MODE_NEEDS_KEY =
  "mode=ocr 需要可选的 Firecrawl OCR Key。本地文字提取（auto/fast）无需 Key，仍可用于文字型 PDF。申请：https://www.firecrawl.dev/app/api-keys";

export type PdfParseMode = "auto" | "fast" | "ocr";

export type FirecrawlPdfParams = {
  source: string;
  mode?: PdfParseMode;
  maxPages?: number;
  timeout?: number;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function readFirecrawlApiKeyFromConfig(raw: unknown): string | undefined {
  const key = asObject(raw)?.[FIRECRAWL_API_KEY_FIELD];
  if (typeof key !== "string") return undefined;
  const trimmed = key.trim();
  return trimmed || undefined;
}

export async function loadFirecrawlApiKey(agentDir = process.env.PI_CODING_AGENT_DIR): Promise<string | undefined> {
  if (!agentDir) return undefined;
  try {
    const { join } = await import("node:path");
    const text = await readFile(join(agentDir, WEB_SEARCH_CONFIG_NAME), "utf8");
    return readFirecrawlApiKeyFromConfig(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function normalizePdfMode(value: unknown): PdfParseMode {
  return value === "fast" || value === "ocr" || value === "auto" ? value : "auto";
}

export function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(value)));
}

export function normalizeMaxPages(value: unknown): number | undefined | { error: string } {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数` };
  }
  const pages = Math.floor(value);
  if (pages < MIN_PAGES || pages > MAX_PAGES) {
    return { error: `maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数` };
  }
  return pages;
}

export function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export function looksLikePdfName(name: string): boolean {
  return name.toLowerCase().split("?")[0]?.endsWith(".pdf") === true;
}

/** Firecrawl expects a filename; extensionless locals still upload as a safe .pdf name. */
export function uploadFilename(path: string): string {
  const base = path.split("/").pop()?.trim() || "";
  return looksLikePdfName(base) ? base : "document.pdf";
}

export function sanitizePublicError(text: string, secret?: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (secret) out = out.split(secret).join("[redacted]");
  out = out.replace(/fc-[a-z0-9_-]{8,}/gi, "[redacted]");
  if (out.length > MAX_ERROR_CHARS) out = `${out.slice(0, MAX_ERROR_CHARS)}…`;
  return out || "解析失败";
}

export type ResolvedPdfSource =
  | { kind: "local"; path: string }
  | { kind: "url"; url: string };

export function resolvePdfSource(raw: string): ResolvedPdfSource | { error: string } {
  const source = raw.trim();
  if (!source) return { error: "source 不能为空" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^file:/i.test(source)) {
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      return { error: "公网文档 URL 无效" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "只支持 http/https 公网文档 URL" };
    }
    return { kind: "url", url: parsed.toString() };
  }
  let path = source;
  if (/^file:/i.test(source)) {
    try {
      path = fileURLToPath(source);
    } catch {
      return { error: "file:// 路径无效" };
    }
  }
  if (!isAbsolute(path)) return { error: "本地 PDF 必须是绝对路径" };
  return { kind: "local", path };
}

function parserOptions(mode: PdfParseMode, maxPages?: number) {
  const parser: Record<string, unknown> = { type: "pdf", mode };
  if (maxPages !== undefined) parser.maxPages = maxPages;
  return [parser];
}

export function firecrawlErrorText(status: number, body: unknown, secret?: string): string {
  const object = asObject(body);
  const raw =
    (typeof object?.error === "string" && object.error) ||
    (typeof object?.message === "string" && object.message) ||
    (typeof object?.details === "string" && object.details) ||
    (typeof body === "string" ? body : "");
  const prefix = status > 0 ? `Firecrawl ${status}` : "Firecrawl";
  if (!raw.trim()) return sanitizePublicError(`${prefix}: 解析失败`, secret);
  return sanitizePublicError(`${prefix}: ${raw}`, secret);
}

export function extractParsedMarkdown(body: unknown): { markdown: string; numPages?: number; totalPages?: number } | { error: string } {
  const object = asObject(body);
  if (!object) return { error: "Firecrawl 返回了无法解析的响应" };
  if (object.success === false) return { error: firecrawlErrorText(0, object) };
  const data = asObject(object.data) ?? object;
  const markdown = typeof data.markdown === "string" ? data.markdown : typeof object.markdown === "string" ? object.markdown : "";
  if (!markdown.trim()) return { error: "Firecrawl 未返回 PDF 正文（markdown 为空）" };
  const metadata = asObject(data.metadata) ?? asObject(object.metadata);
  const numPages = typeof metadata?.numPages === "number" ? metadata.numPages : typeof data.numPages === "number" ? data.numPages : undefined;
  const totalPages = typeof metadata?.totalPages === "number" ? metadata.totalPages : typeof data.totalPages === "number" ? data.totalPages : undefined;
  return { markdown, numPages, totalPages };
}

export async function readLocalPdfBytes(
  path: string,
  io?: {
    stat?: typeof stat;
    open?: typeof open;
  },
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const statFn = io?.stat ?? stat;
  const openFn = io?.open ?? open;
  try {
    const info = await statFn(path);
    if (!info.isFile()) return { ok: false, error: "路径不是普通 PDF 文件" };
    if (info.size > MAX_PDF_BYTES) return { ok: false, error: `本地 PDF 超过 50MB 上限（${info.size} 字节）` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, error: `找不到本地 PDF：${path}` };
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: "没有权限读取该本地 PDF" };
    return { ok: false, error: `无法读取本地 PDF：${error instanceof Error ? error.message : String(error)}` };
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await openFn(path, "r");
    const buf = Buffer.alloc(MAX_PDF_BYTES + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead > MAX_PDF_BYTES) return { ok: false, error: `本地 PDF 超过 50MB 上限（读取后 ${bytesRead} 字节）` };
    const bytes = Buffer.from(buf.subarray(0, bytesRead));
    if (!isPdfMagic(bytes)) return { ok: false, error: "文件不是有效的 PDF（缺少 %PDF- 头）" };
    return { ok: true, bytes };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: "没有权限读取该本地 PDF" };
    return { ok: false, error: `无法读取本地 PDF：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function downloadPdfBytes(options: {
  url: string;
  timeout: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, error: "下载 PDF 超时" };
    return { ok: false, error: `无法下载 PDF：${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) return { ok: false, error: `下载 PDF 失败：HTTP ${response.status}` };
  const finalUrl = response.url || options.url;
  if (!/^https?:\/\//i.test(finalUrl)) return { ok: false, error: "下载被重定向到非 http/https 地址" };
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
    return { ok: false, error: `远程 PDF 超过 50MB 上限（Content-Length ${declared}）` };
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: `远程 PDF 超过 50MB 上限（下载中 ${total} 字节）` };
      }
      chunks.push(value);
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PDF_BYTES) return { ok: false, error: `远程 PDF 超过 50MB 上限（${buffer.length} 字节）` };
    chunks.push(buffer);
    total = buffer.length;
  }
  const bytes = Buffer.concat(chunks, total);
  if (!isPdfMagic(bytes)) return { ok: false, error: "下载内容不是有效的 PDF（缺少 %PDF- 头）" };
  return { ok: true, bytes };
}

export async function parseCloudPdf(options: {
  bytes: Uint8Array;
  filename?: string;
  apiKey: string;
  maxPages?: number;
  timeout: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; markdown: string; numPages?: number; totalPages?: number } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("file", new Blob([options.bytes], { type: "application/pdf" }), options.filename || "document.pdf");
  const parseOptions: Record<string, unknown> = {
    formats: ["markdown"],
    timeout: options.timeout,
    parsers: parserOptions("ocr", options.maxPages),
  };
  form.append("options", new Blob([JSON.stringify(parseOptions)], { type: "application/json" }));
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(FIRECRAWL_PARSE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(options.timeout + 5_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: sanitizePublicError("Firecrawl 请求超时", options.apiKey) };
    }
    return { ok: false, error: sanitizePublicError(`无法连接 Firecrawl：${error instanceof Error ? error.message : String(error)}`, options.apiKey) };
  }
  const body = await response.json().catch(() => undefined);
  if (!response.ok) return { ok: false, error: firecrawlErrorText(response.status, body, options.apiKey) };
  const extracted = extractParsedMarkdown(body);
  if ("error" in extracted) return { ok: false, error: sanitizePublicError(extracted.error, options.apiKey) };
  return { ok: true, ...extracted };
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, ...(isError ? { isError: true } : {}) };
}

function formatLocalMarkdown(result: LocalInspectResult, extra = ""): string {
  const pages = result.pageCount ? `\n--- pages ${result.pageCount} (${result.pdfType}, ${result.engine}) ---` : "";
  return `${result.markdown.trim()}${pages}${extra}`;
}

export type InspectPdfFn = (bytes: Uint8Array, options?: { maxPages?: number }) => Promise<LocalInspectResult>;

export async function executeFirecrawlPdf(
  params: FirecrawlPdfParams,
  deps: {
    inspect?: InspectPdfFn;
    fetchImpl?: typeof fetch;
    apiKey?: string | null;
  } = {},
): Promise<{ content: [{ type: "text"; text: string }]; details: Record<string, never>; isError?: boolean }> {
  const apiKey = deps.apiKey === undefined ? await loadFirecrawlApiKey() : deps.apiKey || undefined;
  const resolved = resolvePdfSource(String(params.source ?? ""));
  if ("error" in resolved) return toolResult(resolved.error, true);
  const mode = normalizePdfMode(params.mode);
  const timeout = normalizeTimeoutMs(params.timeout);
  const maxPages = normalizeMaxPages(params.maxPages);
  if (maxPages && typeof maxPages === "object" && "error" in maxPages) return toolResult(maxPages.error, true);
  const pages = typeof maxPages === "number" ? maxPages : undefined;

  if (mode === "ocr" && !apiKey) return toolResult(OCR_MODE_NEEDS_KEY, true);

  let bytes: Buffer;
  let filename = "document.pdf";
  if (resolved.kind === "local") {
    const loaded = await readLocalPdfBytes(resolved.path);
    if (!loaded.ok) return toolResult(loaded.error, true);
    bytes = loaded.bytes;
    filename = uploadFilename(resolved.path);
  } else {
    const loaded = await downloadPdfBytes({ url: resolved.url, timeout, fetchImpl: deps.fetchImpl });
    if (!loaded.ok) return toolResult(loaded.error, true);
    bytes = loaded.bytes;
  }

  const inspect = deps.inspect ?? ((data, options) => inspectPdfWithOfficial(data, options));

  if (mode === "ocr") {
    const cloud = await parseCloudPdf({ bytes, filename, apiKey: apiKey!, maxPages: pages, timeout, fetchImpl: deps.fetchImpl });
    if (!cloud.ok) return toolResult(cloud.error, true);
    return toolResult(cloud.markdown);
  }

  let local: LocalInspectResult;
  try {
    local = await inspect(bytes, { maxPages: pages });
  } catch (error) {
    return toolResult(`本地 PDF 提取失败：${error instanceof Error ? error.message : String(error)}`, true);
  }

  const text = local.markdown.trim();
  const ocrIndicated = indicatesOcr(local);

  if (mode === "fast") {
    if (!text) return toolResult(OCR_KEY_HINT, true);
    const note = ocrIndicated
      ? `\n--- 部分页面可能需要 OCR（${local.pagesNeedingOcr.join(",") || local.pdfType}）；fast 模式不调用云端。 ---`
      : "";
    return toolResult(formatLocalMarkdown(local, note));
  }

  if (mode === "auto" && ocrIndicated && apiKey) {
    const cloud = await parseCloudPdf({ bytes, filename, apiKey, maxPages: pages, timeout, fetchImpl: deps.fetchImpl });
    if (!cloud.ok) return toolResult(cloud.error, true);
    return toolResult(cloud.markdown);
  }

  if (!text) return toolResult(OCR_KEY_HINT, true);
  const note = ocrIndicated && !apiKey
    ? `\n--- 已本地提取文字。以下页建议 OCR 但未配置可选 OCR Key：${local.pagesNeedingOcr.join(",") || local.pdfType}。普通文字提取无需 Key。 ---`
    : "";
  return toolResult(formatLocalMarkdown(local, note));
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: FIRECRAWL_PDF_TOOL,
    label: "Firecrawl PDF",
    description:
      "Extract Markdown from a local PDF path, file:// PDF, or http(s) PDF URL using Firecrawl pdf-inspector locally. " +
      "No API key is required for text PDFs. Optional Firecrawl OCR Key is only used when auto detects image-only pages or mode=ocr. " +
      "Opening the document panel does not parse or upload. Modes: auto (default), fast (local only), ocr (cloud, needs key).",
    promptSnippet: "Parse PDF locally with pipiui_firecrawl_pdf; OCR key is optional",
    promptGuidelines: [
      "Use pipiui_firecrawl_pdf for PDF content. Do not use read on PDF bytes.",
      "Text PDFs are extracted locally and never uploaded. Cloud OCR runs only for scanned/image pages when a key is configured, or when mode=ocr.",
      "Opening the right-hand document panel does not parse or upload the PDF.",
    ],
    parameters: Type.Object(
      {
        source: Type.String({ description: "Absolute local path, file:// URL, or http(s) document URL" }),
        mode: Type.Optional(Type.Unsafe<PdfParseMode>({ type: "string", enum: ["auto", "fast", "ocr"] })),
        maxPages: Type.Optional(Type.Integer({ minimum: MIN_PAGES, maximum: MAX_PAGES, description: "Max PDF pages to parse (1-10000)" })),
        timeout: Type.Optional(Type.Integer({ minimum: 1000, maximum: MAX_TIMEOUT_MS, description: "Timeout in milliseconds" })),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params) {
      return executeFirecrawlPdf(params as FirecrawlPdfParams);
    },
  });
}

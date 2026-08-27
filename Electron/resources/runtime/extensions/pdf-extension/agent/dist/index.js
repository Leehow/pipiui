import { Type } from "typebox";
import { open, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPdfWithOfficial, indicatesOcr, } from "./pdf-inspector-local.js";
import { callPaddleocrVl } from "./paddleocr-mcp-client.js";
export const FIRECRAWL_PDF_TOOL = "pipiui_firecrawl_pdf";
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MIN_PAGES = 1;
export const MAX_PAGES = 10_000;
export const MAX_ERROR_CHARS = 400;
export const PADDLEOCR_CONFIG_NAME = "paddleocr.json";
export const PADDLEOCR_TOKEN_FIELD = "aistudioAccessToken";
/** This extension's manifest id. */
export const PDF_EXTENSION_ID = "pdf-extension";
/** Namespaced project-scoped extension settings key holding the AI Studio token (format: secret). */
export const SETTINGS_SECRET_KEY = `ext.${PDF_EXTENSION_ID}.aistudioAccessToken`;
/**
 * Env name the host uses to inject the vaulted secret, derived with the same
 * algorithm as pi-backend `secretEnvName(SETTINGS_SECRET_KEY)`
 * (`putExtensionSecrets` → vault `envName`). Legacy fallback follows.
 */
export const EXTENSION_SECRET_ENV = "EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN";
export const OCR_SKIPPED_NOTE = "OCR 未执行：未配置 PaddleOCR AI Studio Token。文字型 PDF 仍使用本地提取，不会上传。可在 设置 → 扩展 → PipiUI PDF 中配置。";
export const OCR_MODE_NEEDS_KEY = "缺少 PaddleOCR Token：mode=ocr 需要在 设置 → 扩展 → PipiUI PDF 配置 AI Studio Access Token。文字型 PDF 请用 auto/fast 本地提取，不会上传。申请：https://aistudio.baidu.com/account/accessToken";
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function readPaddleocrTokenFromConfig(raw) {
    const key = asObject(raw)?.[PADDLEOCR_TOKEN_FIELD];
    if (typeof key !== "string")
        return undefined;
    const trimmed = key.trim();
    return trimmed || undefined;
}
/** Legacy fallback: per-project `<agentDir>/paddleocr.json`. Kept until migration is proven. */
export async function loadPaddleocrToken(agentDir = process.env.PI_CODING_AGENT_DIR) {
    if (!agentDir)
        return undefined;
    try {
        const { join } = await import("node:path");
        const text = await readFile(join(agentDir, PADDLEOCR_CONFIG_NAME), "utf8");
        return readPaddleocrTokenFromConfig(JSON.parse(text));
    }
    catch {
        return undefined;
    }
}
/**
 * Token resolution for this extension: the host-injected extension secret env
 * first (post-cutover contract), then the legacy project config file.
 */
export async function resolvePaddleocrToken(env = process.env) {
    const injected = env[EXTENSION_SECRET_ENV]?.trim();
    if (injected)
        return injected;
    return loadPaddleocrToken();
}
export function normalizePdfMode(value) {
    return value === "fast" || value === "ocr" || value === "auto" ? value : "auto";
}
export function normalizeTimeoutMs(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return DEFAULT_TIMEOUT_MS;
    return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(value)));
}
export function normalizeMaxPages(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: `maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数` };
    }
    const pages = Math.floor(value);
    if (pages < MIN_PAGES || pages > MAX_PAGES) {
        return { error: `maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数` };
    }
    return pages;
}
export function isPdfMagic(bytes) {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}
export function looksLikePdfName(name) {
    return name.toLowerCase().split("?")[0]?.endsWith(".pdf") === true;
}
export function uploadFilename(path) {
    const base = path.split("/").pop()?.trim() || "";
    return looksLikePdfName(base) ? base : "document.pdf";
}
export function sanitizePublicError(text, secret) {
    let out = text.replace(/\s+/g, " ").trim();
    if (secret)
        out = out.split(secret).join("[redacted]");
    out = out.replace(/fc-[a-z0-9_-]{8,}/gi, "[redacted]");
    if (out.length > MAX_ERROR_CHARS)
        out = `${out.slice(0, MAX_ERROR_CHARS)}…`;
    return out || "解析失败";
}
export function resolvePdfSource(raw) {
    const source = raw.trim();
    if (!source)
        return { error: "source 不能为空" };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^file:/i.test(source)) {
        let parsed;
        try {
            parsed = new URL(source);
        }
        catch {
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
        }
        catch {
            return { error: "file:// 路径无效" };
        }
    }
    if (!isAbsolute(path))
        return { error: "本地 PDF 必须是绝对路径" };
    return { kind: "local", path };
}
export async function readLocalPdfBytes(path, io) {
    const statFn = io?.stat ?? stat;
    const openFn = io?.open ?? open;
    try {
        const info = await statFn(path);
        if (!info.isFile())
            return { ok: false, error: "路径不是普通 PDF 文件" };
        if (info.size > MAX_PDF_BYTES)
            return { ok: false, error: `本地 PDF 超过 50MB 上限（${info.size} 字节）` };
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT")
            return { ok: false, error: `找不到本地 PDF：${path}` };
        if (code === "EACCES" || code === "EPERM")
            return { ok: false, error: "没有权限读取该本地 PDF" };
        return { ok: false, error: `无法读取本地 PDF：${error instanceof Error ? error.message : String(error)}` };
    }
    let handle;
    try {
        handle = await openFn(path, "r");
        const buf = Buffer.alloc(MAX_PDF_BYTES + 1);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        if (bytesRead > MAX_PDF_BYTES)
            return { ok: false, error: `本地 PDF 超过 50MB 上限（读取后 ${bytesRead} 字节）` };
        const bytes = Buffer.from(buf.subarray(0, bytesRead));
        if (!isPdfMagic(bytes))
            return { ok: false, error: "文件不是有效的 PDF（缺少 %PDF- 头）" };
        return { ok: true, bytes };
    }
    catch (error) {
        const code = error.code;
        if (code === "EACCES" || code === "EPERM")
            return { ok: false, error: "没有权限读取该本地 PDF" };
        return { ok: false, error: `无法读取本地 PDF：${error instanceof Error ? error.message : String(error)}` };
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export async function downloadPdfBytes(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    let response;
    try {
        response = await fetchImpl(options.url, {
            redirect: "follow",
            signal: AbortSignal.timeout(options.timeout),
        });
    }
    catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError")
            return { ok: false, error: "下载 PDF 超时" };
        return { ok: false, error: `无法下载 PDF：${error instanceof Error ? error.message : String(error)}` };
    }
    if (!response.ok)
        return { ok: false, error: `下载 PDF 失败：HTTP ${response.status}` };
    const finalUrl = response.url || options.url;
    if (!/^https?:\/\//i.test(finalUrl))
        return { ok: false, error: "下载被重定向到非 http/https 地址" };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
        return { ok: false, error: `远程 PDF 超过 50MB 上限（Content-Length ${declared}）` };
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > MAX_PDF_BYTES) {
                await reader.cancel().catch(() => undefined);
                return { ok: false, error: `远程 PDF 超过 50MB 上限（下载中 ${total} 字节）` };
            }
            chunks.push(value);
        }
    }
    else {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_PDF_BYTES)
            return { ok: false, error: `远程 PDF 超过 50MB 上限（${buffer.length} 字节）` };
        chunks.push(buffer);
        total = buffer.length;
    }
    const bytes = Buffer.concat(chunks, total);
    if (!isPdfMagic(bytes))
        return { ok: false, error: "下载内容不是有效的 PDF（缺少 %PDF- 头）" };
    return { ok: true, bytes };
}
async function ocrWithPaddleocr(options) {
    const ocrFn = options.ocrFn ?? ((filePath, token) => callPaddleocrVl({ filePath, token }));
    if (options.localPath) {
        const result = await ocrFn(options.localPath, options.token);
        if (!result.ok)
            return { ok: false, error: sanitizePublicError(result.error, options.token) };
        return { ok: true, text: result.text };
    }
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "pipiui-paddleocr-"));
    const path = join(dir, options.filename || "document.pdf");
    try {
        await writeFile(path, options.bytes);
        const result = await ocrFn(path, options.token);
        if (!result.ok)
            return { ok: false, error: sanitizePublicError(result.error, options.token) };
        return { ok: true, text: result.text };
    }
    finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
function toolResult(text, isError = false) {
    return { content: [{ type: "text", text }], details: {}, ...(isError ? { isError: true } : {}) };
}
function formatLocalMarkdown(result, extra = "") {
    const pages = result.pageCount ? `\n--- pages ${result.pageCount} (${result.pdfType}, ${result.engine}) ---` : "";
    return `${result.markdown.trim()}${pages}${extra}`;
}
export async function executeFirecrawlPdf(params, deps = {}) {
    const apiKey = deps.apiKey === undefined ? await resolvePaddleocrToken() : deps.apiKey || undefined;
    const resolved = resolvePdfSource(String(params.source ?? ""));
    if ("error" in resolved)
        return toolResult(resolved.error, true);
    const mode = normalizePdfMode(params.mode);
    const timeout = normalizeTimeoutMs(params.timeout);
    const maxPages = normalizeMaxPages(params.maxPages);
    if (maxPages && typeof maxPages === "object" && "error" in maxPages)
        return toolResult(maxPages.error, true);
    const pages = typeof maxPages === "number" ? maxPages : undefined;
    if (mode === "ocr" && !apiKey)
        return toolResult(OCR_MODE_NEEDS_KEY, true);
    let bytes;
    let filename = "document.pdf";
    let localPath;
    if (resolved.kind === "local") {
        const loaded = await readLocalPdfBytes(resolved.path);
        if (!loaded.ok)
            return toolResult(loaded.error, true);
        bytes = loaded.bytes;
        filename = uploadFilename(resolved.path);
        localPath = resolved.path;
    }
    else {
        const loaded = await downloadPdfBytes({ url: resolved.url, timeout, fetchImpl: deps.fetchImpl });
        if (!loaded.ok)
            return toolResult(loaded.error, true);
        bytes = loaded.bytes;
    }
    const inspect = deps.inspect ?? ((data, options) => inspectPdfWithOfficial(data, options));
    const runOcr = async () => {
        const ocr = await ocrWithPaddleocr({
            localPath,
            bytes,
            filename,
            token: apiKey,
            ocrFn: deps.ocrFn,
        });
        if (!ocr.ok)
            return toolResult(ocr.error, true);
        return toolResult(ocr.text);
    };
    if (mode === "ocr")
        return runOcr();
    let local;
    try {
        local = await inspect(bytes, { maxPages: pages });
    }
    catch (error) {
        return toolResult(`本地 PDF 提取失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
    const text = local.markdown.trim();
    const ocrIndicated = indicatesOcr(local);
    if (mode === "fast") {
        const note = ocrIndicated
            ? `\n--- 部分页面可能需要 OCR（${local.pagesNeedingOcr.join(",") || local.pdfType}）；fast 模式永不调用 OCR。 ---`
            : "";
        if (!text)
            return toolResult(`${OCR_SKIPPED_NOTE}${note}`, true);
        return toolResult(formatLocalMarkdown(local, note));
    }
    if (mode === "auto" && ocrIndicated && apiKey)
        return runOcr();
    const note = ocrIndicated
        ? `\n--- ${OCR_SKIPPED_NOTE} 建议 OCR 页：${local.pagesNeedingOcr.join(",") || local.pdfType}。 ---`
        : "";
    return toolResult(formatLocalMarkdown(local, note));
}
export default function (pi) {
    pi.registerTool({
        name: FIRECRAWL_PDF_TOOL,
        label: "Firecrawl PDF",
        description: "Extract Markdown from a local PDF path, file:// PDF, or http(s) PDF URL using local pdf-inspector. " +
            "Text PDFs never use OCR. auto only calls built-in PaddleOCR-VL-1.6 when local parse indicatesOcr and a project token exists. " +
            "fast never OCRs. ocr requires a PaddleOCR token. Opening the document panel does not parse or upload.",
        promptSnippet: "Parse PDF locally with pipiui_firecrawl_pdf; PaddleOCR token is optional",
        promptGuidelines: [
            "Use pipiui_firecrawl_pdf for PDF content. Do not use read on PDF bytes.",
            "Text PDFs are extracted locally and never uploaded. PaddleOCR runs only for scanned/image pages when a token is configured, or when mode=ocr.",
            "Opening the right-hand document panel does not parse or upload the PDF.",
        ],
        parameters: Type.Object({
            source: Type.String({ description: "Absolute local path, file:// URL, or http(s) document URL" }),
            mode: Type.Optional(Type.Unsafe({ type: "string", enum: ["auto", "fast", "ocr"] })),
            maxPages: Type.Optional(Type.Integer({ minimum: MIN_PAGES, maximum: MAX_PAGES, description: "Max PDF pages to parse (1-10000)" })),
            timeout: Type.Optional(Type.Integer({ minimum: 1000, maximum: MAX_TIMEOUT_MS, description: "Timeout in milliseconds" })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, params) {
            return executeFirecrawlPdf(params);
        },
    });
}

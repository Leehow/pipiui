import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { open, stat } from "node:fs/promises";
import { type LocalInspectResult } from "./pdf-inspector-local.js";
export declare const FIRECRAWL_PDF_TOOL = "pipiui_firecrawl_pdf";
export declare const MAX_PDF_BYTES: number;
export declare const MAX_PDF_MB_LABEL: string;
export declare const DEFAULT_TIMEOUT_MS = 30000;
export declare const MAX_TIMEOUT_MS = 300000;
export declare const MIN_PAGES = 1;
export declare const MAX_PAGES = 10000;
export declare const MAX_ERROR_CHARS = 400;
export declare const PADDLEOCR_CONFIG_NAME = "paddleocr.json";
export declare const PADDLEOCR_TOKEN_FIELD = "aistudioAccessToken";
/** This extension's manifest id. */
export declare const PDF_EXTENSION_ID = "pdf-extension";
/** Namespaced project-scoped extension settings key holding the AI Studio token (format: secret). */
export declare const SETTINGS_SECRET_KEY = "ext.pdf-extension.aistudioAccessToken";
/**
 * Env name the host uses to inject the vaulted secret, derived with the same
 * algorithm as pi-backend `secretEnvName(SETTINGS_SECRET_KEY)`
 * (`putExtensionSecrets` → vault `envName`). Legacy fallback follows.
 */
export declare const EXTENSION_SECRET_ENV = "EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN";
export declare const OCR_SKIPPED_NOTE = "OCR \u672A\u6267\u884C\uFF1A\u672A\u914D\u7F6E PaddleOCR AI Studio Token\u3002\u6587\u5B57\u578B PDF \u4ECD\u4F7F\u7528\u672C\u5730\u63D0\u53D6\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u3002\u53EF\u5728 \u8BBE\u7F6E \u2192 \u6269\u5C55 \u2192 PipiUI PDF \u4E2D\u914D\u7F6E\u3002";
export declare const OCR_MODE_NEEDS_KEY = "\u7F3A\u5C11 PaddleOCR Token\uFF1Amode=ocr \u9700\u8981\u5728 \u8BBE\u7F6E \u2192 \u6269\u5C55 \u2192 PipiUI PDF \u914D\u7F6E AI Studio Access Token\u3002\u6587\u5B57\u578B PDF \u8BF7\u7528 auto/fast \u672C\u5730\u63D0\u53D6\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u3002\u7533\u8BF7\uFF1Ahttps://aistudio.baidu.com/account/accessToken";
export type PdfParseMode = "auto" | "fast" | "ocr";
export type FirecrawlPdfParams = {
    source: string;
    mode?: PdfParseMode;
    maxPages?: number;
    timeout?: number;
};
export declare function readPaddleocrTokenFromConfig(raw: unknown): string | undefined;
/** Legacy fallback: per-project `<agentDir>/paddleocr.json`. Kept until migration is proven. */
export declare function loadPaddleocrToken(agentDir?: string | undefined): Promise<string | undefined>;
/**
 * Token resolution for this extension: the host-injected extension secret env
 * first (post-cutover contract), then the legacy project config file.
 */
export declare function resolvePaddleocrToken(env?: NodeJS.ProcessEnv): Promise<string | undefined>;
export declare function normalizePdfMode(value: unknown): PdfParseMode;
export declare function normalizeTimeoutMs(value: unknown): number;
export declare function normalizeMaxPages(value: unknown): number | undefined | {
    error: string;
};
export declare function isPdfMagic(bytes: Uint8Array): boolean;
export declare function looksLikePdfName(name: string): boolean;
export declare function uploadFilename(path: string): string;
export declare function sanitizePublicError(text: string, secret?: string): string;
export type ResolvedPdfSource = {
    kind: "local";
    path: string;
} | {
    kind: "url";
    url: string;
};
export declare function resolvePdfSource(raw: string): ResolvedPdfSource | {
    error: string;
};
export declare function readLocalPdfBytes(path: string, io?: {
    stat?: typeof stat;
    open?: typeof open;
    maxBytes?: number;
}): Promise<{
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    error: string;
}>;
export declare function downloadPdfBytes(options: {
    url: string;
    timeout: number;
    fetchImpl?: typeof fetch;
    maxBytes?: number;
}): Promise<{
    ok: true;
    bytes: Buffer;
} | {
    ok: false;
    error: string;
}>;
export type PaddleocrVlFn = (filePath: string, token: string) => Promise<{
    ok: true;
    text: string;
} | {
    ok: false;
    error: string;
}>;
type PdfToolResult = {
    content: [{
        type: "text";
        text: string;
    }];
    details: Record<string, never>;
    isError?: boolean;
};
export type InspectPdfFn = (bytes: Uint8Array, options?: {
    maxPages?: number;
}) => Promise<LocalInspectResult>;
export declare function executeFirecrawlPdf(params: FirecrawlPdfParams, deps?: {
    inspect?: InspectPdfFn;
    fetchImpl?: typeof fetch;
    apiKey?: string | null;
    ocrFn?: PaddleocrVlFn;
}): Promise<PdfToolResult>;
export default function (pi: ExtensionAPI): void;
export {};

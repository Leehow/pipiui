import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANYDOC_TOOL_EXTENSIONS,
  MAX_ANYDOC_BYTES,
  anydocExtensionForName,
  convertBytesWithAnydoc,
  looksLikeAnydocName,
  type LocalAnydocResult,
} from "./anydoc-local.ts";

export const FIRECRAWL_ANYDOC_TOOL = "pipiui_firecrawl_anydoc";
export const MAX_ERROR_CHARS = 400;

export type FirecrawlAnydocParams = {
  source: string;
};

function toolResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, ...(isError ? { isError: true } : {}) };
}

export function sanitizePublicError(text: string): string {
  const out = text.replace(/\s+/g, " ").trim();
  if (out.length > MAX_ERROR_CHARS) return `${out.slice(0, MAX_ERROR_CHARS)}…`;
  return out || "解析失败";
}

export type ResolvedAnydocSource =
  | { kind: "local"; path: string }
  | { error: string };

export function resolveAnydocSource(raw: string): ResolvedAnydocSource {
  const source = raw.trim();
  if (!source) return { error: "source 不能为空" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^file:/i.test(source)) {
    return { error: "pipiui_firecrawl_anydoc 只支持本地绝对路径或 file://，不会上传文档" };
  }
  let path = source;
  if (/^file:/i.test(source)) {
    try {
      path = fileURLToPath(source);
    } catch {
      return { error: "file:// 路径无效" };
    }
  }
  if (!isAbsolute(path)) return { error: "本地文档必须是绝对路径" };
  if (path.toLowerCase().endsWith(".pdf")) {
    return { error: "PDF 请用 pipiui_firecrawl_pdf 本地解析（不要用 pipiui_firecrawl_anydoc）" };
  }
  if (!looksLikeAnydocName(path)) {
    return { error: `不支持的文档格式。允许：${ANYDOC_TOOL_EXTENSIONS.join(" ")}` };
  }
  return { kind: "local", path };
}

export async function readLocalAnydocBytes(
  path: string,
  io?: { stat?: typeof stat; open?: typeof open },
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const statFn = io?.stat ?? stat;
  const openFn = io?.open ?? open;
  try {
    const info = await statFn(path);
    if (!info.isFile()) return { ok: false, error: "路径不是普通文档文件" };
    if (info.size > MAX_ANYDOC_BYTES) return { ok: false, error: `本地文档超过 50MB 上限（${info.size} 字节）` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, error: `找不到本地文档：${path}` };
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: "没有权限读取该本地文档" };
    return { ok: false, error: `无法读取本地文档：${error instanceof Error ? error.message : String(error)}` };
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await openFn(path, "r");
    const info = await handle.stat();
    const buffer = Buffer.allocUnsafe(info.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { ok: true, bytes: buffer.subarray(0, bytesRead) };
  } catch (error) {
    return { ok: false, error: `无法读取本地文档：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export type ConvertAnydocFn = (bytes: Uint8Array, options?: { path?: string }) => Promise<LocalAnydocResult>;

export async function executeFirecrawlAnydoc(
  params: FirecrawlAnydocParams,
  deps: { convert?: ConvertAnydocFn } = {},
): Promise<{ content: [{ type: "text"; text: string }]; details: Record<string, never>; isError?: boolean }> {
  const resolved = resolveAnydocSource(String(params.source ?? ""));
  if ("error" in resolved) return toolResult(resolved.error, true);
  const loaded = await readLocalAnydocBytes(resolved.path);
  if (!loaded.ok) return toolResult(loaded.error, true);
  const convert = deps.convert ?? ((bytes, options) => convertBytesWithAnydoc(bytes, options));
  try {
    const result = await convert(loaded.bytes, { path: resolved.path });
    const markdown = result.markdown.trim();
    if (!markdown) return toolResult("本地文档转换没有得到正文。可检查文件是否加密或为空。", true);
    const ext = anydocExtensionForName(resolved.path) ?? "";
    const note = result.format || result.engine ? `\n--- ${ext || result.format || "document"} (${result.engine}) ---` : "";
    return toolResult(`${markdown}${note}`);
  } catch (error) {
    return toolResult(`本地文档提取失败：${sanitizePublicError(error instanceof Error ? error.message : String(error))}`, true);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: FIRECRAWL_ANYDOC_TOOL,
    label: "Firecrawl Anydoc",
    description:
      "Extract Markdown from a local office/OpenDocument/RTF/EPUB/CSV path or file:// URL using local anydoc. " +
      "Never uploads. Do not use read on these binaries. PDFs use pipiui_firecrawl_pdf instead.",
    promptSnippet: "Parse local office/odt/rtf/epub/csv with pipiui_firecrawl_anydoc; never upload",
    promptGuidelines: [
      "Use pipiui_firecrawl_anydoc for Word/Excel/PowerPoint/OpenDocument/RTF/EPUB/CSV content. Do not use read on those binaries.",
      "Only local absolute paths or file:// URLs. Never upload documents.",
      "PDFs use pipiui_firecrawl_pdf, not this tool.",
    ],
    parameters: Type.Object(
      {
        source: Type.String({ description: "Absolute local path or file:// URL" }),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params) {
      return executeFirecrawlAnydoc(params as FirecrawlAnydocParams);
    },
  });
}

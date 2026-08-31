/**
 * Session-scoped open-document registry for the model.
 * Panel open/preview only registers metadata; contents are read on demand.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const LIST_OPEN_DOCUMENTS_TOOL = "list_open_documents";

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
    ...(isError ? { isError: true } : {}),
  };
}

export async function listOpenDocumentsFromBridge(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; documents: unknown[] } | { ok: false; error: string }> {
  const port = env.PIPIUI_BRIDGE_PORT?.trim();
  const capability = env.PIPIUI_SESSION_CAPABILITY?.trim();
  if (!port || !capability) {
    return { ok: false, error: "open-documents host bridge unavailable" };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: capability,
        action: "documents_list",
        event: {},
      }),
    });
    const payload = await response.json() as {
      ok?: boolean;
      result?: { documents?: unknown[] };
      error?: string;
    };
    if (response.status === 403 || !payload?.ok) {
      return {
        ok: false,
        error: typeof payload?.error === "string" ? payload.error : "unauthorized or unavailable documents list",
      };
    }
    const documents = Array.isArray(payload.result?.documents) ? payload.result.documents : [];
    return { ok: true, documents };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: LIST_OPEN_DOCUMENTS_TOOL,
    label: "List Open Documents",
    description:
      "List documents currently opened in this chat session's document panel. Returns name, kind, size, and path only — never file contents. " +
      "Call this first only when the user refers to an already opened document (for example 分析一下这个文档的数据). " +
      "Then read text/markdown with read, Office/CSV with pipiui_firecrawl_anydoc, and PDF with pipiui_firecrawl_pdf. " +
      "Do not call for unrelated requests. Opening, previewing, or dropping a file on the panel does not attach it to the prompt.",
    promptSnippet: "List this session's opened document panel files (metadata only); then read on demand",
    promptGuidelines: [
      "Only call list_open_documents when the user refers to a document already open in the panel.",
      "The result is metadata only. Do not assume the document is attached to the prompt.",
      "After listing, read text with read, Office with pipiui_firecrawl_anydoc, PDF with pipiui_firecrawl_pdf.",
      "Do not call this tool for unrelated requests such as fixing a bug.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const listed = await listOpenDocumentsFromBridge();
      if (!listed.ok) return toolResult(listed, true);
      return toolResult(listed);
    },
  });
}

import type { ToolResultEventResult } from "@earendil-works/pi-coding-agent";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewriteStructuredResult(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value)) return { value, changed: false };

  let changed = false;
  const rewritten = { ...value };
  if (rewritten.target === "memory") {
    rewritten.target = "project";
    changed = true;
  }
  if (typeof rewritten.error === "string" && rewritten.error.includes("consolidate 'memory'")) {
    rewritten.error = rewritten.error.replaceAll("consolidate 'memory'", "consolidate 'project'");
    changed = true;
  }
  return changed ? { value: rewritten, changed: true } : { value, changed: false };
}

function rewriteSerializedResult(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value) || value.type !== "text" || typeof value.text !== "string") {
    return { value, changed: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.text);
  } catch {
    return { value, changed: false };
  }
  const rewritten = rewriteStructuredResult(parsed);
  return rewritten.changed
    ? { value: { ...value, text: JSON.stringify(rewritten.value) }, changed: true }
    : { value, changed: false };
}

/**
 * Restores Hermes' public project target after its project store has internally
 * routed the operation through the memory target. The original tool input is
 * authoritative; global memory results and ordinary text are left untouched.
 */
export function rewriteHermesProjectMemoryToolResult(event: {
  toolName?: unknown;
  input?: unknown;
  content?: unknown;
  details?: unknown;
}): ToolResultEventResult | undefined {
  if (typeof event.toolName !== "string" || !event.toolName.startsWith("memory_")) return undefined;
  if (!isRecord(event.input) || event.input.target !== "project") return undefined;

  const details = rewriteStructuredResult(event.details);
  let contentChanged = false;
  const content = Array.isArray(event.content)
    ? event.content.map((item) => {
      const rewritten = rewriteSerializedResult(item);
      contentChanged ||= rewritten.changed;
      return rewritten.value;
    })
    : event.content;

  if (!details.changed && !contentChanged) return undefined;
  return {
    ...(details.changed ? { details: details.value } : {}),
    ...(contentChanged ? { content: content as ToolResultEventResult["content"] } : {}),
  };
}

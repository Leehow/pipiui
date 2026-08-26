import { createHash } from "node:crypto";
import { HEADROOM_POLICY_VERSION, type Candidate, type HeadroomConfig, type PreparedEntry } from "./types.js";

const CCR_MARKERS = [
  "Retrieve more: hash=",
  "Retrieve original: hash=",
  "<<ccr:",
  "<headroom:",
  "Call headroom_retrieve with no arguments",
] as const;
const identityCache = new WeakMap<object, Candidate>();

type ContextMessage = { role: string };
export interface ToolResultMessageLike extends ContextMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
  timestamp: number;
}

function hasTruncatedFlag(value: unknown): boolean {
  return typeof value === "object" && value !== null && "truncated" in value && value.truncated === true;
}

function hasPruningMetadata(details: unknown): boolean {
  if (typeof details !== "object" || details === null) return false;
  if ("prunedAt" in details || ("pruned" in details && details.pruned === true)) return true;
  const metadata = "metadata" in details && typeof details.metadata === "object" && details.metadata !== null
    ? details.metadata as Record<string, unknown>
    : undefined;
  return hasTruncatedFlag("truncation" in details ? details.truncation : undefined) ||
    hasTruncatedFlag("rtkCompaction" in details ? details.rtkCompaction : undefined) ||
    hasTruncatedFlag(metadata?.rtkCompaction);
}

function isToolResultMessage(message: ContextMessage): message is ToolResultMessageLike {
  return message.role === "toolResult" &&
    "toolCallId" in message && typeof message.toolCallId === "string" &&
    "toolName" in message && typeof message.toolName === "string" &&
    "content" in message && Array.isArray(message.content) &&
    "isError" in message && typeof message.isError === "boolean";
}

export function candidateFromToolResult(
  message: ToolResultMessageLike,
  config: Readonly<HeadroomConfig>,
): Candidate | undefined {
  const toolName = message.toolName.trim().toLowerCase();
  if (message.isError || config.protectedTools.includes(toolName)) return undefined;
  if (message.content.length !== 1 || message.content[0]?.type !== "text" || typeof message.content[0].text !== "string") return undefined;
  const originalText = message.content[0].text;
  if (originalText.length < config.minResultChars || hasPruningMetadata(message.details)) return undefined;
  if (CCR_MARKERS.some(marker => originalText.includes(marker))) return undefined;

  const cached = identityCache.get(message as object);
  if (cached && cached.toolCallId === message.toolCallId && cached.toolName === toolName && cached.originalText === originalText) {
    return cached;
  }
  const key = createHash("sha256")
    .update(HEADROOM_POLICY_VERSION).update("\0")
    .update(toolName).update("\0")
    .update(originalText)
    .digest("hex");
  const candidate = { key, toolCallId: message.toolCallId, toolName, originalText };
  identityCache.set(message as object, candidate);
  return candidate;
}

export function protectedToolResultIndexes(messages: readonly ContextMessage[], count: number): Set<number> {
  const indexes = new Set<number>();
  if (count <= 0) return indexes;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "toolResult") continue;
    indexes.add(index);
    if (indexes.size >= count) break;
  }
  return indexes;
}

export function transformContext<TMessage extends ContextMessage>(
  messages: readonly TMessage[],
  config: Readonly<HeadroomConfig>,
  lookup: (key: string) => PreparedEntry | undefined,
  enqueue: (candidate: Candidate) => void,
  onSubstitution?: (entry: PreparedEntry) => void,
  canSubstitute: (candidate: Candidate, entry: PreparedEntry) => boolean = () => true,
): TMessage[] | undefined {
  const protectedIndexes = protectedToolResultIndexes(messages, config.protectRecentToolResults);
  let transformed: TMessage[] | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || !isToolResultMessage(message) || protectedIndexes.has(index)) continue;
    const toolMessage = message as unknown as ToolResultMessageLike;
    const candidate = candidateFromToolResult(toolMessage, config);
    if (!candidate) continue;
    const prepared = lookup(candidate.key);
    if (!prepared) {
      enqueue(candidate);
      continue;
    }
    if (prepared.originalText !== candidate.originalText) continue;
    if (!canSubstitute(candidate, prepared)) continue;
    transformed ??= [...messages];
    transformed[index] = {
      ...toolMessage,
      content: [{ ...toolMessage.content[0], text: prepared.compressedText }],
    } as unknown as TMessage;
    onSubstitution?.(prepared);
  }
  return transformed;
}

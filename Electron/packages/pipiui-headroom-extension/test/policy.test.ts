import { describe, expect, it, vi } from "vitest";
import { candidateFromToolResult, transformContext, type ToolResultMessageLike } from "../agent/policy.js";
import { DEFAULT_CONFIG } from "../agent/config.js";
import type { HeadroomConfig, PreparedEntry } from "../agent/types.js";

const config: HeadroomConfig = { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools], minResultChars: 20 };
const result = (id: string, toolName: string, text: string): ToolResultMessageLike => ({
  role: "toolResult", toolCallId: id, toolName, content: [{ type: "text", text }], isError: false, timestamp: 1,
});

function prepared(message: ToolResultMessageLike, compressedText: string): PreparedEntry {
  const candidate = candidateFromToolResult(message, config)!;
  return {
    ...candidate,
    compressedText,
    ccrHashes: [],
    retrievals: new Map(),
    tokensBefore: 1_000,
    tokensAfter: 300,
    tokensSaved: 700,
    originalBytes: candidate.originalText.length,
    compressedBytes: compressedText.length,
    sizeBytes: candidate.originalText.length + compressedText.length,
    originalSha256: "sha",
    policyVersion: "pipiui-v1",
    createdAt: 1,
    lastAccessedAt: 1,
  };
}

describe("Headroom candidate and cache-only context policy", () => {
  it("protects errors, file reads, non-text results and already-compressed markers", () => {
    expect(candidateFromToolResult(result("a", "read", "x".repeat(100)), config)).toBeUndefined();
    expect(candidateFromToolResult({ ...result("b", "exec", "x".repeat(100)), isError: true }, config)).toBeUndefined();
    expect(candidateFromToolResult({ ...result("c", "exec", "x".repeat(100)), content: [{ type: "image" }] }, config)).toBeUndefined();
    expect(candidateFromToolResult(result("d", "exec", `Retrieve original: hash=abcdef123456 ${"x".repeat(100)}`), config)).toBeUndefined();
    expect(candidateFromToolResult(result("e", "exec", `Call headroom_retrieve with no arguments ${"x".repeat(100)}`), config)).toBeUndefined();
  });

  it("substitutes only prepared stale results, protects the newest two, and leaves input untouched", () => {
    const old = result("old", "exec", "old-output ".repeat(80));
    const recent1 = result("recent-1", "exec", "recent-one ".repeat(80));
    const recent2 = result("recent-2", "exec", "recent-two ".repeat(80));
    const messages = [{ role: "user", content: "go" }, old, recent1, recent2];
    const entry = prepared(old, "compressed-old");
    const enqueue = vi.fn();
    const transformed = transformContext(messages, config, key => key === entry.key ? entry : undefined, enqueue);
    expect(transformed).toBeDefined();
    expect((transformed?.[1] as ToolResultMessageLike).content[0].text).toBe("compressed-old");
    expect((transformed?.[2] as ToolResultMessageLike).content[0].text).toContain("recent-one");
    expect((transformed?.[3] as ToolResultMessageLike).content[0].text).toContain("recent-two");
    expect(old.content[0].text).toContain("old-output");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues cache misses but returns no replacement from the context hot path", () => {
    const old = result("old", "exec", "large-output ".repeat(80));
    const messages = [old, { role: "user", content: "later" }];
    const enqueue = vi.fn();
    expect(transformContext(messages, { ...config, protectRecentToolResults: 0 }, () => undefined, enqueue)).toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

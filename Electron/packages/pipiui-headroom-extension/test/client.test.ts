import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildCompressPayload,
  HEADROOM_EXACT_RETRIEVAL_NOTICE,
  HeadroomClient,
  validateCompression,
} from "../agent/client.js";
import type { Candidate } from "../agent/types.js";

const candidate: Candidate = {
  key: "1234567890abcdef".repeat(4),
  toolCallId: "tool-1",
  toolName: "exec",
  originalText: `ORIGINAL-SENTINEL\n${"raw line\n".repeat(2_000)}`,
};

function response(content = "summary\nRetrieve original: hash=abcdef123456") {
  const callId = `call_${candidate.key.slice(0, 12)}`;
  return {
    messages: [
      { role: "assistant", tool_calls: [{ id: callId, type: "function", function: { name: "exec", arguments: "{}" } }] },
      { role: "tool", tool_call_id: callId, content },
    ],
    tokens_before: 4_000,
    tokens_after: 900,
    tokens_saved: 3_100,
    compression_ratio: 0.225,
    ccr_hashes: ["abcdef123456"],
  };
}

describe("Headroom HTTP and validation boundary", () => {
  it("builds a provider-independent synthetic tool-result request", () => {
    expect(buildCompressPayload(candidate, "openai/gpt-5")).toMatchObject({
      model: "openai/gpt-5",
      messages: [{ role: "assistant" }, { role: "tool", content: candidate.originalText }],
      config: { compress_user_messages: false, mode: "ccr" },
    });
  });

  it("accepts only shorter, worthwhile output whose CCR resolves inside the exact source", async () => {
    const outcome = await validateCompression(candidate, response(), async hash => hash === "abcdef123456" ? "ORIGINAL-SENTINEL" : undefined);
    expect("status" in outcome).toBe(false);
    if (!("status" in outcome)) {
      expect(outcome.tokensSaved).toBe(3_100);
      expect(outcome.retrievals.get("abcdef123456")).toBe("ORIGINAL-SENTINEL");
      expect(outcome.ccrHashes).toEqual(["abcdef123456"]);
      expect(outcome.compressedText).toContain(HEADROOM_EXACT_RETRIEVAL_NOTICE);
      expect(outcome.compressedText).not.toContain("abcdef123456");
      expect(outcome.compressedText).not.toContain("hash=");
    }
    expect(await validateCompression(candidate, response(), async () => "NOT-IN-SOURCE")).toEqual({ status: "rejected", reason: "retrieval_mismatch" });
    expect(await validateCompression(candidate, { nope: true }, async () => undefined)).toEqual({ status: "rejected", reason: "invalid_response" });
  });

  it("always gives an accepted substitution a no-argument byte-exact whole-result retrieval path", async () => {
    const withoutUpstreamCcr = { ...response("short summary"), ccr_hashes: [] };
    const outcome = await validateCompression(candidate, withoutUpstreamCcr, async () => undefined);
    expect("status" in outcome).toBe(false);
    if ("status" in outcome) return;

    expect(outcome.ccrHashes).toEqual([]);
    expect(outcome.retrievals.size).toBe(0);
    expect(createHash("sha256").update(outcome.originalText).digest("hex")).toBe(outcome.originalSha256);
    expect(outcome.compressedText).toBe(`short summary\n${HEADROOM_EXACT_RETRIEVAL_NOTICE}`);
  });

  it("accepts upstream nested CCR only when every intermediate layer resolves into the source", async () => {
    const outerHash = "abcdef123456";
    const sourceHash = "fedcba654321";
    const nestedResponse = {
      ...response(`summary\nRetrieve more: hash=${outerHash}`),
      ccr_hashes: [outerHash, sourceHash],
    };
    nestedResponse.messages[1] = {
      ...nestedResponse.messages[1],
      content: `summary\nRetrieve more: hash=${outerHash}\nRetrieve more: hash=${sourceHash}`,
    };
    const nested = new Map([
      [outerHash, `intermediate summary\nRetrieve more: hash=${sourceHash}`],
      [sourceHash, "ORIGINAL-SENTINEL"],
    ]);
    const outcome = await validateCompression(candidate, nestedResponse, async hash => nested.get(hash));
    expect("status" in outcome).toBe(false);
    if (!("status" in outcome)) {
      expect(outcome.compressedText).not.toContain(outerHash);
      expect(outcome.compressedText).not.toContain(sourceHash);
      expect(outcome.compressedText).not.toContain("hash=");
    }

    nested.set(sourceHash, "NOT-IN-SOURCE");
    expect(await validateCompression(candidate, nestedResponse, async hash => nested.get(hash)))
      .toEqual({ status: "rejected", reason: "retrieval_mismatch" });
  });

  it("uses only readyz, v1/compress and v1/retrieve with bounded HTTP calls", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/readyz")) return { ok: true, status: 200, json: async () => ({}) } as Response;
      if (url.endsWith("/v1/compress")) return { ok: true, status: 200, json: async () => response() } as Response;
      return { ok: true, status: 200, json: async () => ({ hash: "abcdef123456", original_content: "ORIGINAL-SENTINEL" }) } as Response;
    });
    const client = new HeadroomClient({ baseUrl: "http://127.0.0.1:8787", healthTimeoutMs: 100, requestTimeoutMs: 100, fetchImpl: fetchImpl as typeof fetch });
    expect(await client.health()).toBe(true);
    await client.compress(candidate, "model");
    expect(await client.retrieve("abcdef123456")).toBe("ORIGINAL-SENTINEL");
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      "http://127.0.0.1:8787/readyz",
      "http://127.0.0.1:8787/v1/compress",
      "http://127.0.0.1:8787/v1/retrieve",
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]?.redirect).toBe("error");
  });
});

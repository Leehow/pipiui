import { describe, expect, it, vi } from "vitest";
import { PreparedCache } from "../agent/cache.js";
import type { Candidate } from "../agent/types.js";
import { CompressionWorker, type WorkerClient } from "../agent/worker.js";

const candidate: Candidate = {
  key: "1234567890abcdef".repeat(4),
  toolCallId: "tool-1",
  toolName: "exec",
  originalText: "source\n".repeat(2_000),
};

function response(tokensSaved: number, target: Candidate = candidate): unknown {
  const callId = `call_${target.key.slice(0, 12)}`;
  return {
    messages: [
      { role: "assistant", tool_calls: [{ id: callId, type: "function", function: { name: target.toolName, arguments: "{}" } }] },
      { role: "tool", tool_call_id: callId, content: "short summary" },
    ],
    tokens_before: 4_000,
    tokens_after: 4_000 - tokensSaved,
    tokens_saved: tokensSaved,
    compression_ratio: (4_000 - tokensSaved) / 4_000,
    ccr_hashes: [],
  };
}

function client(compressed: unknown): WorkerClient {
  return {
    health: vi.fn(async () => true),
    compress: vi.fn(async () => compressed),
    retrieve: vi.fn(async () => undefined),
  };
}

describe("Headroom compression worker fallback boundary", () => {
  it("can probe a managed service that is still warming without latching a fault", async () => {
    const onFault = vi.fn();
    const unavailable: WorkerClient = {
      health: vi.fn(async () => false),
      compress: vi.fn(async () => { throw new Error("unused"); }),
      retrieve: vi.fn(async () => undefined),
    };
    const worker = new CompressionWorker({ client: unavailable, cache: new PreparedCache(1_000_000), onFault });

    expect(await worker.checkHealth({ faultOnFailure: false })).toBe(false);
    expect(worker.stats()).toMatchObject({ state: "warming", lastError: "health check failed" });
    expect(onFault).not.toHaveBeenCalled();
    worker.stop();
  });

  it("skips a valid but low-value result without taking Headroom offline", async () => {
    const onFault = vi.fn();
    const worker = new CompressionWorker({ client: client(response(100)), cache: new PreparedCache(1_000_000), onFault });
    expect(await worker.checkHealth()).toBe(true);
    expect(worker.enqueue(candidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(worker.stats().rejected).toBe(1));

    expect(worker.stats().state).toBe("online");
    expect(worker.stats().lastError).toBeUndefined();
    expect(onFault).not.toHaveBeenCalled();
    worker.stop();
  });

  it("takes Headroom offline when the response contract is invalid", async () => {
    const onFault = vi.fn();
    const worker = new CompressionWorker({ client: client({ invalid: true }), cache: new PreparedCache(1_000_000), onFault });
    expect(await worker.checkHealth()).toBe(true);
    expect(worker.enqueue(candidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(worker.stats().state).toBe("offline"));

    expect(worker.stats().lastError).toBe("compression rejected: invalid_response");
    expect(onFault).toHaveBeenCalledWith("compression rejected: invalid_response");
  });

  it("rejects a candidate-specific retrieval mismatch without disabling Headroom", async () => {
    const onFault = vi.fn();
    const mismatch = {
      ...response(3_100),
      messages: [
        response(3_100).messages[0],
        {
          role: "tool",
          tool_call_id: `call_${candidate.key.slice(0, 12)}`,
          content: "summary\nRetrieve original: hash=abcdef123456",
        },
      ],
      ccr_hashes: ["abcdef123456"],
    };
    const mismatchClient: WorkerClient = {
      health: vi.fn(async () => true),
      compress: vi.fn(async () => mismatch),
      retrieve: vi.fn(async () => "NOT-IN-SOURCE"),
    };
    const worker = new CompressionWorker({ client: mismatchClient, cache: new PreparedCache(1_000_000), onFault });
    expect(await worker.checkHealth()).toBe(true);
    expect(worker.enqueue(candidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(worker.stats().rejected).toBe(1));

    expect(worker.stats().state).toBe("online");
    expect(worker.stats().lastError).toBeUndefined();
    expect(onFault).not.toHaveBeenCalled();
    worker.stop();
  });

  it("keeps Headroom online after a candidate request fails while health remains good", async () => {
    const onFault = vi.fn();
    const nextCandidate: Candidate = { ...candidate, key: "abcdef1234567890".repeat(4), toolCallId: "tool-2" };
    const transientClient: WorkerClient = {
      health: vi.fn(async () => true),
      compress: vi.fn()
        .mockRejectedValueOnce(new Error("candidate timeout"))
        .mockResolvedValueOnce(response(3_500, nextCandidate)),
      retrieve: vi.fn(async () => undefined),
    };
    const worker = new CompressionWorker({ client: transientClient, cache: new PreparedCache(1_000_000), onFault });
    expect(await worker.checkHealth()).toBe(true);
    expect(worker.enqueue(candidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(transientClient.health).toHaveBeenCalledTimes(2));

    expect(worker.stats()).toMatchObject({ state: "online", rejected: 1, lastError: "compression request failed" });
    expect(onFault).not.toHaveBeenCalled();

    expect(worker.enqueue(nextCandidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(worker.stats().accepted).toBe(1));
    expect(worker.stats().state).toBe("online");
    expect(worker.stats().lastError).toBeUndefined();
    expect(onFault).not.toHaveBeenCalled();
    worker.stop();
  });

  it("activates fallback when a request failure is followed by a failed health probe", async () => {
    const onFault = vi.fn();
    const unavailable: WorkerClient = {
      health: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      compress: vi.fn(async () => { throw new Error("service unavailable"); }),
      retrieve: vi.fn(async () => undefined),
    };
    const worker = new CompressionWorker({ client: unavailable, cache: new PreparedCache(1_000_000), onFault });
    expect(await worker.checkHealth()).toBe(true);
    expect(worker.enqueue(candidate, "test/model")).toBe(true);
    await vi.waitFor(() => expect(worker.stats().state).toBe("offline"));

    expect(worker.stats().lastError).toBe("compression request failed");
    expect(onFault).toHaveBeenCalledWith("compression request failed");
  });
});

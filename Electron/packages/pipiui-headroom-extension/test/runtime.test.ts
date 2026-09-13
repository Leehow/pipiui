import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../agent/config.js";
import {
  CONTEXT_OPTIMIZER_STATE_KEY,
} from "../agent/coordinator.js";
import {
  armContextRewrite,
  beginContextRewriteTurn,
  configureContextRewriteGate,
  finishContextRewriteTurn,
} from "../../../resources/runtime/pi-ext/packages/context-fold/src/adapters/pi/optimizer-coordinator.js";
import { HeadroomRuntime } from "../agent/runtime.js";
import { HEADROOM_EXACT_RETRIEVAL_NOTICE } from "../agent/client.js";
import type { WorkerClient } from "../agent/worker.js";

const globals = globalThis as Record<string | symbol, unknown>;
afterEach(() => { delete globals[CONTEXT_OPTIMIZER_STATE_KEY]; });

function ctx() {
  const statuses: Record<string, string | undefined> = {};
  return {
    statuses,
    value: {
      model: { provider: "openai", id: "gpt-5", contextWindow: 200_000 },
      sessionManager: { getSessionId: () => "session-1" },
      ui: { setStatus: (key: string, text: string | undefined) => { statuses[key] = text; } },
    } as any,
  };
}

function client(healthy = true): WorkerClient {
  return {
    health: vi.fn(async () => healthy),
    compress: vi.fn(async () => { throw new Error("unused"); }),
    retrieve: vi.fn(async () => undefined),
  };
}

describe("Headroom primary lease and sticky fallback", () => {
  it("claims primary only after a successful health check", async () => {
    const h = ctx();
    const runtime = new HeadroomRuntime({ config: { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools] }, client: client(true) });
    expect(await runtime.start(h.value)).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ enabled: true, ownsPrimary: true });
    expect(runtime.snapshot().fallbackReason).toBeUndefined();
    expect(h.statuses["pipiui-headroom"]).toMatch(/primary/);
    runtime.stop();
  });

  it("latches context-fold when health is unavailable and does not auto-failback", async () => {
    const h = ctx();
    const runtime = new HeadroomRuntime({ config: { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools] }, client: client(false) });
    expect(await runtime.start(h.value)).toBe(false);
    expect(runtime.snapshot()).toMatchObject({ enabled: false, ownsPrimary: false, fallbackReason: "health check failed" });
    expect(await runtime.setEnabled(true)).toBe(false);
    expect(h.statuses["pipiui-headroom"]).toMatch(/fallback/);
  });

  it("keeps context-fold active while the managed engine installs, then claims primary", async () => {
    const h = ctx();
    let reads = 0;
    const runtime = new HeadroomRuntime({
      config: {
        ...DEFAULT_CONFIG,
        managed: true,
        managedStatePath: "/tmp/project/.pi/agent/headroom/service.json",
        managedStartupTimeoutMs: 1_000,
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
      },
      client: client(true),
      managedPollIntervalMs: 1,
      managedStateReader: async () => {
        reads += 1;
        return reads < 2
          ? { state: "installing", baseUrl: DEFAULT_CONFIG.baseUrl, engineVersion: "0.37.0" }
          : { state: "ready", baseUrl: DEFAULT_CONFIG.baseUrl, engineVersion: "0.37.0" };
      },
    });

    expect(await runtime.start(h.value)).toBe(false);
    expect(runtime.snapshot()).toMatchObject({ enabled: true, ownsPrimary: false });
    await vi.waitFor(() => expect(runtime.snapshot().ownsPrimary).toBe(true));
    expect(runtime.snapshot().fallbackReason).toBeUndefined();
    runtime.stop();
  });

  it("claims an already-ready managed service before session_start returns", async () => {
    const h = ctx();
    const runtime = new HeadroomRuntime({
      config: {
        ...DEFAULT_CONFIG,
        managed: true,
        managedStatePath: "/tmp/project/.pi/agent/headroom/service.json",
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
      },
      client: client(true),
      managedStateReader: async () => ({
        state: "ready",
        baseUrl: DEFAULT_CONFIG.baseUrl,
        engineVersion: DEFAULT_CONFIG.managedEngineVersion,
      }),
    });

    expect(await runtime.start(h.value)).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ enabled: true, ownsPrimary: true });
    runtime.stop();
  });

  it("hands an unexpected managed service exit back to context-fold", async () => {
    const h = ctx();
    let state: "ready" | "failed" = "ready";
    const runtime = new HeadroomRuntime({
      config: {
        ...DEFAULT_CONFIG,
        managed: true,
        managedStatePath: "/tmp/project/.pi/agent/headroom/service.json",
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
      },
      client: client(true),
      managedPollIntervalMs: 1,
      managedStateReader: async () => ({
        state,
        baseUrl: DEFAULT_CONFIG.baseUrl,
        engineVersion: DEFAULT_CONFIG.managedEngineVersion,
        ...(state === "failed" ? { error: "proxy exited" } : {}),
      }),
    });

    expect(await runtime.start(h.value)).toBe(true);
    state = "failed";
    await vi.waitFor(() => expect(runtime.snapshot()).toMatchObject({
      enabled: false,
      ownsPrimary: false,
      fallbackReason: "managed service failed: proxy exited",
    }));
  });

  it("immediately hands managed startup failures to context-fold", async () => {
    const h = ctx();
    const runtime = new HeadroomRuntime({
      config: {
        ...DEFAULT_CONFIG,
        managed: true,
        managedStatePath: "/tmp/project/.pi/agent/headroom/service.json",
        managedStartupTimeoutMs: 1_000,
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
      },
      client: client(true),
      managedPollIntervalMs: 1,
      managedStateReader: async () => ({
        state: "failed",
        baseUrl: DEFAULT_CONFIG.baseUrl,
        engineVersion: "0.37.0",
        error: "install failed",
      }),
    });

    expect(await runtime.start(h.value)).toBe(false);
    await vi.waitFor(() => expect(runtime.snapshot().fallbackReason).toMatch(/install failed/));
    expect(runtime.snapshot()).toMatchObject({ enabled: false, ownsPrimary: false });
  });

  it("explicit off releases primary so context-fold can run on the next turn", async () => {
    const h = ctx();
    const runtime = new HeadroomRuntime({ config: { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools] }, client: client(true) });
    await runtime.start(h.value);
    expect(await runtime.setEnabled(false)).toBe(true);
    expect(runtime.snapshot()).toMatchObject({ enabled: false, ownsPrimary: false });
  });

  it("never retrieves unvalidated content from the upstream shared store", async () => {
    const remoteRetrieve = vi.fn(async () => "unvalidated-remote-content");
    const runtime = new HeadroomRuntime({
      config: { ...DEFAULT_CONFIG, protectedTools: [...DEFAULT_CONFIG.protectedTools] },
      client: {
        health: vi.fn(async () => true),
        compress: vi.fn(async () => { throw new Error("unused"); }),
        retrieve: remoteRetrieve,
      },
    });

    expect(await runtime.retrieve()).toMatch(/No pending compressed Headroom result/);
    expect(remoteRetrieve).not.toHaveBeenCalled();
  });

  it("retrieves substituted source byte-for-byte without exposing or accepting a hash", async () => {
    const h = ctx();
    const original = `ORIGINAL-SENTINEL\n${"exact source line\n".repeat(500)}`;
    const runtime = new HeadroomRuntime({
      config: {
        ...DEFAULT_CONFIG,
        minResultChars: 20,
        protectRecentToolResults: 0,
        protectedTools: [...DEFAULT_CONFIG.protectedTools],
      },
      client: {
        health: vi.fn(async () => true),
        compress: vi.fn(async candidate => {
          const callId = `call_${candidate.key.slice(0, 12)}`;
          return {
            messages: [
              { role: "assistant", tool_calls: [{ id: callId, type: "function", function: { name: candidate.toolName, arguments: "{}" } }] },
              { role: "tool", tool_call_id: callId, content: "short verified summary" },
            ],
            tokens_before: 2_000,
            tokens_after: 200,
            tokens_saved: 1_800,
            compression_ratio: 0.1,
            ccr_hashes: [],
          };
        }),
        retrieve: vi.fn(async () => undefined),
      },
    });
    await runtime.start(h.value);
    const toolResult = {
      role: "toolResult" as const,
      toolCallId: "tool-1",
      toolName: "session_search",
      content: [{ type: "text", text: original }],
      details: {},
      isError: false,
      timestamp: Date.now(),
    };
    runtime.observeToolResult(toolResult as any, h.value);
    await vi.waitFor(() => expect(runtime.snapshot().worker.accepted).toBe(1));

    // Preparation is deliberately eager, but nothing model-visible changes before 45% + 4m arms.
    expect(runtime.transform([toolResult] as any, h.value)).toBeUndefined();
    expect(runtime.snapshot()).toMatchObject({ substitutions: 0, uniqueSubstitutions: 0, tokensSaved: 0 });

    configureContextRewriteGate("session-1", 0.45, 240_000);
    armContextRewrite("session-1", 1_000);
    beginContextRewriteTurn("session-1");
    const transformed = runtime.transform([toolResult] as any, h.value) as any[];
    expect(transformed[0].content[0].text).toContain(HEADROOM_EXACT_RETRIEVAL_NOTICE);
    expect(transformed[0].content[0].text).not.toContain("hash=");
    // Rebuilding context reuses the same committed substitution but must not multiply unique savings.
    runtime.transform([toolResult] as any, h.value);
    finishContextRewriteTurn("session-1");
    expect((runtime.transform([toolResult] as any, h.value) as any[])[0].content[0].text).toContain(
      HEADROOM_EXACT_RETRIEVAL_NOTICE,
    );
    expect(runtime.snapshot()).toMatchObject({
      substitutions: 3,
      uniqueSubstitutions: 1,
      tokensSaved: 1_800,
    });
    // A later provider projection can omit the source result entirely. The
    // exact original must remain queued because the model may retrieve it in a
    // later turn instead of immediately after seeing the marker.
    runtime.transform([] as any, h.value);
    expect(await runtime.retrieve()).toBe(original);
    expect(await runtime.retrieve()).toMatch(/No pending compressed Headroom result/);
    runtime.stop();
  });
});

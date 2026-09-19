import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

describe("model catalog load reuse", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("shares one expensive catalog load across concurrent and adjacent reads, then reloads on refresh", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-catalog-load-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    let getAvailableCalls = 0;
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    const firstCatalog = [{
      provider: "openai-codex",
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      reasoning: true,
      thinkingLevelMap: { minimal: "low", max: "max" },
    }];
    const refreshedCatalog = [{
      ...firstCatalog[0],
      name: "GPT-5.6 Sol refreshed",
      thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
    }];
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => {
          const call = ++getAvailableCalls;
          // Constructor provider prefetch is separate from the catalog load.
          if (call === 1) return firstCatalog;
          await catalogGate;
          return call === 2 ? firstCatalog : refreshedCatalog;
        },
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    // Construction starts provider prefetch and a gated catalog preload.
    // Concurrent reads must join that preload rather than start another load.
    await vi.waitFor(() => expect(getAvailableCalls).toBe(2));
    const pending = [
      backend.handle("listModels", []),
      backend.handle("listModels", []),
      backend.handle("getSubagentModels", []),
    ];
    await vi.waitFor(() => expect(getAvailableCalls).toBe(2));
    releaseCatalog();
    const [first, second] = await Promise.all(pending) as [any[], any[], unknown];
    expect(first).toEqual(second);
    expect(first.find(model => model.id === "gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol",
      thinkingLevelMap: { minimal: "low", max: "max" },
    });
    expect(getAvailableCalls).toBe(2);

    await backend.handle("listModels", []);
    await backend.handle("getSubagentModels", []);
    expect(getAvailableCalls).toBe(2);

    const refreshed = await backend.refreshModelCatalog();
    expect(getAvailableCalls).toBe(3);
    expect(refreshed.find(model => model.id === "gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol refreshed",
      thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
    });
    expect(await backend.handle("listModels", [])).toEqual(refreshed);
    expect(getAvailableCalls).toBe(3);
    await backend.close();
  });
});

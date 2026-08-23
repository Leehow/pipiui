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
          getAvailableCalls += 1;
          await catalogGate;
          return getAvailableCalls === 1 ? firstCatalog : refreshedCatalog;
        },
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    const pending = [
      backend.handle("listModels", []),
      backend.handle("listModels", []),
      backend.handle("getSubagentModels", []),
    ];
    await vi.waitFor(() => expect(getAvailableCalls).toBe(1));
    releaseCatalog();
    const [first, second] = await Promise.all(pending) as [any[], any[], unknown];
    expect(first).toEqual(second);
    expect(first.find(model => model.id === "gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol",
      thinkingLevelMap: { minimal: "low", max: "max" },
    });
    expect(getAvailableCalls).toBe(1);

    await backend.handle("listModels", []);
    await backend.handle("getSubagentModels", []);
    expect(getAvailableCalls).toBe(1);

    const refreshed = await backend.refreshModelCatalog();
    expect(getAvailableCalls).toBe(2);
    expect(refreshed.find(model => model.id === "gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol refreshed",
      thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
    });
    expect(await backend.handle("listModels", [])).toEqual(refreshed);
    expect(getAvailableCalls).toBe(2);
    await backend.close();
  });
});

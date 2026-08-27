import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rmdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSubagentModelCatalogSnapshot,
  createPiHostBackend,
  SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION,
} from "../src/index.js";

// ─── Cross-process fail-closed protocol fixture support ─────────────────

// Inertness guards so importing the FULL pi-ext extension module inside this node process is
// side-effect-free (same trick as its own dispatch-model.test.ts).
process.env.PIPIUI_AGENT_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;
delete process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE;


describe("subagent dispatch model catalog snapshot", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("keeps exact provider/id identity, drops user-hidden and duplicate refs, and carries metadata only", () => {
    const models = [
      { provider: "openai", id: "gpt-5", name: "GPT-5" },
      { provider: "xai", id: "grok-4.5", name: "Grok 4.5" },
      // A hidden model the user unchecked in 模型管理 — Boss must never see it.
      { provider: "anthropic", id: "claude-haiku", name: "Haiku" },
      // Same ref twice (configured + runtime merge shadow) — first wins, no duplicate.
      { provider: "openai", id: "gpt-5", name: "GPT-5 runtime copy" },
      // Degenerate entries are skipped rather than emitted as bare ids.
      { provider: "", id: "no-provider" },
      { provider: "weird", id: "", name: "no id" },
    ];
    const snapshot = buildSubagentModelCatalogSnapshot(models, ["anthropic/claude-haiku"]);
    expect(snapshot.version).toBe(SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION);
    expect(snapshot.models.map(m => m.id)).toEqual(["openai/gpt-5", "xai/grok-4.5"]);
    expect(snapshot.models[0]).toMatchObject({ id: "openai/gpt-5", name: "GPT-5" });
  });

  it("materializes a metadata-only catalog file from listModels minus hidden ids; no secrets on disk", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-catalog-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [
          {
            provider: "pinprov",
            id: "model-alpha",
            name: "Alpha Model",
            reasoning: true,
            apiKey: "SUPERSECRET",
            baseUrl: "https://api.example.internal/v1",
            headers: { authorization: "Bearer SUPERSECRET" },
          },
        ],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const listed = (await backend.handle("listModels", [])) as Array<{ provider: string; id: string }>;
    expect(listed.some(m => `${m.provider}/${m.id}` === "pinprov/model-alpha")).toBe(true);

    // The snapshot write converges asynchronously off every catalog rebuild.
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    await vi.waitFor(async () => {
      await readFile(file, "utf8");
    }, { timeout: 5000 });
    const raw = await readFile(file, "utf8");
    const snapshot = JSON.parse(raw);
    expect(snapshot.version).toBe(SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION);
    expect(snapshot.models).toEqual([{ id: "pinprov/model-alpha", name: "Alpha Model" }]);
    expect(raw).not.toContain("SUPERSECRET");
    expect(raw).not.toContain("api.example.internal");

    // Hiding the model through the canonical visibility RPC converges the same snapshot:
    // the Boss can no longer pin it, and the runtime will reject a stale pin against it.
    await backend.handle("setHiddenModelIds", [["pinprov/model-alpha"]]);
    await vi.waitFor(async () => {
      const converged = JSON.parse(await readFile(file, "utf8"));
      expect(converged.models.map((m: { id: string }) => m.id)).not.toContain("pinprov/model-alpha");
    }, { timeout: 5000 });
    expect((await readdir(agentDir)).filter(name => name.includes(".tmp-"))).toEqual([]);
  });

  it("canonical rebuilds expose the authoritative view immediately; the display cache converges ungated", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-gate-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    const catalog = [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model", reasoning: true }];
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => catalog,
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const self = backend as unknown as {
      loadAndMaterializeSubagentModels(): Promise<unknown>;
      materializeSubagentModelCatalog(): Promise<void>;
      validateSubagentModelPins(input: { refs: string[] }): { decision: string; code?: string; retryable?: boolean; authorityRevision: number };
    };

    // The spawn-time helper resolves WITHOUT waiting on the display queue: spawn can never
    // be blocked by catalog FILE writes. Pin decisions are already live in memory.
    await self.loadAndMaterializeSubagentModels();
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] })).toMatchObject({ decision: "allow" });

    // The v3 display snapshot then converges asynchronously off every catalog rebuild.
    await vi.waitFor(async () => {
      await readFile(file, "utf8");
    }, { timeout: 5000 });
    const first = JSON.parse(await readFile(file, "utf8"));
    expect(first).toMatchObject({ version: SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION });
    expect(first.models.map((m: { id: string }) => m.id)).toEqual(["pinprov/model-alpha"]);

    // Hidden change: the AUTHORITY refuses the newly hidden ref the moment the settings RPC
    // returns — no acceptance window even while its name still sits in a display file.
    await backend.handle("setHiddenModelIds", [["pinprov/model-alpha"]]);
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] })).toMatchObject({ decision: "deny", code: "model_unavailable" });
    await vi.waitFor(async () => {
      const converged = JSON.parse(await readFile(file, "utf8")) as { models: Array<{ id: string }> };
      expect(converged.models.map((m) => m.id)).not.toContain("pinprov/model-alpha");
    }, { timeout: 5000 });

    // Steady state writes nothing (strict equality proves zero churn — 稳态零抖动).
    const steady = await stat(file);
    await self.materializeSubagentModelCatalog();
    expect((await stat(file)).mtimeMs).toBe(steady.mtimeMs);
    expect((await readdir(agentDir)).filter(name => name.includes(".tmp-"))).toEqual([]);
  });

  it("a failed refresh denies every pin instantly; the display cache settles to a tombstone and recovery republishes", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-failclosed-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    let outcome: unknown = [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model" }];
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const self = backend as unknown as {
      refreshModelsAfterAuthChange(includeCurrent?: boolean): Promise<unknown>;
      validateSubagentModelPins(input: { refs: string[] }): { decision: string; code?: string; retryable?: boolean };
      materializeSubagentModelCatalog(): Promise<void>;
    };

    // Initial healthy publication.
    await self.materializeSubagentModelCatalog().catch(() => {});
    self.invalidateModelCatalog();
    outcome = [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model" }];
    await self.refreshModelsAfterAuthChange(false);
    expect(JSON.parse(await readFile(file, "utf8")).models.map((m: { id: string }) => m.id)).toEqual(["pinprov/model-alpha"]);

    // Provider dies mid-refresh (same sequence as the production auth-refresh path:
    // invalidate then reload). The reload REJECTS to its caller…
    outcome = new Error("provider offline");
    await expect(self.refreshModelsAfterAuthChange(false)).rejects.toThrow(/provider offline|目录不可用/);

    // …and the authority closed at the invalidate LP in that same synchronous instant: even
    // though the previous healthy snapshot is still sitting readable on disk, nothing pins.
    const staleOnDisk = JSON.parse(await readFile(file, "utf8"));
    const validated = self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] });
    expect(validated).toMatchObject({ decision: "deny", code: "catalog_unavailable", retryable: true });

    // The display cache then settles to an explicit unavailable marker.
    await vi.waitFor(async () => {
      const tombstone = JSON.parse(await readFile(file, "utf8")) as { available?: boolean; models: unknown[]; reason?: string };
      expect(tombstone.available).toBe(false);
      expect(tombstone.models).toEqual([]);
      expect(typeof tombstone.reason).toBe("string");
    }, { timeout: 5000 });
    void staleOnDisk;

    // Recovery: after the provider returns, the next rebuild accepts ONLY the new refs —
    // on disk and through the authority alike.
    outcome = [{ provider: "pinprov", id: "model-beta", name: "Beta Model" }];
    await self.refreshModelsAfterAuthChange(false);
    const recovered = JSON.parse(await readFile(file, "utf8"));
    expect(recovered.available).not.toBe(false);
    expect(recovered.models.map((m: { id: string }) => m.id)).toEqual(["pinprov/model-beta"]);
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-beta"] })).toMatchObject({ decision: "allow" });
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] })).toMatchObject({ decision: "deny", code: "model_unavailable" });
    void (await self.materializeSubagentModelCatalog());
    expect((await readdir(agentDir)).filter(name => name.includes(".tmp-"))).toEqual([]);
  });

  it("auth refresh returns only after load AND catalog publication settle — revoked model is already absent on return", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-authsettle-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    let models: unknown = [
      { provider: "pinprov", id: "model-alpha", name: "Alpha" },
      { provider: "other", id: "keep-me", name: "Keep" },
    ];
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => models,
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const self = backend as unknown as {
      loadAndMaterializeSubagentModels(): Promise<unknown>;
      refreshModelsAfterAuthChange(includeCurrent?: boolean): Promise<unknown>;
    };

    await self.loadAndMaterializeSubagentModels();
    expect(JSON.parse(await readFile(file, "utf8")).models.map((m: { id: string }) => m.id)).toEqual(["other/keep-me", "pinprov/model-alpha"]);

    // Provider logout revokes pinprov. The production auth path is invalidate → reload →
    // settle → emit; when THIS call returns there must be NO acceptance window left:
    // the on-disk catalog (read immediately after return, no polling) excludes pinprov.
    models = [{ provider: "other", id: "keep-me", name: "Keep" }];
    await self.refreshModelsAfterAuthChange(true);
    const settled = JSON.parse(await readFile(file, "utf8"));
    expect(settled.available).not.toBe(false);
    expect(settled.models.map((m: { id: string }) => m.id)).toEqual(["other/keep-me"]);
  });

  it("unreadable hiddenModelIds fails the load CLOSED (authority denies) and recovers once settings heal", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-hiddenfail-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    const settingsFile = join(agentDir, "pipiui-settings.json");
    // Corrupt visibility BEFORE any catalog read so the first rebuild hits the failure.
    await writeFile(settingsFile, JSON.stringify({ hiddenModelIds: "not-an-array" }), "utf8");
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model" }],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const self = backend as unknown as {
      refreshModelsAfterAuthChange(includeCurrent?: boolean): Promise<unknown>;
      materializeSubagentModelCatalog(): Promise<void>;
      validateSubagentModelPins(input: { refs: string[] }): { decision: string; code?: string; retryable?: boolean };
    };

    // The whole rebuild rejects LOUDLY with the visibility cause (propagated to the auth
    // caller): a ready pin view may never be derived from un-proven hidden state.
    await expect(self.refreshModelsAfterAuthChange(false)).rejects.toThrow(/hiddenModelIds/);
    // Pins stay denied while availability inputs are unprovable.
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] })).toMatchObject({
      decision: "deny",
      code: "catalog_unavailable",
      retryable: true,
    });
    // And the display cache carries an explicit unavailable marker — never an all-visible list.
    await vi.waitFor(async () => {
      const tombstone = JSON.parse(await readFile(file, "utf8")) as { available?: boolean; models: unknown[] };
      expect(tombstone.available).toBe(false);
      expect(tombstone.models).toEqual([]);
    }, { timeout: 5000 });

    // Recovery: heal the visibility file; the next rebuild retries the read from disk
    // (rejected memo dropped) and publishes the filtered snapshot without a restart.
    await writeFile(settingsFile, JSON.stringify({ hiddenModelIds: ["pinprov/model-alpha"] }), "utf8");
    await self.refreshModelsAfterAuthChange(false);
    expect(self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] })).toMatchObject({ decision: "deny", code: "model_unavailable" });
    void (await self.materializeSubagentModelCatalog());
  });

  it("display-write failures gate NOTHING anymore: the authority still decides instantly and disk converges after healing", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-dm-writefail-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    const file = join(agentDir, "pipiui-subagent-model-catalog-runtime.json");
    let models: unknown = [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model" }];
    const backend = createPiHostBackend({
      agentDir,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => models,
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const self = backend as unknown as {
      materializeSubagentModelCatalog(): Promise<void>;
      scheduleSubagentModelCatalogRefresh(): void;
      validateSubagentModelPins(input: { refs: string[] }): { decision: string; code?: string; retryable?: boolean; authorityRevision: number };
    };

    await self.materializeSubagentModelCatalog();
    const allowBefore = self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] });
    expect(allowBefore).toMatchObject({ decision: "allow" });

    // Sabotage ONLY the display cache file: swap it for a directory so every atomic
    // rename into place fails, while settings and the rest of the home stay writable.
    await rm(file);
    await mkdir(file);

    // Hiding the model still resolves: lifecycle is decoupled from display writes.
    models = [{ provider: "pinprov", id: "model-alpha", name: "Alpha Model" }];
    await expect(backend.handle("setHiddenModelIds", [["pinprov/model-alpha"]])).resolves.toEqual(["pinprov/model-alpha"]);

    // Denial is effective in-memory THE SAME instant (revision moved forward), even though
    // the model stayed listed everywhere on disk — the display cache is presentation only.
    const denyNow = self.validateSubagentModelPins({ refs: ["pinprov/model-alpha"] });
    expect(denyNow).toMatchObject({ decision: "deny", code: "model_unavailable", retryable: false });
    expect(denyNow.authorityRevision).toBeGreaterThan((allowBefore as { authorityRevision: number }).authorityRevision);
    void (await self.materializeSubagentModelCatalog().catch(() => undefined));

    // Healing the sabotage lets the cache converge to the same truth eventually.
    await rmdir(file);
    self.scheduleSubagentModelCatalogRefresh();
    await vi.waitFor(async () => {
      const converged = JSON.parse(await readFile(file, "utf8")) as { available?: boolean; models: Array<{ id: string }> };
      expect(converged.available).not.toBe(false);
      expect(converged.models.map((m) => m.id)).not.toContain("pinprov/model-alpha");
    }, { timeout: 5000 });
  });

});

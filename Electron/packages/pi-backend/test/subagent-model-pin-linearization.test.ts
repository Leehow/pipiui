/**
 * Cross-process LINEARIZED model-pin validation (the MUST FIX closure for
 * review-model-final5).
 *
 * The v2 epoch/rename protocol had no shared linearization point between the backend's
 * JS-state invalidate and an already-running Boss's two-file disk read: during publication
 * windows the on-disk pair could re-align on STALE content and accept superseded pins. This
 * suite proves the replacement protocol:
 *
 * - The backend keeps ONE immutable PinCatalogAuthority; `invalidateModelCatalog()` swaps it
 *   synchronously (Invalidate LP), every canonical rebuild commits one ready view (Commit
 *   LP), and each `model_pin_validate` batch captures it exactly once (Validation LP). Node
 *   run-to-completion orders those three operations into a deterministic total order.
 * - A REAL second OS process (spawned node child) drives the SAME production loopback
 *   `/rpc model_pin_validate` endpoint and is denied authoritatively WHILE the old healthy
 *   snapshot still sits readable on disk — i.e. exactly the state where the retired
 *   disk-based protocol could still ACCEPT stale pins.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PIPIUI_AGENT_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;
delete process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE;

const { createPiHostBackend } = await import("../src/index.js");

const ALPHA = "pinprov/model-alpha";
const BETA = "pinprov/model-beta";
const HIDDEN = "pinprov/model-hidden";

type ValidateFn = (input: { refs: string[] }) => {
  schemaVersion: number;
  decision: string;
  code?: string;
  invalidIndex?: number;
  retryable?: boolean;
  authorityRevision: number;
};

interface Harness {
  root: string;
  agentDir: string;
  snapshotFile: string;
  backend: ReturnType<typeof import("../src/index.js").createPiHostBackend>;
  validate: ValidateFn;
  invalidate(): void;
  models(next: unknown[]): void;
}

async function harness(initialModels: unknown[]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pipi-pin-lin-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  let models: unknown[] = initialModels;
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
    loadAndMaterializeSubagentModels(): Promise<void>;
    invalidateModelCatalog(): void;
    validateSubagentModelPins: ValidateFn;
  };
  // Publish the initial canonical generation cleanly before the caller starts racing.
  self.invalidateModelCatalog();
  Object.defineProperty(self, "__modelsRef", { value: () => models, configurable: true });
  const wrapped: Harness["validate"] = (input) => self.validateSubagentModelPins(input);
  return {
    root,
    agentDir,
    snapshotFile: join(agentDir, "pipiui-subagent-model-catalog-runtime.json"),
    backend,
    validate: wrapped,
    invalidate: () => self.invalidateModelCatalog(),
    models: (next) => { models = next; },
  } as Harness;
}

/** Spawn a REAL OS process that POSTs the canonical envelope to the live loopback bridge. */
function probe(
  port: number,
  capability: unknown,
  refs: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const script = [
    'const port = process.env.PROBE_PORT;',
    'const body = {',
    '  schemaVersion: 1,',
    '  sessionCapability: process.env.PROBE_CAPABILITY,',
    '  action: "model_pin_validate",',
    '  event: { schemaVersion: 1, refs: JSON.parse(process.env.PROBE_REFS ?? "[]") },',
    '};',
    'fetch(`http://127.0.0.1:${port}/rpc`, {',
    '  method: "POST",',
    '  headers: { "content-type": "application/json" },',
    '  body: JSON.stringify(body),',
    '}).then(async (response) => ({ status: response.status, body: await response.json() }))',
    '  .then((result) => { process.stdout.write(JSON.stringify(result)); })',
    '  .catch((error) => { process.stdout.write(JSON.stringify({ status: 0, error: String(error) })); })',
    '  .finally(() => process.exit(0));',
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PROBE_PORT: String(port), PROBE_CAPABILITY: String(capability), PROBE_REFS: JSON.stringify(refs) },
  });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { out += c.toString(); });
    child.on("exit", () => {
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`probe child failed: ${out}`)); }
    });
    child.on("error", reject);
  });
}

describe("cross-process linearized subagent model pins", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    if (h) await rm(h.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    h = undefined;
  });

  async function bridgeEndpoint(harnessState: Harness): Promise<{ port: number; capability: string; close(): Promise<void>; seenInputs: Array<{ refs?: unknown }> }> {
    const backendAny = harnessState.backend as unknown as {
      bridge: {
        listen(): Promise<number>;
        register(sessionId: string): string;
        close(): Promise<void>;
      };
      validateSubagentModelPins: ValidateFn;
    };
    const port = await backendAny.bridge.listen();
    const capability = backendAny.bridge.register("pin-probe-probe");
    const seenInputs: Array<{ refs?: unknown }> = [];
    const original = backendAny.validateSubagentModelPins.bind(harnessState.backend);
    (harnessState.backend as unknown as Record<string, unknown>).validateSubagentModelPins = (input: { refs?: unknown }) => {
      seenInputs.push(input);
      return original(input);
    };
    return {
      port,
      capability,
      close: () => backendAny.bridge.close(),
      seenInputs,
    };
  }

  it("a REAL second OS process is denied while disk still holds the stale aligned snapshot (retired protocol would accept)", async () => {
    h = await harness([{ provider: "pinprov", id: "model-alpha", name: "Alpha" }]);
    const endpoint = await bridgeEndpoint(h);
    try {
      // Healthy canonical baseline: both the authority AND the display cache list alpha.
      await (h.backend as unknown as { refreshModelCatalog(includeCurrent?: boolean): Promise<unknown> }).refreshModelCatalog(false);
      expect(h.validate({ refs: [ALPHA] })).toMatchObject({ decision: "allow" });

      // ═══ THE WINDOW ═══ Invalidate flips the authority SYNCHRONOUSLY; nothing has drained
      // any queue or touched any disk file yet. The Boss-visible cache STILL advertises the
      // now-stale alpha — precisely where review-model-final5 found the v2 acceptance hole.
      const allowRevision = h.validate({ refs: [ALPHA] }).authorityRevision;
      h.invalidate();
      const stillStaleOnDisk = JSON.parse(await readFile(h.snapshotFile, "utf8")) as { models: Array<{ id: string }> };
      expect(stillStaleOnDisk.models.map((m) => m.id)).toContain(ALPHA);

      // Another OS PROCESS, seeing only the network endpoint, MUST be refused NOW.
      const probeResult = await probe(endpoint.port, endpoint.capability, [ALPHA]);
      expect(probeResult.status).toBe(200);
      expect(probeResult.body).toMatchObject({
        schemaVersion: 1,
        decision: "deny",
        code: "catalog_unavailable",
        retryable: true,
      });
      expect((probeResult.body.authorityRevision as number)).toBeGreaterThan(allowRevision);

      // And the denial did not depend on anything disk-shaped: the handler saw ONLY refs.
      expect(endpoint.seenInputs.at(-1)).toEqual({ refs: [ALPHA] });

      // Recovery commits beta: the same OS process now sees exactly the new truth.
      h.models([{ provider: "pinprov", id: "model-beta", name: "Beta" }]);
      await (h.backend as unknown as {
        invalidateModelCatalog(): void;
        refreshModelsAfterAuthChange(includeCurrent?: boolean): Promise<unknown>;
      }).refreshModelsAfterAuthChange(false);
      const committed = h.validate({ refs: [BETA] });
      expect(committed).toMatchObject({ decision: "allow" });

      const recoveredAllow = await probe(endpoint.port, endpoint.capability, [BETA]);
      expect(recoveredAllow.body).toMatchObject({ decision: "allow", authorityRevision: committed.authorityRevision });
      const recoveredDeny = await probe(endpoint.port, endpoint.capability, [ALPHA]);
      expect(recoveredDeny.body).toMatchObject({
        decision: "deny",
        code: "model_unavailable",
        invalidIndex: 0,
        retryable: false,
        authorityRevision: committed.authorityRevision,
      });
      await vi.waitFor(async () => {
        const converged = JSON.parse(await readFile(h!.snapshotFile, "utf8")) as { available?: boolean; models: Array<{ id: string }> };
        expect(converged.available).not.toBe(false);
        expect(converged.models.map((m) => m.id)).toEqual([BETA]);
      }, { timeout: 5000 });
    } finally {
      await endpoint.close();
    }
  });

  it("linearization total order: validate-before-invalidate allows at the old revision; everything after denies; commit admits only new refs", async () => {
    h = await harness([
      { provider: "pinprov", id: "model-alpha", name: "Alpha" },
      { provider: "pinprov", id: "model-beta", name: "Beta" },
    ]);
    await (h.backend as unknown as { materializeSubagentModelCatalog(): Promise<void> }).materializeSubagentModelCatalog();

    await (h.backend as unknown as { refreshModelCatalog(includeCurrent?: boolean): Promise<unknown> }).refreshModelCatalog(false);

    // (1) validate < invalidate: legal pre-invalidate read — OLD revision allow.
    const pre = h.validate({ refs: [ALPHA] });
    expect(pre.decision).toBe("allow");
    // (2) invalidate assignment lands synchronously…
    h.invalidate();
    // (3) …so ANY validation after it denies at a strictly higher revision…
    const mid = h.validate({ refs: [ALPHA, BETA] });
    expect(mid).toMatchObject({ decision: "deny", code: "catalog_unavailable", retryable: true });
    expect(mid.authorityRevision).toBeGreaterThan(pre.authorityRevision);
    // (4) …until one full canonical rebuild commits, which admits ONLY the new refs.
    h.models([{ provider: "pinprov", id: "model-beta", name: "Beta" }]);
    await (h.backend as unknown as { refreshModelsAfterAuthChange(includeCurrent?: boolean): Promise<unknown> }).refreshModelsAfterAuthChange(false);
    const post = h.validate({ refs: [BETA] });
    expect(post).toMatchObject({ decision: "allow" });
    expect(post.authorityRevision).toBeGreaterThan(mid.authorityRevision);
    const gone = h.validate({ refs: [ALPHA] });
    expect(gone).toMatchObject({ decision: "deny", code: "model_unavailable", retryable: false });
    expect(gone.authorityRevision).toBe(post.authorityRevision);
  });

  it("batches share ONE linearization point: a mixed wave returns one revision and names the first invalid ref index", async () => {
    h = await harness([{ provider: "pinprov", id: "model-beta", name: "Beta" }]);
    const endpoint = await bridgeEndpoint(h);
    try {
      await (h.backend as unknown as { materializeSubagentModelCatalog(): Promise<void> }).materializeSubagentModelCatalog();

      await (h.backend as unknown as { refreshModelCatalog(includeCurrent?: boolean): Promise<unknown> }).refreshModelCatalog(false);
      const okWave = await probe(endpoint.port, endpoint.capability, [BETA, BETA]);
      expect(okWave.body).toMatchObject({ decision: "allow" });

      const mixed = await probe(endpoint.port, endpoint.capability, [BETA, ALPHA, HIDDEN]);
      expect(mixed.body).toMatchObject({
        decision: "deny",
        code: "model_unavailable",
        invalidIndex: 1, // FIRST offender wins (alpha), not the later hidden ref
        retryable: false,
      });
      const allowRevision = Number((okWave.body as { authorityRevision: number }).authorityRevision);
      expect(mixed.body.authorityRevision).toBe(allowRevision);

      // Forged capabilities learn nothing — identical refusal, handler untouched.
      const forged = await probe(endpoint.port, "not-the-minted-secret", [BETA]);
      expect(forged.status).toBe(403);
      // Project-shaped junk on the envelope is inert: authorization comes only from the
      // capability map, and the authority input stays just refs.
      expect(endpoint.seenInputs.every((input) => Object.keys(input).sort().join() === "refs")).toBe(true);
    } finally {
      await endpoint.close();
    }
  });

  it("provider login/logout lifecycle settles through the same authority (revoked provider denied across processes)", async () => {
    h = await harness([{ provider: "pinprov", id: "model-alpha", name: "Alpha" }]);
    const endpoint = await bridgeEndpoint(h);
    try {
      await (h.backend as unknown as { materializeSubagentModelCatalog(): Promise<void> }).materializeSubagentModelCatalog();
      await (h.backend as unknown as { refreshModelCatalog(includeCurrent?: boolean): Promise<unknown> }).refreshModelCatalog(false);
      expect((await probe(endpoint.port, endpoint.capability, [ALPHA])).body.decision).toBe("allow");

      // Logout (removeProviderCredentials) with a THROWING runtime.logout: the catch path
      // must STILL have flipped the authority shut before surfacing the error.
      const rtLike = await (h.backend as unknown as { modelRuntime(): Promise<{ logout(p: string): Promise<void> }> }).modelRuntime();
      const originalLogout = rtLike.logout.bind(rtLike);
      (rtLike as { logout: (p: string) => Promise<void> }).logout = async (p: string) => {
        await originalLogout(p);
        throw new Error("logout transport exploded after credential removal");
      };
      await expect((h.backend as unknown as { handle(method: string, params: unknown[]): Promise<unknown> })
        .handle("removeProviderCredentials", ["pinprov"])).rejects.toThrow(/transport exploded/);
      const closed = await probe(endpoint.port, endpoint.capability, [ALPHA]);
      expect(closed.body).toMatchObject({ decision: "deny", code: "catalog_unavailable", retryable: true });
    } finally {
      await endpoint.close();
    }
  });
});

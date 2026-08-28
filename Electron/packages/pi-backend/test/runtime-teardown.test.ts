import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPiHostBackend, type QueueStore } from "../src/index.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { createTurnTelemetry } from "../src/turn-telemetry.js";
import type { InputFileStageRequest, Model } from "@pipi/host-api";

let root = "";
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

const grok: Model = {
  provider: "grok-build",
  id: "grok-4.6",
  name: "Grok 4.6",
  capabilities: { inputFiles: true },
};

function attachment(id: string, name = "hold.md"): InputFileStageRequest {
  const text = "attachment bytes";
  return {
    id,
    name,
    size: Buffer.byteLength(text),
    mimeType: "text/markdown",
    dataBase64: Buffer.from(text).toString("base64"),
  };
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-runtime-teardown-"));
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const sessionDir = join(sessionsRoot, encodeURIComponent(project));
  await mkdir(project, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  for (const id of ["s1", "s2"]) {
    await writeFile(
      join(sessionDir, `${id}.jsonl`),
      `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-28T00:00:00.000Z", cwd: project })}\n`,
    );
  }
  return { project, agentDir, sessionsRoot, sessionDir };
}

describe("session runtime teardown", () => {
  it("does not rewrite a session after deletion revokes an in-flight redaction", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    vi.spyOn(internals, "sessionSecrets").mockReturnValue([{
      id: "secret-1",
      name: "test",
      envName: "TEST_TOKEN",
      value: "not persisted",
    }]);
    vi.spyOn(internals, "canRewriteSessionFile").mockReturnValue(true);
    let releaseConfirm!: () => void;
    let confirmStarted!: () => void;
    const confirmStartedGate = new Promise<void>((resolve) => { confirmStarted = resolve; });
    const confirmRelease = new Promise<void>((resolve) => { releaseConfirm = resolve; });
    vi.spyOn(internals, "confirmSessionFileIdle").mockImplementation(async () => {
      confirmStarted();
      await confirmRelease;
      return true;
    });
    let rewrites = 0;
    vi.spyOn(internals, "rewriteSessionSecrets").mockImplementation(async () => { rewrites += 1; });
    const redaction = internals.sessionRedact as {
      request(sessionId: string): void;
      flush(sessionId: string): Promise<unknown>;
    };
    redaction.request("s1");
    const barrier = internals.sessionFileExclusive("s1");
    const flushing = barrier(() => redaction.flush("s1"));
    await confirmStartedGate;

    let teardownStarted!: () => void;
    const teardownStartedGate = new Promise<void>((resolve) => { teardownStarted = resolve; });
    const teardown = internals.teardownSessionRuntime.bind(internals);
    vi.spyOn(internals, "teardownSessionRuntime").mockImplementation((id: string) => {
      teardownStarted();
      return teardown(id);
    });
    const deleting = backend.handle("deleteSession", ["s1"]);
    await teardownStartedGate;
    releaseConfirm();

    expect(await flushing).toBe("skipped");
    await deleting;
    expect(rewrites).toBe(0);
    await expect(stat(join(setup.sessionDir, "s1.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ live: 0, queue: 0, sessionFileBarrier: 0 });

    await backend.close();
  });

  it("does not resurrect a session when deletion fences a dispatch before ensure", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const queue = internals.queue as {
      markBusy(sessionId: string): number;
      enqueue(sessionId: string, input: { text: string }): unknown;
      notifyIdle(sessionId: string): Promise<void>;
    };
    let releaseBeforeEnsure!: () => void;
    const beforeEnsure = new Promise<void>((resolve) => { releaseBeforeEnsure = resolve; });
    let dispatchPaused!: () => void;
    const dispatchPausedGate = new Promise<void>((resolve) => { dispatchPaused = resolve; });
    vi.spyOn(internals, "requireLease").mockImplementation(async () => {
      dispatchPaused();
      await beforeEnsure;
    });
    const ensure = vi.spyOn(internals, "ensure");
    let teardownStarted!: () => void;
    const teardownStartedGate = new Promise<void>((resolve) => { teardownStarted = resolve; });
    const teardown = internals.teardownSessionRuntime.bind(internals);
    vi.spyOn(internals, "teardownSessionRuntime").mockImplementation((id: string) => {
      teardownStarted();
      return teardown(id);
    });

    queue.markBusy("s1");
    queue.enqueue("s1", { text: "must not resurrect" });
    const dispatch = queue.notifyIdle("s1");
    await dispatchPausedGate;

    const deleting = backend.handle("deleteSession", ["s1"]);
    await teardownStartedGate;
    expect(internals.sessionRuntimeTearingDown.has("s1")).toBe(true);
    releaseBeforeEnsure();

    await dispatch;
    await deleting;
    expect(ensure).not.toHaveBeenCalled();
    await expect(stat(join(setup.sessionDir, "s1.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ live: 0, queue: 0, queueLoad: 0, queueWrite: 0 });

    await backend.close();
  });

  it("settles pending queue/upload work, clears only the deleted session, and also runs on close", async () => {
    const setup = await fixture();
    let releaseQueueWrite!: () => void;
    const queueWriteGate = new Promise<void>((resolve) => { releaseQueueWrite = resolve; });
    let queueWriteStarted!: () => void;
    const queueWriteStartedGate = new Promise<void>((resolve) => { queueWriteStarted = resolve; });
    const storedQueues = new Map<string, unknown>();
    const removedQueues: string[] = [];
    const queueStore: QueueStore = {
      load: async () => [],
      save: async (sessionId, items) => {
        if (sessionId === "s1") {
          queueWriteStarted();
          await queueWriteGate;
        }
        storedQueues.set(sessionId, structuredClone(items));
      },
      remove: async (sessionId) => {
        removedQueues.push(sessionId);
        storedQueues.delete(sessionId);
      },
    };

    let uploadStarted!: () => void;
    const uploadStartedGate = new Promise<void>((resolve) => { uploadStarted = resolve; });
    let uploadAborts = 0;
    const extensions = createExtensionRegistry();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime"),
      queueStore,
      extensionRegistry: extensions,
      inputFilesRemote: {
        upload: async ({ name, signal }) => {
          if (name !== "hold.md") {
            return { fileId: "file-s2", name, size: 4, mimeType: "text/markdown", digest: "s2" };
          }
          uploadStarted();
          return new Promise((_, reject) => {
            signal?.addEventListener("abort", () => {
              uploadAborts += 1;
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        },
        remove: async () => undefined,
      },
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };

    const queue = (backend as unknown as {
      queue: { markBusy(sessionId: string): number; enqueue(sessionId: string, input: { text: string }): unknown };
    }).queue;
    queue.markBusy("s1");
    queue.enqueue("s1", { text: "persisting while deleted" });
    queue.markBusy("s2");
    queue.enqueue("s2", { text: "unrelated queue survives" });
    extensions.mountSession("s1", ["test-extension"]);
    extensions.mountSession("s2", ["test-extension"]);

    // Real host routes create the durable barrier and document injection state.
    await backend.handle("renameSession", ["s1", "runtime teardown"]);
    const doc = join(setup.project, "pending.md");
    await writeFile(doc, "# pending document\n");
    await backend.handle("notifyDocumentsDropped", ["s1", [doc]]);

    const staged = backend.handle("stageInputFile", ["s1", attachment("att-s1")]);
    await uploadStartedGate;
    await queueWriteStartedGate;
    await expect.poll(() => storedQueues.has("s2")).toBe(true);

    expect(backend.runtimeStateCounts("s1")).toMatchObject({
      queue: 1,
      queueWrite: 1,
      sessionFileBarrier: 1,
      extensionMount: 1,
      documentInjection: 1,
      openedDocuments: 1,
      inputBytes: Buffer.byteLength("attachment bytes"),
      inputUploads: 1,
    });
    expect(backend.runtimeStateCounts("s2")).toMatchObject({ queue: 1, extensionMount: 1 });

    const deleting = backend.handle("deleteSession", ["s1"]);
    let deleteSettled = false;
    void deleting.finally(() => { deleteSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deleteSettled).toBe(false); // waits for the pre-existing queue write
    await expect(backend.handle("stageInputFile", ["s1", attachment("late")])).rejects.toThrow(/关闭/);
    releaseQueueWrite();
    await deleting;

    expect(uploadAborts).toBe(1);
    expect(await staged).toMatchObject({ status: "cancelled" });
    expect(removedQueues).toEqual(["s1"]);
    expect(storedQueues.has("s1")).toBe(false);
    expect(storedQueues.has("s2")).toBe(true);
    await expect(stat(join(setup.sessionDir, "s1.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(backend.runtimeStateCounts("s1")).toEqual({
      live: 0,
      leaseOperationLane: 0,
      queue: 0,
      queueLoad: 0,
      queueWrite: 0,
      sessionFileBarrier: 0,
      context: 0,
      ledger: 0,
      modelState: 0,
      extensionMount: 0,
      documentInjection: 0,
      openedDocuments: 0,
      historyCache: 0,
      inputBytes: 0,
      inputUploads: 0,
    });
    expect(backend.runtimeStateCounts("s2")).toMatchObject({ queue: 1, extensionMount: 1 });

    // Repeating the boundary is a no-op, and cannot revive the deleted queue.
    await backend.teardownSessionRuntime("s1");
    expect(backend.runtimeStateCounts("s1").queue).toBe(0);

    await backend.close();
    expect(backend.runtimeStateCounts("s2")).toMatchObject({
      queue: 0,
      extensionMount: 0,
      inputBytes: 0,
      inputUploads: 0,
    });
  });

  it("ignores a late queueIdle continuation after delete teardown reclaims its token", async () => {
    const setup = await fixture();
    let releaseLoad!: () => void;
    let loadStarted!: () => void;
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    const loadStartedGate = new Promise<void>((resolve) => { loadStarted = resolve; });
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-late-idle"),
      queueStore: {
        load: async () => {
          loadStarted();
          await loadGate;
          return [];
        },
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const oldToken = internals.beginSessionRuntime("s1");
    const lateQueueIdle = internals.queueIdle("s1", undefined, oldToken);
    await loadStartedGate;

    const deleting = backend.handle("deleteSession", ["s1"]);
    releaseLoad();
    await deleting;
    await lateQueueIdle;

    expect(internals.sessionRuntimeTokens.has("s1")).toBe(false);
    expect(internals.sessionRuntimeTombstones.has("s1")).toBe(false);
    expect(internals.queue.hasSession("s1")).toBe(false);
    await backend.close();
  });

  it("ignores agent_start from a deleted lifecycle after its token is reclaimed", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-late-start"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const oldToken = internals.beginSessionRuntime("s1");
    const cancel = vi.fn();
    const markBusy = vi.spyOn(internals.queue, "markBusy");
    const staleLive = {
      session: { id: "s1" },
      runtimeToken: oldToken,
      compaction: { cancel },
    };

    await backend.handle("deleteSession", ["s1"]);
    internals.rpcEvent(staleLive, { type: "agent_start" });

    expect(markBusy).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(internals.queue.hasSession("s1")).toBe(false);
    expect(internals.sessionRuntimeTokens.has("s1")).toBe(false);
    await backend.close();
  });

  it("rejects a late panel document drop and accepts a same-ID recreation", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-late-panel-doc"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const documentPath = join(setup.project, "late-panel.md");
    await writeFile(documentPath, "# panel document\n");
    let releaseParser!: () => void;
    let parserStarted!: () => void;
    const parserGate = new Promise<void>((resolve) => { releaseParser = resolve; });
    const parserStartedGate = new Promise<void>((resolve) => { parserStarted = resolve; });
    let firstParserCall = true;
    vi.spyOn(internals, "pdfParserMounted").mockImplementation(async () => {
      if (firstParserCall) {
        firstParserCall = false;
        parserStarted();
        await parserGate;
      }
      return false;
    });

    const lateDrop = backend.handle("notifyDocumentsDropped", ["s1", [documentPath]]);
    await parserStartedGate;
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ openedDocuments: 0, documentInjection: 0 });

    const oldToken = internals.sessionRuntimeToken("s1");
    const deleting = backend.handle("deleteSession", ["s1"]);
    await deleting;
    await writeFile(
      join(setup.sessionDir, "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-28T00:00:00.000Z", cwd: setup.project })}\n`,
    );
    await backend.handle("resumeSession", ["s1"]);
    const newToken = internals.sessionRuntimeToken("s1");
    expect(newToken).not.toBe(oldToken);

    releaseParser();
    await expect(lateDrop).rejects.toThrow(/disposed/);
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ openedDocuments: 0, documentInjection: 0 });

    await backend.handle("notifyDocumentsDropped", ["s1", [documentPath]]);
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ openedDocuments: 1, documentInjection: 1 });
    await backend.close();
  });

  it("rejects a composer document drop that completes after deletion", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-late-composer-doc"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const documentPath = join(setup.project, "late-composer.md");
    await writeFile(documentPath, "# composer document\n");
    let releaseParser!: () => void;
    let parserStarted!: () => void;
    const parserGate = new Promise<void>((resolve) => { releaseParser = resolve; });
    const parserStartedGate = new Promise<void>((resolve) => { parserStarted = resolve; });
    vi.spyOn(internals, "pdfParserMounted").mockImplementation(async () => {
      parserStarted();
      await parserGate;
      return false;
    });

    const lateDrop = backend.handle("notifyComposerDocumentsDropped", ["s1", [documentPath]]);
    await parserStartedGate;
    const deleting = backend.handle("deleteSession", ["s1"]);
    await deleting;
    releaseParser();

    await expect(lateDrop).rejects.toThrow(/disposed/);
    expect(backend.runtimeStateCounts("s1")).toMatchObject({ openedDocuments: 0, documentInjection: 0 });
    await backend.close();
  });

  it("gives a recreated session id a fresh token while rejecting old queueIdle", async () => {
    const setup = await fixture();
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-recreate"),
      queueStore: {
        load: async () => [],
        save: async () => undefined,
        remove: async () => undefined,
      },
    });
    const internals = backend as any;
    const oldToken = internals.beginSessionRuntime("s1");
    await backend.handle("deleteSession", ["s1"]);
    await writeFile(
      join(setup.sessionDir, "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-28T00:00:00.000Z", cwd: setup.project })}\n`,
    );

    await backend.handle("resumeSession", ["s1"]);
    const newToken = internals.sessionRuntimeToken("s1");
    expect(newToken).toBeGreaterThan(oldToken);
    expect(newToken).not.toBe(oldToken);
    const notifyIdle = vi.spyOn(internals.queue, "notifyIdle");

    await internals.queueIdle("s1", undefined, oldToken);
    expect(notifyIdle).not.toHaveBeenCalled();
    expect(internals.queue.hasSession("s1")).toBe(true);
    await internals.queueIdle("s1", undefined, newToken);
    expect(notifyIdle).toHaveBeenCalledTimes(1);

    await backend.close();
  });

  it("reclaims telemetry and generation registries after repeated unique active deletes", async () => {
    const setup = await fixture();
    const telemetry = createTurnTelemetry({ agentDir: setup.agentDir });
    const empty: QueueStore = {
      load: async () => [],
      save: async () => undefined,
      remove: async () => undefined,
    };
    const backend = createPiHostBackend({
      agentDir: setup.agentDir,
      sessionsRoot: setup.sessionsRoot,
      runtimeRoot: join(root, "runtime-repeat"),
      turnTelemetry: telemetry,
      queueStore: empty,
      inputFilesRemote: {
        upload: async ({ name }) => ({ fileId: `file-${name}`, name, size: 4, mimeType: "text/markdown", digest: "d" }),
        remove: async () => undefined,
      },
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };
    const baseline = {
      generations: 0,
      leaseOperationLanes: 0,
      tombstones: 0,
      tearingDown: 0,
      deletionInProgress: 0,
      telemetryActive: 0,
      telemetryFenced: 0,
      redactionGenerations: 0,
      envRefreshGenerations: 0,
    };
    expect(backend.runtimeRegistryCounts()).toEqual(baseline);

    const extra = ["s-extra-1", "s-extra-2"];
    for (const id of extra) {
      await writeFile(
        join(setup.sessionDir, `${id}.jsonl`),
        `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-28T00:00:00.000Z", cwd: setup.project })}\n`,
      );
    }
    const ids = ["s1", "s2", ...extra];
    for (const id of ids) {
      telemetry.beginDispatch(id, undefined);
      expect(telemetry.hasActive(id)).toBe(true);
      const deleting = backend.handle("deleteSession", [id]);
      // Fence is synchronous before locate; late events must not recreate state.
      expect(telemetry.hasActive(id)).toBe(false);
      telemetry.beginDispatch(id, undefined);
      telemetry.observeRpc(id, {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "late" },
      });
      telemetry.terminal(id, "settled");
      expect(telemetry.hasActive(id)).toBe(false);
      expect(telemetry.sessionPerformance(id)).toBeUndefined();
      await deleting;
      expect(telemetry.hasActive(id)).toBe(false);
    }
    expect(backend.runtimeRegistryCounts()).toEqual(baseline);
    expect(telemetry.retainedState()).toEqual({ pending: 0, active: 0, fenced: 0, performance: 0 });

    await writeFile(
      join(setup.sessionDir, "fresh.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "fresh", timestamp: "2026-08-28T00:00:00.000Z", cwd: setup.project })}\n`,
    );
    await backend.handle("renameSession", ["fresh", "after delete"]);
    const staged = await backend.handle("stageInputFile", ["fresh", attachment("fresh")]);
    expect(staged).toMatchObject({ status: "ready" });
    await backend.close();
  });
});

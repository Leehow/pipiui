import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  InputFilesController,
  JsonInputFileStore,
  loadGrokInputFilesRemote,
  modelDeclaresInputFiles,
  sanitizeInputFileError,
} from "../src/input-files.js";
import type { InputFileStageRequest, Model } from "@pipi/host-api";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const grok: Model = {
  provider: "grok-build",
  id: "grok-4.6",
  name: "Grok 4.6",
  capabilities: { inputFiles: true },
};
const claude: Model = { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" };

function stage(name = "/abs/secret/notes.md", text = "hello files", id?: string): InputFileStageRequest {
  return {
    ...(id ? { id } : {}),
    name,
    size: Buffer.byteLength(text),
    mimeType: "text/markdown",
    dataBase64: Buffer.from(text).toString("base64"),
  };
}

async function tempDir(prefix = "pipi-input-files-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe("input files capability gate", () => {
  it("fails closed unless live capabilities.inputFiles === true", () => {
    expect(modelDeclaresInputFiles(undefined)).toBe(false);
    expect(modelDeclaresInputFiles(claude)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: {} } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: { inputFiles: false } } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: { inputFiles: { upload: true } } } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: { inputFiles: { upload: false } } } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: { inputFiles: [] } } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ capabilities: { inputFiles: "true" } } as Model)).toBe(false);
    expect(modelDeclaresInputFiles({ provider: "grok-build", id: "grok-4.6", name: "Grok" })).toBe(false);
    expect(modelDeclaresInputFiles(grok)).toBe(true);
    expect(modelDeclaresInputFiles({ provider: "anthropic", id: "x", name: "x", capabilities: { inputFiles: true } })).toBe(true);
  });
});

describe("input files host controller", () => {
  it("writes project-local 0600 metadata without paths, bytes, or tokens", async () => {
    const dir = await tempDir();
    const remote = {
      upload: async () => ({ fileId: "file-1", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "abc" }),
      remove: async () => undefined,
    };
    let model: Model = claude;
    const ctl = new InputFilesController(new JsonInputFileStore(dir), remote, () => model);
    await expect(ctl.stage("s1", stage())).rejects.toThrow(/不支持文件附件/);
    model = grok;
    const ready = await ctl.stage("s1", stage());
    expect(ready).toMatchObject({ name: "notes.md", status: "ready", fileId: "file-1" });
    expect(JSON.stringify(ready)).not.toContain("/abs/");
    expect(ready).not.toHaveProperty("digest");
    const stored = join(dir, "input-files", "s1.json");
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    const raw = await readFile(stored, "utf8");
    expect(raw).not.toContain("/abs/secret");
    expect(raw).not.toContain("hello files");
    expect(raw).not.toContain("at-secret");
    expect(raw).not.toContain("Bearer");
    expect(JSON.parse(raw)).toMatchObject({ version: 1, attachments: [{ name: "notes.md", fileId: "file-1", status: "ready" }] });
  });

  it("reuses a session digest, retries failures, cancels, and best-effort deletes unsent files", async () => {
    const dir = await tempDir();
    let uploads = 0;
    let deletes = 0;
    const remote = {
      upload: async (input: { signal?: AbortSignal }) => {
        uploads += 1;
        if (uploads === 1) throw new Error("upstream 401 bearer at-secret path=/Users/haoli/x.md");
        input.signal?.throwIfAborted();
        const digest = createHash("sha256").update(Buffer.from("hello files")).digest("hex");
        return { fileId: `file-${uploads}`, name: "notes.md", size: 11, mimeType: "text/markdown", digest };
      },
      remove: async () => { deletes += 1; },
    };
    const ctl = new InputFilesController(new JsonInputFileStore(dir), remote, () => grok);
    const failed = await ctl.stage("s1", stage("/abs/secret/notes.md", "hello files", "att-1"));
    expect(failed.status).toBe("failed");
    expect(failed.error).not.toContain("at-secret");
    expect(failed.error).not.toContain("/Users/haoli");
    const retried = await ctl.retry("s1", "att-1");
    expect(retried.status).toBe("ready");
    expect(retried.fileId).toBe("file-2");
    const reused = await ctl.stage("s1", stage("other.md", "hello files"));
    expect(reused.fileId).toBe("file-2");
    expect(uploads).toBe(2);
    await ctl.remove("s1", reused.id);
    expect(deletes).toBe(1);
  });

  it("does not remote-DELETE a sent file and requires reselect when bytes are gone", async () => {
    const dir = await tempDir();
    let deletes = 0;
    const store = new JsonInputFileStore(dir);
    const remote = {
      upload: async () => ({ fileId: "file-sent", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "abc" }),
      remove: async () => { deletes += 1; },
    };
    const ctl = new InputFilesController(store, remote, () => grok);
    const ready = await ctl.stage("s1", stage(undefined, undefined, "att-sent"));
    expect(ready.status).toBe("ready");
    await ctl.markSent("s1", ["att-sent"]);
    await ctl.remove("s1", "att-sent");
    expect(deletes).toBe(0);

    const fresh = new InputFilesController(store, remote, () => grok);
    await store.upsert("s1", {
      id: "att-retry",
      name: "notes.md",
      size: 11,
      mimeType: "text/markdown",
      status: "failed",
      error: "上次失败",
    });
    await expect(fresh.retry("s1", "att-retry")).rejects.toThrow(/重新选择/);
  });

  it("cancels an in-flight upload and isolates concurrent sessions", async () => {
    const dir = await tempDir();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const remote = {
      upload: async (input: { signal?: AbortSignal }) => {
        await gate;
        input.signal?.throwIfAborted();
        return { fileId: "file-9", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "abc" };
      },
      remove: async () => undefined,
    };
    const ctl = new InputFilesController(new JsonInputFileStore(dir), remote, () => grok);
    const pending = ctl.stage("s1", stage(undefined, undefined, "att-1"));
    await expect.poll(async () => (await ctl.list("s1"))[0]?.status).toBe("uploading");
    await expect(ctl.readyForSend("s1")).rejects.toThrow(/仍在上传/);
    const cancelled = await ctl.cancel("s1", "att-1");
    expect(cancelled.status).toBe("cancelled");
    release();
    expect((await pending).status).toBe("cancelled");

    const other = await ctl.stage("s2", stage("s2.md", "session two", "att-2"));
    expect(other.status).toBe("ready");
    expect((await ctl.list("s1")).map((item) => item.id)).toEqual(["att-1"]);
    expect((await ctl.list("s2")).map((item) => item.id)).toEqual(["att-2"]);
    expect(JSON.parse(await readFile(join(dir, "input-files", "s1.json"), "utf8")).attachments).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, "input-files", "s2.json"), "utf8")).attachments).toHaveLength(1);
  });

  it("fails closed when the bundled remote host export is missing", async () => {
    const empty = await tempDir("pipi-input-files-runtime-");
    expect(await loadGrokInputFilesRemote(empty)).toBeUndefined();
    const ctl = new InputFilesController(new JsonInputFileStore(empty), undefined, () => grok);
    await expect(ctl.stage("s1", stage())).rejects.toThrow(/未启用文件上传/);
  });

  it("loads createInputFilesService from the bundled host entry", async () => {
    const runtime = await tempDir("pipi-input-files-host-");
    const hostDir = join(runtime, "extensions/grok-build-oauth/agent/dist");
    const authPath = join(runtime, "app-profile", "auth.json");
    const seenPath = join(hostDir, "seen-auth.json");
    await mkdir(hostDir, { recursive: true });
    await writeFile(join(hostDir, "host.js"), `
import { writeFileSync } from "node:fs";
export function createInputFilesService(options) {
  writeFileSync(${JSON.stringify(seenPath)}, JSON.stringify(options ?? null));
  if (!options?.authPath) throw new Error("missing PI agent home");
  return {
    upload: async () => ({ fileId: "file-host", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "d" }),
    remove: async () => undefined,
  };
}
`);
    expect(await loadGrokInputFilesRemote(runtime)).toBeUndefined();
    const remote = await loadGrokInputFilesRemote(runtime, authPath);
    expect(remote).toBeTruthy();
    expect(JSON.parse(await readFile(seenPath, "utf8"))).toEqual({ authPath });
    const uploaded = await remote!.upload({ bytes: new Uint8Array([1]), name: "notes.md" });
    expect(uploaded.fileId).toBe("file-host");
  });

  it("fails closed when createInputFilesService throws", async () => {
    const runtime = await tempDir("pipi-input-files-throw-");
    const hostDir = join(runtime, "extensions/grok-build-oauth/agent/dist");
    await mkdir(hostDir, { recursive: true });
    await writeFile(join(hostDir, "host.js"), `
export function createInputFilesService() {
  throw new Error("PI_CODING_AGENT_DIR is not set");
}
`);
    expect(await loadGrokInputFilesRemote(runtime, join(runtime, "auth.json"))).toBeUndefined();
  });

  it("redacts secrets from errors", () => {
    expect(sanitizeInputFileError(new Error("Bearer at-secret /Users/haoli/a.pdf"))).not.toContain("at-secret");
    expect(sanitizeInputFileError(new Error("Bearer at-secret /Users/haoli/a.pdf"))).not.toContain("/Users/haoli");
  });
});

describe("input files backend handler routing", () => {
  it("routes list/stage/retry/cancel/remove onto the project agent home", async () => {
    const root = await tempDir("pipi-input-files-be-");
    const project = join(root, "project");
    const agentDir = join(root, "app-profile-agent");
    const sessions = join(root, "sessions");
    await mkdir(project, { recursive: true });
    await mkdir(join(sessions, encodeURIComponent(project)), { recursive: true });
    await writeFile(
      join(sessions, encodeURIComponent(project), "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-23T00:00:00.000Z", cwd: project })}\n`,
    );
    let uploads = 0;
    let deletes = 0;
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      inputFilesRemote: {
        upload: async () => {
          uploads += 1;
          if (uploads === 1) throw new Error("transient Bearer at-secret /Users/haoli/x.md");
          return { fileId: "file-be", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "abc" };
        },
        remove: async () => { deletes += 1; },
      },
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };

    await expect(backend.handle("listInputFiles", ["s1"])).resolves.toEqual([]);
    const failed = await backend.handle("stageInputFile", ["s1", stage("/abs/secret/notes.md", "hello files", "att-1")]) as { status: string; error?: string };
    expect(failed.status).toBe("failed");
    expect(failed.error).not.toContain("at-secret");
    const retried = await backend.handle("retryInputFile", ["s1", "att-1"]) as { status: string; fileId?: string };
    expect(retried).toMatchObject({ status: "ready", fileId: "file-be" });
    const listed = await backend.handle("listInputFiles", ["s1"]) as Array<{ id: string }>;
    expect(listed.map((item) => item.id)).toEqual(["att-1"]);

    const stored = join(project, ".pi", "agent", "input-files", "s1.json");
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    const raw = await readFile(stored, "utf8");
    expect(raw).not.toContain("/abs/secret");
    await expect(stat(join(agentDir, "input-files", "s1.json"))).rejects.toMatchObject({ code: "ENOENT" });

    await backend.handle("cancelInputFile", ["s1", "att-1"]);
    await backend.handle("removeInputFile", ["s1", "att-1"]);
    expect(deletes).toBe(1);
    expect(await backend.handle("listInputFiles", ["s1"])).toEqual([]);

    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState.model = claude;
    await expect(backend.handle("stageInputFile", ["s1", stage()])).rejects.toThrow(/不支持文件附件/);

    await backend.close();
  });

  it("fails closed when the remote host module is missing", async () => {
    const root = await tempDir("pipi-input-files-missing-");
    const project = join(root, "project");
    await mkdir(join(root, "sessions", encodeURIComponent(project)), { recursive: true });
    await writeFile(
      join(root, "sessions", encodeURIComponent(project), "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-23T00:00:00.000Z", cwd: project })}\n`,
    );
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };
    await expect(backend.handle("stageInputFile", ["s1", stage()])).rejects.toThrow(/未启用文件上传/);
    await backend.close();
  });

  it("loads the remote with the app-profile auth.json path", async () => {
    const root = await tempDir("pipi-input-files-authpath-");
    const project = join(root, "project");
    const agentDir = join(root, "app-profile-agent");
    const runtime = join(root, "runtime");
    const hostDir = join(runtime, "extensions/grok-build-oauth/agent/dist");
    const seenPath = join(hostDir, "seen-auth.json");
    await mkdir(join(root, "sessions", encodeURIComponent(project)), { recursive: true });
    await mkdir(hostDir, { recursive: true });
    await writeFile(
      join(root, "sessions", encodeURIComponent(project), "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-23T00:00:00.000Z", cwd: project })}\n`,
    );
    await writeFile(join(hostDir, "host.js"), `
import { writeFileSync } from "node:fs";
export function createInputFilesService(options) {
  writeFileSync(${JSON.stringify(seenPath)}, JSON.stringify(options ?? null));
  if (!options?.authPath) throw new Error("missing PI agent home");
  return {
    upload: async () => ({ fileId: "file-auth", name: "notes.md", size: 11, mimeType: "text/markdown", digest: "d" }),
    remove: async () => undefined,
  };
}
`);
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: runtime,
      canonicalProjectPaths: async () => undefined,
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };
    const ready = await backend.handle("stageInputFile", ["s1", stage("/abs/secret/notes.md", "hello files", "att-1")]) as { status: string; fileId?: string };
    expect(ready).toMatchObject({ status: "ready", fileId: "file-auth" });
    expect(JSON.parse(await readFile(seenPath, "utf8"))).toEqual({ authPath: join(agentDir, "auth.json") });
    await backend.close();
  });
});

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEADROOM_ENGINE_VERSION,
  HEADROOM_MANAGED_SETTINGS,
  HEADROOM_SUPERVISOR_SOURCE,
  HEADROOM_UV_VERSION,
  HeadroomManagedRuntime,
  managedHeadroomEnvironment,
  uvAssetFor,
  type ManagedHeadroomOps,
} from "../src/headroom-managed-runtime.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function fakeChild(pid = 4242) {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  });
  child.stdin.on("finish", () => child.kill("SIGTERM"));
  return child;
}

async function readState(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("PipiUI-managed Headroom runtime", () => {
  it("shares one project service, injects only a loopback endpoint, and stops it with the host", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-headroom-managed-"));
    const agentDir = join(root, "app-profile", "pi-agent");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const child = fakeChild();
    const closed = vi.fn(async () => undefined);
    const ops: Partial<ManagedHeadroomOps> = {
      reservePort: vi.fn(async () => ({ port: 43123, close: closed })),
      ensureEngine: vi.fn(async () => join(agentDir, "managed-headroom", "bin", "headroom")),
      spawnProxy: vi.fn(() => child),
      waitUntilReady: vi.fn(async () => true),
    };
    const runtime = new HeadroomManagedRuntime({ agentDir, nodeExecutable: process.execPath, env: {}, ops });

    const [first, second] = await Promise.all([
      runtime.settingsForProject(project),
      runtime.settingsForProject(project),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      [HEADROOM_MANAGED_SETTINGS.baseUrl]: "http://127.0.0.1:43123",
      [HEADROOM_MANAGED_SETTINGS.managed]: true,
      [HEADROOM_MANAGED_SETTINGS.engineVersion]: HEADROOM_ENGINE_VERSION,
    });
    expect(String(first[HEADROOM_MANAGED_SETTINGS.statePath])).toContain(join(project, ".pi", "agent", "headroom"));

    const statePath = String(first[HEADROOM_MANAGED_SETTINGS.statePath]);
    await vi.waitFor(async () => expect((await readState(statePath)).state).toBe("ready"));
    expect(ops.reservePort).toHaveBeenCalledTimes(1);
    expect(ops.ensureEngine).toHaveBeenCalledTimes(1);
    expect(ops.spawnProxy).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);

    await runtime.close();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(await readState(statePath)).toMatchObject({ state: "stopped", engineVersion: HEADROOM_ENGINE_VERSION });
  });

  it("records install failures inside the project instead of breaking session spawn", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-headroom-failed-"));
    const agentDir = join(root, "app-profile", "pi-agent");
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    const runtime = new HeadroomManagedRuntime({
      agentDir,
      ops: {
        reservePort: async () => ({ port: 43124, close: async () => undefined }),
        ensureEngine: async () => { throw new Error("registry offline"); },
      },
    });

    const settings = await runtime.settingsForProject(project);
    const statePath = String(settings[HEADROOM_MANAGED_SETTINGS.statePath]);
    await vi.waitFor(async () => expect((await readState(statePath)).state).toBe("failed"));
    expect(await readState(statePath)).toMatchObject({ error: "registry offline" });
    await runtime.close();
  });

  it("scrubs ambient Headroom/Hugging Face homes and pins project-local writable state", () => {
    const projectAgentDir = "/projects/a/.pi/agent";
    const env = managedHeadroomEnvironment({
      PATH: "/usr/bin:/bin",
      HEADROOM_WORKSPACE_DIR: "/tmp/leak",
      HEADROOM_TELEMETRY: "on",
      HF_HOME: "/tmp/hf",
      ALL_PROXY: "socks5://127.0.0.1:6153",
      all_proxy: "socks5://127.0.0.1:6153",
      HTTP_PROXY: "http://127.0.0.1:6152",
    }, projectAgentDir, 43125);

    expect(env).toMatchObject({
      HEADROOM_WORKSPACE_DIR: join(projectAgentDir, "headroom", "workspace"),
      HEADROOM_CONFIG_DIR: join(projectAgentDir, "headroom", "config"),
      HEADROOM_HOST: "127.0.0.1",
      HEADROOM_PORT: "43125",
      HEADROOM_TELEMETRY: "off",
      HEADROOM_SKIP_UPSTREAM_CHECK: "1",
      HF_HOME: join(projectAgentDir, "headroom", "cache", "huggingface"),
      HTTP_PROXY: "http://127.0.0.1:6152",
    });
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.all_proxy).toBeUndefined();
  });

  it("pins official uv archives for both supported macOS architectures", () => {
    expect(HEADROOM_UV_VERSION).toBe("0.12.5");
    expect(uvAssetFor("darwin", "arm64")).toMatchObject({
      archiveName: "uv-aarch64-apple-darwin.tar.gz",
      sha256: "5bb0e5fe008a773c3dbcb97ff79cd89e1241464fe9d2f986d52ad8f1b037bd62",
    });
    expect(uvAssetFor("darwin", "x64")).toMatchObject({
      archiveName: "uv-x86_64-apple-darwin.tar.gz",
      sha256: "b3b2137477cf96c9686ebfb71524614cec780c673fd73e59bce099aef02e70e8",
    });
    expect(() => uvAssetFor("linux", "x64")).toThrow(/does not support/);
  });

  it("lets the supervisor exit as soon as its proxy child exits", async () => {
    const supervisor = spawn(process.execPath, [
      "-e",
      HEADROOM_SUPERVISOR_SOURCE,
      process.execPath,
      "-e",
      "process.exit(7)",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const status = await new Promise<number | null>((resolveValue, reject) => {
      const timer = setTimeout(() => {
        supervisor.kill("SIGKILL");
        reject(new Error("supervisor did not exit with its child"));
      }, 2_000);
      supervisor.once("error", reject);
      supervisor.once("close", (code) => {
        clearTimeout(timer);
        resolveValue(code);
      });
    });
    expect(status).toBe(7);
  });
});

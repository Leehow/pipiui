import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";
import {
  applySessionMountsToWorkerEnv,
  listSecretMeta,
  resetInMemoryVault,
  workerEnvFromVault,
} from "../src/secret-vault.js";

const FAKE_VALUE = "fake-vault-secret-value";

describe("secret vault host/spawn contract", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    resetInMemoryVault();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), "pipi-vault-host-"));
    const hostProfile = join(root, "pi-agent");
    const project = join(root, "project");
    const sessions = join(root, "sessions", "project");
    await Promise.all([
      mkdir(hostProfile, { recursive: true }),
      mkdir(project, { recursive: true }),
      mkdir(sessions, { recursive: true }),
    ]);
    await writeFile(
      join(sessions, "session.jsonl"),
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-10T00:00:00.000Z",
        cwd: project,
      })}\n`,
    );
    const captured: Array<{ env: NodeJS.ProcessEnv }> = [];
    backend = createPiHostBackend({
      agentDir: hostProfile,
      vaultDir: hostProfile,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      resourceMode: "explicit",
      canonicalProjectPaths: async () => undefined,
      env: { PATH: "/usr/bin:/bin" },
      spawn: (_bin, _args, options) => {
        captured.push({ env: options.env ?? {} });
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });
    return { hostProfile, project, captured };
  }

  it("puts without OS encryption, lists metadata, writes no vault file, and hides DEK from workers", async () => {
    const { hostProfile, project, captured } = await fixture();
    const leftover = join(hostProfile, "secret-vault.json");
    await writeFile(leftover, "{\"version\":1,\"secrets\":[]}");
    const diagnosis = await backend!.handle("diagnoseSecretVault", []);
    expect(diagnosis).toMatchObject({ available: true, kind: "available" });
    expect(JSON.stringify(diagnosis)).toContain("仅保存在当前 App 主进程内存");

    const put = await backend!.handle("putSecretVault", [{
      name: "demo",
      envName: "DEMO_TOKEN",
      value: FAKE_VALUE,
      sessionId: "session-1",
    }]) as { secret: { id: string; envName: string } };
    const listed = await backend!.handle("listSecretVault", ["session-1"]) as {
      secrets: Array<{ id: string; name: string; envName: string }>;
      mounts: Array<{ envName: string }>;
    };
    expect(listed.secrets).toEqual([expect.objectContaining({
      id: put.secret.id,
      name: "demo",
      envName: "DEMO_TOKEN",
    })]);
    expect(listed.mounts).toEqual([expect.objectContaining({ envName: "DEMO_TOKEN" })]);
    expect(JSON.stringify(listed)).not.toContain(FAKE_VALUE);
    expect(listSecretMeta(hostProfile).map((item) => item.envName)).toEqual(["DEMO_TOKEN"]);
    expect(existsSync(leftover)).toBe(true);
    expect(await (await import("node:fs/promises")).readFile(leftover, "utf8")).toBe("{\"version\":1,\"secrets\":[]}");
    expect(existsSync(join(hostProfile, "secret-vault-dek.sealed"))).toBe(false);
    expect(existsSync(join(projectPiAgentDir(project), "secret-vault.json"))).toBe(false);
    expect(existsSync(join(project, "secret-vault.json"))).toBe(false);

    await backend!.handle("compact", ["session-1"]);
    const main = captured.find((item) => item.env.PIPIUI_SESSION_KEY === "session-1") ?? captured[0];
    expect(main).toBeTruthy();
    expect(main!.env.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(main!.env.DEMO_TOKEN).toBe(FAKE_VALUE);
    expect(main!.env.PI_CODING_AGENT_DIR).toBe(projectPiAgentDir(await realpath(project)));

    const worker = applySessionMountsToWorkerEnv(main!.env, workerEnvFromVault(hostProfile, "session-1"));
    expect(worker.DEMO_TOKEN).toBe(FAKE_VALUE);
    expect(worker.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(worker.PIPIUI_SECRET_VAULT_DEK).toBeUndefined();
  });

  it("lets host put/list the same in-memory vault when no safeStorage provider exists", async () => {
    const { hostProfile, project } = await fixture();
    await backend!.handle("getSessionLease", ["session-1"]);
    const put = await backend!.handle("putSecretVault", [{
      name: "host",
      envName: "HOST_TOKEN",
      value: FAKE_VALUE,
      sessionId: "session-1",
    }]) as { secret: { id: string; envName: string } };
    expect(put.secret.envName).toBe("HOST_TOKEN");
    const listed = await backend!.handle("listSecretVault", ["session-1"]) as {
      secrets: Array<{ envName: string }>;
      mounts: Array<{ envName: string }>;
    };
    expect(listed.secrets).toEqual([expect.objectContaining({ envName: "HOST_TOKEN" })]);
    expect(listed.mounts).toEqual([expect.objectContaining({ envName: "HOST_TOKEN" })]);
    expect(JSON.stringify(listed)).not.toContain(FAKE_VALUE);
    expect(existsSync(join(hostProfile, "secret-vault.json"))).toBe(false);
    expect(existsSync(join(projectPiAgentDir(project), "secret-vault.json"))).toBe(false);
  });

  it("rewrites the latest user JSONL after put and emits secret_redact without plaintext", async () => {
    const fake = "vault-test-secret-AAAA";
    const { project } = await fixture();
    const sessionFile = join(root, "sessions", "project", "session.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-10T00:00:00.000Z",
        cwd: project,
      }),
      JSON.stringify({
        type: "message",
        id: "u-hex",
        parentId: null,
        timestamp: "2026-08-10T00:00:01.000Z",
        message: { role: "user", content: `再给你 ${fake}` },
      }),
      JSON.stringify({
        type: "message",
        id: "a-hex",
        parentId: "u-hex",
        timestamp: "2026-08-10T00:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: `echo ${fake}` }] },
      }),
    ].join("\n") + "\n");
    const events: Array<{ type?: string; messages?: Array<{ id: string; content: string }> }> = [];
    const off = backend!.subscribe((frame) => {
      if (frame.channel === "stream") events.push(frame.event as { type?: string; messages?: Array<{ id: string; content: string }> });
    });
    await backend!.handle("putSecretVault", [{
      name: "cstcloud",
      envName: "CSTCLOUD_API_KEY",
      value: fake,
      sessionId: "session-1",
    }]);
    off();
    const jsonl = await readFile(sessionFile, "utf8");
    expect(jsonl).not.toContain(fake);
    expect(jsonl).toContain("{{secret:CSTCLOUD_API_KEY}}");
    const history = await backend!.handle("getSessionHistory", ["session-1"]) as Array<{ id: string; content: string }>;
    expect(JSON.stringify(history)).not.toContain(fake);
    expect(history.find((entry) => entry.id === "u-hex")?.content).toBe("再给你 {{secret:CSTCLOUD_API_KEY}}");
    expect(history.find((entry) => entry.id === "a-hex")?.content).toBe("echo {{secret:CSTCLOUD_API_KEY}}");
    const redact = events.find((event) => event.type === "secret_redact");
    expect(redact?.messages?.some((message) => message.id === "u-hex" && message.content.includes("{{secret:CSTCLOUD_API_KEY}}"))).toBe(true);
    expect(JSON.stringify(redact)).not.toContain(fake);
  });

  it("keeps the parent Pi alive after settle when a vault redact is pending and a worker is still running", async () => {
    const { project } = await fixture();
    await backend!.handle("addProject", [project]);
    await backend!.handle("putSecretVault", [{
      name: "demo",
      envName: "DEMO_TOKEN",
      value: FAKE_VALUE,
      sessionId: "session-1",
    }]);
    await backend!.handle("sendPrompt", ["session-1", "__agent_running__"]);
    const running = await waitForAgentState(backend!, "agent-1", "running");
    expect(running?.state).toBe("running");
    const firstPid = liveSessionPid(backend!);
    expect(firstPid).toEqual(expect.any(Number));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(liveSessionPid(backend!)).toBe(firstPid);
    await expect(backend!.handle("listAgents", ["session-1"])).resolves.toEqual([
      expect.objectContaining({ agentId: "agent-1", state: "running" }),
    ]);
  });

  it("redacts a live session JSONL after put without stopping a running worker's parent Pi", async () => {
    const fake = "vault-test-secret-BBBB";
    const { project } = await fixture();
    const sessionFile = join(root, "sessions", "project", "session.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "session-1",
        timestamp: "2026-08-10T00:00:00.000Z",
        cwd: project,
      }),
      JSON.stringify({
        type: "message",
        id: "u-hex",
        parentId: null,
        timestamp: "2026-08-10T00:00:01.000Z",
        message: { role: "user", content: `再给你 ${fake}` },
      }),
    ].join("\n") + "\n");
    await backend!.handle("addProject", [project]);
    await backend!.handle("sendPrompt", ["session-1", "__agent_running__"]);
    expect((await waitForAgentState(backend!, "agent-1", "running"))?.state).toBe("running");
    const firstPid = liveSessionPid(backend!);
    expect(firstPid).toEqual(expect.any(Number));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await backend!.handle("putSecretVault", [{
      name: "cstcloud",
      envName: "CSTCLOUD_API_KEY",
      value: fake,
      sessionId: "session-1",
    }]);
    expect(liveSessionPid(backend!)).toBe(firstPid);
    await expect(backend!.handle("listAgents", ["session-1"])).resolves.toEqual([
      expect.objectContaining({ agentId: "agent-1", state: "running" }),
    ]);
    const history = await waitForRedactedHistory(backend!, fake);
    expect(JSON.stringify(history)).not.toContain(fake);
    expect(history.some((entry) => entry.content.includes("{{secret:CSTCLOUD_API_KEY}}"))).toBe(true);
  });
});

async function waitForAgentState(
  host: { handle(method: string, params: unknown[]): Promise<unknown> },
  agentId: string,
  state: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const agent = ((await host.handle("listAgents", ["session-1"])) as Array<{ agentId: string; state: string }>)
      .find((row) => row.agentId === agentId);
    if (agent?.state === state) return agent;
    if (Date.now() > deadline) return agent;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForRedactedHistory(
  host: { handle(method: string, params: unknown[]): Promise<unknown> },
  plaintext: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  let history: Array<{ content: string }> = [];
  for (;;) {
    history = (await host.handle("getSessionHistory", ["session-1"])) as Array<{ content: string }>;
    if (JSON.stringify(history).includes("{{secret:CSTCLOUD_API_KEY}}") && !JSON.stringify(history).includes(plaintext)) {
      return history;
    }
    if (Date.now() > deadline) return history;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function liveSessionPid(host: object): number | undefined {
  const live = (host as {
    live: Map<string, { process?: { pid?: number; exitCode: number | null }; exiting?: boolean }>;
  }).live.get("session-1");
  if (!live?.process || live.exiting || live.process.exitCode !== null) return undefined;
  return live.process.pid;
}

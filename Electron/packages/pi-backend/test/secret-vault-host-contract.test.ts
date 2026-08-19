import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
});

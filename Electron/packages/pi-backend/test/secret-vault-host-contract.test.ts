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
  configureVaultKeyProvider,
  listSecretMeta,
  memoryKeyProvider,
  putSecret,
  vaultDiagnosisFor,
} from "../src/secret-vault.js";

const FAKE_DEK = Buffer.alloc(32, 11);
const FAKE_VALUE = "fake-vault-secret-value";

describe("secret vault host/spawn contract", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    configureVaultKeyProvider(undefined);
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
    const provider = memoryKeyProvider(FAKE_DEK);
    backend = createPiHostBackend({
      agentDir: hostProfile,
      vaultDir: hostProfile,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      resourceMode: "explicit",
      vaultKeyProvider: provider,
      vaultAvailability: () => vaultDiagnosisFor("available"),
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

  it("keeps DEK on main spawn, hides it from workers, and shares one App-profile vault", async () => {
    const { hostProfile, project, captured } = await fixture();
    const diagnosis = await backend!.handle("diagnoseSecretVault", []);
    expect(diagnosis).toMatchObject({ available: true, kind: "available" });
    expect(JSON.stringify(diagnosis)).not.toMatch(/unavailable/i);

    await backend!.handle("compact", ["session-1"]);
    const main = captured.find((item) => item.env.PIPIUI_SESSION_KEY === "session-1") ?? captured[0];
    expect(main).toBeTruthy();
    expect(main!.env.PIPIUI_VAULT_DEK).toBe(FAKE_DEK.toString("base64"));
    expect(main!.env.PIPIUI_SECRET_VAULT_DIR).toBe(hostProfile);
    expect(main!.env.PI_CODING_AGENT_DIR).toBe(projectPiAgentDir(await realpath(project)));
    expect(main!.env.PIPIUI_SECRET_VAULT_DIR).not.toBe(main!.env.PI_CODING_AGENT_DIR);

    const worker = applySessionMountsToWorkerEnv(main!.env, {});
    expect(worker.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(worker.PIPIUI_SECRET_VAULT_DEK).toBeUndefined();
    expect(worker.PIPIUI_SECRET_VAULT_DIR).toBe(hostProfile);

    configureVaultKeyProvider(memoryKeyProvider(FAKE_DEK));
    const put = await putSecret(main!.env.PIPIUI_SECRET_VAULT_DIR!, {
      name: "demo",
      envName: "DEMO_TOKEN",
      value: FAKE_VALUE,
    });
    const listed = await backend!.handle("listSecretVault", ["session-1"]) as {
      secrets: Array<{ id: string; name: string; envName: string }>;
    };
    expect(listed.secrets).toEqual([expect.objectContaining({
      id: put.id,
      name: "demo",
      envName: "DEMO_TOKEN",
    })]);
    expect(JSON.stringify(listed)).not.toContain(FAKE_VALUE);
    expect(listSecretMeta(hostProfile).map((item) => item.envName)).toEqual(["DEMO_TOKEN"]);
    expect(existsSync(join(hostProfile, "secret-vault.json"))).toBe(true);
    expect(existsSync(join(projectPiAgentDir(project), "secret-vault.json"))).toBe(false);
    expect(existsSync(join(project, "secret-vault.json"))).toBe(false);
  });

  it("lets host put/list the same canonical vault when encryption is available", async () => {
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
    expect(existsSync(join(hostProfile, "secret-vault.json"))).toBe(true);
    expect(existsSync(join(projectPiAgentDir(project), "secret-vault.json"))).toBe(false);
  });
});

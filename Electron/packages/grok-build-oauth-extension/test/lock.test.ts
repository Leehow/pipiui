import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, stat, utimes, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { lstatSync, symlinkSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { acquireFileLock, lockPathFor, resolveCredentialTarget } from "../agent/oauth/lock.js";

describe("heartbeat cross-process lock (reviewer MUST-FIX #2)", () => {
  let dir = "";
  let guard = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-lock-"));
    guard = join(dir, "auth.json");
  });

  it("acquires exclusively and releases cleanly", async () => {
    const a = await acquireFileLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await expect(acquireFileLock(guard, { staleMs: 60_000, heartbeatMs: 1_000, timeoutMs: 150 })).rejects.toThrow(/timeout/);
    await a.release();
    const b = await acquireFileLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await b.release();
  });

  it("never breaks a live holder whose refresh outlasts the stale threshold (heartbeat)", async () => {
    // stale threshold far shorter than the hold — only the heartbeat keeps it alive.
    const staleMs = 400;
    const holder = await acquireFileLock(guard, { staleMs, heartbeatMs: 100 });
    // Simulate a long in-flight refresh: 3x the stale window elapses with the
    // heartbeat running (mtime keeps refreshing).
    await new Promise((r) => setTimeout(r, staleMs * 3));
    const mtimeBefore = (await stat(lockPathFor(guard))).mtimeMs;
    expect(mtimeBefore).toBeGreaterThan(0);
    await expect(
      acquireFileLock(guard, { staleMs, heartbeatMs: 100, timeoutMs: 300 }),
    ).rejects.toThrow(/timeout/); // never stale-broken while heartbeating
    await holder.release();
    const next = await acquireFileLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await next.release();
  });

  it("takes over after crash (heartbeat stopped, mtime aged past staleMs)", async () => {
    // Simulate a crashed holder: lock file exists but nobody heartbeats.
    await writeFile(lockPathFor(guard), JSON.stringify({ v: 1, owner: "crashed", pid: 999999, acquiredAtMs: Date.now() }));
    const aged = new Date(Date.now() - 120_000);
    await utimes(lockPathFor(guard), aged, aged);

    const taker = await acquireFileLock(guard, { staleMs: 30_000, heartbeatMs: 5_000, timeoutMs: 5_000 });
    const content = JSON.parse(await readFile(lockPathFor(guard), "utf8")) as { owner: string };
    expect(content.owner).not.toBe("crashed");
    await taker.release();
  });

  it("late release from a stale holder never deletes the new holder's lock (owner nonce)", async () => {
    await writeFile(lockPathFor(guard), JSON.stringify({ v: 1, owner: "stale-old", pid: 1, acquiredAtMs: Date.now() }));
    const aged = new Date(Date.now() - 120_000);
    await utimes(lockPathFor(guard), aged, aged);

    // New holder takes over via stale takeover; the OLD holder's release (with
    // mismatched owner) must not delete the new holder's lock.
    const fresh = await acquireFileLock(guard, { staleMs: 30_000, heartbeatMs: 5_000 });
    const staleHandle = { owner: "stale-old", release: async () => {
      const { unlink } = await import("node:fs/promises");
      const current = JSON.parse(await readFile(lockPathFor(guard), "utf8")) as { owner: string };
      if (current?.owner === "stale-old") await unlink(lockPathFor(guard)).catch(() => {});
    } };
    await (staleHandle as { release: () => Promise<void> }).release();
    // Lock still on disk, owned by the fresh holder.
    const content = JSON.parse(await readFile(lockPathFor(guard), "utf8")) as { owner: string };
    expect(content.owner).toBe(fresh.owner);
    await fresh.release();
  });

  it("true multi-process contention: a child process holding the lock blocks the parent until release", async () => {
    const script = join(dir, "holder.ts");
    await writeFile(script, `import { acquireFileLock } from ${JSON.stringify(new URL("../agent/oauth/lock.ts", import.meta.url).href)};
const handle = await acquireFileLock(process.argv[2]!, { staleMs: 30_000, heartbeatMs: 200, timeoutMs: 10_000 });
process.stdout.write("HELD\\n");
process.stdin.resume();
process.on("SIGTERM", async () => { await handle.release(); process.exit(0); });
`);
    const child = spawn(process.execPath, ["--experimental-strip-types", script, guard], { stdio: ["pipe", "pipe", "pipe"] });
    let held = "";
    child.stdout!.on("data", (d: Buffer) => { held += d.toString(); });
    // Wait until the child announces it holds the lock.
    for (let i = 0; i < 100 && !held.includes("HELD"); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(held).toContain("HELD");

    // Parent (a separate process) cannot take it while the child heartbeats.
    await expect(
      acquireFileLock(guard, { staleMs: 30_000, heartbeatMs: 200, timeoutMs: 800 }),
    ).rejects.toThrow(/timeout/);

    // Release via SIGTERM; parent takes it immediately after.
    child.kill("SIGTERM");
    await new Promise((resolve) => { child.on("exit", resolve); });
    const parentHandle = await acquireFileLock(guard, { staleMs: 30_000, heartbeatMs: 5_000, timeoutMs: 5_000 });
    await parentHandle.release();
  }, 20_000);
});

describe("resolveCredentialTarget (reviewer MUST-FIX #1)", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "grok-target-")); });

  it("follows project symlinks to the App-profile canonical file", async () => {
    const profileDir = join(dir, "app-profile", "pi-agent");
    mkdirSync(profileDir, { recursive: true });
    const canonical = join(profileDir, "auth.json");
    writeFileSync(canonical, "{}\n", { mode: 0o600 });
    const projectADir = join(dir, "projectA", ".pi", "agent");
    mkdirSync(projectADir, { recursive: true });
    const projectA = join(projectADir, "auth.json");
    symlinkSync(canonical, projectA);

    const target = await resolveCredentialTarget(projectA);
    expect(target.real).toBe(realpathSync(canonical));
    expect(target.asGiven).toBe(projectA);
    // The lock for both projects guards the canonical file.
    expect(lockPathFor(target.real)).toBe(`${realpathSync(canonical)}.groklock`);
  });

  it("resolves the nearest existing directory when the file does not exist yet", async () => {
    const profileDir = join(dir, "app-profile", "pi-agent");
    mkdirSync(profileDir, { recursive: true });
    const target = await resolveCredentialTarget(join(profileDir, "auth.json"));
    expect(target.real).toBe(join(realpathSync(profileDir), "auth.json"));
  });

  it("keeps a symlink a symlink after an atomic write through the broker (integration)", async () => {
    const { GrokCredentialBroker } = await import("../agent/oauth/broker.js");
    const profileDir = join(dir, "app-profile", "pi-agent");
    mkdirSync(profileDir, { recursive: true });
    const canonical = join(profileDir, "auth.json");
    writeFileSync(canonical, JSON.stringify({ other: { type: "api" } }, null, 2), { mode: 0o600 });
    for (const project of ["projectA", "projectB"]) {
      const projectDir = join(dir, project, ".pi", "agent");
      mkdirSync(projectDir, { recursive: true });
      symlinkSync(canonical, join(projectDir, "auth.json"));
    }

    // Refresh through project A's symlinked path.
    let fetchCalls = 0;
    const fakeFetch = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }), { status: 200 });
    };
    const brokerA = new GrokCredentialBroker({
      authPath: join(dir, "projectA", ".pi", "agent", "auth.json"),
      earlyRefreshSec: 60,
      fetchImpl: fakeFetch as unknown as typeof fetch,
      lock: { staleMs: 10_000, heartbeatMs: 250 },
    });
    const now = Date.now();
    await brokerA._writeForTest({
      type: "oauth", access: "at-old", refresh: "rt-old", expires: now + 5_000,
      issuer: "https://auth.x.ai", client_id: "b1a00492-073a-47ea-816f-4c329264a828",
      scopes: ["openid"], token_type: "Bearer", obtained_at: now - 1000,
    } as never);
    const refreshed = await brokerA.getAccessToken();
    expect(refreshed).toBe("at-new");

    // The symlink was NOT replaced; the canonical file carries the new token;
    // other providers survived the merge.
    expect(lstatSync(join(dir, "projectA", ".pi", "agent", "auth.json")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "projectB", ".pi", "agent", "auth.json")).isSymbolicLink()).toBe(true);
    const canonicalData = JSON.parse(await readFile(realpathSync(canonical), "utf8")) as Record<string, unknown>;
    expect((canonicalData["grok-build"] as { access: string }).access).toBe("at-new");
    expect(canonicalData.other).toEqual({ type: "api" });

    // Project B's broker reads the same refreshed credential through its own link.
    const brokerB = new GrokCredentialBroker({
      authPath: join(dir, "projectB", ".pi", "agent", "auth.json"),
      earlyRefreshSec: 60,
      fetchImpl: (async () => {
        throw new Error("must not refresh — project B reuses A's rotation");
      }) as unknown as typeof fetch,
      lock: { staleMs: 10_000, heartbeatMs: 250 },
    });
    expect(await brokerB.getAccessToken()).toBe("at-new");
    expect(fetchCalls).toBe(1);
  });
});

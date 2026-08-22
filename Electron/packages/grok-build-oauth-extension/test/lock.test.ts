import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, utimes, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { lstatSync, symlinkSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { acquireCredentialLock, acquireAuthStoreLocks, lockPathFor, resolveCredentialTarget } from "../agent/oauth/lock.js";

/**
 * The broker lock speaks proper-lockfile's ON-DISK format (pi's
 * FileAuthStorageBackend — the store behind ModelRuntime login/logout — locks
 * `auth.json` with `proper-lockfile`'s mkdir `<path>.lock`). These tests prove
 * the wire-level interop against the REAL library and against pi's real
 * AuthStorage/FileAuthStorageBackend.
 */
const nodeRequire = createRequire(import.meta.url);

async function loadProperLockfile(): Promise<typeof import("proper-lockfile") | undefined> {
  try {
    return (await import("proper-lockfile")) as typeof import("proper-lockfile");
  } catch {
    return undefined;
  }
}

type PiAuthStorageModule = {
  AuthStorage: { create(authPath?: string): unknown };
};
async function loadPiAuthStorage(): Promise<PiAuthStorageModule | undefined> {
  try {
    const indexJs = nodeRequire.resolve("@earendil-works/pi-coding-agent");
    const { pathToFileURL } = await import("node:url");
    const deep = pathToFileURL(join(dirname(indexJs), "core", "auth-storage.js")).href;
    return (await import(deep)) as PiAuthStorageModule;
  } catch {
    return undefined;
  }
}

describe("proper-lockfile wire-format lock (round-2 Critical #1)", () => {
  let dir = "";
  let guard = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ""; });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "grok-lock-"));
    guard = join(dir, "auth.json");
  });

  it("uses the proper-lockfile lock DIRECTORY path (<auth.json>.lock)", async () => {
    expect(lockPathFor(guard)).toBe(`${guard}.lock`);
    const handle = await acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    const st = await stat(lockPathFor(guard));
    expect(st.isDirectory()).toBe(true);
    await handle.release();
    await expect(stat(lockPathFor(guard))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("acquires exclusively and releases cleanly", async () => {
    const a = await acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await expect(acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 1_000, timeoutMs: 150 })).rejects.toThrow(/timeout/);
    await a.release();
    const b = await acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await b.release();
  });

  it("never breaks a live holder whose refresh outlasts the stale threshold (heartbeat)", async () => {
    // stale threshold far shorter than the hold — only the heartbeat keeps it alive.
    const staleMs = 1_200;
    const holder = await acquireCredentialLock(guard, { staleMs, heartbeatMs: 200 });
    await new Promise((r) => setTimeout(r, staleMs * 3));
    await expect(
      acquireCredentialLock(guard, { staleMs, heartbeatMs: 200, timeoutMs: 400 }),
    ).rejects.toThrow(/timeout/); // never stale-broken while heartbeating
    await holder.release();
    const next = await acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 1_000 });
    await next.release();
  });

  it("takes over after crash (heartbeat stopped, lock dir mtime aged past staleMs)", async () => {
    // Simulate a crashed holder: lock dir exists but nobody heartbeats.
    await mkdir(lockPathFor(guard));
    const aged = new Date(Date.now() - 120_000);
    await utimes(lockPathFor(guard), aged, aged);

    const taker = await acquireCredentialLock(guard, { staleMs: 30_000, heartbeatMs: 5_000, timeoutMs: 5_000 });
    taker.assertValid();
    await taker.release();
  });

  it("late release from a taken-over holder never deletes the new holder's lock (mtime check)", async () => {
    // Holder whose heartbeat is effectively off (long interval), then a
    // takeover happens underneath it; its late release must keep its mtime
    // check and never rmdir the new holder's lock.
    const victim = await acquireCredentialLock(guard, { staleMs: 60_000, heartbeatMs: 60_000 });
    const aged = new Date(Date.now() - 120_000);
    await utimes(lockPathFor(guard), aged, aged);
    const winner = await acquireCredentialLock(guard, { staleMs: 30_000, heartbeatMs: 5_000, timeoutMs: 5_000 });
    await victim.release(); // mtime no longer its own — must NOT rmdir
    const st = await stat(lockPathFor(guard));
    expect(st.isDirectory()).toBe(true); // winner's lock survived
    await winner.release();
    await expect(stat(lockPathFor(guard))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("true multi-process contention: a child process holding the lock blocks the parent until release", async () => {
    const script = join(dir, "holder.mjs");
    await writeFile(script, `import { acquireCredentialLock } from ${JSON.stringify(new URL("../agent/oauth/lock.ts", import.meta.url).href)};
const handle = await acquireCredentialLock(process.argv[2]!, { staleMs: 30_000, heartbeatMs: 200, timeoutMs: 10_000 });
process.stdout.write("HELD\\n");
process.stdin.resume();
process.on("disconnect", () => { try { process.exit(0); } catch {} });
`, "utf8");
    const child = spawn(process.execPath, ["--experimental-strip-types", script, guard], { stdio: ["pipe", "pipe", "inherit"] });
    try {
      const held = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("child never held the lock")), 8_000);
        child.stdout!.on("data", (d) => { clearTimeout(t); resolve(String(d)); });
        child.on("exit", (c) => { clearTimeout(t); reject(new Error(`child exited ${c}`)); });
      });
      expect(held).toContain("HELD");
      await expect(
        acquireCredentialLock(guard, { staleMs: 30_000, heartbeatMs: 200, timeoutMs: 800 }),
      ).rejects.toThrow(/timeout/);
    } finally {
      child.kill();
      await new Promise((r) => child.on("exit", r));
    }
    const parentHandle = await acquireCredentialLock(guard, { staleMs: 30_000, heartbeatMs: 5_000, timeoutMs: 5_000 });
    await parentHandle.release();
  }, 20_000);

  describe("interop with the REAL proper-lockfile (pi FileAuthStorageBackend's lock)", () => {
    it("broker lock excludes proper-lockfile and vice versa (same wire format)", async () => {
      const lockfile = await loadProperLockfile();
      if (!lockfile) return; // transitive dep unavailable in this install
      const guard2 = join(dir, "auth2.json");
      // proper-lockfile holds — broker must wait.
      const releaseP = await lockfile.lock(guard2, { realpath: false, retries: 0, stale: 30_000 });
      await expect(acquireCredentialLock(guard2, { staleMs: 45_000, timeoutMs: 300 })).rejects.toThrow(/timeout/);
      await releaseP();
      // broker holds — proper-lockfile must see ELOCKED.
      const handle = await acquireCredentialLock(guard2, { staleMs: 45_000, heartbeatMs: 1_000 });
      await expect(lockfile.lock(guard2, { realpath: false, retries: 0, stale: 30_000 })).rejects.toMatchObject({ code: "ELOCKED" });
      await handle.release();
      // and proper-lockfile can take it again
      const release2 = await lockfile.lock(guard2, { realpath: false, retries: 0, stale: 30_000 });
      await release2();
    });
  });

  describe("acquireAuthStoreLocks — real target + as-given path (session pi locks its own path)", () => {
    it("locks both <real>.lock and <asGiven>.lock in a fixed order", async () => {
      const projectDir = join(dir, "projectA", ".pi", "agent");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(dir, "auth.json"), "{}\n");
      symlinkSync(join(dir, "auth.json"), join(projectDir, "auth.json"));
      const asGiven = join(projectDir, "auth.json");
      const locks = await acquireAuthStoreLocks(await resolveCredentialTarget(asGiven), { staleMs: 60_000, heartbeatMs: 1_000 });
      // both lock dirs exist while held
      expect((await stat(lockPathFor(realpathSync(join(dir, "auth.json"))))).isDirectory()).toBe(true);
      expect((await stat(lockPathFor(asGiven))).isDirectory()).toBe(true);
      await locks.release();
      await expect(stat(lockPathFor(asGiven))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(lockPathFor(realpathSync(join(dir, "auth.json"))))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
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
    // The lock guards the CANONICAL file — the same lock the host
    // ModelRuntime's FileAuthStorageBackend takes on its canonical authPath.
    expect(lockPathFor(target.real)).toBe(`${realpathSync(canonical)}.lock`);
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

  it("no .groklock exists anywhere — the only lock is the shared proper-lockfile one", async () => {
    const { GrokCredentialBroker } = await import("../agent/oauth/broker.js");
    const authPath = join(dir, "auth.json");
    const broker = new GrokCredentialBroker({ authPath, fetchImpl: (async () => { throw new Error("no network"); }) as unknown as typeof fetch });
    const now = Date.now();
    await broker._writeForTest({
      type: "oauth", access: "at", refresh: "rt", expires: now + 3600_000,
      issuer: "https://auth.x.ai", client_id: "c", scopes: ["openid"], token_type: "Bearer", obtained_at: now,
    } as never);
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(dir));
    expect(entries.some((e) => e.includes("groklock"))).toBe(false);
    expect(entries).toContain("auth.json.lock");
  });
});

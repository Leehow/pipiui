import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";
import {
  appendLedgerRecord,
  latestContextBySession,
  ledgerLine,
  parseLedgerLine,
  readLedgerFile,
  type LedgerContextRecord,
} from "../src/token-ledger.js";

const record: LedgerContextRecord = {
  ts: "2026-08-10T00:00:05.000Z",
  session: "session-1",
  channel: "main",
  depth: 0,
  model: "fake/fake-1",
  turn: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 15000,
  contextWindow: 262144,
};

describe("token-ledger format (Swift TokenLedger parity)", () => {
  it("serializes one Swift-shaped JSON line with sorted keys and the Electron-only contextWindow", () => {
    const line = ledgerLine(record);
    expect(line.endsWith("\n")).toBe(true);
    const obj = JSON.parse(line.trim());
    // Swift's Record fields, all present with the same names.
    expect(obj).toMatchObject({
      ts: "2026-08-10T00:00:05.000Z",
      session: "session-1",
      channel: "main",
      depth: 0,
      model: "fake/fake-1",
      turn: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 15000,
      contextWindow: 262144,
    });
    expect(Object.keys(obj)).toEqual([...Object.keys(obj)].sort());
  });

  it("round-trips through parseLedgerLine and drops malformed lines", () => {
    expect(parseLedgerLine(ledgerLine(record))).toEqual(record);
    expect(parseLedgerLine("not-json")).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ type: "session", id: "x" }))).toBeNull();
    expect(parseLedgerLine("")).toBeNull();
    // A Swift-written record without contextWindow still parses.
    const swiftOnly = parseLedgerLine(
      JSON.stringify({ ...record, contextWindow: undefined }) + "\n",
    );
    expect(swiftOnly?.contextWindow).toBeUndefined();
  });

  it("latestContextBySession picks the newest main-channel record per session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipi-ledger-unit-"));
    const file = join(dir, "pipiui-token-ledger.jsonl");
    await appendLedgerRecord(file, { ...record, ts: "2026-08-10T00:00:04.000Z", contextTokens: 1000 });
    await appendLedgerRecord(file, { ...record, ts: "2026-08-10T00:00:06.000Z", contextTokens: 2000 });
    await appendLedgerRecord(file, { ...record, session: "session-1", ts: "2026-08-10T00:00:07.000Z", contextTokens: 3000, channel: "subagent" });
    await appendLedgerRecord(file, { ...record, session: "other", ts: "2026-08-10T00:00:08.000Z", contextTokens: 42, contextWindow: 128000 });
    const latest = latestContextBySession(await readLedgerFile(file));
    expect(latest.get("session-1")).toEqual({ tokens: 2000, contextWindow: 262144, percent: 2000 / 262144 * 100 });
    expect(latest.get("other")).toEqual({ tokens: 42, contextWindow: 128000, percent: 42 / 128000 * 100 });
    await rm(dir, { recursive: true, force: true });
  });

  it("reports null percent when the latest record has no window (Swift-written)", () => {
    const latest = latestContextBySession([
      { ...record, contextWindow: undefined },
    ]);
    expect(latest.get("session-1")).toEqual({ tokens: 15000, percent: null });
  });
});

describe("per-session last-known context persistence", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function sessionBackend(agent: string, sessions: string) {
    return createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: (_bin: any, _args: any, options: any) =>
        spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
  }

  async function writeSession(id: string, cwd: string, sessions: string) {
    const dir = join(sessions, "--project--");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.jsonl`), JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
  }

  async function waitForFileContaining(file: string, needle: string, timeoutMs = 3000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      try {
        last = await readFile(file, "utf8");
        if (last.includes(needle)) return last;
      } catch { /* not written yet */ }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`ledger file never contained ${needle}:\n${last}`);
  }

  it("writes observed live context to pipiui-token-ledger.jsonl (Swift line format)", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ledger-write-"));
    const agent = join(root, "agent");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    await writeSession("session-1", cwd, sessions);
    const backend = await sessionBackend(agent, sessions);
    await backend.handle("sendPrompt", ["session-1", "hello"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stats = await backend.handle("getSessionStats", ["session-1"]) as any;
    expect(stats.contextUsage).toMatchObject({ tokens: 15000, contextWindow: 262144, percent: 5.7 });

    const ledger = join(agent, "pipiui-token-ledger.jsonl");
    const text = await waitForFileContaining(ledger, '"contextTokens":15000');
    expect(text).toContain('"session":"session-1"');
    expect(text).toContain('"channel":"main"');
    expect(text).toContain('"contextWindow":262144');
    expect(text).toContain('"model":"fake/fake-1"');
  });

  it("restores per-session last-known context on a cold host when live stats omit usage", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ledger-restore-"));
    const agent = join(root, "agent");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    await writeSession("session-1", cwd, sessions);

    // First host observes a live context sample and persists it.
    const first = await sessionBackend(agent, sessions);
    await first.handle("sendPrompt", ["session-1", "hello"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await first.handle("getSessionStats", ["session-1"]);
    const ledger = join(agent, "pipiui-token-ledger.jsonl");
    await waitForFileContaining(ledger, '"contextTokens":15000');
    await first.close();

    // A fresh host (cold restart) rehydrates from the ledger: when pi omits
    // contextUsage, the snapshot falls back to the last-known per-session value.
    const second = await sessionBackend(agent, sessions);
    await second.handle("sendPrompt", ["session-1", "no-usage"]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const restored = await second.handle("getSessionStats", ["session-1"]) as any;
    expect(restored.contextUsage).toMatchObject({ tokens: 15000, contextWindow: 262144 });
    // Percent is re-derived from tokens/window after rehydration (Swift does the same).
    expect(restored.contextUsage.percent).toBeCloseTo(15000 / 262144 * 100, 3);
  });

  it("returns a cold session's ledger snapshot without waiting for Pi", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ledger-cache-first-"));
    const agent = join(root, "agent");
    const sessions = join(root, "sessions");
    const cwd = join(root, "project");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSession("session-1", cwd, sessions);
    await appendLedgerRecord(join(agent, "pipiui-token-ledger.jsonl"), record);

    // A Pi child that never answers any RPC makes the old implementation hang.
    // The cached context must still resolve without waiting for that child.
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: (_bin: any, _args: any, options: any) =>
        spawn("/usr/local/bin/node", ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));setInterval(()=>{},1000)"], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });

    const outcome = await Promise.race([
      backend.handle("getSessionStats", ["session-1"]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("waited for Pi")), 250)),
    ]) as any;
    expect(outcome).toMatchObject({
      sessionId: "session-1",
      contextUsage: { tokens: 15000, contextWindow: 262144 },
    });
    await backend.close();
  });
});

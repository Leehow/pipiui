import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  actionableContextChanged,
  buildActionCall,
  CUA_DRIVER_VERSION,
  cuaSocketPath,
  cuaToolFailureCode,
  CuaDriverHost,
  isDriverSessionEndedError,
  selectLaunchWindow,
} from "./cua-driver-host.js";
import { ComputerWorkerBroker } from "../../../../../Sources/PipiUI/PiExt/packages/computer-agent/src/worker-broker.ts";

describe("CuaDriverHost", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("pins the largest app content window instead of a thin title-bar surface", () => {
    expect(
      selectLaunchWindow(
        [
          { pid: 42, window_id: 7, bounds: { x: 0, y: 0, width: 1512, height: 33 } },
          { pid: 42, window_id: 8, bounds: { x: 20, y: 40, width: 230, height: 430 } },
          { pid: 99, window_id: 9, bounds: { x: 0, y: 0, width: 2000, height: 1200 } },
        ],
        42,
      ),
    ).toMatchObject({ window_id: 8 });
  });

  it("rejects app-switcher shortcuts before target-scoped keyboard delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-target-shortcut-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("pinned", { session: "pinned", pid: 42, window_id: 77 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") return { structuredContent: { pid: 42, window_id: 77, screenshot_png_b64: "PNG", elements: [] } };
      return { structuredContent: {} };
    };
    for (const action of [
      { type: "key", key: "CMD+TAB" },
      { type: "keypress", keys: ["CMD", "SHIFT", "TAB"] },
    ]) {
      await expect(host.handle({ protocolVersion: 1, sessionKey: "pinned", action: "computer_batch", actions: [action] }))
        .resolves.toMatchObject({ ok: false, runtimeError: { code: "target_handoff_untrusted", retryable: false } });
    }
    expect(calls.filter((call) => call.name === "press_key" || call.name === "hotkey")).toHaveLength(0);
    await expect(host.handle({ protocolVersion: 1, sessionKey: "pinned", action: "computer_batch", actions: [{ type: "key", key: "CMD+S" }] }))
      .resolves.toMatchObject({ ok: true });
    expect(calls.filter((call) => call.name === "press_key" || call.name === "hotkey")).toHaveLength(1);
  });

  it("keeps the first proven application identity and rejects later guessed aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-root-identity-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app") return { structuredContent: { pid: 42, bundle_id: "org.example.app", name: "Example App", windows: [{ pid: 42, window_id: 77, bounds: { width: 800, height: 600 }, is_on_screen: true, on_current_space: true }] } };
      if (name === "get_window_state") return { structuredContent: { pid: 42, window_id: 77, screenshot_png_b64: "PNG", elements: [] } };
      if (name === "get_accessibility_tree" || name === "list_windows") return { structuredContent: { windows: [{ pid: 42, window_id: 77, bounds: { width: 800, height: 600 }, is_on_screen: true, on_current_space: true }] } };
      return { structuredContent: {} };
    };
    await expect(host.handle({ protocolVersion: 1, sessionKey: "identity", action: "computer_open_application", bundle_identifier: "org.example.app" }))
      .resolves.toMatchObject({ ok: true, target: { pid: 42, window_id: 77 } });
    const rootTarget = structuredClone(host.rootTargets.get("identity"));
    await expect(host.handle({ protocolVersion: 1, sessionKey: "identity", action: "computer_open_application", application_name: "guessed-alias" }))
      .resolves.toMatchObject({ ok: false, runtimeError: { code: "target_handoff_untrusted", retryable: false } });
    expect(calls.filter((call) => call.name === "launch_app")).toHaveLength(1);
    expect(host.rootTargets.get("identity")).toEqual(rootTarget);
  });

  it("pins an on-screen current-space TextEdit window ahead of a larger off-screen sibling", () => {
    expect(selectLaunchWindow([
      { pid: 42, window_id: 100620, bounds: { x: 0, y: -1003, width: 1200, height: 900 }, is_on_screen: false, on_current_space: false, z_index: null },
      { pid: 42, window_id: 100621, bounds: { x: 80, y: 60, width: 800, height: 600 }, is_on_screen: true, on_current_space: true, z_index: 9 },
    ], 42)).toMatchObject({ window_id: 100621 });
  });

  it("pins a real content window ahead of a thin high-z sharing surface", () => {
    expect(selectLaunchWindow([
      { pid: 91023, window_id: 101025, bounds: { x: 219, y: -997, width: 66, height: 20 }, is_on_screen: true, on_current_space: true, z_index: 391 },
      { pid: 91023, window_id: 100646, bounds: { x: -1259, y: -762, width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 385 },
      { pid: 91023, window_id: 100620, bounds: { x: -1282, y: -1003, width: 603, height: 505 }, is_on_screen: true, on_current_space: true, z_index: 382 },
    ], 91023)).toMatchObject({ window_id: 100646 });
    expect(selectLaunchWindow([
      { pid: 7, window_id: 70, bounds: { x: 0, y: 0, width: 90, height: 60 }, is_on_screen: true, on_current_space: true, z_index: 1 },
    ], 7)).toMatchObject({ window_id: 70 });
  });

  it("detects a Save sheet appearing over the pinned parent window", () => {
    const target = { session: "save", pid: 42, window_id: 77 };
    const parent = { accessibility: { elements: [
      { element_index: 0, role: "AXWindow", name: "Untitled", frame: { x: 0, y: 0, width: 800, height: 600 } },
      { element_index: 1, role: "AXButton", name: "Format" },
    ] } };
    const sheet = { accessibility: { elements: [
      ...parent.accessibility.elements,
      { element_index: 2, parent_index: 0, role: "AXSheet", name: "Save", frame: { x: 120, y: 90, width: 560, height: 400 } },
      { element_index: 3, parent_index: 2, role: "AXButton", name: "Save" },
    ] } };
    expect(actionableContextChanged(parent, sheet, target)).toBe(true);
  });

  it("ignores volatile window title, frame, and AX enumeration order", () => {
    const target = { session: "save", pid: 42, window_id: 77 };
    const before = { accessibility: { elements: [
      { element_index: 0, role: "AXWindow", name: "Untitled", frame: { x: 0, y: 0, width: 800, height: 600 }, window_id: 77 },
      { element_index: 1, role: "AXDialog", name: "Old title", parent_index: 0, element_id: "dialog-1", frame: { x: 10, y: 10, width: 300, height: 200 } },
    ] } };
    const after = { accessibility: { elements: [
      { element_index: 8, role: "AXDialog", name: "New title", parent_index: 9, element_id: "dialog-1", frame: { x: 50, y: 80, width: 420, height: 260 } },
      { element_index: 9, role: "AXWindow", name: "Edited", frame: { x: 1, y: 2, width: 900, height: 700 }, window_id: 77 },
    ] } };
    expect(actionableContextChanged(before, after, target)).toBe(false);
  });

  it("stops a batch after an action opens a sheet instead of clicking through it", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-modal-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    let observations = 0;
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("save", { session: "save", pid: 42, window_id: 77 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") {
        observations += 1;
        return { structuredContent: {
          screenshot_png_b64: `PNG-${observations}`,
          elements: observations === 1
            ? [{ element_index: 0, role: "AXWindow", name: "Untitled" }]
            : [
                { element_index: 0, role: "AXWindow", name: "Untitled" },
                { element_index: 1, parent_index: 0, role: "AXSheet", name: "Save" },
              ],
        } };
      }
      return { structuredContent: {} };
    };
    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "save",
      action: "computer_batch",
      actions: [
        { type: "key", key: "CMD+S" },
        { type: "click", coordinate: [700, 500] },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      batchInterrupted: true,
      interruptionReason: "actionable_context_changed",
      requiresReplan: true,
      completedActions: 1,
    });
    expect(calls.filter((call) => call.name === "press_key")).toHaveLength(1);
    expect(calls.filter((call) => call.name === "click")).toHaveLength(0);
  });

  it("requires re-observation and then blocks a repeated no-progress click", async () => {
    let capture = 0;
    let runtimeCalls = 0;
    const unchanged = () => ({
      screenshotId: `observation-${++capture}`,
      base64: "SAME_PNG",
      accessibility: {
        snapshot_id: `snapshot-${capture}`,
        elements: [{ role: "button", name: "Behind sheet", snapshot_id: `element-snapshot-${capture}` }],
      },
    });
    const broker = new ComputerWorkerBroker({ request: async () => {
      runtimeCalls += 1;
      return unchanged();
    } });
    const grant = broker.issue({ taskId: "task", stepId: "step", runId: "run", role: "gui-operator" });
    await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
    const action = { operation: "mutate" as const, payload: {
      actions: [{ type: "click", coordinate: [700, 500] }],
    } };
    await expect(broker.execute(grant.token, action)).resolves.toMatchObject({
      noProgress: { status: "reobserve_required", unchangedAttempts: 1 },
    });
    await expect(broker.execute(grant.token, action)).rejects.toThrow(
      "no_progress_requires_fresh_observation",
    );
    await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
    const callsBeforeBlockedRetry = runtimeCalls;
    await expect(broker.execute(grant.token, action)).rejects.toThrow(
      "no_progress_budget_exhausted",
    );
    expect(runtimeCalls).toBe(callsBeforeBlockedRetry);
    await expect(broker.execute(grant.token, {
      operation: "mutate",
      payload: { actions: [{ type: "key", key: "ESCAPE" }] },
    })).resolves.toMatchObject({ noProgress: { status: "reobserve_required" } });
    expect(runtimeCalls).toBe(callsBeforeBlockedRetry + 1);
  });

  it("unblocks a mutation signature after a fresh observation proves UI progress", async () => {
    let state = "A";
    let runtimeCalls = 0;
    const broker = new ComputerWorkerBroker({ request: async (request) => {
      runtimeCalls += 1;
      if ((request as any).actions?.[0]?.coordinate?.[0] === 10 && state === "B") state = "C";
      return {
        screenshotId: `observation-${runtimeCalls}`,
        base64: `PNG-${state}`,
        accessibility: { snapshot_id: `snapshot-${runtimeCalls}`, elements: [{ role: "button", name: state }] },
      };
    } });
    const grant = broker.issue({ taskId: "task-change", stepId: "step", runId: "run", role: "gui-operator" });
    await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
    const action = { operation: "mutate" as const, payload: {
      actions: [{ type: "click", coordinate: [10, 10] }],
    } };
    await expect(broker.execute(grant.token, action)).resolves.toMatchObject({
      noProgress: { status: "reobserve_required" },
    });
    state = "B";
    await broker.execute(grant.token, { operation: "observe", payload: { fresh: true } });
    await expect(broker.execute(grant.token, action)).resolves.not.toHaveProperty("noProgress");
  });

  it("preserves a structured mutation outcome unknown through the worker broker", async () => {
    const unknown = {
      ok: false,
      outcomeUnknown: true,
      runtimeError: {
        code: "mutation_outcome_unknown",
        message: "post-action observation failed",
        requiresObservation: true,
      },
      screenshotId: "best-effort-observation",
      base64: "PNG",
      accessibility: { elements: [] },
    };
    const broker = new ComputerWorkerBroker({ request: async () => unknown });
    const grant = broker.issue({ taskId: "unknown", stepId: "step", runId: "run", role: "gui-operator" });
    await expect(broker.execute(grant.token, {
      operation: "mutate",
      payload: { actions: [{ type: "click", coordinate: [10, 10] }] },
    })).resolves.toMatchObject({
      outcomeUnknown: true,
      runtimeError: { code: "mutation_outcome_unknown", requiresObservation: true },
    });
    expect(broker.observation("unknown", "step")).toMatchObject({ outcomeUnknown: true });
  });

  it("does not rebind a tail element action after the snapshot changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-snapshot-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    let observations = 0;
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("snapshot", { session: "snapshot", pid: 42, window_id: 77 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") {
        observations += 1;
        return { structuredContent: {
          screenshot_png_b64: `PNG-${observations}`,
          snapshot_id: `snapshot-${observations}`,
          elements: [{ element_index: 0, role: "AXWindow", window_id: 77 }],
        } };
      }
      return { structuredContent: {} };
    };
    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "snapshot",
      action: "computer_batch",
      actions: [
        { type: "click", coordinate: [10, 10] },
        { type: "click", element_index: 4 },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      batchInterrupted: true,
      interruptionReason: "snapshot_changed",
      requiresReplan: true,
      completedActions: 1,
    });
    expect(calls.filter((call) => call.name === "click")).toHaveLength(1);
  });

  it("returns outcome unknown when mandatory post-mutation observation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-unknown-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: string[] = [];
    let observations = 0;
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("unknown", { session: "unknown", pid: 42, window_id: 77 });
    host.call = async (name: string) => {
      calls.push(name);
      if (name === "get_window_state" && observations++ === 0) {
        return { structuredContent: {
          screenshot_png_b64: "BEFORE",
          elements: [{ role: "AXWindow", window_id: 77 }],
        } };
      }
      if (name === "get_window_state") throw new Error("post-observe failed");
      return { structuredContent: {} };
    };
    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "unknown",
      action: "computer_batch",
      actions: [
        { type: "click", coordinate: [10, 10] },
        { type: "click", coordinate: [20, 20] },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      outcomeUnknown: true,
      runtimeError: { code: "mutation_outcome_unknown" },
      completedActions: 0,
    });
    expect(calls.filter((name) => name === "click")).toHaveLength(1);
  });

  it("keeps the daemon socket below the macOS sockaddr_un byte limit", () => {
    const realisticLongTemp =
      "/var/folders/zz/abcdefghijklmnopqrstuvwxyz0123456789/T/TemporaryItems/Very Long PipiUI Electron Session Name";
    const path = cuaSocketPath(
      realisticLongTemp,
      123456,
      "12345678-1234-1234-1234-123456789abc",
      "darwin",
    );
    expect(path).toBe("/tmp/pcua-123456-12345678123412341234123456789abc.sock");
    expect(Buffer.byteLength(path)).toBeLessThanOrEqual(103);
  });

  it("reports an actionable false state when the packaged helper is absent", async () => {
    const host = new CuaDriverHost("/missing/cua-driver", {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    expect(host.usable()).toBe(false);
    expect(
      await host.handle({
        protocolVersion: 1,
        action: "computer_runtime_capabilities",
      }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "driver_unavailable", retryable: false },
    });
  });

  it("rejects unsupported runtime protocol before launching a helper", async () => {
    const host = new CuaDriverHost("/missing/cua-driver", {
      displayID: 1,
      width: 1,
      height: 1,
    });
    expect(
      await host.handle({ protocolVersion: 99, action: "computer_batch" }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "unsupported_protocol_version" },
    });
  });

  it("cancels pending calls and tears down owned helper processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-test-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1,
      height: 1,
    });
    let daemonKilled = false,
      proxyKilled = false,
      rejected = "";
    host.daemon = {
      kill: () => {
        daemonKilled = true;
      },
    };
    host.proxy = {
      kill: () => {
        proxyKilled = true;
      },
    };
    host.pending.set(7, {
      timer: setTimeout(() => {}, 10_000),
      resolve: () => {},
      reject: (error: Error) => {
        rejected = error.message;
      },
    });
    host.targets.set("session", { session: "session", pid: 42, window_id: 100 });
    host.rootTargets.set("session", { session: "session", pid: 42, window_id: 100 });
    host.cancel();
    expect({ daemonKilled, proxyKilled, rejected }).toEqual({
      daemonKilled: true,
      proxyKilled: true,
      rejected: "computer request cancelled",
    });
    expect(host.targets.size).toBe(0);
    expect(host.rootTargets.size).toBe(0);
  });

  it("does not finish shutdown until owned helpers that ignore SIGTERM are reaped", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-shutdown-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    const trace = join(root, "pids.jsonl");
    await writeFile(helper, `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const readline = require("node:readline");
const mode = process.argv[2];
const socket = process.argv[process.argv.indexOf("--socket") + 1];
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ mode, pid: process.pid }) + "\\n");
process.on("SIGTERM", () => {});
if (mode === "serve") {
  net.createServer(() => {}).listen(socket);
  setInterval(() => {}, 1000);
} else {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (!message.id) return;
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } }
      : { content: [], structuredContent: {}, isError: false };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  });
  setInterval(() => {}, 1000);
}
`);
    await chmod(helper, 0o755);
    const host = new CuaDriverHost(helper, { displayID: 1, width: 1, height: 1 });
    await expect(host.handle({
      protocolVersion: 1,
      action: "computer_runtime_capabilities",
    })).resolves.toMatchObject({ ok: true });
    const pids = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).pid as number);
    expect(pids).toHaveLength(2);

    await host.shutdown();

    for (const pid of pids) {
      expect(() => process.kill(pid, 0), `pid ${pid} survived shutdown`).toThrow();
    }
  });

  it("fences an in-flight startup before it can spawn a helper after shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-startup-shutdown-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    const trace = join(root, "pids.jsonl");
    await writeFile(helper, `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const readline = require("node:readline");
const mode = process.argv[2];
const socket = process.argv[process.argv.indexOf("--socket") + 1];
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ mode, pid: process.pid }) + "\\n");
if (mode === "serve") {
  let server;
  process.on("SIGTERM", () => {
    if (!server) server = net.createServer(() => {}).listen(socket);
  });
  setInterval(() => {}, 1000);
} else {
  process.on("SIGTERM", () => {});
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (!message.id) return;
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } }
      : { content: [], structuredContent: {}, isError: false };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  });
  setInterval(() => {}, 1000);
}
`);
    await chmod(helper, 0o755);
    const host = new CuaDriverHost(helper, { displayID: 1, width: 1, height: 1 });
    const request = host.handle({
      protocolVersion: 1,
      action: "computer_runtime_capabilities",
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await readFile(trace, "utf8").catch(() => "");
      if (current.includes('"mode":"serve"')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const shutdown = host.shutdown();
    await Promise.allSettled([request, shutdown]);
    const text = await readFile(trace, "utf8").catch(() => "");
    const records = text.trim()
      ? text.trim().split("\n").map((line) => JSON.parse(line) as { mode: string; pid: number })
      : [];
    const survivors = records.filter(({ pid }) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    for (const { pid } of survivors) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
    }
    const liveHelperPids = execFileSync("/bin/ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" })
      .split("\n")
      .flatMap((line) => {
        const match = /^\s*(\d+)\s(.*)$/.exec(line);
        if (!match) return [];
        const command = match[2];
        if (command === helper || command.startsWith(`${helper} `) || command.includes(` ${helper} `) || command.endsWith(` ${helper}`)) {
          return [Number(match[1])];
        }
        return [];
      });

    // Fenced before the fake helper could write the trace is a valid outcome.
    if (records.length > 0) {
      expect(records.map(({ mode }) => mode)).toEqual(["serve"]);
    }
    expect(survivors).toEqual([]);
    expect(liveHelperPids).toEqual([]);
  });

  it("does not spawn a new generation until previous launch-path PIDs are dead", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-restart-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    const trace = join(root, "pids.jsonl");
    await writeFile(helper, `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const readline = require("node:readline");
const mode = process.argv[2];
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ mode, pid: process.pid }) + "\\n");
process.on("SIGTERM", () => {});
if (mode === "serve") {
  const leftover = spawn(process.argv[1], ["leftover"], { detached: true, stdio: "ignore" });
  leftover.unref();
  net.createServer(() => {}).listen(process.argv[process.argv.indexOf("--socket") + 1]);
  setInterval(() => {}, 1000);
} else if (mode === "mcp") {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (!message.id) return;
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } }
      : { content: [], structuredContent: {}, isError: false };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  });
  setInterval(() => {}, 1000);
} else {
  setInterval(() => {}, 1000);
}
`);
    await chmod(helper, 0o755);
    const previousPids: number[] = [];
    let spawnedWhilePreviousAlive = false;
    let generation = 0;
    const host = new CuaDriverHost(helper, { displayID: 1, width: 1, height: 1 }, (command, args, options) => {
      if (generation > 0) {
        for (const pid of previousPids) {
          try {
            process.kill(pid, 0);
            spawnedWhilePreviousAlive = true;
          } catch { /* previous pid already reaped */ }
        }
      }
      return spawn(command, args, options);
    });
    const knownPids = new Set<number>();
    const readPids = async () => {
      const text = await readFile(trace, "utf8").catch(() => "");
      return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).pid as number);
    };
    try {
      await expect(host.handle({
        protocolVersion: 1,
        action: "computer_runtime_capabilities",
      })).resolves.toMatchObject({ ok: true });
      for (let attempt = 0; attempt < 40; attempt += 1) {
        previousPids.splice(0, previousPids.length, ...(await readPids()));
        if (previousPids.length >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(previousPids.length).toBeGreaterThanOrEqual(3);
      for (const pid of previousPids) knownPids.add(pid);
      generation = 1;
      host.cancel();
      await expect(host.handle({
        protocolVersion: 1,
        action: "computer_runtime_capabilities",
      })).resolves.toMatchObject({ ok: true });
      expect(spawnedWhilePreviousAlive).toBe(false);
      for (const pid of previousPids) {
        expect(() => process.kill(pid, 0), `pid ${pid} survived cancel`).toThrow();
      }
    } finally {
      await host.shutdown();
      for (const pid of [...knownPids, ...(await readPids())]) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
      }
    }
  });

  it("blocks restart when a leftover PID remains after the final reap timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-leftover-block-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    let spawned = 0;
    const host: any = new CuaDriverHost(
      helper,
      { displayID: 1, width: 1, height: 1 },
      (command, args, options) => {
        spawned += 1;
        return spawn(command, args, options);
      },
    );
    host.leftoverSettleMs = 50;
    host.listExactLaunchPathPids = async () => [424242];
    host.cancel();
    await expect(host.handle({
      protocolVersion: 1,
      action: "computer_runtime_capabilities",
    })).rejects.toThrow(/still running/);
    expect(spawned).toBe(0);
  });

  it("extracts only closed target-window codes from Cua tool failures", () => {
    expect(cuaToolFailureCode({
      isError: true,
      structuredContent: { error_code: "window_id_not_found" },
    })).toBe("window_id_not_found");
    expect(cuaToolFailureCode({
      isError: true,
      content: [{ type: "text", text: "window_owner_pid_mismatch owner_pid=84" }],
    })).toBe("window_owner_pid_mismatch");
    expect(cuaToolFailureCode({
      isError: true,
      structuredContent: { error_code: "arbitrary_failure" },
      content: [{ type: "text", text: "owner_pid=84" }],
    })).toBeUndefined();
  });

  it("classifies only its own RPC deadline with a closed typed timeout code", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-test-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1, height: 1 }, undefined, 10);
    host.proxy = { stdin: { writable: true, write: () => true }, killed: false };
    await expect(host.rpc("tools/call", { name: "screenshot", arguments: {} })).rejects.toMatchObject({
      name: "CuaDriverRPCTimeoutError",
      code: "cua_driver_rpc_timeout",
    });
  });

  it("pins the same version as packaging metadata", async () => {
    const metadata = JSON.parse(
      await readFile(
        new URL("../../../../cua-driver-assets.json", import.meta.url),
        "utf8",
      ),
    );
    expect(metadata.version).toBe(CUA_DRIVER_VERSION);
    expect(metadata.assets["darwin-universal"].sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("constructs 0.20.0 target-scoped action arguments", () => {
    const target = { session: "session-a", pid: 42, window_id: 77 };
    expect(
      buildActionCall({ type: "click", coordinate: [10, 20] }, target),
    ).toEqual({
      tool: "click",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        x: 10,
        y: 20,
        button: "left",
        count: 1,
      },
    });
    expect(
      buildActionCall(
        { type: "type", text: "hello", element_token: "token" },
        target,
      ),
    ).toEqual({
      tool: "type_text",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        element_token: "token",
        text: "hello",
      },
    });
    expect(
      buildActionCall({
        type: "key",
        keys: ["CMD", "L"],
        element_token: "s00000001:0",
        element_index: 9,
        snapshot_id: "snapshot-old",
      }, target),
    ).toEqual({
      tool: "hotkey",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        keys: ["CMD", "L"],
      },
    });
    expect(
      buildActionCall(
        { type: "scroll", scroll_direction: "down", scroll_amount: 4 },
        target,
      ),
    ).toMatchObject({
      tool: "scroll",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        direction: "down",
        amount: 4,
      },
    });
  });

  it("invokes an exact native menu path only through the already-pinned application", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-native-menu-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1512, height: 982 });
    host.targets.set("menu", { session: "menu", pid: 98798, window_id: 373954 });
    host.rootTargets.set("menu", { session: "menu", pid: 98798, window_id: 373954 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") return { structuredContent: {
        screenshot_png_b64: "PNG",
        snapshot_id: "s00000001",
        pid: 98798,
        window_id: 373954,
        elements: [{ role: "AXWindow", name: "Document" }],
      } };
      if (name === "click") throw Object.assign(new Error("coordinate_outside_target_window"), { code: "coordinate_outside_target_window" });
      return { structuredContent: { invoked: true } };
    };

    await expect(host.handle({
      protocolVersion: 1,
      sessionKey: "menu",
      action: "computer_batch",
      actions: [{ type: "invoke_menu", path: ["Example App", "Settings…"] }],
    })).resolves.toMatchObject({ ok: true });
    expect(calls.find((call) => call.name === "invoke_menu")?.args).toEqual({
      session: "menu",
      pid: 98798,
      window_id: 373954,
      path: ["Example App", "Settings…"],
    });

    await expect(host.handle({
      protocolVersion: 1,
      sessionKey: "menu",
      action: "computer_batch",
      actions: [{ type: "click", coordinate: [90, -1065] }],
    })).resolves.toMatchObject({ ok: false, runtimeError: { code: "mutation_outcome_unknown" } });
    expect(calls.findLast((call) => call.name === "click")?.args).toMatchObject({
      session: "menu",
      pid: 98798,
      window_id: 373954,
      x: 90,
      y: -1065,
    });
  });

  it("escalates ambiguous same-pid keyboard actions to the exact foreground window", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-keyboard-ambiguity-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.targets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101369 });
    host.rootTargets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101240 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") return { structuredContent: {
        screenshot_png_b64: "PNG",
        snapshot_id: "snapshot-panel",
        pid: 91023,
        window_id: 101369,
        elements: [{ role: "AXWindow" }, { role: "AXList" }],
        background_input: { routes: [
          { route: "accessibility", status: "available" },
          { route: "pid_keyboard", status: "refused", reason: "same_pid_keyboard_ambiguity" },
        ] },
      } };
      return { structuredContent: {} };
    };
    for (const action of [
      { type: "key", keys: ["CMD", "SHIFT", "G"] },
      { type: "type", text: "pipiui-computer-agent-final-acceptance-19.txt" },
      { type: "key", key: "RETURN" },
    ]) {
      expect(await host.handle({
        protocolVersion: 1,
        sessionKey: "open-panel",
        action: "computer_batch",
        actions: [action],
      })).toMatchObject({ ok: true });
    }
    expect(calls.filter((call) => ["hotkey", "type_text", "press_key"].includes(call.name))
      .map((call) => ({ name: call.name, pid: call.args.pid, window: call.args.window_id, delivery: call.args.delivery_mode })))
      .toEqual([
        { name: "hotkey", pid: 91023, window: 101369, delivery: "foreground" },
        { name: "type_text", pid: 91023, window: 101369, delivery: "foreground" },
        { name: "press_key", pid: 91023, window: 101369, delivery: "foreground" },
      ]);
  });

  it("opens one exact Open Panel file child and proves return to the immutable document surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-typeahead-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
	let panelRoot = '- [0] AXWindow "打开" [id=open-panel actions=[raise]]\n  - [55] AXList [actions=[showmenu]]\n    - [57] AXImage "pipiui-computer-agent-final-acceptance-24.txt" [actions=[open,showmenu]]';
	let fileLists: Array<Record<string, unknown>> = [
	  { element_index: 55, element_token: "s00000024:55", role: "AXList", label: "图标视图" },
	];
	let fileChildren: Array<Record<string, unknown>> = [];
	let opened = false;
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101369 });
	host.rootTargets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101240 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
	  if (name === "get_window_state" && opened && args.window_id === 101369) throw Object.assign(new Error("closed"), { code: "window_id_not_found" });
      if (name === "get_window_state") return { structuredContent: {
        screenshot_png_b64: "PNG",
        snapshot_id: "s00000024",
        tree_markdown: args.window_id === 101240 ? '- [0] AXWindow "Document" [id=_NS:34]\n  - [1] AXTextArea' : panelRoot,
        elements: [
		  { element_index: 0, element_token: "s00000024:0", role: "AXWindow" },
		  ...fileLists,
		  ...(args.window_id === 101240 ? [{ element_index: 1, role: "AXTextArea", enabled: true }] : fileChildren),
        ],
      } };
	  if (name === "click") opened = true;
      return { structuredContent: {} };
    };

    const longBasename = "pipiui-computer-agent-final-acceptance-24.txt";
	fileChildren = [{ element_index: 57, element_token: "s00000024:57", parent_index: 55, role: "AXImage", label: longBasename, selected: false }];
	expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "open-panel",
      action: "computer_batch",
      actions: [{
        type: "typeahead",
        text: longBasename,
      }],
	})).toMatchObject({ ok: true });

	expect(calls.filter((call) => call.name === "press_key")).toHaveLength(0);
	expect(calls.filter((call) => call.name === "type_text")).toHaveLength(0);
	expect(calls.filter((call) => call.name === "click").map((call) => ({
	  action: call.args.action,
	  pid: call.args.pid,
	  window: call.args.window_id,
	  token: call.args.element_token,
	}))).toEqual([
	  { action: "open", pid: 91023, window: 101369, token: "s00000024:57" },
	]);

	const beforeRejected = calls.filter((call) => call.name === "click").length;
	for (const state of [
	  { root: panelRoot, lists: [], children: fileChildren },
	  { root: panelRoot, lists: [
		{ element_index: 55, element_token: "s00000024:55", role: "AXList" },
		{ element_index: 56, element_token: "s00000024:56", role: "AXList" },
	  ], children: fileChildren },
	  { root: panelRoot, lists: fileLists, children: [] },
	  { root: panelRoot, lists: fileLists, children: [
		{ element_index: 57, element_token: "s00000024:57", parent_index: 55, role: "AXImage", label: "mismatch.txt" },
	  ] },
	  { root: panelRoot, lists: fileLists, children: [
		{ element_index: 57, element_token: "s00000024:57", parent_index: 0, role: "AXImage", label: "other.txt" },
	  ] },
	  { root: panelRoot, lists: fileLists, children: [
		{ element_index: 57, element_token: "s00000024:57", parent_index: 55, role: "AXImage", label: "other.txt" },
		{ element_index: 58, element_token: "s00000024:58", parent_index: 55, role: "AXImage", label: "other.txt" },
	  ] },
	  { root: '- [0] AXWindow "打开" [id=open-panel]\n  - [55] AXList\n    - [57] AXImage "other.txt" [actions=[showmenu]]', lists: [{ element_index: 55, element_token: "s00000024:55", role: "AXList" }], children: [{ element_index: 57, element_token: "s00000024:57", parent_index: 55, role: "AXImage", label: "other.txt" }] },
	  { root: "- [0] AXWindow \"Document\"", lists: [{ element_index: 55, element_token: "s00000024:55", role: "AXList" }], children: fileChildren },
	]) {
	  panelRoot = state.root;
	  fileLists = state.lists;
	  fileChildren = state.children;
	  opened = false;
	  host.targets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101369 });
	  await expect(host.handle({
		protocolVersion: 1,
		sessionKey: "open-panel",
		action: "computer_batch",
		actions: [{ type: "typeahead", text: "other.txt" }],
	  })).resolves.toMatchObject({
		ok: false,
		runtimeError: { code: "typeahead_target_untrusted", requiresObservation: true },
	  });
	}
	expect(calls.filter((call) => call.name === "click")).toHaveLength(beforeRejected);

	panelRoot = '- [0] AXWindow "打开" [id=open-panel actions=[raise]]\n  - [55] AXList\n    - [57] AXImage "unproven.txt" [actions=[open,showmenu]]';
	fileLists = [{ element_index: 55, element_token: "s00000024:55", role: "AXList" }];
	fileChildren = [{ element_index: 57, element_token: "s00000024:57", parent_index: 55, role: "AXImage", label: "unproven.txt" }];
	opened = false;
	host.call = async (name: string, args: any) => {
	  calls.push({ name, args });
	  if (name === "get_window_state") return { structuredContent: {
		screenshot_png_b64: "PNG", snapshot_id: "s00000024", tree_markdown: panelRoot,
		elements: [{ element_index: 0, role: "AXWindow" }, ...fileLists, ...fileChildren],
	  } };
	  return { structuredContent: {} };
	};
	await expect(host.handle({ protocolVersion: 1, sessionKey: "open-panel", action: "computer_batch", actions: [{ type: "typeahead", text: "unproven.txt" }] }))
	  .resolves.toMatchObject({ ok: false, runtimeError: { code: "typeahead_open_unverified" } });

	for (const driftTarget of [
	  { session: "open-panel", pid: 91024, window_id: 101369 },
	  { session: "open-panel", pid: 91023, window_id: 101370 },
	]) {
	  opened = false;
	  host.targets.set("open-panel", { session: "open-panel", pid: 91023, window_id: 101369 });
	  host.call = async (name: string, args: any) => {
		calls.push({ name, args });
		if (name === "click") {
		  opened = true;
		  host.targets.set("open-panel", driftTarget);
		}
		if (name === "get_window_state") return { structuredContent: {
		  screenshot_png_b64: "PNG", snapshot_id: "s00000024", tree_markdown: panelRoot,
		  elements: [
			{ element_index: 0, role: "AXWindow" }, ...fileLists,
			...fileChildren,
		  ],
		} };
		return { structuredContent: {} };
	  };
	  await expect(host.handle({ protocolVersion: 1, sessionKey: "open-panel", action: "computer_batch", actions: [{ type: "typeahead", text: "unproven.txt" }] }))
		.resolves.toMatchObject({ ok: false, runtimeError: { code: "typeahead_open_unverified" } });
	}
  });

  it("resumes an authoritative pre-existing Open Panel at application launch without adopting sibling documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-launch-panel-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    const calls: Array<{ name: string; args: any }> = [];
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app") return { structuredContent: {
        pid: 91023,
        windows: [
          { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 385 },
          { pid: 91023, window_id: 100620, bounds: { width: 603, height: 505 }, is_on_screen: true, on_current_space: true, z_index: 382 },
        ],
      } };
      if (name === "get_window_state") return { structuredContent: {
        screenshot_png_b64: `PNG-${args.window_id}`,
        snapshot_id: `snapshot-${args.window_id}`,
        pid: 91023,
        window_id: args.window_id,
        elements: [],
        tree_markdown: args.window_id === 101271
          ? '- [0] AXWindow [id=open-panel actions=[raise]]'
          : '- [0] AXWindow [id=_NS:34 actions=[raise]]',
      } };
      if (name === "get_accessibility_tree") return { structuredContent: { windows: [
        { pid: 91023, window_id: 101271, bounds: { width: 881, height: 448 }, z_index: 410 },
        { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, z_index: 385 },
        { pid: 91023, window_id: 100620, bounds: { width: 603, height: 505 }, z_index: 382 },
      ] } };
      if (name === "list_windows") return { structuredContent: { windows: [
        { pid: 91023, window_id: 101271, bounds: { width: 881, height: 448 }, is_on_screen: true, on_current_space: true, z_index: 410 },
        { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 385 },
        { pid: 91023, window_id: 100620, bounds: { width: 603, height: 505 }, is_on_screen: true, on_current_space: true, z_index: 382 },
      ] } };
      return { structuredContent: {} };
    };

    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit-existing-panel",
      action: "computer_open_application",
      bundle_identifier: "com.apple.TextEdit",
    });
    expect(result).toMatchObject({ ok: true, target: { pid: 91023, window_id: 101271 }, window_id: 101271 });
    expect(host.rootTargets.get("textedit-existing-panel")).toMatchObject({ pid: 91023, window_id: 101240 });
    expect(host.targets.get("textedit-existing-panel")).toMatchObject({ pid: 91023, window_id: 101271 });

    // When the authoritative z-order has the selected root first, a second
    // ordinary document below it is not a modal handoff candidate.
    host.call = async (name: string, args: any) => {
      if (name === "launch_app") return { structuredContent: {
        pid: 91023,
        windows: [{ pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 385 }],
      } };
      if (name === "get_window_state") return { structuredContent: {
        screenshot_png_b64: `PNG-${args.window_id}`,
        pid: 91023,
        window_id: args.window_id,
        elements: [],
      } };
      if (name === "get_accessibility_tree") return { structuredContent: { windows: [
        { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, z_index: 385 },
        { pid: 91023, window_id: 100620, bounds: { width: 603, height: 505 }, z_index: 382 },
      ] } };
      return { structuredContent: { windows: [] } };
    };
    const noPanel = await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit-no-panel",
      action: "computer_open_application",
      bundle_identifier: "com.apple.TextEdit",
    });
    expect(noPanel).toMatchObject({ ok: true, target: { pid: 91023, window_id: 101240 }, window_id: 101240 });
    expect(host.targets.get("textedit-no-panel")).toMatchObject({ pid: 91023, window_id: 101240 });
  });

  it("resumes a standard file panel below the activated root using exact AX identity and list proof", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-launch-reused-panel-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.call = async (name: string, args: any) => {
      if (name === "launch_app") return { structuredContent: {
        pid: 91023,
        windows: [
          { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 397 },
          { pid: 91023, window_id: 100646, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 379 },
        ],
      } };
      if (name === "get_accessibility_tree") return { structuredContent: { windows: [
        // Real 0.19.2 shape has no bounds here. The thin surface is rejected by
        // the independent list_windows proof, not trusted from AX ordering.
        { pid: 91023, window_id: 101244 },
        { pid: 91023, window_id: 101240 },
        { pid: 91023, window_id: 101271 },
        { pid: 91023, window_id: 100646 },
      ] } };
      if (name === "list_windows") return { structuredContent: { windows: [
        { pid: 91023, window_id: 101244, bounds: { width: 66, height: 20 }, is_on_screen: true, on_current_space: true, z_index: 399 },
        { pid: 91023, window_id: 101240, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 397 },
        { pid: 91023, window_id: 101271, bounds: { width: 881, height: 448 }, is_on_screen: true, on_current_space: true, z_index: 373 },
        { pid: 91023, window_id: 100646, bounds: { width: 673, height: 439 }, is_on_screen: true, on_current_space: true, z_index: 379 },
      ] } };
      if (name === "get_window_state") {
        const filePanel = args.window_id === 101271;
        return { structuredContent: {
          screenshot_png_b64: `PNG-${args.window_id}`,
          pid: 91023,
          window_id: args.window_id,
          elements: filePanel ? [{ role: "AXWindow" }, { role: "AXOutline" }] : [{ role: "AXWindow" }, { role: "AXTextArea" }],
          tree_markdown: filePanel
            ? '- [0] AXWindow [id=open-panel actions=[raise]]\n  - AXOutline'
            : '- [0] AXWindow [id=_NS:34 actions=[raise]]\n  - [1] AXTextArea',
        } };
      }
      return { structuredContent: {} };
    };
    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit-reused-panel",
      action: "computer_open_application",
      bundle_identifier: "com.apple.TextEdit",
    });
    expect(result).toMatchObject({ ok: true, target: { pid: 91023, window_id: 101271 }, window_id: 101271 });
    expect(host.rootTargets.get("textedit-reused-panel")).toMatchObject({ pid: 91023, window_id: 101240 });
  });

  it("uses get_window_state after launch and never shares a target across sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-contract-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app")
        return {
          structuredContent: { pid: 42, windows: [{ pid: 42, window_id: 77 }] },
        };
      if (name === "get_window_state")
        return {
          content: [{ type: "text", text: "Calculator window state" }],
          structuredContent: {
            elements: [],
            screenshot_png_b64: "REALISTIC_PNG_BASE64",
            screenshot_mime_type: "image/png",
            screenshot_width: 900,
            screenshot_height: 700,
          },
        };
      return { structuredContent: {} };
    };
    const opened = await host.handle({
        protocolVersion: 1,
        sessionKey: "a",
        action: "computer_open_application",
        application_name: "Calculator",
      });
    expect(opened).toMatchObject({
      ok: true,
      target: { pid: 42, window_id: 77, session: "a" },
      base64: "REALISTIC_PNG_BASE64",
      mimeType: "image/png",
    });
    expect(opened).not.toHaveProperty("screenshot_png_b64");
    expect(calls.map((call) => call.name)).toEqual([
      "start_session",
      "launch_app",
      "bring_to_front",
      "get_window_state",
      "get_accessibility_tree",
    ]);
    expect(calls.find((call) => call.name === "bring_to_front")?.args).toEqual({
      pid: 42,
      window_id: 77,
    });
    expect(calls.find((call) => call.name === "get_window_state")?.args).toMatchObject({
      session: "a",
      pid: 42,
      window_id: 77,
    });
    expect(
      await host.handle({
        protocolVersion: 1,
        sessionKey: "b",
        action: "computer_batch",
        actions: [{ type: "click", coordinate: [1, 2] }],
      }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "target_unavailable" },
    });
    expect(calls.some((call) => call.name === "screenshot")).toBe(false);
  });

  it("activates a running uninstalled app by resolving its name through list_apps", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-running-name-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app" && args.name === "COC Keeper") {
        throw new Error("No installed macOS app found for name 'COC Keeper'.");
      }
      if (name === "list_apps") {
        return {
          structuredContent: {
            apps: [
              { name: "PipiUI Electron", bundle_id: "com.leehow.pipiui-electron", pid: 56148, running: true },
              { name: "COC Keeper", bundle_id: "org.chatrpg.cockeyper", pid: 91368, running: true },
            ],
          },
        };
      }
      if (name === "launch_app" && args.bundle_id === "org.chatrpg.cockeyper") {
        return {
          structuredContent: {
            pid: 91368,
            windows: [
              { pid: 91368, window_id: 349056, bounds: { width: 500, height: 500 }, is_on_screen: false, on_current_space: null, z_index: 440 },
              { pid: 91368, window_id: 349047, bounds: { width: 1440, height: 903 }, is_on_screen: true, on_current_space: true, z_index: 136 },
            ],
          },
        };
      }
      if (name === "get_window_state") {
        return {
          structuredContent: {
            screenshot_png_b64: `PNG-${args.window_id}`,
            pid: 91368,
            window_id: args.window_id,
            elements: [{ role: "AXWindow", name: "克苏鲁的呼唤 · Keeper" }],
          },
        };
      }
      return { structuredContent: {} };
    };

    const opened = await host.handle({
      protocolVersion: 1,
      sessionKey: "coc-running",
      action: "computer_open_application",
      application_name: "COC Keeper",
    });
    expect(opened).toMatchObject({
      ok: true,
      target: { pid: 91368, window_id: 349047, session: "coc-running" },
    });
    expect(calls.filter((call) => call.name === "launch_app").map((call) => call.args)).toEqual([
      { name: "COC Keeper" },
      { bundle_id: "org.chatrpg.cockeyper" },
    ]);
    await expect(host.handle({
      protocolVersion: 1,
      sessionKey: "coc-running",
      action: "computer_open_application",
      bundle_identifier: "org.chatrpg.cockeyper",
    })).resolves.toMatchObject({ ok: true, target: { pid: 91368, window_id: 349047 } });
    await expect(host.handle({
      protocolVersion: 1,
      sessionKey: "coc-running",
      action: "computer_open_application",
      application_name: "unproven-third-party-alias",
    })).resolves.toMatchObject({ ok: false, runtimeError: { code: "target_handoff_untrusted" } });
    expect(calls.filter((call) => call.name === "launch_app").map((call) => call.args)).toEqual([
      { name: "COC Keeper" },
      { bundle_id: "org.chatrpg.cockeyper" },
      { bundle_id: "org.chatrpg.cockeyper" },
    ]);
  });

  it("hands one session from its root app to exact out-of-process nested panels and back", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-panel-handoff-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    let surface: "root" | "panel" | "folder" = "root";
    const png = (windowId: number, extra: Record<string, unknown> = {}) => ({
      structuredContent: {
        screenshot_png_b64: `PNG-${windowId}`,
        snapshot_id: `snapshot-${windowId}`,
        elements: [],
        ...extra,
      },
    });
    const missing = () => Object.assign(new Error("closed driver error"), {
      code: "window_id_not_found",
    });
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app") return {
        structuredContent: { pid: 42, windows: [{ pid: 42, window_id: 100 }] },
      };
      if (name === "list_windows") return { structuredContent: { windows: [
        { pid: 42, window_id: 100 },
        { pid: 84, window_id: 200 },
        { pid: 85, window_id: 300 },
      ] } };
      if (name === "get_window_state") {
        if (args.window_id === 100) return surface === "root"
          ? png(100)
          : png(100, { modal_window_id: 200, focused_window_id: 200 });
        if (args.window_id === 200) {
          if (surface === "root") throw missing();
          return surface === "folder"
            ? png(200, { modal_window_id: 300, focused_window_id: 300 })
            : png(200);
        }
        if (args.window_id === 300) {
          if (surface !== "folder") throw missing();
          return png(300);
        }
      }
      if (name === "hotkey" && args.keys.join("+") === "CMD+O") surface = "panel";
      if (name === "hotkey" && args.keys.join("+") === "CMD+SHIFT+G") surface = "folder";
      if (name === "press_key" && args.key === "RETURN") {
        surface = surface === "folder" ? "panel" : "root";
      }
      return { structuredContent: {} };
    };

    await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit-a",
      action: "computer_open_application",
      bundle_identifier: "com.apple.TextEdit",
    });
    for (const action of [
      { type: "key", keys: ["CMD", "O"] },
      { type: "key", keys: ["CMD", "SHIFT", "G"] },
      { type: "type", text: "/Users/haoli/Desktop/exact.txt" },
      { type: "key", key: "RETURN" },
      { type: "key", key: "RETURN" },
    ]) {
      expect(await host.handle({
        protocolVersion: 1,
        sessionKey: "textedit-a",
        action: "computer_batch",
        actions: [action],
      })).toMatchObject({ ok: true });
    }

    expect(calls.filter((call) => ["hotkey", "type_text", "press_key"].includes(call.name))
      .map((call) => [call.name, call.args.pid, call.args.window_id]))
      .toEqual([
        ["hotkey", 42, 100],
        ["hotkey", 84, 200],
        ["type_text", 85, 300],
        ["press_key", 85, 300],
        ["press_key", 84, 200],
      ]);
    expect(host.targets.get("textedit-a")).toMatchObject({ pid: 42, window_id: 100 });
  });

  it("discovers a same-owner Open Panel after CMD+O when 0.19.2 omits modal window ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-panel-discovery-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    let surface: "root" | "panel" | "folder" = "root";
    const state = (windowId: number) => ({ structuredContent: {
      screenshot_png_b64: `PNG-${windowId}`,
      snapshot_id: `snapshot-${windowId}`,
      pid: 91023,
      window_id: windowId,
      elements: [{ role: "AXWindow" }],
    } });
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.targets.set("textedit", { session: "textedit", pid: 91023, window_id: 100646 });
    host.rootTargets.set("textedit", { session: "textedit", pid: 91023, window_id: 100646 });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "get_window_state") return state(args.window_id);
      if (name === "hotkey") {
        surface = args.keys.join("+") === "CMD+SHIFT+G" ? "folder" : "panel";
        return { structuredContent: {} };
      }
      if (name === "get_accessibility_tree") return { structuredContent: { windows: surface === "root" ? [] : [
        ...(surface === "folder" ? [{ pid: 91023, window_id: 101102, bounds: { x: 300, y: 180, width: 640, height: 180 }, z_index: 405 }] : []),
        { pid: 91023, window_id: 101101, bounds: { x: 200, y: 100, width: 881, height: 448 }, z_index: 401 },
        { pid: 91023, window_id: 100646, bounds: { x: 100, y: 100, width: 673, height: 439 }, z_index: 385 },
        { pid: 96262, window_id: 999999, bounds: { x: 0, y: 0, width: 900, height: 500 }, z_index: 410 },
      ] } };
      if (name === "list_windows") return { structuredContent: { windows: [
        { pid: 91023, window_id: 101101, bounds: { x: 200, y: 100, width: 881, height: 448 }, is_on_screen: true, on_current_space: true, z_index: 401 },
        { pid: 91023, window_id: 101102, bounds: { x: 300, y: 180, width: 640, height: 180 }, is_on_screen: true, on_current_space: true, z_index: 405 },
      ] } };
      return { structuredContent: {} };
    };
    const result = await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit",
      action: "computer_batch",
      actions: [{ type: "key", keys: ["CMD", "O"], delivery_mode: "foreground" }],
    });
    expect(result).toMatchObject({
      ok: true,
      batchInterrupted: true,
      interruptionReason: "actionable_context_changed",
      window_id: 101101,
    });
    expect(host.targets.get("textedit")).toMatchObject({ pid: 91023, window_id: 101101 });
    expect(calls.filter((call) => call.name === "get_accessibility_tree")).toHaveLength(1);
    expect(calls.find((call) => call.name === "list_windows")?.args).toEqual({});
    expect(calls.filter((call) => call.name === "get_window_state").at(-1)?.args)
      .toMatchObject({ pid: 91023, window_id: 101101 });
    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "textedit",
      action: "computer_batch",
      actions: [{ type: "key", keys: ["CMD", "SHIFT", "G"], delivery_mode: "foreground" }],
    })).toMatchObject({ ok: true, window_id: 101102 });
    expect(calls.filter((call) => call.name === "hotkey").map((call) => call.args.window_id))
      .toEqual([100646, 101101]);
  });

  it("fails closed for unlisted observation window ids without changing another session", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-panel-untrusted-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("a", { session: "a", pid: 42, window_id: 100 });
    host.targets.set("b", { session: "b", pid: 52, window_id: 500 });
    host.rootTargets.set("a", { session: "a", pid: 42, window_id: 100 });
    host.rootTargets.set("b", { session: "b", pid: 52, window_id: 500 });
    host.call = async (name: string, args: any) => {
      if (name === "get_window_state") return {
        structuredContent: {
          screenshot_png_b64: "PNG",
          elements: [],
          modal_window_id: args.window_id === 100 ? 999 : undefined,
        },
      };
      if (name === "list_windows") return { structuredContent: { windows: [
        { pid: 52, window_id: 500 },
      ] } };
      return { structuredContent: {} };
    };
    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "a",
      action: "computer_batch",
      actions: [{ type: "screenshot" }],
    })).toMatchObject({ ok: false, runtimeError: { code: "target_handoff_untrusted" } });
    expect(host.targets.get("a")).toMatchObject({ pid: 42, window_id: 100 });
    expect(host.targets.get("b")).toMatchObject({ pid: 52, window_id: 500 });
  });

  it("fails closed on a driver owner mismatch instead of trusting the reported pid", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-panel-owner-mismatch-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 800, height: 600 });
    host.targets.set("a", { session: "a", pid: 42, window_id: 100 });
    host.rootTargets.set("a", { session: "a", pid: 42, window_id: 100 });
    host.call = async (name: string) => {
      if (name === "get_window_state") throw Object.assign(
        new Error("closed driver error"),
        { code: "window_owner_pid_mismatch", owner_pid: 999 },
      );
      return { structuredContent: {} };
    };
    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "a",
      action: "computer_batch",
      actions: [{ type: "screenshot" }],
    })).toMatchObject({ ok: false, runtimeError: { code: "target_handoff_untrusted" } });
    expect(host.targets.get("a")).toMatchObject({ pid: 42, window_id: 100 });
  });

  it("uses a separate desktop-scoped session for untargeted observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-desktop-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      return name === "get_desktop_state"
        ? {
            content: [{ type: "text", text: "Desktop state" }],
            structuredContent: {
              screenshot_png_b64: "DESKTOP",
              screenshot_mime_type: "image/png",
              screenshot_width: 1440,
              screenshot_height: 900,
            },
          }
        : { structuredContent: {} };
    };
    expect(
      await host.handle({
        protocolVersion: 1,
        sessionKey: "observe",
        action: "computer_batch",
        actions: [{ type: "screenshot" }],
      }),
    ).toMatchObject({
      ok: true,
      base64: "DESKTOP",
      mimeType: "image/png",
      screenshot_width: 1440,
      screenshot_height: 900,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "start_session",
      "get_desktop_state",
    ]);
    const desktopSession = calls[0].args.session;
    expect(calls[0].args).toMatchObject({
      session: desktopSession,
      capture_scope: "desktop",
    });
    expect(desktopSession).not.toBe("observe");
    expect(calls[1].args).toEqual({ session: desktopSession });
  });

  it("recognizes only the driver's fixed session-ended rejection", () => {
    expect(isDriverSessionEndedError(new Error(
      "session 'pipiui-desktop-3518396c' has ended; tool call 'get_desktop_state' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.",
    ))).toBe(true);
    expect(isDriverSessionEndedError(new Error(
      "session 'a' has ended; tool call 'click' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.",
    ))).toBe(true);
    expect(isDriverSessionEndedError(new Error("window_id_not_found"))).toBe(false);
    expect(isDriverSessionEndedError(new Error("session 'a' has ended"))).toBe(false);
    expect(isDriverSessionEndedError(undefined)).toBe(false);
  });

  it("revives a driver-ended desktop session instead of failing forever", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-desktop-revive-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.proxy = { killed: false, exitCode: null, stdin: { writable: true, write: () => true } };
    host.daemon = { killed: false, exitCode: null };
    let driverEnded = false;
    let revived = false;
    let capture = 0;
    host.rpc = async (_method: string, params: any) => {
      const { name, arguments: args } = params;
      calls.push({ name, args });
      if (name === "start_session") {
        if (driverEnded) revived = true;
        return { result: { content: [], structuredContent: {} } };
      }
      if (name === "get_desktop_state") {
        if (driverEnded && !revived) {
          return { result: {
            isError: true,
            content: [{ type: "text", text: `session '${args.session}' has ended; tool call 'get_desktop_state' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.` }],
          } };
        }
        capture += 1;
        return { result: { structuredContent: {
          screenshot_png_b64: `DESKTOP-${capture}`,
          screenshot_mime_type: "image/png",
        } } };
      }
      return { result: { content: [], structuredContent: {} } };
    };

    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "observe",
      action: "computer_batch",
      actions: [{ type: "screenshot" }],
    })).toMatchObject({ ok: true, base64: "DESKTOP-1" });

    driverEnded = true;
    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "observe",
      action: "computer_batch",
      actions: [{ type: "screenshot" }],
    })).toMatchObject({ ok: true, base64: "DESKTOP-2" });

    const desktopSession = calls[0].args.session;
    expect(calls.map((call) => call.name)).toEqual([
      "start_session",
      "get_desktop_state",
      "get_desktop_state",
      "start_session",
      "get_desktop_state",
    ]);
    expect(calls[3].args).toEqual({
      session: desktopSession,
      capture_scope: "desktop",
    });
    expect(calls[4].args).toEqual({ session: desktopSession });
  });

  it("revives a driver-ended pinned window session before acting", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-window-revive-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.targets.set("win", { session: "win", pid: 42, window_id: 77 });
    host.rootTargets.set("win", { session: "win", pid: 42, window_id: 77 });
    host.sessionScopes.set("win", "window");
    host.proxy = { killed: false, exitCode: null, stdin: { writable: true, write: () => true } };
    host.daemon = { killed: false, exitCode: null };
    let driverEnded = true;
    let revived = false;
    let observations = 0;
    host.rpc = async (_method: string, params: any) => {
      const { name, arguments: args } = params;
      calls.push({ name, args });
      if (name === "start_session") {
        if (driverEnded) revived = true;
        return { result: { content: [], structuredContent: {} } };
      }
      if (name === "get_window_state") {
        if (driverEnded && !revived) {
          return { result: {
            isError: true,
            content: [{ type: "text", text: `session '${args.session}' has ended; tool call 'get_window_state' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.` }],
          } };
        }
        observations += 1;
        return { result: { structuredContent: {
          screenshot_png_b64: `PNG-${observations}`,
          snapshot_id: `snapshot-${observations}`,
          pid: 42,
          window_id: 77,
          elements: [{ role: "AXWindow", window_id: 77 }],
        } } };
      }
      return { result: { content: [], structuredContent: {} } };
    };

    expect(await host.handle({
      protocolVersion: 1,
      sessionKey: "win",
      action: "computer_batch",
      actions: [{ type: "click", coordinate: [10, 20] }],
    })).toMatchObject({ ok: true });
    expect(calls.map((call) => call.name)).toEqual([
      "get_window_state",
      "start_session",
      "get_window_state",
      "click",
      "get_window_state",
      "get_accessibility_tree",
    ]);
    expect(calls[1].args).toEqual({ session: "win", capture_scope: "window" });
  });

  it("surfaces non-session tool failures without a revive attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-no-revive-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, { displayID: 1, width: 1440, height: 900 });
    host.proxy = { killed: false, exitCode: null, stdin: { writable: true, write: () => true } };
    host.daemon = { killed: false, exitCode: null };
    host.rpc = async (_method: string, params: any) => {
      const { name } = params;
      calls.push({ name, args: params.arguments });
      if (name === "get_desktop_state") {
        return { result: {
          isError: true,
          content: [{ type: "text", text: "capture_failed on display 1" }],
        } };
      }
      return { result: { content: [], structuredContent: {} } };
    };
    await expect(host.call("get_desktop_state", { session: "pipiui-desktop-x" }))
      .rejects.toThrow("capture_failed on display 1");
    expect(calls.map((call) => call.name)).toEqual(["get_desktop_state"]);
  });
});

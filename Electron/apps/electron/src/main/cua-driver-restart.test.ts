import { build } from "esbuild";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CuaDriverHost } from "./cua-driver-host.js";

const here = dirname(fileURLToPath(import.meta.url));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
};

/**
 * Stands in for cua-driver with the contract the shipped binary was measured to have:
 * unknown flags are ignored in silence, and stdin EOF ends the process only when the host
 * armed CUA_DRIVER_PARENT_LIVENESS_STDIN — read off fd 0 directly, because Node keeps a FIFO
 * stdin open for writing behind `process.stdin` and would never report that EOF.
 * `honorLiveness: false` is the stuck daemon that survives its host — the shape that used to
 * brick every later launch.
 */
function fakeDriverSource(honorLiveness: boolean): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const readline = require("node:readline");
const mode = process.argv[2];
const socket = process.argv[process.argv.indexOf("--socket") + 1];
const armed = process.env.CUA_DRIVER_PARENT_LIVENESS_STDIN === "1";
const honor = ${honorLiveness ? "true" : "false"};
process.on("SIGTERM", () => {});
if (mode === "serve") {
  if (armed && honor) {
    const buffer = Buffer.alloc(64);
    const readUntilEof = () => fs.read(0, buffer, 0, 64, null, (error, bytes) => {
      if (error || bytes === 0) process.exit(0);
      readUntilEof();
    });
    readUntilEof();
  }
  net.createServer(() => {}).listen(socket);
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
  if (honor) lines.on("close", () => process.exit(0));
}
setInterval(() => {}, 1000);
`;
}

const HOST_RUNNER = `import { CuaDriverHost } from "./host-bundle.mjs";
const host = new CuaDriverHost(process.argv[2], { displayID: 1, width: 100, height: 100 });
const result = await host.handle({ protocolVersion: 1, action: "computer_runtime_capabilities" });
process.stdout.write(JSON.stringify({
  ok: result.ok,
  daemon: host.daemon?.pid,
  proxy: host.proxy?.pid,
}) + "\\n");
setInterval(() => {}, 1000);
`;

type Generation = { host: ChildProcess; daemon: number; proxy: number };

describe("CuaDriverHost restart", () => {
  const roots: string[] = [];
  const strays: number[] = [];
  afterEach(async () => {
    for (const pid of strays.splice(0)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await Promise.all(
      roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  /** A host in its own process, so the test can end it the way a crash or Force Quit does. */
  async function launchHost(honorLiveness: boolean): Promise<{ helper: string; generation: Generation }> {
    const root = await mkdtemp(join(tmpdir(), "cua-restart-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, fakeDriverSource(honorLiveness));
    await chmod(helper, 0o755);
    await build({
      entryPoints: [join(here, "cua-driver-host.ts")],
      outfile: join(root, "host-bundle.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const runner = join(root, "host-runner.mjs");
    await writeFile(runner, HOST_RUNNER);
    const host = spawn(process.execPath, [runner, helper], { stdio: ["ignore", "pipe", "pipe"] });
    strays.push(host.pid!);
    let out = "";
    let stderr = "";
    host.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`; });
    const started = await new Promise<Record<string, number>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`host never started: ${stderr}`)), 20_000);
      host.stdout.on("data", (chunk) => {
        out = `${out}${chunk}`;
        const line = out.split("\n").find(Boolean);
        if (!line) return;
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
    });
    expect(started.ok).toBe(true);
    strays.push(started.daemon, started.proxy);
    return { helper, generation: { host, daemon: started.daemon, proxy: started.proxy } };
  }

  it.skipIf(process.platform !== "darwin")(
    "takes the driver generation down with an abruptly killed host",
    async () => {
      const { helper, generation } = await launchHost(true);

      generation.host.kill("SIGKILL");

      // The liveness pipe is the only thing that can reach a daemon whose host never
      // got to run teardown code; without it this daemon outlives the machine's uptime.
      expect(await waitFor(() => !alive(generation.daemon), 10_000)).toBe(true);
      expect(await waitFor(() => !alive(generation.proxy), 10_000)).toBe(true);

      // And the next launch is clean rather than fenced off by its predecessor.
      const next = new CuaDriverHost(helper, { displayID: 1, width: 100, height: 100 });
      try {
        await expect(next.handle({
          protocolVersion: 1,
          action: "computer_runtime_capabilities",
        })).resolves.toMatchObject({ ok: true });
      } finally {
        await next.shutdown();
      }
    },
    60_000,
  );

  it("restarts over a stuck orphan instead of refusing forever", async () => {
    const { helper, generation } = await launchHost(false);

    generation.host.kill("SIGKILL");
    await waitFor(() => !alive(generation.host.pid!), 5_000);
    // This driver ignores liveness, so it is still running with no owner — the exact
    // state that used to answer every later call with "previous generation is still running".
    expect(alive(generation.daemon)).toBe(true);

    const next = new CuaDriverHost(helper, { displayID: 1, width: 100, height: 100 });
    try {
      await expect(next.handle({
        protocolVersion: 1,
        action: "computer_runtime_capabilities",
      })).resolves.toMatchObject({ ok: true });
      expect(alive(generation.daemon)).toBe(false);
      expect(alive(generation.proxy)).toBe(false);
    } finally {
      await next.shutdown();
    }
  }, 60_000);
});

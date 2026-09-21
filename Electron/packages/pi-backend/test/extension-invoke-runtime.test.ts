import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiHostBackend } from "../src/index.js";

let root = "";
let backend: ReturnType<typeof createPiHostBackend> | undefined;
const children: ChildProcess[] = [];
afterEach(async () => {
  await backend?.close();
  backend = undefined;
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise<void>((done) => {
      child.once("exit", () => done());
      child.kill("SIGKILL"); // Only the test-owned Node CLI, never the PipiUI host.
    });
  }
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function installedCli() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const candidates = [
    process.env.PIPIUI_TEST_PI_CLI,
    join(repo, "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    // Managed worktrees share the primary checkout's already-installed CLI.
    join(repo, "../../..", "build/PipiUI.app/Contents/Resources/pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    if (await access(path).then(() => true, () => false)) return path;
  }
  throw new Error(`Installed Pi CLI required (no skip/install fallback). Checked: ${candidates.join(", ")}`);
}

it("invokes a real installed Pi registerCommand via native prompt, without models or credentials", async () => {
  const cli = await installedCli();
  root = await mkdtemp(join(tmpdir(), "pipi-invoke-runtime-"));
  const project = join(root, "project");
  const agent = join(project, ".pi", "agent");
  const sessions = join(root, "sessions");
  const pkg = join(agent, "extensions", "invoke-agent");
  const fixture = join(pkg, "agent", "index.mjs");
  const log = join(root, "command.jsonl");
  const networkLog = join(root, "network.log");
  const guard = join(root, "no-network.cjs");
  await mkdir(dirname(fixture), { recursive: true });
  await mkdir(join(sessions, "project"), { recursive: true });
  await writeFile(join(pkg, "pipiui-extension.json"), JSON.stringify({
    id: "invoke-agent", name: "Invoke fixture", version: "1.0.0",
    capabilities: ["invoke.agent"], agent: { extension: "agent/index.mjs" },
  }));
  await writeFile(join(sessions, "project", "session.jsonl"), JSON.stringify({
    type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd: project,
  }) + "\n");
  await writeFile(guard, `
const fs = require('node:fs');
const blocked = () => {
  fs.appendFileSync(process.env.NETWORK_LOG, 'unexpected network attempt\\n');
  throw new Error('Network forbidden in invoke runtime test');
};
require('node:net').Socket.prototype.connect = blocked;
require('node:http').request = blocked;
require('node:https').request = blocked;
globalThis.fetch = blocked;
require('node:module').syncBuiltinESMExports();
`);
  await writeFile(fixture, `
import { appendFileSync } from 'node:fs';
const record = (value) => appendFileSync(process.env.INVOKE_LOG, JSON.stringify(value) + '\\n');
export default function (pi) {
  pi.registerCommand('invoke-agent', {
    handler: async (args) => {
      record({ type: 'command', args, envelope: JSON.parse(args) });
      if (JSON.parse(args).method === 'fail') throw new Error('fixture handler failure');
      return { mustNotBecomeRpcData: true };
    },
  });
  // Fail closed if any control message ever falls through command dispatch.
  pi.on('input', () => { record({ type: 'unexpected_input' }); return { action: 'handled' }; });
  pi.on('before_agent_start', () => { record({ type: 'unexpected_model' }); throw new Error('No model calls allowed'); });
}
`);
  const wire: Record<string, unknown>[] = [];
  let stdout = "";
  let stderr = "";
  backend = createPiHostBackend({
    agentDir: agent, sessionsRoot: sessions, runtimeRoot: join(root, "runtime"),
    canonicalProjectPaths: async () => undefined,
    piPath: process.execPath,
    extensionInvokeTimeoutMs: 5000,
    spawn: (_bin, _args, options) => {
      const child = spawn(process.execPath, [
        "--require", guard, cli, "--mode", "rpc", "--no-session", "--no-extensions",
        "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "-e", fixture,
      ], {
        ...options, cwd: project,
        // Do not inherit credentials, proxies, user homes, or NODE_OPTIONS.
        env: {
          PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), ELECTRON_RUN_AS_NODE: "1",
          PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
          INVOKE_LOG: log, NETWORK_LOG: networkLog,
        },
      });
      children.push(child);
      child.stdout?.on("data", (data) => { stdout += data.toString(); });
      child.stderr?.on("data", (data) => { stderr += data.toString(); });
      const write = child.stdin!.write.bind(child.stdin!);
      child.stdin!.write = ((chunk: string, ...args: any[]) => {
        wire.push(JSON.parse(String(chunk)));
        return (write as any)(chunk, ...args);
      }) as typeof child.stdin.write;
      return child as any;
    },
  });
  await backend.handle("listExtensions" as never, []);
  await backend.handle("setExtensionEnabled" as never, ["invoke-agent", true, "app"]);
  await backend.handle("addProject", [project]);
  // Start the live session with a control command, never an ordinary prompt.
  await backend.handle("sendPrompt", ["session-1", '/invoke-agent {"method":"bootstrap","params":{}}']);
  const params = { requestId: "fixture-request", text: 'quotes " /other\nline\t中文\u2028' };
  const ack = await backend.handle("invokeExtension" as never, [
    "invoke-agent", "ping", params, { sessionId: "session-1" },
  ]);
  expect(ack, stderr + stdout).toEqual({ ok: true, data: undefined });
  const records = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(records).toEqual([
    { type: "command", args: '{"method":"bootstrap","params":{}}', envelope: { method: "bootstrap", params: {} } },
    { type: "command", args: JSON.stringify({ method: "ping", params }), envelope: { method: "ping", params } },
  ]);
  const prompt = wire.find((value) => value.type === "prompt" && String(value.message).includes("fixture-request"));
  expect(prompt).toEqual({ id: expect.any(String), type: "prompt", message: `/invoke-agent ${JSON.stringify({ method: "ping", params })}` });
  expect(wire.some((value) => value.type === "get_commands")).toBe(true);
  expect(wire.some((value) => value.type === "invokeExtension")).toBe(false);
  // Native Pi acknowledges handled commands even when the handler throws.
  const failed = await backend.handle("invokeExtension" as never, ["invoke-agent", "fail", {}, { sessionId: "session-1" }]);
  expect(failed).toEqual({ ok: true, data: undefined });
  expect(stdout).toContain('"type":"extension_error"');
  expect(stdout).toContain("fixture handler failure");
  expect(stdout + stderr).not.toContain("Unknown command");
  expect(stdout).not.toContain('"type":"agent_start"');
  expect(await readFile(networkLog, "utf8").catch(() => "")).toBe("");
}, 20_000);

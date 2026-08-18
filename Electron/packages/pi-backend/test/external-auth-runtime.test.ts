import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPiHostBackend } from "../src/index.js";
import { ExternalAuthRuntime, modelRuntimeEnvironment } from "../src/external-auth-runtime.js";

const fixture = `
import { createInterface } from "node:readline";
const command = process.argv[2];
const secret = process.env.XAI_API_KEY;
function models() {
  return { models: [
    {provider:"openai-codex",id:"gpt-5.4",reasoning:true},
    ...(secret ? [{provider:"xai",id:"grok-4.5",reasoning:true,thinkingLevelMap:{off:null,minimal:"minimal",low:"low",medium:"medium",high:"high",xhigh:"xhigh",max:null},compat:{supportsReasoningEffort:true}}] : [])
  ]};
}
function providers() {
  return { providers:[{id:"xai",name:"xAI",auth:{apiKey:{}}}] };
}
if (command === "serve") {
  const rl = createInterface({ input: process.stdin });
  console.log(JSON.stringify({ready:true}));
  rl.on("line", line => {
    const req = JSON.parse(line);
    try {
      if (req.cmd === "reload") console.log(JSON.stringify({id:req.id, ok:true, data:{}}));
      else if (req.cmd === "list-models") console.log(JSON.stringify({id:req.id, ok:true, data:models()}));
      else if (req.cmd === "list-providers") console.log(JSON.stringify({id:req.id, ok:true, data:providers()}));
      else if (req.cmd === "logout") console.log(JSON.stringify({id:req.id, ok:true, data:{}}));
      else console.log(JSON.stringify({id:req.id, ok:false, error:"unknown "+req.cmd}));
    } catch (e) { console.log(JSON.stringify({id:req.id, ok:false, error:String(e)})); }
  });
} else if (command === "login-json") {
  console.log(JSON.stringify({event:"prompt",prompt:{type:"secret",message:"API key"}}));
  process.stdin.once("data", data => { const answer=JSON.parse(String(data)).answer; console.log(JSON.stringify({ok:true,result:{accepted:answer.length}})); });
} else if (command === "list-models") console.log(JSON.stringify({ok:true, ...models()}));
else if (command === "list-providers") console.log(JSON.stringify({ok:true, ...providers()}));
else if (command === "profile-env") console.log(JSON.stringify({ok:true,agentDir:process.env.PI_CODING_AGENT_DIR,sessionsRoot:process.env.PI_CODING_AGENT_SESSION_DIR}));
else if (command === "logout") console.log(JSON.stringify({ok:true}));
else process.exit(2);
`;
// Same serve protocol but never exits, used to exercise manual worker death + lazy respawn.
const serveOnlyFixture = `
import { createInterface } from "node:readline";
if (process.argv[2] !== "serve") process.exit(3);
const rl = createInterface({ input: process.stdin });
console.log(JSON.stringify({ready:true}));
rl.on("line", line => {
  const req = JSON.parse(line);
  if (req.cmd === "reload") return console.log(JSON.stringify({id:req.id, ok:true, data:{}}));
  console.log(JSON.stringify({id:req.id, ok:true, data:{models:[]}}));
});
`;
// Fails to start the resident worker but supports the legacy one-shot mode (fallback path).
const oneShotOnlyFixture = `
const command = process.argv[2];
if (command === "serve") process.exit(7);
if (command === "list-models") console.log(JSON.stringify({ok:true,models:[{provider:"openai-codex",id:"gpt-4.5",reasoning:true}]}));
else process.exit(2);
`;
// Serializes commands with a per-command delay; used to prove queued commands do
// not take the waiting time into their own RPC timeout budget.
const slowFixture = `
import { createInterface } from "node:readline";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(cmd) {
  if (cmd === "slow") await sleep(100);
  return { models: [{ provider: "openai-codex", id: "gpt-5.4", reasoning: true }] };
}
const rl = createInterface({ input: process.stdin });
console.log(JSON.stringify({ready:true}));
for await (const line of rl) {
  const req = JSON.parse(line);
  if (req.cmd === "reload") { console.log(JSON.stringify({id:req.id, ok:true, data:{}})); continue; }
  const data = await run(req.cmd);
  console.log(JSON.stringify({id:req.id, ok:true, data}));
}
`;
// A command the resident worker never answers ("hang") plus working list-models,
// both available one-shot so the timeout fallback path keeps the worker alive
// instead of cascading.
// Logs every serve start so a test can assert only one worker was ever spawned.
const spawnCountFixture = `
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function models() { return { models: [{provider:"openai-codex",id:"gpt-5.4",reasoning:true}] }; }
function providers() { return { providers:[{id:"xai",name:"xAI",auth:{apiKey:{}}}] }; }
if (process.argv[2] === "serve") {
  mkdirSync(dirname(process.env.SPAWN_LOG), { recursive: true });
  appendFileSync(process.env.SPAWN_LOG, "x\\n");
  const rl = createInterface({ input: process.stdin });
  console.log(JSON.stringify({ready:true}));
  rl.on("line", line => {
    const req = JSON.parse(line);
    if (req.cmd === "reload") return console.log(JSON.stringify({id:req.id, ok:true, data:{}}));
    if (req.cmd === "list-models") return console.log(JSON.stringify({id:req.id, ok:true, data:models()}));
    if (req.cmd === "list-providers") return console.log(JSON.stringify({id:req.id, ok:true, data:providers()}));
    console.log(JSON.stringify({id:req.id, ok:false, error:"unknown "+req.cmd}));
  });
} else if (process.argv[2] === "list-models") console.log(JSON.stringify({ok:true, ...models()}));
else if (process.argv[2] === "list-providers") console.log(JSON.stringify({ok:true, ...providers()}));
else process.exit(2);
`;
// A command the resident worker never answers ("hang") plus working list-models,
// both available one-shot so the timeout fallback path keeps the worker alive
// instead of cascading.
const hangFixture = `
import { createInterface } from "node:readline";
function models() { return { models: [{ provider: "openai-codex", id: "gpt-5.4", reasoning: true }] }; }
if (process.argv[2] === "serve") {
  const rl = createInterface({ input: process.stdin });
  console.log(JSON.stringify({ready:true}));
  for await (const line of rl) {
    const req = JSON.parse(line);
    if (req.cmd === "hang") continue; // never respond -> genuine timeout
    if (req.cmd === "reload") { console.log(JSON.stringify({id:req.id, ok:true, data:{}})); continue; }
    console.log(JSON.stringify({id:req.id, ok:true, data:models()}));
  }
} else if (process.argv[2] === "list-models" || process.argv[2] === "hang") {
  console.log(JSON.stringify({ok:true, ...models()}));
} else process.exit(2);
`;

describe("external Pi model runtime", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); });

  it("uses the external helper and overlays .env under a Finder-like sparse environment without exposing values", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-auth-"));
    const agentDir = join(root, "agent");
    const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir);
    await writeFile(join(agentDir, ".env"), "XAI_API_KEY=do-not-expose\n");
    await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root, PATH: "/usr/bin:/bin" } });
    const models = await runtime.getAvailable();
    expect(models.map(model => `${model.provider}/${model.id}`)).toEqual(["openai-codex/gpt-5.4", "xai/grok-4.5"]);
    expect(models[1]).toMatchObject({
      thinkingLevelMap: { off: null, minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
      compat: { supportsReasoningEffort: true },
    });
    expect(JSON.stringify(models)).not.toContain("do-not-expose");
    runtime.stop();
  });

  it("uses the embedded Pi command's Node for auth without an external Node lookup", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-backend-"));
    const agentDir = join(root, "agent");
    const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir);
    await writeFile(helperPath, fixture);
    const piCommand = { executable: process.execPath, prefixArgs: ["/bundle/pi/dist/cli.js"], piPath: "/bundle/pi/bin/pi", env: { PIPIUI_NODE_PATH: process.execPath, PIPIUI_PI_PATH: "/bundle/pi/bin/pi" } };
    const backend = createPiHostBackend({ agentDir, authHelperPath: helperPath, piCommand, env: { HOME: root, PATH: "/usr/bin:/bin" } });
    expect((await backend.handle("listModels", []) as any[]).map(model => `${model.provider}/${model.id}`)).toEqual(["openai-codex/gpt-5.4"]);
    await writeFile(helperPath, "throw new Error('node:sqlite unavailable')\n");
    const failed = createPiHostBackend({ agentDir, authHelperPath: helperPath, piCommand, env: { HOME: root } });
    await expect(failed.handle("listModels", [])).rejects.toThrow("Pi 模型目录不可用");
    await backend.close();
    await failed.close();
  });

  it("forces auth helpers onto the isolated profile despite conflicting parent and .env values", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-profile-env-"));
    const agentDir = join(root, "agent");
    const sessionsRoot = join(root, "sessions");
    const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir);
    await writeFile(join(agentDir, ".env"), "PI_CODING_AGENT_DIR=/global-dotenv\nPI_CODING_AGENT_SESSION_DIR=/global-dotenv/sessions\n");
    await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({
      helperPath,
      agentDir,
      sessionsRoot,
      enforceProfile: true,
      piPath: "/opt/homebrew/bin/pi",
      nodePath: process.execPath,
      env: { HOME: root, PI_CODING_AGENT_DIR: "/global-parent", PI_CODING_AGENT_SESSION_DIR: "/global-parent/sessions" },
    });
    const actual = await (runtime as any).command("profile-env");
    expect(actual).toMatchObject({ agentDir, sessionsRoot });
    runtime.stop();
  });

  it("preserves interactive login while keeping the API key off argv and result events", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-login-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const secret = "sk-never-serialize";
    const result = await runtime.login("xai", "api_key", { prompt: async () => secret, notify: () => undefined });
    expect(result).toEqual({ accepted: secret.length });
    expect(JSON.stringify(result)).not.toContain(secret);
    runtime.stop();
  });

  it("reuses a single resident worker across multiple commands instead of re-spawning", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-reuse-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const m1 = await runtime.getAvailable();
    const p = await runtime.getProviders();
    const m2 = await runtime.getAvailable();
    expect(m1.length).toBe(1);
    expect(p.length).toBe(1);
    expect(m2.length).toBe(1);
    // Same worker handles all three queries: capture its pid and confirm it never changed.
    const pid = (runtime as any).worker?.child?.pid as number;
    expect(pid).toBeGreaterThan(0);
    expect((runtime as any).worker?.child?.pid).toBe(pid);
    await runtime.getAvailable();
    expect((runtime as any).worker?.child?.pid).toBe(pid);
    runtime.stop();
  });

  it("reloads the same worker's cache after an auth change instead of re-spawning", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-reload-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, fixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const pidBefore = (await runtime.getAvailable(), (runtime as any).worker?.child?.pid as number);
    await runtime.getAvailable();
    await expect(runtime.reload()).resolves.toBeUndefined();
    await runtime.getAvailable();
    expect((runtime as any).worker?.child?.pid).toBe(pidBefore);
    runtime.stop();
  });

  it("lazily respawns a resident worker after it dies mid-run", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-respawn-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, serveOnlyFixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const first = await runtime.getAvailable();
    expect((first as any[]).length).toBe(0);
    const pidBefore = (runtime as any).worker?.child?.pid as number;
    expect(pidBefore).toBeGreaterThan(0);
    // Simulate a sudden worker death, then confirm the next query lazily respawns a fresh worker.
    (runtime as any).worker.kill();
    const second = await runtime.getAvailable();
    expect((second as any[]).length).toBe(0);
    const pidAfter = (runtime as any).worker?.child?.pid as number;
    expect(pidAfter).toBeGreaterThan(0);
    expect(pidAfter).not.toBe(pidBefore);
    runtime.stop();
  });

  it("falls back to the one-shot execFile path when the resident worker cannot start", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-fallback-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    await mkdir(agentDir); await writeFile(helperPath, oneShotOnlyFixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root } });
    const models = await runtime.getAvailable();
    expect(models.map((m: any) => `${m.provider}/${m.id}`)).toEqual(["openai-codex/gpt-4.5"]);
    // The worker could not start, so the runtime should have cleared its reference.
    expect((runtime as any).worker).toBeUndefined();
    runtime.stop();
  });

  it("keeps ELECTRON_RUN_AS_NODE on a sparse Finder-like auth helper env", async () => {
    const env = await modelRuntimeEnvironment(
      "/missing-agent",
      "/opt/homebrew/bin/pi",
      { HOME: "/tmp", PATH: "/usr/bin:/bin" },
    );
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("(A) concurrent first calls spawn the resident worker exactly once (single-flight)", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-dedup-"));
    const agentDir = join(root, "agent"); const helperPath = join(root, "helper.mjs");
    const spawnLog = join(root, "spawns.log");
    await mkdir(agentDir);
    await writeFile(helperPath, spawnCountFixture);
    const runtime = new ExternalAuthRuntime({ helperPath, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root, SPAWN_LOG: spawnLog } });
    // Fire two first-use calls concurrently: the startup preload (runtimeModels)
    // racing listProviders->getProviders. Both must share one spawn.
    const [models, providers] = await Promise.all([runtime.getAvailable(), runtime.getProviders()]);
    expect(Array.isArray(models)).toBe(true);
    expect(Array.isArray(providers)).toBe(true);
    // Both calls returned results backed by the SAME worker (same child pid).
    const pid = (runtime as any).worker?.child?.pid as number;
    expect(pid).toBeGreaterThan(0);
    // The serve helper was started exactly once (one worker, no orphaned loser).
    expect((await readFile(spawnLog, "utf8")).trim()).toBe("x");
    // Still resolves on the same worker afterwards; a later call reuses it.
    await runtime.getAvailable();
    expect((runtime as any).worker?.child?.pid).toBe(pid);
    runtime.stop();
  });

  it("(B) queued commands don't false-timeout from queue-wait; a genuine timeout falls back without cascade", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-external-queue-timeout-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    // --- queue-wait must not count toward a single command's timeout budget ---
    const slowHelper = join(root, "slow.mjs");
    await writeFile(slowHelper, slowFixture);
    const slowRuntime = new ExternalAuthRuntime({ helperPath: slowHelper, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root }, rpcTimeoutMs: 250 });
    // Each command does 100ms of work; 4 of them serialized = 400ms cumulative.
    // With the timeout armed at request-creation the 3rd/4th would false-timeout
    // while still waiting to be written; armed at write time they all resolve.
    await (slowRuntime as any).rpc("reload"); // warm the worker so timing is deterministic
    const firstPid = (slowRuntime as any).worker?.child?.pid as number;
    expect(firstPid).toBeGreaterThan(0);
    const results = await Promise.all([
      (slowRuntime as any).rpc("slow"),
      (slowRuntime as any).rpc("slow"),
      (slowRuntime as any).rpc("slow"),
      (slowRuntime as any).rpc("slow"),
    ]);
    expect(results).toHaveLength(4);
    results.forEach(r => expect((r as any).models).toBeDefined());
    // The healthy worker was not killed / cascade-rebuilt by the queue pressure.
    expect((slowRuntime as any).worker?.child?.pid).toBe(firstPid);
    slowRuntime.stop();

    // --- only a genuine timeout falls back, and it keeps the worker alive (no cascade) ---
    const hangHelper = join(root, "hang.mjs");
    await writeFile(hangHelper, hangFixture);
    const hangRuntime = new ExternalAuthRuntime({ helperPath: hangHelper, agentDir, piPath: "/opt/homebrew/bin/pi", nodePath: process.execPath, env: { HOME: root }, rpcTimeoutMs: 300 });
    // Warm the worker with a normal command (reload is instant in the fixture).
    await hangRuntime.getAvailable();
    const warmPid = (hangRuntime as any).worker?.child?.pid as number;
    expect(warmPid).toBeGreaterThan(0);
    // "hang" never gets answered by the resident worker -> genuine timeout. query
    // falls back THIS command to the one-shot execFile path and MUST keep the
    // worker alive (no cascade kill).
    const fellBack = await (hangRuntime as any).query("hang");
    expect((fellBack as any).models).toBeDefined();
    // Worker still alive and reused by the next command on the same worker.
    expect((hangRuntime as any).worker?.disposed).toBe(false);
    expect((hangRuntime as any).worker?.child?.exitCode).toBeNull();
    const after = await hangRuntime.getAvailable();
    expect(Array.isArray(after)).toBe(true);
    expect((hangRuntime as any).worker?.child?.pid).toBe(warmPid);
    hangRuntime.stop();
  });
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagesRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages");
const brokerRoot = join(packagesRoot, "memory-broker");
const adapter = await import(pathToFileURL(join(brokerRoot, "src/hermes-adapter.ts")).href);
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");
const piCLI = join(homedir(), ".npm-global/bin/pi");

function isolatedEnvironment(root, extra = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PIPIUI_")));
  return {
    ...inherited,
    HOME: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    ...extra,
  };
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureSymlink(target, link) {
  if (await exists(link)) return;
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link, "dir");
}

async function copyBrokerPackage(root) {
  const destination = join(root, "packages/memory-broker");
  // A developer checkout may contain npm's local cache/install tree. The
  // fixture must instead resolve the pinned runtime installed at `root`.
  await cp(brokerRoot, destination, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
  await cp(join(packagesRoot, "memory-broker-contract"), join(root, "packages/memory-broker-contract"), { recursive: true });
  return destination;
}

function appendBounded(current, chunk) {
  return `${current}${chunk}`.slice(-8_000);
}

function waitForChildExit(child, milliseconds, stage, output) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[${stage}] timed out after ${milliseconds}ms. Output:\n${output()}`));
    }, milliseconds);
    timer.unref();
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`[${stage}] failed to start: ${error.message}`));
    });
  });
}

async function stopTestChild(child, milliseconds, stage, output) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  child.stdin?.end();
  try {
    return await waitForChildExit(child, milliseconds, stage, output);
  } catch {
    // This is only the isolated temporary Pi/npm child spawned by this test,
    // never the user-owned PipiUI host process.
    child.kill("SIGTERM");
    return await waitForChildExit(child, 5_000, `${stage}: SIGTERM cleanup`, output);
  }
}

async function installHermesRuntime(root, packageDirectory) {
  const env = isolatedEnvironment(root, { npm_config_cache: join(root, "npm-cache") });
  // bundledDependencies are present for distributable Pi packages. Put the
  // explicit test install at the temporary parent module root so Node/Jiti can
  // resolve it from the copied package without mutating package metadata.
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "pipiui-hermes-fixture", private: true, type: "module" }), "utf8");
  const child = spawn("npm", ["install", "--prefix", root, "--omit=dev", "--no-audit", "--no-fund", "pi-hermes-memory@0.9.4"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = appendBounded(output, chunk); });
  child.stderr.on("data", (chunk) => { output = appendBounded(output, chunk); });
  const code = await stopTestChild(child, 100_000, "npm install pi-hermes-memory@0.9.4", () => output);
  if (code !== 0) throw new Error(`[npm install pi-hermes-memory@0.9.4] exited ${code}. Output:\n${output}`);
  await Promise.all([
    ensureSymlink(piPackageRoot, join(packageDirectory, "node_modules/@earendil-works/pi-coding-agent")),
    ensureSymlink(join(piNodeModules, "typebox"), join(packageDirectory, "node_modules/typebox")),
  ]);
  assert.equal(await exists(join(root, "node_modules/pi-hermes-memory/package.json")), true,
    "temporary npm fixture must contain the pinned Hermes package");
}

async function linkPiPeers(root, packageDirectory) {
  await Promise.all([
    mkdir(join(root, "home"), { recursive: true }),
    mkdir(join(root, "agent"), { recursive: true }),
    mkdir(join(root, "project"), { recursive: true }),
    ensureSymlink(piPackageRoot, join(packageDirectory, "node_modules/@earendil-works/pi-coding-agent")),
    ensureSymlink(join(piNodeModules, "typebox"), join(packageDirectory, "node_modules/typebox")),
  ]);
}

async function waitForFile(path, milliseconds, stage) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await exists(path)) return;
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 50);
      timer.unref();
    });
  }
  throw new Error(`[${stage}] timed out waiting for ${path} after ${milliseconds}ms.`);
}

async function runPiProbe({ root, extensions, mode, probeCommand, outputPath, extraEnv = {} }) {
  const env = isolatedEnvironment(root, {
    PIPIUI_MEMORY_BROKER_MODE: mode,
    PROBE_RESULT: outputPath,
    ...extraEnv,
  });
  const args = [
    "--mode", "rpc",
    "--no-session",
    "--offline",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    ...extensions.flatMap((extension) => ["-e", extension]),
  ];
  const child = spawn(piCLI, args, { cwd: join(root, "project"), env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.stdin.on("error", () => {});
  const output = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
  let stage = "starting Pi RPC";
  try {
    stage = "sending RPC probe command";
    child.stdin.write(`${JSON.stringify({ id: "probe", type: "prompt", message: `/${probeCommand}` })}\n`);
    stage = "waiting for probe result";
    await waitForFile(outputPath, 45_000, stage);
    stage = "requesting isolated Pi session shutdown";
    child.stdin.end();
    const code = await stopTestChild(child, 15_000, stage, output);
    if (code !== 0) throw new Error(`[${stage}] Pi RPC exited ${code}. ${output()}`);
    return { output: JSON.parse(await readFile(outputPath, "utf8")), stdout, stderr };
  } catch (error) {
    try {
      await stopTestChild(child, 5_000, `${stage}: cleanup`, output);
    } catch (cleanupError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n[cleanup] ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n${output()}`);
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output()}`);
  }
}

test("Hermes configuration merge preserves unknown keys and forces broker invariants", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-hermes-config-"));
  try {
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const configPath = join(agent, "hermes-memory-config.json");
    await writeFile(configPath, JSON.stringify({
      memoryMode: "legacy-inject",
      flushOnCompact: true,
      reviewEnabled: false,
      future: { retained: true },
    }), "utf8");
    const merged = await adapter.mergeHermesConfiguration({ PI_CODING_AGENT_DIR: agent });
    assert.equal(merged.configPath, configPath);
    assert.equal(merged.config.memoryMode, "policy-only");
    assert.equal(merged.config.flushOnCompact, false);
    assert.equal(merged.config.reviewEnabled, false);
    assert.deepEqual(merged.config.future, { retained: true });
    const [extensionSource, adapterSource] = await Promise.all([
      readFile(join(brokerRoot, "src/extension.ts"), "utf8"),
      readFile(join(brokerRoot, "src/hermes-adapter.ts"), "utf8"),
    ]);
    assert.doesNotMatch(`${extensionSource}\n${adapterSource}`, /session_before_compact/,
      "the broker must not add a second compaction hook beside upstream Hermes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Hermes main RPC load provides native FTS status/query/submit while quarantined experience is durably queued", { timeout: 300_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-hermes-main-"));
  try {
    const packageDirectory = await copyBrokerPackage(root);
    await installHermesRuntime(root, packageDirectory);
    await linkPiPeers(root, packageDirectory);
    const probe = join(root, "a-main-probe.ts");
    const resultPath = join(root, "main-result.json");
    await writeFile(probe, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
export default function (pi) {
  pi.registerCommand("broker-main-probe", {
    description: "test-only broker probe",
    async handler(_args, ctx) {
      const { MemoryBrokerServer } = await import("./packages/memory-broker/src/server.ts");
      const { createMemoryBrokerClient, makeTerminalExperienceCandidate, submitTerminalExperienceCandidate } = await import("./packages/memory-broker/src/client.ts");
      const { createHermesMemoryBrokerBackend } = await import("./packages/memory-broker/src/hermes-adapter.ts");
      const backend = await createHermesMemoryBrokerBackend();
      const broker = new MemoryBrokerServer({ projectRoot: ctx.cwd, chatSessionID: "probe-session", backend });
      await broker.start();
      try {
        const before = await broker.handleMainRequest({ version: 1, operation: "memory.status" });
        const durable = await broker.handleMainRequest({
          version: 1,
          operation: "experience.submit",
          promote: true,
          candidate: {
            kind: "experience", claimKind: "outcome", claim: "native fts broker phrase", scope: "project", provenance: "outcome", outcome: "success",
            evidence: [{ summary: "native adapter integration" }], sourceRuns: ["probe-run"],
          },
        });
        const query = await broker.handleMainRequest({
          version: 1, operation: "memory.query", query: { text: "native fts broker phrase", scope: "project", budget: 400 },
        });
        const workerEnvironment = broker.issueChildCapability({ agentID: "worker-probe", runID: "child-run", role: "worker" });
        const worker = createMemoryBrokerClient(workerEnvironment);
        const terminalCandidate = makeTerminalExperienceCandidate({
          runID: "child-run", task: "Queue terminal experience", terminalText: "queued experience phrase", outcome: "success",
        });
        await submitTerminalExperienceCandidate(worker, {
          runID: "child-run", task: "Queue terminal experience", terminalText: "queued experience phrase", outcome: "success",
        });
        const queued = { ok: !!terminalCandidate, candidate: terminalCandidate };
        const after = await broker.handleMainRequest({ version: 1, operation: "memory.status" });
        const tools = pi.getAllTools().map((tool) => tool.name).sort();
        const commands = pi.getCommands().map((command) => command.name).sort();
        const config = JSON.parse(readFileSync(process.env.PI_CODING_AGENT_DIR + "/hermes-memory-config.json", "utf8"));
        const queuePath = process.env.PI_CODING_AGENT_DIR + "/pi-hermes-memory/pipiui-memory-broker-experience-v1.jsonl";
        writeFileSync(process.env.PROBE_RESULT, JSON.stringify({
          before, durable, query, queued, after, tools, commands, config,
          queueExists: existsSync(queuePath),
          queue: existsSync(queuePath) ? readFileSync(queuePath, "utf8") : "",
        }));
      } finally {
        await broker.close();
      }
    },
  });
}
`, "utf8");
    const { output, stdout: outputText, stderr } = await runPiProbe({
      root,
      extensions: [probe, join(packageDirectory, "extensions/memory-broker.ts")],
      mode: "main",
      probeCommand: "broker-main-probe",
      outputPath: resultPath,
    });
    const diagnostics = () => JSON.stringify({ output, stdout: outputText, stderr }, null, 2);
    assert.equal(stderr, "", diagnostics());
    assert.equal(output.before.status.ready, true, diagnostics());
    assert.match(output.before.status.detail, /Hermes 0\.9\.4 FTS backend is ready/);
    assert.equal(output.durable.ok, true);
    assert.equal(output.query.ok, true);
    assert.equal(output.query.results[0].claim, "native fts broker phrase");
    assert.equal(output.queued.ok, true);
    assert.equal(output.queued.candidate.provenance, "brief");
    assert.equal(output.queued.candidate.scope, "session");
    assert.equal(output.after.status.ready, true);
    assert.match(output.after.status.detail, /1 verified experience candidate is pending trusted review/);
    assert.equal(output.queueExists, true);
    assert.match(output.queue, /"version":1/);
    assert.match(output.queue, /queued experience phrase/);
    assert.equal(output.config.memoryMode, "policy-only");
    assert.equal(output.config.flushOnCompact, false);
    assert.ok(output.tools.includes("memory_query"));
    assert.ok(output.tools.includes("memory_status"));
    assert.ok(output.tools.includes("memory_search"), "upstream Hermes extension must be registered in main mode");
    assert.ok(output.commands.includes("memory-insights"), "upstream Hermes command surface proves main composition loaded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker RPC load has no Hermes package, native dependency, review hooks, or durable tool surface", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-hermes-worker-"));
  try {
    const packageDirectory = await copyBrokerPackage(root);
    await linkPiPeers(root, packageDirectory);
    const probe = join(root, "a-worker-probe.ts");
    const resultPath = join(root, "worker-result.json");
    await writeFile(probe, `
import { existsSync, writeFileSync } from "node:fs";
export default function (pi) {
  pi.registerCommand("broker-worker-probe", {
    description: "test-only worker probe",
    async handler() {
      writeFileSync(process.env.PROBE_RESULT, JSON.stringify({
        tools: pi.getAllTools().map((tool) => tool.name).sort(),
        commands: pi.getCommands().map((command) => command.name).sort(),
        hermesConfigExists: existsSync(process.env.PI_CODING_AGENT_DIR + "/hermes-memory-config.json"),
      }));
    },
  });
}
`, "utf8");
    const { output, stderr } = await runPiProbe({
      root,
      extensions: [probe, join(packageDirectory, "extensions/memory-broker.ts")],
      mode: "worker",
      probeCommand: "broker-worker-probe",
      outputPath: resultPath,
      extraEnv: {
        PIPIUI_MEMORY_BROKER_URL: "http://127.0.0.1:43123/v1/memory",
        PIPIUI_MEMORY_BROKER_TOKEN: "t".repeat(43),
        PIPIUI_MEMORY_BROKER_CAPABILITY: "c".repeat(43),
        PIPIUI_AGENT_ID: "worker-a",
        PIPIUI_AGENT_RUN_ID: "worker-run",
        PIPIUI_MEMORY_PROJECT_ROOT: join(root, "project"),
      },
    });
    assert.equal(stderr, "");
    assert.ok(output.tools.includes("memory_query"));
    assert.equal(output.tools.includes("memory_status"), false);
    assert.equal(output.tools.some((name) => /^memory_(?:add|replace|remove|search)$/.test(name)), false);
    assert.equal(output.commands.some((name) => name.startsWith("memory-")), false);
    assert.equal(output.hermesConfigExists, false);
    assert.equal(await exists(join(packageDirectory, "node_modules/pi-hermes-memory")), false);
    assert.equal(await exists(join(packageDirectory, "node_modules/better-sqlite3")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

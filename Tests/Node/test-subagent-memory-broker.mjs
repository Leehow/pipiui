import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const brokerRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages/memory-broker");
const packagesRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages");
const subagentRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");
const execFileAsync = promisify(execFile);
const core = await import(pathToFileURL(join(brokerRoot, "src/index.ts")).href);
const client = await import(pathToFileURL(join(brokerRoot, "src/client.ts")).href);

function terminalInput(runID, overrides = {}) {
  return {
    runID,
    task: "Implement direct extension broker client",
    title: "Broker client",
    terminalText: "Focused terminal report: query path verified.",
    outcome: "success",
    ...overrides,
  };
}

async function startBroker(backend = new core.InMemoryMemoryBackend({
  results: [{ claim: "continuity fact", score: 0.9 }],
})) {
  const server = new core.MemoryBrokerServer({
    projectRoot: "/fixture/./main-project",
    chatSessionID: "chat-subagent",
    bridgeRoutingKey: "route-subagent",
    backend,
  });
  await server.start();
  return { server, backend };
}

test("subagent data path uses the formal loopback client with run fences, bounded query, and fail-soft terminal candidate", async () => {
  const { server, backend } = await startBroker();
  try {
    const issued = server.issueChildCapability({ agentID: "worker-a", runID: "run-a", role: "worker" });
    assert.equal(issued.PIPIUI_MEMORY_BROKER_MODE, "worker");
    assert.equal(issued.PIPIUI_MAIN_CWD, "/fixture/main-project", "worker inherits canonical main root, not a worktree cwd");
    assert.match(issued.PIPIUI_MEMORY_BROKER_URL, /^http:\/\/127\.0\.0\.1:\d+\/v1\/memory$/);
    assert.match(issued.PIPIUI_MEMORY_BROKER_TOKEN, /^[A-Za-z0-9_-]{43}$/);

    const worker = client.createMemoryBrokerClient(issued);
    assert.ok(worker, "complete main-issued environment creates a direct package client");
    const query = await worker.query({ text: "continuity fact", budget: 99_999, scope: "project" });
    assert.equal(query.available, true);
    assert.equal(query.value?.results[0]?.claim, "continuity fact");
    assert.equal(backend.queries[0]?.query.budget, 1_200, "package contract clamps budget before loopback transport");

    const candidate = client.makeTerminalExperienceCandidate(terminalInput("run-a"));
    assert.ok(candidate);
    assert.equal(candidate.provenance, "brief");
    assert.equal(candidate.scope, "session");
    assert.deepEqual(candidate.sourceRuns, ["run-a"]);
    await client.submitTerminalExperienceCandidate(worker, terminalInput("run-a"));
    await client.submitTerminalExperienceCandidate(worker, terminalInput("run-a"));
    assert.equal(backend.ingested.length, 1, "terminal callback submits once per exact agent/run");
    assert.equal(backend.ingested[0]?.durable, false, "terminal brief never requests durable promotion");
    assert.equal(client.makeTerminalExperienceCandidate(terminalInput("run-secret", {
      terminalText: "api_key=super-secret-value",
    })), undefined, "secret-like output is quarantined before transport");

    assert.equal(client.createMemoryBrokerClient({ ...issued, PIPIUI_MEMORY_BROKER_TOKEN: "" }), undefined,
      "missing token removes the optional child client surface");
    const wrongToken = client.createMemoryBrokerClient({ ...issued, PIPIUI_MEMORY_BROKER_TOKEN: "x".repeat(43) });
    assert.ok(wrongToken);
    assert.equal((await wrongToken.query({ text: "continuity fact" })).available, false,
      "wrong token fails soft instead of falling back to Swift RPC");

    const resumed = server.issueChildCapability({ agentID: "worker-a", runID: "run-b", role: "worker" });
    assert.equal((await worker.query({ text: "continuity fact" })).available, false,
      "a reused agent ID fences the stale run before recall");
    const resumedClient = client.createMemoryBrokerClient(resumed);
    assert.ok(resumedClient);
    assert.equal((await resumedClient.query({ text: "continuity fact" })).available, true,
      "continuity/resume receives a fresh run-bound client");
  } finally {
    await server.close();
  }
});

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

test("broker unavailability is optional and the subagent extension mounts only the formal read-only package surface", async () => {
  const unavailable = new core.MemoryBrokerServer({ projectRoot: "/fixture/main-project" });
  await unavailable.start();
  try {
    const environment = unavailable.issueChildCapability({ agentID: "worker-unavailable", runID: "run-unavailable", role: "worker" });
    const worker = client.createMemoryBrokerClient(environment);
    assert.ok(worker);
    assert.equal((await worker.query({ text: "optional recall" })).available, false,
      "backend failure is non-throwing and cannot block done delivery");
  } finally {
    await unavailable.close();
  }

  const [subagentSource, packageExtensionSource, packageRuntimeSource, clientSource] = await Promise.all([
    readFile(join(repositoryRoot, "Sources/PipiUI/PiExt/subagent/index.ts"), "utf8"),
    readFile(join(brokerRoot, "extensions/memory-broker.ts"), "utf8"),
    readFile(join(brokerRoot, "src/extension.ts"), "utf8"),
    readFile(join(brokerRoot, "src/client.ts"), "utf8"),
  ]);
  assert.match(subagentSource, /pipiui\.memory-broker\.issue-child-capability/,
    "launcher obtains capabilities from the live main extension global, not a bundled source import");
  assert.match(subagentSource, /PIPIUI_MEMORY_BROKER_EXTENSION/,
    "issued children mount the exact main-issued installed extension path");
  assert.match(subagentSource, /validateIssuedPackageIdentity/,
    "child reuses the live main package's canonical identity validator before mounting memory");
  assert.doesNotMatch(subagentSource, /manifest\.name !== "pipiui-memory-broker"|fs\.realpathSync\(root\)/,
    "subagent does not duplicate package identity validation");
  assert.doesNotMatch(subagentSource, /\.\.\/packages\/memory-broker|memoryBrokerExtensionPathForChild\(\)/,
    "there is no nearby/development package fallback for child memory");
  assert.match(subagentSource, /registerSessionRecallTool\(pi\)/,
    "short-lived session_recall remains separate from long-lived memory_query");
  assert.doesNotMatch(subagentSource, /action:\s*["']memory_broker["']|PIPIUI_MEMORY_BROKER_ENABLED/,
    "subagent memory path does not call or enable the Swift AppStore memory_broker action");
  assert.match(packageExtensionSource, /installMemoryBrokerExtension/);
  assert.match(packageRuntimeSource, /issuedMemoryBrokerPackageIdentity/,
    "the installed main package owns canonical child identity validation");
  assert.doesNotMatch(clientSource, /pi-hermes-memory|better-sqlite3|memory_(?:add|replace|remove)/i,
    "child client has zero Hermes/native or durable-write tool surface");
});

test("main extension capability reaches actual subagent spawn, direct client, and resumed run without Swift memory RPC", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-extension-memory-"));
  try {
    const runtime = join(directory, "runtime");
    const project = join(directory, "project");
    const agents = join(directory, "agents");
    const capture = join(directory, "children.jsonl");
    await Promise.all([
      cp(subagentRoot, join(runtime, "subagent"), { recursive: true }),
      mkdir(join(runtime, "packages"), { recursive: true }),
      mkdir(project, { recursive: true }),
      mkdir(agents, { recursive: true }),
    ]);
    await Promise.all([
      cp(join(packagesRoot, "memory-broker"), join(runtime, "packages/memory-broker"), { recursive: true }),
      cp(join(packagesRoot, "memory-broker"), join(runtime, "packages/memory-broker-dev"), { recursive: true }),
    ]);
    await linkRuntimePackages(runtime);
    await writeFile(join(agents, "probe.md"), "---\nname: probe\ndescription: Test worker\nread-only: true\n---\nReturn a brief report.\n", "utf8");
    await writeFile(capture, "", "utf8");
    const harness = join(runtime, "harness.mjs");
    await writeFile(harness, `
import fs from "node:fs";

if (process.argv.includes("--mode")) {
  const keys = [
    "PIPIUI_MEMORY_BROKER_MODE", "PIPIUI_MEMORY_BROKER_URL", "PIPIUI_MEMORY_BROKER_TOKEN",
    "PIPIUI_MEMORY_BROKER_CAPABILITY", "PIPIUI_MEMORY_PROJECT_ROOT", "PIPIUI_MAIN_CWD",
    "PIPIUI_MEMORY_BROKER_PACKAGE_ROOT", "PIPIUI_MEMORY_BROKER_EXTENSION", "PIPIUI_MEMORY_BROKER_PACKAGE_VERSION",
    "PIPIUI_AGENT_ID", "PIPIUI_AGENT_RUN_ID", "PIPIUI_AGENT_ROLE",
  ];
  fs.appendFileSync(process.env.PIPIUI_CAPTURE_FILE, JSON.stringify({
    args: process.argv.slice(2), env: Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null])),
  }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message_end", message: {
    role: "assistant", content: [{ type: "text", text: "terminal memory evidence" }], stopReason: "end",
  } }) + "\\n");
  process.exit(0);
}

const { InMemoryMemoryBackend } = await import("./packages/memory-broker/src/backend.ts");
const { installMemoryBrokerExtension } = await import("./packages/memory-broker/src/extension.ts");
const { createMemoryBrokerClient } = await import("./packages/memory-broker/src/client.ts");
const mainHandlers = new Map();
const mainTools = new Map();
const backend = new InMemoryMemoryBackend({ results: [{ claim: "spawned client fact", score: 1 }] });
await installMemoryBrokerExtension({
  registerTool(tool) { mainTools.set(tool.name, tool); },
  on(name, handler) { mainHandlers.set(name, handler); },
}, { backendFactory: () => backend });
await mainHandlers.get("session_start")({}, { cwd: process.env.PIPIUI_MAIN_CWD });
try {
  const { default: installSubagent } = await import("./subagent/index.ts");
  const tools = new Map();
  installSubagent({ registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {}, on() {} });
  const subagent = tools.get("subagent");
  const dispatch = async () => subagent.execute(
    "extension-memory", { agent: "probe", agentId: "continuity-worker", task: "verify direct memory", background: false },
    new AbortController().signal, undefined, { cwd: process.env.PIPIUI_MAIN_CWD, hasUI: false },
  );
  const first = await dispatch();
  const second = await dispatch();
  const validCaptures = fs.readFileSync(process.env.PIPIUI_CAPTURE_FILE, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse);
  const oldClient = createMemoryBrokerClient(validCaptures[0].env);
  const currentClient = createMemoryBrokerClient(validCaptures[1].env);
  const oldQuery = await oldClient.query({ text: "spawned client fact" });
  const currentQuery = await currentClient.query({ text: "spawned client fact", budget: 99_999 });
  const issuerKey = Symbol.for("pipiui.memory-broker.issue-child-capability");
  const issuer = globalThis[issuerKey];
  if (typeof issuer !== "function" || typeof issuer.validateIssuedPackageIdentity !== "function") {
    throw new Error("main broker did not publish canonical package identity validation");
  }
  const validator = issuer.validateIssuedPackageIdentity;
  globalThis[issuerKey] = Object.assign(
    (input) => ({ ...issuer(input), PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: "mismatched" }),
    { validateIssuedPackageIdentity: validator },
  );
  const rejectedVersion = await dispatch();
  const devRoot = process.env.PIPIUI_DEV_MEMORY_BROKER_ROOT;
  globalThis[issuerKey] = Object.assign(
    (input) => ({
      ...issuer(input),
      PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: devRoot,
      PIPIUI_MEMORY_BROKER_EXTENSION: devRoot + "/extensions/memory-broker.ts",
    }),
    { validateIssuedPackageIdentity: validator },
  );
  const rejectedDevBundle = await dispatch();
  globalThis[issuerKey] = issuer;
  const captures = fs.readFileSync(process.env.PIPIUI_CAPTURE_FILE, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse);
  process.stdout.write(JSON.stringify({
    captures, first, second, rejectedVersion, rejectedDevBundle, oldQuery, currentQuery, queries: backend.queries, ingested: backend.ingested,
  }));
} finally {
  await mainHandlers.get("session_shutdown")({}, {});
}
`, "utf8");
    const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: runtime,
      env: {
        ...process.env,
        HOME: join(directory, "home"),
        PIPIUI_MEMORY_BROKER_MODE: "main",
        PIPIUI_AGENT_ROLE: "main",
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: project,
        PIPIUI_AGENTS_DIR: agents,
        PIPIUI_SUBAGENT_EXT: join(runtime, "subagent"),
        PIPIUI_DEV_MEMORY_BROKER_ROOT: join(runtime, "packages/memory-broker-dev"),
        PIPIUI_CAPTURE_FILE: capture,
        PIPIUI_WORKTREE: "0",
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
      },
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = JSON.parse(stdout);
    const canonicalProject = await realpath(project);
    const canonicalBrokerRoot = await realpath(join(runtime, "packages/memory-broker"));
    const canonicalBrokerExtension = join(canonicalBrokerRoot, "extensions/memory-broker.ts");
    const canonicalDevBrokerRoot = await realpath(join(runtime, "packages/memory-broker-dev"));
    const canonicalDevBrokerExtension = join(canonicalDevBrokerRoot, "extensions/memory-broker.ts");
    assert.equal(out.captures.length, 4);
    for (const child of out.captures.slice(0, 2)) {
      assert.equal(child.env.PIPIUI_MEMORY_BROKER_MODE, "worker");
      assert.equal(child.env.PIPIUI_MAIN_CWD, canonicalProject);
      assert.equal(child.env.PIPIUI_MEMORY_PROJECT_ROOT, canonicalProject);
      assert.equal(child.env.PIPIUI_AGENT_ID, "continuity-worker");
      assert.equal(child.env.PIPIUI_AGENT_ROLE, "worker");
      assert.match(child.env.PIPIUI_MEMORY_BROKER_URL, /^http:\/\/127\.0\.0\.1:\d+\/v1\/memory$/);
      assert.match(child.env.PIPIUI_MEMORY_BROKER_TOKEN, /^[A-Za-z0-9_-]{43}$/);
      assert.match(child.env.PIPIUI_MEMORY_BROKER_CAPABILITY, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(child.env.PIPIUI_MEMORY_BROKER_PACKAGE_ROOT, canonicalBrokerRoot);
      assert.equal(child.env.PIPIUI_MEMORY_BROKER_EXTENSION, canonicalBrokerExtension);
      assert.equal(child.env.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION, "0.1.0");
      assert.ok(child.args.includes(canonicalBrokerExtension));
      assert.doesNotMatch(child.args.join(" "), /memory_(?:add|replace|remove)/,
        "the launcher never grants a Hermes durable-write tool name");
    }
    for (const rejected of out.captures.slice(2)) {
      assert.equal(rejected.env.PIPIUI_MEMORY_BROKER_MODE, null, "mismatched package identity removes optional child memory");
      assert.equal(rejected.env.PIPIUI_MEMORY_BROKER_EXTENSION, null);
      assert.equal(rejected.env.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION, null);
      assert.equal(rejected.args.includes(canonicalBrokerExtension), false, "child must not fall back to the main bundle");
      assert.equal(rejected.args.includes(canonicalDevBrokerExtension), false, "child must not mount a same-version development bundle");
    }
    assert.notEqual(out.captures[0].env.PIPIUI_AGENT_RUN_ID, out.captures[1].env.PIPIUI_AGENT_RUN_ID,
      "continuity resumes the session with a fresh broker run fence");
    assert.equal(out.oldQuery.available, false, "the first run cannot query after same-agent resume replaces its grant");
    assert.equal(out.currentQuery.available, true);
    assert.equal(out.queries.at(-1)?.query.budget, 1_200);
    assert.equal(out.ingested.length, 1, "brief terminal candidate is server-deduped across resumed continuity");
    assert.equal(out.ingested[0]?.durable, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

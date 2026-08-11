import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagesRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages");
const packageRoot = join(packagesRoot, "memory-broker");
const core = await import(pathToFileURL(join(packageRoot, "src/index.ts")).href);
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

function candidate(overrides = {}) {
  return {
    kind: "experience",
    claimKind: "task",
    claim: "Build narrow broker client",
    scope: "session",
    provenance: "brief",
    outcome: "success",
    evidence: [{ summary: "focused verification completed" }],
    sourceRuns: ["source-run"],
    ...overrides,
  };
}

async function startBroker(options = {}) {
  const backend = options.backend ?? new core.InMemoryMemoryBackend({
    results: [{ claim: "project fact", score: 0.9 }],
  });
  const server = new core.MemoryBrokerServer({
    projectRoot: "/fixture/./project",
    chatSessionID: "chat-a",
    bridgeRoutingKey: "route-a",
    backend,
  });
  const connection = await server.start();
  return { server, backend, connection };
}

async function post(connection, token, actor, request) {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pipiui-memory-token": token,
    },
    body: JSON.stringify({ version: 1, actor, request }),
  });
  return { status: response.status, body: await response.json() };
}

function sameSet(values, expected) {
  assert.deepEqual(new Set(values), new Set(expected));
}

async function linkExtensionRuntime(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  const hermesRoot = join(directory, "node_modules/pi-hermes-memory");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
    mkdir(join(hermesRoot, "src/store"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(hermesRoot, "package.json"), JSON.stringify({
      name: "pi-hermes-memory",
      version: "0.9.4",
      type: "module",
      main: "./src/index.js",
    })),
    writeFile(join(hermesRoot, "src/index.js"), "export default function () { process.env.PIPIUI_TEST_HERMES_LOADED = '1'; }\n"),
    writeFile(join(hermesRoot, "src/store/db.js"), "export class DatabaseManager { getDb() { return {}; } close() {} }\n"),
    writeFile(join(hermesRoot, "src/store/sqlite-memory-store.js"), "export function searchMemories() { return []; } export function addMemory() {} export function getMemoryStats() { return { total: 0 }; }\n"),
    writeFile(join(hermesRoot, "src/store/session-search.js"), "export function searchSessions() { return []; }\n"),
    writeFile(join(hermesRoot, "src/config.js"), "export function loadConfig() { return {}; }\n"),
    writeFile(join(hermesRoot, "src/paths.js"), "export const AGENT_ROOT = process.env.PI_CODING_AGENT_DIR;\n"),
    writeFile(join(hermesRoot, "src/project.js"), "export function detectProject() { return { name: 'fixture' }; }\n"),
  ]);
}

async function extensionFixture(mode) {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-package-"));
  try {
    await cp(join(packagesRoot, "memory-broker"), join(directory, "packages/memory-broker"), { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    await cp(join(packagesRoot, "memory-broker-contract"), join(directory, "packages/memory-broker-contract"), { recursive: true });
    await linkExtensionRuntime(directory);
    const output = join(directory, "result.json");
    const harness = join(directory, "harness.mjs");
    await writeFile(harness, `
import { writeFileSync } from "node:fs";
const { default: install, issueMainMemoryBrokerChildEnvironment } = await import("./packages/memory-broker/extensions/memory-broker.ts");
const tools = new Map();
const handlers = new Map();
await install({
  registerTool(tool) { tools.set(tool.name, tool); },
  on(name, handler) { handlers.set(name, handler); },
});
const start = handlers.get("session_start");
if (start) await start({ reason: "startup" }, { cwd: "/fixture/project" });
const beforeShutdown = {
  url: process.env.PIPIUI_MEMORY_BROKER_URL,
  token: process.env.PIPIUI_MEMORY_BROKER_TOKEN,
  packageRoot: process.env.PIPIUI_MEMORY_BROKER_PACKAGE_ROOT,
  extension: process.env.PIPIUI_MEMORY_BROKER_EXTENSION,
  packageVersion: process.env.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION,
};
const issued = issueMainMemoryBrokerChildEnvironment({ agentID: "fixture-worker", runID: "fixture-run", role: "worker" });
const query = tools.get("memory_query");
const shutdown = handlers.get("session_shutdown");
if (shutdown) await shutdown({ reason: "quit" }, {});
writeFileSync(${JSON.stringify(output)}, JSON.stringify({
  tools: [...tools.keys()].sort(),
  handlers: [...handlers.keys()].sort(),
  queryProperties: Object.keys(query?.parameters?.properties ?? {}).sort(),
  beforeShutdown,
  issued,
  issueAfterShutdown: issueMainMemoryBrokerChildEnvironment({ agentID: "fixture-worker", runID: "fixture-next", role: "worker" }),
  hermesLoaded: process.env.PIPIUI_TEST_HERMES_LOADED,
  afterShutdown: {
    url: process.env.PIPIUI_MEMORY_BROKER_URL,
    token: process.env.PIPIUI_MEMORY_BROKER_TOKEN,
  },
}));
`, "utf8");
    const env = {
      ...process.env,
      PIPIUI_MEMORY_BROKER_MODE: mode,
      HOME: join(directory, "home"),
      PI_CODING_AGENT_DIR: join(directory, "agent"),
      PIPIUI_MEMORY_BROKER_URL: "http://127.0.0.1:43123/v1/memory",
      PIPIUI_MEMORY_BROKER_TOKEN: "t".repeat(43),
      PIPIUI_MEMORY_BROKER_CAPABILITY: "c".repeat(43),
      PIPIUI_MEMORY_PROJECT_ROOT: "/fixture/project",
      PIPIUI_MEMORY_CATALOG_DIR: join(directory, "catalog"),
      PIPIUI_AGENT_ID: "agent-a",
      PIPIUI_AGENT_RUN_ID: "run-a",
    };
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(await readFile(output, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("main lifecycle starts loopback broker and supports status/query/submit before shutdown", async () => {
  const { server, backend, connection } = await startBroker();
  try {
    assert.match(connection.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/memory$/);
    assert.match(connection.token, /^[A-Za-z0-9_-]{43}$/);
    const status = await server.handleMainRequest({ version: 1, operation: "memory.status" });
    assert.deepEqual(status.status, { ready: true });
    const query = await server.handleMainRequest({
      version: 1,
      operation: "memory.query",
      query: { text: "project fact", budget: 99999, scope: "project" },
    });
    assert.equal(query.ok, true);
    assert.equal(query.results?.[0]?.claim, "project fact");
    assert.equal(backend.queries[0]?.query.budget, 1200);
    const submission = await server.handleMainRequest({
      version: 1,
      operation: "experience.submit",
      candidate: candidate({ provenance: "outcome" }),
      promote: true,
    });
    assert.equal(submission.ok, true);
    assert.equal(backend.ingested.length, 1);
    assert.equal(backend.ingested[0].durable, true);
  } finally {
    await server.close();
  }
  assert.equal(server.getConnection(), undefined);
});

test("HTTP child surface rejects wrong token, non-loopback bind, run mismatch, and forged promotion", async () => {
  assert.throws(
    () => new core.MemoryBrokerServer({ projectRoot: "/fixture/project", host: "0.0.0.0" }),
    (error) => error?.code === "non-loopback",
  );
  const { server, backend, connection } = await startBroker();
  try {
    const env = server.issueChildCapability({ agentID: "worker-a", runID: "run-current", role: "worker" });
    assert.equal(env.PIPIUI_MEMORY_PROJECT_ROOT, "/fixture/project");
    assert.equal(env.PIPIUI_MAIN_CWD, "/fixture/project");
    assert.equal(env.PIPIUI_MEMORY_BROKER_MODE, "worker");
    const actor = {
      capability: env.PIPIUI_MEMORY_BROKER_CAPABILITY,
      agentID: "worker-a",
      runID: "run-current",
    };
    const wrongToken = await post(connection, "x".repeat(43), actor, {
      version: 1,
      operation: "memory.status",
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.body.ok, false);

    const stale = await post(connection, connection.token, { ...actor, runID: "run-old" }, {
      version: 1,
      operation: "memory.status",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.ok, false);

    const roleUpgrade = await post(connection, connection.token, { ...actor, role: "main", projectRoot: "/other" }, {
      version: 1,
      operation: "memory.status",
    });
    assert.equal(roleUpgrade.status, 400, "child actor payload cannot override its bound role/root");

    const forgedPromotion = await post(connection, connection.token, actor, {
      version: 1,
      operation: "experience.submit",
      candidate: candidate({ provenance: "outcome" }),
      promote: true,
    });
    assert.equal(forgedPromotion.status, 403);
    assert.equal(backend.ingested.length, 0, "worker cannot upgrade to durable write");
  } finally {
    await server.close();
  }
});

test("worker client stays serverless and candidate-only; operator client gets bounded app scope and sanitizer helper", async () => {
  const { server, backend } = await startBroker();
  try {
    const workerEnv = server.issueChildCapability({ agentID: "worker-a", runID: "run-a", role: "worker" });
    const worker = core.createMemoryBrokerClient(workerEnv);
    assert.ok(worker);
    assert.equal(worker.environment.mode, "worker");
    const workerAppScope = await worker.query({ text: "editor recipe", bundleID: "com.example.editor" });
    assert.equal(workerAppScope.available, false);
    const submitted = await worker.submitCandidate(candidate());
    assert.equal(submitted.available, true);
    assert.equal(backend.ingested[0]?.durable, false);

    const operatorEnv = server.issueChildCapability({
      agentID: "operator-a",
      runID: "run-operator",
      role: "operator",
      hostIssuedDesktopGrant: "ui-verify",
    });
    const operator = core.createMemoryBrokerClient(operatorEnv);
    assert.ok(operator);
    const appQuery = await operator.query({
      text: "editor recipe",
      budget: 99_999,
      bundleID: "COM.Example.Editor",
      appName: " Example   Editor ",
    });
    assert.equal(appQuery.available, true);
    assert.equal(backend.queries.at(-1)?.query.budget, 240);
    assert.equal(backend.queries.at(-1)?.query.bundleID, "com.example.editor");

    const computerCandidate = core.operatorComputerCandidate(operator.environment, {
      claimKind: "computer_failure",
      bundleID: "com.example.editor",
      appName: "Example Editor",
      errorCode: "computer_outcome_unknown",
      actionKinds: ["type", "scroll"],
      focusDrift: true,
      outcome: "failure",
    });
    assert.ok(computerCandidate);
    assert.equal(computerCandidate.ttlSeconds, 300);
    const encoded = JSON.stringify(computerCandidate).toLowerCase();
    for (const forbidden of ["screenshot", "base64", "accessibility", "typedtext", "clipboard", "credential", "otp", "processid", "windowid", "coordinate", "capability"]) {
      assert.equal(encoded.includes(forbidden), false, `operator helper leaked ${forbidden}`);
    }
    assert.throws(() => core.operatorComputerCandidate(operator.environment, {
      claimKind: "computer_failure",
      bundleID: "com.example.editor",
      appName: "Example Editor",
      errorCode: "computer_outcome_unknown",
      actionKinds: ["click"],
      outcome: "failure",
      screenshot: "base64-data",
    }), (error) => error?.code === "invalid-request");
  } finally {
    await server.close();
  }
});

test("unavailable backend degrades without throwing, while concurrent clients dedupe source runs", async () => {
  const unavailable = new core.MemoryBrokerServer({ projectRoot: "/fixture/project" });
  await unavailable.start();
  try {
    const client = core.createMemoryBrokerClient(unavailable.issueChildCapability({ agentID: "worker-a", runID: "run-a", role: "worker" }));
    assert.ok(client);
    const status = await client.status();
    assert.deepEqual(status, {
      available: true,
      value: { ready: false, detail: "Memory broker is running without a retrieval/learning backend." },
    });
    const recall = await client.query({ text: "optional memory" });
    assert.equal(recall.available, false, "backend failure must become a non-throwing degraded result");
  } finally {
    await unavailable.close();
  }

  const { server, backend } = await startBroker();
  try {
    const first = core.createMemoryBrokerClient(server.issueChildCapability({ agentID: "worker-a", runID: "run-one", role: "worker" }));
    const second = core.createMemoryBrokerClient(server.issueChildCapability({ agentID: "worker-b", runID: "run-two", role: "worker" }));
    assert.ok(first && second);
    const [one, two] = await Promise.all([
      first.submitCandidate(candidate()),
      second.submitCandidate(candidate({ claim: "  build narrow broker client " })),
    ]);
    assert.equal(one.available, true);
    assert.equal(two.available, true);
    assert.equal([one.value?.duplicate, two.value?.duplicate].filter(Boolean).length, 1);
    assert.equal(backend.ingested.length, 1);
    const key = one.value?.acceptedDedupeKey ?? two.value?.acceptedDedupeKey;
    assert.ok(key);
    assert.deepEqual(server.candidateForDedupeKey(key)?.sourceRuns, ["run-one", "run-two", "source-run"]);
  } finally {
    await server.close();
  }
});

test("client accepts only loopback configuration and fails closed on oversized or timed-out responses", async () => {
  const baseEnvironment = {
    mode: "worker",
    url: "http://127.0.0.1:43123/v1/memory",
    token: "t".repeat(43),
    capability: "c".repeat(43),
    agentID: "worker-a",
    runID: "run-a",
    projectRoot: "/fixture/project",
  };
  assert.equal(core.memoryBrokerClientEnvironment({
    PIPIUI_MEMORY_BROKER_MODE: "worker",
    PIPIUI_MEMORY_BROKER_URL: "http://example.test/v1/memory",
    PIPIUI_MEMORY_BROKER_TOKEN: baseEnvironment.token,
    PIPIUI_MEMORY_BROKER_CAPABILITY: baseEnvironment.capability,
    PIPIUI_AGENT_ID: baseEnvironment.agentID,
    PIPIUI_AGENT_RUN_ID: baseEnvironment.runID,
    PIPIUI_MEMORY_PROJECT_ROOT: baseEnvironment.projectRoot,
  }), undefined);

  const oversized = new core.MemoryBrokerClient(baseEnvironment, {
    fetchImpl: async () => new Response("x", {
      status: 200,
      headers: { "content-length": String(core.MEMORY_BROKER_MAX_RESPONSE_BYTES + 1) },
    }),
  });
  const oversizedResult = await oversized.query({ text: "optional memory" });
  assert.equal(oversizedResult.available, false);

  const timedOut = new core.MemoryBrokerClient(baseEnvironment, {
    timeoutMs: 5,
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  const timeoutResult = await timedOut.query({ text: "optional memory" });
  assert.deepEqual(timeoutResult, { available: false, error: "Memory broker request timed out." });
});

test("session_start catches broker bind failures and atomically publishes degraded status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-bind-status-"));
  try {
    const runtimePackage = join(directory, "packages/memory-broker");
    await cp(packageRoot, runtimePackage, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    await linkExtensionRuntime(directory);
    const extension = await import(pathToFileURL(join(runtimePackage, "src/extension.ts")).href);
    const handlers = new Map();
    await extension.installMemoryBrokerExtension({
      registerTool() {},
      on(name, handler) { handlers.set(name, handler); },
    }, {
      backendFactory: () => new core.InMemoryMemoryBackend(),
      catalogDirectory: join(directory, "catalog"),
      serverFactory: () => ({
        async start() { throw new Error("simulated loopback bind failure"); },
        async close() {},
      }),
    }, {
      PIPIUI_MEMORY_BROKER_MODE: "main",
      PIPIUI_MEMORY_PROJECT_ROOT: "/fixture/project",
      PIPIUI_MEMORY_BROKER_STATE_DIR: join(directory, "state"),
    });
    await handlers.get("session_start")({}, { cwd: "/fixture/project" });
    const status = JSON.parse(await readFile(join(directory, "state/status.json"), "utf8"));
    assert.equal(status.ready, false);
    assert.match(status.detail, /simulated loopback bind failure/);
    assert.match(status.lastError, /simulated loopback bind failure/);
    await handlers.get("session_shutdown")({}, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("copied standalone broker resolves its vendored contract without a sibling checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-standalone-"));
  try {
    const standalone = join(directory, "broker");
    await cp(packageRoot, standalone, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    const standaloneCore = await import(pathToFileURL(join(standalone, "src/index.ts")).href);
    const server = new standaloneCore.MemoryBrokerServer({
      projectRoot: "/fixture/standalone",
      backend: new standaloneCore.InMemoryMemoryBackend(),
    });
    try {
      const connection = await server.start();
      assert.match(connection.url, /^http:\/\/127\.0\.0\.1:/);
    } finally {
      await server.close();
    }
    const manifest = JSON.parse(await readFile(join(standalone, "package.json"), "utf8"));
    assert.equal(manifest.dependencies["pipiui-memory-broker-contract"], "file:vendor/pipiui-memory-broker-contract");
    assert.equal(manifest.imports["#memory-broker-contract"], "./vendor/pipiui-memory-broker-contract/contract/index.ts");
    const serverSource = await readFile(join(standalone, "src/server.ts"), "utf8");
    assert.match(serverSource, /from "#memory-broker-contract"/);
    assert.doesNotMatch(serverSource, /\.\.\/\.\.\/memory-broker-contract/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("canonical runtime package identity accepts only the exact main-installed extension", async () => {
  const expected = core.currentMemoryBrokerPackageIdentity();
  assert.ok(expected);
  const issued = {
    PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: expected.root,
    PIPIUI_MEMORY_BROKER_EXTENSION: expected.entrypoint,
    PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: expected.version,
  };
  assert.deepEqual(core.issuedMemoryBrokerPackageIdentity(issued, expected), expected);
  assert.equal(core.issuedMemoryBrokerPackageIdentity({
    ...issued,
    PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: `${expected.root}/../memory-broker`,
  }, expected), undefined, "non-canonical traversal spelling is rejected");
  assert.equal(core.issuedMemoryBrokerPackageIdentity({
    ...issued,
    PIPIUI_MEMORY_BROKER_EXTENSION: join(expected.root, "src/client.ts"),
  }, expected), undefined, "only the exact extension entrypoint is accepted");
  assert.equal(core.issuedMemoryBrokerPackageIdentity({
    ...issued,
    PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: "mismatched",
  }, expected), undefined, "manifest and issued versions must agree");

  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-identity-"));
  try {
    const devBundle = join(directory, "memory-broker");
    await cp(packageRoot, devBundle, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    const [devRoot, devExtension] = await Promise.all([
      realpath(devBundle),
      realpath(join(devBundle, "extensions/memory-broker.ts")),
    ]);
    assert.equal(core.issuedMemoryBrokerPackageIdentity({
      ...issued,
      PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: devRoot,
      PIPIUI_MEMORY_BROKER_EXTENSION: devExtension,
    }, expected), undefined, "a same-version development copy cannot replace the active main package");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pi package entry registers lifecycle/tools by mode without worker backend startup", async () => {
  const [main, worker, operator] = await Promise.all([
    extensionFixture("main"),
    extensionFixture("worker"),
    extensionFixture("operator"),
  ]);
  sameSet(main.tools, ["memory_query", "memory_status"]);
  sameSet(main.handlers, ["input", "tool_result", "session_shutdown", "session_start"]);
  assert.match(main.beforeShutdown.url, /^http:\/\/127\.0\.0\.1:/);
  assert.match(main.beforeShutdown.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(main.afterShutdown.url, undefined);
  assert.equal(main.afterShutdown.token, undefined);
  assert.equal(main.issued.PIPIUI_MEMORY_BROKER_URL, main.beforeShutdown.url);
  assert.equal(main.issued.PIPIUI_MEMORY_BROKER_TOKEN, main.beforeShutdown.token);
  assert.equal(main.issued.PIPIUI_MAIN_CWD, "/fixture/project");
  assert.equal(main.issued.PIPIUI_MEMORY_PROJECT_ROOT, "/fixture/project");
  assert.equal(main.issued.PIPIUI_MEMORY_BROKER_PACKAGE_ROOT, main.beforeShutdown.packageRoot);
  assert.equal(main.issued.PIPIUI_MEMORY_BROKER_EXTENSION, main.beforeShutdown.extension);
  assert.equal(main.issued.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION, main.beforeShutdown.packageVersion);
  assert.match(main.beforeShutdown.extension, /packages\/memory-broker\/extensions\/memory-broker\.ts$/);
  assert.equal(main.beforeShutdown.packageVersion, "0.1.0");
  assert.equal(main.issueAfterShutdown, undefined, "shutdown retires the main-only capability issuer");
  assert.equal(main.queryProperties.includes("bundleID"), false);
  assert.equal(main.hermesLoaded, "1", "main must compose the pinned Hermes extension");

  assert.deepEqual(worker.tools, ["memory_query"]);
  assert.deepEqual(worker.handlers, []);
  assert.equal(worker.queryProperties.includes("bundleID"), false);
  assert.equal(worker.beforeShutdown.url, "http://127.0.0.1:43123/v1/memory", "worker must not replace/start a server");
  assert.equal(worker.hermesLoaded, undefined, "worker must not import or initialize Hermes");

  assert.deepEqual(operator.tools, ["memory_query"]);
  assert.deepEqual(operator.handlers, ["tool_result"]);
  assert.equal(operator.queryProperties.includes("bundleID"), true);
  assert.equal(operator.queryProperties.includes("appName"), true);
  assert.equal(operator.hermesLoaded, undefined, "operator must not import or initialize Hermes");

  const [manifest, entry, source, extensionSource] = await Promise.all([
    readFile(join(packageRoot, "package.json"), "utf8"),
    readFile(join(packageRoot, "extensions/memory-broker.ts"), "utf8"),
    readFile(join(packageRoot, "src/server.ts"), "utf8"),
    readFile(join(packageRoot, "src/extension.ts"), "utf8"),
  ]);
  assert.match(manifest, /"pi"\s*:\s*\{/);
  assert.match(manifest, /extensions\/memory-broker\.ts/);
  assert.match(manifest, /"pi-hermes-memory"\s*:\s*"0\.9\.4"/);
  assert.match(manifest, /"pipiui-memory-broker-contract"\s*:\s*"file:vendor\/pipiui-memory-broker-contract"/);
  assert.match(manifest, /"#memory-broker-contract"/);
  assert.match(manifest, /"bundledDependencies"\s*:\s*\[[\s\S]*"pipiui-memory-broker-contract"/);
  assert.match(manifest, /"bundledDependencies"\s*:\s*\[[\s\S]*"pi-hermes-memory"/);
  assert.match(entry, /installMemoryBrokerExtension/);
  assert.match(extensionSource, /await import\("\.\/server\.ts"\)/, "only main session_start may load server/backend code");
  assert.doesNotMatch(extensionSource, /^import[\s\S]*?from\s+["']pi-hermes-memory(?:["']|\/)/m, "extension has no static Hermes package import");
  assert.match(extensionSource, /await import\("\.\/hermes-adapter\.ts"\)/, "Hermes stays behind the main session_start dynamic boundary");
  assert.doesNotMatch(`${entry}\n${source}\n${extensionSource}`, /^import(?:\s+type)? .*?(?:AppStore|BridgeServer|PipiUI)/m);
});

test("installed-copy package carries runnable Memory Center UI and eval corpus", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-installed-ui-"));
  try {
    const standalone = join(directory, "memory-broker");
    await cp(packageRoot, standalone, { recursive: true, filter: (source) => basename(source) !== "node_modules" });
    const page = await readFile(join(standalone, "ui/index.html"), "utf8");
    assert.match(page, /Memory Center/);
    const evalResult = await execFileAsync(process.execPath, ["scripts/run-eval.mjs"], { cwd: standalone });
    assert.match(evalResult.stdout, /2 cases/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

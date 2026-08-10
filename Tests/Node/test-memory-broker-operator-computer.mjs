import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagesRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages");
const brokerRoot = join(packagesRoot, "memory-broker");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function waitFor(predicate, milliseconds = 2_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  return predicate();
}

test("operator Computer tool_result hook is grant-gated, metadata-only, app-bound, and fail-soft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-operator-computer-"));
  try {
    await cp(join(packagesRoot, "memory-broker"), join(directory, "packages/memory-broker"), { recursive: true });
    await cp(join(packagesRoot, "memory-broker-contract"), join(directory, "packages/memory-broker-contract"), { recursive: true });
    await linkRuntimePackages(directory);
    const output = join(directory, "result.json");
    const harness = join(directory, "harness.mjs");
    await writeFile(harness, `
import { writeFileSync } from "node:fs";
const { InMemoryMemoryBackend } = await import("./packages/memory-broker/src/backend.ts");
const { installMemoryBrokerExtension } = await import("./packages/memory-broker/src/extension.ts");
const { MemoryBrokerServer } = await import("./packages/memory-broker/src/server.ts");

const backend = new InMemoryMemoryBackend({ results: [{ claim: "editor recipe", score: 1 }] });
const server = new MemoryBrokerServer({ projectRoot: "/fixture/project", backend });
await server.start();
const issued = server.issueChildCapability({
  agentID: "operator-a", runID: "run-a", role: "operator", hostIssuedDesktopGrant: "ui-verify",
});
const makePi = () => {
  const tools = new Map();
  const handlers = new Map();
  return {
    tools, handlers,
    pi: { registerTool(tool) { tools.set(tool.name, tool); }, on(name, handler) { handlers.set(name, handler); } },
  };
};
const granted = makePi();
await installMemoryBrokerExtension(granted.pi, {}, { ...issued, PIPIUI_COMPUTER_MEMORY_ENABLED: "1" });
const hook = granted.handlers.get("tool_result");
const successEvent = {
  toolName: "computer",
  toolCallId: "computer-success",
  input: {
    actions: [
      { type: "click", coordinate: [100, 200], element_token: "ax-secret-token" },
      { type: "type", text: "typed private text" },
      { type: "scroll", scroll_amount: 3 },
    ],
  },
  content: [{ type: "text", text: "screenshot base64 accessibility AX tree clipboard password otp raw URL https://example.test/?token=secret" }],
  details: {
    batchOK: true,
    durationMs: 6_200,
    foregroundApp: {
      bundleID: "COM.Example.Editor",
      name: "Example Editor",
      processID: 44,
      windowID: 55,
      windowTitle: "document with secret",
      capability: "desktop-capability",
    },
    screenshot: "base64-data",
    accessibility: { elements: [{ element_token: "ax-secret-token", label: "typed private text" }] },
    clipboard: "clipboard secret",
    coordinates: [100, 200],
    rawCommand: "open https://example.test/?token=secret",
    urlQuery: "token=secret",
  },
  isError: false,
};
const originalSuccess = structuredClone(successEvent);
const returnedSuccess = hook(successEvent);
const wait = async (predicate, timeout = 2_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
};
await wait(() => backend.ingested.length === 1);
const matchingQuery = await granted.tools.get("memory_query").execute("query-match", {
  query: "editor recipe", scope: "project", budget: 99_999, bundleID: "COM.Example.Editor", appName: "Example Editor",
});
const crossAppQuery = await granted.tools.get("memory_query").execute("query-cross", {
  query: "editor recipe", scope: "project", bundleID: "com.other.app", appName: "Other App",
});
const failureEvent = {
  toolName: "computer",
  toolCallId: "computer-failure",
  input: { actions: [{ type: "key", keys: ["CMD", "V"] }] },
  details: {
    batchOK: false,
    focusDrift: true,
    durationMs: 100,
    foregroundApp: { bundleID: "com.example.editor", name: "Example Editor", pid: 44 },
    batchError: "raw credential and clipboard message must not survive",
  },
  isError: false,
};
const originalFailure = structuredClone(failureEvent);
const returnedFailure = hook(failureEvent);
await wait(() => backend.ingested.length === 2);

const noGrant = makePi();
await installMemoryBrokerExtension(noGrant.pi, {}, { ...issued, PIPIUI_COMPUTER_MEMORY_ENABLED: "0" });
const noGrantReturn = noGrant.handlers.get("tool_result")(structuredClone(successEvent));
await new Promise((resolve) => setTimeout(resolve, 30));

const worker = makePi();
const workerEnvironment = server.issueChildCapability({ agentID: "worker-a", runID: "worker-run", role: "worker" });
await installMemoryBrokerExtension(worker.pi, {}, workerEnvironment);
const main = makePi();
await installMemoryBrokerExtension(main.pi, { backendFactory: () => backend }, { PIPIUI_MEMORY_BROKER_MODE: "main" });

const unavailable = new MemoryBrokerServer({ projectRoot: "/fixture/unavailable" });
await unavailable.start();
try {
  const unavailablePi = makePi();
  const unavailableEnvironment = unavailable.issueChildCapability({
    agentID: "operator-unavailable", runID: "run-unavailable", role: "operator", hostIssuedDesktopGrant: "ui-verify",
  });
  await installMemoryBrokerExtension(unavailablePi.pi, {}, { ...unavailableEnvironment, PIPIUI_COMPUTER_MEMORY_ENABLED: "1" });
  const unavailableEvent = structuredClone(successEvent);
  const unavailableReturn = unavailablePi.handlers.get("tool_result")(unavailableEvent);
  await new Promise((resolve) => setTimeout(resolve, 30));
  writeFileSync(${JSON.stringify(output)}, JSON.stringify({
    returnedSuccess, returnedFailure, noGrantReturn, unavailableReturn,
    successEvent, originalSuccess, failureEvent, originalFailure,
    ingested: backend.ingested,
    matchingQuery, crossAppQuery, queries: backend.queries,
    grantedHandlers: [...granted.handlers.keys()].sort(),
    noGrantHandlers: [...noGrant.handlers.keys()].sort(),
    workerHandlers: [...worker.handlers.keys()].sort(),
    mainHandlers: [...main.handlers.keys()].sort(),
    unavailableEvent,
  }));
} finally {
  await unavailable.close();
  await server.close();
}
`, "utf8");
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: { ...process.env },
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = JSON.parse(await readFile(output, "utf8"));

    assert.deepEqual(out.grantedHandlers, ["tool_result"]);
    assert.deepEqual(out.noGrantHandlers, ["tool_result"], "operator has the hook but no desktop marker produces no submission");
    assert.deepEqual(out.workerHandlers, [], "worker must not register Computer candidate hooks");
    assert.equal(out.mainHandlers.includes("tool_result"), false, "main must not register Computer candidate hooks");
    assert.equal(out.returnedSuccess, undefined);
    assert.equal(out.returnedFailure, undefined);
    assert.equal(out.noGrantReturn, undefined);
    assert.equal(out.unavailableReturn, undefined);
    assert.deepEqual(out.successEvent, out.originalSuccess, "tool_result hook must leave the model-visible Computer result untouched");
    assert.deepEqual(out.failureEvent, out.originalFailure, "failure result remains untouched on the model path");

    assert.equal(out.ingested.length, 2, "grant-gated successful and failure results submit one candidate each");
    const [success, failure] = out.ingested;
    assert.equal(success.durable, false);
    assert.equal(success.candidate.kind, "computer");
    assert.equal(success.candidate.claimKind, "computer_recipe");
    assert.equal(success.candidate.provenance, "hypothesis");
    assert.equal(success.candidate.ttlSeconds, 900);
    assert.equal(success.candidate.evidence[0].computer.bundleID, "com.example.editor");
    assert.equal(success.candidate.evidence[0].computer.appName, "Example Editor");
    assert.equal(success.candidate.evidence[0].computer.durationBucket, "medium");
    assert.deepEqual(success.candidate.sourceRuns, ["run-a"], "server binds the candidate to the issued operator run");
    assert.deepEqual(success.candidate.evidence[0].computer.actionKinds, ["click", "type", "scroll"]);
    assert.equal(failure.durable, false);
    assert.equal(failure.candidate.claimKind, "computer_failure");
    assert.equal(failure.candidate.provenance, "brief");
    assert.equal(failure.candidate.scope, "session");
    assert.equal(failure.candidate.ttlSeconds, 300);
    assert.equal(failure.candidate.evidence[0].computer.errorCode, "focus_drift");
    assert.equal(failure.candidate.evidence[0].computer.durationBucket, "instant");

    const encoded = JSON.stringify(out.ingested).toLowerCase();
    for (const forbidden of [
      "screenshot", "base64", "accessibility", "ax", "element_token", "typed private text", "clipboard",
      "password", "otp", "processid", "windowid", "windowtitle", "coordinate", "capability", "token=secret",
      "rawcommand", "urlquery", "https://example.test",
    ]) assert.equal(encoded.includes(forbidden), false, `candidate leaked ${forbidden}`);

    assert.equal(out.matchingQuery.isError, undefined);
    assert.equal(out.matchingQuery.details.appScoped, true);
    assert.equal(out.queries.at(-1).query.bundleID, "com.example.editor");
    assert.equal(out.queries.at(-1).query.appName, "Example Editor");
    assert.equal(out.queries.at(-1).query.budget, 240, "operator app recall remains bounded");
    assert.equal(out.crossAppQuery.isError, true, "operator cannot recall a different app than the observed Computer target");
    assert.equal(out.crossAppQuery.details.ok, false);

    assert.equal(out.unavailableEvent.toolName, "computer", "unavailable broker never mutates the original result");

    const [extensionSource, operatorSource] = await Promise.all([
      readFile(join(brokerRoot, "src/extension.ts"), "utf8"),
      readFile(join(brokerRoot, "src/operator-computer.ts"), "utf8"),
    ]);
    assert.match(extensionSource, /pi\.on\("tool_result"/);
    assert.match(extensionSource, /PIPIUI_COMPUTER_MEMORY_ENABLED/);
    assert.doesNotMatch(`${extensionSource}\n${operatorSource}`, /ComputerMemoryBrokerAdapter|action:\s*["']memory_broker["']/,
      "formal operator path must not call the Swift memory adapter/AppStore bridge");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

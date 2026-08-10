import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piExtRoot = join(repositoryRoot, "Sources/PipiUI/PiExt");
const packagesRoot = join(piExtRoot, "packages");
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

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

async function prepareHarness(directory) {
  await cp(join(piExtRoot, "subagent"), join(directory, "subagent"), { recursive: true });
  await cp(
    join(piExtRoot, "computer-use-strategy.ts"),
    join(directory, "computer-use-strategy.ts"),
  );
  await cp(join(packagesRoot, "memory-broker"), join(directory, "packages/memory-broker"), { recursive: true });
  await cp(join(packagesRoot, "memory-broker-contract"), join(directory, "packages/memory-broker-contract"), { recursive: true });
  await linkRuntimePackages(directory);
  const outputPath = join(directory, "result.json");
  const harness = join(directory, "harness.mjs");
  await writeFile(harness, `
import { writeFileSync } from "node:fs";
const { MemoryBrokerClient } = await import("./packages/memory-broker/src/client.ts");
const { MEMORY_LIMITS } = await import("./packages/memory-broker-contract/contract/index.ts");

const env = {
  PIPIUI_MEMORY_BROKER_MODE: "operator",
  PIPIUI_AGENT_ROLE: "operator",
  PIPIUI_MAIN_CWD: "/fixture/project",
  PIPIUI_MEMORY_BROKER_URL: "http://127.0.0.1:4567/v1/memory",
  PIPIUI_MEMORY_BROKER_TOKEN: "t".repeat(43),
  PIPIUI_MEMORY_PROJECT_ROOT: "/fixture/project",
  PIPIUI_MEMORY_BROKER_CAPABILITY: "m".repeat(64),
  PIPIUI_AGENT_ID: "operator-a",
  PIPIUI_AGENT_RUN_ID: "run-a",
  PIPIUI_COMPUTER_MEMORY_ENABLED: "1",
};
const requests = [];
const fetchStub = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  requests.push(body);
  return new Response(JSON.stringify({
    ok: true,
    version: 1,
    operation: "memory.query",
    results: Array.from({ length: 8 }, (_, index) => ({
      claim: "recipe-" + index + " " + "x".repeat(1000),
      score: index,
    })),
  }), { status: 200, headers: { "content-type": "application/json" } });
};
const client = new MemoryBrokerClient({
  mode: "operator",
  url: env.PIPIUI_MEMORY_BROKER_URL,
  token: env.PIPIUI_MEMORY_BROKER_TOKEN,
  capability: env.PIPIUI_MEMORY_BROKER_CAPABILITY,
  agentID: env.PIPIUI_AGENT_ID,
  runID: env.PIPIUI_AGENT_RUN_ID,
  projectRoot: env.PIPIUI_MEMORY_PROJECT_ROOT,
}, { fetchImpl: fetchStub });
const result = await client.query({
  text: "  editor   recipe ",
  scope: "project",
  budget: 99999,
  bundleID: "COM.Example.Editor",
  appName: " Example   Editor ",
});
writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({
  result,
  requests,
  appBudget: MEMORY_LIMITS.maximumApplicationQueryBudget,
  appResults: MEMORY_LIMITS.maximumQueryResults,
}));
`, "utf8");
  return harness;
}

test("operator app recall is bounded without adding memory identity to the raw Computer bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-computer-memory-"));
  try {
    const harness = await prepareHarness(directory);
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: { ...process.env },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    const request = out.requests[0]?.request;
    assert.ok(request, "memory_query must use the broker route");
    assert.equal(request.operation, "memory.query");
    assert.equal(request.query.bundleID, "com.example.editor");
    assert.equal(request.query.appName, "Example Editor");
    assert.equal(request.query.budget, out.appBudget, "app-scoped recall has a smaller budget");
    assert.equal(out.result.available, true);
    assert.equal(out.result.value.query.bundleID, "com.example.editor");
    assert.equal(out.result.value.query.appName, "Example Editor");
    assert.ok(out.result.value.results.length <= out.appResults);

    const [strategy, index, appStore, operatorPrompt] = await Promise.all([
      readFile(join(piExtRoot, "computer-use-strategy.ts"), "utf8"),
      readFile(join(piExtRoot, "subagent/index.ts"), "utf8"),
      readFile(join(repositoryRoot, "Sources/PipiUI/AppStore.swift"), "utf8"),
      readFile(join(piExtRoot, "agents/operator/AGENT.md"), "utf8"),
    ]);
    assert.doesNotMatch(strategy, /memoryBrokerCapability|computerMemoryBridgeContext|PIPIUI_COMPUTER_MEMORY_ENABLED/);
    assert.match(index, /runtimePolicy\.role === "operator" && desktopGrant\.granted/);
    assert.match(index, /PIPIUI_COMPUTER_MEMORY_ENABLED: "1"/);
    assert.match(index, /!computerMemoryEnabled/, "operator terminal prose must not become a second computer-memory source");
    assert.doesNotMatch(appStore, /ComputerMemoryBrokerAdapter|memory_broker|MemoryBrokerHost/);
    assert.match(operatorPrompt, /memory_query.*bundleID.*appName/s);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

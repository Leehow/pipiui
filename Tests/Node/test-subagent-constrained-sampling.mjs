import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piPackageRoot = join(
  repositoryRoot,
  "Electron/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");
const runtimeSources = [
  "Sources/PipiUI/PiExt/subagent",
  "Electron/resources/runtime/pi-ext/subagent",
];

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(
      join(piNodeModules, "@earendil-works/pi-agent-core"),
      join(scoped, "pi-agent-core"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-ai"),
      join(scoped, "pi-ai"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-tui"),
      join(scoped, "pi-tui"),
      "dir",
    ),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function probeRegistration(root, source, index) {
  const fixture = join(root, `fixture-${index}`);
  const runtime = join(fixture, "runtime");
  const repository = join(fixture, "repo");
  const agents = join(fixture, "agents");
  const home = join(fixture, "home");
  const sourceRoot = dirname(join(repositoryRoot, source));
  await Promise.all([
    cp(join(repositoryRoot, source), join(runtime, "subagent"), { recursive: true }),
    cp(
      join(sourceRoot, "packages/computer-agent"),
      join(runtime, "packages/computer-agent"),
      { recursive: true },
    ),
    mkdir(repository, { recursive: true }),
    mkdir(agents, { recursive: true }),
    mkdir(home, { recursive: true }),
  ]);
  await linkRuntimePackages(runtime);
  await writeFile(
    join(agents, "probe.md"),
    "---\nname: probe\ndescription: Dedicated parallel dispatch probe\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );

  const harness = join(runtime, "harness.mjs");
  await writeFile(
    harness,
    `if (process.argv.includes("--mode")) {
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "parallel-dispatch-ok" }],
      stopReason: "end",
    },
  }) + "\\n");
  process.exit(0);
}

const registrations = [];
const { default: install } = await import("./subagent/index.ts");
install({
  registerTool(tool) { registrations.push(tool); },
  registerCommand() {},
  on() {},
  async sendUserMessage() {},
});

const matching = registrations.filter((tool) => tool.name === "subagent");
const parallelMatching = registrations.filter((tool) => tool.name === "subagent_parallel");
const subagent = matching[0];
const parallel = parallelMatching[0];
if (!subagent) throw new Error("subagent tool was not registered");
if (!parallel) throw new Error("subagent_parallel tool was not registered");

let payload;
const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
const probe = stream(
  {
    id: "grok-4.6-strict-probe",
    name: "Grok 4.6 strict probe",
    api: "openai-completions",
    provider: "xai",
    baseUrl: "https://api.x.ai/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 512,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
    },
  },
  {
    messages: [{ role: "user", content: "probe", timestamp: Date.now() }],
    tools: [subagent, parallel],
  },
  {
    apiKey: "local-probe-no-network",
    onPayload(nextPayload) {
      payload = nextPayload;
      throw new Error("PIPIUI_PAYLOAD_CAPTURED");
    },
  },
);
for await (const _event of probe) {
  // onPayload intentionally stops before fetch; drain the resulting local error event.
}

let deepseekPayload;
const deepseekProbe = stream(
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro schema probe",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 512,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
  },
  {
    messages: [{ role: "user", content: "probe", timestamp: Date.now() }],
    tools: [subagent, parallel],
  },
  {
    apiKey: "local-probe-no-network",
    onPayload(nextPayload) {
      deepseekPayload = nextPayload;
      throw new Error("PIPIUI_DEEPSEEK_PAYLOAD_CAPTURED");
    },
  },
);
for await (const _event of deepseekProbe) {
  // onPayload intentionally stops before fetch; drain the resulting local error event.
}

const serialized = payload?.tools?.find(
  (entry) => entry.type === "function" && entry.function?.name === "subagent",
);
const serializedParallel = payload?.tools?.find(
  (entry) => entry.type === "function" && entry.function?.name === "subagent_parallel",
);
const deepseekSerialized = deepseekPayload?.tools?.find(
  (entry) => entry.type === "function" && entry.function?.name === "subagent",
);
const parameters = serialized?.function?.parameters;
const parallelParameters = serializedParallel?.function?.parameters;
const deepseekParameters = deepseekSerialized?.function?.parameters;
const branches = parameters?.anyOf;
const taskSchema = parallelParameters?.properties?.tasks?.items;
const unsupportedGrammarKeywords = [];
function collectUnsupportedGrammarKeywords(value, path = "$") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectUnsupportedGrammarKeywords(entry, path + "[" + index + "]"));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path + "." + key;
    if (key === "if" || key === "then" || key === "else") unsupportedGrammarKeywords.push(entryPath);
    if (key === "allOf" && Array.isArray(entry) && entry.length > 1) {
      unsupportedGrammarKeywords.push(entryPath + "[multiple]");
    }
    collectUnsupportedGrammarKeywords(entry, entryPath);
  }
}
collectUnsupportedGrammarKeywords(parameters);
async function rejectsResolve(params) {
  const result = await subagent.execute(
    "resolve-validation-probe",
    params,
    new AbortController().signal,
    undefined,
    { cwd: process.cwd() },
  );
  return result?.isError === true &&
    result?.content?.[0]?.text === 'action="resolve" requires both agentId and runId.';
}
async function executeLegacy(params, toolCallId) {
  return subagent.execute(
    toolCallId,
    params,
    new AbortController().signal,
    undefined,
    { cwd: process.cwd(), hasUI: false },
  );
}
const resolveMissingAgentIdRejected = await rejectsResolve({ action: "resolve", runId: "run-probe" });
const resolveMissingRunIdRejected = await rejectsResolve({ action: "resolve", agentId: "agent-probe" });
const abortMissingAgentIdResult = await executeLegacy({ action: "abort" }, "abort-validation-probe");
const invalidSingleResult = await executeLegacy({ agent: "probe" }, "single-validation-probe");
const mixedModeResult = await executeLegacy(
  {
    agent: "probe",
    task: "single mode",
    chain: [{ agent: "probe", task: "chain mode" }],
  },
  "mixed-mode-validation-probe",
);
const singleResult = await executeLegacy(
  { agent: "probe", task: "inspect the single path", agentId: "deepseek-single-probe" },
  "single-dispatch-probe",
);
const chainResult = await executeLegacy(
  { chain: [{ agent: "probe", task: "inspect the chain path", agentId: "deepseek-chain-probe" }] },
  "chain-dispatch-probe",
);
const parallelWrapperResult = await parallel.execute(
  "parallel-wrapper-probe",
  { tasks: [
    { task: "inspect first slice", agent: "probe" },
    { task: "inspect second slice", agent: "probe" },
  ] },
  new AbortController().signal,
  undefined,
  { cwd: process.cwd(), hasUI: false },
);
const dispatchedResults = parallelWrapperResult?.details?.results ?? [];
const generatedIds = dispatchedResults.map((result) => result.agentId);
process.stdout.write(JSON.stringify({
  registrationCount: matching.length,
  parallelRegistrationCount: parallelMatching.length,
  constrainedSampling: subagent.constrainedSampling ?? null,
  parallelConstrainedSampling: parallel.constrainedSampling ?? null,
  serializedStrict: serialized?.function?.strict ?? null,
  serializedParallelStrict: serializedParallel?.function?.strict ?? null,
  deepseekSerializedStrict: deepseekSerialized?.function?.strict ?? null,
  deepseekSerializedRootType: deepseekParameters?.type ?? null,
  deepseekSerializedParametersMatchRegistration:
    JSON.stringify(deepseekParameters) === JSON.stringify(subagent.parameters),
  serializedParametersMatchRegistration:
    JSON.stringify(parameters) === JSON.stringify(subagent.parameters),
  serializedRootType: parameters?.type ?? null,
  serializedRootUnionBranches: Array.isArray(branches) ? branches.length : 0,
  serializedRootAdditionalProperties: parameters?.additionalProperties ?? false,
  serializedRootPropertyNames: Object.keys(parameters?.properties ?? {}),
  oldSubagentAdvertisesTasks:
    Boolean(parameters?.properties?.tasks) ||
    (Array.isArray(branches) && branches.some((branch) => branch?.properties?.tasks)),
  serializedParallelRootType: parallelParameters?.type ?? null,
  serializedParallelRequired: parallelParameters?.required ?? null,
  serializedParallelRootAdditionalProperties: parallelParameters?.additionalProperties ?? false,
  serializedTaskType: taskSchema?.type ?? null,
  serializedTaskPropertyNames: Object.keys(taskSchema?.properties ?? {}),
  serializedTaskRequired: taskSchema?.required ?? null,
  serializedTaskPropertyType: taskSchema?.properties?.task?.type ?? null,
  serializedTaskAdditionalProperties: taskSchema?.additionalProperties ?? false,
  unsupportedGrammarKeywords,
  resolveMissingAgentIdRejected,
  resolveMissingRunIdRejected,
  abortMissingAgentIdRejected:
    abortMissingAgentIdResult?.isError === true &&
    abortMissingAgentIdResult?.content?.[0]?.text ===
      'action="abort" requires agentId of a running background job.',
  invalidSingleRejected: invalidSingleResult?.content?.[0]?.text?.startsWith("Invalid parameters.") === true,
  mixedModesRejected: mixedModeResult?.content?.[0]?.text?.startsWith("Invalid parameters.") === true,
  singleDispatches: singleResult?.details?.results?.length === 1 &&
    singleResult.details.results[0]?.exitCode === 0,
  chainDispatches: chainResult?.details?.results?.length === 1 &&
    chainResult.details.results[0]?.exitCode === 0,
  wrapperDispatchesWithoutSelfCollision:
    parallelWrapperResult?.isError !== true &&
    dispatchedResults.length === 2 &&
    dispatchedResults.every((result) => result.exitCode === 0),
  wrapperPreservesRequiredTasks: dispatchedResults.map((result) => result.task),
  wrapperGeneratedUniqueAgentIds:
    generatedIds.length === 2 &&
    new Set(generatedIds).size === 2 &&
    generatedIds.every((id) => /^agent-[0-9a-f]{16}$/.test(id)),
}));
`,
    "utf8",
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", harness],
    {
      cwd: repository,
      env: {
        ...process.env,
        HOME: home,
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: repository,
        PIPIUI_AGENTS_DIR: agents,
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_SUBAGENT_EXT: "",
        PIPIUI_SEARCH_SCOPE_EXT: "",
        PIPIUI_COMPUTER_EXT: "",
        PIPIUI_COMPUTER_CAPABILITY: "",
        PIPIUI_WEB_ACCESS_EXT: "",
        PIPIUI_ARXIV_EXT: "",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

test("both runtime copies strictly constrain the exact subagent registration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-subagent-strict-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const probes = [];
  for (const [index, source] of runtimeSources.entries()) {
    probes.push({ source, result: await probeRegistration(root, source, index) });
  }

  const expected = {
    registrationCount: 1,
    parallelRegistrationCount: 1,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    parallelConstrainedSampling: { type: "json_schema", strict: "prefer" },
    serializedStrict: true,
    serializedParallelStrict: true,
    deepseekSerializedStrict: true,
    deepseekSerializedRootType: "object",
    deepseekSerializedParametersMatchRegistration: true,
    serializedParametersMatchRegistration: true,
    serializedRootType: "object",
    serializedRootUnionBranches: 0,
    serializedRootAdditionalProperties: false,
    serializedRootPropertyNames: [
      "action",
      "agent",
      "task",
      "title",
      "blockedBy",
      "thinking",
      "agentId",
      "runId",
      "reason",
      "fresh",
      "cwd",
      "verify",
      "desktop",
      "chain",
      "agentScope",
      "confirmProjectAgents",
      "background",
    ],
    oldSubagentAdvertisesTasks: false,
    serializedParallelRootType: "object",
    serializedParallelRequired: ["tasks"],
    serializedParallelRootAdditionalProperties: false,
    serializedTaskType: "object",
    serializedTaskPropertyNames: ["task", "agent"],
    serializedTaskRequired: ["task", "agent"],
    serializedTaskPropertyType: "string",
    serializedTaskAdditionalProperties: false,
    unsupportedGrammarKeywords: [],
    resolveMissingAgentIdRejected: true,
    resolveMissingRunIdRejected: true,
    abortMissingAgentIdRejected: true,
    invalidSingleRejected: true,
    mixedModesRejected: true,
    singleDispatches: true,
    chainDispatches: true,
    wrapperDispatchesWithoutSelfCollision: true,
    wrapperPreservesRequiredTasks: ["inspect first slice", "inspect second slice"],
    wrapperGeneratedUniqueAgentIds: true,
  };
  for (const probe of probes) {
    assert.deepEqual(probe.result, expected, probe.source);
  }
  assert.deepEqual(probes[0].result, probes[1].result, "runtime registration contracts differ");
});

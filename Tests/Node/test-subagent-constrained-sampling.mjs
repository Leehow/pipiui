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
const chainMatching = registrations.filter((tool) => tool.name === "subagent_chain");
const abortMatching = registrations.filter((tool) => tool.name === "subagent_abort");
const resolveMatching = registrations.filter((tool) => tool.name === "subagent_resolve");
const statusMatching = registrations.filter((tool) => tool.name === "subagent_status");
const subagent = matching[0];
const parallel = parallelMatching[0];
const chain = chainMatching[0];
const abort = abortMatching[0];
const resolve = resolveMatching[0];
const status = statusMatching[0];
if (!subagent) throw new Error("subagent tool was not registered");
if (parallel) throw new Error("subagent_parallel must not be registered");
if (!chain) throw new Error("subagent_chain tool was not registered");
if (!abort) throw new Error("subagent_abort tool was not registered");
if (!resolve) throw new Error("subagent_resolve tool was not registered");
if (!status) throw new Error("subagent_status tool was not registered");

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
    tools: [subagent],
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
    tools: [subagent],
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

let codexPayload;
const { stream: streamCodex } = await import("@earendil-works/pi-ai/api/openai-codex-responses");
const fakeCodexJwt = [
  btoa(JSON.stringify({ alg: "none", typ: "JWT" })),
  btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "probe-account" } })),
  "sig",
].join(".");
const codexProbe = streamCodex(
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra schema probe",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 512,
  },
  {
    messages: [{ role: "user", content: "probe", timestamp: Date.now() }],
    tools: [subagent],
  },
  {
    apiKey: fakeCodexJwt,
    onPayload(nextPayload) {
      codexPayload = nextPayload;
      throw new Error("PIPIUI_CODEX_PAYLOAD_CAPTURED");
    },
  },
);
for await (const _event of codexProbe) {
  // onPayload intentionally stops before fetch; drain the resulting local error event.
}

const serialized = payload?.tools?.find(
  (entry) => entry.type === "function" && entry.function?.name === "subagent",
);
const deepseekSerialized = deepseekPayload?.tools?.find(
  (entry) => entry.type === "function" && entry.function?.name === "subagent",
);
const parameters = serialized?.function?.parameters;
const deepseekParameters = deepseekSerialized?.function?.parameters;
const codexSerialized = codexPayload?.tools?.find(
  (entry) => entry.type === "function" && entry.name === "subagent",
);
const codexParameters = codexSerialized?.parameters;
const branches = parameters?.anyOf;
const chainParameters = chain.parameters;
const chainItemSchema = chainParameters?.properties?.chain?.items;
const chainItemProperties = chainItemSchema?.properties ?? {};
const abortParameters = abort.parameters;
const resolveParameters = resolve.parameters;
const statusParameters = status.parameters;
function collectObjectsMissingAdditionalProperties(value, path = "$") {
  const missing = [];
  function walk(node, current) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, current + "[" + index + "]"));
      return;
    }
    if (node.type === "object" && node.additionalProperties !== false) missing.push(current);
    for (const [key, entry] of Object.entries(node)) walk(entry, current + "." + key);
  }
  walk(value, path);
  return missing;
}
function collectObjectsMissingRequiredKeys(value, path = "$") {
  const missing = [];
  function walk(node, current) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, current + "[" + index + "]"));
      return;
    }
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    if ((types.includes("object") || node.properties) && node.properties && typeof node.properties === "object") {
      const keys = Object.keys(node.properties);
      const required = Array.isArray(node.required) ? node.required : [];
      const absent = keys.filter((key) => !required.includes(key));
      if (absent.length > 0) missing.push({ path: current, missing: absent });
    }
    for (const [key, entry] of Object.entries(node)) walk(entry, current + "." + key);
  }
  walk(value, path);
  return missing;
}
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
async function executeTool(tool, params, toolCallId) {
  return tool.execute(
    toolCallId,
    params,
    new AbortController().signal,
    undefined,
    { cwd: process.cwd(), hasUI: false },
  );
}
const resolveMissingAgentIdRejected = await executeTool(resolve, { runId: "run-probe" }, "resolve-missing-agent");
const resolveMissingRunIdRejected = await executeTool(resolve, { agentId: "agent-probe" }, "resolve-missing-run");
const abortMissingAgentIdResult = await executeTool(abort, {}, "abort-validation-probe");
const invalidSingleResult = await executeTool(subagent, { agent: "probe" }, "single-validation-probe");
const mixedModeResult = await executeTool(
  subagent,
  {
    agent: "probe",
    task: "single mode",
    chain: [{ agent: "probe", task: "chain mode" }],
  },
  "mixed-mode-validation-probe",
);
const singleResult = await executeTool(
  subagent,
  { agent: "probe", task: "inspect the single path", agentId: "deepseek-single-probe" },
  "single-dispatch-probe",
);
// Legacy old-name chain payload (GLM / replayed history style) must survive the
// prepareArguments sanitizer: it has to come out speaking the public prompt/description
// schema (or validation would reject it) and still dispatch.
const chainPreparedLegacy = chain.prepareArguments({
  chain: [{ agent: "probe", task: "inspect the chain path", agentId: "deepseek-chain-probe" }],
});
const chainLegacyItem = chainPreparedLegacy?.chain?.[0] ?? {};
const chainResult = await executeTool(chain, chainPreparedLegacy, "chain-dispatch-probe");
// Grok Build spelling is the advertised contract; it must pass through unchanged.
const chainPreparedGrok = chain.prepareArguments({
  chain: [
    {
      prompt: "inspect the grok chain path",
      description: "grok chain probe",
      subagent_type: "probe",
      isolation: "none",
    },
  ],
});
const chainGrokItem = chainPreparedGrok?.chain?.[0] ?? {};
const grokChainResult = await executeTool(chain, chainPreparedGrok, "grok-chain-dispatch-probe");
function itemConformsToChainSchema(item) {
  const keys = Object.keys(item);
  const withinSchema = keys.every((key) => Boolean(chainItemProperties[key]));
  const required = (chainItemSchema?.required ?? []).every(
    (key) => typeof item[key] === "string" && item[key].length > 0,
  );
  return withinSchema && required;
}
const grokSingleResult = await executeTool(
  subagent,
  {
    prompt: "inspect the grok path",
    description: "grok probe",
    subagent_type: "probe",
    resume_from: "grok-single-probe",
  },
  "grok-dispatch-probe",
);
const subagentRequired = parameters?.required ?? subagent.parameters?.required ?? [];
process.stdout.write(JSON.stringify({
  registrationCount: matching.length,
  parallelRegistrationCount: parallelMatching.length,
  chainRegistrationCount: chainMatching.length,
  abortRegistrationCount: abortMatching.length,
  resolveRegistrationCount: resolveMatching.length,
  constrainedSampling: subagent.constrainedSampling ?? null,
  prepareArgumentsPresent: typeof subagent.prepareArguments === "function",
  serializedRootType: parameters?.type ?? null,
  serializedRootUnionBranches: Array.isArray(branches) ? branches.length : 0,
  serializedRootAdditionalProperties: parameters?.additionalProperties,
  serializedRootPropertyNames: Object.keys(parameters?.properties ?? {}),
  serializedRequired: subagentRequired,
  advertisesAction: Boolean(parameters?.properties?.action),
  advertisesChain: Boolean(parameters?.properties?.chain),
  advertisesTasks: Boolean(parameters?.properties?.tasks),
  advertisesRunId: Boolean(parameters?.properties?.runId),
  oldSubagentAdvertisesTasks: Boolean(parameters?.properties?.tasks),
  chainRequired: chainParameters?.required ?? null,
  chainItemPropertyNames: Object.keys(chainItemProperties),
  chainItemRequired: chainItemSchema?.required ?? null,
  chainItemAdvertisesOldNames: ["task", "title", "agent", "worktree", "noWorktreeReason"]
    .filter((key) => Boolean(chainItemProperties[key])),
  legacyChainPreparedConforms: itemConformsToChainSchema(chainLegacyItem),
  grokChainPreparedConforms: itemConformsToChainSchema(chainGrokItem),
  abortRequired: abortParameters?.required ?? null,
  resolveRequired: resolveParameters?.required ?? null,
  statusRequired: statusParameters?.required ?? [],
  objectsMissingAdditionalProperties: collectObjectsMissingAdditionalProperties(parameters),
  serializedRequiredMatchesRegistration:
    JSON.stringify(parameters?.required ?? []) === JSON.stringify(subagent.parameters?.required ?? []),
  serializedNamesMatchRegistration:
    JSON.stringify(Object.keys(parameters?.properties ?? {})) ===
    JSON.stringify(Object.keys(subagent.parameters?.properties ?? {})),
  unsupportedGrammarKeywords,
  resolveMissingAgentIdRejected:
    resolveMissingAgentIdRejected?.isError === true &&
    resolveMissingAgentIdRejected?.content?.[0]?.text === 'action="resolve" requires both agentId and runId.',
  resolveMissingRunIdRejected:
    resolveMissingRunIdRejected?.isError === true &&
    resolveMissingRunIdRejected?.content?.[0]?.text === 'action="resolve" requires both agentId and runId.',
  abortMissingAgentIdRejected:
    abortMissingAgentIdResult?.isError === true &&
    abortMissingAgentIdResult?.content?.[0]?.text ===
      'action="abort" requires agentId of a running background job.',
  invalidSingleRejected: invalidSingleResult?.content?.[0]?.text?.startsWith("Invalid parameters.") === true,
  mixedModesRejected: mixedModeResult?.content?.[0]?.text?.startsWith("Invalid parameters.") === true,
  singleDispatches: singleResult?.details?.results?.length === 1 &&
    singleResult.details.results[0]?.exitCode === 0,
  grokFieldDispatches: grokSingleResult?.details?.results?.length === 1 &&
    grokSingleResult.details.results[0]?.exitCode === 0,
  chainDispatches: chainResult?.details?.results?.length === 1 &&
    chainResult.details.results[0]?.exitCode === 0,
  grokChainDispatches: grokChainResult?.details?.results?.length === 1 &&
    grokChainResult.details.results[0]?.exitCode === 0,
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

test("both runtime copies register split subagent tools with slim required fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-subagent-split-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const probes = [];
  for (const [index, source] of runtimeSources.entries()) {
    probes.push({ source, result: await probeRegistration(root, source, index) });
  }

  const expected = {
    registrationCount: 1,
    parallelRegistrationCount: 0,
    chainRegistrationCount: 1,
    abortRegistrationCount: 1,
    resolveRegistrationCount: 1,
    constrainedSampling: null,
    // The pre-validation sanitizer must be attached: pi validates arguments
    // before execute(), and null fillers (`action: null`) would otherwise loop
    // the turn on "root: must not have additional properties".
    prepareArgumentsPresent: true,
    serializedRootType: "object",
    serializedRootUnionBranches: 0,
    serializedRootAdditionalProperties: false,
    serializedRootPropertyNames: [
      "prompt",
      "description",
      "subagent_type",
      "run_in_background",
      "isolation",
      "cwd",
      "resume_from",
    ],
    serializedRequired: ["prompt", "description"],
    advertisesAction: false,
    advertisesChain: false,
    advertisesTasks: false,
    advertisesRunId: false,
    oldSubagentAdvertisesTasks: false,
    chainRequired: ["chain"],
    // Chain items must advertise only the Grok Build / Claude-family dispatch names.
    // Grok 4.6 provably cannot emit a required long field named `task` on this tool
    // (2026-08-15 live probes: 0/5 with task, 6/6 with prompt); old names stay
    // sanitizer-only.
    chainItemPropertyNames: [
      "prompt",
      "description",
      "subagent_type",
      "agentId",
      "cwd",
      "verify",
      "thinking",
      "isolation",
      "heartbeatSecs",
      "timeoutSecs",
      "desktop",
    ],
    chainItemRequired: ["prompt", "description"],
    chainItemAdvertisesOldNames: [],
    legacyChainPreparedConforms: true,
    grokChainPreparedConforms: true,
    abortRequired: ["agentId"],
    resolveRequired: ["agentId", "runId"],
    statusRequired: [],
    objectsMissingAdditionalProperties: [],
    serializedRequiredMatchesRegistration: true,
    serializedNamesMatchRegistration: true,
    unsupportedGrammarKeywords: [],
    resolveMissingAgentIdRejected: true,
    resolveMissingRunIdRejected: true,
    abortMissingAgentIdRejected: true,
    invalidSingleRejected: true,
    mixedModesRejected: true,
    singleDispatches: true,
    grokFieldDispatches: true,
    chainDispatches: true,
    grokChainDispatches: true,
  };
  for (const probe of probes) {
    assert.deepEqual(probe.result, expected, probe.source);
  }
  assert.deepEqual(probes[0].result, probes[1].result, "runtime registration contracts differ");
});

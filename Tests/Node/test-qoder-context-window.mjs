import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

/** The real API fixture: qmodel_preview with 200K default + 400K/1M tiers. */
function qmodelPreviewRawEntry() {
  return {
    key: "qmodel_preview",
    format: "openai",
    source: "system",
    enable: true,
    display_name: "Qwen3.8-Max-Preview",
    is_vl: true,
    is_reasoning: true,
    is_default: false,
    is_new: true,
    price_factor: 0.01,
    max_input_tokens: 180000,
    is_editable: true,
    context_config: {
      "1M": { token_count: 1000000 },
      "200K": { token_count: 200000, is_default: true },
      "400K": { token_count: 400000 },
    },
    thinking_config: { disabled: {}, enabled: { is_default: true } },
    max_output_tokens: 32768,
  };
}

/** Cache fixture mirroring ~/.pi/agent/qoder-cn-models-cache.json (raw API). */
function cacheFixture() {
  return {
    updatedAt: Date.now(),
    models: [
      {
        id: "auto",
        name: "Auto · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: "https://gateway.qoder.com.cn/",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 180000,
        maxTokens: 32768,
      },
      {
        id: "qmodel_preview",
        name: "Qwen 3.8-Max-Preview · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: "https://gateway.qoder.com.cn/",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000, // ← package bug: max tier instead of default 200K
        maxTokens: 32768,
      },
      {
        id: "qwen3.7-max",
        name: "Qwen 3.7 Max · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: "https://gateway.qoder.com.cn/",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 32768,
      },
    ],
    configs: {
      qmodel_preview: qmodelPreviewRawEntry(),
      "qwen3.7-max": { ...qmodelPreviewRawEntry(), key: "qmodel_latest", display_name: "Qwen3.7-Max" },
      auto: { key: "auto", max_input_tokens: 180000, is_reasoning: true, max_output_tokens: 32768, source: "system" },
    },
  };
}

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  const { symlink } = await import("node:fs/promises");
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

/**
 * In-process fixture tests: load the REAL qoder-context-window.ts and
 * qoder-stream.ts modules with a temp state dir, drive the pure helpers and
 * the request builder against the real API fixture.
 */
async function runFixtureHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  // Isolated HOME + PI_CODING_AGENT_DIR: `getMachineId()` (and any future
  // state reads) resolve against the temp home, so a missing machineID in a
  // fixture can never write the real ~/.pi/agent. PIPIUI_QODER_AGENT_DIR
  // still points the cache/auth reads at the fixture agent dir.
  const homeDir = join(directory, "home");
  await mkdir(homeDir, { recursive: true });
  const agentDir = join(directory, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "qoder-cn-models-cache.json"),
    JSON.stringify(cacheFixture(), null, 2),
  );
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify({
      "qoder-cn": {
        type: "oauth",
        access: "job-token-fixture",
        userID: "uid-123",
        name: "Fixture User",
        email: "fixture@example.com",
        machineID: "machine-42",
      },
    }),
  );

  const harness = join(directory, "fixture-harness.mjs");
  await writeFile(
    harness,
    `import { writeFileSync } from "node:fs";

process.env.PIPIUI_QODER_AGENT_DIR = ${JSON.stringify(agentDir)};

const { resolveDefaultContextWindow, normalizedModels, modelConfigForRequest } = await import(
  "./subagent/qoder-context-window.ts"
);
const { buildQoderRequestBody } = await import("./subagent/qoder-stream.ts");

const raw = JSON.parse(
  await import("node:fs/promises").then((m) => m.readFile(${JSON.stringify(join(directory, "fixture-cache.json"))}, "utf8")),
);
const entry = raw.configs.qmodel_preview;
const results = {};

// 1) default tier priority: 200K wins over 1M/400K.
results.defaultTier = resolveDefaultContextWindow(entry, 0);
results.entryContext = raw.configs.qmodel_preview.context_config;

// 2) no default tier anywhere -> max_input_tokens fallback.
const noDefault = { ...entry, context_config: { "1M": { token_count: 1000000 }, "400K": { token_count: 400000 } } };
results.noDefaultFallback = resolveDefaultContextWindow(noDefault, 123456);

// 3) no context_config at all -> fallback value.
results.noConfigFallback = resolveDefaultContextWindow({ key: "x" }, 424242);

// 4) per-model normalization: only cache-known models change; others untouched.
const models = [
  { id: "qmodel_preview", provider: "qoder-cn", contextWindow: 1000000 },
  { id: "qwen3.7-max", provider: "qoder-cn", contextWindow: 1000000 },
  { id: "auto", provider: "qoder-cn", contextWindow: 180000 },
  { id: "some-other-model", provider: "qoder-cn", contextWindow: 777777 },
];
results.normalized = normalizedModels(models, raw.configs);

// 5) request model_config keeps the API-marked default (200K), never max.
const mc = modelConfigForRequest(entry);
results.requestModelConfig = mc;
results.requestModelConfigIsMax = mc.context_config["1M"].is_default === true;
results.requestModelConfigDefaultIs200K = mc.context_config["200K"].is_default === true;

// 6) real request body from the vendored stream keeps the raw model_config.
const fakeModel = {
  id: "qmodel_preview",
  provider: "qoder-cn",
  api: "qoder-api",
  baseUrl: "https://gateway.qoder.com.cn/",
  reasoning: true,
  contextWindow: 200000,
  maxTokens: 32768,
};
const plan = buildQoderRequestBody(
  fakeModel,
  {
    messages: [{ role: "user", content: [{ type: "text", text: "hello qoder" }] }],
    systemPrompt: "sys",
    tools: [],
  },
  { apiKey: "job-token-fixture" },
);
results.reqBodyModelConfig = plan.reqBody.model_config;
results.reqBodyModelConfigMaxDefault = plan.reqBody.model_config?.context_config?.["1M"]?.is_default === true;
results.reqBodyModelConfig200KDefault = plan.reqBody.model_config?.context_config?.["200K"]?.is_default === true;
results.reqBodyModelKey = plan.reqBody.model_config?.key;
results.signed = {
  hasAuth: typeof plan.headers.Authorization === "string" && plan.headers.Authorization.startsWith("Bearer COSY."),
  bodyHash: plan.headers["Cosy-Bodyhash"],
  encodedLength: plan.encodedBody.length,
  sigPath: plan.headers["Cosy-Sigpath"],
};

// 7) no-cache fallback: wipe the CN cache so EVERY key takes the upstream
//    getCachedModelConfig no-cache branch (readRawModelConfig re-reads the
//    file per call, so the wipe is effective). Mirrors the 0.2.9
//    reasoningModels set exactly; global mode reads the global cache file
//    which never exists here, so it always takes the fallback heuristic.
await import("node:fs/promises").then((m) =>
  m.writeFile(${JSON.stringify(join(agentDir, "qoder-cn-models-cache.json"))}, JSON.stringify({ configs: {} })),
);
const mkPlan = (modelId, provider = "qoder-cn") =>
  buildQoderRequestBody(
    {
      id: modelId,
      provider,
      api: "qoder-api",
      baseUrl: "https://gateway.qoder.com.cn/",
      contextWindow: 200000,
      maxTokens: 32768,
    },
    { messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], systemPrompt: "", tools: [] },
    { apiKey: "job-token-fixture" },
  );
const cnFallbackIsReasoning = (modelId) => mkPlan(modelId).reqBody.model_config?.is_reasoning;
const globalFallbackIsReasoning = (modelId) => mkPlan(modelId, "qoder").reqBody.model_config?.is_reasoning;
results.cnFallback = {
  // 0.2.9 reasoningModels members (explicit set, no wildcards):
  auto: cnFallbackIsReasoning("qoder-cn"),
  qmodel_latest: cnFallbackIsReasoning("qwen3.7-max"),
  qmodel: cnFallbackIsReasoning("qwen3.7-plus"),
  q36fmodel: cnFallbackIsReasoning("qwen3.6-flash"),
  qfmodel: cnFallbackIsReasoning("qfmodel"),
  dmodel: cnFallbackIsReasoning("deepseek-v4-pro"),
  gm51model: cnFallbackIsReasoning("glm-5.2"),
  kmodel: cnFallbackIsReasoning("kimi-k2.6"),
  qwen3_7_max: cnFallbackIsReasoning("qwen3.7-max"),
  deepseek_v4_pro: cnFallbackIsReasoning("deepseek-v4-pro"),
  glm_5_1: cnFallbackIsReasoning("glm-5.1"),
  kimi_k2_6: cnFallbackIsReasoning("kimi-k2.6"),
  // NOT in the 0.2.9 CN set (an earlier port wrongly marked these reasoning):
  dfmodel: cnFallbackIsReasoning("deepseek-v4-flash"),
  ultimate: cnFallbackIsReasoning("ultimate"),
  mmodel: cnFallbackIsReasoning("minimax-m3"),
};
results.globalFallback = {
  ultimate: globalFallbackIsReasoning("ultimate"),
  performance: globalFallbackIsReasoning("performance"),
  dmodel: globalFallbackIsReasoning("dmodel"),
  dfmodel: globalFallbackIsReasoning("dfmodel"),
  plain: globalFallbackIsReasoning("plain-model"),
};

// 8) drift canary: fixed request-shape constants, verbatim from 0.2.9 dist.
results.canary = {
  cosyVersion: plan.headers["Cosy-Version"],
  loginVersion: plan.headers["Login-Version"],
  clientType: plan.headers["Cosy-Clienttype"],
  sigPath: plan.headers["Cosy-Sigpath"],
  reqVersion: plan.reqBody.version,
  sessionType: plan.reqBody.session_type,
  agentId: plan.reqBody.agent_id,
  taskId: plan.reqBody.task_id,
  chatTask: plan.reqBody.chat_task,
  businessProduct: plan.reqBody.business?.product,
  bodyHash: plan.headers["Cosy-Bodyhash"],
};

writeFileSync(${JSON.stringify(join(directory, "result.json"))}, JSON.stringify(results));
`,
  );
  await writeFile(join(directory, "fixture-cache.json"), JSON.stringify(cacheFixture()));
  await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: directory,
    env: {
      ...process.env,
      HOME: homeDir,
      PI_CODING_AGENT_DIR: agentDir,
      PIPIUI_AGENT_DEPTH: "0",
    },
    timeout: 60_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
}

/**
 * Real-pi RPC E2E through the production load path: pi process with an
 * isolated agent dir, a buggy fake pi-provider-qoder package (reproduces the
 * npm package's registration: max-tier contextWindow + clobbering modifyModels)
 * and the REAL App-owned PiExt extension. Asserts the pi runtime reports
 * contextWindow 200000 for qoder-cn/qmodel_preview.
 */
async function runRpcE2E(directory) {
  const pi = join(homedir(), ".npm-global", "bin", "pi");
  const agentDir = join(directory, "pi-agent");
  const homeDir = join(directory, "home");
  await mkdir(join(agentDir), { recursive: true });
  await mkdir(join(homeDir), { recursive: true });
  // Production layout: the qoder package (and our compat layer) read the model
  // cache from ~/.pi/agent (homedir). HOME redirect makes temp-home/.pi/agent
  // the faithful location; PI_CODING_AGENT_DIR only redirects pi's own state.
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(homeDir, ".pi", "agent", "qoder-cn-models-cache.json"),
    JSON.stringify(cacheFixture()),
  );

  // Fake npm package: reproduces pi-provider-qoder@0.2.9 registration
  // (max-tier contextWindow, oauth modifyModels that re-injects its model list).
  const fakePackage = join(directory, "fake-qoder-package.mjs");
  await writeFile(
    fakePackage,
    `const buggyModels = [
  { id: "auto", name: "Auto · Qoder CN", api: "qoder-api", provider: "qoder-cn", baseUrl: "https://gateway.qoder.com.cn/", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 180000, maxTokens: 32768 },
  { id: "qmodel_preview", name: "Qwen 3.8-Max-Preview · Qoder CN", api: "qoder-api", provider: "qoder-cn", baseUrl: "https://gateway.qoder.com.cn/", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
  { id: "qwen3.7-max", name: "Qwen 3.7 Max · Qoder CN", api: "qoder-api", provider: "qoder-cn", baseUrl: "https://gateway.qoder.com.cn/", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000000, maxTokens: 32768 },
];
export default function (pi) {
  pi.registerProvider("qoder-cn", {
    name: "Qoder CN",
    baseUrl: "https://gateway.qoder.com.cn/",
    api: "qoder-api",
    models: buggyModels.map((m) => ({ ...m })),
    oauth: {
      name: "Qoder CN (PAT)",
      login: async () => { throw new Error("no interactive login in tests"); },
      refreshToken: async (c) => c,
      getApiKey: (c) => c.access,
      modifyModels: (models) => [...models.filter((m) => m.provider !== "qoder-cn"), ...buggyModels.map((m) => ({ ...m }))],
    },
    streamSimple: () => { throw new Error("fake package stream must not be called in this test"); },
  });
}
`,
  );

  const ext = join(directory, "subagent");
  await cp(sourceSubagentDirectory, ext, { recursive: true });
  await linkRuntimePackages(ext);

  const projectDir = join(directory, "project");
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  const sessionDir = join(directory, "sessions");
  await mkdir(sessionDir, { recursive: true });

  const child = spawn(
    pi,
    [
      "--mode", "rpc",
      "--session-dir", sessionDir,
      "--session-id", "qoder-e2e",
      "--no-skills",
      "--model", "qoder-cn/qmodel_preview",
      "-e", ext,
      "-e", fakePackage,
    ],
    {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
      env: {
        ...process.env,
        HOME: homeDir,
        PI_CODING_AGENT_DIR: agentDir,
        PIPIUI_AGENT_DEPTH: "0",
      },
    },
  );
  let buf = "";
  const responses = new Map();
  const errors = [];
  child.stderr.on("data", (d) => errors.push(d.toString()));
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.type === "response") responses.set(j.id, j);
      else if (j.type === "error") errors.push(JSON.stringify(j));
    }
  });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  const waitResponse = (id, ms = 30_000) =>
    new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (responses.has(id)) { clearInterval(iv); res(responses.get(id)); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout waiting " + id)); }
      }, 50);
    });
  try {
    await new Promise((r) => setTimeout(r, 3000)); // pi boot + session_start
    send({ id: 1, type: "get_state" });
    const st = await waitResponse(1);
    const model = st.data?.model ?? null;
    send({ id: 2, type: "get_session_stats" });
    const stats = await waitResponse(2);
    send({ id: 3, type: "get_available_models" });
    const am = await waitResponse(3);
    const qmodel = am.data?.models?.find((m) => m.provider === "qoder-cn" && m.id === "qmodel_preview") ?? null;
    return {
      stateModel: model,
      contextUsage: stats.data?.contextUsage ?? null,
      availableQmodel: qmodel,
      stderrTail: errors.join("").slice(-2000),
    };
  } finally {
    child.kill("SIGTERM");
  }
}

test("qoder context window: default tier 200K wins over 400K/1M tiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-"));
  try {
    const out = await runFixtureHarness(directory);
    assert.equal(out.defaultTier, 200000, "API-marked default tier must win");
    assert.equal(out.noDefaultFallback, 180000, "max_input_tokens fallback when no tier is default");
    assert.equal(out.noConfigFallback, 424242, "existing value kept when no config entry");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qoder context window: precise provider/model normalization (no global Qwen rewrite)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-"));
  try {
    const out = await runFixtureHarness(directory);
    const byId = Object.fromEntries(out.normalized.map((m) => [m.id, m]));
    assert.equal(byId.qmodel_preview.contextWindow, 200000, "qmodel_preview -> 200K default tier");
    assert.equal(byId["qwen3.7-max"].contextWindow, 200000, "other multi-tier CN models normalized per their own entry");
    assert.equal(byId.auto.contextWindow, 180000, "auto keeps max_input_tokens");
    assert.equal(byId["some-other-model"].contextWindow, 777777, "models without a cache entry are untouched");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qoder request model_config keeps API default 200K (never promoted to 1M)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-"));
  try {
    const out = await runFixtureHarness(directory);
    // pure helper
    assert.equal(out.requestModelConfigIsMax, false, "1M tier must not become default");
    assert.equal(out.requestModelConfigDefaultIs200K, true, "200K tier stays default");
    // real vendored-stream request body
    assert.equal(out.reqBodyModelConfigMaxDefault, false, "request body must not promote 1M");
    assert.equal(out.reqBodyModelConfig200KDefault, true, "request body keeps 200K default");
    assert.equal(out.reqBodyModelKey, "qmodel_preview");
    // signing still intact
    assert.equal(out.signed.hasAuth, true, "COSY Authorization header present");
    assert.ok(out.signed.bodyHash && out.signed.encodedLength > 0 && out.signed.sigPath, "signed body fields present");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qoder no-cache fallback: CN reasoningModels set + global heuristic (verbatim 0.2.9)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-"));
  try {
    const out = await runFixtureHarness(directory);
    const cn = out.cnFallback;
    // 0.2.9 `reasoningModels` members — explicit set, replicated verbatim.
    for (const [key, label] of [
      ["auto", "auto"],
      ["qmodel_latest", "qmodel_latest"],
      ["qmodel", "qmodel"],
      ["q36fmodel", "q36fmodel"],
      ["qfmodel", "qfmodel"],
      ["dmodel", "dmodel"],
      ["gm51model", "gm51model"],
      ["kmodel", "kmodel"],
      ["qwen3_7_max", "qwen3.7-max"],
      ["deepseek_v4_pro", "deepseek-v4-pro"],
      ["glm_5_1", "glm-5.1"],
      ["kimi_k2_6", "kimi-k2.6"],
    ]) {
      assert.equal(cn[key], true, `CN fallback must mark ${label} as reasoning (0.2.9 reasoningModels)`);
    }
    // NOT members of the 0.2.9 CN set — the earlier port wrongly marked these.
    assert.equal(cn.dfmodel, false, "CN fallback must NOT mark dfmodel (absent from 0.2.9 set)");
    assert.equal(cn.ultimate, false, "CN fallback must NOT mark ultimate (absent from 0.2.9 set)");
    assert.equal(cn.mmodel, false, "CN fallback must NOT mark mmodel (absent from 0.2.9 set)");
    // Global mode keeps the package's own heuristic fallback.
    const gl = out.globalFallback;
    assert.equal(gl.ultimate, true, "global fallback keeps the ultimate heuristic");
    assert.equal(gl.performance, true, "global fallback keeps the performance heuristic");
    assert.equal(gl.dmodel, true, "global fallback keeps the dmodel heuristic");
    assert.equal(gl.dfmodel, true, "global fallback keeps the dfmodel heuristic");
    assert.equal(gl.plain, false, "global fallback leaves plain models non-reasoning");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qoder drift canary: fixed 0.2.9 request-shape constants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-"));
  try {
    const out = await runFixtureHarness(directory);
    // Verbatim from the pinned 0.2.9 dist (see qoder-stream.ts sync baseline).
    assert.equal(out.canary.cosyVersion, "1.1.3", "Cosy-Version must stay pinned");
    assert.equal(out.canary.loginVersion, "v2", "Login-Version must stay pinned");
    assert.equal(out.canary.clientType, "5", "Cosy-Clienttype must stay pinned");
    assert.equal(out.canary.sigPath, "/api/v2/service/pro/sse/agent_chat_generation", "Cosy-Sigpath strips the /algo prefix (computeSigPath, verbatim)");
    assert.equal(out.canary.reqVersion, "3", "request version must stay pinned");
    assert.equal(out.canary.sessionType, "qodercli", "session_type must stay pinned");
    assert.equal(out.canary.agentId, "agent_common", "agent_id must stay pinned");
    assert.equal(out.canary.taskId, "common", "task_id must stay pinned");
    assert.equal(out.canary.chatTask, "FREE_INPUT", "chat_task must stay pinned");
    assert.equal(out.canary.businessProduct, "cli", "business.product must stay pinned");
    assert.ok(out.canary.bodyHash, "Cosy-Bodyhash must be present");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("qoder context window: real pi RPC reports 200000 in model + session stats", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-qoder-e2e-"));
  try {
    const out = await runRpcE2E(directory);
    assert.ok(out.stateModel, "get_state must resolve a model; stderr tail: " + out.stderrTail);
    assert.equal(out.stateModel.provider, "qoder-cn");
    assert.equal(out.stateModel.id, "qmodel_preview");
    assert.equal(out.stateModel.contextWindow, 200000, "pi runtime model.contextWindow must be 200000");
    assert.ok(out.contextUsage, "session stats must report contextUsage");
    assert.equal(out.contextUsage.contextWindow, 200000, "get_session_stats.contextUsage.contextWindow must be 200000");
    // get_available_models filters by configured auth (none in this hermetic
    // test); when the model does appear its window must already be normalized.
    if (out.availableQmodel) {
      assert.equal(out.availableQmodel.contextWindow, 200000, "registry model must be 200000");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

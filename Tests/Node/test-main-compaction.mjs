import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

/**
 * Harness: loads the real subagent/index.ts (extension factory) with a fake pi
 * API, captures the `session_before_compact` handler, then drives it with fake
 * event/ctx. Outputs JSON results to stdout.
 */
async function prepareHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `import { writeFileSync } from "node:fs";

const outputPath = ${JSON.stringify(join(directory, "result.json"))};

const handlers = {};
const fakePi = {
  on(event, handler) {
    handlers[event] = handler;
  },
  registerTool() {},
  registerCommand() {},
  async sendUserMessage() {},
};

const { default: install } = await import("./subagent/index.ts");
install(fakePi);

const compactHandler = handlers["session_before_compact"];
if (typeof compactHandler !== "function") {
  process.stderr.write("session_before_compact handler not registered\\n");
  process.exit(2);
}

const mkMsg = (role, text) => ({
  role,
  content: [{ type: "text", text }],
});

const results = {};

// 1) deterministic path (LLM disabled env): pi-compatible compaction result.
const event1 = {
  reason: "threshold",
  willRetry: false,
  signal: undefined,
  preparation: {
    firstKeptEntryId: "entry-42",
    tokensBefore: 264167,
    previousSummary: "## Goal\\nFix the flaky test.\\n## Key Decisions\\n- Use realtime logs.",
    fileOps: {
      read: new Set(["Sources/a.ts", "Sources/b.ts"]),
      written: new Set(["Sources/c.ts"]),
      edited: new Set(["Sources/a.ts"]),
    },
    messagesToSummarize: [
      mkMsg("user", "Build the reporting feature"),
      mkMsg("assistant", "Started on the report generator..."),
      mkMsg("user", "Also add CSV export"),
    ],
    turnPrefixMessages: [],
  },
};
results.deterministic = await compactHandler(event1, { model: undefined, modelRegistry: undefined });

// 2) no env flag + no model: must still produce a deterministic result without network.
delete process.env.PIPIUI_COMPACTION_LLM_DISABLED;
const event2 = { ...event1, reason: "overflow", willRetry: true };
results.noModel = await compactHandler(event2, { model: undefined, modelRegistry: undefined });

// 3) bounded serialization: huge single user message must be truncated with marker.
const bigText = "x".repeat(300_000);
const { boundedSerializeConversation, buildDeterministicSummary } = await import(
  "./subagent/main-compaction.ts"
);
const serialized = boundedSerializeConversation([mkMsg("user", bigText)]);
results.bounded = {
  truncated: serialized.length < 210_000,
  hasMarker: serialized.includes("已截断"),
  hasHead: serialized.startsWith("[User]:"),
  hasTail: /x{100}$/.test(serialized),
  deterministic: buildDeterministicSummary({
    serialized,
    previousSummary: undefined,
    fileOps: { read: new Set(["a.ts"]), written: new Set(), edited: new Set() },
    tokensBefore: 5000,
    messageCount: 1,
    reason: "manual",
  }),
};

// 4) garbage messages must never throw out of the handler (safe fallback).
results.garbage = await compactHandler(
  {
    reason: "threshold",
    willRetry: false,
    signal: undefined,
    preparation: {
      firstKeptEntryId: "entry-7",
      tokensBefore: 100,
      messagesToSummarize: [null, { role: "user", content: 42 }],
      turnPrefixMessages: [],
      fileOps: undefined,
    },
  },
  { model: undefined, modelRegistry: undefined },
);

writeFileSync(outputPath, JSON.stringify(results));
process.exit(0);
`,
    "utf8",
  );
  return harness;
}

async function runHarness(directory, harness, { timeoutMs = 30_000 } = {}) {
  await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: directory,
    env: {
      ...process.env,
      PIPIUI_AGENT_DEPTH: "0",
      PIPIUI_COMPACTION_LLM_DISABLED: "1",
    },
    timeout: timeoutMs,
    maxBuffer: 5 * 1024 * 1024,
  });
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
}

/**
 * RPC-mode E2E: real pi + real subagent extension + real `compact` command on a
 * fixture session. With PIPIUI_COMPACTION_LLM_DISABLED=1 the hook takes the
 * deterministic path, so no network/API key is needed (a model must still be
 * selected because upstream compact() requires one before the hook runs).
 */
async function runCompactE2E(directory) {
  const { spawn } = await import("node:child_process");
  const { realpath, readFile: readFileP } = await import("node:fs/promises");
  const pi = join(homedir(), ".npm-global", "bin", "pi");
  const ext = join(directory, "subagent");
  const sessionDir = join(directory, "sessions");
  const projectDir = join(await realpath(directory), "project");
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  // Fixture: 30 turns (~150KB) so the default keepRecentTokens=20000 cut applies.
  const lines = [];
  const hdr = {
    type: "session",
    version: 3,
    id: "e2e-sess",
    timestamp: new Date().toISOString(),
    cwd: projectDir,
  };
  lines.push(JSON.stringify(hdr));
  let parentId = hdr.id;
  const chunk = (n, tag) => `${tag} `.repeat(Math.ceil(n / (tag.length + 1)));
  for (let i = 1; i <= 30; i++) {
    const uid = `u${i}`;
    lines.push(JSON.stringify({ type: "message", id: uid, parentId, timestamp: Date.now() + i, message: { role: "user", content: [{ type: "text", text: chunk(2500, `USER-GOAL-${i}: implement reporting with CSV export`) }], timestamp: Date.now() + i } }));
    parentId = uid;
    const aid = `a${i}`;
    lines.push(JSON.stringify({ type: "message", id: aid, parentId: uid, timestamp: Date.now() + i + 1, message: { role: "assistant", content: [{ type: "text", text: chunk(2000, `ASSISTANT-PROGRESS-${i}: schema designed, generator written`) }], timestamp: Date.now() + i + 1, stopReason: "end" } }));
    parentId = aid;
  }
  const sessionFile = join(sessionDir, `1754000000000_e2e-sess.jsonl`);
  await writeFile(sessionFile, lines.join("\n") + "\n");

  const child = spawn(pi, ["--mode", "rpc", "--session-dir", sessionDir, "--session-id", "e2e-sess", "--no-skills", "-e", ext], {
    cwd: projectDir,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
    env: { ...process.env, PIPIUI_AGENT_DEPTH: "0", PIPIUI_COMPACTION_LLM_DISABLED: "1" },
  });
  let buf = "";
  const responses = new Map();
  const events = [];
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
      else if (j.type === "compaction_start" || j.type === "compaction_end") events.push(j);
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
    await new Promise((r) => setTimeout(r, 2500)); // pi boot
    send({ id: 1, type: "get_state" });
    const st = await waitResponse(1);
    if (!st.data?.model) {
      send({ id: 2, type: "get_available_models" });
      const am = await waitResponse(2);
      const first = am.data?.models?.[0];
      if (!first) return { skipped: "no model available" };
      send({ id: 3, type: "set_model", provider: first.provider, modelId: first.id });
      await waitResponse(3);
    }
    const started = Date.now();
    send({ id: 4, type: "compact" });
    const cr = await waitResponse(4);
    const saved = await readFileP(sessionFile, "utf8");
    const entries = saved.trim().split("\n").map((l) => JSON.parse(l));
    return {
      success: cr.success,
      error: cr.error ?? null,
      elapsedMs: Date.now() - started,
      details: cr.data?.details ?? null,
      summaryHasGoal: String(cr.data?.summary ?? "").includes("## Goal"),
      entryCount: entries.filter((e) => e.type === "compaction").length,
      entryDetails: entries.filter((e) => e.type === "compaction")[0]?.details ?? null,
      events,
    };
  } finally {
    child.kill("SIGTERM");
  }
}

test("main-session compaction hook: deterministic path, no-model fallback, bounded serialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-compaction-"));
  try {
    const harness = await prepareHarness(directory);
    const out = await runHarness(directory, harness);

    // (1) deterministic path produces a pi-compatible compaction object.
    const d = out.deterministic;
    assert.ok(d?.compaction, "handler must return { compaction }");
    assert.equal(d.compaction.firstKeptEntryId, "entry-42");
    assert.equal(d.compaction.tokensBefore, 264167);
    assert.equal(d.compaction.details.mode, "deterministic");
    const summary = d.compaction.summary;
    assert.match(summary, /^## Goal/m);
    assert.match(summary, /Build the reporting feature/);
    assert.match(summary, /## Recent Messages/);
    assert.match(summary, /## Files/);
    assert.match(summary, /- read: Sources\/a\.ts, Sources\/b\.ts/);
    assert.match(summary, /- written: Sources\/c\.ts/);
    assert.match(summary, /## Previous Summary/);
    assert.match(summary, /Fix the flaky test\./);
    assert.match(summary, /pipiui-compaction deterministic reason=threshold messages=3 tokensBefore=264167/);

    // (2) no env flag + no model: deterministic result, no provider dependency.
    assert.ok(out.noModel?.compaction, "handler must not require a model/LLM");
    assert.equal(out.noModel.compaction.details.mode, "deterministic");
    assert.equal(out.noModel.compaction.details.reason, "overflow");

    // (3) bounded serialization caps total size and keeps head+tail.
    assert.equal(out.bounded.truncated, true, "serialized text must be capped");
    assert.equal(out.bounded.hasMarker, true, "truncation marker must be present");
    assert.equal(out.bounded.hasHead, true, "head window must start at the conversation");
    assert.equal(out.bounded.hasTail, true, "tail window must keep the recent end");
    assert.match(out.bounded.deterministic, /## Goal/);
    assert.match(out.bounded.deterministic, /## Recent Messages/);

    // (4) garbage input never throws out of the hook: falls back safely.
    assert.ok(out.garbage?.compaction, "garbage messages must still produce a compaction result");
    assert.match(out.garbage.compaction.summary, /## Goal/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("RPC E2E: real pi compact uses the pipiui hook and writes a pi-compatible entry", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-compaction-e2e-"));
  try {
    await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
    await linkRuntimePackages(directory);
    const out = await runCompactE2E(directory);
    if (out.skipped) {
      t.skip(out.skipped);
      return;
    }
    assert.equal(out.success, true, `compact must succeed, error=${out.error}`);
    assert.ok(out.elapsedMs < 10_000, `compaction must be bounded, took ${out.elapsedMs}ms`);
    assert.equal(out.summaryHasGoal, true, "hook summary must be structured");
    assert.equal(out.details?.source, "pipiui");
    assert.equal(out.details?.mode, "deterministic");
    assert.equal(out.entryCount, 1, "session file must contain the compaction entry");
    assert.equal(out.entryDetails?.mode, "deterministic");
    const startEvent = out.events.find((e) => e.type === "compaction_start");
    const endEvent = out.events.find((e) => e.type === "compaction_end");
    assert.ok(startEvent, "compaction_start event must be emitted");
    assert.ok(endEvent, "compaction_end event must be emitted");
    assert.equal(endEvent.aborted, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * LLM fast-path harness: imports main-compaction.ts directly (symlinked pi
 * packages) and drives handleSessionBeforeCompact with an injected fake
 * completion — no network, no subagent spawn. Asserts the production options
 * (reasoning off, composed AbortSignal, budget) via the spy and reports JSON.
 */
async function prepareLlmHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const harness = join(directory, "llm-harness.mjs");
  await writeFile(
    harness,
    `import { writeFileSync } from "node:fs";

const outputPath = ${JSON.stringify(join(directory, "llm-result.json"))};

const { handleSessionBeforeCompact, buildDeterministicSummary } = await import(
  "./subagent/main-compaction.ts"
);

const results = {};

const basePrep = {
  firstKeptEntryId: "entry-llm",
  tokensBefore: 1000,
  previousSummary: "## Goal\\nPrevious goal.",
  fileOps: { read: new Set(["a.ts"]) },
  messagesToSummarize: [
    { role: "user", content: [{ type: "text", text: "Implement the reporting feature." }] },
  ],
  turnPrefixMessages: [],
};
const mkEvent = (overrides = {}) => ({
  reason: "threshold",
  willRetry: false,
  signal: undefined,
  preparation: basePrep,
  ...overrides,
});

// 1) valid LLM response → llm-fast compaction; production fast-path options asserted.
let call = null;
const fakeComplete = async (model, context, options) => {
  call = { model, context, options };
  return {
    content: [{ type: "text", text: "## Goal\\nReporting feature.\\n## Next Steps\\nShip it." }],
    usage: { input: 10, output: 20 },
  };
};
const eventSignal = new AbortController().signal;
const ctxFull = {
  model: {
    provider: "test",
    id: "model-1",
    reasoning: true,
    thinkingLevelMap: { off: "none", high: "high" },
    contextWindow: 128000,
  },
  modelRegistry: {
    getApiKeyAndHeaders: async () => ({
      ok: true,
      apiKey: "key-1",
      headers: { "x-test": "1" },
      env: { E: "1" },
    }),
    find: () => undefined,
  },
};
const r1 = await handleSessionBeforeCompact(mkEvent({ signal: eventSignal }), ctxFull, {
  complete: fakeComplete,
  llmDisabled: false,
});
results.llmFast = {
  mode: r1?.compaction?.details?.mode ?? null,
  summary: r1?.compaction?.summary ?? null,
  firstKeptEntryId: r1?.compaction?.firstKeptEntryId ?? null,
  tokensBefore: r1?.compaction?.tokensBefore ?? null,
  usage: r1?.compaction?.usage ?? null,
  reasoning: call?.options?.reasoning ?? null,
  maxTokens: call?.options?.maxTokens ?? null,
  signalIsAbortSignal: call?.options?.signal instanceof AbortSignal,
  signalNotParent: call?.options?.signal !== eventSignal,
  signalAbortedAtCall: Boolean(call?.options?.signal?.aborted),
  apiKey: call?.options?.apiKey ?? null,
  headers: call?.options?.headers ?? null,
  env: call?.options?.env ?? null,
  promptHasConversation: String(
    call?.context?.messages?.[0]?.content?.[0]?.text ?? "",
  ).includes("<conversation"),
  promptHasReason: String(
    call?.context?.messages?.[0]?.content?.[0]?.text ?? "",
  ).includes('trigger="threshold"'),
};

// 2) parent (RPC) abort propagates into the composed signal; late response discarded.
const parent = new AbortController();
let lateOptions = null;
const deferred = {};
deferred.promise = new Promise((resolve) => {
  deferred.resolve = resolve;
});
const slowComplete = async (model, context, options) => {
  lateOptions = options;
  return deferred.promise;
};
const pending = handleSessionBeforeCompact(mkEvent({ signal: parent.signal }), ctxFull, {
  complete: slowComplete,
  llmDisabled: false,
});
parent.abort();
deferred.resolve({ content: [{ type: "text", text: "LATE RESPONSE" }] });
const r2 = await pending;
results.parentAbort = {
  composedSignalAborted: Boolean(lateOptions?.signal?.aborted),
  handlerResult: r2 === undefined ? "undefined" : (r2.compaction?.details?.mode ?? "compaction"),
};

// 3) wall-clock timeout: a provider that ignores abort must not win after the cap.
let timedOptions = null;
const ignoringComplete = async (model, context, options) => {
  timedOptions = options;
  await new Promise((resolve) => setTimeout(resolve, 150)); // resolves after the 50ms cap
  return { content: [{ type: "text", text: "TOO LATE" }] };
};
const t0 = Date.now();
const r3 = await handleSessionBeforeCompact(mkEvent(), ctxFull, {
  complete: ignoringComplete,
  timeoutMs: 50,
  llmDisabled: false,
});
results.timeout = {
  elapsedMs: Date.now() - t0,
  composedSignalAborted: Boolean(timedOptions?.signal?.aborted),
  mode: r3?.compaction?.details?.mode ?? null,
  notTooLate: !String(r3?.compaction?.summary ?? "").includes("TOO LATE"),
  summaryHasGoal: String(r3?.compaction?.summary ?? "").includes("## Goal"),
};

// 4) pure-reasoning model (thinkingLevelMap.off === null): LLM path skipped
//    before any auth resolution or completion call.
let authCalls = 0;
let completeCalls = 0;
const t1 = Date.now();
const r4 = await handleSessionBeforeCompact(
  mkEvent(),
  {
    model: {
      provider: "reasoning",
      id: "r1",
      reasoning: true,
      thinkingLevelMap: { off: null, high: "high" },
      contextWindow: 1000000,
    },
    modelRegistry: {
      getApiKeyAndHeaders: async () => {
        authCalls += 1;
        return { ok: true, apiKey: "k" };
      },
    },
  },
  {
    llmDisabled: false,
    complete: async () => {
      completeCalls += 1;
      return { content: [{ type: "text", text: "NOPE" }] };
    },
  },
);
results.noOffSupport = {
  mode: r4?.compaction?.details?.mode ?? null,
  authCalls,
  completeCalls,
  elapsedMs: Date.now() - t1,
};

// 5) contextWindow scaling: a 32k-token model gets a ~64k prompt, not the fixed 200k.
let scaledPrompt = "";
const scaledComplete = async (model, context, options) => {
  scaledPrompt = String(context?.messages?.[0]?.content?.[0]?.text ?? "");
  return { content: [{ type: "text", text: "## Goal\\nScaled." }] };
};
const r5 = await handleSessionBeforeCompact(
  mkEvent({
    preparation: {
      ...basePrep,
      messagesToSummarize: [
        { role: "user", content: [{ type: "text", text: "y".repeat(300_000) }] },
      ],
    },
  }),
  {
    model: {
      provider: "test",
      id: "small",
      reasoning: true,
      thinkingLevelMap: { off: "none" },
      contextWindow: 32000,
    },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
    },
  },
  { complete: scaledComplete, llmDisabled: false },
);
results.scaled = {
  mode: r5?.compaction?.details?.mode ?? null,
  promptLen: scaledPrompt.length,
  hasMarker: scaledPrompt.includes("已截断"),
  under70k: scaledPrompt.length < 70_000,
};

// 6) malformed fileOps / previousSummary never throw (deterministic self-protection).
const garbageSummary = buildDeterministicSummary({
  serialized: "[User]: Goal from serialized",
  previousSummary: 42,
  fileOps: { read: {}, written: 7, edited: "single.ts" },
  tokensBefore: 5,
  messageCount: 1,
  reason: "test",
});
results.garbageFileOps = {
  hasGoal: garbageSummary.includes("## Goal"),
  hasFiles: garbageSummary.includes("## Files"),
  mentionsEdited: garbageSummary.includes("- edited: single.ts"),
  noNumberGarbage: !garbageSummary.includes("written: 7"),
};

// 7) malformed message lists (non-arrays) must not throw → deterministic result,
//    never the pi built-in fallback (undefined).
const r7 = await handleSessionBeforeCompact(
  {
    reason: "threshold",
    willRetry: false,
    signal: undefined,
    preparation: {
      firstKeptEntryId: "entry-g",
      tokensBefore: 1,
      messagesToSummarize: {},
      turnPrefixMessages: 42,
      fileOps: { read: { bogus: true } },
    },
  },
  { model: undefined, modelRegistry: undefined },
  { llmDisabled: true },
);
results.malformedMessages = {
  ok: Boolean(r7?.compaction),
  mode: r7?.compaction?.details?.mode ?? null,
  messageCount: r7?.compaction?.details?.messageCount ?? null,
  summaryHasGoal: String(r7?.compaction?.summary ?? "").includes("## Goal"),
  filesNoBogus: !String(r7?.compaction?.summary ?? "").includes("bogus"),
};

writeFileSync(outputPath, JSON.stringify(results));
process.exit(0);
`,
    "utf8",
  );
  return harness;
}

test("LLM fast path: reasoning off, composed AbortSignal, timeout cap, thinking-off gate, scaled budget, malformed-input safety", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-compaction-llm-"));
  try {
    const harness = await prepareLlmHarness(directory);
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: { ...process.env, PIPIUI_AGENT_DEPTH: "0" },
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const { readFile } = await import("node:fs/promises");
    const out = JSON.parse(await readFile(join(directory, "llm-result.json"), "utf8"));

    // (1) production fast-path options + valid response → pi-compatible compaction.
    assert.equal(out.llmFast.mode, "llm-fast");
    assert.match(out.llmFast.summary, /## Goal/);
    assert.equal(out.llmFast.firstKeptEntryId, "entry-llm");
    assert.equal(out.llmFast.tokensBefore, 1000);
    assert.deepEqual(out.llmFast.usage, { input: 10, output: 20 });
    assert.equal(out.llmFast.reasoning, "off");
    assert.equal(out.llmFast.maxTokens, 4096);
    assert.equal(out.llmFast.signalIsAbortSignal, true);
    assert.equal(
      out.llmFast.signalNotParent,
      true,
      "must be the composed signal, not the raw event signal",
    );
    assert.equal(out.llmFast.signalAbortedAtCall, false);
    assert.equal(out.llmFast.apiKey, "key-1");
    assert.deepEqual(out.llmFast.headers, { "x-test": "1" });
    assert.deepEqual(out.llmFast.env, { E: "1" });
    assert.equal(out.llmFast.promptHasConversation, true);
    assert.equal(out.llmFast.promptHasReason, true);

    // (2) parent (RPC) abort propagates into the composed signal; response discarded.
    assert.equal(out.parentAbort.composedSignalAborted, true);
    assert.equal(out.parentAbort.handlerResult, "undefined");

    // (3) wall-clock cap is a hard bound even for signal-ignoring providers.
    assert.ok(out.timeout.elapsedMs < 2000, `took ${out.timeout.elapsedMs}ms`);
    assert.equal(out.timeout.composedSignalAborted, true);
    assert.equal(out.timeout.mode, "deterministic");
    assert.equal(out.timeout.notTooLate, true);
    assert.equal(out.timeout.summaryHasGoal, true);

    // (4) pure-reasoning model: LLM path skipped before auth/network.
    assert.equal(out.noOffSupport.mode, "deterministic");
    assert.equal(out.noOffSupport.authCalls, 0);
    assert.equal(out.noOffSupport.completeCalls, 0);
    assert.ok(out.noOffSupport.elapsedMs < 2000, `took ${out.noOffSupport.elapsedMs}ms`);

    // (5) context-window scaling bounds the prompt for small-window models.
    assert.equal(out.scaled.mode, "llm-fast");
    assert.equal(out.scaled.under70k, true, `prompt was ${out.scaled.promptLen} chars`);
    assert.equal(out.scaled.hasMarker, true);

    // (6) malformed fileOps / previousSummary never throw.
    assert.equal(out.garbageFileOps.hasGoal, true);
    assert.equal(out.garbageFileOps.hasFiles, true);
    assert.equal(out.garbageFileOps.mentionsEdited, true);
    assert.equal(out.garbageFileOps.noNumberGarbage, true);

    // (7) malformed message lists never throw → deterministic (not pi built-in).
    assert.equal(out.malformedMessages.ok, true);
    assert.equal(out.malformedMessages.mode, "deterministic");
    assert.equal(out.malformedMessages.messageCount, 0);
    assert.equal(out.malformedMessages.summaryHasGoal, true);
    assert.equal(out.malformedMessages.filesNoBogus, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

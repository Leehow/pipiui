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

async function prepareHarness(directory) {
  const runtime = join(directory, "runtime");
  const agents = join(directory, "agents");
  const repository = join(directory, "repo");
  const modelsFile = join(directory, "subagent-models.json");
  const capabilitiesFile = join(directory, "subagent-model-capabilities.json");
  const captureFile = join(directory, "captures.jsonl");
  await cp(sourceSubagentDirectory, join(runtime, "subagent"), { recursive: true });
  await linkRuntimePackages(runtime);
  await mkdir(agents, { recursive: true });
  await mkdir(repository, { recursive: true });

  // Keep fallback behavior external and fast: only the copied runtime is accelerated.
  const indexPath = join(runtime, "subagent/index.ts");
  let index = await readFile(indexPath, "utf8");
  const productionBackoff = "const AUTO_RESUME_BACKOFF_MS = [5_000, 15_000] as const;";
  assert.ok(index.includes(productionBackoff), "fixture must accelerate the real fallback loop");
  index = index.replace(productionBackoff, "const AUTO_RESUME_BACKOFF_MS = [1, 1] as const;");
  await writeFile(indexPath, index, "utf8");

  for (const name of ["chain", "allowed", "object", "legacy"]) {
    await writeFile(
      join(agents, `${name}.md`),
      `---\nname: ${name}\ndescription: Thinking routing probe\nread-only: true\ntools: read\n---\nReturn the probe result.\n`,
      "utf8",
    );
  }

  await writeFile(
    modelsFile,
    JSON.stringify({
      chain: {
        models: [
          { model: "test/primary", thinking: "low" },
          { model: "test/known-fallback", thinking: "low" },
          { model: "test/unknown-fallback", thinking: "medium" },
        ],
      },
      allowed: {
        models: [
          { model: "test/allowed-primary", thinking: "low" },
          { model: "test/allowed-fallback", thinking: "low" },
        ],
      },
      object: { model: "test/object", thinking: "low" },
      legacy: "test/legacy",
    }),
    "utf8",
  );
  // Compact shape is Swift's wire contract: `r` absent means capability unknown even
  // when it carries UI baseline `l` values. Node may not carry Boss thinking into that fallback.
  await writeFile(
    capabilitiesFile,
    JSON.stringify({
      v: 1,
      m: {
        "test/primary": { r: true, l: ["", "low", "high"] },
        "test/known-fallback": { r: true, l: ["", "low"] },
        "test/unknown-fallback": { l: ["", "high"] },
        "test/allowed-primary": { r: true, l: ["", "low", "high"] },
        "test/allowed-fallback": { r: true, l: ["", "low", "high"] },
        "test/object": { r: true, l: ["", "off", "low", "high"] },
      },
    }),
    "utf8",
  );
  await writeFile(captureFile, "", "utf8");

  const harness = join(runtime, "harness.mjs");
  await writeFile(
    harness,
    `import fs from "node:fs";

const captureFile = process.env.PIPIUI_CAPTURE_FILE;
if (process.argv.includes("--mode")) {
  const args = process.argv.slice(2);
  const task = args.find((arg) => arg.startsWith("Task: "))?.slice("Task: ".length) ?? "";
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const model = option("--model");
  const thinking = option("--thinking");
  fs.appendFileSync(captureFile, JSON.stringify({ task, model, thinking, args }) + "\\n");
  if (
    (task === "fallback-route" && (model === "test/primary" || model === "test/known-fallback")) ||
    (task === "allowed-fallback-route" && model === "test/allowed-primary")
  ) {
    process.stdout.write(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "quota" }],
        stopReason: "error",
        errorMessage: "insufficient_quota",
      },
    }) + "\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok:" + task }],
      stopReason: "end",
    },
  }) + "\\n");
  process.exit(0);
}

const handlers = new Map();
const tools = new Map();
const { default: install } = await import("./subagent/index.ts");
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on(name, handler) {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
  },
  async sendUserMessage() {},
});
const subagent = tools.get("subagent");
const ctx = { cwd: process.env.PIPIUI_MAIN_CWD, hasUI: false };
const options = [new AbortController().signal, undefined, ctx];
const results = {};
// The production retry/fallback wait intentionally unrefs its timer. Keep this headless
// harness alive long enough for the real fallback loop to resume the next candidate.
const keepAlive = setInterval(() => {}, 60_000);
try {
results.fallback = await subagent.execute(
  "thinking-fallback",
  { agent: "chain", task: "fallback-route", thinking: "high", background: false },
  ...options,
);
results.allowedFallback = await subagent.execute(
  "thinking-allowed-fallback",
  { agent: "allowed", task: "allowed-fallback-route", thinking: "high", background: false },
  ...options,
);
results.parallel = await subagent.execute(
  "thinking-parallel",
  { tasks: [{ agent: "object", task: "parallel-route", thinking: "high" }], background: false },
  ...options,
);
results.chain = await subagent.execute(
  "thinking-chain",
  { chain: [{ agent: "object", task: "chain-route", thinking: "off" }] },
  ...options,
);
results.objectDefault = await subagent.execute(
  "thinking-object-default",
  { agent: "object", task: "object-default-route", background: false },
  ...options,
);
results.legacy = await subagent.execute(
  "thinking-legacy",
  { agent: "legacy", task: "legacy-route", background: false },
  ...options,
);
} finally {
  clearInterval(keepAlive);
}
let systemPrompt = "base";
for (const handler of handlers.get("before_agent_start") ?? []) {
  const update = handler({ systemPrompt });
  if (update?.systemPrompt) systemPrompt = update.systemPrompt;
}
const params = subagent.parameters;
process.stdout.write(JSON.stringify({
  results,
  systemPrompt,
  schema: {
    rootHasModel: Object.hasOwn(params.properties, "model"),
    rootThinking: params.properties.thinking !== undefined,
    taskHasModel: Object.hasOwn(params.properties.tasks.items.properties, "model"),
    taskThinking: params.properties.tasks.items.properties.thinking !== undefined,
    chainHasModel: Object.hasOwn(params.properties.chain.items.properties, "model"),
    chainThinking: params.properties.chain.items.properties.thinking !== undefined,
  },
}));
`,
    "utf8",
  );
  return { runtime, repository, agents, modelsFile, capabilitiesFile, captureFile, harness };
}

async function runHarness(directory, fixture) {
  const options = {
    cwd: fixture.repository,
    env: {
      ...process.env,
      HOME: join(directory, "home"),
      PIPIUI_AGENT_DEPTH: "0",
      PIPIUI_AGENT_MAX_DEPTH: "2",
      PIPIUI_MAIN_CWD: fixture.repository,
      PIPIUI_AGENTS_DIR: fixture.agents,
      PIPIUI_SUBAGENT_MODELS_FILE: fixture.modelsFile,
      PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE: fixture.capabilitiesFile,
      PIPIUI_CAPTURE_FILE: fixture.captureFile,
      PIPIUI_WORKTREE: "0",
      PIPIUI_BRIDGE_PORT: "",
      PIPIUI_SESSION_KEY: "",
      PIPIUI_SUBAGENT_EXT: "",
      PIPIUI_SEARCH_SCOPE_EXT: "",
      PIPIUI_COMPUTER_EXT: "",
      PIPIUI_COMPUTER_CAPABILITY: "",
    },
    timeout: 20_000,
    maxBuffer: 5 * 1024 * 1024,
  };
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", fixture.harness],
      options,
    ));
  } catch (error) {
    const captures = await readFile(fixture.captureFile, "utf8").catch(() => "(capture unreadable)");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
      `stdout=${String(error?.stdout ?? "")}\n` +
      `stderr=${String(error?.stderr ?? "")}\n` +
      `captures=${captures}`,
    );
  }
  const captures = (await readFile(fixture.captureFile, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { output: JSON.parse(stdout), captures };
}

function capturesFor(records, task) {
  return records.filter((record) => record.task === task);
}

function captured(records, task) {
  const matches = capturesFor(records, task);
  assert.equal(matches.length, 1, `expected exactly one ${task} child: ${JSON.stringify(matches)}`);
  return matches[0];
}

test("task thinking routes through single/parallel/chain and fallback respects Swift catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-thinking-routing-"));
  try {
    const fixture = await prepareHarness(directory);
    const { output, captures } = await runHarness(directory, fixture);

    assert.equal(output.results.fallback.isError, undefined, "third fallback should complete");
    assert.equal(output.results.allowedFallback.isError, undefined);
    assert.equal(output.results.parallel.isError, undefined);
    assert.equal(output.results.chain.isError, undefined);
    assert.equal(output.results.objectDefault.isError, undefined);
    assert.equal(output.results.legacy.isError, undefined);

    // Initial candidate: task level wins over its entry's configured low.
    assert.deepEqual(
      capturesFor(captures, "fallback-route").map(({ model, thinking }) => ({ model, thinking })),
      [
        { model: "test/primary", thinking: "high" },
        // known fallback cannot accept requested high -> its own configured low
        { model: "test/known-fallback", thinking: "low" },
        // unknown fallback also cannot inherit requested high -> its own configured medium
        { model: "test/unknown-fallback", thinking: "medium" },
      ],
    );

    // A known fallback that explicitly allows high preserves the Boss-selected level.
    assert.deepEqual(
      capturesFor(captures, "allowed-fallback-route").map(({ model, thinking }) => ({ model, thinking })),
      [
        { model: "test/allowed-primary", thinking: "high" },
        { model: "test/allowed-fallback", thinking: "high" },
      ],
    );

    // Per-task schema plumbing reaches both parallel and chain task shapes.
    assert.deepEqual(
      { model: captured(captures, "parallel-route").model, thinking: captured(captures, "parallel-route").thinking },
      { model: "test/object", thinking: "high" },
    );
    assert.deepEqual(
      { model: captured(captures, "chain-route").model, thinking: captured(captures, "chain-route").thinking },
      { model: "test/object", thinking: "off" },
    );
    assert.deepEqual(
      { model: captured(captures, "object-default-route").model, thinking: captured(captures, "object-default-route").thinking },
      { model: "test/object", thinking: "low" },
    );
    assert.deepEqual(
      { model: captured(captures, "legacy-route").model, thinking: captured(captures, "legacy-route").thinking },
      { model: "test/legacy", thinking: undefined },
      "legacy string stays model-only and omits --thinking",
    );

    // v1 exposes thinking but deliberately no per-task model knob in any task shape.
    assert.deepEqual(output.schema, {
      rootHasModel: false,
      rootThinking: true,
      taskHasModel: false,
      taskThinking: true,
      chainHasModel: false,
      chainThinking: true,
    });

    // Boss sees the current configuration, configured intensity, Swift-derived levels, and
    // unknown-capability marker before it decides whether to dispatch.
    assert.match(output.systemPrompt, /\[Subagent model routing — hot-read\]/);
    assert.match(output.systemPrompt, /Never inherit Boss thinking\./);
    assert.match(output.systemPrompt, /chain: test\/primary\{set=low;allow=default\|low\|high\}/);
    assert.match(output.systemPrompt, /test\/known-fallback\{set=low;allow=default\|low\}/);
    assert.match(output.systemPrompt, /test\/unknown-fallback\{set=medium;allow=default\|high\?\}/);
    assert.match(output.systemPrompt, /object: test\/object\{set=low;allow=default\|off\|low\|high\}/);
    assert.match(output.systemPrompt, /legacy: test\/legacy\{set=default;allow=\?\}/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

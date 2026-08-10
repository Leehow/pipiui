import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PIPIUI_EXTENSION_ONLY_TOOL_NAMES,
  resolvePipiUIExtensionRouting,
  resolveSubagentToolSelection,
  selectPipiUIExtensionRoutes,
} from "../../Sources/PipiUI/PiExt/subagent/desktop-tool-policy.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const sourceAgentsDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/agents");
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

const SPECIALIST = new Set([
  "web_search",
  "fetch_content",
  "source_check",
  "get_search_content",
  "arxiv_fetch",
]);
const EXTENSIONS = Object.freeze({
  web: "/fixture/web-access.ts",
  arxiv: "/fixture/packages/arxiv-fetch",
});

function declaredTools(source) {
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith("tools:"));
  assert.ok(line, "agent frontmatter must declare tools");
  return line.slice("tools:".length).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function specialistTools(names) {
  return new Set(names.filter((name) => SPECIALIST.has(name)));
}

function selectedTools(agentTools, routing) {
  return resolveSubagentToolSelection({
    declaredTools: agentTools,
    disabledTools: [],
    hasDesktopCapability: false,
    allowRecursiveDelegation: false,
    availableExtensionTools: routing.extensionOnlyTools,
  });
}

function routePaths(routing, selection) {
  return selectPipiUIExtensionRoutes(routing, selection).map((route) => route.path);
}

function fixtureRouting(overrides = {}) {
  return resolvePipiUIExtensionRouting({
    webAccessExtension: EXTENSIONS.web,
    arxivExtension: EXTENSIONS.arxiv,
    ...overrides,
  });
}

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

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

async function prepareRuntimeHarness(directory) {
  const runtime = join(directory, "runtime");
  const agents = join(directory, "agents");
  const repository = join(directory, "repo");
  const capture = join(directory, "child-spawns.jsonl");
  await cp(sourceSubagentDirectory, join(runtime, "subagent"), { recursive: true });
  await cp(sourceAgentsDirectory, agents, { recursive: true });
  await linkRuntimePackages(runtime);

  await mkdir(repository, { recursive: true });
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await git(repository, ["init", "-q"]);
  await git(repository, ["config", "user.email", "fixture@example.invalid"]);
  await git(repository, ["config", "user.name", "PipiUI Fixture"]);
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-qm", "fixture"]);

  const harness = join(runtime, "harness.mjs");
  await writeFile(
    harness,
    `import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.argv.includes("--mode")) {
  const keep = [
    "PIPIUI_WEB_ACCESS_EXT",
    "PIPIUI_ARXIV_EXT",
  ];
  const env = Object.fromEntries(keep.map((key) => [key, process.env[key] ?? null]));
  fs.appendFileSync(process.env.PIPIUI_CAPTURE_FILE, JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    env,
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "captured" }],
      stopReason: "end",
    },
  }) + "\\n");
  process.exit(0);
}

const { default: install } = await import("./subagent/index.ts");
const tools = new Map();
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
  async sendUserMessage() {},
});
const subagent = tools.get("subagent");
const root = process.env.PIPIUI_MAIN_CWD;
const results = {};

async function dispatch(label, agent, agentId, worktree, extra = {}) {
  process.env.PIPIUI_WORKTREE = worktree;
  const result = await subagent.execute(
    "routing-" + label,
    {
      agent,
      agentId,
      task: "capture:" + label,
      background: false,
      ...extra,
    },
    new AbortController().signal,
    undefined,
    { cwd: root, hasUI: false },
  );
  const one = result?.details?.results?.[0];
  results[label] = { resumed: one?.resumed === true, exitCode: one?.exitCode };
}

if (process.env.PIPIUI_ROUTING_PROBE === "1") {
  await dispatch("probe-explore", "explore", "probe-ex", "0");
  await dispatch("probe-general", "general-purpose", "probe-gp", "0");
} else {
  await dispatch("explore-readonly-explicit", "explore", "ex-role", "1", { cwd: root });
  await dispatch("general-worktree", "general-purpose", "gp-tree", "1");
  await dispatch("general-direct", "general-purpose", "gp-direct", "0");
  await mkdir(path.join(root, ".pi", "agent-sessions"), { recursive: true });
  await writeFile(path.join(root, ".pi", "agent-sessions", "seed_pipiui-gp-resume.jsonl"), "{}\\n", "utf8");
  await dispatch("general-resume-explicit", "general-purpose", "gp-resume", "1", { cwd: root });
  await dispatch("plan", "plan", "plan-role", "0");
  await dispatch("reviewer", "reviewer", "review-role", "0");
  await dispatch("operator", "operator", "operator-role", "0");
  await dispatch("secretary", "secretary", "secretary-role", "1");
  await dispatch("long-test", "long-test", "long-role", "0");
}
process.stdout.write(JSON.stringify({ results }));
`,
    "utf8",
  );
  return { agents, repository, capture, harness };
}

async function runRuntimeHarness(directory, fixture, { specialistEnv = {}, probe = false } = {}) {
  await writeFile(fixture.capture, "", "utf8");
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", fixture.harness],
    {
      cwd: fixture.repository,
      env: {
        ...process.env,
        HOME: join(directory, "home"),
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: fixture.repository,
        PIPIUI_AGENTS_DIR: fixture.agents,
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_SUBAGENT_EXT: "",
        PIPIUI_SEARCH_SCOPE_EXT: "",
        PIPIUI_COMPUTER_EXT: "",
        PIPIUI_COMPUTER_CAPABILITY: "",
        PIPIUI_WEB_ACCESS_EXT: EXTENSIONS.web,
        PIPIUI_ARXIV_EXT: EXTENSIONS.arxiv,
        PIPIUI_ROUTING_PROBE: probe ? "1" : "",
        PIPIUI_CAPTURE_FILE: fixture.capture,
        ...specialistEnv,
      },
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  const captures = (await readFile(fixture.capture, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { summary: JSON.parse(stdout), captures };
}

function captureLabel(record) {
  const task = record.args.find((arg) => arg.startsWith("Task: capture:"));
  assert.ok(task, `missing capture task in ${JSON.stringify(record.args)}`);
  return task.slice("Task: ".length);
}

function captureMap(records) {
  return new Map(records.map((record) => [captureLabel(record), record]));
}

function toolAllowlist(record) {
  const index = record.args.indexOf("--tools");
  assert.ok(index >= 0, `expected --tools: ${JSON.stringify(record.args)}`);
  return new Set(record.args[index + 1].split(",").filter(Boolean));
}

function extensionPaths(record) {
  const paths = [];
  for (let i = 0; i < record.args.length; i += 1) {
    if (record.args[i] === "-e") paths.push(record.args[i + 1]);
  }
  return paths.filter((entry) => Object.values(EXTENSIONS).includes(entry));
}

test("policy resolves the role matrix and only names mounted PipiUI specialist tools", async () => {
  assert.deepEqual(PIPIUI_EXTENSION_ONLY_TOOL_NAMES, [
    "fetch_content",
    "source_check",
    "get_search_content",
    "arxiv_fetch",
  ]);
  const assembly = await readFile(
    join(repositoryRoot, "Sources/PipiUI/PipiSpawnAssembly.swift"),
    "utf8",
  );
  assert.match(assembly, /if f\.isEnabled\(\.arxivFetch\), let p = input\.paths\.arxivFetchPackage/);
  assert.doesNotMatch(assembly, /PIPIUI_PDF/);

  const sources = await Promise.all(
    ["explore", "general-purpose", "plan", "reviewer", "operator", "secretary", "long-test"].map(
      async (name) => [name, declaredTools(await readFile(join(sourceAgentsDirectory, name, "AGENT.md"), "utf8"))],
    ),
  );
  const agents = new Map(sources);
  const all = fixtureRouting();
  assert.deepEqual(all.extensionOnlyTools, ["fetch_content", "source_check", "get_search_content", "arxiv_fetch"]);
  assert.deepEqual(all.routes.map((route) => route.path), [
    EXTENSIONS.web,
    EXTENSIONS.arxiv,
  ]);

  const expected = new Map([
    ["explore", new Set(["web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
    ["general-purpose", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
    ["plan", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
    ["reviewer", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
    ["operator", new Set()],
    ["secretary", new Set()],
    ["long-test", new Set()],
  ]);
  for (const [name, agentTools] of agents) {
    const selection = selectedTools(agentTools, all);
    assert.equal(selection.flag, "--tools", `${name} must use a concrete allowlist`);
    assert.deepEqual(specialistTools(selection.names), expected.get(name), `${name} specialist allowlist`);
  }

  const cases = [
    {
      name: "web only",
      options: { arxivExtension: "" },
      paths: [EXTENSIONS.web],
      extensionOnly: ["fetch_content", "source_check", "get_search_content"],
    },
    {
      name: "arxiv only",
      options: { webAccessExtension: "" },
      paths: [EXTENSIONS.arxiv],
      extensionOnly: ["arxiv_fetch"],
    },
    {
      name: "all off",
      options: { webAccessExtension: "", arxivExtension: "" },
      paths: [],
      extensionOnly: [],
    },
  ];
  for (const scenario of cases) {
    const routing = fixtureRouting(scenario.options);
    assert.deepEqual(routing.extensionOnlyTools, scenario.extensionOnly, scenario.name);
    const explore = selectedTools(agents.get("explore"), routing);
    const general = selectedTools(agents.get("general-purpose"), routing);
    assert.deepEqual(routePaths(routing, explore), scenario.paths, `${scenario.name}: explore -e routes`);
    assert.deepEqual(routePaths(routing, general), scenario.paths, `${scenario.name}: general -e routes`);
    for (const name of PIPIUI_EXTENSION_ONLY_TOOL_NAMES) {
      assert.equal(explore.names.includes(name), scenario.extensionOnly.includes(name), `${scenario.name}: explore ${name}`);
      assert.equal(general.names.includes(name), scenario.extensionOnly.includes(name), `${scenario.name}: general ${name}`);
    }
    // web_search is intentionally not feature-coupled: a provider-native search tool can remain.
    assert.equal(explore.names.includes("web_search"), true, `${scenario.name}: preserve native web_search`);
    assert.equal(general.names.includes("web_search"), false, `${scenario.name}: never widen general search`);
  }
});

test("worker spawn -e paths and --tools stay consistent for every exported route gate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-specialist-gates-"));
  try {
    const fixture = await prepareRuntimeHarness(directory);
    const allOff = {
      PIPIUI_WEB_ACCESS_EXT: "",
      PIPIUI_ARXIV_EXT: "",
    };
    const webTools = ["fetch_content", "source_check", "get_search_content"];
    const cases = [
      { name: "all enabled", env: {}, paths: [EXTENSIONS.web, EXTENSIONS.arxiv], tools: [...webTools, "arxiv_fetch"] },
      { name: "web only", env: { ...allOff, PIPIUI_WEB_ACCESS_EXT: EXTENSIONS.web }, paths: [EXTENSIONS.web], tools: webTools },
      { name: "arxiv only", env: { ...allOff, PIPIUI_ARXIV_EXT: EXTENSIONS.arxiv }, paths: [EXTENSIONS.arxiv], tools: ["arxiv_fetch"] },
      { name: "all disabled", env: allOff, paths: [], tools: [] },
    ];

    for (const scenario of cases) {
      const { captures } = await runRuntimeHarness(directory, fixture, {
        specialistEnv: scenario.env,
        probe: true,
      });
      const byLabel = captureMap(captures);
      assert.equal(byLabel.size, 2, `${scenario.name}: expected explore + general probe spawns`);
      for (const [label, expected] of [
        ["capture:probe-explore", new Set(["web_search", ...scenario.tools])],
        ["capture:probe-general", new Set(scenario.tools)],
      ]) {
        const record = byLabel.get(label);
        assert.ok(record, `${scenario.name}: missing ${label}`);
        assert.deepEqual(specialistTools([...toolAllowlist(record)]), expected, `${scenario.name}: ${label} --tools`);
        assert.deepEqual(new Set(extensionPaths(record)), new Set(scenario.paths), `${scenario.name}: ${label} -e`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual worker spawns keep specialist routes across read-only, worktree, direct, resume, and explicit cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-specialist-routing-"));
  try {
    const fixture = await prepareRuntimeHarness(directory);
    const { summary, captures } = await runRuntimeHarness(directory, fixture);
    const byLabel = captureMap(captures);
    const routeSet = new Set([EXTENSIONS.web, EXTENSIONS.arxiv]);
    const expectedByLabel = new Map([
      ["capture:explore-readonly-explicit", new Set(["web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:general-worktree", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:general-direct", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:general-resume-explicit", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:plan", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:reviewer", new Set(["fetch_content", "source_check", "get_search_content", "arxiv_fetch"])],
      ["capture:operator", new Set()],
      ["capture:secretary", new Set()],
      ["capture:long-test", new Set()],
    ]);

    assert.equal(byLabel.size, expectedByLabel.size, "one child spawn per role/continuity variant");
    for (const [label, expected] of expectedByLabel) {
      const record = byLabel.get(label);
      assert.ok(record, `missing child capture for ${label}`);
      const tools = toolAllowlist(record);
      assert.deepEqual(specialistTools([...tools]), expected, `${label}: --tools matrix`);
      const paths = extensionPaths(record);
      assert.deepEqual(new Set(paths), expected.size === 0 ? new Set() : routeSet, `${label}: -e matches allowlist`);
      assert.equal(record.env.PIPIUI_WEB_ACCESS_EXT, EXTENSIONS.web, `${label}: inherit web env`);
      assert.equal(record.env.PIPIUI_ARXIV_EXT, EXTENSIONS.arxiv, `${label}: inherit arxiv env`);
    }

    const repositoryPath = await realpath(fixture.repository);
    const explore = byLabel.get("capture:explore-readonly-explicit");
    assert.ok(explore.args.includes("--no-session"), "read-only role stays ephemeral");
    assert.equal(explore.cwd, repositoryPath, "explicit cwd does not alter read-only route inheritance");

    const worktree = byLabel.get("capture:general-worktree");
    assert.match(worktree.cwd, /\.pi\/worktrees\//, "writable worker receives an isolated worktree");
    assert.ok(worktree.args.includes("--session-id"), "writable worker retains a resumable session");

    const direct = byLabel.get("capture:general-direct");
    assert.equal(direct.cwd, repositoryPath, "PIPIUI_WORKTREE=0 keeps writable worker in caller cwd");

    const resumed = byLabel.get("capture:general-resume-explicit");
    assert.equal(resumed.cwd, repositoryPath, "explicit cwd bypasses worktree wrapping without dropping routes");
    assert.equal(summary.results["general-resume-explicit"].resumed, true, "stored session is recognized on resume");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
const sourceSubagentDirectory = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/subagent",
);
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

// Implementation A (subagent/index.ts): hardcoded AUTO_RESUME_MAX=2,
// AUTO_RESUME_BACKOFF_MS=[5000, 15000], jittered by up to -25%/+25%.
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_SECOND_MS = 15_000;
const BACKOFF_JITTER_RATIO = 0.25;
const MIN_BACKOFF_FACTOR = 1 - BACKOFF_JITTER_RATIO;

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
 * Fake-pi harness:
 * - When re-invoked with --mode (child worker), fail N times with a configured stderr
 *   signature, then succeed (or keep failing).
 * - Parent installs the real subagent extension and runs one foreground dispatch so the
 *   result + spawn count are returned as JSON.
 */
async function prepareHarness(directory, { failTimes, failStderr, agentId }) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const agentsDirectory = join(directory, "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    join(agentsDirectory, "probe.md"),
    "---\nname: probe\ndescription: Test-only probe agent\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );

  const counterPath = join(directory, "child-spawn-count.txt");
  await writeFile(counterPath, "0", "utf8");

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `import { readFileSync, writeFileSync } from "node:fs";

const counterPath = ${JSON.stringify(counterPath)};
const failTimes = ${JSON.stringify(failTimes)};
const failStderr = ${JSON.stringify(failStderr)};
const agentId = ${JSON.stringify(agentId)};

if (process.argv.includes("--mode")) {
  let n = Number(readFileSync(counterPath, "utf8") || "0");
  n += 1;
  writeFileSync(counterPath, String(n));
  if (n <= failTimes) {
    process.stderr.write(failStderr + "\\n");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "recovered-ok spawn=" + n }],
        stopReason: "end",
      },
    }) + "\\n",
  );
  process.exit(0);
}

const delivered = [];
const { default: install } = await import("./subagent/index.ts");
install({
  registerTool(tool) {
    globalThis.__tool = tool;
  },
  registerCommand() {},
  on() {},
  async sendUserMessage(text) {
    delivered.push(String(text));
  },
});

const subagent = globalThis.__tool;
// Implementation A unref()s auto-resume backoff timers so a quiet host can exit.
// Keep a ref'd handle so this headless harness survives the 5s/15s sleeps.
const keepAlive = setInterval(() => {}, 60_000);
const started = Date.now();
let result;
try {
  result = await subagent.execute(
    "autoresume-test",
    {
      agent: "probe",
      task: "simulate transient death",
      agentId,
      background: false,
    },
    new AbortController().signal,
    undefined,
    { cwd: process.cwd(), hasUI: false },
  );
} finally {
  clearInterval(keepAlive);
}
const elapsedMs = Date.now() - started;
const spawns = Number(readFileSync(counterPath, "utf8") || "0");
process.stdout.write(
  JSON.stringify({
    result,
    delivered,
    spawns,
    elapsedMs,
    text: result?.content?.[0]?.text ?? "",
    isError: !!result?.isError,
    details: result?.details ?? null,
  }),
);
`,
    "utf8",
  );
  return { agentsDirectory, harness, counterPath };
}

async function runHarness(directory, agentsDirectory, harness, { timeoutMs = 20_000 } = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", harness],
    {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: "",
        PIPIUI_AGENTS_DIR: agentsDirectory,
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
      },
      // Exhaust path needs first+second backoff (5s+15s) plus spawn overhead.
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

function singleResult(out) {
  return out.details?.results?.[0] ?? null;
}

test("retryable worker death auto-resumes once then succeeds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-ok-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 1,
      failStderr: "Error: fetch failed",
      agentId: "resume-ok",
    });
    const out = await runHarness(directory, agentsDirectory, harness, {
      // 1× first backoff (5s) + headroom
      timeoutMs: 25_000,
    });

    assert.equal(out.spawns, 2, "initial death + one auto-resume spawn");
    assert.notEqual(out.isError, true, "dispatch should succeed after resume");
    assert.match(out.text, /recovered-ok spawn=2/);
    // Implementation A appends resume note on the end report path; success tool text is
    // the assistant final message (+ verified=). Spawns + backoff prove the resume loop.
    const single = singleResult(out);
    assert.ok(single, "details.results[0] present");
    assert.equal(single.exitCode, 0);
    assert.match(String(single.stderr ?? ""), /fetch failed/i);
    const minFirstBackoff = BACKOFF_FIRST_MS * MIN_BACKOFF_FACTOR - 500;
    assert.ok(
      out.elapsedMs >= minFirstBackoff,
      `expected >=${minFirstBackoff}ms jittered first backoff, elapsed=${out.elapsedMs}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("auto-resume caps at AUTO_RESUME_MAX=2 then fails with last retryable error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-exhaust-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 99,
      failStderr: "Service temporarily unavailable",
      agentId: "resume-exhaust",
    });
    const out = await runHarness(directory, agentsDirectory, harness, {
      // 5s + 15s backoff + spawns
      timeoutMs: 45_000,
    });

    assert.equal(out.spawns, 3, "initial + 2 auto-resumes (AUTO_RESUME_MAX=2)");
    assert.equal(out.isError, true, "must end as failure after budget exhausted");
    assert.match(out.text, /unavailable/i);
    // No Implementation-B "auto-resume exhausted" banner; failure text carries stderr.
    assert.doesNotMatch(out.text, /auto-resume exhausted/i);

    const single = singleResult(out);
    assert.ok(single, "details.results[0] present");
    assert.equal(single.exitCode, 1);
    const stderr = String(single.stderr ?? "");
    assert.match(stderr, /Service temporarily unavailable/i);
    // stderr accumulates across attempts — three child deaths.
    const hits = stderr.match(/Service temporarily unavailable/gi) ?? [];
    assert.equal(hits.length, 3, "stderr should accumulate all three failed attempts");

    const minBackoff = (BACKOFF_FIRST_MS + BACKOFF_SECOND_MS) * MIN_BACKOFF_FACTOR - 500;
    assert.ok(
      out.elapsedMs >= minBackoff,
      `expected >=${minBackoff}ms jittered backoff, elapsed=${out.elapsedMs}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("quota / billing errors are non-retryable and do not auto-resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-quota-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 99,
      failStderr: "Error: insufficient_quota — billing hard limit reached",
      agentId: "resume-quota",
    });
    const out = await runHarness(directory, agentsDirectory, harness, {
      timeoutMs: 15_000,
    });

    assert.equal(out.spawns, 1, "must not retry non-retryable quota/billing errors");
    assert.equal(out.isError, true);
    assert.match(out.text, /quota|billing/i);
    assert.ok(
      out.elapsedMs < BACKOFF_FIRST_MS,
      `should fail immediately without ${BACKOFF_FIRST_MS}ms backoff, elapsed=${out.elapsedMs}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("first-attempt success does not auto-resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-first-ok-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 0,
      failStderr: "Error: fetch failed",
      agentId: "resume-first-ok",
    });
    const out = await runHarness(directory, agentsDirectory, harness, {
      timeoutMs: 15_000,
    });

    assert.equal(out.spawns, 1, "successful first spawn must not re-run");
    assert.notEqual(out.isError, true);
    assert.match(out.text, /recovered-ok spawn=1/);
    const single = singleResult(out);
    assert.ok(single);
    assert.equal(single.exitCode, 0);
    assert.equal(String(single.stderr ?? "").trim(), "", "no failed-attempt stderr");
    assert.ok(
      out.elapsedMs < BACKOFF_FIRST_MS,
      `no backoff on first success, elapsed=${out.elapsedMs}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

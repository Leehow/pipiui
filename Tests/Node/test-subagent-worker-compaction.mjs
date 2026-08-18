import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  resolveSubagentToolSelection,
  SESSION_RECALL_TOOL_NAME,
} from "../../Electron/resources/runtime/pi-ext/subagent/desktop-tool-policy.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piExtDirectory = join(repositoryRoot, "Electron/resources/runtime/pi-ext");
const piPackageRoot = join(
  repositoryRoot,
  "Electron/node_modules/@earendil-works/pi-coding-agent",
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
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

// A worker session reused across dispatches: the first user message is an OLDER
// task, the current dispatch's Task: message sits early in the failed run, and a
// huge tool result bloats the turn that died. 80k+ tokens of cumulative usage sit
// on the assistant entries — the exact shape that used to collapse the kept
// window to one turn's tail and summarize the WRONG (oldest) task.
function resumedWorkerEntries() {
  return [
    { type: "session", id: "h0", parentId: null, cwd: "/tmp/probe" },
    {
      type: "message",
      id: "u1",
      parentId: "h0",
      message: { role: "user", content: "Task: 第一次派发的老任务：给登录页加验证码" },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "老任务完成" }],
        usage: { totalTokens: 90_000 },
      },
    },
    {
      type: "message",
      id: "u2",
      parentId: "a1",
      message: {
        role: "user",
        content: [{ type: "text", text: "Task: 当前任务：修复隧道重连的竞态" }],
      },
    },
    {
      type: "message",
      id: "t1",
      parentId: "u2",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "X".repeat(200_000) }],
      },
    },
    {
      type: "message",
      id: "a2",
      parentId: "t1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "working" }],
        usage: { totalTokens: 260_000 },
      },
    },
    {
      type: "message",
      id: "t2",
      parentId: "a2",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "Y".repeat(2_000) }],
      },
    },
    {
      type: "message",
      id: "a3",
      parentId: "t2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "dying on fetch failed" }],
        usage: { totalTokens: 262_000 },
      },
    },
  ];
}

async function prepareHarness(directory, sessionDir) {
  await cp(piExtDirectory, join(directory, "pi-ext"), { recursive: true });
  await linkRuntimePackages(directory);

  const harness = join(directory, "harness.mjs");
  await writeFile(harness, harnessSource(sessionDir), "utf8");
  return harness;
}

function harnessSource(sessionDir) {
  return `import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sessionDir = ${JSON.stringify(sessionDir)};
const resumedWorkerEntries = ${resumedWorkerEntries.toString()};

const writeSession = (sessionId, entries) => {
  const file = join(sessionDir, \`2026-01-01T00-00-00-000Z_\${sessionId}.jsonl\`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\\n") + "\\n", "utf8");
  return file;
};

const { appendSessionCompaction } = await import("./pi-ext/subagent/index.ts");

const readLastEntry = (file) => {
  const lines = readFileSync(file, "utf8").split("\\n").filter((l) => l.trim());
  return JSON.parse(lines[lines.length - 1]);
};
const lineCount = (file) =>
  readFileSync(file, "utf8").split("\\n").filter((l) => l.trim()).length;

// 1. Current dispatch task must headline the summary; kept window must be a real
// ~20k-token tail (chars/4), not one turn collapsed by cumulative usage tokens.
const mainFile = writeSession("pipiui-compaction-probe", resumedWorkerEntries());
const compacted = appendSessionCompaction(
  sessionDir,
  "pipiui-compaction-probe",
  "当前任务：修复隧道重连的竞态（附录：验证 tunnel-reconnect 分支回归）",
  262_000,
);
const mainEntry = compacted ? readLastEntry(mainFile) : null;

// 2. Empty taskText falls back to the LATEST "Task:" user message, never the
// session's first (older dispatch) task.
const fallbackFile = writeSession("pipiui-compaction-fallback", resumedWorkerEntries());
const fallbackCompacted = appendSessionCompaction(
  sessionDir,
  "pipiui-compaction-fallback",
  "",
  262_000,
);
const fallbackEntry = fallbackCompacted ? readLastEntry(fallbackFile) : null;

// 3. A too-small chain must refuse (no compaction entry appended).
const smallFile = writeSession("pipiui-compaction-small", [
  { type: "session", id: "s0", parentId: null },
  { type: "message", id: "m1", parentId: "s0", message: { role: "user", content: "Task: tiny" } },
  {
    type: "message",
    id: "m2",
    parentId: "m1",
    message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
  },
]);
const smallBefore = lineCount(smallFile);
const smallCompacted = appendSessionCompaction(sessionDir, "pipiui-compaction-small", "t", 500);

process.stdout.write(
  JSON.stringify({
    compacted,
    mainEntry,
    fallbackCompacted,
    fallbackEntry,
    smallCompacted,
    smallLinesUnchanged: lineCount(smallFile) === smallBefore,
  }),
);
`;
}

test("auto-resume compaction summarizes the CURRENT task and keeps a real token tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worker-compaction-"));
  try {
    const sessionDir = join(directory, "sessions");
    await mkdir(sessionDir, { recursive: true });
    const harness = await prepareHarness(directory, sessionDir);
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", harness],
      { cwd: directory, timeout: 60_000, maxBuffer: 5 * 1024 * 1024 },
    );
    const out = JSON.parse(stdout);

    // --- compaction entry appended, wired to the session leaf ---
    assert.equal(out.compacted, true, "compaction must append on a resumed worker session");
    const entry = out.mainEntry;
    assert.equal(entry.type, "compaction");
    assert.equal(entry.parentId, "a3", "compaction chains onto the session leaf");
    assert.equal(entry.tokensBefore, 262_000);

    // --- summary carries the CURRENT dispatch's task, not the first dispatch's ---
    assert.match(entry.summary, /当前任务（本次派发）/);
    assert.match(entry.summary, /修复隧道重连的竞态（附录：验证 tunnel-reconnect 分支回归）/);
    assert.doesNotMatch(entry.summary, /第一次派发的老任务/);
    assert.match(entry.summary, /session_recall/, "summary must point at the recall tool");

    // --- kept window is content-sized: the huge tool result saturates the 20k
    // budget, so the tail starts there; the current Task: message (u2) predates
    // it and is correctly replaced by the summary instead of being kept.
    assert.equal(entry.firstKeptEntryId, "t1");

    // --- fallback: empty taskText still summarizes the LATEST Task: message ---
    assert.equal(out.fallbackCompacted, true);
    assert.match(out.fallbackEntry.summary, /修复隧道重连的竞态/);
    assert.doesNotMatch(out.fallbackEntry.summary, /第一次派发的老任务/);
    assert.equal(out.fallbackEntry.firstKeptEntryId, "t1");

    // --- too-small sessions refuse instead of emitting a useless compaction ---
    assert.equal(out.smallCompacted, false);
    assert.equal(out.smallLinesUnchanged, true, "no entry may be appended on refusal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dispatch grants session_recall to declared-tool workers via hasSessionRecall", () => {
  const granted = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: [],
    hasDesktopCapability: false,
    hasSessionRecall: true,
    allowRecursiveDelegation: false,
  });
  assert.equal(granted.flag, "--tools");
  assert.ok(
    granted.names.includes(SESSION_RECALL_TOOL_NAME),
    "a worker whose subagent extension is mounted must be able to recall its compacted history",
  );
  assert.ok(granted.names.includes("read"));

  const unmounted = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: [],
    hasDesktopCapability: false,
    allowRecursiveDelegation: false,
  });
  assert.deepEqual(
    unmounted.names,
    ["read", "bash"],
    "no extension mounted → no session_recall name in the allowlist",
  );

  const denied = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: [SESSION_RECALL_TOOL_NAME],
    hasDesktopCapability: false,
    hasSessionRecall: true,
    allowRecursiveDelegation: false,
  });
  assert.ok(
    !denied.names.includes(SESSION_RECALL_TOOL_NAME),
    "the user's tool denylist still wins over the dispatch grant",
  );

  const legacy = resolveSubagentToolSelection({
    declaredTools: undefined,
    disabledTools: [],
    hasDesktopCapability: false,
    hasSessionRecall: true,
    allowRecursiveDelegation: false,
  });
  assert.equal(legacy.flag, "--exclude-tools", "legacy unconstrained policy keeps its shape");
});

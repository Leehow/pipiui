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
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function prepareHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const sessionFile = join(directory, "active-session.jsonl");
  const emptyFile = join(directory, "empty-session.jsonl");
  const malformedFile = join(directory, "malformed-session.jsonl");
  const now = Date.now();
  const entry = (id, parentId, message) => ({
    type: "message",
    id,
    parentId,
    timestamp: new Date(now).toISOString(),
    message,
  });
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: "session-root", timestamp: new Date(now).toISOString(), cwd: directory }),
    JSON.stringify(entry("u1", "session-root", { role: "user", content: [{ type: "text", text: "Build the reporting flow." }] })),
    JSON.stringify(entry("a1", "u1", { role: "assistant", content: [{ type: "text", text: "Initial active-lineage work." }] })),
    JSON.stringify(entry("u2", "a1", { role: "user", content: [{ type: "text", text: "Correction: use agentId=active-7 and retain this worktree." }] })),
    JSON.stringify(entry("a2", "u2", { role: "assistant", content: [{ type: "text", text: "Verification passed: node --test; worktree disposition retained." }] })),
    JSON.stringify({ type: "compaction", id: "cmp1", parentId: "a2", timestamp: new Date(now).toISOString(), summary: "Archived active-plan facts before compaction.", firstKeptEntryId: "u2", tokensBefore: 5000 }),
    JSON.stringify(entry("u3", "cmp1", { role: "user", content: [{ type: "text", text: `huge-token ${"x".repeat(20_000)}` }] })),
    "{ malformed jsonl line",
    JSON.stringify(entry("off1", "a1", { role: "user", content: [{ type: "text", text: "OFF_BRANCH secret must never be recalled from the active lineage." }] })),
  ];
  await writeFile(sessionFile, `${lines.join("\n")}\n`, "utf8");
  await writeFile(emptyFile, "", "utf8");
  await writeFile(malformedFile, "not-json\n[\n", "utf8");

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `import { writeFileSync } from "node:fs";

const sessionFile = ${JSON.stringify(sessionFile)};
const emptyFile = ${JSON.stringify(emptyFile)};
const malformedFile = ${JSON.stringify(malformedFile)};
const outputPath = ${JSON.stringify(join(directory, "result.json"))};
const {
  registerSessionRecallTool,
  recallActiveSession,
  SESSION_RECALL_MAX_RESULT_CHARS,
} = await import("./subagent/session-recall.ts");

const tools = new Map();
registerSessionRecallTool({
  registerTool(tool) { tools.set(tool.name, tool); },
});
const tool = tools.get("session_recall");
const ctx = {
  sessionManager: {
    getSessionFile: () => sessionFile,
    getLeafId: () => "u3",
  },
};
const invoke = (params) => tool.execute("recall-test", params, undefined, undefined, ctx);
const active = await invoke({ query: "agentId=active-7", limit: 4 });
const verification = await invoke({ query: "verification passed" });
const branchExcluded = await invoke({ query: "OFF_BRANCH" });
const huge = await invoke({ query: "huge-token" });
const missing = recallActiveSession({ query: "anything", sessionFile: sessionFile + ".missing" });
const noSession = recallActiveSession({ query: "anything" });
const empty = recallActiveSession({ query: "anything", sessionFile: emptyFile });
const malformed = recallActiveSession({ query: "anything", sessionFile: malformedFile });

writeFileSync(outputPath, JSON.stringify({
  registered: !!tool && tool.name === "session_recall",
  active,
  verification,
  branchExcluded,
  huge,
  maxResultChars: SESSION_RECALL_MAX_RESULT_CHARS,
  missing,
  noSession,
  empty,
  malformed,
}));
`,
    "utf8",
  );
  return harness;
}

test("session_recall searches only raw active lineage with bounded, friendly results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-session-recall-"));
  try {
    const harness = await prepareHarness(directory);
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: { ...process.env, PI_SESSION_FILE: "" },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const { readFile } = await import("node:fs/promises");
    const out = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));

    assert.equal(out.registered, true, "the LLM tool must register as session_recall");
    assert.equal(out.active.details.status, "ok");
    assert.equal(out.active.details.lineageSource, "leaf");
    assert.match(out.active.content[0].text, /\[u2 message:user\]/);
    assert.match(out.active.content[0].text, /agentId=active-7/);
    assert.match(out.verification.content[0].text, /\[a2 message:assistant\]/);
    assert.match(out.verification.content[0].text, /Verification passed/);
    assert.equal(out.branchExcluded.details.status, "no-match", "other branches must not be searched");
    assert.doesNotMatch(out.branchExcluded.content[0].text, /\[off1 message:user\]/);
    assert.match(out.active.content[0].text, /skipped 1 malformed JSONL line/i);

    assert.equal(out.huge.details.status, "ok");
    assert.match(out.huge.content[0].text, /\[u3 message:user\]/);
    assert.ok(
      out.huge.content[0].text.length <= out.maxResultChars,
      "one tool result must obey its total character cap",
    );

    assert.equal(out.noSession.details.status, "no-session");
    assert.match(out.noSession.text, /no persisted JSONL file/i);
    assert.equal(out.missing.details.status, "unavailable");
    assert.match(out.missing.text, /ENOENT/);
    assert.equal(out.empty.details.status, "empty");
    assert.match(out.empty.text, /no entries yet/i);
    assert.equal(out.malformed.details.status, "empty");
    assert.match(out.malformed.text, /no readable entries/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

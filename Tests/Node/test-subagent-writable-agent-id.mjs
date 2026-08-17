import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A worker that writes code gets a real git branch named `pipiui/<agentId>` verbatim, so an
 * unnamed writable worker permanently stamps a random id (`pipiui/agent-b39698e8c52ff202`) onto
 * the repository — the exact drift the semantic-id contract exists to prevent. Read-only roles
 * never create a worktree, so a generated id for a one-shot report is invisible and stays legal.
 *
 * The rule is pure, so it is extracted from source rather than booting the whole extension.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent/index.ts");

async function loadRule() {
  const source = await readFile(extensionPath, "utf8");
  const start = source.indexOf("export function unnamedWritableDispatchProblem(");
  assert.notEqual(start, -1, "unnamedWritableDispatchProblem must exist in the extension");
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, "unnamedWritableDispatchProblem must be a closed declaration");
  // Strip annotations line-by-line so type edits to the parameters don't break extraction.
  const body = source
    .slice(start, end + 3)
    .replace("export function", "function")
    .replace(/targets:[^\n]*,/, "targets,")
    .replace(/createsWorktree:[^\n]*,/, "createsWorktree,")
    .replace(/\)\s*:\s*string \| null \{/, ") {");
  return new Function(`${body}; return unnamedWritableDispatchProblem;`)();
}

// createsWorktree receives the whole target since the isolation-aware signature change.
const writable = (target) => target.agent !== "explore";

test("an unnamed writable dispatch is refused with a model-addressed message", async () => {
  const problem = await loadRule();
  const message = problem([{ agent: "general-purpose", task: "x" }], writable);
  assert.ok(message, "a writable worker without an agentId must be refused");
  assert.match(message, /general-purpose/);
  assert.match(message, /pipiui\/<agentId>/);
});

test("a named writable dispatch passes", async () => {
  const problem = await loadRule();
  assert.equal(problem([{ agent: "general-purpose", agentId: "doc-panel" }], writable), null);
});

test("whitespace is not a name", async () => {
  const problem = await loadRule();
  assert.ok(problem([{ agent: "general-purpose", agentId: "   " }], writable));
});

test("read-only roles may still be unnamed: they never create a branch", async () => {
  const problem = await loadRule();
  assert.equal(problem([{ agent: "explore" }], writable), null);
});

test("a mixed request names only the writable offenders", async () => {
  const problem = await loadRule();
  const message = problem(
    [{ agent: "explore" }, { agent: "general-purpose" }, { agent: "reviewer", agentId: "review-pass" }],
    writable,
  );
  assert.match(message, /"general-purpose"/);
  assert.doesNotMatch(message, /explore/);
  assert.doesNotMatch(message, /reviewer/);
});

test("the dispatch tool no longer invites omitting the id for real work", async () => {
  const source = await readFile(extensionPath, "utf8");
  assert.ok(
    !source.includes("Omit for one-off work and a name is generated."),
    "the old description told the boss that omitting the id is fine for one-off work",
  );
  // Chain steps could not be named at all before this: the schema had no agentId field.
  // Match inside the ChainItem object literal (up to its options object) so the assertion
  // does not depend on how many Grok-family fields precede agentId.
  const chainItemBlock =
    source.match(/const ChainItem = Type\.Object\(\{[\s\S]*?additionalProperties: false/)?.[0] ?? "";
  assert.ok(
    chainItemBlock.includes("agentId: Type.Optional"),
    "chain steps must accept an optional agentId",
  );
});

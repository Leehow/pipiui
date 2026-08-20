import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryCatalog } from "../src/memory-catalog.ts";
import { MemoryCurator } from "../src/memory-curator.ts";
import { buildReviewPrompt, createCuratorReviewer, loadCompleteSimple, loadCompleteSimpleFromRoot, parseReviewJSON, resolveReviewModel } from "../src/curator-reviewer.ts";

const hermes = { add: async () => ({ id: "h" }), verify: async () => true };
async function fixture() { return mkdtemp(join(tmpdir(), "pipiui-reviewer-")); }
async function candidate(c: MemoryCatalog) {
  return c.upsert({ kind: "semantic", claim: "Repository rule: run tests before merge", scope: { kind: "project", project: "/repo" }, evidence: [{ summary: "authoritative repo rule with verified command evidence" }], sourceRuns: ["verified:a"] });
}

test("model replies survive fences and prose; unparseable output yields nothing", () => {
  const object = { decision: "promote", confidence: 0.8 };
  assert.deepEqual(parseReviewJSON('```json\n{"decision":"promote","confidence":0.8}\n```'), object);
  assert.deepEqual(parseReviewJSON('Here is my verdict:\n{"decision":"promote","confidence":0.8}\nHope that helps.'), object);
  for (const junk of ["", "   ", "no json at all", "{ not json }", "```json\n{oops\n```"]) assert.equal(parseReviewJSON(junk), undefined);
});

// The stub this reviewer replaced returned `{decision:"keep_candidate"}`, which the
// curator's schema rejects outright — every candidate stalled regardless of merit.
test("a realistic reply promotes where the previous stub shape could not", async () => {
  const dir = await fixture();
  try {
    const catalog = await MemoryCatalog.open(dir);
    const record = await candidate(catalog);
    const reply = ['```json', JSON.stringify({
      decision: "promote", kind: "semantic", claim: "Repository rule: run tests before merge",
      applicability: "before merging any branch in this repository", confidence: 0.86,
      reason: "an authoritative repository rule backed by verified command evidence",
      evidenceRefs: [`${record.id}:0`],
    }), '```'].join("\n");
    const parsed = parseReviewJSON(reply);
    const curator = MemoryCurator.create({ mode: "main", catalog, hermes, reviewer: { review: async () => parsed } })!;
    await curator.runBatch();
    assert.equal(catalog.get(record.id)?.status, "active");
    assert.equal(catalog.get(record.id)?.hermesID, "h");

    const stalled = await catalog.upsert({ kind: "semantic", claim: "Second rule", scope: { kind: "project", project: "/repo" }, evidence: [{ summary: "evidence" }], sourceRuns: ["verified:b"] });
    const stub = MemoryCurator.create({ mode: "main", catalog, hermes, reviewer: { review: async () => ({ decision: "keep_candidate" }) } })!;
    await stub.runBatch();
    assert.equal(catalog.get(stalled.id)?.status, "candidate");
  } finally { await rm(dir, { recursive: true }); }
});

test("the prompt frames candidate text as data and cites referenceable evidence ids", async () => {
  const dir = await fixture();
  try {
    const catalog = await MemoryCatalog.open(dir);
    const record = await candidate(catalog);
    const related = await catalog.upsert({ kind: "semantic", claim: "A neighbouring rule", scope: { kind: "project", project: "/repo" }, evidence: [{ summary: "e" }], sourceRuns: ["r"] });
    const prompt = buildReviewPrompt(catalog.get(record.id)!, [catalog.get(related.id)!]);
    assert.match(prompt, new RegExp(`${record.id}:0`));
    assert.match(prompt, new RegExp(related.id));
    assert.match(prompt, /RELATED/);
    assert.match(prompt, /scope: \/repo/);
  } finally { await rm(dir, { recursive: true }); }
});

test("the host review-model setting selects the curator's model and falls back when ambiguous", () => {
  const session = { provider: "session", id: "session-model" };
  const all = [{ provider: "anthropic", id: "claude-sonnet-4" }, { provider: "other", id: "claude-sonnet-4" }, session];
  const ctx = { model: session, modelRegistry: { getApiKeyAndHeaders: async () => ({ apiKey: "k" }), getAll: () => all } };
  assert.deepEqual(resolveReviewModel(ctx, { PIPIUI_MEMORY_REVIEW_MODEL: " anthropic/claude-sonnet-4 " }), all[0]);
  assert.deepEqual(resolveReviewModel(ctx, { PIPIUI_MEMORY_REVIEW_MODEL: "claude-sonnet-4" }), session, "an id matching two providers is ambiguous");
  assert.deepEqual(resolveReviewModel(ctx, { PIPIUI_MEMORY_REVIEW_MODEL: "nothing/here" }), session);
  assert.deepEqual(resolveReviewModel(ctx, {}), session);
  assert.equal(resolveReviewModel({ modelRegistry: ctx.modelRegistry }, {}), undefined);
});

test("a missing model, registry, or provider key leaves the candidate pending instead of throwing", async () => {
  const input = { candidate: { id: "x", kind: "semantic", claim: "c", scope: { kind: "project", project: "/repo" }, evidence: [], sourceRuns: [], provenance: [] }, related: [] } as never;
  assert.equal(await createCuratorReviewer({}, {}).review(input), undefined);
  assert.equal(await createCuratorReviewer({ model: { provider: "p", id: "m" } }, {}).review(input), undefined);
  const registry = { getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }) };
  assert.equal(await createCuratorReviewer({ model: { provider: "p", id: "m" }, modelRegistry: registry }, {}).review(input), undefined);
  const throwing = { getApiKeyAndHeaders: async () => { throw new Error("registry down"); } };
  assert.equal(await createCuratorReviewer({ model: { provider: "p", id: "m" }, modelRegistry: throwing }, {}).review(input), undefined);
});

// The broker is loaded from resources/, not from the runtime's node_modules, so
// in a packaged App the bare specifier resolves against nothing on the way up.
test("the managed node_modules root loads the provider that a bare specifier cannot reach", async () => {
  const managedRoot = join(import.meta.dirname, "../../../../../../.embedded-runtimes/darwin-arm64/pi/lib/node_modules");
  if (!existsSync(join(managedRoot, "@earendil-works/pi-ai/package.json"))) return; // runtime not fetched in this checkout
  assert.equal(typeof await loadCompleteSimpleFromRoot(managedRoot), "function", "export map's import condition must be followed");
  assert.equal(await loadCompleteSimpleFromRoot(join(tmpdir(), "pipiui-absent-root")), undefined);
  await assert.doesNotReject(loadCompleteSimple({}));
  await assert.doesNotReject(loadCompleteSimple({ PIPIUI_HERMES_NODE_MODULES_ROOT: join(tmpdir(), "pipiui-absent-root") }));
});

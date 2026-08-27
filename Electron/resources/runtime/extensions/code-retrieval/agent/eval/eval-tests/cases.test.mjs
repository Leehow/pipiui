/**
 * Case-corpus representativeness contract (remediation wave):
 * exactly 20 bounded cases grounded in evidenced production task shapes —
 * no self-referential optimization-file corpus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CASES } from "../retrieval-eval-cases.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER_SRC = readFileSync(join(EVAL_DIR, "..", "run-retrieval-eval.mjs"), "utf8");

test("exactly 20 bounded cases", () => {
  assert.equal(CASES.length, 20);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 20);
});

test("every case declares an evidenced production shape tag", () => {
  for (const c of CASES) {
    assert.ok(typeof c.shape === "string" && c.shape.length > 3, `case ${c.id} missing shape`);
  }
  const shapes = new Set(CASES.map((c) => c.shape));
  // Evidence-backed shapes from .pi/findings (verdict / trajectories / cases).
  for (const required of ["pdf-plugin-recon", "closeout-codepath", "honesty-contract", "orientation-probe"]) {
    assert.ok(shapes.has(required), `missing evidence shape ${required}`);
  }
});

test("NO case targets agent/eval/** (self-reference ban)", () => {
  for (const c of CASES) {
    for (const s of c.expectPathSuffixes ?? []) {
      assert.ok(!s.includes("/agent/eval/"), `case ${c.id} targets eval dir itself`);
    }
    if (c.expectPathPrefix) assert.ok(!c.expectPathPrefix.includes("/agent/eval/"));
    // The runner/case source files are not acceptable gold either:
    for (const snip of c.snippets ?? []) assert.ok(!snip.includes("run-retrieval-eval"));
  }
});

test("at most 3 cases target code-retrieval internals; the rest cover other production areas", () => {
  const crCases = CASES.filter((c) =>
    (c.expectPathSuffixes ?? []).some((s) => s.includes("extensions/code-retrieval/")),
  );
  assert.ok(crCases.length <= 3, `too many self-area cases: ${crCases.map((c) => c.id).join(", ")}`);
  const outside = CASES.filter((c) => !crCases.includes(c));
  assert.ok(outside.length >= 17);
  // Distinct top-level areas are represented (not one file family).
  const areas = new Set(
    outside.flatMap((c) => c.expectPathSuffixes ?? []).map((s) => s.split("/").slice(0, 3).join("/")),
  );
  assert.ok(areas.size >= 5, `production shapes collapsed into ${areas.size} areas`);
});

test("kind coverage mirrors measured trajectory styles", () => {
  const kinds = new Set(CASES.map((c) => c.kind));
  for (const k of ["exact", "descriptive", "symbol-hint", "nav", "map", "behavioral"]) {
    assert.ok(kinds.has(k), `corpus missing kind ${k}`);
  }
  assert.ok(CASES.filter((c) => c.kind === "exact").length >= 4, "exact known-token grep must stay exercised");
});

test("every scored case carries verifiable gold structure", () => {
  for (const c of CASES) {
    if (c.behavioralOnly) continue;
    assert.ok((c.snippets ?? []).length > 0, `${c.id} missing snippets`);
    assert.ok((c.expectPathSuffixes ?? []).length > 0, `${c.id} missing expectPathSuffixes`);
    assert.ok(c.query || c.operation || c.kind === "map", `${c.id} has no probe input`);
  }
});

test("runner never imports a hand-rolled map/nav renderer (surface parity)", () => {
  assert.ok(!RUNNER_SRC.includes("formatCompressedContent"), "evaluator must not re-render tool output");
  assert.ok(RUNNER_SRC.includes("extensionInstall(api)"), "must install the real extension entry");
  assert.ok(RUNNER_SRC.includes("repo_map"), "must drive the registered repo_map handler");
});

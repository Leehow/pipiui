/**
 * JEV_CASES corpus contract: ≥30 scorable golds, disk-verified anchors,
 * no self-reference, variants/scope rules, genuine cross-file required paths.
 * Fixtures only — does not import the runner or uncommitted eval APIs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "../retrieval-eval-cases.mjs";
import { JEV_CASES } from "../jev-eval-cases.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, "CONSTITUTION.md")) && existsSync(join(dir, "Electron"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root not found from eval-tests");
}

const REPO_ROOT = findRepoRoot(EVAL_DIR);
const MAX_VARIANT = 512;
const CONTROL_KINDS = new Set(["exact", "symbol-hint", "nav"]);

function goldPaths(c) {
  return [...new Set([...(c.expectPathSuffixes ?? []), ...(c.requiredPathSuffixes ?? [])])];
}

function readGold(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("at least 30 unique scorable JEV_CASES ids", () => {
  assert.ok(JEV_CASES.length >= 30, `expected ≥30, got ${JEV_CASES.length}`);
  assert.equal(new Set(JEV_CASES.map((c) => c.id)).size, JEV_CASES.length);
  for (const c of JEV_CASES) {
    assert.equal(c.behavioralOnly, undefined, `${c.id} must be scorable, not behavioral`);
    assert.ok(typeof c.shape === "string" && c.shape.length > 3, `${c.id} missing shape`);
    assert.ok((c.snippets ?? []).length > 0, `${c.id} missing snippets`);
    assert.ok((c.expectPathSuffixes ?? []).length > 0, `${c.id} missing expectPathSuffixes`);
    assert.ok(c.query || c.operation, `${c.id} has no probe input`);
  }
});

test("reuses 18 legacy non-behavioral golds plus at least 12 new ids", () => {
  const legacyScorable = CASES.filter((c) => !c.behavioralOnly);
  assert.equal(legacyScorable.length, 18);
  const jevIds = new Set(JEV_CASES.map((c) => c.id));
  for (const c of legacyScorable) {
    assert.ok(jevIds.has(c.id), `missing reused legacy id ${c.id}`);
  }
  const newCount = JEV_CASES.filter((c) => !legacyScorable.some((l) => l.id === c.id)).length;
  assert.ok(newCount >= 12, `expected ≥12 new golds, got ${newCount}`);
});

test("gold paths and every needle exist on disk", () => {
  for (const c of JEV_CASES) {
    const paths = goldPaths(c);
    assert.ok(paths.length > 0, `${c.id} has no gold paths`);
    const bodies = [];
    for (const rel of paths) {
      const abs = join(REPO_ROOT, rel);
      assert.ok(existsSync(abs), `${c.id} missing gold path ${rel}`);
      assert.ok(statSync(abs).isFile(), `${c.id} gold path is not a file: ${rel}`);
      bodies.push(readGold(rel));
    }
    for (const needle of c.snippets) {
      assert.ok(
        bodies.some((body) => body.includes(needle)),
        `${c.id} needle not found in gold files: ${JSON.stringify(needle)}`,
      );
    }
  }
});

test("NO self-reference into agent/eval or jev-optimizer; ≤3 code-retrieval internals", () => {
  const cr = [];
  for (const c of JEV_CASES) {
    for (const s of goldPaths(c)) {
      assert.ok(!s.includes("/agent/eval/"), `${c.id} targets eval dir itself`);
      assert.ok(!s.includes("jev-optimizer"), `${c.id} targets Jev optimizer`);
    }
    if (c.path) {
      assert.ok(!c.path.includes("/agent/eval/"), `${c.id} path scopes eval dir`);
      assert.ok(!c.path.includes("jev-optimizer"), `${c.id} path scopes Jev optimizer`);
    }
    for (const snip of c.snippets ?? []) {
      assert.ok(!snip.includes("run-retrieval-eval"), `${c.id} snippet names the runner`);
    }
    if ((c.expectPathSuffixes ?? []).some((s) => s.includes("extensions/code-retrieval/"))) {
      cr.push(c.id);
    }
  }
  assert.ok(cr.length <= 3, `too many code-retrieval internals: ${cr.join(", ")}`);
});

test("descriptive cases have 1-3 queryVariants; exact/symbol/nav have none", () => {
  for (const c of JEV_CASES) {
    const variants = c.queryVariants;
    if (CONTROL_KINDS.has(c.kind)) {
      assert.ok(variants == null || variants.length === 0, `${c.id} (${c.kind}) must not carry queryVariants`);
      continue;
    }
    if (c.kind !== "descriptive") continue;
    assert.ok(Array.isArray(variants), `${c.id} missing queryVariants`);
    assert.ok(variants.length >= 1 && variants.length <= 3, `${c.id} wants 1-3 variants, got ${variants.length}`);
    const seen = new Set();
    for (const v of variants) {
      assert.equal(typeof v, "string", `${c.id} variant is not a string`);
      assert.ok(v.trim() === v && v.length > 0, `${c.id} variant must be trimmed nonempty`);
      assert.ok(v.length <= MAX_VARIANT, `${c.id} variant exceeds ${MAX_VARIANT} chars`);
      assert.notEqual(v, c.query, `${c.id} variant duplicates query`);
      assert.ok(!seen.has(v), `${c.id} duplicate variant`);
      seen.add(v);
    }
  }
});

test("scoped path/glob/topK are well-formed and cover the gold file", () => {
  for (const c of JEV_CASES) {
    if (c.path != null) {
      assert.equal(typeof c.path, "string");
      assert.ok(c.path.length > 0 && !c.path.endsWith("/"), `${c.id} path should be a prefix without trailing slash`);
      const abs = join(REPO_ROOT, c.path);
      assert.ok(existsSync(abs), `${c.id} scoped path does not exist: ${c.path}`);
      const prefix = c.path;
      assert.ok(
        goldPaths(c).some((s) => s === prefix || s.startsWith(`${prefix}/`)),
        `${c.id} path does not cover any gold file`,
      );
    }
    if (c.glob != null) {
      assert.equal(typeof c.glob, "string");
      assert.ok(c.glob.length > 0, `${c.id} empty glob`);
    }
    if (c.topK != null) {
      assert.ok(Number.isInteger(c.topK) && c.topK > 0, `${c.id} topK must be a positive integer`);
    }
  }
  assert.ok(
    JEV_CASES.some((c) => typeof c.path === "string" && c.path.length > 0),
    "corpus needs at least one explicitly scoped path case",
  );
});

test("at least two golds use requiredPathSuffixes for genuine cross-file coverage", () => {
  const cross = JEV_CASES.filter((c) => (c.requiredPathSuffixes ?? []).length >= 2);
  assert.ok(cross.length >= 2, `need ≥2 cross-file golds, got ${cross.map((c) => c.id).join(", ") || "none"}`);
  for (const c of cross) {
    const required = c.requiredPathSuffixes;
    assert.equal(new Set(required).size, required.length, `${c.id} duplicate required paths`);
    for (const rel of required) {
      assert.ok((c.expectPathSuffixes ?? []).includes(rel), `${c.id} required path missing from expectPathSuffixes: ${rel}`);
      assert.ok(existsSync(join(REPO_ROOT, rel)), `${c.id} required path missing on disk: ${rel}`);
    }
  }
  // Alternative wrappers (office gate) must not be marked all-required.
  const office = JEV_CASES.find((c) => c.id === "desc-office-shot-gate");
  assert.ok(office, "reused office-shot-gate gold missing");
  assert.ok((office.expectPathSuffixes ?? []).length >= 2);
  assert.ok(!office.requiredPathSuffixes || office.requiredPathSuffixes.length === 0);
});

test("queries are unique — no same question under two ids", () => {
  const queries = new Map();
  for (const c of JEV_CASES) {
    const key = `${c.kind}\0${c.query ?? ""}\0${c.operation ?? ""}\0${c.symbol ?? ""}`;
    const prev = queries.get(key);
    assert.equal(prev, undefined, `duplicate probe ${c.id} vs ${prev}`);
    queries.set(key, c.id);
  }
});

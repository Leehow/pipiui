import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SeenRangeLedger, hashContent, mergeAdjacentSpans } from "./ledger.js";
import {
  RefRegistry,
  buildToolResult,
  formatCompressedContent,
  formatRefLine,
} from "./protocol.js";
import { executeReadSpans } from "./read-spans.js";
import { routeQuery } from "./route.js";
import { writeFile, mkdir } from "node:fs/promises";

test("route table follows D4 morphologies", () => {
  assert.equal(routeQuery("src/auth/session.ts:12"), "exact");
  assert.equal(routeQuery("TypeError: cannot read"), "exact");
  assert.equal(routeQuery("foo.*bar"), "exact");
  assert.equal(routeQuery("谁定义 validateSession"), "symbol");
  assert.equal(routeQuery("who defines signToken"), "symbol");
  assert.equal(routeQuery("how does authentication work?"), "semantic");
  assert.equal(routeQuery("validate the session store wiring across worker spawn"), "hybrid");
  assert.equal(routeQuery("validateSession", "symbol"), "symbol");
});

test("stable R# refs are assigned in order and content is top-12 compressed", () => {
  const registry = new RefRegistry();
  const hits = registry.assignAll([
    { path: "src/auth/session.ts", startLine: 81, endLine: 126, symbol: "validateSession", score: 0.94 },
    { path: "src/auth/token.ts", startLine: 12, endLine: 40, symbol: "signToken", score: 0.81 },
  ]);
  assert.equal(hits[0]!.ref, "R1");
  assert.equal(hits[1]!.ref, "R2");
  assert.equal(
    formatRefLine(hits[0]!),
    "R1 src/auth/session.ts:81-126 validateSession() · score 0.94",
  );
  const many = registry.assignAll(
    Array.from({ length: 14 }, (_, i) => ({ path: `f${i}.ts`, startLine: 1, endLine: 2 })),
  );
  const text = formatCompressedContent(many);
  assert.ok(text.includes("R3"));
  assert.ok(text.includes("R14"));
  assert.ok(!text.includes("R16"));
  assert.ok(text.includes("至多 12"));
});

test("details persist to results/<hash>.jsonl with frozen field names", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-proto-"));
  try {
    const result = await buildToolResult({
      projectRoot: root,
      kind: "code-retrieval.search",
      degraded: false,
      hits: [
        {
          ref: "R17",
          path: "src/auth/session.ts",
          startLine: 81,
          endLine: 126,
          symbol: "validateSession",
          score: 0.94,
        },
      ],
      content: "R17 src/auth/session.ts:81-126 validateSession() · score 0.94",
      query: "validateSession",
    });
    assert.equal(result.details.schemaVersion, 1);
    assert.equal(result.details.kind, "code-retrieval.search");
    assert.equal(result.details.degraded, false);
    assert.equal(result.details.hits[0]!.ref, "R17");
    assert.match(result.details.resultsPath, /^\.pi\/agent\/code-retrieval\/results\/[0-9a-f]{16}\.jsonl$/);
    const abs = join(root, result.details.resultsPath);
    const lines = (await readFile(abs, "utf8")).trim().split("\n");
    assert.ok(lines.length >= 2);
    const header = JSON.parse(lines[0]!) as { kind: string; hitCount: number };
    assert.equal(header.kind, "code-retrieval.search");
    assert.equal(header.hitCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("seam 3: second read_spans of the same range returns only the citation", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-spans-"));
  try {
    const srcDir = join(root, "src");
    await mkdir(srcDir, { recursive: true });
    const body = ["export function validateSession() {", "  return true;", "}", ""].join("\n");
    await writeFile(join(srcDir, "session.ts"), body, "utf8");
    const registry = new RefRegistry();
    const rec = registry.assign({ path: "src/session.ts", startLine: 1, endLine: 3, symbol: "validateSession" });
    const ledger = new SeenRangeLedger();
    const first = await executeReadSpans({
      refs: [rec.ref],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    assert.equal(first.details.degraded, false);
    assert.match(first.content[0]!.text, /export function validateSession/);
    assert.match(first.content[0]!.text, /return true/);
    assert.equal(first.details.hits[0]!.alreadyRead, false);

    const second = await executeReadSpans({
      refs: [rec.ref],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    assert.equal(second.details.hits[0]!.alreadyRead, true);
    assert.match(second.content[0]!.text, /already read/);
    assert.ok(!second.content[0]!.text.includes("return true"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge adjacent spans and content-hash identity", () => {
  const merged = mergeAdjacentSpans([
    { path: "a.ts", startLine: 1, endLine: 10 },
    { path: "a.ts", startLine: 11, endLine: 20 },
    { path: "b.ts", startLine: 1, endLine: 2 },
  ]);
  assert.deepEqual(merged, [
    { path: "a.ts", startLine: 1, endLine: 20 },
    { path: "b.ts", startLine: 1, endLine: 2 },
  ]);
  assert.equal(hashContent("hello"), hashContent("hello"));
  assert.notEqual(hashContent("hello"), hashContent("world"));
});

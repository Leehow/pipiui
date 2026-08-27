import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { SeenRangeLedger, extractSpanText, hashContent } from "./ledger.js";
import { formatCompressedContent, RefRegistry } from "./protocol.js";
import {
  PREVIEW_BUDGET_TOKENS,
  PREVIEW_MAX_LINES,
  PREVIEW_MAX_PREVIEWS,
  buildInlinePreviews,
} from "./previews.js";
import { executeReadSpans } from "./read-spans.js";

const LONG_FILE = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of demo`).join("\n") + "\n";

async function withFixture<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-preview-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function recordsOf(registry: RefRegistry, specs: Array<{ path: string; startLine: number; endLine: number }>) {
  return registry.assignAll(specs);
}

test("previews cover only the top-K refs at default settings", async () => {
  await withFixture(async (root) => {
    for (let i = 0; i < 8; i++) {
      await writeFile(join(root, "src", `f${i}.ts`), LONG_FILE, "utf8");
    }
    const registry = new RefRegistry();
    const records = recordsOf(
      registry,
      Array.from({ length: 10 }, (_, i) => ({
        path: `src/f${i % 8}.ts`,
        startLine: 1,
        endLine: Math.min(10 + i, 40),
      })),
    );
    const outcome = await buildInlinePreviews(records, { projectRoot: root });
    assert.equal(outcome.previews.size, PREVIEW_MAX_PREVIEWS);
    assert.equal(outcome.previewed, PREVIEW_MAX_PREVIEWS);
    assert.equal(outcome.usedTokens > 0, true);
    assert.ok(outcome.note!.includes(`of ${records.length} hits`));
    assert.ok(outcome.note!.includes("read_spans"));
  });
});

test("each preview is line-bounded and marks the unshown tail", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "demo.ts"), LONG_FILE, "utf8");
    const registry = new RefRegistry();
    const [record] = recordsOf(registry, [{ path: "src/demo.ts", startLine: 5, endLine: 35 }]);
    const outcome = await buildInlinePreviews([record!], { projectRoot: root });
    const text = outcome.previews.get(record!.ref)!;
    const sourceLines = text.split("\n").filter((line) => /\| /.test(line));
    assert.ok(sourceLines.length <= PREVIEW_MAX_LINES, `expected ≤6 lines, got ${sourceLines.length}`);
    assert.match(text, /lines \d+–\d+ not shown/);
    assert.match(text, /read_spans R1/);
    assert.ok(text.includes("line 5 of demo"), "preview must render real source");
  });
});

test("aggregate preview budget is strict and stops previews early", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "demo.ts"), LONG_FILE, "utf8");
    const registry = new RefRegistry();
    const records = recordsOf(registry, [
      { path: "src/demo.ts", startLine: 1, endLine: 20 },
      { path: "src/demo.ts", startLine: 21, endLine: 30 },
      { path: "src/demo.ts", startLine: 31, endLine: 40 },
    ]);
    const budget = 60;
    const outcome = await buildInlinePreviews(records, { projectRoot: root, budgetTokens: budget });
    assert.ok(outcome.usedTokens <= budget, `used ${outcome.usedTokens} > budget ${budget}`);
    assert.ok(outcome.previewed < records.length, "a tight budget must leave later refs out");
    assert.ok(outcome.note!.includes("skipped"));
    // The hard aggregate cap also holds when the caller passes a huge budget.
    const wide = await buildInlinePreviews(records, { projectRoot: root, budgetTokens: 999_999 });
    assert.ok(wide.usedTokens <= PREVIEW_BUDGET_TOKENS);
  });
});

test("long lines are trimmed inside previews", async () => {
  await withFixture(async (root) => {
    const fatLine = `const blob = "${"x".repeat(3000)}";`;
    await writeFile(join(root, "src", "fat.ts"), `${fatLine}\n${fatLine}\n`, "utf8");
    const registry = new RefRegistry();
    const [record] = recordsOf(registry, [{ path: "src/fat.ts", startLine: 1, endLine: 2 }]);
    const outcome = await buildInlinePreviews([record!], {
      projectRoot: root,
      maxPreviews: 1,
      maxLines: 2,
    });
    const text = outcome.previews.get(record!.ref)!;
    assert.ok(!text.includes("x".repeat(600)), "raw long-line content must be trimmed");
    assert.ok(text.includes("[truncated]"), "expected grep-style trim marker");
    assert.ok(outcome.usedTokens <= PREVIEW_BUDGET_TOKENS);
  });
});

test("paths outside the project root fail safe without leaking content", async () => {
  const outerDir = await mkdtemp(join(tmpdir(), "cr-outside-"));
  try {
    await withFixture(async (root) => {
      const secret = "TOP SECRET outside content";
      await writeFile(join(outerDir, "outside.txt"), secret, "utf8");
      const registry = new RefRegistry();
      const records = recordsOf(registry, [
        { path: "../outside.txt", startLine: 1, endLine: 2 },
        { path: join(outerDir, "outside.txt"), startLine: 1, endLine: 2 },
        { path: "src/missing.ts", startLine: 1, endLine: 3 },
      ]);
      const outcome = await buildInlinePreviews(records, { projectRoot: root });
      assert.equal(outcome.previews.size, 3);
      assert.equal(outcome.usedTokens, 0);
      assert.equal(outcome.previewed, 0);
      for (const text of outcome.previews.values()) {
        assert.ok(text.includes("(preview unavailable)"), text);
        assert.ok(!text.includes(secret));
      }
    });
  } finally {
    await rm(outerDir, { recursive: true, force: true });
  }
});

test("previewed exact window is cited by read_spans, wider spans still come through", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "demo.ts"), LONG_FILE, "utf8");
    const registry = new RefRegistry();
    const ledger = new SeenRangeLedger();
    const records = recordsOf(registry, [
      { path: "src/demo.ts", startLine: 10, endLine: 30 },
      { path: "src/demo.ts", startLine: 31, endLine: 34 },
    ]);
    const outcome = await buildInlinePreviews(records, {
      projectRoot: root,
      ledger,
      maxLines: 6,
      maxPreviews: 1, // only the first ref is previewed
    });

    // Exact window of the first preview: cited, not re-injected.
    const againExact = await executeReadSpans({
      refs: ["src/demo.ts:10-15"],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    assert.match(againExact.content[0]!.text, /already read/);
    assert.ok(!againExact.content[0]!.text.includes("line 11 of demo"));

    // The full span behind the same ref hashes differently -> full body.
    const full = await executeReadSpans({
      refs: [records[0]!.ref],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    const fullText = full.content[0]!.text;
    assert.match(fullText, /line 16 of demo/, "wider range must be injected in full");
    assert.doesNotMatch(fullText, /already read/);

    // The second ref was not in the top-K preview set -> full body as well.
    const other = await executeReadSpans({
      refs: [records[1]!.ref],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    assert.match(other.content[0]!.text, /line 31 of demo/);
  });
});

test("degraded code_search still returns previews and leaves read_spans whole-body intact", async () => {
  await withFixture(async (root) => {
    const body = ["export function validateSession() {", "  return watchToken();", "}", ""].join("\n");
    await writeFile(join(root, "src", "auth.ts"), body, "utf8");
    const registry = new RefRegistry();
    const ledger = new SeenRangeLedger();
    const result = await executeCodeSearch({
      query: "validateSession",
      mode: "exact",
      projectRoot: root,
      registry,
      excludeGlobs: [],
      sidecar: undefined, // no sidecar: exact layer degrades to rg/node
      ledger,
      tokenBudget: 4000,
    });
    assert.equal(result.details.degraded, true);
    assert.ok(result.details.hits.length > 0);
    const text = result.content[0]!.text;
    assert.match(text, /export function validateSession/, "degraded result carries inline preview");
    assert.match(text, /inline preview\(s\)/);

    // Full symbol bodies remain obtainable through read_spans after previews.
    const spans = await executeReadSpans({
      refs: [result.details.hits[0]!.ref],
      projectRoot: root,
      registry,
      ledger,
      tokenBudget: 4000,
    });
    assert.match(spans.content[0]!.text, /watchToken|validateSession/);
  });
});

test("formatCompressedContent renders previews under their ref lines and keeps metadata intact", () => {
  const registry = new RefRegistry();
  const hits = registry.assignAll([
    { path: "src/a.ts", startLine: 1, endLine: 9, symbol: "alpha", score: 2 },
    { path: "src/b.ts", startLine: 1, endLine: 4, score: 1 },
  ]);
  const previews = new Map([
    ["R1", "  1| fn alpha() {\n  2|   return;\n  … lines 3–9 not shown; read_spans R1"],
  ]);
  const text = formatCompressedContent(hits, undefined, previews);
  const lines = text.split("\n");
  const r1 = lines.findIndex((l) => l.startsWith("R1 "));
  const r2 = lines.findIndex((l) => l.startsWith("R2 "));
  const p1 = lines.findIndex((l) => l.includes("fn alpha()"));
  assert.ok(r1 >= 0 && r2 > r1 && p1 > r1 && p1 < r2, "preview belongs under its own ref line");
  assert.match(lines[r1]!, /score 2/);
  assert.match(lines[r1]!, /alpha\(\)/);
  assert.ok(!text.split("\n").some((l, i) => i > p1 && i < r2 && l.startsWith("R")), "no preview bleed into R2");
  // Without previews the output is byte-identical to before.
  const plain = formatCompressedContent(hits);
  assert.equal(plain.split("\n").length, 2);
  assert.match(plain, /^R1 src\/a\.ts:1-9 alpha\(\)/m);
});

test("unusable ranges degrade to the unavailable marker without crashing", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "empty.md"), "\n\n", "utf8");
    const registry = new RefRegistry();
    const records = recordsOf(registry, [
      { path: "src/empty.md", startLine: 7, endLine: 3 }, // inverted range
      { path: "src/empty.md", startLine: 99, endLine: 120 }, // past EOF
    ]);
    const outcome = await buildInlinePreviews(records, { projectRoot: root });
    assert.equal(outcome.usedTokens, 0);
    assert.equal(outcome.previewed, 0);
    assert.equal(outcome.previews.size, 2);
  });
});

test("ledger remembers exactly the raw shown window hash", async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "demo.ts"), LONG_FILE, "utf8");
    const registry = new RefRegistry();
    const ledger = new SeenRangeLedger();
    const [record] = recordsOf(registry, [{ path: "src/demo.ts", startLine: 10, endLine: 12 }]);
    await buildInlinePreviews([record!], { projectRoot: root, ledger, maxLines: 6 });
    assert.equal(ledger.size(), 1);

    // Simulate the exact hydration read_spans performs for the shown window.
    const fileText = LONG_FILE;
    const windowHash = hashContent(extractSpanText(fileText, 10, 12));
    assert.equal(
      ledger.has({ path: "src/demo.ts", startLine: 10, endLine: 12, contentHash: windowHash }),
      true,
    );
    // A merely different range stays unseen.
    assert.equal(
      ledger.has({ path: "src/demo.ts", startLine: 10, endLine: 40, contentHash: "x" }),
      false,
    );
  });
});

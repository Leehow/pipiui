/**
 * Real-surface repo_map test: import the compiled production implementation
 * (`dist/map-tool.js` executeRepoMap — shared by the registered tool and this
 * evaluator) and verify it renders bounded inline previews over a stubbed
 * symbol-layer hook and a fixture project. No separate evaluator renderer is
 * involved anywhere; if dist is stale or missing this fails loudly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(AGENT_DIR, "dist");

async function fixtureProject() {
  const root = await mkdtemp(join(tmpdir(), "retrieval-eval-mapfix-"));
  const src = join(root, "src");
  await mkdir(src, { recursive: true });
  const body = Array.from({ length: 14 }, (_, i) => `// line ${i + 1}`).join("\n");
  await writeFile(
    join(src, "a.ts"),
    `${body}\nexport function GOLD_ANCHOR_FOOTER() {}\n// tail\n`,
    "utf8",
  );
  return root;
}

test("repo_map renders previews through buildInlinePreviews + formatCompressedContent", async () => {
  if (!existsSync(join(DIST, "map-tool.js"))) {
    assert.fail("dist/map-tool.js missing — run 'npm run build:code-retrieval' in Electron/ first");
  }
  const { executeRepoMap } = await import(`${DIST}/map-tool.js`);
  const { setSymbolLayer } = await import(`${DIST}/index.js`);
  const { RefRegistry } = await import(`${DIST}/protocol.js`);
  const { SeenRangeLedger, hashContent, extractSpanText } = await import(`${DIST}/ledger.js`);
  const { readFileSync } = await import("node:fs");

  const root = await fixtureProject();
  setSymbolLayer({
    repoMap: async () => [
      { path: "src/a.ts", startLine: 10, endLine: 18 }, // 9-line span ⇒ truncated preview + note
    ],
  });

  const registry = new RefRegistry();
  const ledger = new SeenRangeLedger();
  const res = await executeRepoMap({ projectRoot: root, registry, ledger, tokenBudget: 4000 });

  assert.equal(res.details.kind, "code-retrieval.map");
  assert.equal(res.details.degraded, false);
  assert.ok(res.details.resultsPath.startsWith(".pi/agent/code-retrieval/results/"), "results persisted under the runtime home");

  const text = res.content?.[0]?.text ?? "";
  assert.match(text, /^R1 src\/a\.ts:10-18/m, "stable ref line preserved");
  const previewLines = text.split("\n").filter((l) => /^\s*\d+\|/.test(l));
  assert.ok(previewLines.length > 0 && previewLines.length <= 6, `preview ≤6 lines, got ${previewLines.length}`);
  assert.ok(text.includes("not shown") || text.includes("read_spans R1"), "truncated span points to read_spans");

  // Exact shown window is marked seen in the ledger (lines 10..15).
  const fileText = readFileSync(join(root, "src", "a.ts"), "utf8");
  const expectedHash = hashContent(extractSpanText(fileText, 10, 15));
  assert.ok(
    ledger.has({ path: "src/a.ts", startLine: 10, endLine: 15, contentHash: expectedHash }),
    "ledger marks exactly the shown window",
  );

  // A repeated map on the same registry keeps stable numbering going forward.
  const second = await executeRepoMap({ projectRoot: root, registry, ledger });
  assert.match(second.content?.[0]?.text ?? "", /R2 /, "registry continues R# sequence across calls");
});

test("vacant symbol hook degrades honestly (no fake renderer)", async () => {
  if (!existsSync(join(DIST, "map-tool.js"))) {
    assert.fail("dist/map-tool.js missing — run 'npm run build:code-retrieval' first");
  }
  const { executeRepoMap } = await import(`${DIST}/map-tool.js`);
  const { setSymbolLayer } = await import(`${DIST}/index.js`);
  setSymbolLayer({ repoMap: undefined });
  const res = await executeRepoMap({
    projectRoot: await fixtureProject(),
    registry: new (await import(`${DIST}/protocol.js`)).RefRegistry(),
  });
  assert.equal(res.details.degraded, true);
  assert.match(res.content?.[0]?.text ?? "", /not wired yet|hook vacant/i);
});

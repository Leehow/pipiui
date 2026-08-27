/**
 * Aggregate preview-budget regressions (third-review warnings):
 * - independent measurement must count the COMPLETE rendered preview block,
 *   including indented renderer truncation notes — not just numbered source
 *   lines — so omitted tokens can never hide behind the footer;
 * - legal resolved lower budgets ("~N/5") stay compatible, and a truncation
 *   line can deterministically push an otherwise-passing block over the cap.
 *
 * Parser/gates logic is pure. Token estimation imports the COMPILED production
 * estimator (same convention as map-tool.test.mjs) so measured numbers always
 * match what the shipped renderer bills; missing dist fails loudly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePreviewBlocks } from "../eval-lib/preview-parse.mjs";
import { independentAggregatePreviewViolations, PREVIEW_BUDGET_TOKENS } from "../eval-lib/gates.mjs";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(AGENT_DIR, "dist");

test("parser counts indented truncation notes as part of the rendered block", () => {
  const text = [
    "R12 src/a.ts:2-10 · hit",
    "  2| first source",
    "  3| second source",
    "  … lines 4–10 not shown; read_spans R12 for the full span",
    "",
    "- next top-level item ends the block",
  ].join("\n");
  const block = parsePreviewBlocks(text).get("R12");
  assert.ok(block, "block parsed");
  assert.equal(block.srcLines.length, 2, "numbered source lines unchanged");
  assert.ok(
    block.text.includes("… lines 4–10 not shown"),
    "indented truncation note must be inside measured text",
  );
});

test("a truncation line pushes an otherwise-passing block over the aggregate cap", async () => {
  if (!existsSync(join(DIST, "settings.js"))) {
    assert.fail("dist/settings.js missing — run 'npm run build:code-retrieval' in Electron/ first");
  }
  const { estimateTokens } = await import(`${DIST}/settings.js`);

  // Numbered source lines alone stay comfortably under the cap…
  const numberedOnly =
    "R1 src/big.ts:1-3 · hit\n" +
    Array.from({ length: 4 }, (_, i) => `  ${i + 1}| x${i}`).join("\n");
  const numberedText = parsePreviewBlocks(numberedOnly).get("R1").text;
  assert.ok(estimateTokens(numberedOnly) <= PREVIEW_BUDGET_TOKENS);
  assert.ok(estimateTokens(numberedText) <= PREVIEW_BUDGET_TOKENS);

  // …while the renderer's indented truncation note is part of what it bills;
  // padding it past the cap must flip the independently measured verdict.
  const padChars = (PREVIEW_BUDGET_TOKENS + 8) * 4; // chars/4 ⇒ strictly > cap
  const overflowing = `${numberedOnly}\n  … ${"x".repeat(padChars)}\n`;
  const fullText = parsePreviewBlocks(overflowing).get("R1").text;
  const tokens = estimateTokens(fullText);
  assert.ok(tokens > PREVIEW_BUDGET_TOKENS);

  const violations = independentAggregatePreviewViolations({
    blockTokens: [tokens],
    footerUsed: Math.min(tokens, PREVIEW_BUDGET_TOKENS),
    footerDenominator: PREVIEW_BUDGET_TOKENS,
  });
  assert.ok(
    violations.some((m) => m.includes("aggregate") && m.includes(String(tokens))),
    violations.join("; "),
  );
});

test("complete-block sums feed the declared lower effective cap too", () => {
  // Each small block is fine alone; only full-block counting catches that the
  // pair overruns the self-declared 800-token budget.
  const v = independentAggregatePreviewViolations({
    blockTokens: [450, 450],
    footerUsed: 900,
    footerDenominator: 800,
  });
  assert.ok(v.some((m) => m.includes("legal 800-token effective cap")), v.join("; "));
});

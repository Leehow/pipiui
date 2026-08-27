/**
 * Bounded inline source previews for ranked retrieval results (plan `inline-previews`).
 *
 * A code_search / code_nav result carries enough compressed metadata to rank, but the
 * model still had to pay a second call before it could reject or choose a hit. This
 * module renders a few real source lines under the top refs — top 3 by default, a
 * handful of lines each, under a strict aggregate preview budget that always sits
 * below ext.code-retrieval.tokenBudget so it can never crowd out read_spans bodies.
 *
 * Invariants pinned by previews.test.ts:
 * - R# refs, path/line/symbol/score metadata and results persistence are untouched;
 *   previews decorate the ref lines, they never replace them.
 * - Only the exact shown window is remembered in the seen-range ledger, hashed over
 *   the raw (untrimmed) span text exactly like read_spans hydrates spans. A later
 *   read_spans of that exact range is cited instead of re-injected; anything wider
 *   (a full symbol body, an expanded range) hashes differently and stays fully
 *   obtainable.
 * - Preview reads use the same project-root containment as read_spans and fail safe:
 *   an unreadable or escaping path renders a one-line "(preview unavailable)" marker,
 *   never an error and never content from outside the project root.
 */

import { readFile } from "node:fs/promises";
import { extractSpanText, hashContent, type SeenRangeLedger } from "./ledger.js";
import { numberLines, resolveProjectFile } from "./read-spans.js";
import { estimateTokens } from "./settings.js";
import { truncateLine } from "./truncate.js";

export const PREVIEW_MAX_PREVIEWS = 3;
export const PREVIEW_MAX_LINES = 6;
/** Strict aggregate cap; must stay well under DEFAULT_TOKEN_BUDGET (4000). */
export const PREVIEW_BUDGET_TOKENS = 1000;

const UNAVAILABLE = "(preview unavailable)";

export type PreviewRecord = {
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
};

export type PreviewOptions = {
  projectRoot: string;
  /** Session ledger; when given, the exact shown window is marked as seen. */
  ledger?: SeenRangeLedger;
  maxPreviews?: number;
  maxLines?: number;
  budgetTokens?: number;
};

export type PreviewOutcome = {
  /** ref → rendered multi-line block, only for refs that carry a preview. */
  previews: Map<string, string>;
  previewed: number;
  usedTokens: number;
  /** One-line summary for the tool output footer, when any preview was attempted. */
  note?: string;
};

export function emptyPreviewOutcome(): PreviewOutcome {
  return { previews: new Map(), previewed: 0, usedTokens: 0 };
}

export async function buildInlinePreviews(
  records: readonly PreviewRecord[],
  opts: PreviewOptions,
): Promise<PreviewOutcome> {
  try {
    return await renderPreviews(records, opts);
  } catch {
    // Previews must never fail the retrieval call that hosts them.
    return emptyPreviewOutcome();
  }
}

async function renderPreviews(
  records: readonly PreviewRecord[],
  opts: PreviewOptions,
): Promise<PreviewOutcome> {
  if (!Array.isArray(records) || records.length === 0) return emptyPreviewOutcome();

  const maxPreviews = clampPositive(opts.maxPreviews, PREVIEW_MAX_PREVIEWS);
  const maxLines = clampPositive(opts.maxLines, PREVIEW_MAX_LINES);
  const budget = Math.min(
    clampPositive(opts.budgetTokens, PREVIEW_BUDGET_TOKENS),
    PREVIEW_BUDGET_TOKENS,
  );

  const previews = new Map<string, string>();
  let used = 0;
  let skippedForBudget = 0;
  const candidates = records.slice(0, Math.min(maxPreviews, records.length));

  for (let i = 0; i < candidates.length; i++) {
    const record = candidates[i]!;
    if (used >= budget) {
      skippedForBudget += candidates.length - i;
      break;
    }
    const fileText = await readProjectText(opts.projectRoot, record.path);
    if (fileText === undefined || !isSaneRange(record)) {
      previews.set(record.ref, UNAVAILABLE); // no token cost, keep going
      continue;
    }

    const rawSpan = extractSpanText(fileText, record.startLine, record.endLine);
    if (!rawSpan.trim()) {
      previews.set(record.ref, UNAVAILABLE);
      continue;
    }

    const totalLines = rawSpan.split("\n").length;
    const shownCount = Math.min(maxLines, totalLines);
    const block = renderBlock(rawSpan, record.startLine, shownCount, {
      partial: shownCount < totalLines,
      endLine: record.endLine,
      ref: record.ref,
    });

    const tokens = estimateTokens(block.text);
    if (used + tokens > budget) {
      // Ranked order: once a hit does not fit, its tail is worth even less.
      skippedForBudget += candidates.length - i;
      break;
    }

    previews.set(record.ref, block.text);
    used += tokens;
    // Mark only what was actually shown, hashed over raw text exactly like
    // read_spans does — wider reads stay "not seen" and remain obtainable.
    opts.ledger?.remember(
      record.path,
      record.startLine,
      record.startLine + shownCount - 1,
      hashContent(extractSpanText(fileText, record.startLine, record.startLine + shownCount - 1)),
    );
  }

  const note =
    records.length === 0
      ? undefined
      : `${previews.size - countUnavailable(previews)} inline preview(s) of ${records.length} hits · ~${used}/${budget} preview tokens${skippedForBudget > 0 ? ` (${skippedForBudget} skipped)` : ""} · read_spans R# pulls full spans`;
  return { previews, previewed: previews.size - countUnavailable(previews), usedTokens: used, note };
}

function renderBlock(
  rawSpan: string,
  startLine: number,
  shownCount: number,
  ctx: { partial: boolean; endLine: number; ref: string },
): { text: string } {
  const lines = rawSpan.split("\n").slice(0, shownCount).map((line) => truncateLine(line).text);
  let text = indent(numberLines(lines.join("\n"), startLine));
  if (ctx.partial) {
    text +=
      `\n  … lines ${startLine + shownCount - 1}–${ctx.endLine} not shown; ` +
      `read_spans ${ctx.ref} for the full span`;
  }
  return { text };
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

async function readProjectText(projectRoot: string, rawPath: string): Promise<string | undefined> {
  const abs = await resolveProjectFile(projectRoot, rawPath);
  if (!abs) return undefined;
  try {
    const text = await readFile(abs, "utf8");
    if (text.includes("\0")) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function isSaneRange(record: PreviewRecord): boolean {
  return (
    Number.isFinite(record.startLine) &&
    Number.isFinite(record.endLine) &&
    record.startLine >= 1 &&
    record.endLine >= record.startLine
  );
}

function countUnavailable(previews: Map<string, string>): number {
  let n = 0;
  for (const text of previews.values()) if (text === UNAVAILABLE) n++;
  return n;
}

function clampPositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * repo_map tool implementation, shared by the registered tool and the
 * evaluator: one code path assigns stable R# refs and renders the approved
 * bounded inline previews under the top refs. Import dist/map-tool.js to
 * exercise exactly what the model sees — never re-render it separately.
 */

import { getSymbolLayer } from "./hooks.js";
import type { SeenRangeLedger } from "./ledger.js";
import { buildInlinePreviews } from "./previews.js";
import { buildToolResult, emptyDegraded, formatCompressedContent, type RefRegistry } from "./protocol.js";
import { loadRetrievalSettings } from "./settings.js";
import { ensureTreeSitter } from "./warmup.js";
import type { ToolResult } from "./types.js";

export type RepoMapArgs = {
  projectRoot: string;
  registry: RefRegistry;
  /** Session seen-range ledger; previewed exact windows are marked as seen. */
  ledger?: SeenRangeLedger;
  /** Map token budget override (defaults to ext.code-retrieval.tokenBudget). */
  tokenBudget?: number;
};

export async function executeRepoMap(args: RepoMapArgs): Promise<ToolResult> {
  try {
    await ensureTreeSitter();
    const impl = getSymbolLayer().repoMap;
    if (!impl) {
      return emptyDegraded(
        "code-retrieval.map",
        "repo_map symbol extractor is not wired yet (hook vacant). Use grep / ls.",
      );
    }
    const settings = await loadRetrievalSettings(args.projectRoot);
    const budget = args.tokenBudget ?? settings.tokenBudget;
    const hits = await impl({
      tokenBudget: budget,
      projectRoot: args.projectRoot,
    });
    const assigned = args.registry.assignAll(hits);
    // Same preview renderer as code_search / code_nav: top-3 refs, ≤6 lines
    // each, strict aggregate cap — bounded by the caller's RESOLVED tokenBudget
    // override (explicit low budgets must win), falling back to settings.
    const previews = await buildInlinePreviews(assigned, {
      projectRoot: args.projectRoot,
      ledger: args.ledger,
      budgetTokens: budget,
    });
    return buildToolResult({
      projectRoot: args.projectRoot,
      kind: "code-retrieval.map",
      hits: assigned,
      degraded: false,
      content: formatCompressedContent(assigned, previews.note, previews.previews),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyDegraded("code-retrieval.map", `repo_map failed: ${message}. Use grep / ls.`);
  }
}

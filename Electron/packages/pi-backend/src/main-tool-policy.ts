/**
 * Main-session (Boss) tool policy.
 *
 * This module used to withhold `bash`, `edit` and `write` from the main session, so that the
 * orchestration layer's "you do not work the floor" rule was structural rather than
 * persuasive. That rule is gone: the Boss now owns the mainline and implements it, and the
 * roles it delegates are the ones that would pull it off that line. A Boss that cannot edit
 * cannot hold a mainline — it can only describe one to somebody else, which is exactly the
 * hand-off where intent used to be lost.
 *
 * What replaced the withholding is not a weaker version of it. Drift was the real thing the
 * old policy was buying protection from, and a tool denylist never addressed it; it only
 * moved the drift into a worker nobody reviewed. The mainline layer (`25-mainline.md`) buys
 * it directly: a durable plan record, countable re-anchor triggers, and a hard rule that
 * discovered work is never done inline. Those are in the philosophy because they are
 * judgement, and judgement is not something an argv flag can express.
 *
 * So what remains here is only what was always orthogonal to that argument: the user's own
 * Settings → 工具开关 denylist, and the native-search filter.
 *
 * Generic `web_search` is excluded when the selected model has effective native
 * `web_search` (declared `nativeSearch` or the search slice of `hostedTools`). That
 * decision is capability-driven — see `hidesGenericWebSearch` — never a provider-name
 * branch at this seam.
 *
 * Scope: this governs the main pi process only. Dispatched workers assemble their own tool
 * selection from their agent definition (`resolveSubagentToolSelection`) and never inherit
 * this process's argv.
 */

import { extraExcludedGenericSearchTools, type NativeSearchModelRef } from "./generic-search-filter.js";

/**
 * Controlled by the global Computer Use toggle alone, exactly as on the worker side. The
 * main session never registers these directly, so naming them here could only produce a
 * confusing denylist entry for a tool that was never mounted.
 */
const RESERVED_DESKTOP_TOOL_NAMES = new Set(["computer", "open_application"]);

/** Settings still store the browser group id; it expands to the tools driven by the built-in
 * browser surface, including the bridge-backed browser_search/browser_fetch route. */
const BROWSER_GROUP_ID = "browser_*";
const BROWSER_TOOL_NAMES = ["browser", "browser_search", "browser_fetch"];

export interface MainToolPolicyInput {
  /** The user's own Settings → 工具开关 denylist, as stored (group ids allowed). */
  disabledToolNames?: readonly string[];
  /** Selected session model; used only for native-search tool-list filtering. */
  model?: NativeSearchModelRef;
}

/**
 * The main session's effective `--exclude-tools` names: the user's denylist expanded and
 * sanitized, plus the native-search filter. Unique and sorted so the spawn argv is stable
 * across launches and cannot invalidate the prompt cache by ordering.
 */
export function resolveMainSessionExcludedTools(input: MainToolPolicyInput = {}): string[] {
  const names = new Set<string>();
  for (const name of input.disabledToolNames ?? []) {
    if (typeof name !== "string" || !name.trim()) continue;
    if (name === BROWSER_GROUP_ID) { for (const tool of BROWSER_TOOL_NAMES) names.add(tool); continue; }
    names.add(name);
  }
  for (const name of extraExcludedGenericSearchTools(input.model)) names.add(name);
  for (const reserved of RESERVED_DESKTOP_TOOL_NAMES) names.delete(reserved);
  return [...names].sort();
}

/** The same policy as CLI arguments. Empty when nothing is excluded — pi rejects an empty list. */
export function mainSessionExcludeToolArgs(input: MainToolPolicyInput = {}): string[] {
  const names = resolveMainSessionExcludedTools(input);
  return names.length ? ["--exclude-tools", names.join(",")] : [];
}

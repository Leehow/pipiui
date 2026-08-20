/**
 * Main-session (Boss) tool policy.
 *
 * The orchestration philosophy layer already tells the Boss not to work the floor, but a
 * prompt rule is advice. A model that decides the remaining change is "one line" edits the
 * file itself, and nothing in the runtime stops it. This module makes that boundary
 * structural instead of persuasive.
 *
 * The cut is by verb, not by role. The Boss keeps every read it needs to size a goal,
 * spot-check a worker, and own the completion decision: `read`, `grep`, `find`, `ls`, the
 * read-only `git` tool, web access, the browser, and the subagent/status channel. It loses
 * exactly the tools that mutate the machine.
 *
 * `bash` is on that list for the same reason as `edit` and `write`. Denying the two file
 * tools while leaving a shell is theatre — `sed -i`, a heredoc, `git commit` and `rm` all
 * reach the same disk. The Boss's legitimate shell needs are already served by narrower
 * channels: the `git` extension for status/diff/log/show, and the dispatch runtime's
 * attested `verify`, whose exit code is stronger evidence than a command the Boss ran and
 * then summarized for itself.
 *
 * The two writes the Boss legitimately owns are served by narrow subagent-extension tools
 * rather than by restoring `write`, and both are strictly narrower than the tool they
 * replace: `ledger_note` reaches only `.pi/boss/**` (the Decisions / Done / Risks half of its
 * own ledger), and `context_doc` reaches only `.pi/context/**` (the shared briefing workers
 * read so it is not retyped into every brief). Because this policy is a denylist of mutation
 * verbs, neither needs an entry here — but neither may be added to the mutation set either,
 * which `main-tool-policy.test.ts` pins.
 *
 * Scope: this governs the main pi process only. Dispatched workers assemble their own tool
 * selection from their agent definition (`resolveSubagentToolSelection`) and never inherit
 * this process's argv, so a read-only Boss still commands fully capable workers.
 */

/**
 * Tools removed from the main session when the Boss is read-only. Every entry is a
 * mutation path; nothing here is needed to observe state.
 */
export const BOSS_MUTATION_TOOL_NAMES: readonly string[] = Object.freeze(["bash", "edit", "write"]);

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
  /** False restores the legacy fully-capable main session. */
  bossReadOnly?: boolean;
  /** The user's own Settings → 工具开关 denylist, as stored (group ids allowed). */
  disabledToolNames?: readonly string[];
}

/**
 * The main session's effective `--exclude-tools` names: the user's denylist expanded and
 * sanitized, plus the mutation set when the Boss is read-only. Unique and sorted so the
 * spawn argv is stable across launches and cannot invalidate the prompt cache by ordering.
 */
export function resolveMainSessionExcludedTools(input: MainToolPolicyInput = {}): string[] {
  const names = new Set<string>();
  for (const name of input.disabledToolNames ?? []) {
    if (typeof name !== "string" || !name.trim()) continue;
    if (name === BROWSER_GROUP_ID) { for (const tool of BROWSER_TOOL_NAMES) names.add(tool); continue; }
    names.add(name);
  }
  if (input.bossReadOnly) for (const name of BOSS_MUTATION_TOOL_NAMES) names.add(name);
  for (const reserved of RESERVED_DESKTOP_TOOL_NAMES) names.delete(reserved);
  return [...names].sort();
}

/** The same policy as CLI arguments. Empty when nothing is excluded — pi rejects an empty list. */
export function mainSessionExcludeToolArgs(input: MainToolPolicyInput = {}): string[] {
  const names = resolveMainSessionExcludedTools(input);
  return names.length ? ["--exclude-tools", names.join(",")] : [];
}

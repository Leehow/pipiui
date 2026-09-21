/**
 * PipiUI mount for the vendored pi-autoresearch extension.
 *
 * Upstream ships its three tools behind a mode gate: `autoresearchMode` starts false and only
 * `setAutoresearchMode` puts `init_experiment` / `run_experiment` / `log_experiment` into the
 * active tool set. Upstream does that when the user runs `/autoresearch <goal>` or when a project
 * already carries `.auto/log.jsonl`. PipiUI wants the capability reachable from plain language
 * ("帮我研究/循环优化 X") instead of a command the user has to know, so this file activates
 * upstream unchanged and then exposes those three names at session start.
 *
 * Upstream's gate keeps owning every later transition: its `/autoresearch off` (and the
 * reconstruction path that replays a recorded decision) calls `setAutoresearchMode(false)`, which
 * removes the names again. An explicit off is replayed before this handler runs, so the record is
 * checked here too and the tools are left off — a user who turned the loop off keeps it off.
 *
 * The vendored tree stays byte-identical to the npm tarball: this is a PipiUI-side composition,
 * never an edit inside `vendor/`.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import upstream from "../vendor/pi-autoresearch/extensions/pi-autoresearch/index.ts";

/** Upstream's gated tool names (vendor index.ts `registerGatedTool` call sites). */
export const AUTORESEARCH_TOOL_NAMES: readonly string[] = ["init_experiment", "run_experiment", "log_experiment"];

/** Upstream's custom entry type for its mode decision (vendor index.ts `AUTORESEARCH_ACTIVATION_ENTRY`). */
export const AUTORESEARCH_ACTIVATION_ENTRY = "pi-autoresearch.activation";

/**
 * Names the spawn explicitly excluded (Settings → 工具开关, or the Boss read-only policy).
 * `setActiveTools` replaces the whole set without consulting that policy, so re-adding an
 * excluded name would silently override the user's own denylist.
 */
function excludedBySpawn(name: string): boolean {
  const argv = process.argv;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--exclude-tools" && argv[index] !== "-xt") continue;
    if ((argv[index + 1] ?? "").split(",").some(entry => entry.trim() === name)) return true;
  }
  return false;
}

/** True when the newest recorded mode decision in this session is an explicit off. */
export function explicitlyTurnedOff(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  let decision: boolean | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.customType !== AUTORESEARCH_ACTIVATION_ENTRY) continue;
    const active = (entry.data as { active?: unknown } | undefined)?.active;
    if (typeof active === "boolean") decision = active;
  }
  return decision === false;
}

export default function autoresearchWithDefaultTools(pi: ExtensionAPI): void {
  upstream(pi);
  pi.on("session_start", (_event, ctx) => {
    if (explicitlyTurnedOff(ctx)) return;
    const active = new Set(pi.getActiveTools());
    for (const name of AUTORESEARCH_TOOL_NAMES) if (!excludedBySpawn(name)) active.add(name);
    pi.setActiveTools([...active]);
  });
}

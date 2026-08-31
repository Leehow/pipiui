/**
 * Worker-side prompt observability. Registers no tool and rewrites nothing.
 *
 * A dispatched worker is its own pi process: it mounts `--no-extensions` plus an explicit
 * list, and `pipiui-runtime-info` is deliberately not on that list — that extension registers
 * a tool, and a worker's tool set is a curated allowlist, not a place to add one for
 * debugging. So the main session could answer "what is actually in my system prompt?" and a
 * worker could not, which is the half that matters: a worker's prompt is assembled by a
 * different code path (the subagent builds its argv itself), so it is exactly the half where
 * the base prompt or a philosophy layer can go missing without anyone noticing.
 *
 * This mounts last in the worker, so `before_agent_start` — which pi chains through
 * extensions in mount order — hands it the finished prompt.
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { promptProvenance } from "./pipiui-prompt-provenance.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Absolute file this run reports into. The dispatcher owns the name; absent means disabled. */
const OUTPUT_FILE = process.env.PIPIUI_PROMPT_DEBUG_FILE;
/**
 * Identity of the process being observed, read once beside `OUTPUT_FILE`.
 *
 * All of it is fixed for the lifetime of a dispatched child, so re-reading `process.env` on
 * every turn would only invite the two halves to disagree about when the environment is
 * authoritative.
 */
const IDENTITY = {
  role: process.env.PIPI_PHILOSOPHY_ROLE ?? "worker",
  agent: process.env.PIPI_PHILOSOPHY_AGENT ?? null,
  agentId: process.env.PIPIUI_AGENT_ID ?? null,
  depth: Number(process.env.PIPIUI_AGENT_DEPTH ?? "0"),
} as const;
/** Bounded retention, so a long boss session cannot turn debug output into unbounded growth. */
const MAX_RETAINED = 200;

/**
 * Keep the newest `MAX_RETAINED` reports and drop the rest.
 *
 * Runs after the write rather than before it: this file is the record of a dispatch that
 * already happened, and losing the newest one to make room would defeat the point.
 */
function sweep(dir: string): void {
  try {
    const entries = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return { name, at: statSync(join(dir, name)).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { name: string; at: number } => entry !== undefined)
      .sort((a, b) => b.at - a.at);
    for (const entry of entries.slice(MAX_RETAINED)) {
      rmSync(join(dir, entry.name), { force: true });
    }
  } catch {
    // Housekeeping only.
  }
}

export default function (pi: ExtensionAPI) {
  if (!OUTPUT_FILE) return;
  let lastDigest = "";

  pi.on("before_agent_start", (event, ctx) => {
    try {
      const provenance = promptProvenance(event.systemPrompt);
      // A worker's prompt is stable across its turns unless something recomposed it. Writing
      // only on change keeps a long resident worker from rewriting the same bytes each turn,
      // and makes a mid-run change visible as an actual new write.
      if (provenance.sha256 === lastDigest) return;
      lastDigest = provenance.sha256;
      const dir = dirname(OUTPUT_FILE);
      mkdirSync(dir, { recursive: true });
      const record = {
        version: 1 as const,
        ...IDENTITY,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        systemPrompt: provenance,
        capturedAt: Date.now(),
      };
      // Atomic replace: the dispatcher may read this while the worker is still running, and a
      // half-written report would be indistinguishable from a worker that never started.
      const staging = join(dir, `.${basename(OUTPUT_FILE)}.${process.pid}.tmp`);
      writeFileSync(staging, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
      renameSync(staging, OUTPUT_FILE);
      sweep(dir);
    } catch {
      // Observability must never take a dispatch down.
    }
  });
}

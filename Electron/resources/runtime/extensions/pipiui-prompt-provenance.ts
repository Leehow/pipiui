import { createHash } from "node:crypto";

/**
 * Who is in an assembled system prompt, and how much of it each contributor owns.
 *
 * Shared because two processes need the same answer in the same shape: the main session
 * collects it in `pipiui-runtime-info`, and a dispatched worker — a separate pi process that
 * mounts no tools it was not given — collects it in `pipiui-prompt-observer`. A second copy
 * of the marker table would drift, and the whole point is that a worker's prompt can be
 * compared against the main session's.
 *
 * Side-effect free and dependency-light on purpose: a worker loads it for this function
 * alone, so it must not drag a tool registration or a host contract in behind it.
 */
export type PromptSegment = { id: string; chars: number };
export type PromptProvenance = {
  chars: number;
  estimatedTokens: number;
  sha256: string;
  segments: PromptSegment[];
};

/**
 * Markers that identify who contributed a stretch of the assembled system prompt.
 *
 * Each is a literal a contributor already emits for its own reasons — the base prompt's
 * version comment, philosophy's idempotence marker, Pi's project-context and skills wrappers
 * — so nothing here asks a contributor to cooperate, and a contributor that stops emitting
 * its marker shows up as a missing segment rather than as silence.
 */
const PROMPT_MARKERS: readonly { id: string; marker: string }[] = [
  { id: "pipiui-base", marker: "<!-- pipiui-system-base" },
  { id: "philosophy", marker: "<!-- pipi-philosophy -->" },
  { id: "project-context", marker: "<project_context>" },
  { id: "skills", marker: "<available_skills>" },
];

/**
 * Who is in this session's system prompt, and how much of it each owns.
 *
 * Sizes and a digest rather than the text: the question this answers is "did the locked base
 * actually land, what else is in there, and how big is each part", which provenance settles
 * while the bodies are already readable on disk. It also keeps a prompt that carries project
 * instructions out of a second file.
 *
 * Everything before the first known marker is Pi's own frame (identity, tool list, tool
 * guidelines), which carries no marker of its own.
 */
export function promptProvenance(prompt: string): PromptProvenance {
  const found = PROMPT_MARKERS
    .map(({ id, marker }) => ({ id, at: prompt.indexOf(marker) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);
  const bounds = [...found.map((entry) => entry.at), prompt.length];
  const segments: PromptSegment[] = [];
  if (bounds[0] > 0) segments.push({ id: "pi-frame", chars: bounds[0] });
  found.forEach((entry, index) => {
    segments.push({ id: entry.id, chars: bounds[index + 1] - entry.at });
  });
  return {
    chars: prompt.length,
    estimatedTokens: Math.round(prompt.length / 4),
    sha256: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
    segments,
  };
}

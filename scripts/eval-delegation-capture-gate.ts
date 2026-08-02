/**
 * Evaluation-only capture gate.
 *
 * This extension does not replace or mock `subagent`: the real project extension
 * remains registered and its exact schema is presented to the boss model. It
 * blocks execution only after pi has finalized the whole assistant tool-call
 * wave, so the runner can record shape without spawning workers.
 */
export default function (pi: any) {
  pi.on("tool_call", (event: any) => {
    if (process.env.PIPIUI_DELEGATION_EVAL_CAPTURE !== "1") return;
    if (event.toolName !== "subagent") return;
    return {
      block: true,
      reason: "Delegation evaluation capture gate: recorded the dispatch wave; do not execute workers.",
    };
  });
}

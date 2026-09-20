/**
 * B/C consumer surface for later tickets.
 * Baseline A and production-path A/B(/authorized synthetic C) contrast are separate runners.
 */
export { SCHEMA_VERSION, OBSERVATION_CASES, TASK_DEFINITIONS, BASELINE_GROUP, UNEVALUATED_GROUPS } from "./fixtures.mjs";
export {
  CONTROLLER_PATH,
  loadControllerSource,
  loadJsdom,
  createSession,
  resetSession,
  destroySession,
  dispatchObserve,
  dispatchAction,
  evalDispatch,
  querySelectorDeep,
  resolveShownNodes,
} from "./harness.mjs";
export {
  scoreObservation,
  evaluateRequiredInfo,
  estimateOutputTokens,
  observationStats,
  classifyCaseStatus,
} from "./score.mjs";
export { runBaseline, parseArgs, main } from "./run-browser-observation-eval.mjs";
export { runContrast } from "./run-browser-observation-contrast.mjs";

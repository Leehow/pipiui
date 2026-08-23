import { join } from "node:path";

export const EXTENSION_ID = "code-retrieval";

export function projectAgentDir(projectRoot: string): string {
  return join(projectRoot, ".pi", "agent");
}

export function retrievalHome(projectRoot: string): string {
  return join(projectAgentDir(projectRoot), EXTENSION_ID);
}

export function sidecarJsonPath(projectRoot: string): string {
  return join(retrievalHome(projectRoot), "sidecar.json");
}

export function sidecarLockPath(projectRoot: string): string {
  return join(retrievalHome(projectRoot), "sidecar.lock");
}

export function resultsDir(projectRoot: string): string {
  return join(retrievalHome(projectRoot), "results");
}

export function extSettingsPath(projectRoot: string): string {
  return join(projectAgentDir(projectRoot), "ext-settings", `${EXTENSION_ID}.json`);
}

/** Relative (project-rooted) path used in details.resultsPath. */
export function resultsRelPath(hash: string): string {
  return `.pi/agent/${EXTENSION_ID}/results/${hash}.jsonl`;
}

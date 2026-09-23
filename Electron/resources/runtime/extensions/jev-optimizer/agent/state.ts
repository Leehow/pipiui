import { readFile } from "node:fs/promises";
import { API_KEY_ENV, GENERATION_ENV, STATE_FILE_ENV } from "./protocol.js";
import type { AvailabilityResult, JevDeps, JevHostState } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function envValue(
  env: NodeJS.Dict<string | undefined> | undefined,
  key: string,
): string {
  const raw = env?.[key];
  return typeof raw === "string" ? raw.trim() : "";
}

export function parseHostState(raw: string): JevHostState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.schemaVersion !== 1) return undefined;
  if (typeof parsed.enabled !== "boolean") return undefined;
  if (typeof parsed.hasKey !== "boolean") return undefined;
  if (typeof parsed.generation !== "string" || parsed.generation.length === 0) return undefined;
  return {
    schemaVersion: 1,
    enabled: parsed.enabled,
    hasKey: parsed.hasKey,
    generation: parsed.generation,
    browserEnabled: parsed.browserEnabled === true,
    computerEnabled: parsed.computerEnabled === true,
    computerUseEnabled: parsed.computerUseEnabled === true,
    computerGeneration: typeof parsed.computerGeneration === "string" && parsed.computerGeneration.trim()
      ? parsed.computerGeneration : undefined,
    contextEnabled: parsed.contextEnabled === true,
    browserGeneration: typeof parsed.browserGeneration === "string" && parsed.browserGeneration
      ? parsed.browserGeneration : undefined,
  };
}

export async function defaultReadState(path: string, signal?: AbortSignal): Promise<string> {
  return readFile(path, { encoding: "utf8", signal });
}

export async function loadHostState(
  deps: JevDeps,
  signal?: AbortSignal,
): Promise<{ state?: JevHostState; reason?: string; filePath: string }> {
  const env = deps.env ?? process.env;
  const filePath = envValue(env, STATE_FILE_ENV);
  if (!filePath) return { reason: "no-state", filePath: "" };
  const read = deps.readState ?? defaultReadState;
  try {
    const raw = await read(filePath, signal);
    const state = parseHostState(raw);
    if (!state) return { reason: "state-invalid", filePath };
    return { state, filePath };
  } catch {
    return { reason: "state-invalid", filePath };
  }
}

export function evaluateReadiness(
  state: JevHostState | undefined,
  env: NodeJS.Dict<string | undefined> | undefined,
  loadReason?: string,
): AvailabilityResult & { apiKey?: string } {
  if (!state) return { ready: false, reason: loadReason ?? "no-state" };
  const expected = envValue(env, GENERATION_ENV);
  if (!expected || expected !== state.generation) {
    return { ready: false, reason: "generation-mismatch" };
  }
  if (!state.enabled) return { ready: false, reason: "disabled" };
  const apiKey = envValue(env, API_KEY_ENV);
  if (!state.hasKey || !apiKey) return { ready: false, reason: "no-key" };
  return { ready: true, apiKey };
}

export async function checkBrowserAvailability(
  deps: JevDeps,
  signal?: AbortSignal,
): Promise<AvailabilityResult & { apiKey?: string; browserGeneration?: string }> {
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  if (!envValue(deps.env ?? process.env, API_KEY_ENV)) return { ready: false, reason: "no-key" };
  const loaded = await loadHostState(deps, signal);
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  const code = evaluateReadiness(loaded.state, deps.env ?? process.env, loaded.reason);
  if (!code.ready) return code;
  if (!loaded.state?.browserEnabled || !loaded.state.browserGeneration) {
    return { ready: false, reason: "browser-disabled" };
  }
  return { ...code, browserGeneration: loaded.state.browserGeneration };
}

export async function checkComputerAvailability(
  deps: JevDeps,
  signal?: AbortSignal,
): Promise<AvailabilityResult & { apiKey?: string; computerGeneration?: string }> {
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  if (!envValue(deps.env ?? process.env, API_KEY_ENV)) return { ready: false, reason: "no-key" };
  const loaded = await loadHostState(deps, signal);
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  const ready = evaluateReadiness(loaded.state, deps.env ?? process.env, loaded.reason);
  if (!ready.ready) return ready;
  if (loaded.state?.computerUseEnabled !== true) return { ready: false, reason: "computer-execution-disabled" };
  if (!loaded.state.computerEnabled || !loaded.state.computerGeneration) {
    return { ready: false, reason: "computer-disabled" };
  }
  return { ...ready, computerGeneration: loaded.state.computerGeneration };
}

export async function checkAvailability(
  deps: JevDeps,
  signal?: AbortSignal,
): Promise<AvailabilityResult & { apiKey?: string }> {
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  const loaded = await loadHostState(deps, signal);
  if (signal?.aborted) return { ready: false, reason: "aborted" };
  return evaluateReadiness(loaded.state, deps.env ?? process.env, loaded.reason);
}

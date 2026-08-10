/** Stable public barrel for the portable subagent-host v1 API. */

/** Public surface version. Contract envelopes continue to use schemaVersion: 1. */
export const SUBAGENT_HOST_VERSION = 1 as const;

export * from "./contract.ts";
export * from "./env.ts";
export * from "./server.ts";
export * from "./state/index.ts";
export * from "./worktree/index.ts";
export * from "./runtime.ts";
export * from "./electron-main.ts";

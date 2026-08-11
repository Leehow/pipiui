/** Transport constants shared by the loopback server and zero-backend clients. */
export const MEMORY_BROKER_HTTP_VERSION = 1 as const;
export const MEMORY_BROKER_PATH = "/v1/memory";
export const MEMORY_BROKER_TIMEOUT_MS = 3_000;
export const MEMORY_BROKER_MAX_REQUEST_BYTES = 32 * 1024;
export const MEMORY_BROKER_MAX_RESPONSE_BYTES = 24 * 1024;

export type MemoryBrokerMode = "main" | "worker" | "operator";

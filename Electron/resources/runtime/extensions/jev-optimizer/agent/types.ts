/** Structural rerank contract. Do not import code-retrieval. */

export type RerankCandidate = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  text: string;
};

export type RerankInput = {
  query: string;
  projectRoot: string;
  candidates: RerankCandidate[];
  signal?: AbortSignal;
};

export type RerankScore = { id: string; score: number };

export type RerankOutcome = {
  status: "applied" | "skipped" | "fallback";
  scores?: RerankScore[];
  reason?: string;
  model?: string;
  inputTokens?: number;
};

export type AvailabilityResult = { ready: boolean; reason?: string };

export type RerankOffer = {
  version: 1;
  provider: "jev-optimizer";
  instanceId: string;
  availability: (projectRoot: string, signal?: AbortSignal) => Promise<AvailabilityResult>;
  rerank: (input: RerankInput) => Promise<RerankOutcome>;
};

export type RerankWithdraw = {
  version: 1;
  provider: "jev-optimizer";
  instanceId: string;
};

export type JevHostState = {
  schemaVersion: 1;
  enabled: boolean;
  hasKey: boolean;
  generation: string;
  browserEnabled?: boolean;
  browserGeneration?: string;
  contextEnabled?: boolean;
};

export type JevFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type JevDeps = {
  fetch?: JevFetch;
  env?: NodeJS.Dict<string | undefined>;
  readState?: (path: string, signal?: AbortSignal) => Promise<string>;
  deadlineMs?: number;
  pollMs?: number;
};

export type EventBus = {
  on(channel: string, handler: (data: unknown) => void): (() => void) | void;
  emit(channel: string, data?: unknown): void;
};

export type JevExtensionAPI = {
  events?: EventBus;
  on?(event: string, handler: (...args: unknown[]) => unknown): unknown;
  registerTool?(tool: unknown): void;
  registerProvider?(name: unknown, config?: unknown): void;
};

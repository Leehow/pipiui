import type {
  MemoryActorContext,
  MemoryBrokerStatus,
  MemoryExperienceCandidate,
  MemoryQuery,
  MemoryQueryResult,
} from "#memory-broker-contract";

/**
 * Retrieval and learning stay behind this narrow adapter. The package provides
 * no Hermes implementation; hosts choose an independent backend later.
 */
export interface MemoryBrokerBackend {
  query(query: MemoryQuery, context: MemoryActorContext): Promise<MemoryQueryResult[]>;
  ingest(candidate: MemoryExperienceCandidate, context: MemoryActorContext, durable: boolean): Promise<void>;
  status(context: MemoryActorContext): Promise<MemoryBrokerStatus>;
  /** Durable import readback used only by the main package migration path. */
  verifyImported?(candidate: MemoryExperienceCandidate, context: MemoryActorContext): Promise<boolean>;
  /** Session-owned native backends may release handles after the loopback server closes. */
  close?(): Promise<void>;
}

export class MemoryBackendUnavailableError extends Error {
  constructor(message = "memory backend is unavailable") {
    super(message);
    this.name = "MemoryBackendUnavailableError";
  }
}

/** Safe default: status is observable, while recall/write fail closed. */
export class UnavailableMemoryBackend implements MemoryBrokerBackend {
  private readonly detail: string;

  constructor(detail = "Memory broker is running without a retrieval/learning backend.") {
    this.detail = detail;
  }

  async query(): Promise<MemoryQueryResult[]> {
    throw new MemoryBackendUnavailableError();
  }

  async ingest(): Promise<void> {
    throw new MemoryBackendUnavailableError();
  }

  async status(): Promise<MemoryBrokerStatus> {
    return { ready: false, detail: this.detail };
  }
}

/** Minimal deterministic backend for Node integration tests; not a learning engine. */
export class InMemoryMemoryBackend implements MemoryBrokerBackend {
  readonly queries: Array<{ query: MemoryQuery; context: MemoryActorContext }> = [];
  readonly ingested: Array<{ candidate: MemoryExperienceCandidate; context: MemoryActorContext; durable: boolean }> = [];
  private results: MemoryQueryResult[];
  private ready: boolean;
  private detail: string | undefined;

  constructor(options: {
    results?: MemoryQueryResult[];
    ready?: boolean;
    detail?: string;
  } = {}) {
    this.results = options.results ?? [];
    this.ready = options.ready ?? true;
    this.detail = options.detail;
  }

  setResults(results: MemoryQueryResult[]): void {
    this.results = results;
  }

  setStatus(ready: boolean, detail?: string): void {
    this.ready = ready;
    this.detail = detail;
  }

  async query(query: MemoryQuery, context: MemoryActorContext): Promise<MemoryQueryResult[]> {
    this.queries.push({ query, context });
    return this.results;
  }

  async ingest(candidate: MemoryExperienceCandidate, context: MemoryActorContext, durable: boolean): Promise<void> {
    this.ingested.push({ candidate, context, durable });
  }

  async status(): Promise<MemoryBrokerStatus> {
    return { ready: this.ready, ...(this.detail ? { detail: this.detail } : {}) };
  }

  async verifyImported(candidate: MemoryExperienceCandidate): Promise<boolean> {
    return this.ingested.some((entry) => entry.durable && entry.candidate.claim === candidate.claim);
  }
}

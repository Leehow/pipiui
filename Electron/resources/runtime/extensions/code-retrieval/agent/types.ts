/** Shared result-protocol types (spec D5). Existing field names are frozen. */
import type { RerankerDetails } from "./reranker.js";
import type { RecallSource } from "./wide-recall.js";

export type RetrievalKind =
  | "code-retrieval.search"
  | "code-retrieval.nav"
  | "code-retrieval.map"
  | "code-retrieval.spans";

export type RetrievalHit = {
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  alreadyRead?: boolean;
  text?: string;
  queryIndices?: number[];
};

export type UnassignedHit = {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  text?: string;
  queryIndices?: number[];
};

export type RetrievalDetails = {
  schemaVersion: 1;
  kind: RetrievalKind;
  hits: Array<Omit<RetrievalHit, "text">>;
  resultsPath: string;
  degraded: boolean;
  /** Provider that actually served indexed hits ("rg" | "tantivy" | "zvec"). */
  provider?: string;
  /** Optional optimization metadata, separate from local-index availability. */
  reranker?: RerankerDetails;
  /** Actual local serving layers for each explicit/optimizer-expanded query. */
  sources?: RecallSource[];
};

export type TextContent = { type: "text"; text: string };

export type ToolResult = {
  content: TextContent[];
  details: RetrievalDetails;
};

export type SeenRange = {
  path: string;
  startLine: number;
  endLine: number;
  contentHash: string;
};

export type SpanRecord = {
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  contentHash?: string;
  queryIndices?: number[];
};

export type SidecarSnapshot = {
  pid: number;
  port: number;
  token: string;
  startedAt?: number;
  /** Actual provider identity advertised by this sidecar; never the bearer token. */
  provider?: string;
};

export type SidecarConnection = SidecarSnapshot & {
  refcount?: number;
  ready?: boolean;
  /** Exact-layer provider this session asked for (settings.ext.code-retrieval.exactProvider). */
  requestedProvider?: string;
  /** Set only when a "tantivy" request could not be served by Tantivy itself. */
  providerFallback?: { requested: string; actual?: string; reason: string };
};

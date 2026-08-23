/** Shared result-protocol types (spec D5). Field names are frozen. */

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
};

export type UnassignedHit = {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  text?: string;
};

export type RetrievalDetails = {
  schemaVersion: 1;
  kind: RetrievalKind;
  hits: Array<Omit<RetrievalHit, "text">>;
  resultsPath: string;
  degraded: boolean;
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
};

export type SidecarSnapshot = {
  pid: number;
  port: number;
  token: string;
  startedAt?: number;
};

export type SidecarConnection = SidecarSnapshot & {
  refcount?: number;
  ready?: boolean;
};

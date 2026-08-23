/**
 * Stable symbol-layer types for code-retrieval (spec D4 / D6).
 * Pure data — no tool registration, no sidecar lifecycle.
 */

export type SupportedLang =
  | "python"
  | "typescript"
  | "tsx"
  | "javascript"
  | "rust";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "import"
  | "call"
  | "interface"
  | "module";

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  path: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  /** Signature / import line only — never a function body. */
  signature?: string;
  /** Enclosing class / impl type, when known. */
  container?: string;
  lang: SupportedLang;
}

export interface CallEdge {
  from: string;
  to: string;
}

export interface MapSymbol {
  name: string;
  kind: Exclude<SymbolKind, "call">;
  signature: string;
  startLine: number;
  endLine: number;
  score: number;
  container?: string;
}

export interface MapEntry {
  path: string;
  symbols: MapSymbol[];
  imports: string[];
  calls: CallEdge[];
  score: number;
}

export interface SourceFile {
  path: string;
  source: string;
  lang: SupportedLang;
}

export type CodeNavOperation =
  | "definition"
  | "references"
  | "implementations"
  | "workspace_symbols"
  | "callers"
  | "callees";

export interface CodeNavRequest {
  operation: CodeNavOperation;
  symbol?: string;
  path?: string;
  line?: number;
  column?: number;
}

export interface CodeNavHit {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  kind: SymbolKind;
  signature?: string;
}

export interface CodeNavResult {
  operation: CodeNavOperation;
  hits: CodeNavHit[];
  /** Empty definition/references → caller may fall back to exact (D4). */
  degraded: boolean;
  fallbackExact?: boolean;
  /** callers/callees are stage 3 — do not pretend we have a call graph. */
  unsupported?: boolean;
  incomplete?: boolean;
  reason?: string;
}

export const DEFAULT_TOKEN_BUDGET = 4000;
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function lastNameSegment(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/[.:]/);
  return parts[parts.length - 1] ?? trimmed;
}

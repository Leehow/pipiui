import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { matchesSearchScope } from "./search-scope.js";
import { resolveProjectFile } from "./read-spans.js";
import type { UnassignedHit } from "./types.js";

// Structural, process-local protocol: neither extension imports the other's package.
export const RERANK_DISCOVER = "pipiui.retrieval-reranker.discover.v1";
export const RERANK_PROVIDE = "pipiui.retrieval-reranker.provide.v1";
export const RERANK_WITHDRAW = "pipiui.retrieval-reranker.withdraw.v1";
export type RerankCandidate = {
  id: string; path: string; startLine: number; endLine: number; symbol?: string; text: string;
};
export type RerankOutcome = {
  status: "applied" | "skipped" | "fallback";
  scores?: Array<{ id: string; score: number }>;
  reason?: string; model?: string; inputTokens?: number;
};
export type Reranker = {
  version: 1; provider: "jev-optimizer"; instanceId: string;
  availability(projectRoot: string, signal?: AbortSignal): Promise<{ ready: boolean; reason?: string }>;
  rerank(input: { query: string; projectRoot: string; candidates: RerankCandidate[]; signal?: AbortSignal }): Promise<RerankOutcome>;
};
export type RerankerDetails = {
  provider: "jev"; status: RerankOutcome["status"]; reason?: string;
  candidateCount: number; evaluatedCount: number; elapsedMs: number;
  model?: string; inputTokens?: number;
};
export type RerankerBus = {
  on(channel: string, listener: (payload: unknown) => void): (() => void) | void;
  emit(channel: string, payload: unknown): void;
};

export function connectReranker(bus?: RerankerBus): { current(): Reranker | undefined; dispose(): void } {
  let current: Reranker | undefined;
  let disposed = false;
  const retired = new Set<string>();
  const unsubs: Array<(() => void) | void> = [];
  if (bus) {
    unsubs.push(bus.on(RERANK_PROVIDE, (raw) => {
      if (disposed || !isRecord(raw) || raw.version !== 1 || raw.provider !== "jev-optimizer"
        || typeof raw.instanceId !== "string" || retired.has(raw.instanceId)
        || typeof raw.availability !== "function" || typeof raw.rerank !== "function") return;
      if (current && current.instanceId !== raw.instanceId) retired.add(current.instanceId);
      current = raw as Reranker;
    }));
    unsubs.push(bus.on(RERANK_WITHDRAW, (raw) => {
      if (!isRecord(raw) || raw.version !== 1 || raw.provider !== "jev-optimizer" || typeof raw.instanceId !== "string") return;
      retired.add(raw.instanceId);
      if (current?.instanceId === raw.instanceId) current = undefined;
    }));
    bus.emit(RERANK_DISCOVER, { version: 1 });
  }
  return {
    current: () => current,
    dispose() {
      disposed = true;
      current = undefined;
      for (const unsub of unsubs) unsub?.();
      retired.clear();
    },
  };
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Search cancelled");
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** This is extra cloud exclusion, not a change to what local grep/read may return. */
export function cloudPathAllowed(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/");
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || parts.some((part) => part === ".." || [".pi", ".git", ".ssh", ".aws"].includes(part.toLowerCase()))) return false;
  return !parts.some((part) => /^(?:\.env.*|(?:credentials|secrets?)(?:\..*)?|\.(?:npmrc|netrc|pypirc|git-credentials)|auth\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/i.test(part)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(part));
}

export function redactSnippet(text: string): string {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|authorization)["']?\s*[:=]\s*["'])([^"'\n]+)(["'])/gi, "$1[REDACTED]$3");
}

function boundedLines(text: string): string {
  let output = "";
  for (const line of text.split(/\r?\n/)) {
    const next = output ? `${output}\n${line}` : line;
    if (Buffer.byteLength(next, "utf8") > 768) break;
    output = next;
  }
  return output;
}

function withinScope(path: string, scope?: string, glob?: string, excludes: string[] = []): boolean {
  return matchesSearchScope(path, { path: scope, glob, excludeGlobs: excludes });
}

export async function prepareRerankCandidates(args: {
  hits: UnassignedHit[]; projectRoot: string; query?: string; path?: string; glob?: string; excludeGlobs: string[]; signal?: AbortSignal;
}): Promise<Array<{ candidate: RerankCandidate; index: number; protected: boolean }>> {
  const out: Array<{ candidate: RerankCandidate; index: number; protected: boolean }> = [];
  const rootReal = await realpath(args.projectRoot);
  const scope = args.path ? relative(args.projectRoot, resolve(args.projectRoot, args.path)).replace(/\\/g, "/") : undefined;
  const contents = new Map<string, string>();
  for (const [index, hit] of args.hits.slice(0, 64).entries()) {
    throwIfCancelled(args.signal);
    const path = relative(args.projectRoot, resolve(args.projectRoot, hit.path)).replace(/\\/g, "/");
    if (!cloudPathAllowed(path) || !withinScope(path, scope, args.glob, args.excludeGlobs)
      || !Number.isInteger(hit.startLine) || !Number.isInteger(hit.endLine) || hit.startLine < 1 || hit.endLine < hit.startLine) continue;
    const abs = await resolveProjectFile(args.projectRoot, hit.path);
    if (!abs) continue;
    const physicalPath = relative(rootReal, abs).replace(/\\/g, "/");
    if (!cloudPathAllowed(physicalPath) || !withinScope(physicalPath, undefined, args.glob, args.excludeGlobs)) continue;
    let source = hit.text;
    if (!source) {
      try {
        let full = contents.get(abs);
        if (full === undefined) {
          if ((await stat(abs)).size > 1024 * 1024) continue;
          full = await readFile(abs, "utf8");
          contents.set(abs, full);
        }
        source = full.split(/\r?\n/).slice(hit.startLine - 1, hit.endLine).join("\n");
      } catch { continue; }
    }
    if (!source || source.includes("\0") || /-----BEGIN [\w ]*PRIVATE KEY-----/.test(source)) continue;
    const text = boundedLines(redactSnippet(source));
    if (!text.trim()) continue;
    out.push({ index, protected: isProtectedHit(args.query ?? "", { ...hit, text: source }), candidate: {
      id: `candidate-${index + 1}`, path, startLine: hit.startLine, endLine: hit.endLine,
      ...(hit.symbol ? { symbol: hit.symbol } : {}), text,
    } });
  }
  return out;
}

/** Match complete identifiers/paths or explicit literals, never arbitrary shared words. */
export function isProtectedHit(query: string, hit: UnassignedHit): boolean {
  if (hit.symbol && new RegExp(`(^|[^\\w$])${hit.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`).test(query)) return true;
  const paths: string[] = query.match(/(?:[\w.-]+\/)+[\w.-]+/g) ?? [];
  if (paths.includes(hit.path.replace(/\\/g, "/"))) return true;
  const literals = [...query.matchAll(/["'`]([^"'`\n]+)["'`]/g)].map((m) => m[1]!);
  return literals.some((literal) => hit.text?.includes(literal) || hit.symbol === literal || hit.path === literal);
}

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 1500): Promise<T> {
  throwIfCancelled(signal);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new Error("Search cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("reranker-timeout")), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([work(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function probeOptionalReranker(reranker: Reranker, projectRoot: string, signal?: AbortSignal): Promise<{
  ready: boolean; elapsedMs: number; remainingMs: number; details?: RerankerDetails;
}> {
  const start = Date.now();
  try {
    const available = await bounded((signal) => reranker.availability(projectRoot, signal), signal);
    const elapsedMs = Date.now() - start;
    const remainingMs = Math.max(0, 1500 - elapsedMs);
    if (available.ready && remainingMs > 0) return { ready: true, elapsedMs, remainingMs };
    const reason = available.reason && /^[a-z][a-z0-9-]{0,63}$/.test(available.reason) ? available.reason : "unavailable";
    return { ready: false, elapsedMs, remainingMs, details: { provider: "jev", status: "skipped", reason,
      candidateCount: 0, evaluatedCount: 0, elapsedMs } };
  } catch {
    throwIfCancelled(signal);
    const elapsedMs = Date.now() - start;
    return { ready: false, elapsedMs, remainingMs: 0, details: { provider: "jev", status: "fallback", reason: "reranker-unavailable",
      candidateCount: 0, evaluatedCount: 0, elapsedMs } };
  }
}

export async function applyOptionalRerank(args: {
  hits: UnassignedHit[]; query: string; projectRoot: string; path?: string; glob?: string;
  excludeGlobs: string[]; signal?: AbortSignal; reranker?: Reranker; isRerankerCurrent?: () => boolean; timeoutMs?: number;
}): Promise<{ hits: UnassignedHit[]; details?: RerankerDetails }> {
  if (!args.reranker || args.hits.length < 2) return { hits: args.hits };
  const start = Date.now();
  let candidateCount = 0;
  const details = (outcome: RerankOutcome, evaluatedCount = 0): RerankerDetails => ({
    provider: "jev", status: outcome.status,
    ...(outcome.reason && /^[a-z][a-z0-9-]{0,63}$/.test(outcome.reason) ? { reason: outcome.reason } : {}),
    candidateCount, evaluatedCount, elapsedMs: Date.now() - start,
    ...(typeof outcome.model === "string" && /^[\w./-]{1,100}$/.test(outcome.model) ? { model: outcome.model } : {}),
    ...(Number.isFinite(outcome.inputTokens) && outcome.inputTokens! >= 0 ? { inputTokens: outcome.inputTokens } : {}),
  });
  try {
    return await bounded(async (signal) => {
      const available = await args.reranker!.availability(args.projectRoot, signal);
      throwIfCancelled(signal);
      if (!available.ready) return { hits: args.hits, details: details({ status: "skipped", reason: available.reason }) };
      const prepared = await prepareRerankCandidates({ ...args, signal });
      throwIfCancelled(signal);
      candidateCount = prepared.length;
      if (prepared.length < 2) return { hits: args.hits, details: details({ status: "skipped", reason: "insufficient-candidates" }) };
      if (args.isRerankerCurrent?.() === false) return { hits: args.hits, details: details({ status: "fallback", reason: "provider-revoked" }) };
      const outcome = await args.reranker!.rerank({ query: redactSnippet(args.query), projectRoot: args.projectRoot, candidates: prepared.map((x) => x.candidate), signal });
      throwIfCancelled(signal);
      if (args.isRerankerCurrent?.() === false) return { hits: args.hits, details: details({ status: "fallback", reason: "provider-revoked" }) };
      if (outcome.status !== "applied") return { hits: args.hits, details: details(outcome) };
      const scores = outcome.scores;
      if (!Array.isArray(scores) || scores.length === 0 || scores.length > prepared.length
        || scores.some((score, i) => score.id !== prepared[i]!.candidate.id || !Number.isFinite(score.score) || score.score < 0 || score.score > 3)) {
        return { hits: args.hits, details: details({ status: "fallback", reason: "invalid-response" }) };
      }
      if (scores.every((score) => score.score === scores[0]!.score)) {
        return { hits: args.hits, details: details({ ...outcome, status: "skipped", reason: "flat-scores" }, scores.length) };
      }
      const ranked = scores.map((score, i) => ({ score: score.score, index: prepared[i]!.index }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
      const hits = args.hits.slice();
      // Only replace evaluated slots. Private/unscored candidates are not demoted or deleted.
      for (let i = 0; i < ranked.length; i++) hits[prepared[i]!.index] = args.hits[ranked[i]!.index]!;
      const protectedSet = new Set(args.hits.filter((hit) => isProtectedHit(args.query, hit)));
      for (const item of prepared) if (item.protected) protectedSet.add(args.hits[item.index]!);
      // Strong anchors retain their original local order, even if Jev scores them differently.
      const protectedHits = args.hits.filter((hit) => protectedSet.has(hit));
      const others = hits.filter((hit) => !protectedSet.has(hit));
      return { hits: [...protectedHits, ...others], details: details(outcome, scores.length) };
    }, args.signal, args.timeoutMs);
  } catch {
    throwIfCancelled(args.signal);
    return { hits: args.hits, details: details({ status: "fallback", reason: "reranker-unavailable" }) };
  }
}

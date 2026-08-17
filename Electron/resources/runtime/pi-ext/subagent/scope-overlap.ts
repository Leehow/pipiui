/**
 * Advisory dispatch scopes: path-prefix overlap, no glob engine.
 *
 * Normalization:
 * - backslash → `/`, trim, drop `.` segments, apply `..`, collapse empty parts
 * - a trailing `/` means "this directory and everything under it"
 * - without a trailing `/`, the string is a concrete path; it still overlaps a
 *   descendant (`src/foo` overlaps `src/foo/bar.ts`) via `/`-boundary prefix
 * - `src/foo` does not overlap `src/foobar`
 */

export interface ScopedAgent {
	agentId: string;
	scope?: string[] | undefined;
}

export interface ScopeOverlapHit {
	agentId: string;
	paths: string[];
}

/** In-flight worker scopes, keyed by agentId. Written on start, cleared on settle. */
export const runningDispatchScopes = new Map<string, string[]>();

export function recordRunningDispatchScope(agentId: string, scope: string[] | undefined): void {
	const cleaned = cleanScope(scope);
	if (!agentId || cleaned.length === 0) return;
	runningDispatchScopes.set(agentId, cleaned);
}

export function clearRunningDispatchScope(agentId: string): void {
	if (agentId) runningDispatchScopes.delete(agentId);
}

export function cleanScope(scope: string[] | undefined | null): string[] {
	if (!Array.isArray(scope)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of scope) {
		if (typeof raw !== "string") continue;
		const n = normalizeScopePath(raw);
		if (!n || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

export function normalizeScopePath(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const posix = trimmed.replace(/\\/g, "/");
	const isDir = posix.endsWith("/");
	const isAbs = posix.startsWith("/");
	const parts: string[] = [];
	for (const part of posix.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	const joined = (isAbs ? "/" : "") + parts.join("/");
	if (!joined || joined === "/") return isDir || isAbs ? "/" : null;
	return isDir ? `${joined}/` : joined;
}

export function pathsOverlap(a: string, b: string): boolean {
	const na = normalizeScopePath(a);
	const nb = normalizeScopePath(b);
	if (!na || !nb) return false;
	const sa = na.endsWith("/") ? na.slice(0, -1) : na;
	const sb = nb.endsWith("/") ? nb.slice(0, -1) : nb;
	if (sa === sb) return true;
	if (sa.length === 0 || sb.length === 0) return true;
	return sb.startsWith(`${sa}/`) || sa.startsWith(`${sb}/`);
}

export function overlappingPaths(left: string[], right: string[]): string[] {
	const hits: string[] = [];
	const seen = new Set<string>();
	for (const a of left) {
		for (const b of right) {
			if (!pathsOverlap(a, b)) continue;
			const key = `${a} ∩ ${b}`;
			if (seen.has(key)) continue;
			seen.add(key);
			hits.push(key);
		}
	}
	return hits;
}

/**
 * New tasks vs queued + running (and optional same-call peers).
 * Items with no scope do not participate.
 */
export function findScopeOverlaps(incoming: ScopedAgent, others: ScopedAgent[]): ScopeOverlapHit[] {
	const left = cleanScope(incoming.scope);
	if (left.length === 0) return [];
	const hits: ScopeOverlapHit[] = [];
	for (const other of others) {
		if (!other.agentId || other.agentId === incoming.agentId) continue;
		const right = cleanScope(other.scope);
		if (right.length === 0) continue;
		const paths = overlappingPaths(left, right);
		if (paths.length > 0) hits.push({ agentId: other.agentId, paths });
	}
	return hits;
}

export function collectActiveScopedAgents(
	queued: ReadonlyArray<ScopedAgent>,
	running: ReadonlyMap<string, string[]> = runningDispatchScopes,
): ScopedAgent[] {
	const out: ScopedAgent[] = [];
	const seen = new Set<string>();
	for (const [agentId, scope] of running) {
		if (!agentId || seen.has(agentId)) continue;
		seen.add(agentId);
		out.push({ agentId, scope });
	}
	for (const item of queued) {
		if (!item.agentId || seen.has(item.agentId)) continue;
		seen.add(item.agentId);
		out.push({ agentId: item.agentId, scope: item.scope });
	}
	return out;
}

/** `[subagent-overlap]` lines; empty string when nothing overlaps. */
export function formatScopeOverlapWarning(incoming: ScopedAgent[], others: ScopedAgent[]): string {
	const lines: string[] = [];
	for (const item of incoming) {
		const hits = findScopeOverlaps(item, [...others, ...incoming]);
		if (hits.length === 0) continue;
		const detail = hits
			.map((hit) => `agentId=${hit.agentId} paths=${hit.paths.join(", ")}`)
			.join("; ");
		lines.push(
			`[subagent-overlap] agentId=${item.agentId} overlaps concurrent dispatch (${detail}). ` +
				"Dispatch was not blocked; couple shared files onto one worker or name a single owner for shared interfaces.",
		);
	}
	return lines.join("\n");
}

export function formatDispatchScopeWarning(
	incoming: ScopedAgent[],
	queued: ReadonlyArray<ScopedAgent>,
): string {
	return formatScopeOverlapWarning(incoming, collectActiveScopedAgents(queued));
}

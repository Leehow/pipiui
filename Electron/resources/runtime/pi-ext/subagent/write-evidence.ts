/**
 * "Did this worker actually change anything?" — answered from the tree, not from tool names.
 *
 * The semantic stall guard used to answer it by matching tool names against a fixed list of
 * built-ins (`write`, `edit`, ...) plus a handful of validation-command regexes. Anything else
 * scored zero: an extension tool that commits to disk, a `bash` heredoc redirect, an MCP call.
 * Workers whose entire output went through those channels reported `progressEvents=0` for their
 * whole life and could never wind the stall counter back, so they were killed mid-job.
 *
 * `git status --porcelain` is the same authority the Boss write set already relies on: always
 * current, needs no declaration, and knows nothing about which tool did the writing. Paths alone
 * are not enough — rewriting one file repeatedly leaves the porcelain output identical — so the
 * fingerprint carries each dirty path's size and mtime too.
 *
 * Everything here fails open. No cwd, no repository, a slow or unexpected Git, an unreadable
 * file: the answer is `undefined`, the caller skips the evidence step, and behaviour falls back
 * to exactly what it was before this module existed.
 */
import * as path from "node:path";

import { parsePorcelainZ, type GitRunner } from "./boss-write-set.ts";
import { stableDigest } from "./stable-digest.ts";

/**
 * Above this, the path list alone is the fingerprint. A worker holding hundreds of dirty files
 * is unambiguously writing, and stat'ing all of them on every stall check buys nothing.
 */
const MAX_STATTED_PATHS = 500;

export interface WriteEvidenceStat {
	mtimeMs: number;
	size: number;
}

export type StatReader = (absolutePath: string) => WriteEvidenceStat | null;

/** Stable fingerprint of a dirty-path set. Same tree state in, same string out. */
export function writeSetFingerprint(
	paths: readonly string[],
	cwd: string,
	stat: StatReader,
): string {
	const sorted = [...paths].sort();
	if (sorted.length === 0) return "clean";
	if (sorted.length > MAX_STATTED_PATHS) {
		return `paths:${sorted.length}:${stableDigest(sorted.join(" "))}`;
	}
	const parts = sorted.map((relative) => {
		let info: WriteEvidenceStat | null = null;
		try {
			info = stat(path.resolve(cwd, relative));
		} catch {
			info = null;
		}
		// A path Git reports but we cannot stat is a deletion mid-flight — still a change, and
		// still stable to compare against.
		return info ? `${relative}:${info.mtimeMs}:${info.size}` : `${relative}:unreadable`;
	});
	return `files:${sorted.length}:${stableDigest(parts.join(" "))}`;
}

/** The worker tree's write fingerprint, or `undefined` when no answer can be trusted. */
export function workerWriteFingerprint(
	cwd: string | undefined,
	run: GitRunner,
	stat: StatReader,
): string | undefined {
	if (!cwd || !cwd.trim()) return undefined;
	let result: { ok: boolean; stdout: string };
	try {
		result = run(["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	} catch {
		return undefined;
	}
	if (!result.ok) return undefined;
	return writeSetFingerprint(parsePorcelainZ(result.stdout), cwd, stat);
}

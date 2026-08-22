/*
 * spool.ts — durable, on-disk ground truth for a folded block.
 *
 * When the pressure-driven ladder folds a block, its raw payload is written here as a versioned
 * JSON envelope, one file per fold code. Recall, grep, and line-range retrieval read from this
 * spool after hard compaction removes the raw message from live history. Pi's session JSONL still
 * records the raw result verbatim; the spool is the recall-optimized copy the extension owns and
 * can slice.
 *
 * Layout: `<sessionDir>/spool/<sessionId>/<foldCode>.json`. Writes are atomic
 * (tmp + rename). Reads verify sha256 and throw a typed SpoolError naming the path on any
 * missing/corrupt file, so the failure surfaces to the agent instead of silently returning wrong
 * bytes (fail-explicit on recall).
 *
 * Dedup: identical payloads (by sha256) are stored once. The duplicate block keeps its own
 * fold code, but its file is a tiny alias envelope pointing at the first code's file; reads follow
 * the alias. Content is written exactly once.
 *
 * This is adapter code (disk I/O lives in the adapter, never the pure core).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { estTokens } from "../../core/tokens";

/** The on-disk envelope. `content` is the full raw payload; everything else is metadata. */
export interface SpoolEnvelope {
	v: 1;
	blockId: string;
	code: string;
	tool: string;
	/** The tool's input arguments (as the tool_result event reported them). */
	input: unknown;
	isError: boolean;
	/** Byte length of `content` (UTF-8). */
	bytes: number;
	/** estTokens(content) — the full-fidelity token weight this fold removed from the view. */
	estTokens: number;
	sha256: string;
	createdAt: number;
	/** For bash results: the tool's own full-output file, searched by recall-grep for extra fidelity. */
	fullOutputPath?: string;
	content: string;
	/** Set on a dedup alias file: this code's real content lives in `aliasOf`'s envelope. */
	aliasOf?: string;
}

/** What the caller learns after a write — enough to register the durable recall route. */
export interface SpoolWriteResult {
	code: string;
	/** The effective envelope carrying the content (the ORIGINAL when this was a dedup hit). */
	envelope: SpoolEnvelope;
	/** When set, this payload was identical to an earlier fold; recall reports the original code. */
	dedupOf?: string;
}

/** A typed spool failure that always names the offending path. Never thrown across the wire. */
export class SpoolError extends Error {
	constructor(
		message: string,
		readonly path: string,
		readonly code: string,
	) {
		super(message);
		this.name = "SpoolError";
	}
}

export function sha256Hex(s: string): string {
	return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface SpoolWriteParams {
	blockId: string;
	code: string;
	tool: string;
	input: unknown;
	isError: boolean;
	content: string;
	fullOutputPath?: string;
	/** Injectable clock for deterministic tests; defaults to Date.now(). */
	now?: number;
}

/**
 * A per-session spool directory. One instance per session; the directory is created lazily on the
 * first committed fold, so an idle session never touches disk.
 */
export class SpoolStore {
	private ensured = false;
	/**
	 * sha256 → first code that stored this payload, so a repeated payload aliases the first
	 * envelope instead of storing the bytes twice.
	 *
	 * SCOPE: in-memory and never rebuilt from disk, so dedup spans one PROCESS, not one session.
	 * Two identical results in the same run alias; the same result read again after a resume gets
	 * its own envelope. That costs disk only — both codes render a pointer and both resolve through
	 * recall — so rebuilding this index by scanning every envelope on startup would buy little for
	 * the I/O it would add.
	 */
	private readonly bySha = new Map<string, string>();

	constructor(private readonly dir: string) {}

	/** The absolute path of a code's envelope file. */
	pathFor(code: string): string {
		return join(this.dir, `${code}.json`);
	}

	private ensureDir(): void {
		if (this.ensured) return;
		mkdirSync(this.dir, { recursive: true });
		this.ensured = true;
	}

	/** Atomically write `text` to `file` (tmp in the same dir + rename). */
	private atomicWrite(file: string, text: string): void {
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, file);
	}

	/**
	 * Spool a payload. If an identical payload (same sha256) was already spooled by this process,
	 * write a tiny alias file instead of duplicating the content and report the dedup via `dedupOf`.
	 */
	write(p: SpoolWriteParams): SpoolWriteResult {
		this.ensureDir();
		const content = p.content;
		const sha = sha256Hex(content);
		const createdAt = p.now ?? Date.now();

		// COLLISION GUARD: foldCode is a 32-bit hash sliced to 6 base36 chars — two different block
		// ids CAN collide. Refuse to overwrite another block's envelope (the caller fails open: the
		// colliding result just isn't folded), and forget a stale sha mapping when the SAME block is
		// re-spooled with different content (tool retry) so dedup can't alias to rewritten bytes.
		const path = this.pathFor(p.code);
		if (existsSync(path)) {
			const prev = readEnvelopeFile(path);
			if (prev.blockId !== p.blockId) {
				throw new SpoolError(`fold-code collision: #${p.code} already stores ${prev.blockId}`, path, p.code);
			}
			if (prev.sha256 !== sha && this.bySha.get(prev.sha256) === p.code) this.bySha.delete(prev.sha256);
		}

		const firstCode = this.bySha.get(sha);
		if (firstCode && firstCode !== p.code) {
			// Dedup hit: this block's code aliases the first code's envelope (content written once).
			const original = this.read(firstCode);
			const alias: SpoolEnvelope = {
				v: 1,
				blockId: p.blockId,
				code: p.code,
				tool: p.tool,
				input: p.input,
				isError: p.isError,
				bytes: original.bytes,
				estTokens: original.estTokens,
				sha256: sha,
				createdAt,
				fullOutputPath: p.fullOutputPath,
				content: "",
				aliasOf: firstCode,
			};
			this.atomicWrite(this.pathFor(p.code), JSON.stringify(alias));
			return { code: p.code, envelope: original, dedupOf: firstCode };
		}

		const envelope: SpoolEnvelope = {
			v: 1,
			blockId: p.blockId,
			code: p.code,
			tool: p.tool,
			input: p.input,
			isError: p.isError,
			bytes: Buffer.byteLength(content, "utf8"),
			estTokens: estTokens(content),
			sha256: sha,
			createdAt,
			fullOutputPath: p.fullOutputPath,
			content,
		};
		this.atomicWrite(this.pathFor(p.code), JSON.stringify(envelope));
		this.bySha.set(sha, p.code);
		return { code: p.code, envelope };
	}

	/**
	 * Read a code's envelope, following one alias hop. Verifies sha256; a missing file or a mismatch
	 * throws a SpoolError carrying the path. Returns the CONTENT-BEARING envelope.
	 */
	read(code: string): SpoolEnvelope {
		return readEnvelopeAt(this.pathFor(code));
	}
}

/** Parse + validate one spool file at `path` (no alias follow). */
function readEnvelopeFile(path: string): SpoolEnvelope {
	const code = basename(path).replace(/\.json$/, "");
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		throw new SpoolError(`spool file for #${code} is missing`, path, code);
	}
	let env: SpoolEnvelope;
	try {
		env = JSON.parse(text) as SpoolEnvelope;
	} catch {
		throw new SpoolError(`spool file for #${code} is corrupt (bad JSON)`, path, code);
	}
	if (!env || env.v !== 1 || typeof env.code !== "string") {
		throw new SpoolError(`spool file for #${code} is corrupt (bad envelope)`, path, code);
	}
	return env;
}

/**
 * Read the content-bearing envelope for a spool file at an absolute path, following one dedup alias
 * hop (the alias target is a sibling `<aliasOf>.json` in the same directory). Verifies integrity.
 * This is the authoritative recall entry point — the registry stores each fold's absolute spoolPath,
 * so recall works across resume regardless of the current session's spool dir.
 */
export function readEnvelopeAt(path: string, depth = 0): SpoolEnvelope {
	const env = readEnvelopeFile(path);
	if (env.aliasOf) {
		// The writer only ever creates one-hop aliases; a longer/cyclic chain means a corrupt file.
		if (depth >= 4) throw new SpoolError(`spool file for #${env.code} has a broken alias chain`, path, env.code);
		const target = join(dirname(path), `${env.aliasOf}.json`);
		return readEnvelopeAt(target, depth + 1);
	}
	if (sha256Hex(env.content) !== env.sha256) {
		throw new SpoolError(`spool file for #${env.code} failed integrity check`, path, env.code);
	}
	return env;
}

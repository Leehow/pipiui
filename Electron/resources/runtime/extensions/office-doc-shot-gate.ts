import { existsSync } from "node:fs";
import { extname, isAbsolute, normalize, resolve } from "node:path";

export const OFFICECLI_MCP_TOOL = "mcp_officecli_officecli";
export const OFFICE_DOC_SHOT_GATE_CUSTOM_TYPE = "pipiui-office-doc-shot-gate";
export const OFFICE_DOC_SHOT_GATE_FOLLOW_UP_LIMIT = 3;
export const OFFICE_DOC_SHOT_GATE_FAILED_MESSAGE = "未通过截图闸门";

export const OFFICE_DOCUMENT_EXTENSIONS = Object.freeze([
	".doc",
	".docx",
	".docm",
	".dot",
	".dotx",
	".xls",
	".xlsx",
	".xlsm",
	".xlsb",
	".xlt",
	".xltx",
	".ppt",
	".pptx",
	".pptm",
	".pot",
	".potx",
	".pps",
	".ppsx",
]);

const OFFICE_DOCUMENT_EXTENSION_SET = new Set<string>(OFFICE_DOCUMENT_EXTENSIONS);

export const WRITE_VERBS = Object.freeze([
	"set",
	"add",
	"remove",
	"move",
	"swap",
	"batch",
	"raw-set",
	"add-part",
	"import",
	"merge",
]);

const WRITE_VERB_SET = new Set<string>(WRITE_VERBS);
const CREATE_VERB = "create";

export function workerOfficeDocShotGateArgs(
	extensionPath: string | undefined,
	options: { computerWorker?: boolean } = {},
): string[] {
	if (!extensionPath || options.computerWorker) return [];
	return ["-e", extensionPath];
}

export function isOfficecliToolName(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	return normalized === OFFICECLI_MCP_TOOL
		|| normalized === "officecli"
		|| /(^|_)officecli$/.test(normalized);
}

export function isOfficeDocumentPath(file: string): boolean {
	return OFFICE_DOCUMENT_EXTENSION_SET.has(extname(file).toLowerCase());
}

export function tokenizeCommand(command: string | string[]): string[] {
	if (Array.isArray(command)) {
		return command.flatMap((part) => {
			if (typeof part !== "string") return [];
			const trimmed = part.trim();
			return trimmed ? [trimmed] : [];
		});
	}
	if (typeof command !== "string") return [];
	const tokens: string[] = [];
	const pattern = /(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+))/g;
	for (const match of command.matchAll(pattern)) {
		if (match[1] !== undefined) tokens.push(match[1].replace(/\\(.)/g, "$1"));
		else if (match[2] !== undefined) tokens.push(match[2]);
		else if (match[3]) tokens.push(match[3]);
	}
	return tokens;
}

export function stripOfficecliPrefix(tokens: string[]): string[] {
	if (tokens.length === 0) return tokens;
	const base = tokens[0].replace(/\\/g, "/").split("/").pop() ?? tokens[0];
	return /^officecli(?:\.exe)?$/i.test(base) ? tokens.slice(1) : tokens;
}

export function extractOfficeCommand(input: unknown): string | string[] | null {
	if (!input || typeof input !== "object") return null;
	const command = (input as { command?: unknown }).command;
	if (typeof command === "string" || Array.isArray(command)) return command;
	return null;
}

export function bashInvokesOfficecli(command: string): boolean {
	if (typeof command !== "string" || !command.trim()) return false;
	const chunks = command.split(/(?:&&|\|\||[;|&\n`]|\$\()/);
	for (const chunk of chunks) {
		const tokens = tokenizeCommand(chunk.trim());
		if (tokens.length === 0) continue;
		let i = 0;
		while (i < tokens.length && /^(sudo|command|env|exec|nohup)$/i.test(tokens[i])) {
			if (/^(env|command)$/i.test(tokens[i])) {
				while (i + 1 < tokens.length && tokens[i + 1].includes("=")) i += 1;
			}
			i += 1;
		}
		const bin = tokens[i];
		if (!bin) continue;
		const base = (bin.replace(/\\/g, "/").split("/").pop() ?? bin).replace(/^["']|["']$/g, "");
		if (/^officecli(?:\.exe)?$/i.test(base)) return true;
		if (/^(bash|sh|zsh|ksh|dash)$/i.test(base)) {
			const flagAt = tokens.indexOf("-c", i);
			const nested = flagAt !== -1 ? tokens[flagAt + 1] : undefined;
			if (nested && bashInvokesOfficecli(nested)) return true;
		}
	}
	return false;
}

export function formatViewScreenshotCommand(file: string): string {
	const needsQuote = /[\s"'\\]/.test(file);
	const shown = needsQuote ? `"${file.replace(/(["\\])/g, "\\$1")}"` : file;
	return `officecli view ${shown} screenshot --grid auto`;
}

export function normalizeOfficeDocumentPath(file: string, cwd: string): string | null {
	if (typeof file !== "string") return null;
	const trimmed = file.trim().replace(/^@/, "");
	if (!trimmed || !isOfficeDocumentPath(trimmed)) return null;
	const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd || ".", trimmed);
	return normalize(absolute);
}

type FlagMap = Map<string, string | true>;

function parseArgvFlags(tokens: string[]): { positionals: string[]; flags: FlagMap } {
	const positionals: string[] = [];
	const flags: FlagMap = new Map();
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--") {
			positionals.push(...tokens.slice(i + 1));
			break;
		}
		if (token.startsWith("--") && token.length > 2) {
			const eq = token.indexOf("=");
			if (eq !== -1) {
				flags.set(token.slice(2, eq), token.slice(eq + 1));
				continue;
			}
			const name = token.slice(2);
			const next = tokens[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags.set(name, next);
				i += 1;
			} else {
				flags.set(name, true);
			}
			continue;
		}
		if (/^-[A-Za-z]$/.test(token)) {
			const name = token.slice(1);
			const next = tokens[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags.set(name, next);
				i += 1;
			} else {
				flags.set(name, true);
			}
			continue;
		}
		positionals.push(token);
	}
	return { positionals, flags };
}

export type ParsedOfficecli = {
	verb: string;
	argv: string[];
	rawTarget: string;
	displayTarget: string;
	force: boolean;
	isCreate: boolean;
	isWrite: boolean;
	isQualifyingScreenshot: boolean;
};

export function parseOfficecliCommand(command: string | string[]): ParsedOfficecli | null {
	const argv = stripOfficecliPrefix(tokenizeCommand(command));
	if (argv.length === 0) return null;
	const { positionals, flags } = parseArgvFlags(argv);
	const verb = (positionals[0] ?? "").toLowerCase();
	if (!verb) return null;
	const isCreate = verb === CREATE_VERB;
	const isWrite = isCreate || WRITE_VERB_SET.has(verb);
	const rawTarget = verb === "merge"
		? (positionals[2] ?? "")
		: (positionals[1] ?? "");
	if (!rawTarget) return null;
	const grid = flags.get("grid");
	const hasGridAuto = grid === true || (typeof grid === "string" && grid.toLowerCase() === "auto");
	const mode = (positionals[2] ?? "").toLowerCase();
	const isQualifyingScreenshot = verb === "view"
		&& mode === "screenshot"
		&& hasGridAuto
		&& !flags.has("page")
		&& !flags.has("range");
	return {
		verb,
		argv,
		rawTarget,
		displayTarget: rawTarget,
		force: flags.has("force"),
		isCreate,
		isWrite,
		isQualifyingScreenshot,
	};
}

export type GateKind = "write" | "screenshot" | "other";

export type BeginCallResult =
	| { action: "allow"; kind: GateKind; path?: string }
	| { action: "block"; reason: string; kind: GateKind; path?: string };

export type FileExistsFn = (absolutePath: string) => boolean;

type DocState = {
	key: string;
	displayPath: string;
	baselineSeq: number | null;
	lastWriteSeq: number | null;
	lastFinalSeq: number | null;
	writeSuccessCount: number;
	exemptFromBaseline: boolean;
	inflightScreenshots: Set<string>;
	inflightWrites: Set<string>;
};

type InflightRecord = {
	key: string;
	kind: "write" | "screenshot";
	parsed: ParsedOfficecli;
	existedAtBegin: boolean;
};

function defaultExists(absolutePath: string): boolean {
	try {
		return existsSync(absolutePath);
	} catch {
		return true;
	}
}

export class OfficeDocShotLedger {
	readonly followUpLimit = OFFICE_DOC_SHOT_GATE_FOLLOW_UP_LIMIT;
	private readonly docs = new Map<string, DocState>();
	private readonly inflight = new Map<string, InflightRecord>();
	private clock = 0;
	private followUps = 0;
	private failedAnnounced = false;

	constructor(private readonly exists: FileExistsFn = defaultExists) {}

	resetHumanTask(): void {
		this.docs.clear();
		this.inflight.clear();
		this.clock = 0;
		this.followUps = 0;
		this.failedAnnounced = false;
	}

	followUpCount(): number {
		return this.followUps;
	}

	get gateFailedAnnounced(): boolean {
		return this.failedAnnounced;
	}

	markGateFailedAnnounced(): void {
		this.failedAnnounced = true;
	}

	recordFollowUp(): number {
		this.followUps += 1;
		return this.followUps;
	}

	followUpExhausted(): boolean {
		return this.followUps >= this.followUpLimit;
	}

	pendingFinalPaths(): string[] {
		return [...this.docs.values()]
			.filter((doc) => this.needsFinal(doc))
			.map((doc) => doc.displayPath);
	}

	releaseAllInflight(): void {
		for (const [toolCallId, record] of this.inflight) {
			const doc = this.docs.get(record.key);
			if (doc) {
				doc.inflightWrites.delete(toolCallId);
				doc.inflightScreenshots.delete(toolCallId);
			}
		}
		this.inflight.clear();
	}

	beginCall(args: {
		toolCallId: string;
		toolName: string;
		input: unknown;
		cwd: string;
	}): BeginCallResult {
		if (args.toolName === "bash") {
			const command = typeof (args.input as { command?: unknown } | undefined)?.command === "string"
				? (args.input as { command: string }).command
				: "";
			if (bashInvokesOfficecli(command)) {
				return {
					action: "block",
					kind: "other",
					reason: "Office document screenshot gate: blocked bash invocation of officecli. Use the OfficeCLI MCP tool (mcp_officecli_officecli). Direct shell officecli bypass is not allowed.",
				};
			}
			return { action: "allow", kind: "other" };
		}

		if (!isOfficecliToolName(args.toolName)) return { action: "allow", kind: "other" };
		const command = extractOfficeCommand(args.input);
		if (command === null) return { action: "allow", kind: "other" };
		const parsed = parseOfficecliCommand(command);
		if (!parsed) return { action: "allow", kind: "other" };
		const absolute = normalizeOfficeDocumentPath(parsed.rawTarget, args.cwd);
		if (!absolute) return { action: "allow", kind: "other" };

		const doc = this.docFor(absolute, parsed.displayTarget);
		if (parsed.isQualifyingScreenshot) {
			if (doc.inflightWrites.size > 0) {
				return {
					action: "block",
					kind: "screenshot",
					path: absolute,
					reason: `Office document screenshot gate: blocked screenshot of ${parsed.displayTarget} while a write to the same document is in progress.`,
				};
			}
			this.markInflight(args.toolCallId, doc, "screenshot", parsed, this.pathExists(absolute));
			return { action: "allow", kind: "screenshot", path: absolute };
		}

		if (!parsed.isWrite) return { action: "allow", kind: "other", path: absolute };

		if (doc.inflightScreenshots.size > 0) {
			return {
				action: "block",
				kind: "write",
				path: absolute,
				reason: `Office document screenshot gate: blocked write to ${parsed.displayTarget} while a screenshot of the same document is in progress.`,
			};
		}

		const existed = this.pathExists(absolute);
		const requiresBaseline = !doc.exemptFromBaseline && existed;
		if (requiresBaseline && doc.baselineSeq === null) {
			return {
				action: "block",
				kind: "write",
				path: absolute,
				reason: [
					`Office document screenshot gate: blocked write to ${parsed.displayTarget} before a successful whole-document baseline screenshot in this human task.`,
					`First run: ${formatViewScreenshotCommand(parsed.displayTarget)}`,
				].join(" "),
			};
		}

		this.markInflight(args.toolCallId, doc, "write", parsed, existed);
		return { action: "allow", kind: "write", path: absolute };
	}

	finishCall(args: {
		toolCallId: string;
		toolName?: string;
		input?: unknown;
		cwd?: string;
		isError: boolean;
	}): void {
		const record = this.inflight.get(args.toolCallId);
		if (!record) return;
		this.inflight.delete(args.toolCallId);
		const doc = this.docs.get(record.key);
		if (!doc) return;
		doc.inflightWrites.delete(args.toolCallId);
		doc.inflightScreenshots.delete(args.toolCallId);
		if (args.isError) return;

		const seq = ++this.clock;
		if (record.kind === "write") {
			doc.lastWriteSeq = seq;
			doc.lastFinalSeq = null;
			doc.writeSuccessCount += 1;
			if ((record.parsed.isCreate && !record.parsed.force) || !record.existedAtBegin) {
				doc.exemptFromBaseline = true;
			}
			return;
		}

		if (doc.lastWriteSeq === null) doc.baselineSeq = seq;
		else if (seq > doc.lastWriteSeq) doc.lastFinalSeq = seq;
	}

	private needsFinal(doc: DocState): boolean {
		if (doc.writeSuccessCount <= 0 || doc.lastWriteSeq === null) return false;
		return doc.lastFinalSeq === null || doc.lastFinalSeq <= doc.lastWriteSeq;
	}

	private pathExists(absolutePath: string): boolean {
		try {
			return this.exists(absolutePath);
		} catch {
			return true;
		}
	}

	private docFor(key: string, displayPath: string): DocState {
		const existing = this.docs.get(key);
		if (existing) {
			existing.displayPath = displayPath;
			return existing;
		}
		const created: DocState = {
			key,
			displayPath,
			baselineSeq: null,
			lastWriteSeq: null,
			lastFinalSeq: null,
			writeSuccessCount: 0,
			exemptFromBaseline: false,
			inflightScreenshots: new Set(),
			inflightWrites: new Set(),
		};
		this.docs.set(key, created);
		return created;
	}

	private markInflight(
		toolCallId: string,
		doc: DocState,
		kind: "write" | "screenshot",
		parsed: ParsedOfficecli,
		existedAtBegin: boolean,
	): void {
		this.inflight.set(toolCallId, { key: doc.key, kind, parsed, existedAtBegin });
		if (kind === "write") doc.inflightWrites.add(toolCallId);
		else doc.inflightScreenshots.add(toolCallId);
	}
}

export function followUpContent(paths: string[]): string {
	const commands = paths.map((file) => formatViewScreenshotCommand(file));
	return [
		"Office document screenshot gate: successful writes have no qualifying whole-document final screenshot later than the last write.",
		"Take this exact command for each file, then stop:",
		...commands,
	].join("\n");
}

export function gateFailedContent(paths: string[]): string {
	const listed = paths.join(", ");
	return `${OFFICE_DOC_SHOT_GATE_FAILED_MESSAGE}: ${listed} were written but never received a successful whole-document final screenshot (${formatViewScreenshotCommand("<file>")}) after the last write.`;
}

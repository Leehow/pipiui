/**
 * Portable worktree finalization schema v1.
 *
 * This contract is intentionally separate from the live bridge contract. The
 * extension continues to create/reuse worktrees; an Electron main process (or
 * another Node host) may persist one of these records and hand it back to the
 * service for a safe retry.
 */

export const WORKTREE_FINALIZATION_SCHEMA_VERSION = 1 as const;

export type WorktreeSchemaDiagnosticV1 = {
	code: string;
	path: string;
	message: string;
};

export type WorktreeDecodeResultV1<T> =
	| { ok: true; value: T; diagnostics: WorktreeSchemaDiagnosticV1[] }
	| { ok: false; diagnostics: WorktreeSchemaDiagnosticV1[] };

export type WorktreeTerminalStateV1 = "ok" | "failed" | "aborted" | "interrupted";
export type WorktreeOwnershipModeV1 = "isolated" | "direct" | "main-session";
export type WorktreeOwnerRoleV1 = "worker" | "secretary";

/**
 * `command` preserves the worker's attested command text. `argv` is optional
 * and is the only command form the default Node runner executes. This keeps a
 * legacy shell-shaped string useful for display/audit without treating it as a
 * shell program.
 */
export type WorktreeVerifyMetadataV1 = {
	command?: string;
	argv?: string[];
	exitCode?: number;
};

export type WorktreeOwnershipV1 = {
	mode: WorktreeOwnershipModeV1;
	role: WorktreeOwnerRoleV1;
	agentId: string;
	runId: string;
};

export type WorktreeFinalizationInputV1 = {
	schemaVersion: 1;
	agentId: string;
	runId: string;
	mainCwd: string;
	worktree: {
		path: string;
		branch: string;
		ownership: WorktreeOwnershipV1;
	};
	terminal: {
		state: WorktreeTerminalStateV1;
	};
	verify?: WorktreeVerifyMetadataV1;
	/** Boss/runtime acceptance re-entry. Does not skip ownership, dirty, or verify checks. */
	acceptance?: { source: "boss" };
};

export type WorktreeOwnershipDispositionV1 =
	| "verified"
	| "mismatch"
	| "secretary"
	| "main-session"
	| "unknown";

export type WorktreeDirtyDispositionV1 =
	| "clean"
	| "disjoint-main-wip"
	| "main-overlap"
	| "main-staged"
	| "worktree-dirty"
	| "unknown";

export type WorktreeConflictDispositionV1 =
	| "none"
	| "main-conflict"
	| "worktree-conflict"
	| "merge-conflict"
	| "dangerous-main-state"
	| "unknown";

export type WorktreeMergeDispositionV1 =
	| "not-attempted"
	| "already-integrated"
	| "merged"
	| "failed"
	| "conflicted";

export type WorktreeRecoveryDispositionV1 =
	| "none"
	| "retained"
	| "waiting-for-main"
	| "needs-fixer"
	| "needs-user"
	| "post-merge-verify";

export type WorktreeCleanupDispositionV1 =
	| "not-attempted"
	| "cleaned"
	| "retained-worktree"
	| "retained-branch"
	| "failed";

export type WorktreeFinalizationDispositionV1 = "merged" | "needs-user" | "needs-fixer" | "retained";

export type WorktreeVerifyDispositionV1 = {
	terminal: "none" | "passed" | "failed";
	postMerge: "not-requested" | "passed" | "failed" | "not-run";
	command?: string;
	argv?: string[];
	/** Exit reported by the terminal worker verification. */
	exitCode?: number;
	/** Exit produced by the post-merge verification runner. */
	postMergeExitCode?: number;
	/** The service-owned direct-argv runner reached its deadline. */
	postMergeTimedOut?: boolean;
	/** A caller-supplied AbortSignal stopped post-merge verification. */
	postMergeAborted?: boolean;
	outputTail?: string;
};

export type WorktreeRecoveryContractV1 = {
	disposition: WorktreeRecoveryDispositionV1;
	retryable: boolean;
	nextAction:
		| "none"
		| "retry-finalization"
		| "resume-worker"
		| "resolve-main-wip"
		| "resolve-conflict"
		| "rerun-post-merge-verify"
		| "retry-cleanup";
	reason: string;
	actionable: string[];
};

export type WorktreeFinalizationResultV1 = {
	schemaVersion: 1;
	agentId: string;
	runId: string;
	mainCwd: string;
	worktree: {
		path: string;
		branch: string;
	};
	terminal: WorktreeTerminalStateV1;
	disposition: WorktreeFinalizationDispositionV1;
	ownership: WorktreeOwnershipDispositionV1;
	dirty: WorktreeDirtyDispositionV1;
	conflict: WorktreeConflictDispositionV1;
	merge: WorktreeMergeDispositionV1;
	recovery: WorktreeRecoveryContractV1;
	cleanup: WorktreeCleanupDispositionV1;
	verify: WorktreeVerifyDispositionV1;
	messages: string[];
	updatedAt: string;
};

export type WorktreeFinalizationStateV1 = {
	schemaVersion: 1;
	input: WorktreeFinalizationInputV1;
	attempt: number;
	createdAt: string;
	updatedAt: string;
	phase: "completed" | "blocked" | "recovery";
	result: WorktreeFinalizationResultV1;
};

const TERMINAL_STATES = new Set<WorktreeTerminalStateV1>(["ok", "failed", "aborted", "interrupted"]);
const OWNERSHIP_MODES = new Set<WorktreeOwnershipModeV1>(["isolated", "direct", "main-session"]);
const OWNER_ROLES = new Set<WorktreeOwnerRoleV1>(["worker", "secretary"]);
const OWNERSHIP_DISPOSITIONS = new Set<WorktreeOwnershipDispositionV1>(["verified", "mismatch", "secretary", "main-session", "unknown"]);
const DIRTY_DISPOSITIONS = new Set<WorktreeDirtyDispositionV1>(["clean", "disjoint-main-wip", "main-overlap", "main-staged", "worktree-dirty", "unknown"]);
const CONFLICT_DISPOSITIONS = new Set<WorktreeConflictDispositionV1>(["none", "main-conflict", "worktree-conflict", "merge-conflict", "dangerous-main-state", "unknown"]);
const MERGE_DISPOSITIONS = new Set<WorktreeMergeDispositionV1>(["not-attempted", "already-integrated", "merged", "failed", "conflicted"]);
const RECOVERY_DISPOSITIONS = new Set<WorktreeRecoveryDispositionV1>(["none", "retained", "waiting-for-main", "needs-fixer", "needs-user", "post-merge-verify"]);
const CLEANUP_DISPOSITIONS = new Set<WorktreeCleanupDispositionV1>(["not-attempted", "cleaned", "retained-worktree", "retained-branch", "failed"]);
const FINALIZATION_DISPOSITIONS = new Set<WorktreeFinalizationDispositionV1>(["merged", "needs-user", "needs-fixer", "retained"]);
const VERIFY_TERMINAL_DISPOSITIONS = new Set<WorktreeVerifyDispositionV1["terminal"]>(["none", "passed", "failed"]);
const VERIFY_POST_MERGE_DISPOSITIONS = new Set<WorktreeVerifyDispositionV1["postMerge"]>(["not-requested", "passed", "failed", "not-run"]);
const NEXT_ACTIONS = new Set<WorktreeRecoveryContractV1["nextAction"]>(["none", "retry-finalization", "resume-worker", "resolve-main-wip", "resolve-conflict", "rerun-post-merge-verify", "retry-cleanup"]);

function diagnostic(code: string, path: string, message: string): WorktreeSchemaDiagnosticV1 {
	return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
	options: { required?: boolean; min?: number; max?: number; absolutePath?: boolean; allowNewlines?: boolean } = {},
): string | undefined {
	const value = source[key];
	if (value === undefined) {
		if (options.required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	if (typeof value !== "string") {
		diagnostics.push(diagnostic("invalid_string", `${path}.${key}`, "must be a string"));
		return undefined;
	}
	const min = options.min ?? 0;
	const max = options.max ?? 16_384;
	const invalidControls = options.allowNewlines
		? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
		: /[\u0000-\u001f]/.test(value);
	if (value.length < min || value.length > max || invalidControls) {
		diagnostics.push(diagnostic("invalid_string", `${path}.${key}`, `must contain ${min}...${max} printable characters`));
		return undefined;
	}
	if (options.required && !value.trim()) {
		diagnostics.push(diagnostic("empty_required_field", `${path}.${key}`, "must not be blank"));
		return undefined;
	}
	if (options.absolutePath && !/^(?:\/|\\\\|[A-Za-z]:[\\/])/.test(value)) {
		diagnostics.push(diagnostic("invalid_absolute_path", `${path}.${key}`, "must be an absolute path"));
		return undefined;
	}
	return value;
}

function integerField(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
): number | undefined {
	const value = source[key];
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value)) {
		diagnostics.push(diagnostic("invalid_integer", `${path}.${key}`, "must be a safe integer"));
		return undefined;
	}
	return value;
}

function booleanField(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
	required = false,
): boolean | undefined {
	const value = source[key];
	if (value === undefined) {
		if (required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	if (typeof value !== "boolean") {
		diagnostics.push(diagnostic("invalid_boolean", `${path}.${key}`, "must be a boolean"));
		return undefined;
	}
	return value;
}

function stringArrayField(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
	options: { required?: boolean; max?: number; nonEmpty?: boolean; allowNewlines?: boolean } = {},
): string[] | undefined {
	const value = source[key];
	if (value === undefined) {
		if (options.required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	if (!Array.isArray(value) || value.length > (options.max ?? 1_000)) {
		diagnostics.push(diagnostic("invalid_string_array", `${path}.${key}`, "must be an array of bounded strings"));
		return undefined;
	}
	const invalidEntry = (entry: unknown): boolean => typeof entry !== "string"
		|| entry.length > 100_000
		|| (options.allowNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(entry) : /[\u0000-\u001f]/.test(entry))
		|| (options.nonEmpty === true && !entry);
	if (value.some(invalidEntry)) {
		diagnostics.push(diagnostic("invalid_string_array", `${path}.${key}`, "must contain printable strings"));
		return undefined;
	}
	return [...value] as string[];
}

function enumField<T extends string>(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
	allowed: ReadonlySet<T>,
	message: string,
): T | undefined {
	const value = stringField(source, key, path, diagnostics, { required: true, min: 1, max: 128 });
	if (typeof value !== "string") return undefined;
	if (!allowed.has(value as T)) {
		diagnostics.push(diagnostic("invalid_enum", `${path}.${key}`, message));
		return undefined;
	}
	return value as T;
}

function resultExitCode(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: WorktreeSchemaDiagnosticV1[],
): number | undefined {
	const value = integerField(source, key, path, diagnostics);
	if (value !== undefined && (value < -255 || value > 255)) {
		diagnostics.push(diagnostic("invalid_verify_exit", `${path}.${key}`, "must be between -255 and 255"));
		return undefined;
	}
	return value;
}

function finish<T>(value: T | undefined, diagnostics: WorktreeSchemaDiagnosticV1[]): WorktreeDecodeResultV1<T> {
	return diagnostics.length > 0 || value === undefined ? { ok: false, diagnostics } : { ok: true, value, diagnostics };
}

/** Decode untrusted persisted/IPC input before handing it to the finalization service. */
export function decodeWorktreeFinalizationInputV1(raw: unknown): WorktreeDecodeResultV1<WorktreeFinalizationInputV1> {
	const diagnostics: WorktreeSchemaDiagnosticV1[] = [];
	if (!isRecord(raw)) return finish(undefined, [diagnostic("invalid_object", "$", "must be an object")]);
	if (raw.schemaVersion !== WORKTREE_FINALIZATION_SCHEMA_VERSION) {
		diagnostics.push(diagnostic("unsupported_schema_version", "$.schemaVersion", "must be schemaVersion 1"));
	}
	const agentId = stringField(raw, "agentId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const runId = stringField(raw, "runId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const mainCwd = stringField(raw, "mainCwd", "$", diagnostics, { required: true, min: 1, max: 8_192, absolutePath: true });
	if (!isRecord(raw.worktree)) {
		diagnostics.push(diagnostic("invalid_object", "$.worktree", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const worktreePath = stringField(raw.worktree, "path", "$.worktree", diagnostics, { required: true, min: 1, max: 8_192, absolutePath: true });
	const branch = stringField(raw.worktree, "branch", "$.worktree", diagnostics, { required: true, min: 1, max: 1_024 });
	if (typeof branch === "string" && branch.startsWith("-")) {
		diagnostics.push(diagnostic("invalid_branch", "$.worktree.branch", "must not start with -"));
	}
	if (!isRecord(raw.worktree.ownership)) {
		diagnostics.push(diagnostic("invalid_object", "$.worktree.ownership", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const ownership = raw.worktree.ownership;
	const mode = stringField(ownership, "mode", "$.worktree.ownership", diagnostics, { required: true, min: 1, max: 32 });
	const role = stringField(ownership, "role", "$.worktree.ownership", diagnostics, { required: true, min: 1, max: 32 });
	const ownerAgentId = stringField(ownership, "agentId", "$.worktree.ownership", diagnostics, { required: true, min: 1, max: 256 });
	const ownerRunId = stringField(ownership, "runId", "$.worktree.ownership", diagnostics, { required: true, min: 1, max: 256 });
	if (typeof mode === "string" && !OWNERSHIP_MODES.has(mode as WorktreeOwnershipModeV1)) {
		diagnostics.push(diagnostic("invalid_ownership_mode", "$.worktree.ownership.mode", "must be isolated, direct, or main-session"));
	}
	if (typeof role === "string" && !OWNER_ROLES.has(role as WorktreeOwnerRoleV1)) {
		diagnostics.push(diagnostic("invalid_owner_role", "$.worktree.ownership.role", "must be worker or secretary"));
	}
	if (!isRecord(raw.terminal)) {
		diagnostics.push(diagnostic("invalid_object", "$.terminal", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const terminalState = stringField(raw.terminal, "state", "$.terminal", diagnostics, { required: true, min: 1, max: 32 });
	if (typeof terminalState === "string" && !TERMINAL_STATES.has(terminalState as WorktreeTerminalStateV1)) {
		diagnostics.push(diagnostic("invalid_terminal_state", "$.terminal.state", "must be ok, failed, aborted, or interrupted"));
	}

	let verify: WorktreeVerifyMetadataV1 | undefined;
	if (raw.verify !== undefined) {
		if (!isRecord(raw.verify)) {
			diagnostics.push(diagnostic("invalid_object", "$.verify", "must be an object"));
		} else {
			const command = stringField(raw.verify, "command", "$.verify", diagnostics, { min: 1, max: 100_000 });
			const exitCode = integerField(raw.verify, "exitCode", "$.verify", diagnostics);
			let argv: string[] | undefined;
			if (raw.verify.argv !== undefined) {
				if (!Array.isArray(raw.verify.argv) || raw.verify.argv.length === 0 || raw.verify.argv.length > 256) {
					diagnostics.push(diagnostic("invalid_verify_argv", "$.verify.argv", "must be a non-empty array of at most 256 strings"));
				} else if (raw.verify.argv.some((entry) => typeof entry !== "string" || !entry || entry.length > 16_384 || /[\u0000]/.test(entry))) {
					diagnostics.push(diagnostic("invalid_verify_argv", "$.verify.argv", "must contain non-empty strings without NUL"));
				} else {
					argv = [...raw.verify.argv] as string[];
				}
			}
			if (exitCode !== undefined && (exitCode < -255 || exitCode > 255)) {
				diagnostics.push(diagnostic("invalid_verify_exit", "$.verify.exitCode", "must be between -255 and 255"));
			}
			verify = {
				...(typeof command === "string" ? { command } : {}),
				...(argv ? { argv } : {}),
				...(exitCode !== undefined ? { exitCode } : {}),
			};
		}
	}

	if (
		typeof agentId !== "string" ||
		typeof runId !== "string" ||
		typeof mainCwd !== "string" ||
		typeof worktreePath !== "string" ||
		typeof branch !== "string" ||
		typeof mode !== "string" ||
		typeof role !== "string" ||
		typeof ownerAgentId !== "string" ||
		typeof ownerRunId !== "string" ||
		typeof terminalState !== "string" ||
		!OWNERSHIP_MODES.has(mode as WorktreeOwnershipModeV1) ||
		!OWNER_ROLES.has(role as WorktreeOwnerRoleV1) ||
		!TERMINAL_STATES.has(terminalState as WorktreeTerminalStateV1) ||
		branch.startsWith("-")
	) {
		return finish(undefined, diagnostics);
	}

	return finish({
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		agentId,
		runId,
		mainCwd,
		worktree: {
			path: worktreePath,
			branch,
			ownership: {
				mode: mode as WorktreeOwnershipModeV1,
				role: role as WorktreeOwnerRoleV1,
				agentId: ownerAgentId,
				runId: ownerRunId,
			},
		},
		terminal: { state: terminalState as WorktreeTerminalStateV1 },
		...(verify ? { verify } : {}),
		...(raw.acceptance && isRecord(raw.acceptance) && raw.acceptance.source === "boss"
			? { acceptance: { source: "boss" as const } }
			: {}),
	}, diagnostics);
}

/** Decode a persisted finalization result independently of any live Git adapter. */
export function decodeWorktreeFinalizationResultV1(raw: unknown): WorktreeDecodeResultV1<WorktreeFinalizationResultV1> {
	const diagnostics: WorktreeSchemaDiagnosticV1[] = [];
	if (!isRecord(raw)) return finish(undefined, [diagnostic("invalid_object", "$", "must be an object")]);
	if (raw.schemaVersion !== WORKTREE_FINALIZATION_SCHEMA_VERSION) {
		diagnostics.push(diagnostic("unsupported_schema_version", "$.schemaVersion", "must be schemaVersion 1"));
	}
	const agentId = stringField(raw, "agentId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const runId = stringField(raw, "runId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const mainCwd = stringField(raw, "mainCwd", "$", diagnostics, { required: true, min: 1, max: 8_192, absolutePath: true });
	if (!isRecord(raw.worktree)) {
		diagnostics.push(diagnostic("invalid_object", "$.worktree", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const worktreePath = stringField(raw.worktree, "path", "$.worktree", diagnostics, { required: true, min: 1, max: 8_192, absolutePath: true });
	const branch = stringField(raw.worktree, "branch", "$.worktree", diagnostics, { required: true, min: 1, max: 1_024 });
	if (typeof branch === "string" && branch.startsWith("-")) {
		diagnostics.push(diagnostic("invalid_branch", "$.worktree.branch", "must not start with -"));
	}
	const terminal = enumField(raw, "terminal", "$", diagnostics, TERMINAL_STATES, "must be a terminal state");
	const disposition = enumField(raw, "disposition", "$", diagnostics, FINALIZATION_DISPOSITIONS, "must be a finalization disposition");
	const ownership = enumField(raw, "ownership", "$", diagnostics, OWNERSHIP_DISPOSITIONS, "must be an ownership disposition");
	const dirty = enumField(raw, "dirty", "$", diagnostics, DIRTY_DISPOSITIONS, "must be a dirty disposition");
	const conflict = enumField(raw, "conflict", "$", diagnostics, CONFLICT_DISPOSITIONS, "must be a conflict disposition");
	const merge = enumField(raw, "merge", "$", diagnostics, MERGE_DISPOSITIONS, "must be a merge disposition");
	const cleanup = enumField(raw, "cleanup", "$", diagnostics, CLEANUP_DISPOSITIONS, "must be a cleanup disposition");
	const updatedAt = stringField(raw, "updatedAt", "$", diagnostics, { required: true, min: 1, max: 128 });
	const messages = stringArrayField(raw, "messages", "$", diagnostics, { required: true, max: 1_000, allowNewlines: true });

	if (!isRecord(raw.recovery)) {
		diagnostics.push(diagnostic("invalid_object", "$.recovery", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const recoveryDisposition = enumField(raw.recovery, "disposition", "$.recovery", diagnostics, RECOVERY_DISPOSITIONS, "must be a recovery disposition");
	const retryable = booleanField(raw.recovery, "retryable", "$.recovery", diagnostics, true);
	const nextAction = enumField(raw.recovery, "nextAction", "$.recovery", diagnostics, NEXT_ACTIONS, "must be a known recovery action");
	const reason = stringField(raw.recovery, "reason", "$.recovery", diagnostics, { required: true, min: 1, max: 100_000, allowNewlines: true });
	const actionable = stringArrayField(raw.recovery, "actionable", "$.recovery", diagnostics, { required: true, max: 256, allowNewlines: true });

	if (!isRecord(raw.verify)) {
		diagnostics.push(diagnostic("invalid_object", "$.verify", "must be an object"));
		return finish(undefined, diagnostics);
	}
	const verifyTerminal = enumField(raw.verify, "terminal", "$.verify", diagnostics, VERIFY_TERMINAL_DISPOSITIONS, "must be a terminal verify disposition");
	const postMerge = enumField(raw.verify, "postMerge", "$.verify", diagnostics, VERIFY_POST_MERGE_DISPOSITIONS, "must be a post-merge verify disposition");
	const command = stringField(raw.verify, "command", "$.verify", diagnostics, { min: 1, max: 100_000, allowNewlines: true });
	const argv = stringArrayField(raw.verify, "argv", "$.verify", diagnostics, { max: 256, nonEmpty: true });
	const exitCode = resultExitCode(raw.verify, "exitCode", "$.verify", diagnostics);
	const postMergeExitCode = resultExitCode(raw.verify, "postMergeExitCode", "$.verify", diagnostics);
	const postMergeTimedOut = booleanField(raw.verify, "postMergeTimedOut", "$.verify", diagnostics);
	const postMergeAborted = booleanField(raw.verify, "postMergeAborted", "$.verify", diagnostics);
	const outputTail = stringField(raw.verify, "outputTail", "$.verify", diagnostics, { min: 0, max: 2_000, allowNewlines: true });

	if (
		typeof agentId !== "string" || typeof runId !== "string" || typeof mainCwd !== "string"
		|| typeof worktreePath !== "string" || typeof branch !== "string" || branch.startsWith("-")
		|| terminal === undefined || disposition === undefined || ownership === undefined || dirty === undefined
		|| conflict === undefined || merge === undefined || cleanup === undefined || typeof updatedAt !== "string"
		|| !messages || recoveryDisposition === undefined || retryable === undefined || nextAction === undefined
		|| typeof reason !== "string" || !actionable || verifyTerminal === undefined || postMerge === undefined
	) {
		return finish(undefined, diagnostics);
	}
	return finish({
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		agentId,
		runId,
		mainCwd,
		worktree: { path: worktreePath, branch },
		terminal,
		disposition,
		ownership,
		dirty,
		conflict,
		merge,
		recovery: { disposition: recoveryDisposition, retryable, nextAction, reason, actionable },
		cleanup,
		verify: {
			terminal: verifyTerminal,
			postMerge,
			...(typeof command === "string" ? { command } : {}),
			...(argv ? { argv } : {}),
			...(exitCode !== undefined ? { exitCode } : {}),
			...(postMergeExitCode !== undefined ? { postMergeExitCode } : {}),
			...(postMergeTimedOut !== undefined ? { postMergeTimedOut } : {}),
			...(postMergeAborted !== undefined ? { postMergeAborted } : {}),
			...(typeof outputTail === "string" ? { outputTail } : {}),
		},
		messages,
		updatedAt,
	}, diagnostics);
}

/** Guard JSON restored from a host-owned state store before retrying it. */
export function decodeWorktreeFinalizationStateV1(raw: unknown): WorktreeDecodeResultV1<WorktreeFinalizationStateV1> {
	const diagnostics: WorktreeSchemaDiagnosticV1[] = [];
	if (!isRecord(raw)) return finish(undefined, [diagnostic("invalid_object", "$", "must be an object")]);
	if (raw.schemaVersion !== WORKTREE_FINALIZATION_SCHEMA_VERSION) {
		diagnostics.push(diagnostic("unsupported_schema_version", "$.schemaVersion", "must be schemaVersion 1"));
	}
	const input = decodeWorktreeFinalizationInputV1(raw.input);
	if (!input.ok) diagnostics.push(...input.diagnostics.map((entry) => ({ ...entry, path: entry.path.replace(/^\$/, "$.input") })));
	const attempt = raw.attempt;
	if (!Number.isSafeInteger(attempt) || attempt < 1) diagnostics.push(diagnostic("invalid_attempt", "$.attempt", "must be a positive safe integer"));
	const createdAt = stringField(raw, "createdAt", "$", diagnostics, { required: true, min: 1, max: 128 });
	const updatedAt = stringField(raw, "updatedAt", "$", diagnostics, { required: true, min: 1, max: 128 });
	const phase = stringField(raw, "phase", "$", diagnostics, { required: true, min: 1, max: 32 });
	if (phase !== "completed" && phase !== "blocked" && phase !== "recovery") {
		diagnostics.push(diagnostic("invalid_phase", "$.phase", "must be completed, blocked, or recovery"));
	}
	const result = decodeWorktreeFinalizationResultV1(raw.result);
	if (!result.ok) diagnostics.push(...result.diagnostics.map((entry) => ({ ...entry, path: entry.path.replace(/^\$/, "$.result") })));
	if (!input.ok || !result.ok || !Number.isSafeInteger(attempt) || attempt < 1 || typeof createdAt !== "string" || typeof updatedAt !== "string" || (phase !== "completed" && phase !== "blocked" && phase !== "recovery")) {
		return finish(undefined, diagnostics);
	}
	return finish({
		schemaVersion: WORKTREE_FINALIZATION_SCHEMA_VERSION,
		input: input.value,
		attempt,
		createdAt,
		updatedAt,
		phase,
		result: result.value,
	}, diagnostics);
}

export function terminalVerifyDispositionV1(verify: WorktreeVerifyMetadataV1 | undefined): WorktreeVerifyDispositionV1["terminal"] {
	if (!verify || (verify.command === undefined && verify.argv === undefined && verify.exitCode === undefined)) return "none";
	return verify.exitCode !== undefined && verify.exitCode !== 0 ? "failed" : "passed";
}

export function verifyDisplayCommandV1(verify: WorktreeVerifyMetadataV1 | undefined): string | undefined {
	if (verify?.command) return verify.command;
	return verify?.argv?.join(" ");
}

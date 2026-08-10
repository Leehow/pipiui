/**
 * Stable, framework-neutral subagent host protocol v1.
 *
 * This module intentionally uses only TypeScript and Node-compatible JSON values.
 * It is safe to import from an Electron main process, a plain Node service, or a
 * Pi extension adapter. See HOST_PROTOCOL.md for ownership and compatibility rules.
 */

export const HOST_PROTOCOL_SCHEMA_VERSION = 1 as const;
export const UNKNOWN_FIELD_POLICY = "preserve-with-warning" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonRecord | JsonValue[];
export type JsonRecord = { [key: string]: JsonValue };

export type ProtocolDiagnostic = {
	code: string;
	path: string;
	message: string;
	severity: "error" | "warning";
};

export type DecodeResult<T> =
	| { ok: true; value: T; diagnostics: ProtocolDiagnostic[] }
	| { ok: false; diagnostics: ProtocolDiagnostic[] };

export type PlatformCapabilityDescriptorV1 = {
	available: boolean;
	protocolVersion?: number;
	/** Opaque per-session capability. It is never a TCC implementation or geometry payload. */
	routingCapability?: string;
	/** Optional host-owned file used by the matching extension, for example a search grant file. */
	grantFile?: string;
	label?: string;
	extensions?: JsonRecord;
};

export type HostCapabilitiesV1 = {
	schemaVersion: 1;
	bridge: {
		host?: "127.0.0.1" | "::1";
		port: number;
		rpcPath?: "/rpc";
		sessionCapability: string;
		extensions?: JsonRecord;
	};
	/** Session identity is descriptive; authorization always uses bridge.sessionCapability. */
	session: {
		id?: string;
		agentDepth?: number;
		maxAgentDepth?: number;
		/** Mirrors the extension's PIPIUI_SKILL_READ_BLOCK boolean policy. */
		skillReadBlock?: boolean;
		extensions?: JsonRecord;
	};
	mainCwd: string;
	extensions: {
		subagent?: string;
		agentsDir?: string;
		searchScope?: string;
		webSearch?: string;
		mcp?: string;
		pdf?: string;
		/** Signed/local helper path paired with the PDF extension when available. */
		pdfHelper?: string;
		github?: string;
		arxiv?: string;
		computer?: string;
		extensions?: JsonRecord;
	};
	modelFiles: {
		mainModelFile?: string;
		subagentModelsFile?: string;
		subagentModelCapabilitiesFile?: string;
		extensions?: JsonRecord;
	};
	/** Platform descriptors only advertise host routes. They do not embed TCC state or display geometry. */
	platform?: {
		computer?: PlatformCapabilityDescriptorV1;
		search?: PlatformCapabilityDescriptorV1;
		memory?: PlatformCapabilityDescriptorV1;
		extensions?: JsonRecord;
	};
	extensions?: JsonRecord;
};

export type AgentEventKindV1 = "start" | "update" | "log_delta" | "log" | "usage" | "stalled" | "end" | "closeout";
/** The live extension currently emits only a handled/cleaned closeout. */
export type AgentCloseoutDispositionV1 = "cleaned";
export type AgentLogItemV1 = {
	itemType: "text" | "thinking" | "tool" | "toolResult";
	name?: string;
	text: string;
	isError?: boolean;
	extensions?: JsonRecord;
};

export type AgentUsageV1 = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
	contextTokens?: number;
	contextWindow?: number;
	extensions?: JsonRecord;
};

export type AgentEventBaseV1 = {
	schemaVersion: 1;
	kind: AgentEventKindV1;
	agentId: string;
	runId: string;
	at?: string;
	extensions?: JsonRecord;
};

/** Fields mirror the live `PiExt/subagent/index.ts` reports consumed by `SubagentStore.applyAgentEvent`. */
export type AgentEventV1 = AgentEventBaseV1 & {
	parentId?: string | null;
	toolCallId?: string | null;
	name?: string;
	task?: string;
	title?: string;
	depth?: number;
	model?: string | null;
	background?: boolean;
	output?: string;
	activity?: string;
	cost?: number;
	turns?: number;
	contentIndex?: number;
	itemType?: AgentLogItemV1["itemType"];
	text?: string;
	items?: AgentLogItemV1[];
	turn?: number;
	tools?: string[];
	usage?: AgentUsageV1;
	idle?: number;
	ok?: boolean;
	aborted?: boolean;
	interrupted?: boolean;
	vanished?: boolean;
	/** Explicit wire state accepted from live/replayed stalled reports. */
	stalled?: boolean;
	contextTokens?: number;
	stopReason?: string | null;
	worktreePath?: string;
	worktreeBranch?: string;
	worktreeError?: string;
	verifyCommand?: string;
	verifyExit?: number;
	memoryBrokerCapability?: string;
	memoryRole?: string;
	desktopGrant?: string;
	computerCapability?: string;
	/** Explicit handled disposition; accepted only for a terminal failed/aborted/interrupted run. */
	disposition?: AgentCloseoutDispositionV1;
	reason?: string;
	/** Producer wall-clock millis for display only; receipt order remains host-owned. */
	closeoutAt?: number;
};

export type PlanTaskStateV1 = "pending" | "running" | "completed" | "failed" | "blocked" | "skipped";
export type PlanTaskV1 = {
	id: string;
	title: string;
	state: PlanTaskStateV1;
	detail?: string;
	error?: string;
	extensions?: JsonRecord;
};

/** `task_update` deliberately preserves the distinction between an absent title and an empty one. */
export type PlanTaskUpdateV1 = {
	id: string;
	state: PlanTaskStateV1;
	title?: string;
	detail?: string;
	error?: string;
	extensions?: JsonRecord;
};

export type PlanEventV1 =
	| {
			schemaVersion: 1;
			event: "publish";
			plan: { id: string; title: string; summary?: string; tasks: PlanTaskV1[]; extensions?: JsonRecord };
			at?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			event: "task_update";
			planId: string;
			task: PlanTaskUpdateV1;
			at?: string;
			extensions?: JsonRecord;
		}
	| { schemaVersion: 1; event: "approve" | "cancel"; planId: string; at?: string; extensions?: JsonRecord };

/** Response is store-owned: callers never send a revision. */
export type PlanRevisionResponseV1 = {
	schemaVersion: 1;
	ok: boolean;
	applied: boolean;
	revision?: number;
	currentRevision?: number;
	error?: string;
	extensions?: JsonRecord;
};

export type JobStateV1 = "running" | "ok" | "failed" | "aborted" | "interrupted";
export type JobProjectionV1 = {
	agentId: string;
	runId: string;
	name: string;
	task: string;
	state: JobStateV1;
	title?: string;
	blockedBy?: string[];
	startedAt?: number;
	endedAt?: number;
	activity?: string;
	cost?: number;
	turns?: number;
	resultText?: string;
	stalled?: boolean;
	closeoutDisposition?: AgentCloseoutDispositionV1;
	closeoutReason?: string;
	closeoutAt?: number;
	extensions?: JsonRecord;
};

/** Reconnect display projection only. It never schedules, resumes, or kills a job. */
export type JobsSnapshotV1 = {
	schemaVersion: 1;
	generatedAt: string;
	jobs: JobProjectionV1[];
	extensions?: JsonRecord;
};

export type HostCommandActionV1 = "agent_event" | "plan_event" | "abort" | "recover" | "snapshot" | "prompt" | "platform";

export type HostCommandV1 =
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "agent_event";
			event: AgentEventV1;
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "plan_event";
			event: PlanEventV1;
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "abort";
			agentId: string;
			runId?: string;
			reason?: string;
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "recover";
			agentId: string;
			runId?: string;
			fresh?: boolean;
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "snapshot";
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "prompt";
			message: string;
			requestId?: string;
			extensions?: JsonRecord;
		}
	| {
			schemaVersion: 1;
			sessionCapability: string;
			action: "platform";
			platform: "computer" | "search" | "memory";
			operation: string;
			payload?: JsonValue;
			requestId?: string;
			extensions?: JsonRecord;
		};

export type HostCommandAckV1 = {
	schemaVersion: 1;
	ok: boolean;
	action: HostCommandActionV1;
	accepted?: boolean;
	message?: string;
	diagnostics?: ProtocolDiagnostic[];
	requestId?: string;
	result?: JsonValue;
};

export type HostRpcResponseV1 = HostCommandAckV1 | (PlanRevisionResponseV1 & { action: "plan_event"; requestId?: string }) | (JobsSnapshotV1 & { action: "snapshot"; ok: true; requestId?: string });

export type LegacyBridgeUpgradeContextV1 = {
	/** Required only for current update/log/usage/stalled reports that predate runId. */
	runId?: string;
};

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const AGENT_KINDS = new Set<AgentEventKindV1>(["start", "update", "log_delta", "log", "usage", "stalled", "end", "closeout"]);
const PLAN_STATES = new Set<PlanTaskStateV1>(["pending", "running", "completed", "failed", "blocked", "skipped"]);
const JOB_STATES = new Set<JobStateV1>(["running", "ok", "failed", "aborted", "interrupted"]);
const LOG_ITEM_TYPES = new Set<AgentLogItemV1["itemType"]>(["text", "thinking", "tool", "toolResult"]);
const HOST_ACTIONS = new Set<HostCommandActionV1>(["agent_event", "plan_event", "abort", "recover", "snapshot", "prompt", "platform"]);

function diagnostic(code: string, path: string, message: string, severity: ProtocolDiagnostic["severity"] = "error"): ProtocolDiagnostic {
	return { code, path, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function isSafeJson(value: unknown, path: string, diagnostics: ProtocolDiagnostic[], depth = 0): value is JsonValue {
	if (depth > 32) {
		diagnostics.push(diagnostic("max_depth", path, "JSON value exceeds maximum nesting depth"));
		return false;
	}
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) diagnostics.push(diagnostic("invalid_number", path, "number must be finite"));
		return Number.isFinite(value);
	}
	if (Array.isArray(value)) return value.every((entry, index) => isSafeJson(entry, `${path}[${index}]`, diagnostics, depth + 1));
	if (!isRecord(value)) {
		diagnostics.push(diagnostic("invalid_json_value", path, "value must be JSON-compatible"));
		return false;
	}
	let safe = true;
	for (const [key, entry] of Object.entries(value)) {
		if (DANGEROUS_KEYS.has(key)) {
			diagnostics.push(diagnostic("dangerous_key", `${path}.${key}`, "prototype-mutating keys are forbidden"));
			safe = false;
			continue;
		}
		if (!isSafeJson(entry, `${path}.${key}`, diagnostics, depth + 1)) safe = false;
	}
	return safe;
}

function requireRecord(value: unknown, path: string, diagnostics: ProtocolDiagnostic[]): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		diagnostics.push(diagnostic("invalid_object", path, "must be an object"));
		return undefined;
	}
	isSafeJson(value, path, diagnostics);
	return value;
}

function requireVersion(source: Record<string, unknown>, path: string, diagnostics: ProtocolDiagnostic[]): 1 | undefined {
	if (source.schemaVersion !== HOST_PROTOCOL_SCHEMA_VERSION) {
		diagnostics.push(diagnostic("unsupported_schema_version", `${path}.schemaVersion`, "must be integer schemaVersion 1"));
		return undefined;
	}
	return HOST_PROTOCOL_SCHEMA_VERSION;
}

function stringValue(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: ProtocolDiagnostic[],
	options: { required?: boolean; allowNull?: boolean; max?: number; min?: number } = {},
): string | null | undefined {
	const present = hasOwn(source, key);
	if (!present) {
		if (options.required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	const value = source[key];
	if (value === null && options.allowNull) return null;
	if (typeof value !== "string") {
		diagnostics.push(diagnostic("invalid_string", `${path}.${key}`, "must be a string"));
		return undefined;
	}
	const min = options.min ?? 0;
	const max = options.max ?? 100_000;
	if (value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) {
		diagnostics.push(diagnostic("invalid_string", `${path}.${key}`, `must be ${min}...${max} printable characters`));
		return undefined;
	}
	if (options.required && !value.trim()) {
		diagnostics.push(diagnostic("empty_required_field", `${path}.${key}`, "must not be blank"));
		return undefined;
	}
	return value;
}

function integerValue(
	source: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: ProtocolDiagnostic[],
	options: { required?: boolean; min?: number; max?: number } = {},
): number | undefined {
	if (!hasOwn(source, key)) {
		if (options.required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	const value = source[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < (options.min ?? Number.MIN_SAFE_INTEGER) || value > (options.max ?? Number.MAX_SAFE_INTEGER)) {
		diagnostics.push(diagnostic("invalid_integer", `${path}.${key}`, "must be an integer in range"));
		return undefined;
	}
	return value;
}

function finiteNumberValue(source: Record<string, unknown>, key: string, path: string, diagnostics: ProtocolDiagnostic[], min = 0): number | undefined {
	if (!hasOwn(source, key)) return undefined;
	const value = source[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
		diagnostics.push(diagnostic("invalid_number", `${path}.${key}`, "must be a finite number in range"));
		return undefined;
	}
	return value;
}

function booleanValue(source: Record<string, unknown>, key: string, path: string, diagnostics: ProtocolDiagnostic[], required = false): boolean | undefined {
	if (!hasOwn(source, key)) {
		if (required) diagnostics.push(diagnostic("missing_required_field", `${path}.${key}`, "is required"));
		return undefined;
	}
	if (typeof source[key] !== "boolean") {
		diagnostics.push(diagnostic("invalid_boolean", `${path}.${key}`, "must be a boolean"));
		return undefined;
	}
	return source[key] as boolean;
}

function absolutePathValue(source: Record<string, unknown>, key: string, path: string, diagnostics: ProtocolDiagnostic[], required = false): string | undefined {
	const value = stringValue(source, key, path, diagnostics, { required, min: 1, max: 8_192 });
	if (typeof value !== "string") return undefined;
	if (!/^(?:\/|\\\\|[A-Za-z]:[\\/])/.test(value)) {
		diagnostics.push(diagnostic("invalid_absolute_path", `${path}.${key}`, "must be an absolute POSIX, UNC, or Windows path"));
		return undefined;
	}
	return value;
}

function extensionsFor(source: Record<string, unknown>, known: readonly string[], path: string, diagnostics: ProtocolDiagnostic[]): JsonRecord | undefined {
	const knownKeys = new Set(known);
	const extra: JsonRecord = {};
	for (const [key, value] of Object.entries(source)) {
		if (knownKeys.has(key)) continue;
		extra[key] = value as JsonValue;
		diagnostics.push(diagnostic("unknown_field_preserved", `${path}.${key}`, "unknown field preserved under extensions", "warning"));
	}
	return Object.keys(extra).length > 0 ? extra : undefined;
}

function finish<T>(value: T | undefined, diagnostics: ProtocolDiagnostic[]): DecodeResult<T> {
	return diagnostics.some((entry) => entry.severity === "error") || value === undefined
		? { ok: false, diagnostics }
		: { ok: true, value, diagnostics };
}

function optionalKnownStrings(source: Record<string, unknown>, target: Record<string, unknown>, keys: readonly string[], path: string, diagnostics: ProtocolDiagnostic[]): void {
	for (const key of keys) {
		const value = stringValue(source, key, path, diagnostics, { max: 100_000, allowNull: key === "parentId" || key === "toolCallId" || key === "model" || key === "stopReason" });
		if (value !== undefined) target[key] = value;
	}
}

function optionalKnownBooleans(source: Record<string, unknown>, target: Record<string, unknown>, keys: readonly string[], path: string, diagnostics: ProtocolDiagnostic[]): void {
	for (const key of keys) {
		const value = booleanValue(source, key, path, diagnostics);
		if (value !== undefined) target[key] = value;
	}
}

function optionalKnownNumbers(source: Record<string, unknown>, target: Record<string, unknown>, keys: readonly string[], path: string, diagnostics: ProtocolDiagnostic[]): void {
	for (const key of keys) {
		const value = finiteNumberValue(source, key, path, diagnostics, 0);
		if (value !== undefined) target[key] = value;
	}
}

function optionalKnownIntegers(source: Record<string, unknown>, target: Record<string, unknown>, keys: readonly string[], path: string, diagnostics: ProtocolDiagnostic[], min = 0): void {
	for (const key of keys) {
		const value = integerValue(source, key, path, diagnostics, { min, max: Number.MAX_SAFE_INTEGER });
		if (value !== undefined) target[key] = value;
	}
}

function decodePlatformDescriptorV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[]): PlatformCapabilityDescriptorV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const available = booleanValue(source, "available", path, diagnostics, true);
	const protocolVersion = integerValue(source, "protocolVersion", path, diagnostics, { min: 1, max: 1_000_000 });
	const routingCapability = stringValue(source, "routingCapability", path, diagnostics, { min: 16, max: 4_096 });
	const grantFile = absolutePathValue(source, "grantFile", path, diagnostics);
	const label = stringValue(source, "label", path, diagnostics, { max: 1_000 });
	const extensions = extensionsFor(source, ["available", "protocolVersion", "routingCapability", "grantFile", "label"], path, diagnostics);
	if (available === undefined) return undefined;
	return {
		available,
		...(protocolVersion !== undefined ? { protocolVersion } : {}),
		...(typeof routingCapability === "string" ? { routingCapability } : {}),
		...(typeof grantFile === "string" ? { grantFile } : {}),
		...(typeof label === "string" ? { label } : {}),
		...(extensions ? { extensions } : {}),
	};
}

export function decodeHostCapabilitiesV1(raw: unknown): DecodeResult<HostCapabilitiesV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source || requireVersion(source, "$", diagnostics) === undefined) return finish(undefined, diagnostics);
	const bridge = requireRecord(source.bridge, "$.bridge", diagnostics);
	const session = requireRecord(source.session, "$.session", diagnostics);
	const extensionPaths = requireRecord(source.extensions, "$.extensions", diagnostics);
	const modelFiles = requireRecord(source.modelFiles, "$.modelFiles", diagnostics);
	const mainCwd = absolutePathValue(source, "mainCwd", "$", diagnostics, true);
	if (!bridge || !session || !extensionPaths || !modelFiles || !mainCwd) return finish(undefined, diagnostics);

	const port = integerValue(bridge, "port", "$.bridge", diagnostics, { required: true, min: 1, max: 65_535 });
	const sessionCapability = stringValue(bridge, "sessionCapability", "$.bridge", diagnostics, { required: true, min: 16, max: 4_096 });
	const host = stringValue(bridge, "host", "$.bridge", diagnostics, { max: 16 });
	if (host !== undefined && host !== "127.0.0.1" && host !== "::1") diagnostics.push(diagnostic("invalid_bridge_host", "$.bridge.host", "must be 127.0.0.1 or ::1"));
	const rpcPath = stringValue(bridge, "rpcPath", "$.bridge", diagnostics, { max: 64 });
	if (rpcPath !== undefined && rpcPath !== "/rpc") diagnostics.push(diagnostic("invalid_rpc_path", "$.bridge.rpcPath", "must be /rpc"));

	const sessionId = stringValue(session, "id", "$.session", diagnostics, { max: 1_024 });
	const agentDepth = integerValue(session, "agentDepth", "$.session", diagnostics, { min: 0, max: 1_000 });
	const maxAgentDepth = integerValue(session, "maxAgentDepth", "$.session", diagnostics, { min: 0, max: 1_000 });
	const skillReadBlock = booleanValue(session, "skillReadBlock", "$.session", diagnostics);
	if (agentDepth !== undefined && maxAgentDepth !== undefined && agentDepth > maxAgentDepth) diagnostics.push(diagnostic("invalid_depth_range", "$.session", "agentDepth must not exceed maxAgentDepth"));

	const extensionResult: Record<string, unknown> = {};
	for (const key of ["subagent", "agentsDir", "searchScope", "webSearch", "mcp", "pdf", "pdfHelper", "github", "arxiv", "computer"] as const) {
		const value = absolutePathValue(extensionPaths, key, "$.extensions", diagnostics);
		if (value !== undefined) extensionResult[key] = value;
	}
	const modelFileResult: Record<string, unknown> = {};
	for (const key of ["mainModelFile", "subagentModelsFile", "subagentModelCapabilitiesFile"] as const) {
		const value = absolutePathValue(modelFiles, key, "$.modelFiles", diagnostics);
		if (value !== undefined) modelFileResult[key] = value;
	}

	let platform: HostCapabilitiesV1["platform"];
	if (source.platform !== undefined) {
		const platformSource = requireRecord(source.platform, "$.platform", diagnostics);
		if (platformSource) {
			const parsed: NonNullable<HostCapabilitiesV1["platform"]> = {};
			for (const key of ["computer", "search", "memory"] as const) {
				if (platformSource[key] === undefined) continue;
				const descriptor = decodePlatformDescriptorV1(platformSource[key], `$.platform.${key}`, diagnostics);
				if (descriptor) parsed[key] = descriptor;
			}
			const extra = extensionsFor(platformSource, ["computer", "search", "memory"], "$.platform", diagnostics);
			if (extra) parsed.extensions = extra;
			platform = parsed;
		}
	}

	const bridgeExtensions = extensionsFor(bridge, ["host", "port", "rpcPath", "sessionCapability"], "$.bridge", diagnostics);
	const sessionExtensions = extensionsFor(session, ["id", "agentDepth", "maxAgentDepth", "skillReadBlock"], "$.session", diagnostics);
	const extensionExtensions = extensionsFor(extensionPaths, ["subagent", "agentsDir", "searchScope", "webSearch", "mcp", "pdf", "pdfHelper", "github", "arxiv", "computer"], "$.extensions", diagnostics);
	const modelExtensions = extensionsFor(modelFiles, ["mainModelFile", "subagentModelsFile", "subagentModelCapabilitiesFile"], "$.modelFiles", diagnostics);
	const extensions = extensionsFor(source, ["schemaVersion", "bridge", "session", "mainCwd", "extensions", "modelFiles", "platform"], "$", diagnostics);
	if (port === undefined || typeof sessionCapability !== "string") return finish(undefined, diagnostics);
	return finish({
		schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION,
		bridge: {
			port,
			sessionCapability,
			...(host ? { host: host as "127.0.0.1" | "::1" } : {}),
			...(rpcPath ? { rpcPath: rpcPath as "/rpc" } : {}),
			...(bridgeExtensions ? { extensions: bridgeExtensions } : {}),
		},
		session: {
			...(typeof sessionId === "string" ? { id: sessionId } : {}),
			...(agentDepth !== undefined ? { agentDepth } : {}),
			...(maxAgentDepth !== undefined ? { maxAgentDepth } : {}),
			...(skillReadBlock !== undefined ? { skillReadBlock } : {}),
			...(sessionExtensions ? { extensions: sessionExtensions } : {}),
		},
		mainCwd,
		extensions: { ...extensionResult, ...(extensionExtensions ? { extensions: extensionExtensions } : {}) },
		modelFiles: { ...modelFileResult, ...(modelExtensions ? { extensions: modelExtensions } : {}) },
		...(platform ? { platform } : {}),
		...(extensions ? { extensions } : {}),
	} as HostCapabilitiesV1, diagnostics);
}

function decodeLogItemV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[]): AgentLogItemV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const itemType = stringValue(source, "itemType", path, diagnostics, { required: true, max: 32 });
	if (typeof itemType === "string" && !LOG_ITEM_TYPES.has(itemType as AgentLogItemV1["itemType"])) diagnostics.push(diagnostic("invalid_log_item_type", `${path}.itemType`, "must be text, thinking, tool, or toolResult"));
	const text = stringValue(source, "text", path, diagnostics, { required: true, max: 100_000 });
	const name = stringValue(source, "name", path, diagnostics, { max: 1_000 });
	const isError = booleanValue(source, "isError", path, diagnostics);
	const extensions = extensionsFor(source, ["itemType", "text", "name", "isError"], path, diagnostics);
	if (typeof itemType !== "string" || typeof text !== "string" || !LOG_ITEM_TYPES.has(itemType as AgentLogItemV1["itemType"])) return undefined;
	return { itemType: itemType as AgentLogItemV1["itemType"], text, ...(typeof name === "string" ? { name } : {}), ...(isError !== undefined ? { isError } : {}), ...(extensions ? { extensions } : {}) };
}

function decodeUsageV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[]): AgentUsageV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const output: AgentUsageV1 = {};
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "contextTokens", "contextWindow"] as const) {
		const value = integerValue(source, key, path, diagnostics, { min: 0, max: Number.MAX_SAFE_INTEGER });
		if (value !== undefined) output[key] = value;
	}
	const cost = finiteNumberValue(source, "cost", path, diagnostics, 0);
	if (cost !== undefined) output.cost = cost;
	const extensions = extensionsFor(source, ["input", "output", "cacheRead", "cacheWrite", "cost", "contextTokens", "contextWindow"], path, diagnostics);
	if (extensions) output.extensions = extensions;
	return output;
}

export function decodeAgentEventV1(raw: unknown): DecodeResult<AgentEventV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source || requireVersion(source, "$", diagnostics) === undefined) return finish(undefined, diagnostics);
	const kind = stringValue(source, "kind", "$", diagnostics, { required: true, max: 32 });
	if (typeof kind === "string" && !AGENT_KINDS.has(kind as AgentEventKindV1)) diagnostics.push(diagnostic("unknown_agent_event_kind", "$.kind", "must be a known AgentEventV1 kind"));
	const agentId = stringValue(source, "agentId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const runId = stringValue(source, "runId", "$", diagnostics, { required: true, min: 1, max: 256 });
	const at = stringValue(source, "at", "$", diagnostics, { max: 128 });
	if (typeof kind !== "string" || !AGENT_KINDS.has(kind as AgentEventKindV1) || typeof agentId !== "string" || typeof runId !== "string") return finish(undefined, diagnostics);

	const event: Record<string, unknown> = { schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, kind, agentId, runId };
	if (typeof at === "string") event.at = at;
	optionalKnownStrings(source, event, ["parentId", "toolCallId", "name", "task", "title", "model", "output", "activity", "text", "stopReason", "worktreePath", "worktreeBranch", "worktreeError", "verifyCommand", "memoryBrokerCapability", "memoryRole", "desktopGrant", "computerCapability", "reason"], "$", diagnostics);
	optionalKnownBooleans(source, event, ["background", "ok", "aborted", "interrupted", "vanished", "stalled"], "$", diagnostics);
	optionalKnownNumbers(source, event, ["cost"], "$", diagnostics);
	optionalKnownIntegers(source, event, ["depth", "turns", "contentIndex", "turn", "idle", "contextTokens", "closeoutAt"], "$", diagnostics);
	optionalKnownIntegers(source, event, ["verifyExit"], "$", diagnostics, -1);

	if (source.itemType !== undefined) {
		const itemType = stringValue(source, "itemType", "$", diagnostics, { max: 32 });
		if (typeof itemType === "string" && LOG_ITEM_TYPES.has(itemType as AgentLogItemV1["itemType"])) event.itemType = itemType;
		else if (itemType !== undefined) diagnostics.push(diagnostic("invalid_log_item_type", "$.itemType", "must be text, thinking, tool, or toolResult"));
	}
	if (source.disposition !== undefined) {
		const disposition = stringValue(source, "disposition", "$", diagnostics, { max: 32 });
		if (disposition === "cleaned") event.disposition = disposition;
		else if (disposition !== undefined) diagnostics.push(diagnostic("invalid_closeout_disposition", "$.disposition", "must be cleaned"));
	}
	if (source.items !== undefined) {
		if (!Array.isArray(source.items) || source.items.length > 800) {
			diagnostics.push(diagnostic("invalid_log_items", "$.items", "must be an array of at most 800 items"));
		} else {
			const items = source.items.map((item, index) => decodeLogItemV1(item, `$.items[${index}]`, diagnostics)).filter((item): item is AgentLogItemV1 => item !== undefined);
			event.items = items;
		}
	}
	if (source.tools !== undefined) {
		if (!Array.isArray(source.tools) || source.tools.length > 256) {
			diagnostics.push(diagnostic("invalid_tools", "$.tools", "must be an array of at most 256 strings"));
		} else {
			const tools: string[] = [];
			for (let index = 0; index < source.tools.length; index++) {
				const entry = source.tools[index];
				if (typeof entry !== "string" || !entry || entry.length > 1_000) diagnostics.push(diagnostic("invalid_tool_name", `$.tools[${index}]`, "must be a non-empty string"));
				else tools.push(entry);
			}
			event.tools = tools;
		}
	}
	if (source.usage !== undefined) {
		const usage = decodeUsageV1(source.usage, "$.usage", diagnostics);
		if (usage) event.usage = usage;
	}

	if (kind === "log_delta") {
		for (const key of ["contentIndex", "itemType", "text"] as const) {
			if (!hasOwn(source, key)) diagnostics.push(diagnostic("missing_required_field", `$.${key}`, `is required for ${kind}`));
		}
	}
	if (kind === "log" && !hasOwn(source, "items")) diagnostics.push(diagnostic("missing_required_field", "$.items", "is required for log"));
	if (kind === "usage" && !hasOwn(source, "usage")) diagnostics.push(diagnostic("missing_required_field", "$.usage", "is required for usage"));
	if (kind === "stalled" && !hasOwn(source, "idle")) diagnostics.push(diagnostic("missing_required_field", "$.idle", "is required for stalled"));
	if (kind === "end" && !["ok", "aborted", "interrupted", "vanished"].some((key) => hasOwn(source, key))) diagnostics.push(diagnostic("missing_terminal_state", "$", "end requires ok, aborted, interrupted, or vanished"));
	if (kind === "closeout" && event.disposition !== "cleaned") diagnostics.push(diagnostic("missing_closeout_disposition", "$.disposition", "closeout requires disposition=cleaned"));

	const known = ["schemaVersion", "kind", "agentId", "runId", "at", "parentId", "toolCallId", "name", "task", "title", "depth", "model", "background", "output", "activity", "cost", "turns", "contentIndex", "itemType", "text", "items", "turn", "tools", "usage", "idle", "ok", "aborted", "interrupted", "vanished", "stalled", "contextTokens", "stopReason", "worktreePath", "worktreeBranch", "worktreeError", "verifyCommand", "verifyExit", "memoryBrokerCapability", "memoryRole", "desktopGrant", "computerCapability", "disposition", "reason", "closeoutAt"];
	const extensions = extensionsFor(source, known, "$", diagnostics);
	if (extensions) event.extensions = extensions;
	return finish(event as AgentEventV1, diagnostics);
}

function decodePlanTaskV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[], stateRequired: boolean): PlanTaskV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const id = stringValue(source, "id", path, diagnostics, { required: true, min: 1, max: 256 });
	const title = stringValue(source, "title", path, diagnostics, { required: !stateRequired, min: 1, max: 10_000 });
	const state = stringValue(source, "state", path, diagnostics, { required: stateRequired, max: 32 });
	if (typeof state === "string" && !PLAN_STATES.has(state as PlanTaskStateV1)) diagnostics.push(diagnostic("invalid_plan_state", `${path}.state`, "must be a known plan task state"));
	const detail = stringValue(source, "detail", path, diagnostics, { max: 100_000 });
	const error = stringValue(source, "error", path, diagnostics, { max: 100_000 });
	const extensions = extensionsFor(source, ["id", "title", "state", "detail", "error"], path, diagnostics);
	if (typeof id !== "string" || (stateRequired && (typeof state !== "string" || !PLAN_STATES.has(state as PlanTaskStateV1)))) return undefined;
	const task: PlanTaskV1 = { id, title: typeof title === "string" ? title : "", state: (state as PlanTaskStateV1 | undefined) ?? "pending" };
	if (typeof detail === "string") task.detail = detail;
	if (typeof error === "string") task.error = error;
	if (extensions) task.extensions = extensions;
	return task;
}

function decodePlanTaskUpdateV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[]): PlanTaskUpdateV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const id = stringValue(source, "id", path, diagnostics, { required: true, min: 1, max: 256 });
	const state = stringValue(source, "state", path, diagnostics, { required: true, max: 32 });
	if (typeof state === "string" && !PLAN_STATES.has(state as PlanTaskStateV1)) diagnostics.push(diagnostic("invalid_plan_state", `${path}.state`, "must be a known plan task state"));
	const title = stringValue(source, "title", path, diagnostics, { min: 1, max: 10_000 });
	const detail = stringValue(source, "detail", path, diagnostics, { max: 100_000 });
	const error = stringValue(source, "error", path, diagnostics, { max: 100_000 });
	const extensions = extensionsFor(source, ["id", "state", "title", "detail", "error"], path, diagnostics);
	if (typeof id !== "string" || typeof state !== "string" || !PLAN_STATES.has(state as PlanTaskStateV1)) return undefined;
	return { id, state: state as PlanTaskStateV1, ...(typeof title === "string" ? { title } : {}), ...(typeof detail === "string" ? { detail } : {}), ...(typeof error === "string" ? { error } : {}), ...(extensions ? { extensions } : {}) };
}

export function decodePlanEventV1(raw: unknown): DecodeResult<PlanEventV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source || requireVersion(source, "$", diagnostics) === undefined) return finish(undefined, diagnostics);
	const event = stringValue(source, "event", "$", diagnostics, { required: true, max: 32 });
	const at = stringValue(source, "at", "$", diagnostics, { max: 128 });
	if (event === "publish") {
		const planSource = requireRecord(source.plan, "$.plan", diagnostics);
		if (!planSource) return finish(undefined, diagnostics);
		const id = stringValue(planSource, "id", "$.plan", diagnostics, { required: true, min: 1, max: 256 });
		const title = stringValue(planSource, "title", "$.plan", diagnostics, { required: true, min: 1, max: 10_000 });
		const summary = stringValue(planSource, "summary", "$.plan", diagnostics, { max: 100_000 });
		if (!Array.isArray(planSource.tasks) || planSource.tasks.length > 100) diagnostics.push(diagnostic("invalid_plan_tasks", "$.plan.tasks", "must be an array of at most 100 tasks"));
		const tasks = Array.isArray(planSource.tasks)
			? planSource.tasks.map((task, index) => decodePlanTaskV1(task, `$.plan.tasks[${index}]`, diagnostics, false)).filter((task): task is PlanTaskV1 => task !== undefined)
			: [];
		const unique = new Set<string>();
		for (const task of tasks) {
			if (unique.has(task.id)) diagnostics.push(diagnostic("duplicate_task_id", "$.plan.tasks", `duplicate task id ${JSON.stringify(task.id)}`));
			unique.add(task.id);
		}
		const planExtensions = extensionsFor(planSource, ["id", "title", "summary", "tasks"], "$.plan", diagnostics);
		const extensions = extensionsFor(source, ["schemaVersion", "event", "plan", "at"], "$", diagnostics);
		if (typeof id !== "string" || typeof title !== "string" || !Array.isArray(planSource.tasks)) return finish(undefined, diagnostics);
		return finish({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, event: "publish", plan: { id, title, tasks, ...(typeof summary === "string" ? { summary } : {}), ...(planExtensions ? { extensions: planExtensions } : {}) }, ...(typeof at === "string" ? { at } : {}), ...(extensions ? { extensions } : {}) }, diagnostics);
	}
	if (event === "task_update") {
		const planId = stringValue(source, "planId", "$", diagnostics, { required: true, min: 1, max: 256 });
		const task = decodePlanTaskUpdateV1(source.task, "$.task", diagnostics);
		const extensions = extensionsFor(source, ["schemaVersion", "event", "planId", "task", "at"], "$", diagnostics);
		if (typeof planId !== "string" || !task) return finish(undefined, diagnostics);
		return finish({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, event, planId, task, ...(typeof at === "string" ? { at } : {}), ...(extensions ? { extensions } : {}) }, diagnostics);
	}
	if (event === "approve" || event === "cancel") {
		const planId = stringValue(source, "planId", "$", diagnostics, { required: true, min: 1, max: 256 });
		const extensions = extensionsFor(source, ["schemaVersion", "event", "planId", "at"], "$", diagnostics);
		if (typeof planId !== "string") return finish(undefined, diagnostics);
		return finish({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, event, planId, ...(typeof at === "string" ? { at } : {}), ...(extensions ? { extensions } : {}) }, diagnostics);
	}
	diagnostics.push(diagnostic("unknown_plan_event", "$.event", "must be publish, task_update, approve, or cancel"));
	return finish(undefined, diagnostics);
}

export function decodePlanRevisionResponseV1(raw: unknown): DecodeResult<PlanRevisionResponseV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source || requireVersion(source, "$", diagnostics) === undefined) return finish(undefined, diagnostics);
	const ok = booleanValue(source, "ok", "$", diagnostics, true);
	const applied = booleanValue(source, "applied", "$", diagnostics, true);
	const revision = integerValue(source, "revision", "$", diagnostics, { min: 0, max: Number.MAX_SAFE_INTEGER });
	const currentRevision = integerValue(source, "currentRevision", "$", diagnostics, { min: 0, max: Number.MAX_SAFE_INTEGER });
	const error = stringValue(source, "error", "$", diagnostics, { max: 10_000 });
	if (applied === true && revision === undefined) diagnostics.push(diagnostic("missing_revision", "$.revision", "is required when applied is true"));
	const extensions = extensionsFor(source, ["schemaVersion", "ok", "applied", "revision", "currentRevision", "error"], "$", diagnostics);
	if (ok === undefined || applied === undefined) return finish(undefined, diagnostics);
	return finish({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ok, applied, ...(revision !== undefined ? { revision } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}), ...(typeof error === "string" ? { error } : {}), ...(extensions ? { extensions } : {}) }, diagnostics);
}

function decodeJobProjectionV1(raw: unknown, path: string, diagnostics: ProtocolDiagnostic[]): JobProjectionV1 | undefined {
	const source = requireRecord(raw, path, diagnostics);
	if (!source) return undefined;
	const agentId = stringValue(source, "agentId", path, diagnostics, { required: true, min: 1, max: 256 });
	const runId = stringValue(source, "runId", path, diagnostics, { required: true, min: 1, max: 256 });
	const name = stringValue(source, "name", path, diagnostics, { required: true, min: 1, max: 1_000 });
	const task = stringValue(source, "task", path, diagnostics, { required: true, max: 100_000 });
	const state = stringValue(source, "state", path, diagnostics, { required: true, max: 32 });
	if (typeof state === "string" && !JOB_STATES.has(state as JobStateV1)) diagnostics.push(diagnostic("invalid_job_state", `${path}.state`, "must be a known terminal or running job state"));
	const title = stringValue(source, "title", path, diagnostics, { max: 10_000 });
	const activity = stringValue(source, "activity", path, diagnostics, { max: 100_000 });
	const resultText = stringValue(source, "resultText", path, diagnostics, { max: 500_000 });
	const startedAt = finiteNumberValue(source, "startedAt", path, diagnostics, 0);
	const endedAt = finiteNumberValue(source, "endedAt", path, diagnostics, 0);
	const cost = finiteNumberValue(source, "cost", path, diagnostics, 0);
	const turns = integerValue(source, "turns", path, diagnostics, { min: 0, max: Number.MAX_SAFE_INTEGER });
	const stalled = booleanValue(source, "stalled", path, diagnostics);
	const closeoutDisposition = stringValue(source, "closeoutDisposition", path, diagnostics, { max: 32 });
	if (closeoutDisposition !== undefined && closeoutDisposition !== "cleaned") diagnostics.push(diagnostic("invalid_closeout_disposition", `${path}.closeoutDisposition`, "must be cleaned"));
	const closeoutReason = stringValue(source, "closeoutReason", path, diagnostics, { max: 100_000 });
	const closeoutAt = finiteNumberValue(source, "closeoutAt", path, diagnostics, 0);
	let blockedBy: string[] | undefined;
	if (source.blockedBy !== undefined) {
		if (!Array.isArray(source.blockedBy) || source.blockedBy.length > 256 || source.blockedBy.some((entry) => typeof entry !== "string" || !entry || entry.length > 1_000)) diagnostics.push(diagnostic("invalid_blocked_by", `${path}.blockedBy`, "must be an array of non-empty strings"));
		else blockedBy = source.blockedBy as string[];
	}
	const extensions = extensionsFor(source, ["agentId", "runId", "name", "task", "state", "title", "blockedBy", "startedAt", "endedAt", "activity", "cost", "turns", "resultText", "stalled", "closeoutDisposition", "closeoutReason", "closeoutAt"], path, diagnostics);
	if (typeof agentId !== "string" || typeof runId !== "string" || typeof name !== "string" || typeof task !== "string" || typeof state !== "string" || !JOB_STATES.has(state as JobStateV1)) return undefined;
	if (closeoutDisposition === "cleaned" && !["failed", "aborted", "interrupted"].includes(state)) diagnostics.push(diagnostic("invalid_closeout_state", `${path}.closeoutDisposition`, "cleaned closeout requires failed, aborted, or interrupted state"));
	return { agentId, runId, name, task, state: state as JobStateV1, ...(typeof title === "string" ? { title } : {}), ...(blockedBy ? { blockedBy } : {}), ...(startedAt !== undefined ? { startedAt } : {}), ...(endedAt !== undefined ? { endedAt } : {}), ...(typeof activity === "string" ? { activity } : {}), ...(cost !== undefined ? { cost } : {}), ...(turns !== undefined ? { turns } : {}), ...(typeof resultText === "string" ? { resultText } : {}), ...(stalled !== undefined ? { stalled } : {}), ...(closeoutDisposition === "cleaned" ? { closeoutDisposition } : {}), ...(typeof closeoutReason === "string" ? { closeoutReason } : {}), ...(closeoutAt !== undefined ? { closeoutAt } : {}), ...(extensions ? { extensions } : {}) };
}

export function decodeJobsSnapshotV1(raw: unknown): DecodeResult<JobsSnapshotV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source || requireVersion(source, "$", diagnostics) === undefined) return finish(undefined, diagnostics);
	const generatedAt = stringValue(source, "generatedAt", "$", diagnostics, { required: true, min: 1, max: 128 });
	if (!Array.isArray(source.jobs) || source.jobs.length > 10_000) diagnostics.push(diagnostic("invalid_jobs", "$.jobs", "must be an array of at most 10000 jobs"));
	const jobs = Array.isArray(source.jobs)
		? source.jobs.map((job, index) => decodeJobProjectionV1(job, `$.jobs[${index}]`, diagnostics)).filter((job): job is JobProjectionV1 => job !== undefined)
		: [];
	const seen = new Set<string>();
	for (const job of jobs) {
		const key = `${job.agentId}\u0000${job.runId}`;
		if (seen.has(key)) diagnostics.push(diagnostic("duplicate_job", "$.jobs", "agentId/runId pairs must be unique"));
		seen.add(key);
	}
	const extensions = extensionsFor(source, ["schemaVersion", "generatedAt", "jobs"], "$", diagnostics);
	if (typeof generatedAt !== "string" || !Array.isArray(source.jobs)) return finish(undefined, diagnostics);
	return finish({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, generatedAt, jobs, ...(extensions ? { extensions } : {}) }, diagnostics);
}

function baseCommand(source: Record<string, unknown>, diagnostics: ProtocolDiagnostic[]): { sessionCapability: string; action: HostCommandActionV1; requestId?: string; extensions?: JsonRecord } | undefined {
	if (requireVersion(source, "$", diagnostics) === undefined) return undefined;
	const sessionCapability = stringValue(source, "sessionCapability", "$", diagnostics, { required: true, min: 16, max: 4_096 });
	const actionRaw = stringValue(source, "action", "$", diagnostics, { required: true, max: 32 });
	const requestId = stringValue(source, "requestId", "$", diagnostics, { max: 256 });
	if (typeof actionRaw === "string" && !HOST_ACTIONS.has(actionRaw as HostCommandActionV1)) diagnostics.push(diagnostic("unknown_action", "$.action", "unknown host command action"));
	if (typeof sessionCapability !== "string" || typeof actionRaw !== "string" || !HOST_ACTIONS.has(actionRaw as HostCommandActionV1)) return undefined;
	return { sessionCapability, action: actionRaw as HostCommandActionV1, ...(typeof requestId === "string" ? { requestId } : {}) };
}

export function decodeHostCommandV1(raw: unknown): DecodeResult<HostCommandV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source) return finish(undefined, diagnostics);
	const base = baseCommand(source, diagnostics);
	if (!base) return finish(undefined, diagnostics);
	const withExtras = <T extends Record<string, unknown>>(value: T, known: string[]): T => {
		const extensions = extensionsFor(source, known, "$", diagnostics);
		return extensions ? { ...value, extensions } : value;
	};
	if (base.action === "agent_event") {
		const event = decodeAgentEventV1(source.event);
		diagnostics.push(...event.diagnostics.map((entry) => ({ ...entry, path: entry.path.replace(/^\$/, "$.event") })));
		if (!event.ok) return finish(undefined, diagnostics);
		return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: "agent_event", event: event.value }, ["schemaVersion", "sessionCapability", "action", "requestId", "event"]) as HostCommandV1, diagnostics);
	}
	if (base.action === "plan_event") {
		const event = decodePlanEventV1(source.event);
		diagnostics.push(...event.diagnostics.map((entry) => ({ ...entry, path: entry.path.replace(/^\$/, "$.event") })));
		if (!event.ok) return finish(undefined, diagnostics);
		return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: "plan_event", event: event.value }, ["schemaVersion", "sessionCapability", "action", "requestId", "event"]) as HostCommandV1, diagnostics);
	}
	if (base.action === "abort" || base.action === "recover") {
		const agentId = stringValue(source, "agentId", "$", diagnostics, { required: true, min: 1, max: 256 });
		const runId = stringValue(source, "runId", "$", diagnostics, { min: 1, max: 256 });
		const reason = stringValue(source, "reason", "$", diagnostics, { max: 10_000 });
		const fresh = booleanValue(source, "fresh", "$", diagnostics);
		if (typeof agentId !== "string") return finish(undefined, diagnostics);
		const known = base.action === "abort" ? ["schemaVersion", "sessionCapability", "action", "requestId", "agentId", "runId", "reason"] : ["schemaVersion", "sessionCapability", "action", "requestId", "agentId", "runId", "fresh"];
		return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: base.action, agentId, ...(typeof runId === "string" ? { runId } : {}), ...(base.action === "abort" && typeof reason === "string" ? { reason } : {}), ...(base.action === "recover" && fresh !== undefined ? { fresh } : {}) }, known) as HostCommandV1, diagnostics);
	}
	if (base.action === "snapshot") return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: "snapshot" }, ["schemaVersion", "sessionCapability", "action", "requestId"]) as HostCommandV1, diagnostics);
	if (base.action === "prompt") {
		const message = stringValue(source, "message", "$", diagnostics, { required: true, min: 1, max: 100_000 });
		if (typeof message !== "string") return finish(undefined, diagnostics);
		return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: "prompt", message }, ["schemaVersion", "sessionCapability", "action", "requestId", "message"]) as HostCommandV1, diagnostics);
	}
	const platform = stringValue(source, "platform", "$", diagnostics, { required: true, max: 32 });
	const operation = stringValue(source, "operation", "$", diagnostics, { required: true, min: 1, max: 256 });
	if (typeof platform !== "string" || !["computer", "search", "memory"].includes(platform)) diagnostics.push(diagnostic("invalid_platform", "$.platform", "must be computer, search, or memory"));
	if (source.payload !== undefined) isSafeJson(source.payload, "$.payload", diagnostics);
	if (typeof platform !== "string" || !["computer", "search", "memory"].includes(platform) || typeof operation !== "string") return finish(undefined, diagnostics);
	return finish(withExtras({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, ...base, action: "platform", platform: platform as "computer" | "search" | "memory", operation, ...(source.payload !== undefined ? { payload: source.payload as JsonValue } : {}) }, ["schemaVersion", "sessionCapability", "action", "requestId", "platform", "operation", "payload"]) as HostCommandV1, diagnostics);
}

/**
 * Explicit compatibility boundary for the current PipiUI bridge envelope:
 * `{ sessionKey, action, ...payload }`. It is not accepted by the v1 server
 * directly. Callers must opt into this upgrade and supply a runId for legacy
 * reports that omitted one.
 */
export function upgradeCurrentBridgeEnvelopeV1(raw: unknown, context: LegacyBridgeUpgradeContextV1 = {}): DecodeResult<HostCommandV1> {
	const diagnostics: ProtocolDiagnostic[] = [];
	const source = requireRecord(raw, "$", diagnostics);
	if (!source) return finish(undefined, diagnostics);
	const sessionKey = stringValue(source, "sessionKey", "$", diagnostics, { required: true, min: 16, max: 4_096 });
	const action = stringValue(source, "action", "$", diagnostics, { required: true, max: 32 });
	if (typeof sessionKey !== "string" || typeof action !== "string") return finish(undefined, diagnostics);
	const inner: Record<string, unknown> = { ...source };
	delete inner.sessionKey;
	delete inner.action;
	if (action === "agent_event") {
		inner.schemaVersion = HOST_PROTOCOL_SCHEMA_VERSION;
		if (inner.runId === undefined && context.runId) inner.runId = context.runId;
		return decodeHostCommandV1({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, sessionCapability: sessionKey, action, event: inner });
	}
	if (action === "plan_event") {
		inner.schemaVersion = HOST_PROTOCOL_SCHEMA_VERSION;
		return decodeHostCommandV1({ schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, sessionCapability: sessionKey, action, event: inner });
	}
	diagnostics.push(diagnostic("unsupported_legacy_action", "$.action", "only current agent_event and plan_event envelopes can be upgraded"));
	return finish(undefined, diagnostics);
}

export function hostAckV1(action: HostCommandActionV1, ok: boolean, options: Omit<HostCommandAckV1, "schemaVersion" | "action" | "ok"> = {}): HostCommandAckV1 {
	return { schemaVersion: HOST_PROTOCOL_SCHEMA_VERSION, action, ok, ...options };
}

export function hostErrorV1(action: HostCommandActionV1, code: string, message: string, requestId?: string): HostCommandAckV1 {
	return hostAckV1(action, false, { requestId, diagnostics: [diagnostic(code, "$", message)] });
}

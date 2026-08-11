/**
 * Framework-agnostic Node reference server for HostCommandV1.
 *
 * Electron main can import this directly or wrap `dispatchHostCommandV1`; no
 * Electron dependency is used here. Process supervision and platform actions
 * remain injected callbacks owned by the host application.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
	decodeHostCommandV1,
	decodeJobsSnapshotV1,
	decodePlanRevisionResponseV1,
	hostAckV1,
	hostErrorV1,
	type AgentEventV1,
	type HostCommandAckV1,
	type HostCommandActionV1,
	type HostCommandV1,
	type HostRpcResponseV1,
	type JobsSnapshotV1,
	type JsonValue,
	type PlanEventV1,
	type PlanRevisionResponseV1,
	type ProtocolDiagnostic,
} from "./contract.ts";

export const DEFAULT_MAX_RPC_BODY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_RPC_QUEUE = 256;
/** Matches the native BridgeServer's 40-second request timeout without blocking its FIFO forever. */
export const DEFAULT_HANDLER_TIMEOUT_MS = 40_000;
export const MAX_HANDLER_TIMEOUT_MS = 5 * 60_000;

export type HandlerTimeoutsV1 = Partial<Record<HostCommandActionV1, number>>;
export type HostDispatchOptionsV1 = {
	/** Default timeout applied to every injected handler unless an action override exists. */
	handlerTimeoutMs?: number;
	/** Optional per-action timeout overrides. All values must be positive safe integers. */
	handlerTimeouts?: HandlerTimeoutsV1;
};

export type HostHandlerResultV1 = {
	accepted?: boolean;
	message?: string;
	result?: JsonValue;
	diagnostics?: ProtocolDiagnostic[];
};

export type CurrentPlanRevisionResponseBodyV1 = Omit<PlanRevisionResponseV1, "schemaVersion">;
export type CurrentJobsSnapshotBodyV1 = Omit<JobsSnapshotV1, "schemaVersion">;

export type HostActionHandlersV1 = {
	onAgentEvent?: (event: AgentEventV1) => Promise<HostHandlerResultV1 | void> | HostHandlerResultV1 | void;
	/** Current PlanStore response bodies may omit schemaVersion; the adapter stamps only that missing field. */
	onPlanEvent?: (event: PlanEventV1) => Promise<PlanRevisionResponseV1 | CurrentPlanRevisionResponseBodyV1> | PlanRevisionResponseV1 | CurrentPlanRevisionResponseBodyV1;
	onAbort?: (command: Extract<HostCommandV1, { action: "abort" }>) => Promise<HostHandlerResultV1 | void> | HostHandlerResultV1 | void;
	onRecover?: (command: Extract<HostCommandV1, { action: "recover" }>) => Promise<HostHandlerResultV1 | void> | HostHandlerResultV1 | void;
	/** Reconnect adapters may return a current projection without schemaVersion; other malformed data still rejects. */
	onSnapshot?: () => Promise<JobsSnapshotV1 | CurrentJobsSnapshotBodyV1> | JobsSnapshotV1 | CurrentJobsSnapshotBodyV1;
	onPrompt?: (command: Extract<HostCommandV1, { action: "prompt" }>) => Promise<HostHandlerResultV1 | void> | HostHandlerResultV1 | void;
	onPlatform?: (command: Extract<HostCommandV1, { action: "platform" }>) => Promise<HostHandlerResultV1 | void> | HostHandlerResultV1 | void;
};

export type SubagentHostServerOptionsV1 = {
	/** Opaque current-session capability; it is compared in constant time. */
	sessionCapability: string;
	handlers: HostActionHandlersV1;
	maxBodyBytes?: number;
	maxQueue?: number;
	/** Defaults to 40 seconds; per-action overrides are available through handlerTimeouts. */
	handlerTimeoutMs?: number;
	handlerTimeouts?: HandlerTimeoutsV1;
};

export type SubagentHostServerV1 = {
	server: Server;
	listen: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
	close: () => Promise<void>;
	/** Useful for adapters that already own an HTTP transport. */
	dispatch: (command: HostCommandV1) => Promise<HostRpcResponseV1>;
};

function stableAction(value: unknown): HostCommandActionV1 {
	return value === "agent_event" || value === "plan_event" || value === "abort" || value === "recover" || value === "snapshot" || value === "prompt" || value === "platform"
		? value
		: "snapshot";
}

function isHostAction(value: string): value is HostCommandActionV1 {
	return stableAction(value) === value;
}

function assertHandlerTimeout(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_HANDLER_TIMEOUT_MS) {
		throw new Error(`${name} must be a positive safe integer no greater than ${MAX_HANDLER_TIMEOUT_MS}`);
	}
	return value;
}

function normalizeDispatchOptions(options: HostDispatchOptionsV1 = {}): Required<HostDispatchOptionsV1> {
	const handlerTimeoutMs = assertHandlerTimeout(options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS, "handlerTimeoutMs");
	const handlerTimeouts: HandlerTimeoutsV1 = {};
	for (const [action, value] of Object.entries(options.handlerTimeouts ?? {})) {
		if (!isHostAction(action)) throw new Error(`handlerTimeouts contains unknown action ${JSON.stringify(action)}`);
		handlerTimeouts[action] = assertHandlerTimeout(value, `handlerTimeouts.${action}`);
	}
	return { handlerTimeoutMs, handlerTimeouts };
}

class HandlerTimeoutError extends Error {
	readonly action: HostCommandActionV1;
	readonly timeoutMs: number;

	constructor(action: HostCommandActionV1, timeoutMs: number) {
		super(`host ${action} handler exceeded ${timeoutMs}ms`);
		this.name = "HandlerTimeoutError";
		this.action = action;
		this.timeoutMs = timeoutMs;
	}
}

async function invokeHandlerWithTimeout<T>(
	action: HostCommandActionV1,
	options: Required<HostDispatchOptionsV1>,
	callback: () => Promise<T> | T,
): Promise<T> {
	const timeoutMs = options.handlerTimeouts[action] ?? options.handlerTimeoutMs;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const work = Promise.resolve().then(callback);
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new HandlerTimeoutError(action, timeoutMs)), timeoutMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function stampMissingSchemaVersion(body: unknown): unknown {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
	const record = body as Record<string, unknown>;
	return Object.prototype.hasOwnProperty.call(record, "schemaVersion")
		? body
		: { ...record, schemaVersion: 1 };
}

function canWrite(response: ServerResponse): boolean {
	return !response.writableEnded
		&& !response.destroyed
		&& response.writable
		&& !response.socket?.destroyed;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
	if (!canWrite(response)) return;
	let serialized: string;
	try {
		serialized = JSON.stringify(body);
	} catch {
		serialized = JSON.stringify(hostErrorV1("snapshot", "response_encoding_failed", "host response was not JSON-safe"));
		status = 500;
	}
	if (!canWrite(response)) return;
	try {
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"content-length": Buffer.byteLength(serialized),
			"cache-control": "no-store",
		});
		response.end(serialized);
	} catch {
		// A peer may disconnect between the guard and write. The request has already
		// been reduced; there is no safe response left to send.
	}
}

/** Hashing first keeps timingSafeEqual's input size fixed even for a malformed-length candidate. */
export function constantTimeCapabilityEquals(candidate: string, expected: string): boolean {
	const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
	const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
	return timingSafeEqual(candidateDigest, expectedDigest);
}

function readBody(request: IncomingMessage, limit: number): Promise<{ ok: true; raw: unknown } | { ok: false; status: number; code: string; message: string }> {
	return new Promise((resolve) => {
		const contentLengthHeader = request.headers["content-length"];
		const contentLength = typeof contentLengthHeader === "string" && /^\d+$/.test(contentLengthHeader)
			? Number(contentLengthHeader)
			: undefined;
		if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength > limit)) {
			request.resume();
			resolve({ ok: false, status: 413, code: "body_too_large", message: `request body exceeds ${limit} bytes` });
			return;
		}
		if (contentLengthHeader !== undefined && contentLength === undefined) {
			request.resume();
			resolve({ ok: false, status: 400, code: "invalid_content_length", message: "Content-Length must be one decimal value" });
			return;
		}
		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		request.on("data", (chunk: Buffer) => {
			if (tooLarge) return;
			size += chunk.length;
			if (size > limit) {
				tooLarge = true;
				chunks.length = 0;
				return;
			}
			chunks.push(Buffer.from(chunk));
		});
		request.on("aborted", () => resolve({ ok: false, status: 400, code: "request_aborted", message: "request body was aborted" }));
		request.on("error", () => resolve({ ok: false, status: 400, code: "request_error", message: "request body could not be read" }));
		request.on("end", () => {
			if (tooLarge) {
				resolve({ ok: false, status: 413, code: "body_too_large", message: `request body exceeds ${limit} bytes` });
				return;
			}
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				const raw = JSON.parse(text) as unknown;
				if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
					resolve({ ok: false, status: 400, code: "invalid_json_body", message: "JSON body must be an object" });
					return;
				}
				resolve({ ok: true, raw });
			} catch {
				resolve({ ok: false, status: 400, code: "invalid_json_body", message: "request body must be valid JSON" });
			}
		});
	});
}

function ackFor(command: HostCommandV1, result: HostHandlerResultV1 | void): HostCommandAckV1 {
	return hostAckV1(command.action, true, {
		accepted: result?.accepted ?? true,
		...(result?.message ? { message: result.message } : {}),
		...(result?.result !== undefined ? { result: result.result } : {}),
		...(result?.diagnostics ? { diagnostics: result.diagnostics } : {}),
		...(command.requestId ? { requestId: command.requestId } : {}),
	});
}

/** Route one already-authorized, already-decoded command. No process or UI policy is hidden here. */
export async function dispatchHostCommandV1(
	command: HostCommandV1,
	handlers: HostActionHandlersV1,
	dispatchOptions: HostDispatchOptionsV1 = {},
): Promise<HostRpcResponseV1> {
	const timeouts = normalizeDispatchOptions(dispatchOptions);
	try {
		switch (command.action) {
			case "agent_event":
				if (!handlers.onAgentEvent) return hostErrorV1(command.action, "handler_unavailable", "agent event handler is not configured", command.requestId);
				return ackFor(command, await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onAgentEvent!(command.event)));
			case "plan_event": {
				if (!handlers.onPlanEvent) return hostErrorV1(command.action, "handler_unavailable", "plan event handler is not configured", command.requestId);
				const response = await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onPlanEvent!(command.event));
				const decoded = decodePlanRevisionResponseV1(stampMissingSchemaVersion(response));
				if (!decoded.ok) return hostAckV1(command.action, false, { requestId: command.requestId, diagnostics: decoded.diagnostics });
				return { ...decoded.value, action: command.action, ...(command.requestId ? { requestId: command.requestId } : {}) };
			}
			case "abort":
				if (!handlers.onAbort) return hostErrorV1(command.action, "handler_unavailable", "abort handler is not configured", command.requestId);
				return ackFor(command, await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onAbort!(command)));
			case "recover":
				if (!handlers.onRecover) return hostErrorV1(command.action, "handler_unavailable", "recover handler is not configured", command.requestId);
				return ackFor(command, await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onRecover!(command)));
			case "snapshot": {
				if (!handlers.onSnapshot) return hostErrorV1(command.action, "handler_unavailable", "snapshot handler is not configured", command.requestId);
				const response = await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onSnapshot!());
				const decoded = decodeJobsSnapshotV1(stampMissingSchemaVersion(response));
				if (!decoded.ok) return hostAckV1(command.action, false, { requestId: command.requestId, diagnostics: decoded.diagnostics });
				return { ...decoded.value, action: command.action, ok: true, ...(command.requestId ? { requestId: command.requestId } : {}) };
			}
			case "prompt":
				if (!handlers.onPrompt) return hostErrorV1(command.action, "handler_unavailable", "prompt handler is not configured", command.requestId);
				return ackFor(command, await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onPrompt!(command)));
			case "platform":
				if (!handlers.onPlatform) return hostErrorV1(command.action, "handler_unavailable", "platform handler is not configured", command.requestId);
				return ackFor(command, await invokeHandlerWithTimeout(command.action, timeouts, () => handlers.onPlatform!(command)));
		}
	} catch (error) {
		if (error instanceof HandlerTimeoutError) {
			return hostErrorV1(command.action, "handler_timeout", error.message, command.requestId);
		}
		const message = error instanceof Error ? error.message : "host handler failed";
		return hostErrorV1(command.action, "handler_failed", message, command.requestId);
	}
}

/**
 * Create a sequential, bounded loopback RPC server. Network parsing happens on
 * Node's HTTP server; callbacks run one-at-a-time in FIFO order to preserve the
 * ordering expected by agent event reducers.
 */
export function createSubagentHostServerV1(options: SubagentHostServerOptionsV1): SubagentHostServerV1 {
	if (typeof options.sessionCapability !== "string" || options.sessionCapability.length < 16) {
		throw new Error("sessionCapability must be an opaque string of at least 16 characters");
	}
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_RPC_BODY_BYTES;
	const maxQueue = options.maxQueue ?? DEFAULT_MAX_RPC_QUEUE;
	if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || !Number.isSafeInteger(maxQueue) || maxQueue < 1) {
		throw new Error("maxBodyBytes and maxQueue must be positive safe integers");
	}
	const dispatchOptions = normalizeDispatchOptions({
		handlerTimeoutMs: options.handlerTimeoutMs,
		handlerTimeouts: options.handlerTimeouts,
	});

	let active = false;
	const queue: Array<() => Promise<void>> = [];
	const drain = async (): Promise<void> => {
		if (active) return;
		active = true;
		try {
			while (queue.length > 0) {
				const next = queue.shift();
				if (next) await next();
			}
		} finally {
			active = false;
			if (queue.length > 0) void drain();
		}
	};

	const server = createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/rpc") {
			writeJson(response, 404, hostErrorV1("snapshot", "route_not_found", "only POST /rpc is accepted"));
			return;
		}
		const contentType = request.headers["content-type"];
		if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
			writeJson(response, 415, hostErrorV1("snapshot", "unsupported_media_type", "content-type must be application/json"));
			return;
		}
		const body = await readBody(request, maxBodyBytes);
		if (!body.ok) {
			writeJson(response, body.status, hostErrorV1("snapshot", body.code, body.message));
			return;
		}
		const raw = body.raw as Record<string, unknown>;
		const candidate = typeof raw.sessionCapability === "string" ? raw.sessionCapability : "";
		if (!constantTimeCapabilityEquals(candidate, options.sessionCapability)) {
			writeJson(response, 401, hostErrorV1(stableAction(raw.action), "unauthorized_session_capability", "unauthorized session capability"));
			return;
		}
		const decoded = decodeHostCommandV1(raw);
		if (!decoded.ok) {
			writeJson(response, 400, hostAckV1(stableAction(raw.action), false, { diagnostics: decoded.diagnostics }));
			return;
		}
		if (queue.length + (active ? 1 : 0) >= maxQueue) {
			writeJson(response, 429, hostErrorV1(decoded.value.action, "queue_full", "host request queue is full", decoded.value.requestId));
			return;
		}
		queue.push(async () => {
			const result = await dispatchHostCommandV1(decoded.value, options.handlers, dispatchOptions);
			// The envelope was valid and authenticated; reducer/handler rejection is an
			// acknowledged RPC result (matching the current PlanStore bridge shape), not
			// a transport parsing failure.
			writeJson(response, 200, result);
		});
		void drain();
	});

	return {
		server,
		dispatch: (command) => dispatchHostCommandV1(command, options.handlers, dispatchOptions),
		listen: (port = 0, host = "127.0.0.1") => new Promise((resolve, reject) => {
			const onError = (error: Error) => {
				server.off("listening", onListening);
				reject(error);
			};
			const onListening = () => {
				server.off("error", onError);
				const address = server.address();
				if (!address || typeof address === "string") {
					reject(new Error("server did not expose a TCP address"));
					return;
				}
				resolve({ port: address.port, host });
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, host);
		}),
		close: () => new Promise((resolve, reject) => {
			server.close((error) => error ? reject(error) : resolve());
		}),
	};
}

export const SUBAGENT_COMPLETION_CUSTOM_TYPE = "pipiui-subagent-complete-v1";

export interface CompletionNotificationInput {
	sessionId: string;
	agentId: string;
	runId: string;
	obligationId: string;
	text: string;
}

export interface CompletionObservation {
	version: 1;
	sessionId: string;
	agentId: string;
	runId: string;
	obligationId: string;
}

interface CompletionMessageSender {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: boolean; deliverAs: "followUp" },
	): unknown;
}

export interface CompletionWaveOptions {
	batchWindowMs?: number;
	maxItems?: number;
	maxContentBytes?: number;
}

interface PendingCompletion {
	input: CompletionNotificationInput;
	currentSessionId: () => string | undefined;
	resolve: (queued: boolean) => void;
}

const DEFAULT_COMPLETION_BATCH_WINDOW_MS = 10;
const DEFAULT_COMPLETION_BATCH_MAX_ITEMS = 16;
const DEFAULT_COMPLETION_BATCH_MAX_CONTENT_BYTES = 48 * 1024;
const COMPLETION_SEPARATOR = "\n\n---\n\n";

function capUtf8(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	const suffix = "\n[truncated]";
	const suffixBytes = Buffer.byteLength(suffix, "utf8");
	if (maxBytes <= suffixBytes) return suffix.slice(0, maxBytes);
	const headBudget = maxBytes - suffixBytes;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(text.slice(0, mid), "utf8") <= headBudget) low = mid;
		else high = mid - 1;
	}
	return `${text.slice(0, low)}${suffix}`;
}

function completionMessage(inputs: readonly CompletionNotificationInput[], maxContentBytes: number): {
	customType: string;
	content: string;
	display: boolean;
	details: Record<string, unknown>;
} {
	if (inputs.length === 1) {
		const input = inputs[0]!;
		return {
			customType: SUBAGENT_COMPLETION_CUSTOM_TYPE,
			content: capUtf8(input.text, maxContentBytes),
			display: false,
			details: {
				version: 1,
				sessionId: input.sessionId,
				agentId: input.agentId,
				runId: input.runId,
				obligationId: input.obligationId,
			},
		};
	}
	return {
		customType: SUBAGENT_COMPLETION_CUSTOM_TYPE,
		content: inputs.map((input) => input.text).join(COMPLETION_SEPARATOR),
		display: false,
		details: {
			version: 1,
			completions: inputs.map((input) => ({
				sessionId: input.sessionId,
				agentId: input.agentId,
				runId: input.runId,
				obligationId: input.obligationId,
			})),
		},
	};
}

function chunkCompletionWave(wave: readonly PendingCompletion[], options: CompletionWaveOptions): PendingCompletion[][] {
	const maxItems = Math.max(1, options.maxItems ?? DEFAULT_COMPLETION_BATCH_MAX_ITEMS);
	const maxBytes = Math.max(1, options.maxContentBytes ?? DEFAULT_COMPLETION_BATCH_MAX_CONTENT_BYTES);
	const separatorBytes = Buffer.byteLength(COMPLETION_SEPARATOR, "utf8");
	const chunks: PendingCompletion[][] = [];
	let chunk: PendingCompletion[] = [];
	let bytes = 0;
	for (const item of wave) {
		const itemBytes = Buffer.byteLength(item.input.text, "utf8");
		const nextBytes = bytes + (chunk.length > 0 ? separatorBytes : 0) + itemBytes;
		if (chunk.length > 0 && (chunk.length >= maxItems || nextBytes > maxBytes)) {
			chunks.push(chunk);
			chunk = [];
			bytes = 0;
		}
		bytes += (chunk.length > 0 ? separatorBytes : 0) + itemBytes;
		chunk.push(item);
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}

class CompletionWaveBroker {
	private pending: PendingCompletion[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly pi: CompletionMessageSender;
	private readonly options: CompletionWaveOptions;

	constructor(pi: CompletionMessageSender, options: CompletionWaveOptions) {
		this.pi = pi;
		this.options = options;
	}

	enqueue(input: CompletionNotificationInput, currentSessionId: () => string | undefined): Promise<boolean> {
		return new Promise((resolve) => {
			this.pending.push({ input, currentSessionId, resolve });
			if (this.timer) return;
			this.timer = setTimeout(() => this.flush(), Math.max(0, this.options.batchWindowMs ?? DEFAULT_COMPLETION_BATCH_WINDOW_MS));
		});
	}

	private flush(): void {
		this.timer = undefined;
		const wave = this.pending.splice(0);
		const current = wave.filter(({ input, currentSessionId }) =>
			Boolean(input.sessionId) && currentSessionId() === input.sessionId,
		);
		for (const item of wave) {
			if (!current.includes(item)) item.resolve(false);
		}
		if (current.length === 0) return;
		const chunks = chunkCompletionWave(current, this.options);
		const queuedByItem = new Map<PendingCompletion, boolean>();
		let wakeQueued = false;
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			const triggerTurn = i === chunks.length - 1;
			let queued = true;
			try {
				this.pi.sendMessage(
					completionMessage(
						chunk.map(({ input }) => input),
						Math.max(1, this.options.maxContentBytes ?? DEFAULT_COMPLETION_BATCH_MAX_CONTENT_BYTES),
					),
					{ triggerTurn, deliverAs: "followUp" },
				);
			} catch (err) {
				queued = false;
				console.error("[pipiui-subagent] completion notification enqueue rejected:", err);
			}
			if (triggerTurn) wakeQueued = queued;
			for (const item of chunk) queuedByItem.set(item, queued);
		}
		// If the one waking envelope failed, mark the whole wave retryable. Earlier
		// quiet envelopes may be persisted, but without a wake they are not delivered.
		for (const item of current) item.resolve(wakeQueued && queuedByItem.get(item) === true);
	}
}

const completionWaveBrokers = new WeakMap<object, CompletionWaveBroker>();

function completionWaveBroker(pi: CompletionMessageSender, options: CompletionWaveOptions): CompletionWaveBroker {
	const key = pi as object;
	let broker = completionWaveBrokers.get(key);
	if (!broker) {
		broker = new CompletionWaveBroker(pi, options);
		completionWaveBrokers.set(key, broker);
	}
	return broker;
}

/**
 * Enqueue one completion through Pi's native extension-message channel.
 * ExtensionAPI.sendMessage is void/fire-and-forget: a normal return proves only
 * that the call was queued, never that Pi persisted or consumed the message.
 */
export function queueCompletionNotification(
	pi: CompletionMessageSender,
	input: CompletionNotificationInput,
): boolean {
	try {
		pi.sendMessage(
			completionMessage([input], DEFAULT_COMPLETION_BATCH_MAX_CONTENT_BYTES),
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] completion notification enqueue rejected:", err);
		return false;
	}
}

/** Preserve cut-in ordering and reject a stale session before the fire-and-forget call. */
export async function queueCompletionAfterCutIn(
	pi: CompletionMessageSender,
	input: CompletionNotificationInput,
	hooks: { waitForCutIn: () => Promise<void>; currentSessionId: () => string | undefined },
	waveOptions: CompletionWaveOptions = {},
): Promise<boolean> {
	await hooks.waitForCutIn();
	if (!input.sessionId || hooks.currentSessionId() !== input.sessionId) return false;
	return completionWaveBroker(pi, waveOptions).enqueue(input, hooks.currentSessionId);
}

/** Parse either a live custom message or its persisted CustomMessageEntry form. */
export function completionObservations(value: unknown): CompletionObservation[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const message = value as { role?: unknown; type?: unknown; customType?: unknown; details?: unknown };
	if (message.role !== "custom" && message.type !== "custom_message") return [];
	if (message.customType !== SUBAGENT_COMPLETION_CUSTOM_TYPE) return [];
	if (!message.details || typeof message.details !== "object" || Array.isArray(message.details)) return [];
	const details = message.details as Partial<CompletionObservation> & { completions?: unknown };
	if (details.version !== 1) return [];
	const candidates = Array.isArray(details.completions) ? details.completions : [details];
	const observations: CompletionObservation[] = [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
		const observed = candidate as Partial<CompletionObservation>;
		if (
			typeof observed.sessionId !== "string" || !observed.sessionId ||
			typeof observed.agentId !== "string" || !observed.agentId ||
			typeof observed.runId !== "string" || !observed.runId ||
			typeof observed.obligationId !== "string" || !observed.obligationId
		) return [];
		observations.push({
			version: 1,
			sessionId: observed.sessionId,
			agentId: observed.agentId,
			runId: observed.runId,
			obligationId: observed.obligationId,
		});
	}
	return observations;
}

export function completionObservation(value: unknown): CompletionObservation | undefined {
	return completionObservations(value)[0];
}

export function completionObservationMatches(
	observed: CompletionObservation,
	expected: Pick<CompletionNotificationInput, "sessionId" | "agentId" | "runId" | "obligationId">,
): boolean {
	return observed.sessionId === expected.sessionId &&
		observed.agentId === expected.agentId &&
		observed.runId === expected.runId &&
		observed.obligationId === expected.obligationId;
}

/**
 * Session-order proof: custom persistence is observed; only a later successful
 * assistant entry proves the Boss produced a persisted response for that wake.
 */
export function completionPersistenceState(
	entries: readonly unknown[],
	expected: Pick<CompletionNotificationInput, "sessionId" | "agentId" | "runId" | "obligationId">,
): "absent" | "observed" | "retryable" | "fulfilled" {
	let state: "absent" | "observed" | "indeterminate" | "retryable" | "fulfilled" = "absent";
	for (const value of entries) {
		const observed = completionObservations(value).some((candidate) => completionObservationMatches(candidate, expected));
		if (observed) {
			// A replay with the same obligation ID begins a new logical delivery
			// attempt. Only its own first subsequent assistant decides that attempt.
			state = "observed";
			continue;
		}
		if (state !== "observed" || !value || typeof value !== "object" || Array.isArray(value)) continue;
		const entry = value as { type?: unknown; message?: { role?: unknown; stopReason?: unknown } };
		if (entry.type === "message" && entry.message?.role === "assistant") {
			// Pi's loop persists/emits toolUse before executing tools, then emits a
			// later terminal assistant. It is activity, not this attempt's outcome.
			if (entry.message.stopReason === "toolUse") continue;
			if (entry.message.stopReason === "stop") state = "fulfilled";
			else if (
				entry.message.stopReason === "error" ||
				entry.message.stopReason === "aborted" ||
				entry.message.stopReason === "length"
			) state = "retryable";
			// Unknown/pending/deferred states are not proven terminal here. Keep the
			// attempt observed rather than inventing success or failure.
			else state = "indeterminate";
		}
	}
	return state === "indeterminate" ? "observed" : state;
}

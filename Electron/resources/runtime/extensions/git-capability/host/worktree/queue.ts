/** Per-main-repository FIFO serialization for operations that mutate main. */

import {
	DEFAULT_QUEUE_HEAD_TIMEOUT_MS,
	DEFAULT_QUEUE_WAIT_TIMEOUT_MS,
} from "./deadlines.ts";

export type SerialQueueTimeoutKindV1 = "queue-wait" | "queue-head";

export type SerialQueueProgressPhaseV1 =
	| "queue-wait"
	| "queue-head"
	| "queue-wait-timeout"
	| "queue-head-timeout";

export type SerialQueueProgressV1 = {
	phase: SerialQueueProgressPhaseV1;
	repositoryKey: string;
	depth: number;
	waitedMs: number;
	timeoutMs?: number;
};

export type SerialQueueGuardV1 = {
	readonly signal: AbortSignal;
	isReleased(): boolean;
	release(reason?: string): void;
};

export type SerialQueueRunOptionsV1 = {
	waitTimeoutMs?: number;
	headTimeoutMs?: number;
	signal?: AbortSignal;
	guard?: SerialQueueGuardV1;
	onProgress?: (event: SerialQueueProgressV1) => void;
};

export class SerialQueueTimeoutError extends Error {
	readonly name = "SerialQueueTimeoutError";
	readonly kind: SerialQueueTimeoutKindV1;
	readonly repositoryKey: string;
	readonly timeoutMs: number;

	constructor(kind: SerialQueueTimeoutKindV1, repositoryKey: string, timeoutMs: number) {
		super(`${kind} timed out after ${timeoutMs}ms for ${repositoryKey}`);
		this.kind = kind;
		this.repositoryKey = repositoryKey;
		this.timeoutMs = timeoutMs;
	}
}

export interface MainRepoSerialQueueV1 {
	run<T>(
		repositoryKey: string,
		operation: (guard: SerialQueueGuardV1) => Promise<T> | T,
		options?: SerialQueueRunOptionsV1,
	): Promise<T>;
}

export function createSerialQueueGuardV1(parent?: AbortSignal): SerialQueueGuardV1 {
	const controller = new AbortController();
	let released = false;
	const onParent = (): void => {
		released = true;
		if (!controller.signal.aborted) controller.abort();
	};
	parent?.addEventListener("abort", onParent, { once: true });
	if (parent?.aborted) onParent();
	return {
		signal: controller.signal,
		isReleased: () => released || controller.signal.aborted,
		release() {
			released = true;
			parent?.removeEventListener("abort", onParent);
			if (!controller.signal.aborted) controller.abort();
		},
	};
}

/** Swallow a late settle so a released FIFO slot cannot surface as an unhandled rejection. */
export function consumeLateSettlement<T>(
	promise: Promise<T>,
	onLate?: (outcome: { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown }) => void,
): void {
	void promise.then(
		(value) => {
			onLate?.({ status: "fulfilled", value });
		},
		(reason) => {
			onLate?.({ status: "rejected", reason });
		},
	);
}

function positiveTimeout(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError("queue timeout must be a positive safe integer");
	}
	return value;
}

function emitProgress(
	onProgress: SerialQueueRunOptionsV1["onProgress"],
	event: SerialQueueProgressV1,
): void {
	try {
		onProgress?.(event);
	} catch {
		/* progress is observational */
	}
}

/**
 * Independent repositories may finalize concurrently; every operation sharing a
 * canonical Git common-dir key executes in FIFO order. Failed operations release
 * their slot so a retained/retry state cannot deadlock later work. A head item
 * that ignores cancellation still loses the slot at `headTimeoutMs`; late
 * rejection is consumed.
 */
export class PerMainRepoSerialQueueV1 implements MainRepoSerialQueueV1 {
	private readonly tails = new Map<string, Promise<void>>();
	private readonly depths = new Map<string, number>();
	private readonly waitTimeoutMs: number;
	private readonly headTimeoutMs: number;

	constructor(options: { waitTimeoutMs?: number; headTimeoutMs?: number } = {}) {
		this.waitTimeoutMs = positiveTimeout(options.waitTimeoutMs, DEFAULT_QUEUE_WAIT_TIMEOUT_MS);
		this.headTimeoutMs = positiveTimeout(options.headTimeoutMs, DEFAULT_QUEUE_HEAD_TIMEOUT_MS);
	}

	depth(repositoryKey: string): number {
		return this.depths.get(repositoryKey || "<unknown-main-repository>") ?? 0;
	}

	async run<T>(
		repositoryKey: string,
		operation: (guard: SerialQueueGuardV1) => Promise<T> | T,
		options: SerialQueueRunOptionsV1 = {},
	): Promise<T> {
		const key = repositoryKey || "<unknown-main-repository>";
		const waitTimeoutMs = positiveTimeout(options.waitTimeoutMs, this.waitTimeoutMs);
		const headTimeoutMs = positiveTimeout(options.headTimeoutMs, this.headTimeoutMs);
		const previous = this.tails.get(key) ?? Promise.resolve();
		let release: (() => void) | undefined;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.catch(() => undefined).then(() => current);
		this.tails.set(key, tail);
		this.depths.set(key, (this.depths.get(key) ?? 0) + 1);
		const waitStarted = Date.now();
		const depth = this.depths.get(key) ?? 1;
		const waiting = depth > 1;
		if (waiting) {
			emitProgress(options.onProgress, {
				phase: "queue-wait",
				repositoryKey: key,
				depth,
				waitedMs: 0,
				timeoutMs: waitTimeoutMs,
			});
		}
		const advance = (): void => {
			release?.();
			release = undefined;
			this.depths.set(key, Math.max(0, (this.depths.get(key) ?? 1) - 1));
			if ((this.depths.get(key) ?? 0) === 0) this.depths.delete(key);
			void tail.finally(() => {
				if (this.tails.get(key) === tail) this.tails.delete(key);
			});
		};
		try {
			await this.awaitBounded(
				previous.catch(() => undefined),
				waitTimeoutMs,
				options.signal,
				"queue-wait",
				key,
				waitStarted,
				depth,
				options.onProgress,
			);
			if (options.signal?.aborted) {
				const err = new SerialQueueTimeoutError("queue-wait", key, waitTimeoutMs);
				err.message = `queue-wait aborted for ${key}`;
				throw err;
			}
			const guard = options.guard ?? createSerialQueueGuardV1(options.signal);
			emitProgress(options.onProgress, {
				phase: "queue-head",
				repositoryKey: key,
				depth: this.depths.get(key) ?? 1,
				waitedMs: Date.now() - waitStarted,
				timeoutMs: headTimeoutMs,
			});
			return await this.awaitBounded(
				Promise.resolve().then(() => operation(guard)),
				headTimeoutMs,
				options.signal,
				"queue-head",
				key,
				Date.now(),
				this.depths.get(key) ?? 1,
				options.onProgress,
				guard,
			);
		} finally {
			advance();
		}
	}

	private awaitBounded<T>(
		promise: Promise<T>,
		timeoutMs: number,
		signal: AbortSignal | undefined,
		kind: SerialQueueTimeoutKindV1,
		repositoryKey: string,
		startedAt: number,
		depth: number,
		onProgress: SerialQueueRunOptionsV1["onProgress"],
		guard?: SerialQueueGuardV1,
	): Promise<T> {
		if (signal?.aborted) {
			consumeLateSettlement(promise);
			guard?.release();
			return Promise.reject(new SerialQueueTimeoutError(kind, repositoryKey, timeoutMs));
		}
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (fn: () => void): void => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				fn();
			};
			const fail = (error: SerialQueueTimeoutError): void => {
				finish(() => {
					guard?.release();
					consumeLateSettlement(promise);
					emitProgress(onProgress, {
						phase: kind === "queue-wait" ? "queue-wait-timeout" : "queue-head-timeout",
						repositoryKey,
						depth,
						waitedMs: Date.now() - startedAt,
						timeoutMs,
					});
					reject(error);
				});
			};
			const onAbort = (): void => {
				fail(new SerialQueueTimeoutError(kind, repositoryKey, timeoutMs));
			};
			timer = setTimeout(() => {
				// Prefer a predecessor that released in this same timer batch.
				queueMicrotask(() => {
					fail(new SerialQueueTimeoutError(kind, repositoryKey, timeoutMs));
				});
			}, timeoutMs);
			signal?.addEventListener("abort", onAbort, { once: true });
			promise.then(
				(value) => {
					finish(() => resolve(value));
				},
				(error) => {
					finish(() => reject(error));
				},
			);
		});
	}
}

let sharedQueue: PerMainRepoSerialQueueV1 | undefined;

/** Process-wide FIFO so independent service instances still serialize one repository. */
export function sharedPerMainRepoSerialQueueV1(): PerMainRepoSerialQueueV1 {
	return (sharedQueue ??= new PerMainRepoSerialQueueV1());
}

/** Test-only: drop the process-wide FIFO so a poisoned suite cannot leak. */
export function resetSharedPerMainRepoSerialQueueForTests(): void {
	sharedQueue = undefined;
}

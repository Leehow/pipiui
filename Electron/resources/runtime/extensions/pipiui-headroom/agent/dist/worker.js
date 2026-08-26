import { validateCompression } from "./client.js";
const FATAL_REJECTION_REASONS = new Set([
    "invalid_response",
    "empty_output",
    "zero_tokens",
    "hash_missing",
    "retrieval_failed",
    "retrieval_miss",
]);
export class CompressionWorker {
    #client;
    #cache;
    #maxQueue;
    #concurrency;
    #onAccepted;
    #onRejected;
    #onFault;
    #onStateChange;
    #queue = [];
    #knownKeys = new Set();
    #active = new Map();
    #state = "warming";
    #candidates = 0;
    #accepted = 0;
    #rejected = 0;
    #skipped = 0;
    #dropped = 0;
    #lastError;
    #drainScheduled = false;
    #stopped = false;
    #faulted = false;
    constructor(options) {
        this.#client = options.client;
        this.#cache = options.cache;
        this.#maxQueue = options.maxQueue ?? 32;
        this.#concurrency = options.concurrency ?? 2;
        if (!Number.isInteger(this.#maxQueue) || this.#maxQueue <= 0)
            throw new Error("maxQueue must be positive");
        if (!Number.isInteger(this.#concurrency) || this.#concurrency <= 0)
            throw new Error("concurrency must be positive");
        this.#onAccepted = options.onAccepted;
        this.#onRejected = options.onRejected;
        this.#onFault = options.onFault;
        this.#onStateChange = options.onStateChange;
    }
    async checkHealth(options = {}) {
        if (this.#stopped || this.#faulted)
            return false;
        const faultOnFailure = options.faultOnFailure !== false;
        this.#setState("warming");
        const controller = new AbortController();
        try {
            const healthy = await this.#client.health(controller.signal);
            if (!healthy) {
                if (faultOnFailure)
                    this.#fault("health check failed");
                else
                    this.#lastError = "health check failed";
                return false;
            }
            this.#lastError = undefined;
            this.#setState("online");
            this.#scheduleDrain();
            return true;
        }
        catch {
            if (faultOnFailure)
                this.#fault("health check failed");
            else
                this.#lastError = "health check failed";
            return false;
        }
    }
    enqueue(candidate, modelId) {
        if (this.#stopped || this.#faulted || this.#knownKeys.has(candidate.key) || this.#cache.get(candidate.key))
            return false;
        this.#candidates += 1;
        if (this.#queue.length >= this.#maxQueue) {
            const dropped = this.#queue.shift();
            if (dropped) {
                this.#knownKeys.delete(dropped.candidate.key);
                this.#dropped += 1;
            }
        }
        this.#queue.push({ candidate, modelId });
        this.#knownKeys.add(candidate.key);
        this.#scheduleDrain();
        return true;
    }
    stop() {
        if (this.#stopped)
            return;
        this.#stopped = true;
        this.#queue.length = 0;
        this.#knownKeys.clear();
        for (const controller of this.#active.values())
            controller.abort();
        this.#setState("stopped");
    }
    stats() {
        return {
            candidates: this.#candidates,
            queued: this.#queue.length,
            active: this.#active.size,
            accepted: this.#accepted,
            rejected: this.#rejected,
            skipped: this.#skipped,
            dropped: this.#dropped,
            state: this.#state,
            ...(this.#lastError ? { lastError: this.#lastError } : {}),
        };
    }
    #scheduleDrain() {
        if (this.#drainScheduled || this.#stopped || this.#faulted || this.#state !== "online")
            return;
        this.#drainScheduled = true;
        queueMicrotask(() => {
            this.#drainScheduled = false;
            this.#drain();
        });
    }
    #drain() {
        while (!this.#stopped && !this.#faulted && this.#active.size < this.#concurrency && this.#queue.length > 0) {
            const item = this.#queue.shift();
            if (!item)
                break;
            const controller = new AbortController();
            this.#active.set(item.candidate.key, controller);
            void this.#process(item, controller).finally(() => {
                this.#active.delete(item.candidate.key);
                this.#knownKeys.delete(item.candidate.key);
                this.#scheduleDrain();
            });
        }
    }
    async #process(item, controller) {
        try {
            const response = await this.#client.compress(item.candidate, item.modelId, controller.signal);
            const outcome = await validateCompression(item.candidate, response, hash => this.#client.retrieve(hash, controller.signal));
            if (this.#stopped || this.#faulted)
                return;
            if ("status" in outcome) {
                if (outcome.status === "skipped") {
                    this.#skipped += 1;
                    return;
                }
                this.#rejected += 1;
                this.#onRejected?.(item.candidate, outcome.reason);
                if (FATAL_REJECTION_REASONS.has(outcome.reason)) {
                    this.#fault(`compression rejected: ${outcome.reason}`);
                }
                return;
            }
            if (!this.#cache.set(outcome)) {
                this.#rejected += 1;
                this.#onRejected?.(item.candidate, "cache_rejected");
                return;
            }
            this.#accepted += 1;
            this.#lastError = undefined;
            this.#onAccepted?.(outcome);
        }
        catch {
            if (this.#stopped && controller.signal.aborted)
                return;
            this.#rejected += 1;
            this.#onRejected?.(item.candidate, "request_failed");
            // Compression is candidate-local and Headroom deliberately fails open
            // when a compressor exceeds its time budget. Do not permanently hand
            // the session to context-fold for one slow or malformed candidate when
            // the service is still healthy. A failed health probe remains a real
            // service fault and activates the deterministic fallback.
            try {
                if (await this.#client.health(controller.signal)) {
                    if (!this.#stopped && !this.#faulted)
                        this.#lastError = "compression request failed";
                    return;
                }
            }
            catch {
                // The common fault path below owns the stable status and callback.
            }
            if (!this.#stopped && !this.#faulted)
                this.#fault("compression request failed");
        }
    }
    #fault(reason) {
        if (this.#faulted || this.#stopped)
            return;
        this.#faulted = true;
        this.#lastError = reason;
        this.#dropped += this.#queue.length;
        this.#queue.length = 0;
        this.#knownKeys.clear();
        this.#setState("offline");
        this.#onFault?.(reason);
    }
    #setState(state) {
        if (this.#state === state)
            return;
        this.#state = state;
        this.#onStateChange?.(state);
    }
}

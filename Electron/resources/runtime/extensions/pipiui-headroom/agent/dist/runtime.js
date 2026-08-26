import { PreparedCache } from "./cache.js";
import { HeadroomClient } from "./client.js";
import { acquireHeadroomPrimary, beginSession, contextRewriteGateSnapshot, contextRewriteIsAllowed, headroomOwnsPrimary, latchContextFoldFallback, releaseHeadroomPrimary, } from "./coordinator.js";
import { readManagedServiceState } from "./managed-service.js";
import { candidateFromToolResult, transformContext } from "./policy.js";
import { formatStatus } from "./status.js";
import { CompressionWorker } from "./worker.js";
export class HeadroomRuntime {
    #config;
    #warnings;
    #cache;
    #worker;
    #readManagedState;
    #managedPollIntervalMs;
    #ctx;
    #sessionId;
    #enabled = true;
    #fallbackReason;
    #modelId = "unknown";
    #tokensSaved = 0;
    #bytesSaved = 0;
    #substitutions = 0;
    #uniqueSubstitutions = 0;
    #retrievals = 0;
    #pendingRetrievals = new Map();
    #retrievedKeys = new Set();
    #committedKeys = new Set();
    #countedKeys = new Set();
    #warmupAbort;
    #warmupTask;
    constructor(options) {
        this.#config = { ...options.config, protectedTools: [...options.config.protectedTools] };
        this.#warnings = [...(options.warnings ?? [])];
        this.#cache = new PreparedCache(this.#config.maxCacheBytes);
        this.#readManagedState = options.managedStateReader ?? (() => readManagedServiceState(this.#config.managedStatePath, this.#config.managedEngineVersion));
        this.#managedPollIntervalMs = options.managedPollIntervalMs ?? 1_000;
        const client = options.client ?? new HeadroomClient(this.#config);
        this.#worker = new CompressionWorker({
            client,
            cache: this.#cache,
            onAccepted: () => this.#updateStatus(),
            onFault: reason => this.activateFallback(reason),
            onStateChange: () => this.#updateStatus(),
        });
    }
    async start(ctx) {
        this.#ctx = ctx;
        this.#sessionId = ctx.sessionManager.getSessionId();
        beginSession(this.#sessionId);
        this.#updateStatus();
        if (this.#config.managed) {
            if (!this.#config.managedStatePath) {
                this.activateFallback("managed service state is unavailable");
                return false;
            }
            return this.#startManaged();
        }
        return this.#tryClaimPrimary(true);
    }
    observeToolResult(event, ctx) {
        if (!this.#canRun(ctx))
            return;
        const model = this.#model(ctx);
        if (!model.eligible)
            return;
        const candidate = candidateFromToolResult({
            role: "toolResult",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            content: event.content,
            details: event.details,
            isError: event.isError,
            timestamp: Date.now(),
        }, this.#config);
        if (candidate)
            this.#worker.enqueue(candidate, model.id);
    }
    transform(messages, ctx) {
        if (!this.#canRun(ctx))
            return undefined;
        const model = this.#model(ctx);
        if (!model.eligible)
            return undefined;
        const sessionId = this.#sessionId;
        if (!sessionId)
            return undefined;
        const rewriteAllowed = contextRewriteIsAllowed(sessionId);
        const visibleSubstitutions = new Map();
        const transformed = transformContext(messages, this.#config, key => this.#cache.get(key), candidate => { this.#worker.enqueue(candidate, model.id); }, entry => {
            visibleSubstitutions.set(entry.key, entry);
            this.#substitutions += 1;
            if (!this.#countedKeys.has(entry.key)) {
                this.#countedKeys.add(entry.key);
                this.#uniqueSubstitutions += 1;
                this.#tokensSaved += entry.tokensSaved;
                this.#bytesSaved += Math.max(0, entry.originalBytes - entry.compressedBytes);
            }
        }, (candidate) => this.#committedKeys.has(candidate.key) || rewriteAllowed);
        if (rewriteAllowed) {
            for (const key of visibleSubstitutions.keys())
                this.#committedKeys.add(key);
        }
        // A substitution that was visible once remains retrievable until the model
        // actually consumes it. Later context projections may temporarily omit the
        // source result (provider conversion, branch projection, recency guards),
        // but that must not erase the no-argument lossless recovery queue.
        for (const [key, entry] of visibleSubstitutions) {
            if (!this.#retrievedKeys.has(key))
                this.#pendingRetrievals.set(key, entry);
        }
        return transformed;
    }
    async retrieve(signal) {
        void signal;
        this.#retrievals += 1;
        const key = [...this.#pendingRetrievals.keys()].at(-1);
        const entry = key ? this.#pendingRetrievals.get(key) : undefined;
        if (key)
            this.#pendingRetrievals.delete(key);
        if (key && entry)
            this.#retrievedKeys.add(key);
        this.#updateStatus();
        return entry?.originalText ?? "No pending compressed Headroom result. Rerun the originating tool.";
    }
    async setEnabled(enabled) {
        const sessionId = this.#sessionId;
        if (!sessionId)
            return false;
        if (!enabled) {
            this.#enabled = false;
            this.#warmupAbort?.abort();
            releaseHeadroomPrimary(sessionId);
            this.#updateStatus();
            return true;
        }
        if (this.#fallbackReason)
            return false;
        this.#enabled = true;
        if (this.#config.managed) {
            return this.#startManaged();
        }
        return this.#tryClaimPrimary(true);
    }
    async health() {
        if (this.#fallbackReason)
            return false;
        const healthy = await this.#worker.checkHealth({ faultOnFailure: !this.#config.managed });
        this.#updateStatus();
        return healthy;
    }
    activateFallback(reason) {
        if (this.#fallbackReason)
            return;
        this.#fallbackReason = reason;
        this.#enabled = false;
        this.#warmupAbort?.abort();
        this.#worker.stop();
        if (this.#sessionId)
            latchContextFoldFallback(this.#sessionId, reason);
        this.#updateStatus();
    }
    stop() {
        if (this.#sessionId)
            releaseHeadroomPrimary(this.#sessionId);
        this.#warmupAbort?.abort();
        this.#worker.stop();
        this.#pendingRetrievals.clear();
        this.#retrievedKeys.clear();
        this.#committedKeys.clear();
        this.#countedKeys.clear();
        this.#cache.clear();
        try {
            this.#ctx?.ui.setStatus("pipiui-headroom", undefined);
        }
        catch { /* fail-open */ }
        this.#ctx = undefined;
    }
    snapshot() {
        const sessionId = this.#sessionId;
        return {
            enabled: this.#enabled,
            ownsPrimary: Boolean(sessionId && headroomOwnsPrimary(sessionId)),
            ...(sessionId ? { sessionId } : {}),
            modelId: this.#modelId,
            upstreamVersion: this.#config.managedEngineVersion,
            tokensSaved: this.#tokensSaved,
            bytesSaved: this.#bytesSaved,
            substitutions: this.#substitutions,
            uniqueSubstitutions: this.#uniqueSubstitutions,
            retrievals: this.#retrievals,
            ...(this.#fallbackReason ? { fallbackReason: this.#fallbackReason } : {}),
            config: { ...this.#config, protectedTools: [...this.#config.protectedTools] },
            worker: this.#worker.stats(),
            cache: this.#cache.stats(),
            ...(sessionId && contextRewriteGateSnapshot(sessionId)
                ? { rewriteGate: contextRewriteGateSnapshot(sessionId) }
                : {}),
            warnings: [...this.#warnings],
        };
    }
    #canRun(ctx) {
        const sessionId = ctx.sessionManager.getSessionId();
        return this.#enabled && sessionId === this.#sessionId && headroomOwnsPrimary(sessionId);
    }
    #model(ctx) {
        const model = ctx.model;
        const id = model ? `${model.provider ? `${model.provider}/` : ""}${model.id || "unknown"}` : "unknown";
        this.#modelId = id;
        const window = model?.contextWindow;
        return { eligible: !Number.isFinite(window) || window >= this.#config.minContextTokens, id };
    }
    async #tryClaimPrimary(faultOnFailure) {
        const healthy = await this.#worker.checkHealth({ faultOnFailure });
        const sessionId = this.#sessionId;
        if (!healthy || !this.#enabled || !sessionId) {
            this.#updateStatus();
            return false;
        }
        if (!acquireHeadroomPrimary(sessionId)) {
            this.#enabled = false;
            this.#fallbackReason = "context-fold already committed this session";
            this.#worker.stop();
            this.#updateStatus();
            return false;
        }
        this.#updateStatus();
        return true;
    }
    async #startManaged() {
        const state = await this.#readManagedState();
        if (state?.state === "failed" || state?.state === "stopped") {
            this.activateFallback(state.error ? `managed service ${state.state}: ${state.error}` : `managed service ${state.state}`);
            return false;
        }
        if (state?.state === "ready") {
            if (state.baseUrl !== this.#config.baseUrl) {
                this.activateFallback("managed service endpoint identity changed");
                return false;
            }
            const claimed = await this.#tryClaimPrimary(false);
            if (claimed)
                this.#beginManagedMonitor();
            return claimed;
        }
        this.#beginManagedWarmup();
        return false;
    }
    #beginManagedWarmup() {
        this.#beginManagedTask(signal => this.#waitForManagedService(this.#sessionId, signal));
    }
    #beginManagedMonitor() {
        this.#beginManagedTask(signal => this.#monitorManagedService(this.#sessionId, signal));
    }
    #beginManagedTask(run) {
        this.#warmupAbort?.abort();
        const controller = new AbortController();
        this.#warmupAbort = controller;
        const task = run(controller.signal)
            .catch((error) => {
            if (!controller.signal.aborted) {
                this.activateFallback(`managed service supervision failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        })
            .finally(() => {
            if (this.#warmupTask === task)
                this.#warmupTask = undefined;
        });
        this.#warmupTask = task;
    }
    async #waitForManagedService(sessionId, signal) {
        if (!sessionId)
            return;
        const deadline = Date.now() + this.#config.managedStartupTimeoutMs;
        while (!signal.aborted && this.#enabled && this.#sessionId === sessionId && Date.now() < deadline) {
            const state = await this.#readManagedState();
            if (state?.state === "failed" || state?.state === "stopped") {
                this.activateFallback(state.error ? `managed service ${state.state}: ${state.error}` : `managed service ${state.state}`);
                return;
            }
            if (state?.state === "ready") {
                if (state.baseUrl !== this.#config.baseUrl) {
                    this.activateFallback("managed service endpoint identity changed");
                    return;
                }
                if (await this.#tryClaimPrimary(false)) {
                    await this.#monitorManagedService(sessionId, signal);
                    return;
                }
                if (this.#fallbackReason || !this.#enabled)
                    return;
            }
            await this.#warmupSleep(signal);
        }
        if (!signal.aborted && this.#enabled && this.#sessionId === sessionId) {
            this.activateFallback("managed service startup timed out");
        }
    }
    async #monitorManagedService(sessionId, signal) {
        if (!sessionId)
            return;
        while (!signal.aborted && this.#enabled && this.#sessionId === sessionId && headroomOwnsPrimary(sessionId)) {
            await this.#warmupSleep(signal);
            if (signal.aborted)
                return;
            const state = await this.#readManagedState();
            if (!state) {
                this.activateFallback("managed service state disappeared");
                return;
            }
            if (state.state === "ready" && state.baseUrl === this.#config.baseUrl)
                continue;
            const detail = state.error ? `: ${state.error}` : "";
            this.activateFallback(`managed service ${state.state}${detail}`);
            return;
        }
    }
    #warmupSleep(signal) {
        return new Promise((resolve) => {
            if (signal.aborted)
                return resolve();
            const onAbort = () => {
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, this.#managedPollIntervalMs);
            timer.unref?.();
            signal.addEventListener("abort", onAbort, { once: true });
        });
    }
    #updateStatus() {
        try {
            this.#ctx?.ui.setStatus("pipiui-headroom", formatStatus(this.snapshot()));
        }
        catch { /* fail-open */ }
    }
}

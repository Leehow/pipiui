/*
 * index.ts — the context-fold Pi extension entry point.
 *
 * Wires the folding policy into Pi's per-turn `context` hook: before every model call Pi hands
 * us a deep copy of the outgoing message array; we replace the content of stale blocks with
 * short reversible digests and return it. The real session history is never touched — folding
 * lives only in the outgoing copy. The agent pulls any folded block back with the
 * `unfold`/`recall_folded` tools by its `{#<code> FOLDED}` handle.
 *
 * The policy is the discrete fold ladder: fold events mask stale observations into prefix-stable
 * frozen layers, with a deterministic seed index emitted at every event. No model call ever fires
 * on the automatic path. Fully autonomous (no UI prompts) — runs identically headless.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage as CoreAgentMessage } from "../../core/block";
import { FoldLadderPolicy } from "../../core/policy/fold-ladder";
import { ContextFoldEngine } from "./store";
import { SeedIndexStore, emitFoldIndex, emitCompactIndex, spoolCompactedBlocks } from "./index-store";
import { renderDetCompactionSummary } from "./compact";
import { registerHandoffCommand } from "./handoff";
import { linearize, type WireBlock } from "../../core/block";
import { registerFoldTools } from "./unfold-tool";
import { MapSpoolRegistry } from "../../core/spool-registry";
import { SpoolStore } from "./spool";
import { recordSpoolEntry, recordLayer, recordUnfold, restoreFoldState, revalidateSpools } from "./persistence";
import { spoolRetainMsFromEnv, sweepSpools, sweepWorkspaceSpools, touchHeartbeat } from "./retention";
import { CacheTelemetry, k } from "./cache-telemetry";
import { advise } from "./advisor";
import { pruneHistoricalThinking, thinkingPruneConfigFromEnv } from "./thinking-prune";

import { adapterConfigFromEnv, configFromEnv } from "./config";
import { registerLiveContextFoldEngine } from "./live-engine";
import {
	armContextRewrite,
	beginContextRewriteTurn,
	beginContextOptimizerSession,
	clearContextOptimizerState,
	configureContextRewriteGate,
	contextFoldShouldStandby,
	contextOptimizerState,
	contextRewriteIsAllowed,
	disarmContextRewrite,
	finishContextRewriteTurn,
	latchContextFoldFallback,
	observeContextRewriteFraction,
	registerContextFoldFallback,
} from "./optimizer-coordinator";
export { adapterConfigFromEnv, configFromEnv };

/** One product-wide gate for every non-urgent model-visible context rewrite. */
export const CONTEXT_REWRITE_USAGE_FRACTION = 0.45;
export const CONTEXT_REWRITE_QUIET_MS = 4 * 60 * 1000;

export default function contextFold(pi: ExtensionAPI): void {
	// MASTER kill switch: CONTEXTFOLD=0/off/false disables the whole extension — no hooks, no
	// tools, no folding — without changing the installed package.
	const master = process.env.CONTEXTFOLD?.trim().toLowerCase();
	if (master === "0" || master === "off" || master === "false") {
		process.stderr.write("[context-fold] disabled by CONTEXTFOLD=0 — no folding this session\n");
		return;
	}
	const acfg = adapterConfigFromEnv();
	const foldCfg = configFromEnv();
	const thinkingCfg = thinkingPruneConfigFromEnv();
	const ladderPolicy = new FoldLadderPolicy(acfg.ladder);
	// One Pi process owns one extension instance. Reset any stale global left by a test harness or
	// extension reload before later-mounted primaries (for example pipiui-headroom) can claim it.
	clearContextOptimizerState();

	// Exact originals for ladder folds, shared by fold-index emission and recall.
	const registry = new MapSpoolRegistry();
	const engine = new ContextFoldEngine(ladderPolicy, foldCfg, registry);

	const debug = process.env.CONTEXTFOLD_DEBUG === "1" || process.env.CONTEXTFOLD_DEBUG === "true";
	const dumpPath = process.env.CONTEXTFOLD_DUMP?.trim() || null;
	const telemetry = new CacheTelemetry();
	engine.onLayerCommit = (layer) => {
		try {
			recordLayer(pi, layer);
			const saved = engine.status?.metrics?.tokens_saved;
			telemetry.noteFoldEvent(typeof saved === "number" ? saved : 0);
			return true;
		} catch (err) {
			process.stderr.write(`[context-fold] layer persistence failed (fold skipped): ${err instanceof Error ? err.message : String(err)}\n`);
			return false;
		}
	};
	// Share this session engine with idle-fold (P2) and context_manage (P3).
	registerLiveContextFoldEngine(engine);

	// ── advisory state (display-only; nothing here gates a turn) ─────────────────────────────────
	let compactions = 0;
	let lastContextWindow: number | null = null;
	let wasCold = false;
	let warnedWireDeferral = false;
	// A strict signed/tool-coupled reasoning island cannot be surgically edited. Remember its
	// stable outbound fingerprint and ask Pi to compact the whole old region exactly once after
	// the run settles. The completed fingerprint is retained until that island disappears, which
	// prevents a post-compaction context refresh from immediately starting a loop.
	let thinkingSessionId = "";
	let pendingThinkingCompaction: string | null = null;
	let completedThinkingCompaction: string | null = null;
	let thinkingCompactionInFlight = false;
	const resetThinkingCompactionForSession = (sessionId: string) => {
		if (thinkingSessionId === sessionId) return;
		thinkingSessionId = sessionId;
		pendingThinkingCompaction = null;
		completedThinkingCompaction = null;
		thinkingCompactionInFlight = false;
	};
	// True when Pi couldn't report a token count this turn (post-compaction window) and the ladder
	// fell back to its chars÷4 liveTokens estimate — /context-fold marks its usage % with `~` there.
	let ctxUsageIsEstimate = false;
	const buildAdvisory = () => {
		const t = telemetry.snapshot();
		const m = engine.status?.metrics ?? {};
		const carried = t.last
			? t.last.cacheRead + t.last.input
			: typeof m.live_tokens === "number"
				? m.live_tokens
				: null;
		return advise({
			turns: t.turns,
			everWarm: t.everWarm,
			lastCacheRead: t.last?.cacheRead ?? 0,
			lastInput: t.last?.input ?? 0,
			lastTurnAfterFold: t.lastTurnAfterFold,
			carriedTokens: carried,
			contextWindow: lastContextWindow,
			irreducibleFloor: typeof m.irreducible_floor === "number" ? m.irreducible_floor : null,
			reconTokens: acfg.reconTokens,
			recallCalls: engine.recallStats.calls,
			maxRecallsPerCode: engine.recallStats.maxPerCode,
			compactions,
			wireDeferredFolds: t.wireDeferredFolds,
		});
	};

	// The trigger gauge: render whichever ladder condition is actually binding, so the line stays
	// meaningful in every state. Below the entry threshold that IS the threshold ("next fold at
	// 45% ctx"); at or past it the usage threshold is permanently satisfied and the real trigger is
	// maskable mass reaching one ladder step, so the gauge tracks that instead — counting up from
	// 0 right after a fold, since interim emptiness refills as new observations land. "No more
	// folds possible" is reserved for the terminal state where the irreducible floor is over
	// budget. Everything comes from the ladder's published metrics (env-configured, cold-branch
	// aware) — never re-derived or hard-coded here.
	const foldGauge = (m: Record<string, unknown>): string | null => {
		if (m.over_budget === true) return "⚠ no more folds possible (over budget)";
		if (typeof m.usage_fraction !== "number" || typeof m.fold_at !== "number") return null;
		if (m.usage_fraction < m.fold_at) return `next fold at ${Math.round(m.fold_at * 100)}% ctx`;
		if (typeof m.maskable_tokens !== "number" || typeof m.step_tokens !== "number") return null;
		return `next fold: ${k(m.maskable_tokens)}/${k(m.step_tokens)} maskable`;
	};

	// Persistent footer status: one keyed line in Pi's footer (TUI renders it below the stats
	// line; headless modes stub setStatus to a no-op). Updated per turn rather than flashed per
	// event — the numbers ticking up ARE the fold notification, with no transcript pollution.
	const updateFooter = (hctx: {
		ui?: { setStatus?: (key: string, text: string | undefined) => void };
		sessionManager?: { getSessionId?: () => string };
	}) => {
		const setStatus = hctx.ui?.setStatus?.bind(hctx.ui);
		if (!setStatus) return;
		const sessionId = hctx.sessionManager?.getSessionId?.();
		const optimizer = sessionId ? contextOptimizerState(sessionId) : undefined;
		if (optimizer?.primaryOwner && !optimizer.fallbackOwner) {
			setStatus("context-fold", `⧉ context-fold standby · ${optimizer.primaryOwner} primary`);
			return;
		}
		const s = telemetry.snapshot();
		const parts = [
			s.foldEvents === 0 ? "⧉ context-fold idle" : `⧉ context-fold ×${s.foldEvents} · ~${k(s.foldSavedTokens)} tok masked`,
		];
		if (optimizer?.rewriteGate) {
			parts.push(
				optimizer.rewriteGate.activeTurn
					? "rewrite gate active"
					: optimizer.rewriteGate.armed
						? "rewrite gate armed"
						: "rewrite gate waiting (45% + 4m quiet)",
			);
		}
		const gauge = foldGauge(engine.status?.metrics ?? {});
		if (gauge) parts.push(gauge);
		if (s.hitRatio !== null) parts.push(`cache avg ${Math.round(s.hitRatio * 100)}%`);
		if (s.wireDeferredFolds > 0) parts.push("⚠ folds not on wire");
		setStatus("context-fold", parts.join(" · "));
	};

	let rewriteGateTimer: ReturnType<typeof setTimeout> | null = null;
	let rewriteGateGeneration = 0;
	const cancelRewriteGateTimer = () => {
		rewriteGateGeneration += 1;
		if (rewriteGateTimer) clearTimeout(rewriteGateTimer);
		rewriteGateTimer = null;
	};
	const usageFraction = (ctx: ExtensionContext): number | undefined => {
		const usage = ctx.getContextUsage();
		if (!usage || typeof usage.contextWindow !== "number" || usage.contextWindow <= 0) return undefined;
		if (typeof usage.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0) {
			return usage.tokens / usage.contextWindow;
		}
		if (typeof usage.percent === "number" && Number.isFinite(usage.percent) && usage.percent >= 0) {
			return usage.percent / 100;
		}
		return undefined;
	};
	const scheduleRewriteGate = (ctx: ExtensionContext) => {
		cancelRewriteGateTimer();
		const sessionId = ctx.sessionManager.getSessionId();
		beginContextOptimizerSession(sessionId);
		configureContextRewriteGate(sessionId, CONTEXT_REWRITE_USAGE_FRACTION, CONTEXT_REWRITE_QUIET_MS);
		const fraction = usageFraction(ctx);
		observeContextRewriteFraction(sessionId, fraction);
		if (
			fraction === undefined ||
			fraction < CONTEXT_REWRITE_USAGE_FRACTION ||
			!ctx.isIdle() ||
			ctx.hasPendingMessages()
		) return;

		const generation = rewriteGateGeneration;
		rewriteGateTimer = setTimeout(() => {
			rewriteGateTimer = null;
			if (generation !== rewriteGateGeneration) return;
			if (ctx.sessionManager.getSessionId() !== sessionId || !ctx.isIdle() || ctx.hasPendingMessages()) return;
			const freshFraction = usageFraction(ctx);
			observeContextRewriteFraction(sessionId, freshFraction);
			if (freshFraction === undefined || freshFraction < CONTEXT_REWRITE_USAGE_FRACTION) return;
			armContextRewrite(sessionId);
			updateFooter(ctx);
		}, CONTEXT_REWRITE_QUIET_MS);
		// A quiet session must not keep a headless Pi process alive solely for this optimization.
		(rewriteGateTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
	};

	let spool: SpoolStore | null = null;
	let spoolKey = "";
	let indexStore: SeedIndexStore | null = null;
	let indexKey = "";
	const spoolFor = (ctx: { sessionManager: { getSessionDir(): string; getSessionId(): string } }): SpoolStore => {
		const dir = join(ctx.sessionManager.getSessionDir(), "spool", ctx.sessionManager.getSessionId());
		if (!spool || spoolKey !== dir) {
			spool = new SpoolStore(dir);
			spoolKey = dir;
		}
		return spool;
	};
	const indexFor = (ctx: { sessionManager: { getSessionDir(): string; getSessionId(): string } }): SeedIndexStore => {
		const dir = join(ctx.sessionManager.getSessionDir(), "spool", ctx.sessionManager.getSessionId());
		if (!indexStore || indexKey !== dir) {
			indexStore = new SeedIndexStore(dir);
			indexKey = dir;
		}
		return indexStore;
	};

	// On resume, rebuild the spool registry, unfold set, and frozen layers from the event-sourced
	// fold ledger. Revalidate every spool before exposing it to recall.
	// Keyed by SESSION ID: a session switch inside one process re-restores for the new session and
	// clears the previous session's registry (stale codes must never serve another session's spool).
	let restoredFor = "";
	pi.on("session_start", (_event, ctx) => {
		const sid = ctx.sessionManager.getSessionId();
		beginContextOptimizerSession(sid);
		configureContextRewriteGate(sid, CONTEXT_REWRITE_USAGE_FRACTION, CONTEXT_REWRITE_QUIET_MS);
		disarmContextRewrite(sid);
		scheduleRewriteGate(ctx);
		resetThinkingCompactionForSession(sid);
		if (restoredFor === sid) return;
		const isSwitch = restoredFor !== "";
		restoredFor = sid;

		// Spool GC: reap sibling session spools past the retention window. Independent
		// of the restore below — the sweep never touches this session's dir, and the restore only
		// judges this session's own entries.
		const retainMs = spoolRetainMsFromEnv();
		if (retainMs > 0) {
			try {
				const spoolRoot = join(ctx.sessionManager.getSessionDir(), "spool");
				const swept = sweepSpools(spoolRoot, sid, retainMs);
				// Abandoned-workspace pass: sibling workspaces' spool roots age out under the same
				// window, since their own sweep only runs when a session starts there again.
				const wsSwept = sweepWorkspaceSpools(dirname(ctx.sessionManager.getSessionDir()), spoolRoot, retainMs);
				const reaped = swept.reaped.length + wsSwept.reaped.length;
				if (debug && reaped) {
					process.stderr.write(`[context-fold] spool-gc: reaped ${reaped} stale session spool dir(s)\n`);
				}
			} catch (err) {
				process.stderr.write(`[context-fold] spool-gc failed (skipped): ${err instanceof Error ? err.message : String(err)}\n`);
			}
		}

		if (isSwitch) {
			registry.clear();
			engine.resetForSession();
			telemetry.reset();
			// Closure-held advisory state is per-session too — stale values would make the new
			// session's first /context-fold report the old session's compactions or cold streak.
			compactions = 0;
			wasCold = false;
			lastContextWindow = null;
			warnedWireDeferral = false;
			ctxUsageIsEstimate = false;
		}
		updateFooter(ctx);

		// Seq continuity across resume: a compact index record claims max(index)+1, and restoring
		// layers alone would floor the engine below it — the next fold event would then reuse that
		// seq and shadow the compaction recovery map (the JSONL contract is latest-per-seq wins).
		// Runs AFTER the switch reset (which zeroes the floor) and regardless of whether any fold
		// ledger exists — a compact record can exist without one.
		try {
			engine.ensureLayerSeqAtLeast(indexFor(ctx).readAll().reduce((m, r) => Math.max(m, r.seq), 0));
		} catch (err) {
			process.stderr.write(`[context-fold] seed-index seq floor skipped: ${err instanceof Error ? err.message : String(err)}\n`);
		}

		try {
			const { spoolEntries, unfoldedIds, layers } = restoreFoldState(ctx.sessionManager.getEntries() as unknown as { customType?: string; data?: unknown }[]);
			if (spoolEntries.length === 0 && unfoldedIds.size === 0 && layers.length === 0) return;
			const { valid, dropped } = revalidateSpools(spoolEntries);
			for (const e of valid) registry.set(e);
			engine.restoreUnfolded(unfoldedIds);
			// Layers restore byte-verbatim — the persisted substitution bytes are replayed rather
			// than recomputed, so a resumed session's context head is byte-identical to the one
			// the provider already cached.
			engine.restoreLayers(layers);
			if (debug)
				process.stderr.write(
					`[context-fold] resume: restored ${valid.length} spool entries, ${unfoldedIds.size} unfolds, ${layers.length} layers${dropped.length ? `, dropped ${dropped.length} (missing spool)` : ""}\n`,
				);
		} catch (err) {
			// Fail-open: a restore failure just means prior folds render raw this session — but say so,
			// or the only symptom is silent token creep.
			process.stderr.write(`[context-fold] resume restore failed (folds render raw): ${err instanceof Error ? err.message : String(err)}\n`);
		}
	});

	pi.on("before_agent_start", (_event, ctx) => {
		cancelRewriteGateTimer();
		const sessionId = ctx.sessionManager.getSessionId();
		beginContextOptimizerSession(sessionId);
		configureContextRewriteGate(sessionId, CONTEXT_REWRITE_USAGE_FRACTION, CONTEXT_REWRITE_QUIET_MS);
		beginContextRewriteTurn(sessionId);
		updateFooter(ctx);
	});

	// Observe completion only; never register a native-mode `session_before_compact` handler.
	// Keeping the completed fingerprint suppresses a repeat if the same strict island remains in
	// the first post-compaction view, while a later view without it clears the cooldown below.
	pi.on("session_compact", (_event, ctx) => {
		pendingThinkingCompaction = null;
		thinkingCompactionInFlight = false;
		cancelRewriteGateTimer();
		const sessionId = ctx.sessionManager.getSessionId();
		disarmContextRewrite(sessionId);
		scheduleRewriteGate(ctx);
	});

	// OBSERVE-ONLY cache telemetry: every finalized assistant message carries real provider
	// usage (cacheRead/cacheWrite). The per-turn hit ratio is the measured signal for whether
	// folding kept the prefix warm — it collapses on the turn after a head-rewriting fold.
	pi.on("message_end", (event, ctx) => {
		const message = event.message as { role?: string; usage?: Record<string, number> };
		if (message.role !== "assistant" || !message.usage) return;
		telemetry.record(message.usage);
		updateFooter(ctx);
		// Wire watchdog: a fold committed, yet this turn read the whole pre-fold prompt back from
		// cache — the rewrite never reached the provider. Once per session, not per turn.
		if (!warnedWireDeferral && telemetry.snapshot().wireDeferredFolds > 0) {
			warnedWireDeferral = true;
			process.stderr.write(
				"[context-fold] fold committed but not observed on the wire — another extension or the transport is bypassing it (pi-codex-conversion's continuation defers folds to the next user turn)\n",
			);
		}
		if (debug) {
			// The fold-cost half belongs on stderr too, not only in the interactive status command:
			// headless `-p` runs are where fold cost actually gets measured, and there is no command
			// to invoke there.
			const foldCost = telemetry.foldCostLine();
			process.stderr.write(`[context-fold] ${telemetry.statusLine()}${foldCost ? ` · ${foldCost}` : ""}\n`);
		}
		if (dumpPath) {
			// E2E seam, sibling of the view dump: keep the view payload a message array and write
			// telemetry beside it.
			try {
				writeFileSync(`${dumpPath}.telemetry.json`, JSON.stringify(telemetry.snapshot()), "utf8");
			} catch {
				/* dump is best-effort */
			}
		}
	});

	// A Pi "turn" is one provider response, so message_end also fires for every intermediate
	// tool-call response while the agent is visibly still working. Coldness is a session-level
	// recommendation: evaluate it only once Pi says retries, compaction and queued continuations
	// have all settled. This also lets a transient cache miss recover later in the same agent run.
	pi.on("agent_settled", (_event, ctx) => {
		const settledSessionId = ctx.sessionManager.getSessionId();
		finishContextRewriteTurn(settledSessionId);
		scheduleRewriteGate(ctx);
		const t = telemetry.snapshot();
		const adv = buildAdvisory();
		if (adv.coldNow && !wasCold) {
			const carried = t.last ? t.last.cacheRead + t.last.input : 0;
			if (carried >= 20_000)
				process.stderr.write(
					`[context-fold] session cold — the settled run re-billed ~${Math.round(carried / 1000)}k tok as fresh input; consider /new (reconstruction ≈ ${Math.round(acfg.reconTokens / 1000)}k tok via the seed index)\n`,
				);
		}
		// The first response after a fold is intentionally excluded from cold detection because the
		// extension itself rewrote the prefix. Treat it as an ignored sample, not a warm recovery:
		// otherwise a genuinely cold streak would reset here and warn again on its next response.
		if (!t.lastTurnAfterFold) wasCold = adv.coldNow;

		const sessionId = settledSessionId;
		beginContextOptimizerSession(sessionId);
		if (contextFoldShouldStandby(sessionId)) return;
		const strictIsland = pendingThinkingCompaction;
		if (
			!thinkingCfg.enabled ||
			!strictIsland ||
			strictIsland === completedThinkingCompaction ||
			thinkingCompactionInFlight ||
			!ctx.isIdle() ||
			ctx.hasPendingMessages()
		) return;

		// Mark before invoking the fire-and-forget API: synchronous callbacks and another settled
		// notification must both observe the request as consumed.
		pendingThinkingCompaction = null;
		completedThinkingCompaction = strictIsland;
		thinkingCompactionInFlight = true;
		try {
			ctx.compact({
				onComplete: () => {
					thinkingCompactionInFlight = false;
				},
				onError: (error) => {
					thinkingCompactionInFlight = false;
					process.stderr.write(`[context-fold] historical-thinking native compaction failed: ${error.message}\n`);
				},
			});
		} catch (error) {
			thinkingCompactionInFlight = false;
			process.stderr.write(
				`[context-fold] historical-thinking native compaction failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	});

	// The make-or-break pass. It is also exposed through a private well-known Symbol so a later
	// primary can invoke the exact durable path in the same turn if its own synchronous transform
	// fails after context-fold already yielded.
	const applyContextFold = (event: ContextEvent, ctx: ExtensionContext): { messages: ContextEvent["messages"] } => {
		try {
			// Liveness for the GC sweep: mark this session's spool as belonging to a running session,
			// so a quiet-but-live session is not reaped by a sibling's session_start sweep. Throttled
			// internally to once an hour and inert until this session has actually spooled something.
				const sessionId = ctx.sessionManager.getSessionId();
				resetThinkingCompactionForSession(sessionId);
				touchHeartbeat(join(ctx.sessionManager.getSessionDir(), "spool", sessionId));
				lastContextWindow = ctx.getContextUsage()?.contextWindow ?? lastContextWindow;
				const allowNewRewrite = contextRewriteIsAllowed(sessionId);
				ladderPolicy.setEnabled(allowNewRewrite);
			// Ladder cold branch: no live cache read observed after a few turns ⇒ there is no warm
			// prefix to protect, so the ladder folds earlier and more freely (measured, not assumed).
			const t = telemetry.snapshot();
			ladderPolicy.setCold(t.turns >= 3 && t.totals.cacheRead === 0);
			// Fold-event → seed-index emission. Bound per turn so the emitter sees this ctx's stores.
			engine.onFoldEvent = (foldEvent) => {
				try {
					const { record: rec, droppedIds } = emitFoldIndex(foldEvent, {
						spool: spoolFor(ctx),
						registry,
						index: indexFor(ctx),
						sessionId: ctx.sessionManager.getSessionId(),
						persistEntry: (entry) => recordSpoolEntry(pi, entry),
					});
					if (droppedIds.length)
						process.stderr.write(
							`[context-fold] fold-code collision: ${droppedIds.length} block(s) stay raw for this session (${droppedIds.join(", ")})\n`,
						);
					if (debug)
						process.stderr.write(
							`[context-fold] seed-index seq=${rec.seq} (${rec.trigger}): ${rec.spans.length} spans, ${rec.identifiers.length} ids, ${rec.errors.length} errors\n`,
						);
					return droppedIds.length ? droppedIds : true;
				} catch (err) {
					// Reversibility is a commit precondition. Keep this turn raw when durability fails.
					process.stderr.write(`[context-fold] seed-index emission failed (fold skipped): ${err instanceof Error ? err.message : String(err)}\n`);
					return false;
				}
			};
				const pruned = allowNewRewrite
					? pruneHistoricalThinking(
						event.messages as unknown as CoreAgentMessage[],
						ctx.model ? { provider: ctx.model.provider, api: ctx.model.api, id: ctx.model.id } : undefined,
						thinkingCfg,
					)
					: {
						messages: event.messages as unknown as CoreAgentMessage[],
						compactionFingerprint: null,
						prunedThinkingBlocks: 0,
					};
			if (!pruned.compactionFingerprint) {
				pendingThinkingCompaction = null;
				completedThinkingCompaction = null;
			} else if (pruned.compactionFingerprint === completedThinkingCompaction) {
				pendingThinkingCompaction = null;
			} else {
				pendingThinkingCompaction = pruned.compactionFingerprint;
			}
			const usage = ctx.getContextUsage();
			ctxUsageIsEstimate = usage?.tokens == null;
			const messages = engine.process(pruned.messages, {
				contextWindow: usage?.contextWindow ?? null,
				tokens: usage?.tokens ?? null,
			});
			// The cast is the documented harness seam (core/block.ts): the core's structural AgentMessage
			// models exactly the fields the bridge reads, and Pi's real AgentMessage satisfies it.
			updateFooter(ctx); // reflect a fold committed this turn (and the fresh trigger gauge)
			if (dumpPath) {
				// e2e seam: dump the outgoing view so the harness can assert the pointer replaced the payload.
				try {
					writeFileSync(dumpPath, JSON.stringify(messages), "utf8");
				} catch {
					/* dump is best-effort */
				}
			}
			return { messages: messages as unknown as typeof event.messages };
		} catch (err) {
			// Fail-open like the sibling hooks: an engine defect costs this turn's folding (context
			// goes out raw), never the turn itself. The host also catches, but degrade locally and say so.
			process.stderr.write(`[context-fold] fold pass failed (context sent raw): ${err instanceof Error ? err.message : String(err)}\n`);
			return { messages: event.messages };
		}
	};

	const unregisterFallback = registerContextFoldFallback((event, ctx) => {
		const typedCtx = ctx as ExtensionContext;
		const sessionId = typedCtx.sessionManager.getSessionId();
		beginContextOptimizerSession(sessionId);
		latchContextFoldFallback(sessionId, "primary transform failed");
		return applyContextFold(event as ContextEvent, typedCtx);
	});

	// The normal hook sleeps while a healthy primary owns the session. It remains registered so
	// ownership can fall back without remounting extensions or restarting Pi.
	pi.on("context", (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		beginContextOptimizerSession(sessionId);
		if (contextFoldShouldStandby(sessionId)) {
			updateFooter(ctx);
			return;
		}
		const result = applyContextFold(event, ctx);
		if (result.messages !== event.messages) {
			latchContextFoldFallback(sessionId, "context-fold committed an outgoing rewrite");
		}
		return result;
	});

	pi.on("session_shutdown", () => {
		cancelRewriteGateTimer();
		unregisterFallback();
	});

	// HARD COMPACTION (the hard floor): the automatic path NEVER summarizes with a model. With
	// CONTEXTFOLD_COMPACT=det (explicit opt-in) hands Pi a deterministic summary rendered verbatim from
	// the seed index — no hallucination surface, every listed token a lexical hook for recall —
	// after emitting one final "compact" index record for the span leaving live history.
	// CONTEXTFOLD_COMPACT=native leaves Pi's own compaction hook ownership untouched. Pi uses the
	// last registered handler for this event, so even a no-op handler would displace PipiUI's native
	// compaction owner. Explicit `det` opt-in is therefore the only mode that registers this hook.
	if (acfg.compact === "det")
		pi.on("session_before_compact", (event, ctx) => {
			const sessionId = ctx.sessionManager.getSessionId();
			beginContextOptimizerSession(sessionId);
			if (contextFoldShouldStandby(sessionId)) return;
			compactions++;
			try {
			const prep = (event as { preparation: { messagesToSummarize: unknown[]; turnPrefixMessages: unknown[]; tokensBefore: number; firstKeptEntryId: string; previousSummary?: string } }).preparation;
			const index = indexFor(ctx);
			// Pi hands a mid-turn cut over in TWO arrays and drops BOTH from live history:
			// `messagesToSummarize` is the whole turns before the cut turn, `turnPrefixMessages` is the
			// cut turn's own head (compaction.ts: historyEnd = isSplitTurn ? turnStartIndex :
			// firstKeptEntryIndex). Pi's native path summarizes the prefix separately; returning a
			// summary here replaces that path outright, so the prefix is ours to carry or lose. The
			// ranges are disjoint and in this order chronological. Reading only the first array once cost
			// a live session its whole history: the cut landed inside the opening turn, so
			// `messagesToSummarize` was empty and the summary rendered as a bare header.
			const leaving = [
				...(prep.messagesToSummarize ?? []),
				...(prep.turnPrefixMessages ?? []),
			] as unknown as CoreAgentMessage[];
			const blocks = linearize(leaving) as unknown as WireBlock[];
			// Spool-at-compaction: blocks leaving live history that never folded become recallable
			// too — the compact record below then carries recovery spans for the whole span.
			const spooledNow = spoolCompactedBlocks(blocks, {
				spool: spoolFor(ctx),
				registry,
				persistEntry: (entry) => recordSpoolEntry(pi, entry),
			});
			if (debug && spooledNow.length)
				process.stderr.write(`[context-fold] compaction: spooled ${spooledNow.length} unfolded block(s) leaving history\n`);
			const compactRecord = emitCompactIndex(blocks, {
				registry,
				index,
				sessionId: ctx.sessionManager.getSessionId(),
				tokensBefore: prep.tokensBefore,
				contextWindow: lastContextWindow,
			});
			// The compact record claimed a seq; the next fold event must start past it.
			engine.ensureLayerSeqAtLeast(compactRecord.seq);
			const summary = renderDetCompactionSummary({
				records: index.readAll(),
				spoolDir: join(ctx.sessionManager.getSessionDir(), "spool", ctx.sessionManager.getSessionId()),
				previousSummary: prep.previousSummary,
			});
			if (debug)
				process.stderr.write(`[context-fold] det compaction: ${prep.tokensBefore} tok summarized deterministically (no model)\n`);
			return { compaction: { summary, firstKeptEntryId: prep.firstKeptEntryId, tokensBefore: prep.tokensBefore } };
			} catch (err) {
				process.stderr.write(
					`[context-fold] det compaction failed (falling back to Pi default): ${err instanceof Error ? err.message : String(err)}\n`,
				);
				return;
			}
		});

	registerFoldTools(pi, engine, (ids) => recordUnfold(pi, ids));
	registerHandoffCommand(pi, {
		indexFor: (hctx) => indexFor(hctx as Parameters<typeof indexFor>[0]),
		spoolDirFor: (hctx) => join(hctx.sessionManager.getSessionDir(), "spool", hctx.sessionManager.getSessionId()),
	});

	// A display-only status command (no-op safe in headless mode — pure text).
	pi.registerCommand("context-fold", {
		description: "Report context-fold status: fold position, cache health, and the reset yellow flag.",
		handler: async (_args, cmdCtx) => {
			const s = engine.status;
			const m = s?.metrics ?? {};
			const state = s?.text ? s.text : "idle (under budget)";
			const gauge = foldGauge(m);
			const pos =
				typeof m.usage_fraction === "number"
					? ` · usage ${ctxUsageIsEstimate ? "~" : ""}${Math.round((m.usage_fraction as number) * 100)}%${gauge ? ` (${gauge})` : ""}`
					: "";
			const adv = buildAdvisory();
			const lines = [
				`context-fold: ${state}${pos}`,
				`${telemetry.statusLine()}${adv.coldNow ? " · COLD" : ""}${adv.paybackTurns !== null ? ` · reset pays back in ~${adv.paybackTurns} warm turns` : ""}`,
				// Both sides of folding, not just the savings — see CacheTelemetry.foldCostLine.
				...(telemetry.foldCostLine() ? [telemetry.foldCostLine() as string] : []),
				...adv.flags.map((f) => `⚑ ${f}`),
			];
			cmdCtx.ui?.notify?.(lines.join("\n"), adv.flags.length ? "warning" : "info");
		},
	});
}

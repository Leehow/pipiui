/**
 * Main-session compaction fast path (PipiUI).
 *
 * Overrides pi's built-in `session_before_compact` for the App-owned main
 * session only (dispatched workers keep their own paths — PIPIUI_AGENT_DEPTH
 * guard). The built-in summarizer reuses the current thinking level, so a
 * high-reasoning model (e.g. GPT-5.6 Sol with thinking=high) turns a routine
 * context compaction into a 10+ minute unbounded LLM call that RPC `abort`
 * cannot cancel (upstream `agent-session.abort()` never calls
 * `abortCompaction()`).
 *
 * Strategy (all bounded, pi-compatible `{ compaction: ... }` results):
 *   1. LLM fast path: current model, `reasoning: "off"`, bounded serialized
 *      input (head+tail windows, scaled to the model's context window),
 *      wall-clock cap. Skipped up-front when the model cannot run with
 *      thinking off (pi-ai `thinkingLevelMap.off === null`, e.g. pure
 *      reasoning models) — no 30s wasted on a doomed call. Reuses the
 *      session's own model + credentials — no new login required.
 *   2. Deterministic path (instant, zero provider dependency): structured
 *      markdown preserving previous summary, the recent tail of the
 *      conversation verbatim, and file operations.
 *   3. Any throw → return `undefined` → pi's built-in compaction (safe
 *      fallback; the hook never breaks the session).
 *
 * Env knob `PIPIUI_COMPACTION_LLM_DISABLED=1` forces the deterministic path
 * (hermetic tests, offline escape hatch).
 */

import { completeSimple, getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { CompactionResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

/** Upper bound on the serialized conversation handed to the LLM (~50k tokens). */
export const COMPACTION_MAX_SERIALIZED_CHARS = 200_000;
/** Head window: goals / early context. */
export const COMPACTION_SERIALIZED_HEAD_CHARS = 60_000;
/** Tail window: recent work / state. */
export const COMPACTION_SERIALIZED_TAIL_CHARS = 140_000;
/** Wall-clock cap for the LLM path; on expiry the deterministic path takes over. */
export const COMPACTION_LLM_TIMEOUT_MS = 30_000;
export const COMPACTION_LLM_MAX_OUTPUT_TOKENS = 4096;
/** Defensive cap on the final LLM summary text. */
export const COMPACTION_LLM_MAX_SUMMARY_CHARS = 20_000;
/** Deterministic path: goal window from the serialized head. */
export const COMPACTION_DETERMINISTIC_HEAD_CHARS = 2_000;
/** Deterministic path: recent messages kept verbatim (tail window). */
export const COMPACTION_DETERMINISTIC_TAIL_CHARS = 12_000;
/** Deterministic path: previous summary kept verbatim (bounded). */
export const COMPACTION_DETERMINISTIC_PREVIOUS_CHARS = 6_000;

export interface FileOpsLike {
	read?: Set<string> | string[];
	written?: Set<string> | string[];
	edited?: Set<string> | string[];
}

export interface CompactPreparationLike {
	messagesToSummarize: unknown[];
	turnPrefixMessages: unknown[];
	previousSummary?: string;
	tokensBefore: number;
	firstKeptEntryId: string;
	fileOps?: FileOpsLike;
}

/**
 * The pi-ai `Model` metadata the fast path needs. The real `ctx.model` is a
 * full pi-ai Model (has `reasoning`/`thinkingLevelMap`/`contextWindow`);
 * partial `{provider, id}` shapes (tests, minimal ctx) are tolerated.
 */
export interface CompactionModelLike {
	provider: string;
	id: string;
	/** pi-ai Model.reasoning: false for non-reasoning models. */
	reasoning?: boolean;
	/** pi-ai ThinkingLevelMap; `off: null` marks the off level unsupported. */
	thinkingLevelMap?: Record<string, string | null>;
	/** Token context window; used to scale the serialization budget. */
	contextWindow?: number;
}

/**
 * Resolve the model metadata used for the thinking-off gate and the
 * context-window budget. Full pi-ai Models pass through untouched; minimal
 * `{provider, id}` shapes are enriched from the registry's `find()` when
 * available. Never throws.
 */
export function resolveModelMeta(
	model: CompactionModelLike | null | undefined,
	find?: (provider: string, id: string) => CompactionModelLike | undefined,
): CompactionModelLike | undefined {
	if (!model || typeof model !== "object") return undefined;
	if (typeof model.reasoning === "boolean" || typeof model.contextWindow === "number") {
		return model; // already a full pi-ai Model
	}
	if (typeof find === "function") {
		try {
			return find(model.provider, model.id) ?? model;
		} catch {
			return model;
		}
	}
	return model;
}

/**
 * Whether the model can run the summarizer with `reasoning: "off"`.
 * Delegates to pi-ai's own `getSupportedThinkingLevels` (stable public API):
 * a `thinkingLevelMap.off === null` entry marks off unsupported (pure
 * reasoning models). Missing/partial metadata errs permissive — only a
 * definitive "off unsupported" skips the LLM path. Never throws.
 */
export function supportsThinkingOff(model: CompactionModelLike | undefined): boolean {
	if (!model) return true;
	try {
		return getSupportedThinkingLevels(model as never).includes("off");
	} catch {
		// Garbage metadata must never break the hook: keep the old behavior.
		return true;
	}
}

export interface SerializationBudget {
	maxChars: number;
	headChars: number;
	tailChars: number;
}

/**
 * Scale the fixed serialization budget to the model's context window
 * (≈2 chars/token heuristic) so a small-window model never receives a prompt
 * larger than its window — which would fail with a provider error before the
 * deterministic fallback could run. Models without window metadata keep the
 * fixed budget; the result never exceeds `maxChars`. Recent-messages/fileOps
 * semantics are unaffected (the deterministic path uses its own small windows).
 */
export function serializationBudgetForModel(
	model: CompactionModelLike | undefined,
	maxChars: number = COMPACTION_MAX_SERIALIZED_CHARS,
): SerializationBudget {
	const window = model?.contextWindow;
	const tokens =
		typeof window === "number" && Number.isFinite(window) && window > 0 ? window : undefined;
	if (tokens === undefined) {
		return {
			maxChars,
			headChars: COMPACTION_SERIALIZED_HEAD_CHARS,
			tailChars: COMPACTION_SERIALIZED_TAIL_CHARS,
		};
	}
	const scaled = Math.min(maxChars, Math.round(tokens * 2));
	const headChars = Math.round(scaled * 0.3);
	return { maxChars: scaled, headChars, tailChars: scaled - headChars };
}

/**
 * Serialize messages with pi's own serializer, then bound the total size:
 * keep a head window (goals/context) and a tail window (recent state) with an
 * explicit truncation marker between them. Tool results are already truncated
 * to 2000 chars by `serializeConversation`; this is the second, total-size
 * bound for very large contexts (the observed 264k-token main session would
 * serialize to ~1MB without it).
 */
export function boundedSerializeConversation(
	messages: unknown[],
	maxChars: number = COMPACTION_MAX_SERIALIZED_CHARS,
	headChars: number = COMPACTION_SERIALIZED_HEAD_CHARS,
	tailChars: number = COMPACTION_SERIALIZED_TAIL_CHARS,
): string {
	if (!Array.isArray(messages) || messages.length === 0) return "";
	const full = serializeConversation(convertToLlm(messages as never[]));
	if (full.length <= maxChars) return full;
	const head = full.slice(0, headChars);
	const tail = full.slice(full.length - tailChars);
	const dropped = full.length - head.length - tail.length;
	return `${head}\n\n[…上下文过大，已截断 ${dropped.toLocaleString()} 字符（中间部分）…]\n\n${tail}`;
}

/** First `[User]: …` line from the serialized conversation (goal heuristic). */
export function extractSerializedGoal(
	serialized: string,
	maxChars: number = COMPACTION_DETERMINISTIC_HEAD_CHARS,
): string {
	if (typeof serialized !== "string") {
		return "（未能从历史中提取目标，见 Recent Messages）";
	}
	for (const line of serialized.split("\n")) {
		const m = /^\[User\]:\s*(.*)$/.exec(line);
		if (m?.[1]?.trim()) {
			const text = m[1].trim();
			return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
		}
	}
	return "（未能从历史中提取目标，见 Recent Messages）";
}

/** Extract the first non-empty line of a `## <heading>` section, if present. */
function extractSectionLine(markdown: string, heading: string): string | undefined {
	const re = new RegExp(`##\\s+${heading}\\s*\\n([^#\\n][^\\n]{0,400})`);
	const m = re.exec(markdown);
	const line = m?.[1]?.trim();
	return line ? line : undefined;
}

function formatFileOps(fileOps: FileOpsLike | undefined): string {
	if (!fileOps) return "（无）";
	const fmt = (label: string, values: unknown): string => {
		if (values == null) return "";
		let items: string[];
		try {
			if (values instanceof Set) {
				items = [...values].map((v) => String(v));
			} else if (Array.isArray(values)) {
				items = values.map((v) => String(v));
			} else if (typeof values === "string") {
				items = [values];
			} else {
				// Non-iterable garbage ({}, numbers, …): ignore, never throw.
				return "";
			}
		} catch {
			return "";
		}
		const clean = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
		if (clean.length === 0) return "";
		return `- ${label}: ${clean.slice(0, 50).sort().join(", ")}`;
	};
	const lines = [
		fmt("read", fileOps.read),
		fmt("written", fileOps.written),
		fmt("edited", fileOps.edited),
	].filter(Boolean);
	return lines.length > 0 ? lines.join("\n") : "（无）";
}

export interface DeterministicSummaryInput {
	serialized: string;
	previousSummary?: string;
	fileOps?: FileOpsLike;
	tokensBefore: number;
	messageCount: number;
	reason: string;
}

/**
 * Deterministic bounded summary in pi's structured markdown shape. No LLM,
 * no provider, no credentials: instant and always available. Preserves the
 * previous summary (if any), the recent tail of the conversation verbatim,
 * and the extracted file-operation/state info.
 */
export function buildDeterministicSummary(input: DeterministicSummaryInput): string {
	const { serialized, previousSummary, fileOps, tokensBefore, messageCount, reason } = input;

	const prev =
		typeof previousSummary === "string" && previousSummary.trim()
			? previousSummary.trim().slice(0, COMPACTION_DETERMINISTIC_PREVIOUS_CHARS)
			: undefined;
	const goal =
		extractSectionLine(prev ?? "", "Goal") ??
		extractSerializedGoal(serialized);
	const tail =
		typeof serialized === "string" && serialized
			? serialized.slice(-COMPACTION_DETERMINISTIC_TAIL_CHARS)
			: "";
	const files = formatFileOps(fileOps);

	const parts: string[] = [];
	parts.push(`## Goal\n${goal}`);
	parts.push(
		`## Previous Summary\n${
			prev ?? "（无）"
		}`,
	);
	parts.push(
		`## Recent Messages\n${
			tail || "（无可序列化内容）"
		}`,
	);
	parts.push(`## Files\n${files}`);
	parts.push(
		"## Next Steps\n继续推进 Recent Messages 中尚未完成的工作；必要时用 read 复查 Files 中的文件，并保持验证状态。",
	);
	parts.push(
		`<!-- pipiui-compaction deterministic reason=${reason} messages=${messageCount} tokensBefore=${tokensBefore} -->`,
	);
	return parts.join("\n\n");
}

interface CombinedSignal {
	signal: AbortSignal;
	cleanup: () => void;
}

/** Parent signal + wall-clock timeout composed into one abort signal. */
export function composeTimeoutSignal(
	parent: AbortSignal | undefined,
	timeoutMs: number,
): CombinedSignal {
	const controller = new AbortController();
	const onParentAbort = () => controller.abort();
	if (parent?.aborted) {
		controller.abort();
	} else {
		parent?.addEventListener("abort", onParentAbort, { once: true });
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref?.();
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParentAbort);
		},
	};
}

function extractTextBlocks(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c): c is { type: string; text?: unknown } =>
				typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text",
		)
		.map((c) => String(c.text ?? ""))
		.join("\n")
		.trim();
}

const COMPACTION_LLM_PROMPT = (
	serialized: string,
	previousContext: string,
	reason: string,
): string => `You are a conversation summarizer for a long coding session. Create a concise
structured summary that replaces the old conversation history, so work can continue
without re-reading it. Capture:
1. The main goal and constraints
2. Key decisions and their rationale
3. Files read/modified and important technical state
4. Current progress, blockers, and open questions
5. Next steps

The summary must be self-contained; the full history below will be discarded.
Output structured markdown with ## sections. Keep it under 4000 tokens.
${previousContext}

<conversation trigger="${reason}">
${serialized}
</conversation>`;

export interface SessionBeforeCompactEventLike {
	preparation?: CompactPreparationLike;
	reason?: string;
	willRetry?: boolean;
	signal?: AbortSignal;
}

export interface CompactionHandlerOptions {
	/** Force the deterministic path (mirrors env PIPIUI_COMPACTION_LLM_DISABLED=1). */
	llmDisabled?: boolean;
	/**
	 * Injectable completion dependency (production default: `completeSimple`).
	 * Test seam — hermetic tests substitute a fake to assert the fast-path
	 * options (reasoning off, AbortSignal, budget) without any network.
	 */
	complete?: typeof completeSimple;
	/** Wall-clock cap override (production default: COMPACTION_LLM_TIMEOUT_MS). Test seam. */
	timeoutMs?: number;
}

/**
 * Core handler, exported for hermetic tests. Returns the pi extension result
 * shape: `{ compaction: { summary, firstKeptEntryId, tokensBefore, usage?, details? } }`,
 * or `undefined` to fall back to pi's built-in compaction.
 */
export async function handleSessionBeforeCompact(
	event: SessionBeforeCompactEventLike,
	ctx: {
		model?: CompactionModelLike | null;
		modelRegistry?: {
			getApiKeyAndHeaders: (model: unknown) => Promise<{
				ok: boolean;
				apiKey?: string;
				headers?: Record<string, string>;
				env?: Record<string, string>;
				error?: string;
			}>;
			/** Enrich a partial `{provider, id}` model with pi-ai metadata. */
			find?: (provider: string, id: string) => CompactionModelLike | undefined;
		};
	},
	opts: CompactionHandlerOptions = {},
): Promise<{ compaction: Record<string, unknown> } | undefined> {
	const preparation = event?.preparation;
	if (!preparation || !preparation.firstKeptEntryId) return undefined;
	if (event.signal?.aborted) return undefined;

	let messages: unknown[] = [];
	let serialized = "";
	try {
		// Malformed (non-array) message lists must never throw: the deterministic
		// path stays available instead of falling back to pi's unbounded
		// built-in compaction.
		messages = [
			...(Array.isArray(preparation.messagesToSummarize)
				? preparation.messagesToSummarize
				: []),
			...(Array.isArray(preparation.turnPrefixMessages) ? preparation.turnPrefixMessages : []),
		];
		serialized = boundedSerializeConversation(messages);
	} catch {
		serialized = "";
	}

	const llmDisabled = opts.llmDisabled ?? process.env.PIPIUI_COMPACTION_LLM_DISABLED === "1";
	if (!llmDisabled && serialized) {
		const model = resolveModelMeta(ctx?.model, ctx?.modelRegistry?.find);
		// Pure-reasoning models (pi-ai `thinkingLevelMap.off === null`) cannot run
		// the summarizer with thinking off: skip the network call entirely and go
		// straight to the deterministic path instead of burning the wall-clock cap.
		if (model && supportsThinkingOff(model) && ctx?.modelRegistry?.getApiKeyAndHeaders) {
			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (auth.ok && auth.apiKey) {
					const combined = composeTimeoutSignal(
						event.signal,
						opts.timeoutMs ?? COMPACTION_LLM_TIMEOUT_MS,
					);
					try {
						const previous =
							typeof preparation.previousSummary === "string"
								? preparation.previousSummary
								: "";
						const previousContext = previous
							? `\nPrevious summary for context:\n${previous}`
							: "";
						// Scale the serialization to the model's context window so a
						// small-window model never receives an oversized prompt.
						const budget = serializationBudgetForModel(model);
						const llmSerialized =
							budget.maxChars === COMPACTION_MAX_SERIALIZED_CHARS
								? serialized
								: boundedSerializeConversation(
										messages,
										budget.maxChars,
										budget.headChars,
										budget.tailChars,
									);
						const complete = opts.complete ?? completeSimple;
						const response = await complete(
							model as never,
							{
								messages: [
									{
										role: "user" as const,
										content: [
											{
												type: "text" as const,
												text: COMPACTION_LLM_PROMPT(
													llmSerialized,
													previousContext,
													event.reason ?? "auto",
												),
											},
										],
										timestamp: Date.now(),
									},
								],
							},
							{
								apiKey: auth.apiKey,
								headers: auth.headers,
								env: auth.env,
								// `SimpleStreamOptions.reasoning` is typed as `ThinkingLevel`
								// which excludes "off", but pi-ai's runtime supports it
								// (see getSupportedThinkingLevels / thinkingLevelMap.off,
								// e.g. openai-responses falls back to effort "none"). The
								// cast is deliberate; revisit only with a pi-ai type update.
								reasoning: "off" as never,
								maxTokens: COMPACTION_LLM_MAX_OUTPUT_TOKENS,
								signal: combined.signal,
							},
						);
						const summary = extractTextBlocks(response.content).slice(
							0,
							COMPACTION_LLM_MAX_SUMMARY_CHARS,
						);
						// `combined.signal.aborted` also covers wall-clock expiry: a
						// provider that ignores the abort must not have its late
						// response accepted after the cap.
						if (summary && !event.signal?.aborted && !combined.signal.aborted) {
							return {
								compaction: {
									summary,
									firstKeptEntryId: preparation.firstKeptEntryId,
									tokensBefore: preparation.tokensBefore,
									usage: (response as { usage?: unknown }).usage,
									details: {
										source: "pipiui",
										mode: "llm-fast",
										reason: event.reason ?? "auto",
									},
								},
							};
						}
					} finally {
						combined.cleanup();
					}
				}
			} catch {
				// LLM path failure (auth, timeout, provider error) → deterministic path.
			}
		}
	}

	if (event.signal?.aborted) return undefined;

	const summary = buildDeterministicSummary({
		serialized,
		previousSummary: preparation.previousSummary,
		fileOps: preparation.fileOps,
		tokensBefore: preparation.tokensBefore,
		messageCount: messages.length,
		reason: event.reason ?? "auto",
	});
	return {
		compaction: {
			summary,
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
			details: {
				source: "pipiui",
				mode: "deterministic",
				reason: event.reason ?? "auto",
				messageCount: messages.length,
			},
		},
	};
}

/** Structural match for pi's (not-root-exported) SessionBeforeCompactResult. */
type SessionBeforeCompactResultLike = { cancel?: boolean; compaction?: CompactionResult };

/**
 * Wire the hook for the App-owned main session (depth 0). Dispatched workers
 * (depth >= 1) keep their own compaction behavior. Any throw inside the hook
 * returns `undefined` so pi falls back to its built-in compaction — the hook
 * must never break or block a session.
 */
export function registerMainSessionCompactionHook(pi: ExtensionAPI): void {
	const depth = Number.parseInt(process.env.PIPIUI_AGENT_DEPTH || "0", 10);
	if (depth !== 0) return;
	pi.on(
		"session_before_compact",
		async (event, ctx): Promise<SessionBeforeCompactResultLike | undefined> => {
			try {
				// Loose internal types ↔ typed extension API: the shape is compatible
				// at runtime (SessionBeforeCompactResult.compaction = CompactionResult).
				return (await handleSessionBeforeCompact(
					event as SessionBeforeCompactEventLike,
					ctx as never,
				)) as unknown as SessionBeforeCompactResultLike | undefined;
			} catch {
				// Safe fallback: pi's built-in compaction.
				return undefined;
			}
		},
	);
}

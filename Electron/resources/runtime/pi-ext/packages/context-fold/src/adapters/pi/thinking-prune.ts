/*
 * Pure outbound historical-thinking pruning.
 *
 * Pi gives the `context` hook a cloned provider-independent message array. This transform only
 * changes that outbound view: it never writes SessionManager entries and never mutates its input.
 * Provider signatures are treated as protocol data, not prose. Surgical omission is therefore a
 * small allowlist; every other over-age signed/tool-coupled island asks the adapter to compact the
 * whole old region after the agent settles.
 */
import { createHash } from "node:crypto";

export const THINKING_OMITTED_MARKER = "[historical thinking omitted]";

export interface ThinkingPruneConfig {
	enabled: boolean;
	keepUserTurns: number;
}

export interface ThinkingPruneModel {
	provider?: string;
	api?: string;
	id?: string;
}

interface ThinkingPruneMessage {
	role: string;
	content?: unknown;
	provider?: unknown;
	api?: unknown;
	model?: unknown;
	stopReason?: unknown;
	deferred?: unknown;
}

interface ContentPart {
	type?: unknown;
	thinking?: unknown;
	thinkingSignature?: unknown;
	redacted?: unknown;
	thoughtSignature?: unknown;
	textSignature?: unknown;
}

export interface ThinkingPruneResult<T> {
	messages: T[];
	/** Stable identity of over-age protocol islands that require whole-region compaction. */
	compactionFingerprint: string | null;
	prunedThinkingBlocks: number;
}

const DEFAULT_KEEP_USER_TURNS = 20;
const COMPLETE_STOP_REASONS = new Set(["stop", "toolUse"]);
const RESPONSES_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);

function isDisabled(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "0" || normalized === "off" || normalized === "false";
}

export function thinkingPruneConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ThinkingPruneConfig {
	const rawKeep = env.CONTEXTFOLD_THINKING_KEEP_TURNS?.trim();
	const keepUserTurns = rawKeep != null && /^\d+$/.test(rawKeep) ? Number(rawKeep) : DEFAULT_KEEP_USER_TURNS;
	return {
		enabled: !isDisabled(env.CONTEXTFOLD_THINKING),
		keepUserTurns: Number.isSafeInteger(keepUserTurns) ? keepUserTurns : DEFAULT_KEEP_USER_TURNS,
	};
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function partsOf(message: ThinkingPruneMessage): ContentPart[] | null {
	return Array.isArray(message.content) ? (message.content as ContentPart[]) : null;
}

function isThinking(part: ContentPart): boolean {
	return part?.type === "thinking";
}

function hasSignature(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}

function exactModelRelation(
	message: ThinkingPruneMessage,
	target: ThinkingPruneModel | undefined,
): "same" | "cross" | "unknown" {
	const sourceProvider = stringField(message.provider);
	const sourceApi = stringField(message.api);
	const sourceModel = stringField(message.model);
	const targetProvider = stringField(target?.provider);
	const targetApi = stringField(target?.api);
	const targetModel = stringField(target?.id);
	if (!sourceProvider || !sourceApi || !sourceModel || !targetProvider || !targetApi || !targetModel) return "unknown";
	return sourceProvider === targetProvider && sourceApi === targetApi && sourceModel === targetModel ? "same" : "cross";
}

function isCompletedPriorTurn(message: ThinkingPruneMessage, hasLaterUser: boolean): boolean {
	return hasLaterUser && COMPLETE_STOP_REASONS.has(String(message.stopReason)) && message.deferred == null;
}

function fingerprint(islands: Array<{ index: number; message: ThinkingPruneMessage }>): string | null {
	if (islands.length === 0) return null;
	const hash = createHash("sha256");
	for (const island of islands) {
		hash.update(String(island.index));
		hash.update("\0");
		hash.update(JSON.stringify(island.message));
		hash.update("\0");
	}
	return hash.digest("hex");
}

/**
 * Remove only source-backed historical reasoning from the model-visible copy.
 *
 * `keepUserTurns` counts user messages, not provider responses: with 21 user turns and the
 * default of 20, only turn 1 is eligible. The newest user turn is always protected even when the
 * configured keep window is zero, so the current tool island cannot be split.
 */
export function pruneHistoricalThinking<T extends ThinkingPruneMessage>(
	messages: T[],
	target: ThinkingPruneModel | undefined,
	config: ThinkingPruneConfig,
): ThinkingPruneResult<T> {
	if (!config.enabled || messages.length === 0) {
		return { messages, compactionFingerprint: null, prunedThinkingBlocks: 0 };
	}

	const totalUserTurns = messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
	const keep = Number.isSafeInteger(config.keepUserTurns) && config.keepUserTurns >= 0
		? config.keepUserTurns
		: DEFAULT_KEEP_USER_TURNS;
	const firstProtectedTurn = Math.max(1, totalUserTurns - keep + 1);
	const hasLaterUser = new Array<boolean>(messages.length).fill(false);
	let userSeenToRight = false;
	for (let i = messages.length - 1; i >= 0; i--) {
		hasLaterUser[i] = userSeenToRight;
		if (messages[i]?.role === "user") userSeenToRight = true;
	}

	let userTurn = 0;
	let output: T[] | null = null;
	let prunedThinkingBlocks = 0;
	const strictIslands: Array<{ index: number; message: ThinkingPruneMessage }> = [];

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "user") {
			userTurn++;
			continue;
		}
		if (message.role !== "assistant" || userTurn >= firstProtectedTurn) continue;
		if (!isCompletedPriorTurn(message, hasLaterUser[index])) continue;

		const parts = partsOf(message);
		if (!parts) continue;
		const thinkingParts = parts.filter(isThinking);
		if (thinkingParts.length === 0) continue;

		const relation = exactModelRelation(message, target);
		const api = stringField(target?.api) ?? stringField(message.api) ?? "";
		const provider = stringField(target?.provider) ?? stringField(message.provider) ?? "";
		const hasToolCall = parts.some((part) => part?.type === "toolCall");
		const hasForeignPartSignature = parts.some(
			(part) => hasSignature(part.thoughtSignature) || hasSignature(part.textSignature),
		);
		const allThinkingUnsigned = thinkingParts.every(
			(part) => !hasSignature(part.thinkingSignature) && part.redacted !== true,
		);
		const hasAnyIslandSignature = hasForeignPartSignature || thinkingParts.some(
			(part) => hasSignature(part.thinkingSignature) || part.redacted === true,
		);

		let mayDelete = false;
		if (relation === "cross") {
			// Pi cannot replay foreign signatures. Remove readable and opaque thinking now, while
			// leaving tool metadata intact for Pi's later ID/signature normalization pass.
			mayDelete = true;
		} else if (relation === "same" && api === "anthropic-messages") {
			// Anthropic permits whole old thinking/redacted blocks to be omitted after the turn,
			// but a foreign per-part signature means this is not a pure Anthropic island.
			mayDelete = !hasForeignPartSignature;
		} else if (relation === "same" && provider === "deepseek" && api === "openai-completions") {
			mayDelete = !hasToolCall;
		} else {
			const strictApi = RESPONSES_APIS.has(api) || provider === "xai";
			// Generic fallback is intentionally narrow: an entirely unsigned, non-redacted,
			// no-tool assistant. Google unsigned thought summaries also fit this safe shape.
			mayDelete = !strictApi && !hasToolCall && !hasAnyIslandSignature && allThinkingUnsigned;
		}

		if (!mayDelete) {
			// Every denied old island is either provider-strict, signed, redacted, or tool-coupled.
			// It must eventually leave as a whole through Pi compaction instead of living forever.
			strictIslands.push({ index, message });
			continue;
		}

		const kept = parts.filter((part) => !isThinking(part));
		const content = kept.length > 0 ? kept : [{ type: "text", text: THINKING_OMITTED_MARKER }];
		if (!output) output = messages.slice();
		output[index] = { ...message, content } as T;
		prunedThinkingBlocks += thinkingParts.length;
	}

	return {
		messages: output ?? messages,
		compactionFingerprint: fingerprint(strictIslands),
		prunedThinkingBlocks,
	};
}

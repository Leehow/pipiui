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
 *   2. Deterministic path (instant, zero provider dependency): fixed-budget
 *      structured markdown preserving the sticky prior summary, high-value raw
 *      transcript excerpts, and file operations while filtering tool noise.
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
/** Deterministic path: total summary budget (all required headings always remain). */
export const COMPACTION_DETERMINISTIC_MAX_SUMMARY_CHARS = 16_000;

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
			return clipDeterministicText(text, maxChars);
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

type SerializedTranscriptTag =
	| "User"
	| "Assistant"
	| "Assistant thinking"
	| "Assistant tool calls"
	| "Tool result";

interface SerializedTranscriptRecord {
	tag: SerializedTranscriptTag;
	text: string;
	order: number;
}

interface DeterministicSection {
	heading: string;
	content: string;
	empty: string;
	priority: number;
	maxChars: number;
}

const SERIALIZED_TRANSCRIPT_RECORD =
	/^\[(User|Assistant(?: thinking| tool calls)?|Tool result)\]:\s?(.*)$/;
const USER_CORRECTION_PATTERN =
	/\b(?:actually|instead|rather|correction|correct(?:ion)?|change(?:d)?|revise|don't|do not|must not|only|no longer|avoid|replace)\b|改口|修正|更正|改为|不要|必须|仅|改成|别再/i;
const CONSTRAINT_OR_DECISION_PATTERN =
	/\b(?:must|must not|should|should not|only|never|always|constraint|decision|decided|choose|chosen|plan|planned|prefer|avoid|keep|preserve|require|don't|do not)\b|约束|决定|方案|计划|保留|禁止|仅|必须|不要/i;
const LIFECYCLE_PATTERN =
	/\b(?:in[- ]?flight|in progress|running|pending|verify|verification|verified|test(?:ed|ing)?|pass(?:ed)?|fail(?:ed|ure)?|closeout|close[- ]?out|agentId|agent id|worktree|plan|merge|commit|build|exit(?: code)?|done)\b|进行中|验证|已验证|测试|通过|失败|收尾|代理|工作树|计划|合并|提交/i;
const ERROR_OR_OPEN_LOOP_PATTERN =
	/\b(?:error|failed|failure|exception|enoent|not found|blocked|blocker|unresolved|open loop|todo|fixme|cannot|can't|unable|timeout|timed out|retry|pending)\b|错误|失败|异常|阻塞|未解决|待处理|待验证|超时|重试/i;

function clipDeterministicText(value: unknown, maxChars: number): string {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text || maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	if (maxChars === 1) return "…";
	const head = text.slice(0, maxChars - 1).trimEnd();
	return `${head || text.slice(0, maxChars - 1)}…`;
}

function normalizeTranscriptText(value: string): string {
	return value
		.replace(/\u0000/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function parseSerializedTranscript(serialized: string): SerializedTranscriptRecord[] {
	if (typeof serialized !== "string" || !serialized.trim()) return [];
	const records: SerializedTranscriptRecord[] = [];
	let current: SerializedTranscriptRecord | undefined;
	for (const line of serialized.split(/\r?\n/)) {
		const match = SERIALIZED_TRANSCRIPT_RECORD.exec(line);
		if (match) {
			current = {
				tag: match[1] as SerializedTranscriptTag,
				text: match[2] ?? "",
				order: records.length,
			};
			records.push(current);
		} else if (current) {
			current.text += `\n${line}`;
		}
	}
	if (records.length === 0) {
		return [{ tag: "Assistant", text: normalizeTranscriptText(serialized), order: 0 }];
	}
	return records.map((record) => ({ ...record, text: normalizeTranscriptText(record.text) }));
}

function transcriptOneLine(record: SerializedTranscriptRecord, maxChars: number): string {
	return clipDeterministicText(record.text.replace(/\s+/g, " "), maxChars);
}

function transcriptLabel(tag: SerializedTranscriptTag): string {
	if (tag === "Assistant thinking") return "Assistant thinking";
	if (tag === "Assistant tool calls") return "Assistant tool calls";
	if (tag === "Tool result") return "Tool result";
	return tag;
}

function selectLatestTranscriptRecords(
	records: SerializedTranscriptRecord[],
	predicate: (record: SerializedTranscriptRecord) => boolean,
	limit: number,
): SerializedTranscriptRecord[] {
	const picked: SerializedTranscriptRecord[] = [];
	const seen = new Set<string>();
	for (let i = records.length - 1; i >= 0 && picked.length < limit; i--) {
		const record = records[i];
		if (!record.text || !predicate(record)) continue;
		const key = `${record.tag}:${record.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		picked.push(record);
	}
	return picked.reverse();
}

function formatTranscriptFacts(records: SerializedTranscriptRecord[], perLineChars: number): string {
	const lines = records
		.map((record) => {
			const text = transcriptOneLine(record, perLineChars);
			return text ? `- ${transcriptLabel(record.tag)}: ${text}` : "";
		})
		.filter(Boolean);
	return lines.join("\n");
}

function isHighSignalToolRecord(record: SerializedTranscriptRecord): boolean {
	return (
		record.tag !== "Tool result" && record.tag !== "Assistant thinking"
			? true
			: LIFECYCLE_PATTERN.test(record.text) || ERROR_OR_OPEN_LOOP_PATTERN.test(record.text)
	);
}

function nextStepsFromTranscript(records: SerializedTranscriptRecord[]): string {
	const lines: string[] = [];
	const correction = selectLatestTranscriptRecords(
		records,
		(record) => record.tag === "User" && USER_CORRECTION_PATTERN.test(record.text),
		1,
	)[0];
	if (correction) lines.push(`- Honor the latest user correction: ${transcriptOneLine(correction, 500)}`);
	const error = selectLatestTranscriptRecords(
		records,
		(record) => ERROR_OR_OPEN_LOOP_PATTERN.test(record.text),
		1,
	)[0];
	if (error) lines.push(`- Resolve or re-check: ${transcriptOneLine(error, 500)}`);
	const lifecycle = selectLatestTranscriptRecords(
		records,
		(record) => LIFECYCLE_PATTERN.test(record.text),
		1,
	)[0];
	if (lifecycle) lines.push(`- Continue from this status: ${transcriptOneLine(lifecycle, 500)}`);
	if (lines.length === 0) {
		lines.push("- Continue from Recent Timeline and run the relevant verification before closeout.");
	}
	return [...new Set(lines)].slice(0, 3).join("\n");
}

function renderDeterministicSections(
	sections: DeterministicSection[],
	footer: string,
	budget: number = COMPACTION_DETERMINISTIC_MAX_SUMMARY_CHARS,
): string {
	const safeFooter = clipDeterministicText(footer, 300);
	const base = [
		...sections.map((section) => `## ${section.heading}\n${section.empty}`),
		safeFooter,
	].join("\n\n");
	let remaining = Math.max(0, budget - base.length);
	const rendered = new Map<DeterministicSection, string>();
	for (const section of [...sections].sort((a, b) => a.priority - b.priority)) {
		const desired = clipDeterministicText(section.content, section.maxChars) || section.empty;
		const allowance = Math.min(desired.length, section.empty.length + remaining);
		const value = allowance >= desired.length ? desired : clipDeterministicText(desired, allowance);
		rendered.set(section, value || section.empty);
		remaining -= Math.max(0, (rendered.get(section)?.length ?? 0) - section.empty.length);
	}
	return [
		...sections.map((section) => `## ${section.heading}\n${rendered.get(section) ?? section.empty}`),
		safeFooter,
	].join("\n\n");
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
 * Deterministic, transcript-derived compaction summary. It keeps stable
 * headings under a fixed budget and promotes user corrections, lifecycle
 * facts, errors, plans/worktrees, and verification over repetitive tool output.
 */
export function buildDeterministicSummary(input: DeterministicSummaryInput): string {
	const { serialized, previousSummary, fileOps, tokensBefore, messageCount, reason } = input;
	const records = parseSerializedTranscript(serialized);
	const prev =
		typeof previousSummary === "string" && previousSummary.trim()
			? clipDeterministicText(previousSummary, COMPACTION_DETERMINISTIC_PREVIOUS_CHARS)
			: "";
	const firstUser = records.find((record) => record.tag === "User" && record.text);
	const goal =
		extractSectionLine(prev, "Goal") ??
		(firstUser ? transcriptOneLine(firstUser, COMPACTION_DETERMINISTIC_HEAD_CHARS) : undefined) ??
		extractSerializedGoal(serialized);
	const corrections = formatTranscriptFacts(
		selectLatestTranscriptRecords(
			records,
			(record) => record.tag === "User" && USER_CORRECTION_PATTERN.test(record.text),
			6,
		),
		700,
	);
	const constraintsAndDecisions = formatTranscriptFacts(
		selectLatestTranscriptRecords(records, (record) => CONSTRAINT_OR_DECISION_PATTERN.test(record.text), 8),
		700,
	);
	const lifecycle = formatTranscriptFacts(
		selectLatestTranscriptRecords(records, (record) => LIFECYCLE_PATTERN.test(record.text), 10),
		700,
	);
	const errorsAndOpenLoops = formatTranscriptFacts(
		selectLatestTranscriptRecords(records, (record) => ERROR_OR_OPEN_LOOP_PATTERN.test(record.text), 8),
		700,
	);
	const timeline = formatTranscriptFacts(
		selectLatestTranscriptRecords(records, isHighSignalToolRecord, 12),
		600,
	);
	const recentMessages = formatTranscriptFacts(
		selectLatestTranscriptRecords(
			records,
			(record) =>
				record.tag === "User" ||
				record.tag === "Assistant" ||
				(record.tag === "Assistant tool calls" && isHighSignalToolRecord(record)),
			8,
		),
		550,
	);
	const safeReason = clipDeterministicText(String(reason ?? "auto").replace(/-->/g, ""), 120) || "auto";
	const safeTokensBefore = Number.isFinite(tokensBefore) ? tokensBefore : 0;
	return renderDeterministicSections(
		[
			{
				heading: "Goal",
				content: goal,
				empty: "（未能从历史中提取目标，见 Recent Messages）",
				priority: 1,
				maxChars: COMPACTION_DETERMINISTIC_HEAD_CHARS,
			},
			{
				heading: "User Corrections",
				content: corrections,
				empty: "（无明确改口；以 Goal 和 Recent Timeline 为准。）",
				priority: 2,
				maxChars: 2_400,
			},
			{
				heading: "Constraints & Decisions",
				content: constraintsAndDecisions,
				empty: "（未识别到额外约束或决策。）",
				priority: 4,
				maxChars: 2_800,
			},
			{
				heading: "In-Flight / Verification / Closeout",
				content: lifecycle,
				empty: "（无明确 in-flight、验证或收尾记录。）",
				priority: 5,
				maxChars: 3_400,
			},
			{
				heading: "Errors & Open Loops",
				content: errorsAndOpenLoops,
				empty: "（无明确错误或未闭环事项。）",
				priority: 6,
				maxChars: 2_800,
			},
			{
				heading: "Previous Summary",
				content: prev,
				empty: "（无）",
				priority: 3,
				maxChars: COMPACTION_DETERMINISTIC_PREVIOUS_CHARS,
			},
			{
				heading: "Files",
				content: formatFileOps(fileOps),
				empty: "（无）",
				priority: 7,
				maxChars: 2_000,
			},
			{
				heading: "Recent Timeline",
				content: timeline,
				empty: "（无可用近期记录。）",
				priority: 8,
				maxChars: 3_600,
			},
			{
				heading: "Recent Messages",
				content: recentMessages,
				empty: "（无可序列化内容）",
				priority: 9,
				maxChars: Math.min(COMPACTION_DETERMINISTIC_TAIL_CHARS, 2_800),
			},
			{
				heading: "Next Steps",
				content: nextStepsFromTranscript(records),
				empty: "- Continue from Recent Timeline and preserve verification state.",
				priority: 10,
				maxChars: 1_800,
			},
		],
		`<!-- pipiui-compaction deterministic reason=${safeReason} messages=${messageCount} tokensBefore=${safeTokensBefore} -->`,
	);
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

/** Continuation-checkpoint headings the LLM fast path must emit. */
export const COMPACTION_CHECKPOINT_HEADINGS = [
	"Goal",
	"Constraints",
	"Progress",
	"Key Decisions",
	"Files and Verification",
	"Errors and Open Questions",
	"Next Steps",
	"Critical Context",
] as const;

export const COMPACTION_LLM_MIN_SUMMARY_CHARS = 80;

const CHECKPOINT_HEADING_RE = (heading: string): RegExp =>
	new RegExp(`^##\\s+${heading}\\s*$`, "im");

export function extractMarkdownSection(markdown: string, heading: string): string {
	if (typeof markdown !== "string" || !markdown) return "";
	const re = CHECKPOINT_HEADING_RE(heading);
	const match = re.exec(markdown);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = markdown.slice(start);
	const next = /^##\s+/m.exec(rest);
	return (next ? rest.slice(0, next.index) : rest).trim();
}

export function listPresentCheckpointHeadings(markdown: string): string[] {
	const text = typeof markdown === "string" ? markdown : "";
	return COMPACTION_CHECKPOINT_HEADINGS.filter((heading) => CHECKPOINT_HEADING_RE(heading).test(text));
}

function extractMappedDeterministicSection(deterministic: string, heading: string): string {
	switch (heading) {
		case "Goal":
			return extractMarkdownSection(deterministic, "Goal");
		case "Constraints":
		case "Key Decisions":
			return extractMarkdownSection(deterministic, "Constraints & Decisions");
		case "Progress":
			return extractMarkdownSection(deterministic, "In-Flight / Verification / Closeout");
		case "Files and Verification": {
			const files = extractMarkdownSection(deterministic, "Files");
			const inflight = extractMarkdownSection(deterministic, "In-Flight / Verification / Closeout");
			return [files, inflight].filter(Boolean).join("\n\n");
		}
		case "Errors and Open Questions":
			return extractMarkdownSection(deterministic, "Errors & Open Loops");
		case "Next Steps":
			return extractMarkdownSection(deterministic, "Next Steps");
		case "Critical Context":
			return [
				extractMarkdownSection(deterministic, "User Corrections"),
				extractMarkdownSection(deterministic, "Previous Summary"),
				extractMarkdownSection(deterministic, "Recent Timeline"),
			].filter(Boolean).join("\n\n");
		default:
			return "";
	}
}

export interface CompactionLlmQuality {
	accept: boolean;
	merge: boolean;
	present: string[];
	missing: string[];
}

/** Minimal quality gate: never adopt empty, tiny, or unstructured prose. */
export function evaluateCompactionLlmSummary(text: string): CompactionLlmQuality {
	const summary = typeof text === "string" ? text.trim() : "";
	const present = listPresentCheckpointHeadings(summary);
	const missing = COMPACTION_CHECKPOINT_HEADINGS.filter((h) => !present.includes(h));
	const hasKey =
		present.includes("Goal") && present.includes("Progress") && present.includes("Next Steps");
	if (!summary || summary.length < COMPACTION_LLM_MIN_SUMMARY_CHARS) {
		return { accept: false, merge: false, present, missing };
	}
	if (present.length === 0) {
		return { accept: false, merge: false, present, missing };
	}
	if (missing.length === 0) {
		return { accept: true, merge: false, present, missing };
	}
	if (hasKey) {
		return { accept: false, merge: true, present, missing };
	}
	return { accept: false, merge: false, present, missing };
}

export function mergeCheckpointSummary(llmSummary: string, deterministic: string): string {
	const present = listPresentCheckpointHeadings(llmSummary);
	const extras = COMPACTION_CHECKPOINT_HEADINGS.filter((h) => !present.includes(h)).map((heading) => {
		const mapped =
			extractMarkdownSection(deterministic, heading) ||
			extractMappedDeterministicSection(deterministic, heading);
		return `## ${heading}\n${mapped || "（见 deterministic fallback）"}`;
	});
	return `${llmSummary.trim()}\n\n${extras.join("\n\n")}`.trim();
}

export function newCompactionLlmSessionId(): string {
	try {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}
	} catch {
		// fall through
	}
	return `pipiui-compaction-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildCompactionLlmPrompt(
	serialized: string,
	previousSummary: string,
	reason: string,
): string {
	const hasPrevious = typeof previousSummary === "string" && previousSummary.trim().length > 0;
	const updateRules = hasPrevious
		? `
This is an UPDATE of a previous continuation checkpoint. Rules:
- Keep facts that are still true.
- Update status (Progress Done / In Progress / Blocked).
- Drop resolved blockers and stale next steps.
- Do not stack or repeat multiple generations of summaries.
- Do not copy the previous summary verbatim as a nested dump.

<previous-summary>
${previousSummary.trim()}
</previous-summary>
`
		: "\nNo previous summary. Write a fresh continuation checkpoint.\n";
	return `You are writing a continuation checkpoint that REPLACES the conversation history below.
The full history will be discarded. Output structured markdown only, using these exact ## headings in order:

## Goal
## Constraints
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Files and Verification
## Errors and Open Questions
## Next Steps
## Critical Context

Preserve verbatim (do not paraphrase or invent):
- User corrections and non-negotiable constraints
- Exact file paths and symbols
- Error strings
- Test evidence and its credibility (pass/fail, command, exit code)
- Worker agentId / worktree / status
Do not treat a plan as completed work. Keep it under 4000 tokens.
${updateRules}
Trigger: ${reason}

<conversation>
${serialized}
</conversation>`;
}

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
												text: buildCompactionLlmPrompt(
													llmSerialized,
													previous,
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
								cacheRetention: "none",
								sessionId: newCompactionLlmSessionId(),
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
							const gate = evaluateCompactionLlmSummary(summary);
							if (gate.accept || gate.merge) {
								const adopted = gate.merge
									? mergeCheckpointSummary(
											summary,
											buildDeterministicSummary({
												serialized,
												previousSummary: preparation.previousSummary,
												fileOps: preparation.fileOps,
												tokensBefore: preparation.tokensBefore,
												messageCount: messages.length,
												reason: event.reason ?? "auto",
											}),
									  )
									: summary;
								return {
									compaction: {
										summary: adopted,
										firstKeptEntryId: preparation.firstKeptEntryId,
										tokensBefore: preparation.tokensBefore,
										usage: (response as { usage?: unknown }).usage,
										details: {
											source: "pipiui",
											mode: "llm-fast",
											reason: event.reason ?? "auto",
											...(gate.merge ? { qualityGate: "merged" } : {}),
										},
									},
								};
							}
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

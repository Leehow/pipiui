/**
 * Child → Boss question channel: `ask_boss` in the worker, `subagent_reply` in the Boss.
 *
 * A dispatched worker receives exactly one prompt and has no way to get a
 * decision it was not given; until now it guessed. This channel lets it block
 * on one question. The file pair under the project's `.pi/agent-questions/`
 * is the authority (it survives a parent restart); the parent's stream reader
 * only accelerates delivery by noticing the `ask_boss` tool call.
 *
 * Bounded by design: one question per call, capped sizes, a hard wait deadline
 * after which the worker is told to proceed on its own judgment. Nothing here
 * kills a run, and nothing here decides for the Boss.
 *
 * This module owns the file contract and both tools; index.ts owns delivery to
 * the Boss, stall excusal, and cleanup at the worker's terminal event.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bindSanitizeStrictToolArguments, makeStrictJsonSchema, omitNulls } from "./strict-json-schema.ts";

export const ASK_BOSS_TOOL_NAME = "ask_boss";
export const SUBAGENT_REPLY_TOOL_NAME = "subagent_reply";
/** Set by the dispatching Boss on the worker's environment; absent means no channel. */
export const QUESTION_DIR_ENV = "PIPIUI_QUESTION_DIR";
export const ASK_BOSS_TIMEOUT_ENV = "PIPIUI_ASK_BOSS_TIMEOUT_MS";
export const DEFAULT_ASK_BOSS_TIMEOUT_MS = 10 * 60_000;
export const MIN_ASK_BOSS_TIMEOUT_MS = 30_000;
export const MAX_ASK_BOSS_TIMEOUT_MS = 6 * 60 * 60_000;
export const ASK_BOSS_POLL_MS = 500;
export const MAX_QUESTION_CHARS = 8_000;
export const MAX_CONTEXT_CHARS = 8_000;
export const MAX_CHOICES = 8;
export const MAX_CHOICE_CHARS = 400;
export const MAX_ANSWER_CHARS = 16_000;
/** Marker line the Boss sees; tests and status rendering key off it. */
export const QUESTION_MESSAGE_PREFIX = "[subagent-question]";
/** Appended to a worker's system prompt when the tool is issued; the tool description carries the mechanics. */
export const ASK_BOSS_GUIDANCE = [
	"A decision the brief does not settle — an ambiguous requirement, an irreversible step, a design choice with product consequences — is a question for the Boss, not a guess:",
	`call ${ASK_BOSS_TOOL_NAME} once, with concrete choices. It blocks until the answer arrives; if none comes, proceed and state the assumption in your final report.`,
].join(" ");

export interface WorkerQuestion {
	version: 1;
	id: number;
	agentId: string;
	runId: string;
	question: string;
	choices?: string[];
	context?: string;
	askedAt: string;
	toolCallId?: string;
}

export interface BossAnswer {
	version: 1;
	id: number;
	answer: string;
	answeredAt: string;
}

export type QuestionState = "pending" | "answered" | "timed-out";

export interface QuestionStatus {
	question: WorkerQuestion;
	state: QuestionState;
	answer?: BossAnswer;
}

/** `<root>/.pi/agent-questions/<agentId>/<runId>` — beside agent-sessions and agent-prompts. */
export function questionRunDir(root: string, agentId: string, runId: string): string {
	return path.join(root, ".pi", "agent-questions", agentId, runId);
}

export function resolveAskBossTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[ASK_BOSS_TIMEOUT_ENV];
	const parsed = raw ? Number(raw) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ASK_BOSS_TIMEOUT_MS;
	return Math.min(MAX_ASK_BOSS_TIMEOUT_MS, Math.max(MIN_ASK_BOSS_TIMEOUT_MS, Math.floor(parsed)));
}

function questionFile(dir: string, id: number): string {
	return path.join(dir, `q-${String(id).padStart(3, "0")}.json`);
}
function answerFile(dir: string, id: number): string {
	return path.join(dir, `a-${String(id).padStart(3, "0")}.json`);
}
function timeoutFile(dir: string, id: number): string {
	return path.join(dir, `t-${String(id).padStart(3, "0")}.json`);
}

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

/** Atomic within the directory: temp file then rename, so a reader never sees a partial JSON. */
function writeJsonAtomic(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	fs.renameSync(tmp, file);
}

function clampText(value: unknown, max: number): string {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function listQuestions(dir: string): WorkerQuestion[] {
	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch {
		return [];
	}
	const questions: WorkerQuestion[] = [];
	for (const entry of entries) {
		const match = /^q-(\d+)\.json$/.exec(entry);
		if (!match) continue;
		const parsed = readJson<WorkerQuestion>(path.join(dir, entry));
		if (parsed && parsed.version === 1 && typeof parsed.question === "string") questions.push(parsed);
	}
	return questions.sort((a, b) => a.id - b.id);
}

export function readAnswer(dir: string, id: number): BossAnswer | undefined {
	const parsed = readJson<BossAnswer>(answerFile(dir, id));
	return parsed && parsed.version === 1 && typeof parsed.answer === "string" ? parsed : undefined;
}

export function questionStatuses(dir: string): QuestionStatus[] {
	return listQuestions(dir).map((question) => {
		const answer = readAnswer(dir, question.id);
		if (answer) return { question, state: "answered", answer };
		if (fs.existsSync(timeoutFile(dir, question.id))) return { question, state: "timed-out" };
		return { question, state: "pending" };
	});
}

export function pendingQuestions(dir: string): WorkerQuestion[] {
	return questionStatuses(dir).filter((entry) => entry.state === "pending").map((entry) => entry.question);
}

export interface AskInput {
	agentId: string;
	runId: string;
	question: string;
	choices?: string[];
	context?: string;
	toolCallId?: string;
}

/** Allocate the next id (max + 1) and persist the question. Throws only on I/O failure. */
export function writeQuestion(dir: string, input: AskInput): WorkerQuestion {
	const existing = listQuestions(dir);
	const id = existing.length === 0 ? 1 : existing[existing.length - 1].id + 1;
	const choices = Array.isArray(input.choices)
		? input.choices.map((choice) => clampText(choice, MAX_CHOICE_CHARS)).filter(Boolean).slice(0, MAX_CHOICES)
		: [];
	const context = clampText(input.context, MAX_CONTEXT_CHARS);
	const record: WorkerQuestion = {
		version: 1,
		id,
		agentId: input.agentId,
		runId: input.runId,
		question: clampText(input.question, MAX_QUESTION_CHARS),
		...(choices.length > 0 ? { choices } : {}),
		...(context ? { context } : {}),
		askedAt: new Date().toISOString(),
		...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
	};
	writeJsonAtomic(questionFile(dir, id), record);
	return record;
}

export function writeAnswer(dir: string, id: number, answer: string): BossAnswer {
	const record: BossAnswer = { version: 1, id, answer: clampText(answer, MAX_ANSWER_CHARS), answeredAt: new Date().toISOString() };
	writeJsonAtomic(answerFile(dir, id), record);
	return record;
}

export function markQuestionTimedOut(dir: string, id: number): void {
	try {
		writeJsonAtomic(timeoutFile(dir, id), { version: 1, id, timedOutAt: new Date().toISOString() });
	} catch {
		// Best effort: the worker has already moved on; the marker only improves the reply error.
	}
}

export function removeQuestionRun(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// Transient state; a leftover directory is harmless and swept by the next run's writer.
	}
	// Drop the agent directory once its last run is gone so the tree stays flat.
	try {
		const agentDir = path.dirname(dir);
		if (fs.readdirSync(agentDir).length === 0) fs.rmdirSync(agentDir);
	} catch {
		// Not ours to force.
	}
}

function formatMinutes(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

/** The Boss-facing message. First line is machine-readable; the rest is what the Boss must decide. */
export function formatQuestionForBoss(question: WorkerQuestion, options: { workerName?: string; timeoutMs: number }): string {
	const who = options.workerName ? `Worker \`${question.agentId}\` (${options.workerName})` : `Worker \`${question.agentId}\``;
	const lines = [
		`${QUESTION_MESSAGE_PREFIX} agentId=${question.agentId} runId=${question.runId} qid=${question.id}`,
		`${who} is blocked waiting for your answer. It times out after ${formatMinutes(options.timeoutMs)} and then proceeds on its own judgment, so answer now.`,
		`Question: ${question.question}`,
	];
	if (question.choices && question.choices.length > 0) {
		lines.push("Choices:");
		question.choices.forEach((choice, index) => lines.push(`  ${index + 1}. ${choice}`));
	}
	if (question.context) lines.push(`Context: ${question.context}`);
	lines.push(
		`Reply with ${SUBAGENT_REPLY_TOOL_NAME}({ agentId: "${question.agentId}", runId: "${question.runId}", answer: "..." }). The worker receives your answer verbatim. If this is the user's decision, ask them and relay it; do not decide for them.`,
	);
	return lines.join("\n");
}

export function formatAnswerForWorker(answer: BossAnswer): string {
	return `Answer from the Boss:\n${answer.answer}`;
}

export function formatNoAnswer(timeoutMs: number): string {
	return [
		`No answer from the Boss within ${formatMinutes(timeoutMs)}.`,
		"Proceed with your best judgment on this point. State the assumption you made explicitly in your final report so the Boss can revisit it. Do not ask again in this run.",
	].join(" ");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

const AskBossParams = Type.Object({
	question: Type.String({
		minLength: 1,
		maxLength: MAX_QUESTION_CHARS,
		description: "The one decision you need. Precise and self-contained: the Boss has not read your transcript.",
	}),
	choices: Type.Optional(Type.Array(Type.String({ maxLength: MAX_CHOICE_CHARS }), {
		maxItems: MAX_CHOICES,
		description: "Concrete options when the decision is a choice; the Boss may still answer freely.",
	})),
	context: Type.Optional(Type.String({
		maxLength: MAX_CONTEXT_CHARS,
		description: "Only what the Boss needs to decide: the file/lines involved, what each option costs. No transcript dumps.",
	})),
}, { additionalProperties: false });

export interface AskBossToolOptions {
	dir: string;
	agentId: string;
	runId: string;
	timeoutMs: number;
	pollMs?: number;
}

/** Worker-side tool. Registered only when the dispatching Boss issued a question directory. */
export function registerAskBossTool(pi: ExtensionAPI, options: AskBossToolOptions): void {
	const pollMs = options.pollMs ?? ASK_BOSS_POLL_MS;
	pi.registerTool({
		name: ASK_BOSS_TOOL_NAME,
		label: "Ask Boss",
		description: [
			"Ask the Boss (the session that dispatched you) one blocking question when the brief does not settle a decision you must make: an ambiguous requirement, a destructive or irreversible step, a choice between designs with product consequences.",
			`Blocks until the Boss answers (up to ${formatMinutes(options.timeoutMs)}). Not for status updates or questions you can settle by reading the code.`,
			"If no answer arrives, continue on your best judgment and state the assumption in your final report. Ask once, precisely, with concrete choices.",
		].join(" "),
		promptSnippet: "A decision the brief does not settle is a question for the Boss, not a guess. Blocks until answered.",
		parameters: makeStrictJsonSchema(AskBossParams),
		prepareArguments: bindSanitizeStrictToolArguments(AskBossParams),
		async execute(toolCallId, rawParams, signal) {
			const params = omitNulls(rawParams) as { question: string; choices?: string[]; context?: string };
			let question: WorkerQuestion;
			try {
				question = writeQuestion(options.dir, {
					agentId: options.agentId,
					runId: options.runId,
					question: params.question,
					choices: params.choices,
					context: params.context,
					toolCallId,
				});
			} catch (error) {
				return {
					content: [{ type: "text" as const, text: `ask_boss could not record the question (${error instanceof Error ? error.message : String(error)}). Proceed on your best judgment and state the assumption in your final report.` }],
					details: null,
					isError: true,
				};
			}
			const deadline = Date.now() + options.timeoutMs;
			while (Date.now() < deadline) {
				if (signal?.aborted) {
					return { content: [{ type: "text" as const, text: "ask_boss cancelled: this run was aborted." }], details: { questionId: question.id }, isError: true };
				}
				const answer = readAnswer(options.dir, question.id);
				if (answer) {
					return { content: [{ type: "text" as const, text: formatAnswerForWorker(answer) }], details: { questionId: question.id } };
				}
				await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())), signal);
			}
			markQuestionTimedOut(options.dir, question.id);
			return { content: [{ type: "text" as const, text: formatNoAnswer(options.timeoutMs) }], details: { questionId: question.id, timedOut: true }, isError: true };
		},
	});
}

const SubagentReplyParams = Type.Object({
	agentId: Type.String({ minLength: 1, maxLength: 64, description: "The worker's agentId from the [subagent-question] line." }),
	runId: Type.String({ minLength: 1, maxLength: 128, description: "The exact runId from the [subagent-question] line; a stale run is rejected." }),
	answer: Type.String({ minLength: 1, maxLength: MAX_ANSWER_CHARS, description: "Delivered to the worker verbatim. Decide fully; it cannot ask again cheaply." }),
	questionId: Type.Optional(Type.Integer({ minimum: 1, description: "qid from the message; needed only when several questions are pending." })),
}, { additionalProperties: false });

export interface SubagentReplyDeps {
	/** Question directory for a run, or undefined when the host has no project root. */
	dirFor: (agentId: string, runId: string) => string | undefined;
	/** The run currently registered for an agentId, so a stale runId is refused instead of answering the wrong episode. */
	currentRunId: (agentId: string) => string | undefined;
	onAnswered?: (agentId: string, runId: string, questionId: number) => void;
}

export interface ReplyOutcome {
	ok: boolean;
	message: string;
	questionId?: number;
}

/** Pure decision + write; the tool wraps it so tests need no ExtensionAPI. */
export function replyToWorkerQuestion(
	params: { agentId: string; runId: string; answer: string; questionId?: number },
	deps: SubagentReplyDeps,
): ReplyOutcome {
	const current = deps.currentRunId(params.agentId);
	if (current === undefined) {
		return { ok: false, message: `No running worker with agentId \`${params.agentId}\`; the question is moot or the worker already finished.` };
	}
	if (current !== params.runId) {
		return { ok: false, message: `runId \`${params.runId}\` is not the current run of \`${params.agentId}\` (current: \`${current}\`); stale questions are not answered.` };
	}
	const dir = deps.dirFor(params.agentId, params.runId);
	if (!dir) return { ok: false, message: "This host has no project root for the question channel." };
	const statuses = questionStatuses(dir);
	const pending = statuses.filter((entry) => entry.state === "pending");
	let target: QuestionStatus | undefined;
	if (params.questionId !== undefined) {
		const exact = statuses.find((entry) => entry.question.id === params.questionId);
		if (!exact) return { ok: false, message: `No question qid=${params.questionId} for this run.` };
		if (exact.state === "answered") return { ok: false, message: `qid=${params.questionId} was already answered at ${exact.answer?.answeredAt}.` };
		if (exact.state === "timed-out") return { ok: false, message: `qid=${params.questionId} timed out before you answered; the worker proceeded on its own judgment. Steer it through a resume if the assumption was wrong.` };
		target = exact;
	} else {
		if (pending.length === 0) {
			const last = statuses[statuses.length - 1];
			return {
				ok: false,
				message: last
					? `No pending question for this run (last qid=${last.question.id} is ${last.state}).`
					: "No pending question for this run yet. If the worker just asked, retry in a moment.",
			};
		}
		if (pending.length > 1) {
			return { ok: false, message: `Several questions are pending (qid ${pending.map((entry) => entry.question.id).join(", ")}); pass questionId.` };
		}
		target = pending[0];
	}
	const answer = writeAnswer(dir, target.question.id, params.answer);
	deps.onAnswered?.(params.agentId, params.runId, target.question.id);
	return { ok: true, questionId: target.question.id, message: `Answered qid=${target.question.id} for \`${params.agentId}\` (${answer.answer.length} chars). The worker resumes on its next poll.` };
}

/** Boss-side tool. Registered where the dispatch tools live (depth 0). */
export function registerSubagentReplyTool(pi: ExtensionAPI, deps: SubagentReplyDeps): void {
	pi.registerTool({
		name: SUBAGENT_REPLY_TOOL_NAME,
		label: "Subagent Reply",
		description: [
			"Answer a worker's pending ask_boss question. Required: agentId and the exact runId from the [subagent-question] line, plus the answer. questionId only when several are pending.",
			"The worker is blocked until it receives this, and gives up after its timeout; answer promptly and completely. When the decision belongs to the user, ask them first and relay their answer.",
		].join(" "),
		promptSnippet: "Unblock a worker waiting on [subagent-question]; text replies do not reach it.",
		parameters: makeStrictJsonSchema(SubagentReplyParams),
		prepareArguments: bindSanitizeStrictToolArguments(SubagentReplyParams),
		async execute(_toolCallId, rawParams) {
			const params = omitNulls(rawParams) as { agentId: string; runId: string; answer: string; questionId?: number };
			const outcome = replyToWorkerQuestion(params, deps);
			return {
				content: [{ type: "text" as const, text: outcome.message }],
				details: outcome.questionId !== undefined ? { questionId: outcome.questionId } : null,
				...(outcome.ok ? {} : { isError: true }),
			};
		},
	});
}

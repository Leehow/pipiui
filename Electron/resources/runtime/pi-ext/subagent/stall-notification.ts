/**
 * Wake channel for stall / post-stall recovery signals.
 *
 * Completions already use ExtensionAPI.sendMessage({ triggerTurn: true }).
 * sendUserMessage({ deliverAs: "followUp" }) only queues/displays when the Boss
 * is idle, so a settled session would see [subagent-stalled] and never start a
 * turn. This helper is the stall equivalent of queueCompletionNotification.
 */

export const SUBAGENT_STALL_CUSTOM_TYPE = "pipiui-subagent-stall-v1";

export interface StallNotifyState {
	lastStallNotifyAt: number;
	stallNotifyCount: number;
	stallNotifyInFlight?: boolean;
}

interface StallMessageSender {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: true; deliverAs: "followUp" },
	): unknown;
}

export function isStallWakeSignal(kind: string | undefined): boolean {
	return kind === "stall" || kind === "blocked";
}

/**
 * Enqueue one stall/recovery signal through Pi's native extension-message
 * channel so an idle Boss starts a turn. A normal return proves only that the
 * call was queued, never that Pi persisted or consumed the message.
 */
export function queueStallNotification(pi: StallMessageSender, text: string): boolean {
	try {
		pi.sendMessage(
			{
				customType: SUBAGENT_STALL_CUSTOM_TYPE,
				content: text,
				display: true,
				details: { version: 1 },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] stall notification enqueue rejected:", err);
		return false;
	}
}

/** Preserve cut-in ordering; admission/quiet stay in the caller via shouldSend. */
export async function queueStallAfterCutIn(
	pi: StallMessageSender,
	text: string,
	hooks: { waitForCutIn: () => Promise<void>; shouldSend?: () => boolean },
): Promise<boolean> {
	await hooks.waitForCutIn();
	if (hooks.shouldSend && !hooks.shouldSend()) return false;
	return queueStallNotification(pi, text);
}

/**
 * Reserve one interval-spaced attempt. Sets lastStallNotifyAt so a hold/fail
 * cannot stampede, but does not increment stallNotifyCount until confirm.
 */
export function claimStallNotification(
	handle: StallNotifyState,
	now: number,
	maxNotifies: number,
	intervalMs: number,
): boolean {
	if (handle.stallNotifyInFlight) return false;
	if (handle.stallNotifyCount >= maxNotifies) return false;
	if (handle.lastStallNotifyAt > 0 && now - handle.lastStallNotifyAt < intervalMs) return false;
	handle.stallNotifyInFlight = true;
	handle.lastStallNotifyAt = now;
	return true;
}

/** Count only a successful enqueue. A hold/drop/throw leaves the budget intact. */
export function confirmStallNotification(handle: StallNotifyState, delivered: boolean): void {
	handle.stallNotifyInFlight = false;
	if (delivered) handle.stallNotifyCount += 1;
}

/**
 * The wake itself, and the routing that decides a signal deserves one.
 *
 * These lived inline in index.ts, so the tests that guarded them could only grep the source
 * for call expressions — including the assertions that matter most here, which are negative:
 * this path must NOT reach `sendUserMessage`, because that channel only queues for an idle
 * Boss and a settled session would never start the turn the stall exists to trigger. A
 * negative assertion against source text is exactly the kind that goes stale silently, so the
 * routing now returns a named channel a test can assert on.
 */

export type RuntimeSignalChannel = "stall-wake" | "user-message";

export interface StallWakeDeps {
	/** Host asked for quiet: no wake at all, before or after the cut-in wait. */
	quiet: () => boolean;
	waitForCutIn: () => Promise<void>;
	/** Re-checked after the cut-in wait, because admission can change while waiting. */
	admit: (text: string) => boolean;
}

/**
 * Queue one stall wake, honouring quiet both before and after the cut-in wait.
 *
 * The second quiet check is not redundant: `waitForCutIn` yields, and a host stop landing
 * during that await would otherwise still produce a wake.
 */
export async function deliverStallWake(
	pi: StallMessageSender,
	text: string,
	deps: StallWakeDeps,
): Promise<boolean> {
	if (deps.quiet()) return false;
	return queueStallAfterCutIn(pi, text, {
		waitForCutIn: deps.waitForCutIn,
		shouldSend: () => !deps.quiet() && deps.admit(text),
	});
}

export type SignalAdmission = "send" | "hold" | "drop";

export interface HeldSignalPlan {
	/** At most one signal is delivered per flush; the rest wait for the next one. */
	deliver?: { text: string; kind: string; channel: RuntimeSignalChannel; confirmsStallDelivery: boolean };
	/** Signals to put back on the held queue, in their original order. */
	rehold: string[];
}

export interface HeldSignalFlushInput {
	held: readonly string[];
	/** Undefined kind means the text is not a runtime signal: dropped, never re-held. */
	classify: (text: string) => string | undefined;
	admit: (input: { kind: string; text: string }) => SignalAdmission;
}

/**
 * Decide what one flush of the held queue does.
 *
 * One delivery per flush is the load-bearing rule: several stalls coming due together must
 * not fire a burst of turns at the Boss. Everything after the first admitted signal goes back
 * on the queue and gets its turn at the next flush.
 */
export function planHeldSignalFlush(input: HeldSignalFlushInput): HeldSignalPlan {
	const plan: HeldSignalPlan = { rehold: [] };
	for (const text of input.held) {
		const kind = input.classify(text);
		if (!kind) continue;
		const decision = input.admit({ kind, text });
		if (decision === "drop") continue;
		if (decision === "hold" || plan.deliver) {
			if (!plan.rehold.includes(text)) plan.rehold.push(text);
			continue;
		}
		plan.deliver = {
			text,
			kind,
			channel: isStallWakeSignal(kind) ? "stall-wake" : "user-message",
			confirmsStallDelivery: kind === "stall",
		};
	}
	return plan;
}

export interface StallMessageInput {
	agentId: string;
	title: string;
	idleSec: number;
	lastLine: string;
	inTool?: { names: string[]; forSec: number };
	/** CPU evidence, or undefined when no measurement exists for this worker. */
	liveness?: string;
}

/**
 * The recurring stall signal.
 *
 * Handling rides with the event rather than sitting in the cached prefix all session waiting
 * for a stall that may never happen — and it is more likely to be followed here, next to the
 * thing it is about. The liveness line is attached so "keep waiting" has to answer to a
 * measurement instead of a guess.
 */
export function formatStallMessage(input: StallMessageInput): string {
	const inTool = input.inTool ? ` in=${input.inTool.names.join("+")} for=${input.inTool.forSec}s` : "";
	return [
		`[subagent-stalled] agentId=${input.agentId} title=${input.title} idle=${input.idleSec}s${inTool} last=${input.lastLine}`,
		`Liveness: ${input.liveness ?? "no CPU measurement available for this worker"}.`,
		`Query it first with subagent_status({agentId:"${input.agentId}"}), then choose exactly one: keep waiting (only if the liveness line above shows it is busy, and say what it is working on) / abort and re-dispatch by a materially different route / abort and ask the user. An aborted agent does not push a [subagent-done] follow-up — confirm its terminal state via subagent_status — and a re-dispatch after an abort still counts toward the two-attempts-per-approach cap. Do not treat this message as a new user request.`,
		`If work is already complete from your perspective, do not keep waiting or reply "already completed": first call subagent_status({agentId:"${input.agentId}"}). If it is still running, close it with subagent_abort({agentId}) (or /subagent_abort) so this recurring message stops; if it is terminal (failed/aborted/interrupted), resolve it with subagent_resolve({agentId, runId}) (or /subagent_resolve). A text-only reply does not stop this message.`,
	].join("\n");
}

/** The terminal signal: this worker was auto-aborted after exhausting its stall budget. */
export function formatBlockedMessage(
	input: Pick<StallMessageInput, "agentId" | "title" | "idleSec" | "lastLine">,
): string {
	return [
		`[subagent-blocked] agentId=${input.agentId} title=${input.title} idle=${input.idleSec}s last=${input.lastLine} auto-aborted after stall`,
		`This worker was auto-aborted after stall. Query subagent_status({agentId:"${input.agentId}"}) to confirm the terminal state, then re-dispatch by a materially different route or ask the user. Do not treat this message as a new user request.`,
	].join("\n");
}

/**
 * Phase-3 event-triggered one-shot verifier / recovery advisor.
 *
 * Composes on the Boss-direct + no-progress event seam. Does not wrap
 * `execute()`, hold the unique GUI session, or change generic subagent dispatch.
 */

// @ts-ignore -- bundled runtime executes TypeScript directly.
import { createBossEscalation, type BossEscalationEnvelope } from "../../../subagent/supervisor/contract.ts";
// @ts-ignore -- bundled runtime executes TypeScript directly.
import { grantsForComputerRole, type ComputerWorkerGrant } from "./worker-broker.ts";
// @ts-ignore -- bundled runtime executes TypeScript directly.
import { toolNamesForComputerWorkerRole } from "../extensions/computer-worker.ts";
// @ts-ignore -- bundled runtime executes TypeScript directly.
import type { DirectDriveResult } from "./direct-drive.ts";

export const DIRECT_DRIVE_ADVISOR_STATUSES = ["progressing", "blocked", "needs_help"] as const;
export type DirectDriveAdvisorStatus = (typeof DIRECT_DRIVE_ADVISOR_STATUSES)[number];

export const DIRECT_DRIVE_ADVISOR_TRIGGERS = [
	"completion_claim",
	"milestone",
	"mutation_uncertain",
	"detector_escalation",
] as const;
export type DirectDriveAdvisorTrigger = (typeof DIRECT_DRIVE_ADVISOR_TRIGGERS)[number];

export const DIRECT_DRIVE_ADVISOR_ROLES = ["verifier", "recovery", "operator-escape"] as const;
export type DirectDriveAdvisorRole = (typeof DIRECT_DRIVE_ADVISOR_ROLES)[number];

export const DIRECT_DRIVE_ADVISOR_CUSTOM_TYPE = "pipiui-direct-drive-advisor-v1";

export const STILL_TRYING_PATTERN = /still\s+(trying|attempting)|仍在尝试/i;

export const BOUNDED_OPERATOR_REJECT = {
	longTask: "operator_escape_long_task",
	missingGoal: "operator_escape_goal_required",
	missingGrant: "operator_escape_desktop_required",
	missingTarget: "operator_escape_target_required",
} as const;

const LONG_TASK_PATTERN =
	/computer[- ]?use[- ]?leader|computer_task|complete (the )?(workflow|task)|until (done|complete|finished)|multi-?step|end[- ]to[- ]end|plan then|replan|recover(y)? (and|then)|verify (and|then) (click|type|open)|delegate|subagent|long[- ]running|keep (working|going)|autonomous/i;

const SINGLE_ACTION_PATTERN =
	/\b(click|type|press|scroll|open|focus|select|dismiss|confirm|save|close|paste|hover)\b/i;

export type BoundedTrajectoryStep = {
	action: Record<string, unknown>;
	result?: unknown;
	screenChanged?: boolean | null;
	error?: string | null;
	observationRef?: string;
	screenshotRef?: string;
};

export type BoundedTrajectory = {
	sessionId: string;
	steps: BoundedTrajectoryStep[];
	last_observation?: unknown;
	last_action?: Record<string, unknown> | null;
	expected_effect?: unknown;
	actual_effect?: unknown;
	attempt_count?: number;
};

export type DirectDriveBlockedReport = {
	status: "blocked" | "needs_help";
	last_observation: unknown;
	last_action: Record<string, unknown> | null;
	expected_effect?: unknown;
	actual_effect: unknown;
	attempt_count: number;
	why_blocked: string;
	recommended_next_actions: string[];
};

export type Phase2EscalationLike = {
	eventId: string;
	sessionId?: string;
	agentId?: string;
	runId?: string;
	kind?: string;
	reason: string;
	evidenceRefs?: string[];
	recommendedAction?: string;
	verdict?: string;
};

export type OneShotAdvisorRequest = {
	role: DirectDriveAdvisorRole;
	fresh: true;
	retainContext: false;
	holdsGuiSession: false;
	desktopMutation: boolean;
	grants: ComputerWorkerGrant[];
	tools: string[];
	sessionId: string;
	trigger: DirectDriveAdvisorTrigger;
	trajectory: BoundedTrajectoryStep[];
	currentObservation?: unknown;
};

export type VerifierVerdict = {
	status: DirectDriveAdvisorStatus;
	summary: string;
	confirmed?: boolean;
};

export type RecoveryAdvice = {
	status: DirectDriveAdvisorStatus;
	kind: "change_interaction" | "change_strategy" | "pause";
	summary: string;
	recommended_next_actions: string[];
	decides: false;
};

export type AdvisorHandleInput = {
	trigger: DirectDriveAdvisorTrigger;
	eventId?: string;
	trajectory: BoundedTrajectory;
	escalation?: Phase2EscalationLike;
	claim?: { kind?: string; expected_effect?: unknown };
};

export type AdvisorHandleResult = {
	status: DirectDriveAdvisorStatus;
	trigger: DirectDriveAdvisorTrigger;
	sessionId: string;
	oneShot: true;
	holdsGuiSession: false;
	fired: boolean;
	request?: OneShotAdvisorRequest;
	recoveryRequest?: OneShotAdvisorRequest;
	verifier?: VerifierVerdict;
	recovery?: RecoveryAdvice;
	blocked?: DirectDriveBlockedReport;
	followUp?: { injected: boolean; envelope?: BossEscalationEnvelope; text?: string };
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function isDirectDriveAdvisorStatus(value: unknown): value is DirectDriveAdvisorStatus {
	return typeof value === "string" && (DIRECT_DRIVE_ADVISOR_STATUSES as readonly string[]).includes(value);
}

export function isDirectDriveAdvisorTrigger(value: unknown): value is DirectDriveAdvisorTrigger {
	return typeof value === "string" && (DIRECT_DRIVE_ADVISOR_TRIGGERS as readonly string[]).includes(value);
}

export function grantsForDirectDriveAdvisorRole(role: DirectDriveAdvisorRole): ComputerWorkerGrant[] {
	if (role === "verifier") return ["observe"];
	if (role === "operator-escape") return ["observe", "mutate", "openApplication"];
	return [];
}

export function toolNamesForDirectDriveAdvisorRole(role: DirectDriveAdvisorRole): string[] {
	if (role === "verifier") return toolNamesForComputerWorkerRole("verifier");
	if (role === "operator-escape") return toolNamesForComputerWorkerRole("gui-operator");
	return [];
}

export function advisorHasDesktopMutation(role: DirectDriveAdvisorRole): boolean {
	return grantsForDirectDriveAdvisorRole(role).includes("mutate");
}

/** Existing Leader-path grants stay untouched; this is a parallel seam. */
export function existingVerifierGrantsUnchanged(): boolean {
	const existing = grantsForComputerRole("verifier");
	return existing.length === 1 && existing[0] === "observe";
}

export function createOneShotAdvisorRequest(input: {
	role: DirectDriveAdvisorRole;
	sessionId: string;
	trigger: DirectDriveAdvisorTrigger;
	trajectory: readonly BoundedTrajectoryStep[];
	currentObservation?: unknown;
}): OneShotAdvisorRequest {
	return {
		role: input.role,
		fresh: true,
		retainContext: false,
		holdsGuiSession: false,
		desktopMutation: advisorHasDesktopMutation(input.role),
		grants: grantsForDirectDriveAdvisorRole(input.role),
		tools: toolNamesForDirectDriveAdvisorRole(input.role),
		sessionId: input.sessionId,
		trigger: input.trigger,
		trajectory: input.trajectory.map((step) => ({ ...step, action: { ...step.action } })),
		...(input.currentObservation !== undefined ? { currentObservation: input.currentObservation } : {}),
	};
}

export function parseBlockedReport(input: unknown): ParseResult<DirectDriveBlockedReport> {
	if (!input || typeof input !== "object") return { ok: false, error: "blocked report must be an object" };
	const value = input as Record<string, unknown>;
	if (value.status !== "blocked" && value.status !== "needs_help") {
		return { ok: false, error: "blocked report.status must be blocked or needs_help" };
	}
	if (!("last_observation" in value)) return { ok: false, error: "blocked report.last_observation is required" };
	if (!("last_action" in value)) return { ok: false, error: "blocked report.last_action is required" };
	if (!("actual_effect" in value)) return { ok: false, error: "blocked report.actual_effect is required" };
	if (typeof value.attempt_count !== "number" || !Number.isFinite(value.attempt_count) || value.attempt_count < 0) {
		return { ok: false, error: "blocked report.attempt_count must be a non-negative number" };
	}
	if (!nonempty(value.why_blocked)) return { ok: false, error: "blocked report.why_blocked is required" };
	if (STILL_TRYING_PATTERN.test(value.why_blocked)) {
		return { ok: false, error: "blocked report.why_blocked must not be a still-trying status" };
	}
	if (!Array.isArray(value.recommended_next_actions) || value.recommended_next_actions.some((item) => !nonempty(item))) {
		return { ok: false, error: "blocked report.recommended_next_actions must be a non-empty string array" };
	}
	if (value.recommended_next_actions.length === 0) {
		return { ok: false, error: "blocked report.recommended_next_actions must be a non-empty string array" };
	}
	const report: DirectDriveBlockedReport = {
		status: value.status,
		last_observation: value.last_observation,
		last_action: (value.last_action ?? null) as Record<string, unknown> | null,
		actual_effect: value.actual_effect,
		attempt_count: value.attempt_count,
		why_blocked: value.why_blocked.trim(),
		recommended_next_actions: value.recommended_next_actions.map((item) => String(item)),
	};
	if (value.expected_effect !== undefined) report.expected_effect = value.expected_effect;
	return { ok: true, value: report };
}

export function buildBlockedReport(input: {
	status: "blocked" | "needs_help";
	trajectory: BoundedTrajectory;
	why_blocked: string;
	recommended_next_actions: string[];
}): DirectDriveBlockedReport {
	const steps = input.trajectory.steps;
	const last = steps.at(-1);
	const parsed = parseBlockedReport({
		status: input.status,
		last_observation: input.trajectory.last_observation ?? last?.observationRef ?? null,
		last_action: input.trajectory.last_action ?? last?.action ?? null,
		...(input.trajectory.expected_effect !== undefined ? { expected_effect: input.trajectory.expected_effect } : {}),
		actual_effect: input.trajectory.actual_effect ?? last?.result ?? last?.error ?? last?.screenChanged ?? null,
		attempt_count: input.trajectory.attempt_count ?? steps.length,
		why_blocked: input.why_blocked,
		recommended_next_actions: input.recommended_next_actions,
	});
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.value;
}

export function toAdvisorEscalationInput(event: Phase2EscalationLike): {
	eventId: string;
	agentId: string;
	runId: string;
	kind: "escalate";
	reason: string;
	evidenceRefs: string[];
	recommendedAction: string;
} {
	const sessionId = event.sessionId ?? (nonempty(event.agentId) && event.agentId.startsWith("boss-direct-")
		? event.agentId.slice("boss-direct-".length)
		: event.runId ?? "unknown");
	return {
		eventId: event.eventId,
		agentId: event.agentId ?? `boss-direct-${sessionId}`,
		runId: event.runId ?? sessionId,
		kind: "escalate",
		reason: event.reason,
		evidenceRefs: [...(event.evidenceRefs ?? [])],
		recommendedAction: event.recommendedAction ?? "pause",
	};
}

export function formatAdvisorFollowUpText(report: DirectDriveBlockedReport, trigger: DirectDriveAdvisorTrigger): string {
	return [
		`[direct-drive-advisor] status=${report.status} trigger=${trigger}`,
		`why=${report.why_blocked}`,
		`attempts=${report.attempt_count}`,
		`next=${report.recommended_next_actions.join(" | ")}`,
	].join(" ");
}

type FollowUpSender = {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: true; deliverAs: "followUp" },
	): unknown;
};

export function queueAdvisorFollowUp(
	pi: FollowUpSender,
	text: string,
	envelope: BossEscalationEnvelope,
	report?: DirectDriveBlockedReport,
): boolean {
	try {
		pi.sendMessage(
			{
				customType: DIRECT_DRIVE_ADVISOR_CUSTOM_TYPE,
				content: text,
				display: true,
				details: { version: 1, envelope, ...(report ? { report } : {}) },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return true;
	} catch (error) {
		console.error("[pipiui-direct-drive-advisor] follow-up enqueue rejected:", error);
		return false;
	}
}

export function evaluateBoundedOperatorEscape(input: {
	goal?: unknown;
	desktop?: unknown;
	agentName?: unknown;
	planSteps?: unknown;
	retainContext?: unknown;
}): { ok: true; goal: string; desktop: string } | { ok: false; code: string; error: string } {
	if (input.agentName === "computer-use-leader" || input.agentName === "computer-use-agent") {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.longTask,
			error: "operator_escape_long_task: bounded operator cannot become a Computer Use Leader.",
		};
	}
	if (input.retainContext === true) {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.longTask,
			error: "operator_escape_long_task: retainContext turns the escape hatch into a long task.",
		};
	}
	if (Array.isArray(input.planSteps) && input.planSteps.length > 1) {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.longTask,
			error: "operator_escape_long_task: only a single explicit desktop goal is allowed.",
		};
	}
	if (!nonempty(input.goal)) {
		return { ok: false, code: BOUNDED_OPERATOR_REJECT.missingGoal, error: "operator_escape_goal_required: name one explicit desktop action." };
	}
	const goal = input.goal.trim();
	if (LONG_TASK_PATTERN.test(goal) || !SINGLE_ACTION_PATTERN.test(goal)) {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.longTask,
			error: "operator_escape_long_task: operator escape accepts one explicit desktop action, not a long CUA task.",
		};
	}
	if (input.desktop !== "user-requested" && input.desktop !== "ui-verify") {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.missingGrant,
			error: "operator_escape_desktop_required: bounded operator still needs an explicit desktop grant.",
		};
	}
	if (!/\b(textedit|finder|safari|chrome|notes|preview|terminal|system settings|[\w.-]+\.app)\b/i.test(goal)
		&& !/\bin\s+["']?[\w .+-]+/.test(goal)) {
		return {
			ok: false,
			code: BOUNDED_OPERATOR_REJECT.missingTarget,
			error: "operator_escape_target_required: name the target app or window.",
		};
	}
	return { ok: true, goal, desktop: String(input.desktop) };
}

function defaultVerifier(input: AdvisorHandleInput): VerifierVerdict {
	const last = input.trajectory.steps.at(-1);
	const error = last?.error ?? null;
	if (input.trigger === "mutation_uncertain" || /mutation_outcome_unknown|outcome_unknown/i.test(String(error ?? ""))) {
		if (last?.screenChanged === true && !error) {
			return { status: "progressing", summary: "fresh observation shows the claimed mutation landed", confirmed: true };
		}
		return { status: "blocked", summary: "mutation outcome remains uncertain after a bounded observation", confirmed: false };
	}
	if (error) {
		return { status: "blocked", summary: `last action error: ${error}`, confirmed: false };
	}
	if (input.trigger === "completion_claim" || input.trigger === "milestone") {
		if (last?.screenChanged === false) {
			return { status: "blocked", summary: "claimed progress did not change the screen", confirmed: false };
		}
		return { status: "progressing", summary: `${input.trigger} matches the bounded observation`, confirmed: true };
	}
	return { status: "progressing", summary: "no contrary evidence in the bounded window", confirmed: true };
}

function defaultRecovery(input: AdvisorHandleInput): RecoveryAdvice {
	const attempts = input.trajectory.attempt_count ?? input.trajectory.steps.length;
	const stuck = input.escalation?.verdict === "stuck" || /budget|stuck|paused/i.test(input.escalation?.reason ?? "");
	if (stuck || attempts >= 3) {
		return {
			status: "needs_help",
			kind: "pause",
			summary: "step budget or stuck escalation; Boss must pause and decide",
			recommended_next_actions: [
				"pause the desktop session",
				"ask the user, or dispatch one bounded operator escape for a single named action",
			],
			decides: false,
		};
	}
	if (attempts >= 2) {
		return {
			status: "blocked",
			kind: "change_strategy",
			summary: "second no-progress escalation; switch route rather than rephrase the same action",
			recommended_next_actions: ["change_strategy", "open a different path or prerequisite state"],
			decides: false,
		};
	}
	return {
		status: "blocked",
		kind: "change_interaction",
		summary: "first no-progress escalation; try a different locator or input method",
		recommended_next_actions: ["change_interaction", "do not repeat the same click or key"],
		decides: false,
	};
}

export function createDirectDriveAdvisor(options: {
	sessionId?: string;
	injectFollowUp?: (text: string, envelope: BossEscalationEnvelope, report: DirectDriveBlockedReport) => boolean | Promise<boolean>;
	runVerifier?: (request: OneShotAdvisorRequest) => VerifierVerdict | Promise<VerifierVerdict>;
	runRecovery?: (request: OneShotAdvisorRequest) => RecoveryAdvice | Promise<RecoveryAdvice>;
} = {}): {
	handle(input: AdvisorHandleInput): Promise<AdvisorHandleResult>;
} {
	const seen = new Set<string>();

	return {
		async handle(input) {
			if (!isDirectDriveAdvisorTrigger(input.trigger)) {
				throw new Error(`unknown advisor trigger: ${String(input.trigger)}`);
			}
			const sessionId = input.trajectory.sessionId || options.sessionId || "unknown";
			const eventId = input.eventId ?? input.escalation?.eventId ?? `${input.trigger}:${sessionId}:${input.trajectory.steps.length}`;
			if (seen.has(eventId)) {
				return {
					status: "progressing",
					trigger: input.trigger,
					sessionId,
					oneShot: true,
					holdsGuiSession: false,
					fired: false,
				};
			}
			seen.add(eventId);

			const window = input.trajectory.steps.slice(-8);
			const base = {
				sessionId,
				trigger: input.trigger,
				trajectory: window,
				currentObservation: input.trajectory.last_observation,
			};

			let verifier: VerifierVerdict | undefined;
			let recovery: RecoveryAdvice | undefined;
			let request: OneShotAdvisorRequest | undefined;
			let recoveryRequest: OneShotAdvisorRequest | undefined;

			if (input.trigger === "detector_escalation") {
				recoveryRequest = createOneShotAdvisorRequest({ ...base, role: "recovery" });
				recovery = await (options.runRecovery ?? defaultRecovery.bind(null, input))(recoveryRequest);
			} else {
				request = createOneShotAdvisorRequest({ ...base, role: "verifier" });
				verifier = await (options.runVerifier ?? ((_) => defaultVerifier(input)))(request);
			}

			const status = recovery?.status ?? verifier?.status ?? "progressing";
			const result: AdvisorHandleResult = {
				status,
				trigger: input.trigger,
				sessionId,
				oneShot: true,
				holdsGuiSession: false,
				fired: true,
				...(request ? { request } : {}),
				...(recoveryRequest ? { recoveryRequest } : {}),
				...(verifier ? { verifier } : {}),
				...(recovery ? { recovery } : {}),
			};

			if (status === "progressing") return result;

			const blocked = buildBlockedReport({
				status,
				trajectory: input.trajectory,
				why_blocked: recovery?.summary ?? verifier?.summary ?? input.escalation?.reason ?? input.trigger,
				recommended_next_actions: recovery?.recommended_next_actions ?? [
					input.trigger === "mutation_uncertain" ? "observe again before any retry" : "change_interaction",
					"Boss decides the next desktop action",
				],
			});
			result.blocked = blocked;

			const escalationInput = toAdvisorEscalationInput(input.escalation ?? {
				eventId,
				sessionId,
				reason: blocked.why_blocked,
				evidenceRefs: window.flatMap((step) => [step.observationRef, step.screenshotRef].filter((ref): ref is string => Boolean(ref))),
				recommendedAction: recovery?.kind === "pause" ? "pause" : "advise",
			});
			const envelope = createBossEscalation(escalationInput);
			const text = formatAdvisorFollowUpText(blocked, input.trigger);
			let injected = false;
			if (envelope.ok) {
				injected = options.injectFollowUp
					? await options.injectFollowUp(text, envelope.value, blocked)
					: false;
			}
			result.followUp = {
				injected,
				...(envelope.ok ? { envelope: envelope.value } : {}),
				text,
			};
			return result;
		},
	};
}

/**
 * Consume a phase-2 stuck-guard record without wrapping execute().
 * Detector events become `detector_escalation`; looping stays progressing
 * until the caller asks for recovery.
 */
export function adviseFromStuckRecord(
	advisor: ReturnType<typeof createDirectDriveAdvisor>,
	record: {
		verdict: string;
		reason: string;
		paused?: boolean;
		event?: Phase2EscalationLike & { sessionId?: string };
		evidence?: { steps?: BoundedTrajectoryStep[]; observationRefs?: string[] };
	},
	sessionId: string,
): Promise<AdvisorHandleResult> | AdvisorHandleResult {
	if (record.verdict !== "stuck" && !record.event && !record.paused) {
		return {
			status: "progressing",
			trigger: "detector_escalation",
			sessionId,
			oneShot: true,
			holdsGuiSession: false,
			fired: false,
		};
	}
	const steps = record.evidence?.steps ?? [];
	return advisor.handle({
		trigger: "detector_escalation",
		eventId: record.event?.eventId,
		trajectory: {
			sessionId,
			steps,
			attempt_count: steps.length,
			actual_effect: record.reason,
		},
		escalation: record.event ?? {
			eventId: `direct-drive-escalation-${sessionId}`,
			sessionId,
			reason: record.reason,
			verdict: "stuck",
			recommendedAction: "pause",
			evidenceRefs: record.evidence?.observationRefs ?? [],
		},
	});
}

export function adviseFromDirectDriveResult(
	advisor: ReturnType<typeof createDirectDriveAdvisor>,
	result: DirectDriveResult & {
		progress?: { verdict?: string; reason?: string; paused?: boolean; event?: Phase2EscalationLike };
		claim?: { kind?: string };
	},
): Promise<AdvisorHandleResult> {
	const sessionId = result.sessionId || "unknown";
	const step: BoundedTrajectoryStep = {
		action: result.action ?? {},
		result: result.error ? { error: result.error } : { ok: true },
		screenChanged: result.screenChanged ?? null,
		error: result.error ?? null,
	};
	const trajectory: BoundedTrajectory = {
		sessionId,
		steps: [step],
		last_observation: result.observation ?? null,
		last_action: result.action ?? null,
		expected_effect: result.expectedEffect,
		actual_effect: result.error ?? result.screenChanged,
		attempt_count: 1,
	};
	if (result.progress?.event || result.progress?.paused || result.progress?.verdict === "stuck") {
		return advisor.handle({
			trigger: "detector_escalation",
			eventId: result.progress.event?.eventId,
			trajectory,
			escalation: result.progress.event ?? {
				eventId: `direct-drive-escalation-${sessionId}`,
				sessionId,
				reason: result.progress.reason ?? "stuck",
				verdict: "stuck",
				recommendedAction: "pause",
			},
		});
	}
	if (result.error && /mutation_outcome_unknown|outcome_unknown/i.test(result.error)) {
		return advisor.handle({ trigger: "mutation_uncertain", trajectory });
	}
	if (result.claim?.kind === "milestone") {
		return advisor.handle({ trigger: "milestone", trajectory, claim: result.claim });
	}
	if (result.claim?.kind === "completion" || result.claim?.kind === "completion_claim") {
		return advisor.handle({ trigger: "completion_claim", trajectory, claim: result.claim });
	}
	return Promise.resolve({
		status: "progressing",
		trigger: "completion_claim",
		sessionId,
		oneShot: true,
		holdsGuiSession: false,
		fired: false,
	});
}

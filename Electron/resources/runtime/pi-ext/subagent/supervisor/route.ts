/**
 * Injectable Supervisor routing / test seam (S1).
 *
 * Accepts a SupervisorSessionPort and fake-friendly request sinks. Later
 * runtime wiring injects the real session at the Boss-facing delivery layer.
 * This module does not touch Pi AgentSession or existing delivery files.
 */

import {
	createBossEscalation,
	createSupervisorDecision,
	escalationKindFor,
	requiresBossDelivery,
	validateSupervisorEvent,
	type BossEscalationEnvelope,
	type SupervisorAction,
	type SupervisorDecision,
	type SupervisorEvent,
	type SupervisorInputPacket,
	type SupervisorJobSnapshot,
	type SupervisorTaskSnapshot,
} from "./contract.ts";

export interface SupervisorSessionPort {
	prompt(packet: SupervisorInputPacket): Promise<SupervisorDecision> | SupervisorDecision;
}

export interface SupervisorProviderSink {
	readonly requestCount: number;
	record(): void;
}

export interface BossRequestSink {
	readonly requestCount: number;
	readonly envelopes: readonly BossEscalationEnvelope[];
	send(envelope: BossEscalationEnvelope): Promise<void> | void;
}

export interface SupervisorRouteResult {
	outcome: "handled" | "escalated" | "duplicate" | "rejected";
	receiptId: string;
	supervisorPrompts: number;
	bossRequests: number;
	decision?: SupervisorDecision;
	error?: string;
}

export interface SupervisorRouter {
	readonly supervisorPromptCount: number;
	readonly bossRequestCount: number;
	readonly results: readonly SupervisorRouteResult[];
	route(
		event: SupervisorEvent,
		context?: {
			activeJobs?: SupervisorJobSnapshot[];
			tasks?: SupervisorTaskSnapshot[];
			priorAction?: SupervisorAction;
		},
	): Promise<SupervisorRouteResult>;
}

export interface SupervisorRouteDeps {
	supervisor: SupervisorSessionPort;
	boss: BossRequestSink;
	supervisorProvider?: SupervisorProviderSink;
}

export interface FakeSupervisorSession extends SupervisorSessionPort {
	readonly promptCount: number;
	readonly providerRequestCount: number;
}

export function createRecordingProviderSink(): SupervisorProviderSink {
	let requestCount = 0;
	return {
		get requestCount() {
			return requestCount;
		},
		record() {
			requestCount += 1;
		},
	};
}

export function createRecordingBossSink(): BossRequestSink {
	const envelopes: BossEscalationEnvelope[] = [];
	return {
		get requestCount() {
			return envelopes.length;
		},
		get envelopes() {
			return envelopes;
		},
		send(envelope: BossEscalationEnvelope) {
			envelopes.push(envelope);
		},
	};
}

export function createFakeSupervisorSession(options: {
	decide: (packet: SupervisorInputPacket) => SupervisorDecision;
	provider?: SupervisorProviderSink;
}): FakeSupervisorSession {
	let promptCount = 0;
	const provider = options.provider ?? createRecordingProviderSink();
	return {
		get promptCount() {
			return promptCount;
		},
		get providerRequestCount() {
			return provider.requestCount;
		},
		prompt(packet: SupervisorInputPacket) {
			promptCount += 1;
			provider.record();
			return options.decide(packet);
		},
	};
}

export function createSupervisorRouter(deps: SupervisorRouteDeps): SupervisorRouter {
	const seen = new Set<string>();
	const results: SupervisorRouteResult[] = [];
	let supervisorPromptCount = 0;
	let bossRequestCount = 0;

	async function route(
		event: SupervisorEvent,
		context?: {
			activeJobs?: SupervisorJobSnapshot[];
			tasks?: SupervisorTaskSnapshot[];
			priorAction?: SupervisorAction;
		},
	): Promise<SupervisorRouteResult> {
		const validated = validateSupervisorEvent(event);
		if (validated.ok === false) {
			const result: SupervisorRouteResult = {
				outcome: "rejected",
				receiptId: typeof event?.identity?.eventId === "string" ? event.identity.eventId : "",
				supervisorPrompts: 0,
				bossRequests: 0,
				error: validated.error,
			};
			results.push(result);
			return result;
		}

		const receiptId = validated.value.identity.eventId;
		if (seen.has(receiptId)) {
			const result: SupervisorRouteResult = {
				outcome: "duplicate",
				receiptId,
				supervisorPrompts: 0,
				bossRequests: 0,
			};
			results.push(result);
			return result;
		}

		const packet: SupervisorInputPacket = {
			event: validated.value,
			activeJobs: context?.activeJobs ?? [validated.value.job],
			tasks: context?.tasks ?? (validated.value.task ? [validated.value.task] : []),
			...(context?.priorAction ? { priorAction: context.priorAction } : {}),
		};

		supervisorPromptCount += 1;
		deps.supervisorProvider?.record();
		let rawDecision: SupervisorDecision;
		try {
			rawDecision = await deps.supervisor.prompt(packet);
		} catch (error) {
			const result: SupervisorRouteResult = {
				outcome: "rejected",
				receiptId,
				supervisorPrompts: 1,
				bossRequests: 0,
				error: error instanceof Error ? error.message : String(error),
			};
			results.push(result);
			return result;
		}

		const decision = createSupervisorDecision(rawDecision);
		if (decision.ok === false) {
			const result: SupervisorRouteResult = {
				outcome: "rejected",
				receiptId,
				supervisorPrompts: 1,
				bossRequests: 0,
				error: decision.error,
			};
			results.push(result);
			return result;
		}

		if (!requiresBossDelivery(decision.value)) {
			seen.add(receiptId);
			const result: SupervisorRouteResult = {
				outcome: "handled",
				receiptId,
				supervisorPrompts: 1,
				bossRequests: 0,
				decision: decision.value,
			};
			results.push(result);
			return result;
		}

		const envelope = createBossEscalation({
			eventId: receiptId,
			agentId: validated.value.identity.agentId,
			runId: validated.value.identity.runId,
			kind: escalationKindFor(validated.value),
			reason: decision.value.reason ?? validated.value.summary,
			recommendedAction: decision.value.recommendedAction,
			evidenceRefs: decision.value.evidenceRefs ?? validated.value.evidenceRefs ?? [],
		});
		if (envelope.ok === false) {
			const result: SupervisorRouteResult = {
				outcome: "rejected",
				receiptId,
				supervisorPrompts: 1,
				bossRequests: 0,
				decision: decision.value,
				error: envelope.error,
			};
			results.push(result);
			return result;
		}

		await deps.boss.send(envelope.value);
		seen.add(receiptId);
		bossRequestCount += 1;
		const result: SupervisorRouteResult = {
			outcome: "escalated",
			receiptId,
			supervisorPrompts: 1,
			bossRequests: 1,
			decision: decision.value,
		};
		results.push(result);
		return result;
	}

	return {
		get supervisorPromptCount() {
			return supervisorPromptCount;
		},
		get bossRequestCount() {
			return bossRequestCount;
		},
		get results() {
			return results;
		},
		route,
	};
}

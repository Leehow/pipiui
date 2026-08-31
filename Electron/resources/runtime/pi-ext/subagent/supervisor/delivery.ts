/**
 * Supervisor delivery seam (S4).
 *
 * Injectable Boss-facing router: compact events go to a SupervisorSessionPort;
 * only bounded escalations and terminal wave summaries create a Boss obligation.
 * Supervisor failure falls back once to the current Boss delivery path.
 * Boss wakes settle only after the injected delivery path accepts.
 */

import {
	SUPERVISOR_WAVE_AGENT_ID,
	createBossEscalation,
	createSupervisorEvent,
	escalationKindFor,
	requiresBossDelivery,
	serializeBossEscalation,
	validateSupervisorEvent,
	waveReceiptIdentity,
	type BossEscalationEnvelope,
	type SupervisorAction,
	type SupervisorEvent,
	type SupervisorEventKind,
	type SupervisorInputPacket,
	type SupervisorJobSnapshot,
	type SupervisorTaskSnapshot,
	type SupervisorWaveSnapshot,
} from "./contract.ts";
import {
	createSupervisorControl,
	type SupervisorControl,
	type SupervisorLifecyclePort,
	type SupervisorTaskManifest,
} from "./control.ts";
import {
	createSupervisorRouter,
	type BossRequestSink,
	type SupervisorRouteResult,
	type SupervisorRouter,
	type SupervisorSessionPort,
} from "./route.ts";
import {
	countActiveSupervisorJobs,
	createSupervisorSessionRuntime,
	isAbnormalTerminalSupervisorPacket,
	type SupervisorModelSources,
	type SupervisorPiSessionFactory,
	type SupervisorSessionRuntime,
} from "./session-runtime.ts";
import {
	createEmptySupervisorState,
	type SupervisorStateStore,
} from "./state-store.ts";

export const SUPERVISOR_FAILURE_FALLBACK_REASON = "supervisor failure; falling back to Boss delivery";

/** Watch forwards wake Boss with a compact text, bounded like a single-worker terminal report. */
export const WATCH_FORWARD_MAX_UTF8_BYTES = 4_800;

export type SupervisorDeliveryOutcome =
	| "supervisor"
	| "escalated"
	| "fallback"
	| "duplicate"
	| "boss_direct"
	| "ignored"
	| "rejected"
	| "pending";

export interface SupervisorDeliveryRequest {
	kind: SupervisorEventKind;
	agentId: string;
	runId: string;
	sequence: number;
	publicText: string;
	job: SupervisorJobSnapshot;
	summary: string;
	occurredAt?: number;
	waveId?: string;
	task?: SupervisorTaskSnapshot;
	wave?: SupervisorWaveSnapshot;
	evidenceRefs?: string[];
	activeJobs?: SupervisorJobSnapshot[];
	tasks?: SupervisorTaskSnapshot[];
	priorAction?: SupervisorAction;
	/** Structured terminal batch rows; delivery allocates findings bytes fairly across every row. */
	terminalReports?: SupervisorTerminalReport[];
	/** Progress-log excerpts skip the Supervisor LLM and wake Boss immediately. */
	forceForward?: boolean;
}

export interface SupervisorTerminalReport {
	agentId: string;
	runId: string;
	status: SupervisorJobSnapshot["status"];
	findings: string;
	statusRef: string;
}

export interface SupervisorDeliveryResult {
	outcome: SupervisorDeliveryOutcome;
	receiptId: string;
	supervisorPrompts: number;
	bossRequests: number;
	bossWakes: number;
	createBossObligation: boolean;
	useCurrentPath: boolean;
	decisionAction?: string;
	error?: string;
}

export interface SupervisorCurrentDelivery {
	(input: {
		kind: SupervisorEventKind;
		publicText: string;
		agentId: string;
		runId: string;
		receiptId: string;
		envelope?: BossEscalationEnvelope;
	}): Promise<boolean | void> | boolean | void;
}

export interface SupervisorDeliveryDeps {
	supervisor: SupervisorSessionPort;
	boss: BossRequestSink;
	/** Current Boss-facing path (fallback + terminal wave + escalation). */
	deliverCurrent: SupervisorCurrentDelivery;
	activeWorkerCount: () => number;
	control?: SupervisorControl | (() => SupervisorControl);
	store?: SupervisorStateStore;
	supervisorProvider?: { record(): void; readonly requestCount: number };
}

export interface SupervisorDelivery {
	readonly supervisorPromptCount: number;
	readonly bossRequestCount: number;
	readonly bossWakeCount: number;
	readonly fallbackCount: number;
	readonly results: readonly SupervisorDeliveryResult[];
	handle(request: SupervisorDeliveryRequest): Promise<SupervisorDeliveryResult>;
}

export interface HostSupervisorDeliveryOptions {
	projectRoot: string;
	factory: SupervisorPiSessionFactory;
	lifecycle: SupervisorLifecyclePort;
	deliverCurrent: SupervisorCurrentDelivery;
	boss: BossRequestSink;
	activeWorkerCount: () => number;
	manifest: () => SupervisorTaskManifest;
	snapshots?: () => {
		activeJobs: SupervisorJobSnapshot[];
		tasks: SupervisorTaskSnapshot[];
		priorAction?: SupervisorAction;
	};
	models?: SupervisorModelSources | (() => SupervisorModelSources);
	store: SupervisorStateStore;
	projectScopedPath?: string;
	promptTimeoutMs?: number;
}

export interface HostSupervisorDelivery {
	delivery: SupervisorDelivery;
	runtime: SupervisorSessionRuntime;
	dispose(): Promise<void>;
}

const silentBoss: BossRequestSink = {
	get requestCount() {
		return 0;
	},
	get envelopes() {
		return [];
	},
	send() {},
};

export function isSuccessfulSupervisorCompletion(request: SupervisorDeliveryRequest): boolean {
	if (request.kind !== "completion") return false;
	if (request.job.status === "failed" || request.job.status === "interrupted") return false;
	if (request.job.verify === "failed") return false;
	return request.job.status === "completed";
}

export function isTerminalWaveRequest(request: SupervisorDeliveryRequest, activeWorkerCount: number): boolean {
	if (activeWorkerCount > 0) return false;
	return request.kind === "wave";
}

export function coalesceTerminalWaveRequest(
	request: SupervisorDeliveryRequest,
	activeWorkerCount: number,
): SupervisorDeliveryRequest {
	if (!isTerminalWaveRequest(request, activeWorkerCount)) return request;
	const waveId = request.waveId ?? request.wave?.waveId ?? "wave";
	const identity = waveReceiptIdentity(waveId);
	const coords = identity.ok
		? identity.value
		: { kind: "wave" as const, agentId: SUPERVISOR_WAVE_AGENT_ID, runId: waveId, sequence: 1, waveId };
	const evidenceRefs = [
		...(request.evidenceRefs ?? []),
		`artifact://status/${request.agentId}/${request.runId}`,
		`artifact://wave/${waveId}`,
	].filter((value, index, all) => all.indexOf(value) === index);
	return {
		...request,
		kind: "wave",
		agentId: coords.agentId,
		runId: coords.runId,
		sequence: coords.sequence,
		waveId,
		job: {
			agentId: coords.agentId,
			runId: coords.runId,
			status: "completed",
			...(request.job.title !== undefined ? { title: request.job.title } : {}),
			...(request.job.verify !== undefined ? { verify: request.job.verify } : {}),
		},
		summary: request.summary.slice(0, 400),
		evidenceRefs,
		activeJobs: [],
		wave: request.wave ?? {
			waveId,
			running: 0,
			completed: 1,
			failed: 0,
			agentIds: [request.agentId],
		},
	};
}

export function createSupervisorDelivery(deps: SupervisorDeliveryDeps): SupervisorDelivery {
	const router: SupervisorRouter = createSupervisorRouter({
		supervisor: deps.supervisor,
		boss: silentBoss,
		supervisorProvider: deps.supervisorProvider,
	});
	const settled = new Set<string>();
	const fallbackOnce = new Set<string>();
	const bossPending = new Set<string>();
	const pendingBossPayloads = new Map<string, {
		publicText: string;
		envelope?: BossEscalationEnvelope;
		outcome: "escalated" | "fallback" | "boss_direct";
		decisionAction?: string;
	}>();
	const inFlight = new Map<string, Promise<SupervisorDeliveryResult>>();
	const results: SupervisorDeliveryResult[] = [];
	const heldByWave = new Map<string, SupervisorTerminalReport[]>();
	let bossWakeCount = 0;
	let bossRequestCount = 0;
	let fallbackCount = 0;

	function control(): SupervisorControl | undefined {
		if (!deps.control) return undefined;
		return typeof deps.control === "function" ? deps.control() : deps.control;
	}

	function alreadySettled(receiptId: string): boolean {
		if (!receiptId) return false;
		if (settled.has(receiptId)) return true;
		if (bossPending.has(receiptId) || fallbackOnce.has(receiptId)) return false;
		if (!deps.store) return false;
		try {
			const claim = deps.store.load().receipts[receiptId];
			return claim?.status === "completed";
		} catch {
			return false;
		}
	}

	function remember(receiptId: string): void {
		if (receiptId) settled.add(receiptId);
	}

	async function persistAction(event: SupervisorEvent, action: SupervisorAction): Promise<void> {
		const engine = control();
		if (!engine) return;
		try {
			await engine.apply(event, action);
		} catch {
			// Control persistence must not strand the delivery outcome already decided.
		}
	}

	async function invokeCurrent(
		request: SupervisorDeliveryRequest,
		receiptId: string,
		publicText: string,
		envelope?: BossEscalationEnvelope,
	): Promise<boolean> {
		const accepted = await deps.deliverCurrent({
			kind: request.kind,
			publicText,
			agentId: request.agentId,
			runId: request.runId,
			receiptId,
			...(envelope ? { envelope } : {}),
		});
		return accepted !== false;
	}

	function pendingResult(
		outcome: SupervisorDeliveryOutcome,
		receiptId: string,
		supervisorPrompts: number,
		error?: string,
		decisionAction?: string,
	): SupervisorDeliveryResult {
		return {
			outcome,
			receiptId,
			supervisorPrompts,
			bossRequests: 0,
			bossWakes: 0,
			createBossObligation: true,
			useCurrentPath: false,
			...(decisionAction ? { decisionAction } : {}),
			...(error ? { error } : {}),
		};
	}

	async function acceptBossWake(
		request: SupervisorDeliveryRequest,
		event: SupervisorEvent,
		receiptId: string,
		publicText: string,
		envelope: BossEscalationEnvelope | undefined,
		supervisorPrompts: number,
		outcome: "escalated" | "fallback" | "boss_direct",
		error?: string,
		decisionAction?: string,
	): Promise<SupervisorDeliveryResult> {
		bossPending.add(receiptId);
		pendingBossPayloads.set(receiptId, {
			publicText,
			...(envelope ? { envelope } : {}),
			outcome,
			...(decisionAction ? { decisionAction } : {}),
		});
		let accepted: boolean;
		try {
			accepted = await invokeCurrent(request, receiptId, publicText, envelope);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			const result = pendingResult("pending", receiptId, supervisorPrompts, error ?? `boss delivery rejected: ${detail}`, decisionAction);
			results.push(result);
			return result;
		}
		if (!accepted) {
			const result = pendingResult("pending", receiptId, supervisorPrompts, error ?? "boss delivery not accepted", decisionAction);
			results.push(result);
			return result;
		}
		if (envelope) {
			await deps.boss.send(envelope);
			bossRequestCount += 1;
		}
		bossWakeCount += 1;
		bossPending.delete(receiptId);
		pendingBossPayloads.delete(receiptId);
		remember(receiptId);
		if (outcome === "fallback") {
			await persistAction(event, { kind: "escalate", reason: SUPERVISOR_FAILURE_FALLBACK_REASON });
		} else if (outcome === "boss_direct" || outcome === "escalated") {
			await persistAction(event, {
				kind: decisionAction === "forward" ? "forward" : "escalate",
				reason: envelope?.reason ?? event.summary,
			});
		}
		const result: SupervisorDeliveryResult = {
			outcome,
			receiptId,
			supervisorPrompts,
			bossRequests: envelope ? 1 : 0,
			bossWakes: 1,
			createBossObligation: true,
			useCurrentPath: false,
			...(decisionAction ? { decisionAction } : {}),
			...(error ? { error } : {}),
		};
		results.push(result);
		return result;
	}

	function boundedEnvelope(
		event: SupervisorEvent,
		reason: string,
		evidenceRefs?: string[],
		recommendedAction?: string,
	): BossEscalationEnvelope | undefined {
		const envelope = createBossEscalation({
			eventId: event.identity.eventId,
			agentId: event.identity.agentId,
			runId: event.identity.runId,
			kind: escalationKindFor(event),
			reason,
			evidenceRefs: evidenceRefs ?? event.evidenceRefs ?? [],
			...(recommendedAction ? { recommendedAction } : {}),
		});
		return envelope.ok ? envelope.value : undefined;
	}

	function truncateUtf8(text: string, maxBytes: number): string {
		const clean = text.replace(/\0/g, "").trim();
		if (Buffer.byteLength(clean, "utf8") <= maxBytes) return clean;
		return Buffer.from(clean, "utf8").subarray(0, Math.max(0, maxBytes - 3)).toString("utf8").replace(/\uFFFD$/u, "") + "...";
	}

	function waveIdOf(request: SupervisorDeliveryRequest): string | undefined {
		return request.waveId ?? request.wave?.waveId;
	}

	function rememberHeldCompletion(request: SupervisorDeliveryRequest): void {
		const waveId = waveIdOf(request);
		if (!waveId || request.kind !== "completion") return;
		const statusRef = request.evidenceRefs?.find((ref) => ref.startsWith("artifact://status/"))
			?? `artifact://status/${request.agentId}/${request.runId}`;
		const report: SupervisorTerminalReport = {
			agentId: request.agentId,
			runId: request.runId,
			status: request.job.status,
			findings: request.publicText || request.summary,
			statusRef,
		};
		const existing = heldByWave.get(waveId) ?? [];
		if (existing.some((item) => item.agentId === report.agentId && item.runId === report.runId)) return;
		heldByWave.set(waveId, [...existing, report]);
	}

	function heldKeysFromStore(waveId: string): Set<string> {
		if (!deps.store) return new Set();
		const waveRef = `artifact://wave/${waveId}`;
		try {
			return new Set(
				Object.values(deps.store.load().receipts)
					.filter((claim) =>
						claim.kind === "completion"
						&& claim.action === "wait"
						&& (claim.evidenceRefs ?? []).includes(waveRef))
					.map((claim) => `${claim.agentId}\0${claim.runId}`),
			);
		} catch {
			return new Set();
		}
	}

	function takeHeldReports(request: SupervisorDeliveryRequest): SupervisorTerminalReport[] {
		const waveId = waveIdOf(request);
		if (!waveId) return [];
		const held = heldByWave.get(waveId) ?? [];
		heldByWave.delete(waveId);
		const heldKeys = new Set([
			...held.map((item) => `${item.agentId}\0${item.runId}`),
			...heldKeysFromStore(waveId),
		]);
		if (heldKeys.size === 0) return [];
		const fromHost = (request.terminalReports ?? []).filter((item) => heldKeys.has(`${item.agentId}\0${item.runId}`));
		return fromHost.length > 0 ? fromHost : held.filter((item) => heldKeys.has(`${item.agentId}\0${item.runId}`));
	}

	function terminalReport(request: SupervisorDeliveryRequest): string {
		const summary = truncateUtf8(request.summary, 600);
		const reports = request.terminalReports ?? [];
		if (reports.length > 0) {
			const prefix = `${summary}; bounded worker reports:\n`;
			const pointerLines = reports.map((report) =>
				`- agentId=${report.agentId} runId=${report.runId} status=${report.status} statusRef=${report.statusRef} findings=`);
			const mandatoryBytes = Buffer.byteLength(prefix + pointerLines.join("\n"), "utf8");
			const findingsBudget = Math.max(0, 5_200 - mandatoryBytes);
			const fairShare = Math.floor(findingsBudget / reports.length);
			const lines = reports.map((report, index) =>
				`${pointerLines[index]}${fairShare > 3 ? truncateUtf8(report.findings || "none", fairShare) : ""}`);
			return prefix + lines.join("\n");
		}
		const workerReport = Buffer.byteLength(request.publicText, "utf8") <= 4_800
			? truncateUtf8(request.publicText, 3_600)
			: "";
		return workerReport && workerReport !== summary
			? `${summary}; bounded worker report: ${workerReport}`
			: summary;
	}

	function terminalEscalationReason(request: SupervisorDeliveryRequest, reason?: string): string {
		const report = terminalReport(request);
		const decisionReason = truncateUtf8(reason ?? "", 1_200);
		return decisionReason && decisionReason !== request.summary
			? `${decisionReason}; ${report}`
			: report;
	}

	function boundedText(envelope: BossEscalationEnvelope): string | undefined {
		const serialized = serializeBossEscalation(envelope);
		if (serialized.ok === false) return undefined;
		return formatSupervisorEscalationText(envelope);
	}

	async function flushHeldCompletions(source: SupervisorDeliveryRequest): Promise<void> {
		const reports = takeHeldReports(source);
		const waveId = waveIdOf(source);
		if (reports.length === 0 || !waveId) return;
		const identity = waveReceiptIdentity(waveId);
		const coords = identity.ok
			? identity.value
			: { kind: "wave" as const, agentId: SUPERVISOR_WAVE_AGENT_ID, runId: waveId, sequence: 1, waveId };
		const waveRequest: SupervisorDeliveryRequest = {
			...source,
			kind: "wave",
			agentId: coords.agentId,
			runId: coords.runId,
			sequence: coords.sequence,
			waveId,
			summary: `held completions flushed count=${reports.length}`,
			publicText: `[subagent-wave] ${waveId} held=${reports.length}`,
			job: { agentId: coords.agentId, runId: coords.runId, status: "completed" },
			terminalReports: reports,
			activeJobs: [],
			evidenceRefs: [...reports.map((item) => item.statusRef), `artifact://wave/${waveId}`],
			wave: source.wave ?? {
				waveId,
				running: 0,
				completed: reports.filter((item) => item.status === "completed").length,
				failed: reports.filter((item) => item.status !== "completed").length,
				agentIds: reports.map((item) => item.agentId),
			},
		};
		const built = createSupervisorEvent({
			kind: "wave",
			agentId: coords.agentId,
			runId: coords.runId,
			sequence: coords.sequence,
			occurredAt: Date.now(),
			job: waveRequest.job,
			summary: terminalReport(waveRequest),
			waveId,
			wave: waveRequest.wave,
			evidenceRefs: waveRequest.evidenceRefs,
		});
		if (built.ok === false) return;
		const envelope = boundedEnvelope(built.value, terminalReport(waveRequest), waveRequest.evidenceRefs);
		if (!envelope) return;
		const text = boundedText(envelope);
		if (!text) return;
		await acceptBossWake(
			waveRequest,
			built.value,
			built.value.identity.eventId,
			text,
			envelope,
			0,
			"boss_direct",
			undefined,
			"wave_summary",
		);
	}

	async function fallback(
		request: SupervisorDeliveryRequest,
		event: SupervisorEvent | undefined,
		receiptId: string,
		supervisorPrompts: number,
		error: string,
	): Promise<SupervisorDeliveryResult> {
		if (settled.has(receiptId)) {
			const result: SupervisorDeliveryResult = {
				outcome: "duplicate",
				receiptId,
				supervisorPrompts: 0,
				bossRequests: 0,
				bossWakes: 0,
				createBossObligation: false,
				useCurrentPath: false,
			};
			results.push(result);
			return result;
		}
		if (!fallbackOnce.has(receiptId)) {
			fallbackOnce.add(receiptId);
			fallbackCount += 1;
		}
		bossPending.add(receiptId);
		if (!event) {
			let accepted: boolean;
			try {
				accepted = await invokeCurrent(request, receiptId, request.publicText);
			} catch {
				const result = pendingResult("pending", receiptId, supervisorPrompts, error);
				results.push(result);
				return result;
			}
			if (!accepted) {
				const result = pendingResult("pending", receiptId, supervisorPrompts, error);
				results.push(result);
				return result;
			}
			bossWakeCount += 1;
			remember(receiptId);
			const result: SupervisorDeliveryResult = {
				outcome: "fallback",
				receiptId,
				supervisorPrompts,
				bossRequests: 0,
				bossWakes: 1,
				createBossObligation: true,
				useCurrentPath: false,
				error,
			};
			results.push(result);
			return result;
		}
		const envelope = request.kind === "wave" || request.kind === "upgrade_failure"
			? boundedEnvelope(
				event,
				request.kind === "wave" ? terminalEscalationReason(request, error) : error,
				event.evidenceRefs,
				request.kind === "wave" ? "Boss should inspect the bounded evidence and explicitly choose whether to redispatch." : undefined,
			)
			: undefined;
		const publicText = envelope ? boundedText(envelope) ?? request.summary.slice(0, 400) : request.publicText;
		return acceptBossWake(
			request,
			event,
			receiptId,
			publicText,
			envelope,
			supervisorPrompts,
			"fallback",
			error,
		);
	}

	async function handleExclusive(raw: SupervisorDeliveryRequest): Promise<SupervisorDeliveryResult> {
		const active = Math.max(0, deps.activeWorkerCount());
		const request = coalesceTerminalWaveRequest(raw, active);
		const eventSummary = isTerminalWaveRequest(request, active) ? terminalReport(request) : request.summary;
		const waveId = waveIdOf(request);
		const evidenceRefs = [
			...(request.evidenceRefs ?? []),
			...(request.kind === "completion" && waveId ? [`artifact://wave/${waveId}`] : []),
		].filter((value, index, all) => all.indexOf(value) === index);
		const built = createSupervisorEvent({
			kind: request.kind,
			agentId: request.agentId,
			runId: request.runId,
			sequence: request.sequence,
			occurredAt: request.occurredAt ?? Date.now(),
			job: request.job,
			summary: eventSummary,
			waveId: request.waveId,
			task: request.task,
			wave: request.wave,
			evidenceRefs,
		});
		if (built.ok === false) {
			return fallback(request, undefined, "", 0, built.error);
		}

		const event = built.value;
		const receiptId = event.identity.eventId;
		if (alreadySettled(receiptId)) {
			const result: SupervisorDeliveryResult = {
				outcome: "duplicate",
				receiptId,
				supervisorPrompts: 0,
				bossRequests: 0,
				bossWakes: 0,
				createBossObligation: false,
				useCurrentPath: false,
			};
			results.push(result);
			return result;
		}

		if (fallbackOnce.has(receiptId)) {
			return fallback(request, event, receiptId, 0, SUPERVISOR_FAILURE_FALLBACK_REASON);
		}
		if (bossPending.has(receiptId)) {
			const pending = pendingBossPayloads.get(receiptId);
			const envelope = pending?.envelope ?? boundedEnvelope(event, event.summary, event.evidenceRefs);
			const publicText = pending?.publicText ?? (envelope ? boundedText(envelope) : request.publicText);
			if (!publicText) return fallback(request, event, receiptId, 0, "escalation envelope rejected");
			const outcome = pending?.outcome ?? (request.kind === "wave" ? "boss_direct" : "escalated");
			return acceptBossWake(request, event, receiptId, publicText, envelope, 0, outcome, undefined, pending?.decisionAction);
		}

		if (request.forceForward) {
			return acceptBossWake(
				request,
				event,
				receiptId,
				request.publicText,
				undefined,
				0,
				"boss_direct",
				undefined,
				"forward",
			);
		}

		const packetJobs = request.activeJobs ?? [event.job];
		const packetActive = countActiveSupervisorJobs(packetJobs);
		const abnormalTerminal = active <= 0 && isAbnormalTerminalSupervisorPacket({
			event,
			activeJobs: packetJobs,
			tasks: request.tasks ?? (event.task ? [event.task] : []),
			...(request.priorAction ? { priorAction: request.priorAction } : {}),
		});

		if (active <= 0 && packetActive <= 0 && !abnormalTerminal) {
			if (isSuccessfulSupervisorCompletion(request)) {
				const delivered = await acceptBossWake(
					request,
					event,
					receiptId,
					request.publicText,
					undefined,
					0,
					"boss_direct",
					undefined,
					"forward",
				);
				await flushHeldCompletions(request);
				return delivered;
			}
			if (isTerminalWaveRequest(request, active)) {
				const envelope = boundedEnvelope(event, terminalReport(request), event.evidenceRefs);
				if (!envelope) {
					return fallback(request, event, receiptId, 0, "wave summary exceeds 8 KiB");
				}
				const text = boundedText(envelope);
				if (!text) return fallback(request, event, receiptId, 0, "wave summary exceeds 8 KiB");
				return acceptBossWake(request, event, receiptId, text, envelope, 0, "boss_direct", undefined, "wave_summary");
			}
			const result: SupervisorDeliveryResult = {
				outcome: "ignored",
				receiptId,
				supervisorPrompts: 0,
				bossRequests: 0,
				bossWakes: 0,
				createBossObligation: false,
				useCurrentPath: false,
			};
			results.push(result);
			return result;
		}

		let routed: SupervisorRouteResult;
		try {
			routed = await router.route(event, {
				activeJobs: packetJobs,
				tasks: request.tasks ?? (event.task ? [event.task] : []),
				priorAction: request.priorAction,
			});
		} catch (error) {
			return fallback(
				request,
				event,
				receiptId,
				1,
				error instanceof Error ? error.message : String(error),
			);
		}

		if (routed.outcome === "duplicate") {
			remember(receiptId);
			const result: SupervisorDeliveryResult = {
				outcome: "duplicate",
				receiptId,
				supervisorPrompts: 0,
				bossRequests: 0,
				bossWakes: 0,
				createBossObligation: false,
				useCurrentPath: false,
			};
			results.push(result);
			return result;
		}

		if (routed.outcome === "rejected") {
			return fallback(request, event, receiptId, routed.supervisorPrompts, routed.error ?? "supervisor rejected");
		}

		const action: SupervisorAction = {
			kind: routed.decision?.action ?? "wait",
			agentId: event.identity.agentId,
			runId: event.identity.runId,
			reason: routed.decision?.reason,
			...(routed.decision?.taskId ? { taskId: routed.decision.taskId } : {}),
		};

		const needsBoss = abnormalTerminal || routed.outcome === "escalated" || requiresBossDelivery({ action: action.kind });
		let applied: Awaited<ReturnType<SupervisorControl["apply"]>> | undefined;
		if (!needsBoss) {
			try {
				applied = control() ? await control()!.apply(event, action) : undefined;
			} catch (error) {
				return fallback(
					request,
					event,
					receiptId,
					routed.supervisorPrompts,
					error instanceof Error ? error.message : String(error),
				);
			}
			if (action.kind === "wait" && isSuccessfulSupervisorCompletion(request)) {
				rememberHeldCompletion(request);
			}
		}
		if (applied?.outcome === "duplicate") {
			remember(receiptId);
			const result: SupervisorDeliveryResult = {
				outcome: "duplicate",
				receiptId,
				supervisorPrompts: routed.supervisorPrompts,
				bossRequests: 0,
				bossWakes: 0,
				createBossObligation: false,
				useCurrentPath: false,
				decisionAction: applied.action,
			};
			results.push(result);
			return result;
		}

		if (!abnormalTerminal && request.kind === "completion" && (action.kind === "wait" || action.kind === "forward") && !isSuccessfulSupervisorCompletion(request)) {
			return acceptBossWake(
				request,
				event,
				receiptId,
				request.publicText,
				undefined,
				routed.supervisorPrompts,
				"boss_direct",
				undefined,
				"forward",
			);
		}

		if (!abnormalTerminal && isSuccessfulSupervisorCompletion(request) && action.kind !== "wait" && action.kind !== "escalate") {
			return acceptBossWake(
				request,
				event,
				receiptId,
				request.publicText,
				undefined,
				routed.supervisorPrompts,
				"boss_direct",
				undefined,
				action.kind === "forward" ? "forward" : action.kind,
			);
		}

		if (!abnormalTerminal && request.kind === "watch" && action.kind === "forward") {
			return acceptBossWake(
				request,
				event,
				receiptId,
				truncateUtf8(request.publicText, WATCH_FORWARD_MAX_UTF8_BYTES),
				undefined,
				routed.supervisorPrompts,
				"boss_direct",
				undefined,
				"forward",
			);
		}

		if (abnormalTerminal || routed.outcome === "escalated" || applied?.outcome === "escalation_required" || requiresBossDelivery({
			action: action.kind,
		})) {
			const forcedTerminalReason = abnormalTerminal
				? terminalEscalationReason(
					request,
					routed.decision?.reason
						?? `Supervisor action ${action.kind} cannot close a terminal failure`,
				)
				: undefined;
			const envelope = boundedEnvelope(
				event,
				forcedTerminalReason ?? applied?.reason ?? routed.decision?.reason ?? event.summary,
				applied?.evidenceRefs ?? routed.decision?.evidenceRefs ?? event.evidenceRefs,
				routed.decision?.recommendedAction ?? (abnormalTerminal
					? "Boss should inspect the bounded evidence and explicitly choose whether to redispatch."
					: undefined),
			);
			if (!envelope) {
				return fallback(request, event, receiptId, routed.supervisorPrompts, "escalation envelope rejected");
			}
			const text = boundedText(envelope);
			if (!text) {
				return fallback(request, event, receiptId, routed.supervisorPrompts, "escalation envelope rejected");
			}
			return acceptBossWake(
				request,
				event,
				receiptId,
				text,
				envelope,
				routed.supervisorPrompts,
				"escalated",
				undefined,
				action.kind,
			);
		}

		remember(receiptId);
		const result: SupervisorDeliveryResult = {
			outcome: "supervisor",
			receiptId,
			supervisorPrompts: routed.supervisorPrompts,
			bossRequests: 0,
			bossWakes: 0,
			createBossObligation: false,
			useCurrentPath: false,
			decisionAction: action.kind,
		};
		results.push(result);
		return result;
	}

	async function handle(raw: SupervisorDeliveryRequest): Promise<SupervisorDeliveryResult> {
		const active = Math.max(0, deps.activeWorkerCount());
		const request = coalesceTerminalWaveRequest(raw, active);
		const preview = createSupervisorEvent({
			kind: request.kind,
			agentId: request.agentId,
			runId: request.runId,
			sequence: request.sequence,
			occurredAt: request.occurredAt ?? Date.now(),
			job: request.job,
			summary: request.summary,
			waveId: request.waveId,
			task: request.task,
			wave: request.wave,
			evidenceRefs: request.evidenceRefs,
		});
		const receiptId = preview.ok ? preview.value.identity.eventId : "";
		if (receiptId) {
			const existing = inFlight.get(receiptId);
			if (existing) return existing;
		}
		const work = handleExclusive(raw).finally(() => {
			if (receiptId) inFlight.delete(receiptId);
		});
		if (receiptId) inFlight.set(receiptId, work);
		return work;
	}

	return {
		get supervisorPromptCount() {
			return router.supervisorPromptCount;
		},
		get bossRequestCount() {
			return bossRequestCount;
		},
		get bossWakeCount() {
			return bossWakeCount;
		},
		get fallbackCount() {
			return fallbackCount;
		},
		get results() {
			return results;
		},
		handle,
	};
}

export function createHostSupervisorDelivery(options: HostSupervisorDeliveryOptions): HostSupervisorDelivery {
	const runtime = createSupervisorSessionRuntime({
		projectRoot: options.projectRoot,
		factory: options.factory,
		models: options.models,
		projectScopedPath: options.projectScopedPath,
		promptTimeoutMs: options.promptTimeoutMs,
	});
	const control = createSupervisorControl({
		lifecycle: options.lifecycle,
		store: options.store,
		manifest: options.manifest,
	});

	const delivery = createSupervisorDelivery({
		supervisor: {
			async prompt(packet: SupervisorInputPacket) {
				const active = options.activeWorkerCount();
				await runtime.setActiveWorkerCount(active);
				return runtime.prompt(packet);
			},
		},
		boss: options.boss,
		deliverCurrent: options.deliverCurrent,
		activeWorkerCount: options.activeWorkerCount,
		store: options.store,
		control,
	});

	return {
		delivery,
		runtime,
		async dispose() {
			await runtime.dispose();
		},
	};
}

export function emptySupervisorManifest(): SupervisorTaskManifest {
	return { tasks: [] };
}

export function memorySupervisorStore(): SupervisorStateStore {
	let state = createEmptySupervisorState();
	return {
		load() {
			return {
				version: state.version,
				receipts: { ...state.receipts },
				usage: { ...state.usage },
			};
		},
		save(next) {
			state = {
				version: next.version,
				receipts: { ...next.receipts },
				usage: { ...next.usage },
			};
		},
	};
}

export function formatSupervisorEscalationText(envelope: BossEscalationEnvelope): string {
	return `[subagent-supervisor] ${JSON.stringify(envelope)}`;
}

export function validateSupervisorEventOrThrow(value: unknown): SupervisorEvent {
	const validated = validateSupervisorEvent(value);
	if (validated.ok === false) throw new Error(validated.error);
	return validated.value;
}

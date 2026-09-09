/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Public tools:
 *   - subagent: { prompt, description, subagent_type?, isolation? }
 *   - subagent_chain: { chain: [{ prompt, description }, ...] }
 *   - subagent_abort: { agentId, runId }
 *   - subagent_resolve: { agentId, runId }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	ChildProcessTracker,
	type ChildProcessDrainResult,
} from "./child-process-tracker.ts";
import { JSONLChunkScanner, projectToolResultMessageForParent } from "./rpc-stream.ts";
import {
	compactFileChangeFromArgs,
	compactFileChangeFromPartial,
	stringifyCompactFileChange,
} from "./file-change-bridge.ts";
import { checkedSubagentOverrideModel } from "./model-ref.ts";
import {
	detectForkOpportunity,
	forkSpawnArgs,
	formatForkOpportunityAdvisory,
	resolveFork,
	type ForkOpportunity,
} from "./fork-policy.ts";
import {
	ContinuityAdvisoryLedger,
	detectContinuityTarget,
	detectFindingsHandoff,
	extractPathAnchors,
	formatContinuityAdvisory,
	formatFindingsHandoffAdvisory,
	summarizeFindingsHead,
	type ContinuityMatch,
	type ContinuityPrior,
	type FindingsHandoff,
} from "./worker-continuity.ts";
import { bossWriteSet, formatBossWriteOverlapWarning } from "./boss-write-set.ts";
import { applySessionMountsToWorkerEnv } from "../../extensions/secret-vault-core.ts";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	AgentSession,
	CONFIG_DIR_NAME,
	createAgentSession,
	DefaultResourceLoader,
	ExtensionRunner,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
	ModelRuntime,
	SessionManager,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	DEFAULT_PROGRESS_LOG_REPORT_MS,
	claimProgressLogReport,
	consumeProgressLogExcerpt,
	formatProgressLogReport,
	formatProgressLogRetargetReceipt,
	describeProgressChannelForStall,
	progressIdleMs,
	readProgressLogTail,
	releaseProgressLogReport,
	resolveProgressLogPath,
	retargetProgressLog,
	sampleProgressLog,
	sanitizeProgressReportSecs,
	type ProgressLogSample,
} from "./progress-log.ts";
import {
	buildWatchFingerprint,
	createWatchRegistry,
	sanitizeWatchIntervalSecs,
	sanitizeWatchTarget,
	WATCH_ACTIONS,
	type WatchTickEvent,
} from "./watch-registry.ts";
import { adoptGrokBuildDispatch, makeStrictJsonSchema, omitNulls, bindSanitizeStrictToolArguments } from "./strict-json-schema.ts";
import {
	cleanScope,
	clearRunningDispatchScope,
	formatDispatchScopeWarning,
	recordRunningDispatchScope,
} from "./scope-overlap.ts";
import {
	computeScopeDrift,
	planDriftAdvisoryFor,
	publishPlanAdherenceSeam,
	readActivePlanTasks,
	recentPlanDriftSignals,
	type PlanAdherenceJob,
	type PlanDriftCandidate,
} from "./plan-drift.ts";
import {
	type AgentConfig,
	type AgentScope,
	discoverAgents,
	discoverBundledAgentsFromDirectory,
	dispatchToolPatch,
	extensionToolOwnership,
	formatAgentDiagnostics,
	installExtensionToolOwnershipCapture,
	mountedExtensionIdsFromEnv,
} from "./agents.ts";
import { registerMainSessionCompactionHook } from "./main-compaction.ts";
import { registerMidTurnCompactionGuard } from "./mid-turn-compaction.ts";
import { registerFollowUpCompactionGuard } from "./follow-up-compaction.ts";
import { registerFatalHookPropagation } from "./fatal-hook.ts";
import {
	formatFindingsIndexBlock,
	listFindings,
	writeFindingsArtifact,
} from "./findings-artifact.ts";
import {
	classifyWorkerRecovery,
	extractReconFootprint,
	formatFreshEpisodeReminderLines,
	formatRecoveryReport,
	writeRecoveryCheckpoint,
	type RecoveryDecision,
} from "./recovery-classification.ts";
import { registerSessionRecallTool } from "./session-recall.ts";
import {
	resolveSubagentToolSelection,
	resolvePipiUIExtensionRouting,
	selectPipiUIExtensionRoutes,
	sanitizeDisabledToolNames,
	isDelegationTool,
	hideGenericWebSearchForModelRef,
	diagnoseWorkerReadToolOmissions,
	formatWorkerReadToolOmissions,
	resolveWorkerSkillLoaderPath,
	workerSkillLoaderMountArgs,
} from "./desktop-tool-policy.mjs";
import {
	alarmRetryDue,
	deliveryRetryDue,
	formatUnacknowledgedAlarmLines,
	holdConfirmedDoneDelivery,
	DeliveryObligationStore,
	type DeliveryObligation,
} from "./delivery-obligation.ts";
import {
	acknowledgeBossAlarm,
	formatBossAlarmMessage,
	VolatileBossAlarmStore,
} from "./boss-alarm.ts";
import {
	decideAdjacentStatusSnapshot,
	formatResumableSectionLines,
	formatUnfilteredOmissionNote,
	selectUnfilteredJobs,
	UNFILTERED_RESUMABLE_CAP,
} from "./job-status-list.ts";
import { isUnfilteredStatusQuery, StatusPollGuard } from "./status-poll-guard.ts";
import {
	formatOrphanRecoveryNotice,
	selectOrphanedSlices,
	SUBAGENT_ORPHANED_CUSTOM_TYPE,
} from "./orphan-recovery.ts";
import {
	admitSignal,
	classifyRuntimeSignal,
	sessionActivity,
} from "./signal-admission.ts";
import {
	completionObservations,
	completionObservationMatches,
	completionPersistenceState,
	queueCompletionAfterCutIn,
} from "./completion-notification.ts";
import { NestedBackgroundLifecycle } from "./nested-background-lifecycle.ts";
import {
	createResidentRpcShutdownWaker,
	residentRpcShutdownWakeStatusKey,
} from "./resident-rpc-wake.ts";
import {
	createFileSupervisorStateStore,
	createHostSupervisorDelivery,
	createPiSupervisorSessionFactory,
	serializeBossEscalation,
	supervisorResourceLoaderFlags,
	supervisorSessionStatePath,
	type HostSupervisorDelivery,
	type SupervisorDeliveryRequest,
	type SupervisorJobSnapshot,
	type SupervisorTaskManifest,
	type SupervisorTerminalReport,
} from "./supervisor/index.ts";
import {
	classifySupervisorHostAdmission,
	createSupervisorOwnedTerminalCloseout,
	supervisorBossObligationNamespace,
	supervisorDeliveryArmsAlarm,
	type SupervisorHostAdmission,
} from "./supervisor/host-seam.ts";
import { SupervisorWaveIdentityTracker, summarizeSupervisorRuntimeWave } from "./supervisor/wave-identity.ts";
import {
	claimStallNotification,
	confirmStallNotification,
	deliverStallWake as deliverStallWakeThrough,
	formatBlockedMessage,
	formatStallMessage,
	planHeldSignalFlush,
} from "./stall-notification.ts";
import {
	contextAboveIdleFoldWatermark,
	createIdleFoldRegistry,
	idleFoldConfigFromEnv,
	runDeterministicIdleFold,
	type IdleFoldRegistry,
	type IdleFoldUsage,
} from "./idle-fold-timer.ts";
import {
	contextFoldIsStandby,
	contextManageTool,
	handleIdleFoldNudge,
	restoreNudgeThinking,
	shouldRegisterContextManageTool,
} from "./context-manage.ts";
import {
	formatSecretaryCommitResult,
	runSecretaryCommit,
} from "./secretary-commit.ts";
import { secretaryToolCallBlock } from "./secretary-policy.ts";
import {
	type VerifyAttestation,
	truncateTextHead,
	formatVerifyExit,
	formatVerifyLine,
	verifiedStateFor,
	doneCapForResult,
	formatSubagentDoneMessage,
	formatSubagentInterruptedMessage,
	type WaveSnapshot,
	formatChainVerifyPrefix,
	getFinalOutput,
	isFailedResult,
	isHostEndOk,
	getResultOutput,
} from "./done-message.ts";
import {
	beginWave,
	type LedgerTaskStatus,
	recordCloseoutDisposition,
	recordTaskDispatch,
	recordTaskTerminal,
	seedBossLedger,
} from "./boss-ledger.ts";
import { bossLedgerNoteTool } from "./boss-note.ts";
import {
	type DispatchedBrief,
	contextDocPath,
	contextDocTool,
	detectRepeatedBrief,
	formatRepeatedBriefNudge,
} from "./context-doc.ts";

/** Briefs dispatched in the current Boss turn, for shared-context detection. Reset per turn. */
const turnDispatchedBriefs: DispatchedBrief[] = [];
/** One shared-context nudge per turn: the point lands once, and a wave is not a lecture. */
let turnRepeatNudged = false;
/** Bound the per-turn memory; a very wide wave must not grow this without limit. */
const TURN_BRIEF_MEMORY = 24;
import {
	acquireAgentLease,
	releaseAgentLease,
} from "./agent-lease.ts";
import { resolveAgentSessionRoot } from "./agent-session-root.ts";
import {
	requestGitStatusPorcelainV1,
	requestGitWorktreePlacementV1,
} from "../../extensions/git-capability/agent/worktree-service.ts";
import {
	type DependencyState,
	DispatchQueueV1,
	formatQueuedDispatches,
	resolveDispatchConcurrency,
} from "./dispatch-queue.ts";
import {
	formatInFlightWorkersBlock,
	nextInFlightInjection,
	type InFlightWorkerView,
} from "./inflight-prompt.ts";
import {
	bindWorktreeMergedHook,
	closeoutDispositionFor,
	finalizeWorktreeIfOwned,
	lifecycleForFinalization,
	reenterFinalizeOnBossAccept,
	summarizeFinalization,
	terminalStateForFinalization,
	type WorktreeLifecycleProjectionV1,
} from "./worktree-finalize.ts";
import {
	dependentStepIntegrationProblem,
	formatCompactSubagentIntegrationStatus,
	formatSubagentIntegrationStatus,
	integrationDependencyAdmission,
	type SubagentIntegrationState,
} from "./integration-status.ts";
import {
	WorktreeRecoveryStoreV1,
	scheduleWaitingForMainRetry,
	scheduleWorktreeRecovery,
	worktreeRecoveryStorePath,
	type WorktreeRecoveryAction,
} from "./worktree-recovery.ts";
import { maybeMergeBoundSessionAfterSecretary } from "./session-merge-trigger.ts";
import type { WorktreeFinalizationStateV1 } from "../../extensions/git-capability/host/worktree/schema.ts";
import type { WorktreeMergedEventV1 } from "../../extensions/git-capability/host/worktree/service.ts";
import { resolveVerifyTimeoutMs } from "../../extensions/git-capability/host/worktree/deadlines.ts";
import {
	BaseAdvanceDeduper,
	createTipPreflightTracker,
	evaluateBaseAdvanceAlerts,
	formatBaseAdvancedSignal,
	formatPreflightConflictSignal,
} from "../../extensions/git-capability/host/worktree/preflight.ts";
import {
	advanceSemanticProgress,
	childReceivesDelegationTools,
	configuredHeartbeatAt,
	createSemanticProgressState,
	createRunScopedTimeout,
	decideDispatchBackground,
	decideRuntimeBudgetExpiry,
	decideStallWatchdogAction,
	GENERAL_PURPOSE_SEMANTIC_TURN_CAP,
	normalizeGeneralPurposeExecutionPolicy,
	rejectDispatchAtDepth,
	rejectNestedDelegationTypes,
	resolveEffectiveSubagentDepth,
	resolveSubagentMaxDepth,
	runtimeRolePolicyForAgent,
	type SemanticProgressState,
} from "./runtime-policy.ts";
import { prepareSubagentMemoryTask } from "./memory-policy.ts";
import { registerSubagentManagementTool } from "./agent-management.ts";
import {
	ASK_BOSS_GUIDANCE,
	ASK_BOSS_TOOL_NAME,
	QUESTION_DIR_ENV,
	formatQuestionForBoss,
	pendingQuestions,
	questionRunDir,
	registerAskBossTool,
	registerSubagentReplyTool,
	removeQuestionRun,
	resolveAskBossTimeoutMs,
	summarizeQuestionRun,
	type QuestionRunSummary,
} from "./boss-question.ts";
import {
	TOOL_BUDGET_ENV,
	USAGE_BUDGET_SAFE_POINT_GRACE_MS,
	createToolBudgetTracker,
	decodeToolBudgetEnv,
	encodeToolBudgetEnv,
	evaluateUsageBudget,
	formatToolBudgetSoftNudge,
	formatUsageBudgetAbortReason,
	formatUsageBudgetSoftNotice,
	parseToolBudget,
	parseUsageBudget,
	summarizeToolBudget,
	type ToolBudget,
	type ToolBudgetState,
	type UsageBudget,
	type UsageBudgetState,
} from "./tool-budget.ts";
import { isAnthropicModelRef, prepareSanitizedForkSource } from "./fork-sanitize.ts";
import {
	encodeAgentEventBridgeRequestV1,
	encodeModelPinValidateBridgeRequestV1,
	parseModelPinValidateDecisionV1,
	PIPIUI_HOST_PROTOCOL_V1,
	type AgentBridgeEventPayloadV1,
	type ModelPinValidateDecisionV1,
} from "./host-bridge.ts";
import { applyCappedStreamText } from "./stream-part-text.ts";
import {
	type CpuSample,
	type LivenessVerdict,
	classifyCpuProgress,
	formatCpuEvidence,
	isQuietToolStalled,
	readProcessTable,
	sampleSubtreeCpu,
} from "./worker-liveness.ts";
import {
	type StallDiagnosticsState,
	classifyWatchdogProbe,
	createStallDiagnosticsState,
	formatDiagnosticsCompactLine,
	ioByteLength,
	logStallProbe,
	noteDiagnosticsAbort,
	noteDiagnosticsChildExit,
	noteDiagnosticsCpuSample,
	noteDiagnosticsIo,
	noteDiagnosticsToolEnd,
	noteDiagnosticsToolStart,
	preferSpecificExitReason,
	recordWatchdogDecision,
	snapshotStallDiagnostics,
} from "./stall-diagnostics.ts";
import {
	type AgentFinalizationPhase,
	applyFinalizationTransition,
	noteFinalizationDetails,
	resetFinalizationFields,
} from "./finalization-phase.ts";
import { setCloseoutTimelineDir } from "./closeout-timeline.ts";
import { createChildExitTimelineProbe } from "./child-exit-probe.ts";
import {
	DEFAULT_REPORT_DRAIN_BUDGET_MS,
	DEFAULT_TERMINAL_REPORT_BUDGET_MS,
	closeoutPhaseError,
	createChildExitCloseout,
	createCloseoutReportQueue,
	createTimeoutAbort,
	createWorktreePhaseProber,
	isSupersededCloseoutReport,
	logCloseoutProbe,
	readonlyChildExitGraceMs,
	runAbortableRetries,
	settleCloseoutWait,
	writableChildExitGraceMs,
} from "./closeout.ts";
import {
	type ActiveTool,
	activeToolForContentIndex,
	boundActivitySummary,
	latestActiveTool,
	removeActiveTool,
	summarizeActiveToolArgs,
	upsertActiveTool,
} from "./active-tools.ts";
import {
	applyToolResultEvent,
	readAssistantToolCall,
} from "./assistant-tool-call.ts";
import {
	createUsageEmitter,
	type StreamingUsageSnapshot,
} from "./streaming-usage.ts";

const MAX_PARALLEL_TASKS = 1000;
/**
 * Concurrent workers. This was 1000, which is not a limit — it was a bet that no boss would ever
 * dispatch enough work to matter, and the fan-out layer now tells the boss to dispatch widely on
 * purpose. Anything past the limit is held by the dispatch queue and starts when a slot frees.
 */
const MAX_CONCURRENCY = resolveDispatchConcurrency();
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

type DispatchStatsMode = "single" | "tasks" | "chain";

type DispatchStatsTask = {
	agent: string;
	task: string;
	title?: string;
	/** Whether this dispatch asked to start from a copy of the Boss's conversation. */
	fork?: boolean;
};

type DispatchValidatorAction = "nudge" | "enforce";

type DispatchValidatorFinding = {
	/** tasks[] index, or 0 for single-mode brief. */
	taskIndex: number;
	briefItems: number;
	/** Short human-readable split hint (list item previews). */
	splitHint: string;
};

type DispatchValidatorStats = {
	triggered: true;
	action: DispatchValidatorAction;
	findings: Array<{ task_index: number; brief_items: number }>;
};

/** Heuristic only: count brief lines that look like list items. */
function estimateBriefItems(brief: string): number {
	return brief.split(/\r?\n/).filter((line) => /^\s*([-*•]|\d+[.)])\s/.test(line)).length;
}

/** List-item line body capture (same bullet/number forms as estimateBriefItems). */
const DISPATCH_LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

/**
 * Heuristic serial-dependency cues. When these dominate the brief, a long list is
 * more likely one ordered workflow than independent parallel goals — do not flag.
 */
const DISPATCH_SERIAL_SIGNAL_RE =
	/先|然后|接着|其次|之后|基于|再|随后|最后|\bfirst\b|\bfinally\b|\bbefore\b|\bafter\b|\bthen\b|\bnext\b|\bonce\b|\bbased\s+on\b|\bdepending\s+on\b|\bfollowed\s+by\b|\bstep\s*\d/gi;

/**
 * Heuristic independent-goal cues inside list lines / free text:
 * action-ish openers and multi-goal conjunctions (和/以及/并且/+ /and /also).
 * Not a parser — false positives/negatives are expected; default behavior is nudge-only.
 */
const DISPATCH_ACTIONISH_RE =
	/^(实现|添加|增加|修复|检查|验证|更新|删除|创建|修改|重构|测试|调研|调查|审查|write|add|fix|check|verify|update|delete|create|implement|test|review|investigate|build|run|refactor|ensure|confirm)\b/i;
const DISPATCH_INDEPENDENT_CONJ_RE = /以及|并且|\+|\band\b|\balso\b|和/g;

function countRegExpMatches(text: string, re: RegExp): number {
	const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
	const global = new RegExp(re.source, flags);
	return [...text.matchAll(global)].length;
}

function listItemBodies(brief: string): string[] {
	const bodies: string[] = [];
	for (const line of brief.split(/\r?\n/)) {
		const m = DISPATCH_LIST_ITEM_RE.exec(line);
		if (m?.[1]?.trim()) bodies.push(m[1].trim());
	}
	return bodies;
}

/**
 * Heuristic: does this brief pack multiple independent goals into one worker?
 * All of the following must hold:
 *   1. brief_items >= 6 (same list-line heuristic as telemetry)
 *   2. independent enumeration signals (standalone-ish list rows and/or multi-goal conjunctions)
 *   3. serial dependency words do NOT dominate those independent signals
 */
function looksLikeMergedIndependentGoals(brief: string): {
	merged: boolean;
	briefItems: number;
	splitHint: string;
} {
	const briefItems = estimateBriefItems(brief);
	if (briefItems < 6) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const bodies = listItemBodies(brief);
	let independentItems = 0;
	let serialOnItems = 0;
	for (const body of bodies) {
		const serialOnLine = countRegExpMatches(body, DISPATCH_SERIAL_SIGNAL_RE);
		if (serialOnLine > 0) {
			serialOnItems += 1;
			continue;
		}
		// Standalone-ish row: action opener, sentence punctuation, or a substantial clause.
		const standalone =
			DISPATCH_ACTIONISH_RE.test(body) ||
			/[.!?。！？;；]$/.test(body) ||
			body.length >= 10;
		if (standalone) independentItems += 1;
	}

	const serialHits =
		countRegExpMatches(brief, DISPATCH_SERIAL_SIGNAL_RE) + serialOnItems;
	const conjHits = countRegExpMatches(brief, DISPATCH_INDEPENDENT_CONJ_RE);
	// Independent score: standalone list rows plus capped conjunction evidence.
	const independentScore = independentItems + Math.min(conjHits, 3);

	// Serial dominates → ordered workflow, not a merge anti-pattern.
	if (serialHits > 0 && serialHits >= Math.max(independentItems, 1) && serialHits >= independentScore / 2) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const hasIndependentSignal = independentItems >= 4 || (independentItems >= 3 && conjHits >= 1);
	if (!hasIndependentSignal && independentItems < 6) {
		return { merged: false, briefItems, splitHint: "" };
	}

	// Prefer flagging when most of the 6+ items look independently actionable.
	if (independentItems < 4 && briefItems >= 6 && independentScore < 4) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const preview = bodies
		.slice(0, 8)
		.map((b, i) => `${i + 1}) ${b.length > 60 ? `${b.slice(0, 60)}…` : b}`)
		.join("; ");
	return {
		merged: true,
		briefItems,
		splitHint: preview || `${briefItems} list items`,
	};
}

type DispatchShapeAssessment = {
	findings: DispatchValidatorFinding[];
	/** Prepended to successful tool results when nudge is active. */
	nudgeText: string;
	/** Full tool-result error body when enforce blocks the dispatch. */
	enforceError: string;
	stats: DispatchValidatorStats | null;
};

function dispatchValidatorMode(): "off" | "nudge" | "enforce" {
	if (process.env.PIPI_SUBAGENT_DISPATCH_ENFORCE === "1") return "enforce";
	if (process.env.PIPI_SUBAGENT_DISPATCH_NUDGE === "0") return "off";
	return "nudge";
}

/**
 * Pre-flight shape check for single / tasks[] dispatches.
 * - chain mode: never runs (caller skips)
 * - same-agentId resume (agentId set, fresh !== true): skipped per task / single
 * - default nudge: non-blocking reminder
 * - PIPI_SUBAGENT_DISPATCH_ENFORCE=1: block and ask for tasks[] / multiple dispatches
 * - PIPI_SUBAGENT_DISPATCH_NUDGE=0: disable even the reminder (unless enforce)
 */
function assessDispatchShape(input: {
	mode: "single" | "tasks";
	tasks: readonly { task: string; agentId?: string; fresh?: boolean; title?: string }[];
}): DispatchShapeAssessment {
	const empty: DispatchShapeAssessment = {
		findings: [],
		nudgeText: "",
		enforceError: "",
		stats: null,
	};
	const level = dispatchValidatorMode();
	if (level === "off") return empty;

	const findings: DispatchValidatorFinding[] = [];
	for (let i = 0; i < input.tasks.length; i++) {
		const t = input.tasks[i];
		// Resume / continue the same worker: do not second-guess an in-flight brief.
		const agentId = t.agentId?.trim();
		if (agentId && t.fresh !== true) continue;

		const verdict = looksLikeMergedIndependentGoals(t.task);
		if (!verdict.merged) continue;
		findings.push({
			taskIndex: i,
			briefItems: verdict.briefItems,
			splitHint: verdict.splitHint,
		});
	}
	if (findings.length === 0) return empty;

	const action: DispatchValidatorAction = level === "enforce" ? "enforce" : "nudge";
	const stats: DispatchValidatorStats = {
		triggered: true,
		action,
		findings: findings.map((f) => ({
			task_index: f.taskIndex,
			brief_items: f.briefItems,
		})),
	};

	const scopeLabel =
		input.mode === "single"
			? "single brief"
			: findings.length === 1
				? `tasks[${findings[0].taskIndex}] brief`
				: `${findings.length} tasks[] briefs`;
	const itemsLabel = findings.map((f) => f.briefItems).join(",");
	const splitLines = findings
		.map((f) =>
			input.mode === "single"
				? `- suggested split preview: ${f.splitHint}`
				: `- tasks[${f.taskIndex}] (${f.briefItems} items): ${f.splitHint}`,
		)
		.join("\n");

	if (action === "enforce") {
		return {
			findings,
			nudgeText: "",
			enforceError: [
				`Dispatch shape rejected (PIPI_SUBAGENT_DISPATCH_ENFORCE=1): expected parallel tasks[] / multiple dispatches, got merged ${input.mode === "single" ? "single" : "task brief"}.`,
				`Detected ${scopeLabel} with brief_items=[${itemsLabel}] that look like independent goals packed together.`,
				"missing: split independent goals into tasks:[{agent,task},…] (or multiple subagent calls) and re-send this turn.",
				"NEVER merge independent goals into one brief.",
				splitLines,
			].join("\n"),
			stats,
		};
	}

	const nudgeText = [
		`[dispatch-shape] Detected ${scopeLabel} with brief_items=[${itemsLabel}].`,
		"If these items are mutually independent, split them into tasks[] multi-element fan-out (or multiple dispatches) instead of one worker.",
		"Reference: NEVER merge independent goals into one brief.",
		splitLines,
		"",
	].join("\n");

	return { findings, nudgeText, enforceError: "", stats };
}

/** Best-effort, fire-and-forget dispatch-shape telemetry. Never affects a dispatch. */
function recordSubagentDispatchStats(
	mode: DispatchStatsMode,
	tasks: readonly DispatchStatsTask[],
	background: boolean,
	validator?: DispatchValidatorStats | null,
): void {
	try {
		const configuredPath = process.env.PIPI_SUBAGENT_STATS_PATH;
		const projectAgent = process.env.PI_CODING_AGENT_DIR || path.join(process.cwd(), ".pi", "agent");
		const statsPath =
			configuredPath === undefined
				? path.join(projectAgent, "subagent-stats.jsonl")
				: configuredPath.trim();
		if (!statsPath) return;

		const line = `${JSON.stringify({
			ts: new Date().toISOString(),
			pid: process.pid,
			depth: PIPIUI_DEPTH,
			mode,
			task_count: tasks.length,
			background,
			tasks: tasks.map((task) => ({
				agent: task.agent,
				title: task.title ?? null,
				brief_chars: task.task.length,
				brief_items: estimateBriefItems(task.task),
				fork: task.fork === true,
			})),
			...(validator ? { validator } : {}),
		})}\n`;
		void fs.promises
			.mkdir(path.dirname(statsPath), { recursive: true })
			.then(() => fs.promises.appendFile(statsPath, line, "utf8"))
			.catch(() => {});
	} catch {
		// Telemetry must remain completely isolated from dispatch.
	}
}

// ---- Pipi UI 集成：向 App 桥接服务上报 subagent 生命周期（无环境变量时完全静默） ----
const PIPIUI_PORT = process.env.PIPIUI_BRIDGE_PORT;
const PIPIUI_SESSION = process.env.PIPIUI_SESSION_KEY;
/** Host conversation id. Scopes durable slice rows to the session that dispatched them. */
const PIPIUI_SESSION_ID = process.env.PIPIUI_SESSION_ID;
const PIPIUI_SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;
const PIPIUI_HOST_PROTOCOL = process.env.PIPIUI_HOST_PROTOCOL;

export function vaultWorkerChildEnv(
	parent: NodeJS.ProcessEnv = process.env,
	extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return applySessionMountsToWorkerEnv({ ...parent, ...extra }, {});
}

function pipiuiChildProcessEnv(
	extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	const env = { ...vaultWorkerChildEnv(process.env, extra) };
	// A broker connection/capability is one dispatch generation only. Never let a
	// verifier, helper, or nested child inherit the main token or another run's
	// grant. The main extension re-adds this complete tuple only for this spawn.
	const memoryBrokerValues = Object.fromEntries(
		Object.entries(extra).filter(([key, value]) =>
			key === "PIPIUI_MEMORY_BROKER_MODE"
			|| key === "PIPIUI_MEMORY_BROKER_URL"
			|| key === "PIPIUI_MEMORY_BROKER_TOKEN"
			|| key === "PIPIUI_MEMORY_BROKER_CAPABILITY"
			|| key === "PIPIUI_MEMORY_PROJECT_ROOT"
			|| key === "PIPIUI_MEMORY_BROKER_PACKAGE_ROOT"
			|| key === "PIPIUI_MEMORY_BROKER_EXTENSION"
			|| key === "PIPIUI_MEMORY_BROKER_PACKAGE_VERSION"
			|| key === "PIPIUI_MAIN_CWD"
			? typeof value === "string" && value.length > 0
			: false,
		),
	);
	delete env.PIPIUI_MEMORY_BROKER_MODE;
	delete env.PIPIUI_MEMORY_BROKER_URL;
	delete env.PIPIUI_MEMORY_BROKER_TOKEN;
	delete env.PIPIUI_MEMORY_BROKER_CAPABILITY;
	delete env.PIPIUI_MEMORY_PROJECT_ROOT;
	delete env.PIPIUI_MEMORY_BROKER_PACKAGE_ROOT;
	delete env.PIPIUI_MEMORY_BROKER_EXTENSION;
	delete env.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION;
	Object.assign(env, memoryBrokerValues);
	// Desktop control lives only in the main session. The host may carry the
	// Computer Use capability for its own tools; a dispatched child never
	// inherits it.
	delete env.PIPIUI_COMPUTER_CAPABILITY;
	return env;
}
// 当前进程在 agent 树里的身份：主会话 depth=0，被派出的 subagent 由父进程注入
const PIPIUI_DEPTH = resolveEffectiveSubagentDepth(
	process.env.PIPIUI_AGENT_DEPTH,
	process.env.PIPIUI_AGENT_TREE_DEPTH,
);
const PIPIUI_PARENT = process.env.PIPIUI_AGENT_ID || null;
// Only a spawned worker that can itself delegate uses the resident RPC lifecycle.
// Leaf workers stay on the established one-shot JSON print path.
const PIPIUI_NESTED_RPC_PARENT = process.env.PIPIUI_NESTED_RPC_PARENT === "1";
/** Attempt-private transport token; never enters a prompt, report, or persisted state. */
const PIPIUI_RESIDENT_RPC_WAKE_TOKEN = process.env.PIPIUI_RESIDENT_RPC_WAKE_TOKEN || undefined;
// App-owned authoritative session root. Nested agents inherit it even when their own
// process cwd is an isolated worktree. When a Boss session is bound to a worktree this
// is that workspace; the canonical project root is PIPIUI_PROJECT_ROOT.
const PIPIUI_MAIN_CWD = process.env.PIPIUI_MAIN_CWD;
const PIPIUI_PROJECT_ROOT = process.env.PIPIUI_PROJECT_ROOT;
// Closeout timeline lives next to this project's own pi state, never the global ~/.pi.
// Disabled until here: workers without a main cwd stay silent by default.
setCloseoutTimelineDir(PIPIUI_MAIN_CWD ? path.join(PIPIUI_MAIN_CWD, ".pi", "agent") : undefined);
const PIPIUI_AGENT_ROLE = process.env.PIPIUI_AGENT_ROLE;
// 多层护栏：depth >= 上限的进程不允许再派 subagent（终端裸跑同样生效）
const PIPIUI_MAX_DEPTH = resolveSubagentMaxDepth(process.env.PIPIUI_AGENT_MAX_DEPTH);
// App 注入的补丁版 subagent 扩展目录；嵌套 spawn 时再传 `-e`，保持上报/护栏一致
const PIPIUI_SUBAGENT_EXT = process.env.PIPIUI_SUBAGENT_EXT;

/**
 * This extension's own directory. It owns the orchestration / fan-out / nested-dispatch
 * philosophy layers as well as the dispatch tools, so a spawned child has to be told where
 * that `layers/` directory is. Derived from `import.meta.url` rather than the env var above,
 * which is absent for a nested worker whose parent was itself a child.
 */
const SUBAGENT_EXT_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Boss's uncommitted paths, as an overlap participant. Workers branch from `HEAD` and
 * cannot see the working tree, so a dispatch aimed at a file the Boss has open produces either
 * a merge that fails or one that succeeds against a stale version. Advisory and fail-open: a
 * Git hiccup returns null and the dispatch proceeds exactly as it did before this existed.
 */
function currentBossWriteSet() {
	return bossWriteSet(PIPIUI_MAIN_CWD, () => requestGitStatusPorcelainV1(PIPIUI_MAIN_CWD));
}
// App-owned search guard; children load the same code and inherit the human-turn grant file.
const PIPIUI_SEARCH_SCOPE_EXT = process.env.PIPIUI_SEARCH_SCOPE_EXT;
// Managed pi-web-access supplies web_search, fetch_content, source_check, and
// get_search_content. Provider-hosted search may also reach workers through pi's own
// extension discovery; this pinned route makes research delegable for other providers.
const PIPIUI_WEB_ACCESS_EXT = process.env.PIPIUI_WEB_ACCESS_EXT;
const PIPIUI_CODING_TOOLS_EXT = process.env.PIPIUI_CODING_TOOLS_EXT;
// The philosophy package. Workers run with `--no-extensions`, so unless it is mounted here
// explicitly a dispatched child loads no philosophy at all — and every layer written for one
// (`craft` to whoever writes code, `research` to explore, `retrieval` to anything that reads
// code) silently reaches nobody, along with the model-scoped corrections. The scope markers
// below (PIPI_PHILOSOPHY_ROLE / _AGENT) address a package that has to be present to read them.
const PIPIUI_PHILOSOPHY_EXT = process.env.PIPIUI_PHILOSOPHY_EXT;
// The locked base system prompt. Like philosophy above, a worker runs with `--no-extensions`
// and builds its arguments here rather than through `assemblePiSpawn`, so the base reaches a
// child only because this path passes it on. It is the same file the main session gets — a
// worker-only variant would reopen the "which rule lives where" question the lock exists to
// close. The architecture half earns its keep here in particular: workers run on a narrowed
// tool set, so "the tools you were given are the whole truth" is aimed straight at them.
const PIPIUI_CORE_PROMPT = process.env.PIPIUI_CORE_PROMPT;
// Tool-free worker prompt observer. `pipiui-runtime-info` answers "what is in my system
// prompt?" for the main session, but it registers a tool and a worker's tool set is a
// curated allowlist — so the half of the fleet whose prompt is assembled here, by this file
// rather than by `assemblePiSpawn`, was the half nobody could inspect.
const PIPIUI_PROMPT_OBSERVER_EXT = process.env.PIPIUI_PROMPT_OBSERVER_EXT;

/** Where a dispatched child reports its assembled prompt. Bounded and swept by the observer. */
function promptDebugFile(agentId: string, run: string): string | undefined {
	if (!PIPIUI_MAIN_CWD || !PIPIUI_PROMPT_OBSERVER_EXT) return undefined;
	const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
	return path.join(PIPIUI_MAIN_CWD, ".pi", "agent-prompts", `${safe(agentId)}.${safe(run)}.json`);
}
const PIPIUI_OFFICE_DOC_SHOT_GATE_EXT = process.env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT;
// arXiv remains a specialized local Pi package. Role allowlists decide whether a
// child may call each mounted package tool.
const PIPIUI_ARXIV_EXT = process.env.PIPIUI_ARXIV_EXT;
// Automatic skill catalog/bootstrap stays off. An explicit skillloader mount may still
// register skill_search/skill_load; loading is never a mandatory gate.
const PIPIUI_SUBAGENT_SKILL_ISOLATION = process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION === "1";
const PIPIUI_SKILLLOADER_EXT = process.env.PIPIUI_SKILLLOADER_EXT;
// Read-only planners additionally cannot pull SKILL.md through the read tool.
const PIPIUI_SKILL_READ_BLOCK = process.env.PIPIUI_SKILL_READ_BLOCK === "1";

type MemoryBrokerChildRole = "worker";
type IssuedMemoryBrokerEnvironment = Record<string, string>;
type IssuedMemoryBrokerPackage = { root: string; extension: string; version: string };
type MainMemoryBrokerIssuer = ((input: {
	agentID: string;
	runID: string;
	role: MemoryBrokerChildRole;
}) => IssuedMemoryBrokerEnvironment | undefined) & {
	validateIssuedPackageIdentity?: (
		environment: Record<string, string | undefined>,
	) => { root: string; entrypoint: string; version: string } | undefined;
};

const MAIN_MEMORY_BROKER_ISSUER = Symbol.for("pipiui.memory-broker.issue-child-capability");
const memoryBrokerIssuerHost = globalThis as typeof globalThis & { [key: symbol]: unknown };
const RETRIEVAL_DISPATCHER = Symbol.for("pipiui.memory-broker.recall-before-subagent-dispatch");
type DispatchRetrieval = (input: { runId: string; project: string; text: string }) => Promise<{ context?: { items?: unknown[] } }>;

/** Optional shared main-memory recall; a failure must never delay a dispatch. */
async function advisoryMemoryForSubagent(runId: string, project: string, agentName: string, task: string): Promise<string> {
	try {
		const recall = memoryBrokerIssuerHost[RETRIEVAL_DISPATCHER];
		if (typeof recall !== "function") return task;
		const result = await (recall as DispatchRetrieval)({ runId, project, text: task });
		const items = result.context?.items;
		if (!Array.isArray(items) || items.length === 0) return task;
		return prepareSubagentMemoryTask(agentName, task, result.context);
	} catch {
		return task;
	}
}

function mainMemoryBrokerIssuer(): MainMemoryBrokerIssuer | undefined {
	const issuer = memoryBrokerIssuerHost[MAIN_MEMORY_BROKER_ISSUER];
	return typeof issuer === "function" ? issuer as MainMemoryBrokerIssuer : undefined;
}

/** Main-only capability issue. Absence/degradation remains optional-memory fail-soft. */
async function issueMemoryBrokerEnvironment(
	input: {
		agentID: string;
		runID: string;
		role: MemoryBrokerChildRole;
	},
): Promise<IssuedMemoryBrokerEnvironment | undefined> {
	try {
		return mainMemoryBrokerIssuer()?.(input);
	} catch {
		return undefined;
	}
}

/**
 * The live main package owns identity validation. There is deliberately no
 * local `../packages` or development-tree fallback: a stale, mismatched, or
 * missing identity removes only optional child memory.
 */
function issuedMemoryBrokerPackageForChild(
	environment: IssuedMemoryBrokerEnvironment,
): IssuedMemoryBrokerPackage | undefined {
	try {
		const identity = mainMemoryBrokerIssuer()?.validateIssuedPackageIdentity?.(environment);
		return identity
			? { root: identity.root, extension: identity.entrypoint, version: identity.version }
			: undefined;
	} catch {
		return undefined;
	}
}

function memoryBrokerExtensionPathForChild(
	environment: IssuedMemoryBrokerEnvironment,
): string | undefined {
	return issuedMemoryBrokerPackageForChild(environment)?.extension;
}

/**
 * Runtime state published by the pipi-philosophy extension for this exact pid, each turn.
 * Not the config file: the config says what the user asked for, this says what the composer
 * actually resolved after capability guards, role scope and layer dependencies.
 */
const PHILOSOPHY_STATE = path.join(os.tmpdir(), `pipi-philosophy-${process.pid}.json`);

/**
 * Is the fan-out invariant in effect for this process?
 *
 * That layer's premise is that workers run in the background and report through signals — a
 * boss that blocks on each dispatch is running a fake fan-out. So while the layer is on,
 * background stops being a per-call preference and becomes a runtime invariant, exactly like
 * the depth guard. The guard has to live here rather than in the prompt: session history shows
 * models passing background:false regardless of what the system prompt says.
 *
 * The layer itself is main-scoped (its prompt content addresses the boss), so a dispatched
 * worker's own state file never lists it — but the invariant must hold at every permitted
 * depth, or a nested `background:false` would stay a synchronous wait. The parent therefore
 * stamps its resolved state into every dispatched child's env (`PIPIUI_FANOUT_ACTIVE`, see
 * childEnvironmentInput), and each worker re-derives this function from it and re-stamps its
 * own children, so the invariant travels the whole delegation tree.
 *
 * Read fresh per call, so a Settings toggle applies from the next turn without a restart. No
 * state file and no inherited marker means the philosophy is not loaded here, and the old
 * caller-decides behaviour stands.
 */
export function fanoutLayerActive(): boolean {
	// Inherited from a fan-out-active parent: authoritative even though a worker's own
	// pid-scoped state file will never list the main-scoped layer.
	if (process.env.PIPIUI_FANOUT_ACTIVE === "1") return true;
	try {
		const state = JSON.parse(fs.readFileSync(PHILOSOPHY_STATE, "utf-8")) as {
			pid?: number;
			layers?: unknown;
			at?: number;
		};
		if (state.pid !== process.pid || !Array.isArray(state.layers)) return false;
		// Rewritten every turn, so anything old belongs to a dead process whose pid the OS
		// recycled — not to us.
		if (typeof state.at !== "number" || Date.now() - state.at > 3_600_000) return false;
		return state.layers.includes("fanout");
	} catch {
		return false;
	}
}

// 跟踪本扩展 spawn 出的子 pi：正常 shutdown 有界 TERM→KILL 并等待收割，
// process exit 保留不可等待的同步 TERM 兜底。
const pipiuiChildTracker = new ChildProcessTracker();

function pipiuiTrackChild(proc: ReturnType<typeof spawn>): void {
	pipiuiChildTracker.track(proc);
}

export function drainPipiuiTrackedChildren(
	graceMs = 2_000,
	killGraceMs = 2_000,
): Promise<ChildProcessDrainResult> {
	return pipiuiChildTracker.drain(graceMs, killGraceMs);
}

// Only hook `exit` (does not replace Node's default SIGTERM/SIGINT behavior).
// App-side PiProcess.terminate also SIGTERMs the process tree as a backstop.
process.on("exit", () => pipiuiChildTracker.terminateNow("SIGTERM"));

const PIPIUI_REPORT_TIMEOUT_MS = 5000;
type PipiuiAgentReport = AgentBridgeEventPayloadV1;

/**
 * The sole live agent-event emitter. It selects exactly one envelope for the
 * same /rpc endpoint: legacy flat Swift bridge by default, canonical v1 only
 * when the Electron host explicitly exported PIPIUI_HOST_PROTOCOL=1.
 *
 * Returns true when nothing remains to deliver (no host/no envelope, or the
 * bridge accepted the report); false only for transport/HTTP failure, which
 * lets terminal senders retry.
 */
const pipiuiReportQueue = createCloseoutReportQueue<PipiuiAgentReport>();

async function postPipiuiReport(payload: PipiuiAgentReport, signal?: AbortSignal): Promise<boolean> {
	if (!PIPIUI_PORT) return true;
	if (signal?.aborted) return false;
	if (pipiuiReportQueue.ignores(payload.agentId, payload.runId)) return true;
	if (isSupersededCloseoutReport(payload, runningAgents.get(payload.agentId)?.runId)) return true;
	const body = encodeAgentEventBridgeRequestV1(payload, {
		PIPIUI_HOST_PROTOCOL,
		PIPIUI_SESSION_KEY: PIPIUI_SESSION,
		PIPIUI_SESSION_CAPABILITY,
	});
	// Missing agentId/runId or a missing canonical capability fails closed. Never
	// send a second legacy fallback and never ask a host to infer a reusable run.
	// Both are deterministic config states — retrying cannot fix them.
	if (!body) return true;
	const timeout = createTimeoutAbort(PIPIUI_REPORT_TIMEOUT_MS, signal);
	try {
		if (timeout.signal.aborted) return false;
		if (pipiuiReportQueue.ignores(payload.agentId, payload.runId)) return true;
		const response = await fetch(`http://127.0.0.1:${PIPIUI_PORT}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: timeout.signal,
		});
		return response.ok;
	} catch {
		// Bridge reporting is observability, never a reason to crash the worker.
		return false;
	} finally {
		timeout.dispose();
	}
}

/**
 * Serialize every lifecycle report per bare agent ID. A fire-and-forget update
 * may otherwise complete after `end` and reopen a terminal row in hosts that
 * receive HTTP requests in completion order. The host still enforces terminal
 * monotonicity because network/process failures can drop or replay messages.
 * Timeout paths must abandon() so a late retry cannot POST into a reused run.
 */
function enqueuePipiuiReport(
	payload: PipiuiAgentReport,
	post: (payload: PipiuiAgentReport, signal?: AbortSignal) => Promise<unknown> = postPipiuiReport,
): Promise<void> {
	return pipiuiReportQueue.enqueue(payload, (item, signal) => {
		if (isSupersededCloseoutReport(item, runningAgents.get(item.agentId)?.runId)) return Promise.resolve();
		return post(item, signal);
	});
}

function abandonPipiuiReports(agentId: string, runId?: string): void {
	pipiuiReportQueue.abandon(agentId, runId);
}

function pipiuiReport(payload: PipiuiAgentReport): void {
	void enqueuePipiuiReport(payload);
}

/** A dropped terminal POST leaves a dead worker rendered as running forever — the
 *  host's orphan sweep skips sessions whose pi process is still alive. Bounded
 *  retries keep that row from sticking when the bridge hiccups. */
const TERMINAL_REPORT_RETRY_DELAYS_MS = [1_000, 3_000] as const;
async function postPipiuiReportWithRetry(payload: PipiuiAgentReport, signal?: AbortSignal): Promise<void> {
	const active = signal ?? new AbortController().signal;
	const result = await runAbortableRetries(
		(attemptSignal) => postPipiuiReport(payload, attemptSignal),
		active,
		TERMINAL_REPORT_RETRY_DELAYS_MS,
	);
	if (result === "exhausted") {
		console.error(
			`[pipiui-subagent] terminal bridge report dropped for agentId=${payload.agentId} after ${TERMINAL_REPORT_RETRY_DELAYS_MS.length + 1} attempts`,
		);
	}
}

function noteCloseoutLastPhaseError(agentId: string, runId: string | undefined, event: string, state: Parameters<typeof closeoutPhaseError>[1]): void {
	const error = closeoutPhaseError(event, state);
	if (!error || !runId) return;
	const phase = handleForRun(agentId, runId)?.diagnostics.finalizationPhase ?? "done-await-host";
	projectFinalizationPhase(agentId, runId, phase, { error });
}

/** The lease owner awaits the same ordered queue before it releases this agent ID. */
function postTerminalPipiuiReport(payload: PipiuiAgentReport): Promise<void> {
	const flight = enqueuePipiuiReport(payload, postPipiuiReportWithRetry);
	return settleCloseoutWait(flight, DEFAULT_TERMINAL_REPORT_BUDGET_MS, (state, elapsedMs) => {
		const error = closeoutPhaseError("end-report", state);
		logCloseoutProbe("end-report", {
			agent: payload.agentId,
			run: payload.runId,
			phase: "end-report",
			state,
			elapsedMs,
			...(error ? { error } : {}),
		});
		noteCloseoutLastPhaseError(payload.agentId, payload.runId, "end-report", state);
		if (state === "timeout") abandonPipiuiReports(payload.agentId, payload.runId);
	}).then((outcome) => {
		if (outcome.status === "timeout") abandonPipiuiReports(payload.agentId, payload.runId);
		else pipiuiReportQueue.seal(payload.agentId, payload.runId);
	});
}

async function awaitTerminalPipiuiReports(
	agentId: string,
	meta?: { run?: string; role?: string },
): Promise<void> {
	const outcome = await settleCloseoutWait(pipiuiReportQueue.drain(agentId), DEFAULT_REPORT_DRAIN_BUDGET_MS, (state, elapsedMs) => {
		const error = closeoutPhaseError("report-drain", state);
		logCloseoutProbe("report-drain", {
			agent: agentId,
			run: meta?.run,
			role: meta?.role,
			phase: "report-drain",
			state,
			elapsedMs,
			...(error ? { error } : {}),
		});
		if (state === "timeout") abandonPipiuiReports(agentId, meta?.run);
	});
	if (outcome.status === "timeout") abandonPipiuiReports(agentId, meta?.run);
}

// ---- Cut-in hold：GUI「插队」后，批量 join 的用户消息必须先进入 turn ----
// Swift（ChatSession.cutInQueueHead）在插队时写 marker 文件，joined prompt 发出后删除。
// 扩展见到新鲜 marker 时暂缓所有自动 followUp 投递（done/stall/heartbeat 都经
// trySendUserMessage），让 cut-in prompt 先赢下一个 turn；信号只晚一个 turn，绝不丢。
// 兜底释放：marker 超过 15s（Swift 崩溃 / 未发出）自动失效，或 input 事件见到真实
// 用户消息进 turn 时提前删除。
const PIPIUI_CUTIN_HOLD_MS = 15_000;
const PIPIUI_CUTIN_HOLD_FILE = PIPIUI_SESSION
	? path.join(os.tmpdir(), `pipiui-cutin-${PIPIUI_SESSION}.json`)
	: null;

function cutInHoldActive(): boolean {
	if (!PIPIUI_CUTIN_HOLD_FILE) return false;
	try {
		const raw = JSON.parse(fs.readFileSync(PIPIUI_CUTIN_HOLD_FILE, "utf-8")) as { at?: unknown };
		if (typeof raw.at !== "number") return false;
		return Date.now() - raw.at < PIPIUI_CUTIN_HOLD_MS;
	} catch {
		return false;
	}
}

/** Release the hold: called on a real user turn start; also clears stale markers. */
function releaseCutInHold(): void {
	if (!PIPIUI_CUTIN_HOLD_FILE) return;
	try {
		fs.unlinkSync(PIPIUI_CUTIN_HOLD_FILE);
	} catch {
		/* already gone */
	}
}

/** Block automatic delivery while a fresh cut-in hold marker exists (≤15s fallback). */
async function awaitCutInHoldRelease(): Promise<void> {
	if (!PIPIUI_CUTIN_HOLD_FILE || !cutInHoldActive()) return;
	const deadline = Date.now() + PIPIUI_CUTIN_HOLD_MS + 2_000;
	while (cutInHoldActive()) {
		if (Date.now() >= deadline) {
			releaseCutInHold();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

/** Plain summary for PipiUI bridge (no theme codes) — matches main-agent ToolCallSummary. */
const PIPIUI_EDIT_PAYLOAD_LIMIT = 20_000;

/**
 * Keep enough edit arguments for the native log to render a diff, while ensuring
 * the bridge never retains an unbounded tool payload. Every returned value is
 * complete JSON: oversized replacements are shortened or omitted as whole items.
 */
function boundedEditPayloadForUI(args: Record<string, unknown>): string {
	const rawPath = String(args.path ?? args.file_path ?? "");
	let path = rawPath;
	while (JSON.stringify({ path }).length > PIPIUI_EDIT_PAYLOAD_LIMIT && path.length > 0) {
		path = path.slice(0, Math.max(0, path.length - Math.ceil(path.length / 4)));
	}

	const source = Array.isArray(args.edits)
		? args.edits
		: [{ oldText: args.oldText, newText: args.newText }];
	const edits = source.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const edit = value as Record<string, unknown>;
		return typeof edit.oldText === "string" && typeof edit.newText === "string"
			? [{ oldText: edit.oldText, newText: edit.newText }]
			: [];
	});

	const retained: Array<{ oldText: string; newText: string }> = [];
	for (const edit of edits) {
		const full = [...retained, edit];
		if (JSON.stringify({ path, edits: full }).length <= PIPIUI_EDIT_PAYLOAD_LIMIT) {
			retained.push(edit);
			continue;
		}

		// Retain as much of the first overflowing replacement as fits, without
		// ever slicing serialized JSON (which would corrupt escaping/structure).
		if (JSON.stringify({ path, edits: [...retained, { oldText: "", newText: "" }] }).length
			> PIPIUI_EDIT_PAYLOAD_LIMIT) break;
		let low = 0;
		let high = edit.oldText.length + edit.newText.length;
		while (low < high) {
			const count = Math.ceil((low + high + 1) / 2);
			const oldCount = Math.min(edit.oldText.length, count);
			const candidate = {
				oldText: edit.oldText.slice(0, oldCount),
				newText: edit.newText.slice(0, Math.max(0, count - oldCount)),
			};
			if (JSON.stringify({ path, edits: [...retained, candidate] }).length <= PIPIUI_EDIT_PAYLOAD_LIMIT) {
				low = count;
			} else {
				high = count - 1;
			}
		}
		const oldCount = Math.min(edit.oldText.length, low);
		retained.push({
			oldText: edit.oldText.slice(0, oldCount),
			newText: edit.newText.slice(0, Math.max(0, low - oldCount)),
		});
		break;
	}
	return JSON.stringify(retained.length > 0 ? { path, edits: retained } : { path });
}

function summarizeToolArgsForUI(toolName: string, args: Record<string, unknown>): string {
	return summarizeActiveToolArgs(toolName, args) ?? "";
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	contextWindow?: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	/** Short title for UI display; falls back to task if omitted. */
	title?: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	/** PipiUI bridge / completion-signal id */
	agentId?: string;
	/** Dispatch generation; prevents a late terminal callback from contaminating a reused agentId. */
	runId?: string;
	/** Runtime-attested verify result (set when the brief carried `verify`). */
	verify?: VerifyAttestation;
	/** Brief carried `verify` but it was not run because the agent was aborted. */
	verifySkipped?: boolean;
	/** Brief carried `verify` for a read-only agent; the runtime dropped it as unattestable. */
	verifyDropped?: boolean;
	/** Attested scope-drift measurement (files outside declared scope); absent when not measured. */
	scopeDrift?: string[];
	/** Declared `deliverable: report`: the done message carries a report, capped higher. */
	reportsInFull?: boolean;
	/** Continued an existing worker's conversation instead of starting it cold. */
	resumed?: boolean;
	/** Parent-side tool-call count against the dispatch's toolBudget; absent when none was set. */
	toolBudget?: ToolBudgetState;
	/** Last evaluation of the dispatch's usageBudget against reported usage; absent when none was set. */
	usageBudget?: UsageBudgetState;
	/** The fork source needed signed Anthropic thinking stripped; absent for cold or clean forks. */
	forkSanitized?: { removedBlocks: number; touchedMessages: number; thinkingOff: boolean };
	/** ask_boss tally for the run; absent when the worker never asked. */
	bossQuestions?: QuestionRunSummary;
	/** Delivery state is orthogonal to the worker process outcome. */
	integrationState?: SubagentIntegrationState;
	worktreePath?: string;
	worktreeBranch?: string;
	worktreeFinalization?: string;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	/** True when tool returned immediately and completion arrives via [subagent-done] followUp */
	background?: boolean;
	agentIds?: string[];
	/** Invalid/duplicate package diagnostics from discovery; valid agents still remain usable. */
	agentDiagnostics?: string[];
}

interface RunSingleAgentOptions {
	/** Exact tool invocation that owns this run; null only for command-driven recovery. */
	toolCallId: string | null;
	/** When true, start report includes background flag; caller must not bind parent abort. */
	background?: boolean;
	/** Pre-assigned id (background path needs ids before process exits). */
	agentId?: string;
	/** Explicit logical parent for an internally orchestrated agent tree. */
	parentAgentId?: string | null;
	/** Explicit display depth paired with parentAgentId. */
	depth?: number;
	/** Short one-line title for the Subagents panel list; falls back to task text if omitted. */
	title?: string;
	/** Informational dependency tags (task/agentId short names); display-only. */
	blockedBy?: string[];
	/** Advisory write-set path prefixes for overlap warnings. */
	scope?: string[];
	/** Declared plan task slug this dispatch implements (plan-adherence seam / [plan-drift]). */
	planTask?: string;
	/** Current session model as `provider/id` (depth 0 `ctx.model`); used for「跟随主 Agent」. */
	sessionModel?: string;
	/** Model context window from the dispatching session; shown on the detail header. */
	contextWindow?: number;
	/** Optional Boss-selected thinking for this dispatch; never inherited from the Boss session. */
	thinking?: string;
	/** Raw per-dispatch model pin (`provider/id`) as supplied by the Boss; overrides role/session/frontmatter for this one run. */
	model?: string;
	/**
	 * Host-authoritative validation result for `model` (the batched model_pin_validate RPC).
	 * REQUIRED whenever `model` is set: runSingleAgent refuses a raw pin so no internal path
	 * can ever fall back to the long-demoted display snapshot. Omit both fields for the
	 * default resolution.
	 */
	modelPin?: ValidatedModelPin;
	/** Shell command the runtime runs in the agent's cwd after the process ends (attested verify). */
	verify?: string;
	/** Discard this worker's stored conversation and start it cold. */
	fresh?: boolean;
	/** Start this worker from a copy of the Boss's own conversation instead of cold (see fork-policy.ts). */
	fork?: boolean;
	/** Absolute path of the Boss session file a fork copies from; resolved by the tool layer from ctx. */
	forkSourceFile?: string;
	/** Keep this role's conversation even when it is read-only. Authority and memory are separate. */
	retainContext?: boolean;
	/** Host-owned absolute deadline surfaced to UIs; it never grants the child more runtime. */
	deadlineAt?: number;
	/** Host-observed model output used by a caller-owned bounded progress deadline. */
	onActivity?: () => void;
	/** Bundled general-purpose placement override; omission remains isolated. */
	worktree?: "isolated" | "none";
	/** Optional Boss reason when bundled general-purpose runs in a shared cwd. */
	noWorktreeReason?: string;
	/** Bundled general-purpose regular wall-clock check-in cadence. */
	heartbeatSecs?: number;
	/** Bundled general-purpose absolute wall-clock runtime limit from first child spawn. */
	timeoutSecs?: number;
	/** Raw per-dispatch tool-call budget; parsed (fail-closed) in runSingleAgent. See tool-budget.ts. */
	toolBudget?: unknown;
	/** Raw per-dispatch reported-usage budget; parsed (fail-closed) in runSingleAgent. See tool-budget.ts. */
	usageBudget?: unknown;
	/** Host-selected episode generation, used to bind runtime receipts to the visible child run. */
	runId?: string;
	/** Explicit bundled private skills; additive under --no-skills. */
	privateSkillPaths?: string[];
}

/**
 * This session's own JSONL path, the only thing a fork can copy from. Same accessor
 * `session_recall` uses: the live SessionManager first, then pi's env fallback for hosts that
 * expose one. Undefined for an ephemeral session, which fork-policy reports as a refusal.
 */
function bossSessionFile(ctx: unknown): string | undefined {
	const manager = (ctx as { sessionManager?: { getSessionFile?: () => string } } | undefined)?.sessionManager;
	try {
		const file = manager?.getSessionFile?.();
		if (typeof file === "string" && file.trim()) return file.trim();
	} catch {
		// A host without the accessor is not an error; fall through to the env fallback.
	}
	const fromEnv = process.env.PI_SESSION_FILE;
	return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : undefined;
}

/** Format ExtensionAPI ctx.model → `provider/id`. */
function formatCtxModel(model: { provider?: string; id?: string } | undefined | null): string | undefined {
	if (!model?.provider || !model?.id) return undefined;
	return `${model.provider}/${model.id}`;
}

function ctxContextWindow(model: { contextWindow?: number } | undefined | null): number | undefined {
	return typeof model?.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
		? model.contextWindow
		: undefined;
}

interface SubagentModelOverride {
	model: string;
	/** Explicit Pi `--thinking` level. Absent preserves the existing/default behavior. */
	thinking?: string;
}

interface SubagentModelChain {
	/** Ordered fallback chain; index 0 is the primary model. Never empty. */
	models: SubagentModelOverride[];
}

/**
 * Parse one agent override value into an ordered model chain. All three shapes are
 * compatible (must stay parse-compatible with the Swift side):
 * 1. legacy string `"provider/id"` → chain = [{ model }]
 * 2. `{ model, thinking? }` → chain = [{ model, thinking? }]
 * 3. `{ models: [{ model, thinking? }, ...] }` → ordered chain (invalid entries skipped)
 * Returns an empty array when nothing parseable — caller falls back to the main model.
 */
function parseSubagentModelChain(value: unknown): SubagentModelOverride[] {
	const parseEntry = (
		candidate: { model?: unknown; thinking?: unknown },
	): SubagentModelOverride | undefined => {
		if (typeof candidate.model !== "string" || !candidate.model.trim()) return undefined;
		const thinking =
			typeof candidate.thinking === "string" && candidate.thinking.trim()
				? candidate.thinking.trim()
				: undefined;
		return { model: candidate.model.trim(), ...(thinking ? { thinking } : {}) };
	};
	if (typeof value === "string" && value.trim()) {
		return [{ model: value.trim() }];
	}
	// Electron persists each role as the ordered chain itself. Keep this canonical
	// shape alongside Swift's legacy single entry and `{ models: [...] }` wrapper.
	if (Array.isArray(value)) {
		return value.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			const entry = parseEntry(item as { model?: unknown; thinking?: unknown });
			return entry ? [entry] : [];
		});
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const candidate = value as { model?: unknown; thinking?: unknown; models?: unknown };
		if (Array.isArray(candidate.models)) {
			const chain: SubagentModelOverride[] = [];
			for (const item of candidate.models) {
				if (item && typeof item === "object" && !Array.isArray(item)) {
					const entry = parseEntry(item as { model?: unknown; thinking?: unknown });
					if (entry) chain.push(entry);
				}
			}
			if (chain.length > 0) return chain;
		}
		const single = parseEntry(candidate);
		if (single) return [single];
	}
	return [];
}

/** Hot-read PipiUI settings JSON (UserDefaults mirror). Missing / empty = follow main.
 *
 * Legacy values are model strings; newer values are `{ model, thinking? }` or an ordered
 * fallback chain `{ models: [...] }`. Normalizing all shapes here lets a running extension
 * immediately see settings saved by the app.
 */
function loadSubagentModelOverrides(): Record<string, SubagentModelChain> {
	const files = Array.from(new Set([
		process.env.PIPIUI_SUBAGENT_MODELS_FILE,
		process.env.PI_CODING_AGENT_DIR
			? path.join(process.env.PI_CODING_AGENT_DIR, "pipiui-subagent-models-runtime.json")
			: undefined,
	].filter((file): file is string => !!file)));
	for (const file of files) try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const result: Record<string, SubagentModelChain> = {};
			for (const [agentName, value] of Object.entries(parsed)) {
				const chain = parseSubagentModelChain(value);
				if (chain.length > 0) result[agentName] = { models: chain };
			}
			return result;
		}
	} catch { /* Try the next canonical UI runtime before following main. */ }
	return {};
}

const PI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PI_THINKING_LEVELS_WITH_DEFAULT = new Set(["", ...PI_THINKING_LEVELS]);

type SubagentModelCapability = {
	/** True only when Swift received an explicit reasoning boolean from the model catalog. */
	capabilityKnown: boolean;
	/** Exact Swift `ThinkingCapability.allowedLevels` output; empty string means model default. */
	allowedLevels: string[];
};

/** Schema validation normally enforces this; keep direct/runtime callers from injecting junk. */
function normalizeTaskThinking(value: unknown): string | undefined {
	return typeof value === "string" && PI_THINKING_LEVELS.has(value.trim())
		? value.trim()
		: undefined;
}

/** `model:high` is Pi shorthand, not a distinct model id. */
function stripModelThinkingSuffix(modelRef: string): string {
	const colon = modelRef.lastIndexOf(":");
	if (colon <= 0) return modelRef;
	return PI_THINKING_LEVELS.has(modelRef.slice(colon + 1)) ? modelRef.slice(0, colon) : modelRef;
}

/**
 * Hot-read the compact Swift capability catalog. Swift has already applied the authoritative
 * `ThinkingCapability` rules, so Node only consumes the serialized allowed levels; it does not
 * reconstruct reasoning/thinkingLevelMap behavior here.
 */
function loadSubagentModelCapabilities(): Record<string, SubagentModelCapability> {
	const file =
		process.env.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE ||
		// Tolerate an early experimental name if a live extension was launched before an app update.
		process.env.PIPIUI_SUBAGENT_CAPABILITIES_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/subagent-model-capabilities.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const root = parsed as { m?: unknown; models?: unknown };
		const rawModels = root.m ?? root.models;
		if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) return {};

		const result: Record<string, SubagentModelCapability> = {};
		for (const [rawModel, rawEntry] of Object.entries(rawModels)) {
			const model = rawModel.trim();
			if (!model || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
			const entry = rawEntry as {
				r?: unknown;
				l?: unknown;
				reasoning?: unknown;
				levels?: unknown;
			};
			const reasoning = entry.r ?? entry.reasoning;
			const rawLevels = entry.l ?? entry.levels;
			const levels = Array.isArray(rawLevels)
				? Array.from(new Set(rawLevels.filter(
					(level): level is string =>
						typeof level === "string" && PI_THINKING_LEVELS_WITH_DEFAULT.has(level),
				)))
				: [];
			result[model] = {
				capabilityKnown: typeof reasoning === "boolean",
				allowedLevels: levels,
			};
		}
		return result;
	} catch {
		// Missing/unreadable catalog means capability is unknown, never permission to carry
		// Boss-selected thinking across a fallback.
		return {};
	}
}

function capabilityForSubagentModel(
	model: string,
	catalog: Record<string, SubagentModelCapability> = loadSubagentModelCapabilities(),
): SubagentModelCapability | undefined {
	return catalog[stripModelThinkingSuffix(model.trim())];
}

/** Env carrying the host-written available-model catalog; only the host sets it (never the child). */
const SUBAGENT_MODEL_CATALOG_FILE_ENV = "PIPIUI_SUBAGENT_MODEL_CATALOG_FILE";
/** Must match pi-backend's SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION. */
const SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION = 3;
type SubagentModelCatalog = { available: boolean; refs: string[] };
/**
 * Hot-read the host-written available-model DISPLAY cache. PRESENTATION ONLY: the Boss
 * prompt renders these refs as guidance, but NO dispatch acceptance ever consults this
 * file. An explicit pin is validated authoritatively over the host bridge
 * (`model_pin_validate`), answered from the backend's in-memory PinCatalogAuthority — so a
 * stale, torn, misaligned or failed cache write merely trims the advertised list while the
 * authority keeps deciding. Tombstones (`available:false`), unknown versions and unreadable
 * files render as "nothing advertised", never as permission to accept anything.
 */
export function loadSubagentModelCatalog(file: string | undefined = process.env[SUBAGENT_MODEL_CATALOG_FILE_ENV]): SubagentModelCatalog {
	if (!file) return { available: false, refs: [] };
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { available: false, refs: [] };
		const root = parsed as { version?: unknown; available?: unknown; models?: unknown };
		// A tombstone or a shape the host never wrote in this protocol generation means the
		// authoritative catalog is mid-refresh/unusable RIGHT NOW; advertise nothing rather
		// than showing models that may already be hidden or revoked.
		if (root.available === false) return { available: false, refs: [] };
		const version = typeof root.version === "number" ? root.version : undefined;
		if (version !== SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION) return { available: false, refs: [] };
		const models = root.models;
		if (!Array.isArray(models)) return { available: false, refs: [] };
		const refs: string[] = [];
		for (const entry of models) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			const id = typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.trim() : "";
			if (id && !refs.includes(id)) refs.push(id);
		}
		return { available: true, refs };
	} catch {
		// Unreadable cache is a stale/transient host state — advertise nothing.
		return { available: false, refs: [] };
	}
}

export type DispatchModelPinVerdict = { ok: true; model: string } | { ok: false; problem: string };
/**
 * Pure syntax contract for ONE Boss-supplied per-dispatch model pin — no host consultation,
 * no I/O, synchronous. A pin must be a well-formed provider-qualified ref WITHOUT Pi's
 * `model:level` shorthand (thinking goes through the separate `thinking` field).
 * Availability/authorization is decided exclusively by the host authority RPC below.
 */
export function dispatchModelPinSyntaxProblem(value: unknown): string | undefined {
	const label = 'model="provider/modelId"';
	if (typeof value !== "string") return `dispatch ${label} 必须是字符串，收到 ${typeof value}`;
	const ref = value.trim();
	if (!ref) return `dispatch ${label} 不能为空；省略该字段即可沿用用户当前模型选择。`;
	if (ref.length > 300) return `dispatch model 引用过长（${ref.length} > 300）`;
	if (/[\u0000-\u001f\u007f\s]/u.test(ref)) return `dispatch model 含空白或控制字符：“${JSON.stringify(value)}”`;
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return `dispatch model 必须使用精确的 provider/modelId 完整标识（缺少 provider）：${ref}`;
	// Pi 的 `model:level` 缩写不是另一个模型；thinking 走独立的 `thinking` 字段，保持 pin 精确。
	if (stripModelThinkingSuffix(ref) !== ref) {
		return `dispatch model 不能携带 thinking 后缀：“${ref}”。请使用纯 provider/modelId 并通过独立的 thinking 字段指定强度。`;
	}
	return undefined;
}

/** A pin that passed BOTH syntax checks and one named authoritative host validation. */
export type ValidatedModelPin = { ref: string; authorityRevision: number };

/**
 * Branded-pin resolution for runSingleAgent: undefined when no pin was supplied; otherwise
 * the exact validated ref. Refuses a RAW pin loudly so no internal caller can bypass the
 * batched host RPC or fall back to the long-demoted display snapshot.
 */
export function requireValidatedModelPin(
	model: unknown,
	modelPin: ValidatedModelPin | undefined,
): string | undefined {
	if (model === undefined || model === null) return undefined;
	const raw = typeof model === "string" ? model.trim() : "";
	if (!raw || !modelPin || modelPin.ref !== raw) {
		throw new Error(
			`internal: dispatch model “${String(model)}” 缺少 Host 权威校验结果（modelPin）；已拒绝执行以防旧目录回退。请通过 subagent 工具发起派发（其会先做一次批量权威校验）。`,
		);
	}
	return modelPin.ref;
}
export type DispatchPinBatchResult =
	| { ok: true; pins: Map<string, ValidatedModelPin> }
	| { ok: false; problem: string };

/** Loopback hard timeout for one pin-validation RPC; never retried (deny ≠ flap). */
const MODEL_PIN_VALIDATE_TIMEOUT_MS = 1500;
/** Matches the bridge/backend batch bound. */
const MAX_MODEL_PIN_REFS_PER_BATCH = 1000;

/**
 * One batched `/rpc model_pin_validate` round trip. Returns the parsed decision, or a
 * transport-shaped failure for EVERY non-decision outcome (missing env/capability, encoder
 * refusal, timeout, connection refused, HTTP error, malformed body). Canonical v1 only:
 * legacy bridges get no fallback and no disk read.
 */
async function requestModelPinValidation(
	refs: readonly string[],
): Promise<{ kind: "decision"; decision: ModelPinValidateDecisionV1 } | { kind: "transport" }> {
	const body = encodeModelPinValidateBridgeRequestV1(refs, {
		PIPIUI_HOST_PROTOCOL,
		PIPIUI_SESSION_KEY: PIPIUI_SESSION,
		PIPIUI_SESSION_CAPABILITY,
	});
	if (!body || !PIPIUI_PORT) return { kind: "transport" };
	const timeout = createTimeoutAbort(MODEL_PIN_VALIDATE_TIMEOUT_MS);
	try {
		const response = await fetch(`http://127.0.0.1:${PIPIUI_PORT}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: timeout.signal,
		});
		if (!response.ok) return { kind: "transport" };
		const decision = parseModelPinValidateDecisionV1(JSON.parse(await response.text()));
		return decision ? { kind: "decision", decision } : { kind: "transport" };
	} catch {
		return { kind: "transport" };
	} finally {
		timeout.dispose();
	}
}

/**
 * Validate every present pin of ONE tool call against the host authority in a SINGLE batched
 * RPC — all pins share one linearization point and one authority revision. Zero pins ⇒ zero
 * network activity and zero added latency. Any transport failure, host absence, timeout or
 * logical deny fails the WHOLE wave closed before reservations/worktrees/spawns — a pinned
 * run is never silently re-routed onto the default model, and the long-demoted display
 * snapshot is never consulted for acceptance.
 */
export async function validateDispatchModelPinsViaHost(
	items: ReadonlyArray<{ label: string; model?: unknown }>,
): Promise<DispatchPinBatchResult> {
	const present: Array<{ label: string; ref: string }> = [];
	for (const item of items) {
		if (item.model === undefined || item.model === null) continue;
		const problem = dispatchModelPinSyntaxProblem(item.model);
		if (problem) return { ok: false, problem: `${item.label}: ${problem}` };
		present.push({ label: item.label, ref: (item.model as string).trim() });
	}
	if (present.length === 0) return { ok: true, pins: new Map() };
	if (present.length > MAX_MODEL_PIN_REFS_PER_BATCH) {
		return { ok: false, problem: `[model_pin_batch_too_large] 一次 dispatch 最多校验 ${MAX_MODEL_PIN_REFS_PER_BATCH} 个 model pin（收到 ${present.length}）；整批未启动。` };
	}
	const refs = [...new Set(present.map((item) => item.ref))];
	const result = await requestModelPinValidation(refs);
	if (result.kind === "transport") {
		return {
			ok: false,
			problem: [
				"[model_pin_host_unavailable] 无法通过 Host 权威校验 dispatch model（bridge 不可达、超时、协议不符或响应无效）。",
				"显式 pin 绝不回退默认模型，也未启动任何任务 —— 请稍后重试、恢复 Host 连接后重试，或省略 model 沿用当前解析。",
			].join("\n"),
		};
	}
	const decision = result.decision;
	if (decision.decision === "deny") {
		if (decision.code === "catalog_unavailable") {
			return {
				ok: false,
				problem: decision.retryable
					? `[model_catalog_unavailable] 暂无法校验 ${present.length} 个 dispatch model pin：Host 权威模型目录正在刷新或暂时不可用。可等待目录恢复后重试，或省略 model 沿用默认解析；本次任务未启动。`
					: `[model_catalog_unavailable] dispatch model 校验请求无效，已拒绝；请省略 model 或修正后重试。`,
			};
		}
		const badRef = decision.invalidIndex !== undefined ? refs[decision.invalidIndex] : undefined;
		const offenders = present.filter((item) => item.ref !== undefined && item.ref === badRef);
		const targetRef = badRef ?? "(未知引用)";
		const offenderLabels = offenders.map((item) => item.label).filter(Boolean).join(", ");
		return {
			ok: false,
			problem: [
				`[model_unavailable] ${offenderLabels ? `${offenderLabels}: ` : ""}dispatch model “${targetRef}” 不在 Host 权威可用模型目录中（不可用、已被用户隐藏或已注销）。`,
				"整批任务均未启动；请从系统提示的 Available models 列表中选择精确 provider/id，修正后重试，或省略 model 沿用默认选择。",
			].join("\n"),
		};
	}
	const pins = new Map<string, ValidatedModelPin>(
		refs.map((ref) => [ref, { ref, authorityRevision: decision.authorityRevision }]),
	);
	return { ok: true, pins };
}

/** Host-written `provider/id` → effective nativeSearch map. Invalid/missing is empty. */
function loadNativeSearchCatalog(): Record<string, { tools?: unknown }> {
	const file = process.env.PIPIUI_SUBAGENT_NATIVE_SEARCH_FILE;
	if (!file) return {};
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, { tools?: unknown }>;
	} catch {
		return {};
	}
}

/** A fallback may inherit tool thinking only with explicit catalog proof. */
function modelExplicitlyAllowsThinking(model: string, thinking: string): boolean {
	const capability = capabilityForSubagentModel(model);
	return capability?.capabilityKnown === true && capability.allowedLevels.includes(thinking);
}

/**
 * Rewrite already-assembled spawn args for a fallback chain entry. Same session
 * (--session-id untouched): only --model / --thinking change. An entry without an
 * explicit thinking level removes --thinking instead of keeping the previous one.
 */
function rewriteSpawnModelArgs(args: string[], model: string, thinking: string | undefined): void {
	const modelValue = thinking ? stripModelThinkingSuffix(model) : model;
	const mi = args.indexOf("--model");
	if (mi >= 0 && mi + 1 < args.length) args[mi + 1] = modelValue;
	else args.push("--model", modelValue);
	const ti = args.indexOf("--thinking");
	if (ti >= 0 && ti + 1 < args.length) {
		if (thinking) args[ti + 1] = thinking;
		else args.splice(ti, 2);
	} else if (thinking) {
		args.push("--thinking", thinking);
	}
}

/**
 * Hot-read the composer / bottom-bar model written by Swift (`main-model.txt`).
 * Prefer this over a stale PIPIUI_MAIN_MODEL env from process spawn.
 */
function loadMainModelFile(): string | undefined {
	const file =
		process.env.PIPIUI_MAIN_MODEL_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/main-model.txt");
	try {
		const raw = fs.readFileSync(file, "utf-8").trim();
		return raw || undefined;
	} catch {
		return undefined;
	}
}

// Settings still store the group id `browser_*`; it now expands to the single `browser` tool.
const BROWSER_TOOL_NAMES = ["browser"];

/** Hot-read Settings → 工具开关 denylist. */
function loadDisabledTools(): Set<string> {
	const file = path.join(
		os.homedir(),
		"Library/Application Support/PipiUI/tool-skill-settings.json",
	);
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as { disabledTools?: unknown };
		const list = Array.isArray(parsed.disabledTools)
			? parsed.disabledTools.filter((x): x is string => typeof x === "string")
			: [];
		const out = new Set<string>();
		for (const name of list) {
			if (name === "browser_*") {
				for (const t of BROWSER_TOOL_NAMES) out.add(t);
			} else {
				out.add(name);
			}
		}
		return new Set(sanitizeDisabledToolNames(out));
	} catch {
		return new Set();
	}
}

/**
 * Resolve model for a subagent type:
 * 0. Explicit per-dispatch pin from the Boss tool call (already catalog-validated upstream)
 * 1. Explicit override in settings JSON
 * 2. Follow main (composer/bottom-bar): depth0 ctx.model → main-model.txt → PIPIUI_MAIN_MODEL
 * 3. agent.md frontmatter model
 *
 * The optional pin short-circuits every persisted/user resolution for exactly one dispatch;
 * callers validate it against the host model catalog before reaching here.
 */
export function resolveAgentModel(
	agentName: string,
	frontmatterModel: string | undefined,
	sessionModel: string | undefined,
	modelPin?: string,
): string | undefined {
	const pin = modelPin?.trim();
	if (pin) return pin;
	const overrides = loadSubagentModelOverrides();
	const explicit = overrides[agentName]?.models[0];
	if (explicit?.model) {
		return checkedSubagentOverrideModel(agentName, explicit.model);
	}
	const fileMain = loadMainModelFile();
	const main =
		(PIPIUI_DEPTH === 0 ? sessionModel : undefined) ||
		fileMain ||
		process.env.PIPIUI_MAIN_MODEL ||
		sessionModel;
	if (main && main.trim()) return main.trim();
	const fb = frontmatterModel?.trim();
	return fb || undefined;
}

/**
 * Initial candidate precedence is deliberately narrow: per-task tool thinking wins, then the
 * selected chain entry's persisted thinking, otherwise Pi/model default. There is no Boss
 * session-thinking input anywhere in this path.
 */
function resolveAgentThinking(agentName: string, taskThinking?: unknown): string | undefined {
	return normalizeTaskThinking(taskThinking) ?? loadSubagentModelOverrides()[agentName]?.models[0]?.thinking;
}

/**
 * A fallback can be reached after the Boss is no longer deciding. Carry its requested thinking
 * only when the Swift catalog explicitly proves that exact fallback supports it. Otherwise use
 * that candidate's own setting (including legacy/default behavior) rather than hard-passing an
 * incompatible `--thinking`. Existing entry settings remain untouched when catalog data is unknown.
 */
function resolveFallbackThinking(
	entry: SubagentModelOverride,
	taskThinking: unknown,
): string | undefined {
	const requested = normalizeTaskThinking(taskThinking);
	if (requested && modelExplicitlyAllowsThinking(entry.model, requested)) return requested;
	return entry.thinking;
}

/** Chain entry by index (0-based); undefined past the end or without an explicit override. */
function resolveAgentModelChainEntry(
	agentName: string,
	index: number,
): SubagentModelOverride | undefined {
	const entry = loadSubagentModelOverrides()[agentName]?.models[index];
	return entry ? { ...entry, model: checkedSubagentOverrideModel(agentName, entry.model) } : undefined;
}

/**
 * Pure dispatch-policy seam for the retry loop's model-switch step. A dispatch WITHOUT a
 * pin advances the user's persisted fallback chain exactly as before. A PINNED dispatch is
 * the Boss choosing one exact model for this run: when it fails the runtime retries that
 * same pinned model within the existing resume budgets and then fails loudly — it never
 * silently lands on another (user-default) model.
 */
export function chainAdvanceEntryFor(modelPin: string | undefined, agentName: string, nextIndex: number): SubagentModelOverride | undefined {
	return modelPin ? undefined : resolveAgentModelChainEntry(agentName, nextIndex);
}

/** Main-agent model to stamp onto child env so nested agents still「跟随主」. */
function inheritMainModel(sessionModel: string | undefined): string | undefined {
	const fileMain = loadMainModelFile();
	if (PIPIUI_DEPTH === 0) {
		return sessionModel || fileMain || process.env.PIPIUI_MAIN_MODEL || undefined;
	}
	return process.env.PIPIUI_MAIN_MODEL || fileMain || sessionModel || undefined;
}

function legacyModelThinking(model: string): string | undefined {
	const trimmed = model.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon <= 0) return undefined;
	const suffix = trimmed.slice(colon + 1);
	return PI_THINKING_LEVELS.has(suffix) ? suffix : undefined;
}

function formatAllowedThinking(capability: SubagentModelCapability | undefined): string {
	if (!capability) return "?";
	const levels = capability.allowedLevels.map((level) => level || "default").join("|") || "none";
	return capability.capabilityKnown ? levels : `${levels}?`;
}

function formatRoutingCandidate(
	entry: SubagentModelOverride,
	catalog: Record<string, SubagentModelCapability>,
): string {
	const configured = entry.thinking ?? legacyModelThinking(entry.model) ?? "default";
	return `${entry.model}{set=${configured};allow=${formatAllowedThinking(
		capabilityForSubagentModel(entry.model, catalog),
	)}}`;
}

/**
 * Retired computer-use role names. The bundled manifests are gone and desktop
 * control lives only in the main session, so a dispatch that still names one
 * fails with the route to the surviving tools instead of an "unknown agent".
 * Routing and settings must not advertise these names even if persisted keys remain.
 */
const RETIRED_COMPUTER_AGENT_NAMES = [
	"computer-use-leader",
	"computer-use",
	"computer-verifier",
	"computer-terminal",
] as const;

/**
 * Boss-only, hot-read dispatch reference. It is intentionally compact because it is appended to
 * the dynamic system prompt every turn: each route shows current primary/fallback candidates,
 * configured strength, and Swift-authoritative allowed levels. `?` means catalog capability is
 * unknown (the displayed persisted setting remains backward-compatible, but fallback tool
 * thinking will not be carried through it).
 */
export function formatSubagentModelRoutingBlock(): string | null {
	if (PIPIUI_DEPTH !== 0) return null;
	const overrides = loadSubagentModelOverrides();
	const catalog = loadSubagentModelCapabilities();
	let discovered: AgentConfig[] = [];
	try {
		discovered = discoverAgents(process.cwd(), "user").agents;
	} catch {
		// The routing reference is advisory; a transient directory read must never block a turn.
	}
	const byName = new Map(discovered.map((agent) => [agent.name, agent]));
	const names = Array.from(new Set([...byName.keys(), ...Object.keys(overrides)]))
		.filter((name) => !(RETIRED_COMPUTER_AGENT_NAMES as readonly string[]).includes(name))
		.sort();
	if (names.length === 0) return null;

	const followMain = loadMainModelFile() || process.env.PIPIUI_MAIN_MODEL;
	const routes = names.map((name) => {
		const configured = overrides[name]?.models;
		const agent = byName.get(name);
		const fallbackModel = followMain || agent?.model;
		const entries = configured ?? (fallbackModel
			? [{ model: fallbackModel, thinking: undefined }]
			: []);
		const chain = entries.length > 0
			? entries.map((entry) => formatRoutingCandidate(entry, catalog)).join(" -> ")
			: "unresolved";
		return `- ${name}${configured ? "" : " (follow-main)"}: ${chain}`;
	});
	// Boss-visible model pins must come from the one canonical host catalog (already filtered
	// by the user's hidden-model choices). Bounded so the per-turn prompt stays affordable.
	const modelCatalog = loadSubagentModelCatalog();
	const CATALOG_PROMPT_CAP = 50;
	const modelLines = modelCatalog.available
		? [
			"Available models (exact `model:\"provider/id\"` values for a single dispatch):",
			...modelCatalog.refs.slice(0, CATALOG_PROMPT_CAP).map((ref) => `- ${ref}`),
			...(modelCatalog.refs.length > CATALOG_PROMPT_CAP ? [`- ... +${modelCatalog.refs.length - CATALOG_PROMPT_CAP} more`] : []),
		]
		: [];
	return [
		"[Subagent model routing — hot-read]",
		"Optional task `thinking` is available on single, tasks[], and chain. Optional per-dispatch `model` overrides only that ONE dispatch and never changes user/role settings; omit `model` to follow the normal resolution above. A pinned model is checked against the Host's authoritative catalog at dispatch time — unavailable models are rejected loudly, never silently replaced. This list is a display cache and may briefly lag that authority.",
		"Priority without `model`: role settings primary/fallback chain → current session/main model → agent frontmatter. Never inherit Boss thinking.",
		...modelLines,
		"Priority for task thinking > current candidate set thinking > omit --thinking. On fallback, carry task thinking only when catalog explicitly allows it; otherwise use that fallback set thinking/default. `allow=?` or a trailing `?` means capability unknown.",
		...routes,
	].join("\n");
}


// Store cap for the pull path (`subagent_status full:true`). Must comfortably hold a
// whole explore/plan report: this is the only place the full text survives, and every
// done message advertises it as the escape hatch.
const JOB_RESULT_STORE_CAP = 32000;
const JOB_RESULT_DISPLAY_CAP = 8000;
/** Terminal history is bounded independently; running jobs are never pruning candidates. */
const MAX_TERMINAL_JOB_RECORDS = 1000;

// ---- Attested verify (system testimony): the runtime runs `verify` in the agent's cwd ----
const VERIFY_TAIL_CHARS = 2000;
const VERIFY_TAIL_LINES = 20;
/** Rolling collection cap while verify runs: retain only this tail so a chatty
 * command cannot buffer unbounded output for up to the configured verify timeout. */
const VERIFY_COLLECT_TAIL_CHARS = 64 * 1024;


function tailText(text: string, maxChars: number, maxLines: number): string {
	const trimmed = text.replace(/\s+$/g, "");
	if (!trimmed) return "";
	const lines = trimmed.split("\n");
	const sliced = lines.length > maxLines ? lines.slice(-maxLines) : lines;
	let out = sliced.join("\n");
	if (out.length > maxChars) out = out.slice(-maxChars);
	return out;
}

/** Run `bash -lc <command>` in cwd with a hard timeout; capture combined stdout+stderr tail. */
function runVerifyCommand(
	command: string,
	cwd: string,
	hooks?: { onSpawn?: (pid: number | undefined) => void },
): Promise<VerifyAttestation> {
	const timeoutMs = resolveVerifyTimeoutMs();
	return new Promise((resolve) => {
		let proc: ReturnType<typeof spawn>;
		try {
			// detached: own process group so a timeout can SIGKILL the whole group —
			// grandchildren holding the stdout pipe must not delay `close` (verify is
			// awaited before the "end" report, so a stuck descendant blocks done+merge).
			proc = spawn("bash", ["-lc", command], {
				cwd,
				shell: false,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: pipiuiChildProcessEnv(),
			});
			hooks?.onSpawn?.(proc.pid);
		} catch (err) {
			resolve({
				command,
				exitCode: null,
				timedOut: false,
				tail: `[verify spawn error: ${err instanceof Error ? err.message : String(err)}]`,
			});
			return;
		}
		let combined = "";
		let timedOut = false;
		// Rolling tail buffer: never retain more than VERIFY_COLLECT_TAIL_CHARS.
		const appendChunk = (chunk: string) => {
			combined += chunk;
			if (combined.length > VERIFY_COLLECT_TAIL_CHARS) {
				combined = combined.slice(-VERIFY_COLLECT_TAIL_CHARS);
			}
		};
		const killTimer = setTimeout(() => {
			timedOut = true;
			try {
				if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
				else proc.kill("SIGKILL");
			} catch {
				// Group kill failed (e.g. process already gone) — fall back to the direct pid.
				try {
					proc.kill("SIGKILL");
				} catch {
					/* ignore */
				}
			}
			// Destroy stdio so `close` fires even if a descendant still holds the pipes.
			try {
				proc.stdout?.destroy();
				proc.stderr?.destroy();
			} catch {
				/* ignore */
			}
		}, timeoutMs);
		proc.stdout?.on("data", (d) => {
			appendChunk(d.toString());
		});
		proc.stderr?.on("data", (d) => {
			appendChunk(d.toString());
		});
		proc.on("error", (err) => {
			clearTimeout(killTimer);
			appendChunk(`\n[verify spawn error: ${err.message}]`);
			resolve({
				command,
				exitCode: null,
				timedOut,
				tail: tailText(combined, VERIFY_TAIL_CHARS, VERIFY_TAIL_LINES),
			});
		});
		proc.on("close", (code) => {
			clearTimeout(killTimer);
			const timeoutNote = `[verify timed out after ${timeoutMs / 1000}s]`;
			let tail = tailText(combined, VERIFY_TAIL_CHARS, VERIFY_TAIL_LINES);
			if (timedOut) tail = tail ? `${tail}\n${timeoutNote}` : timeoutNote;
			resolve({ command, exitCode: timedOut ? null : code, timedOut, tail });
		});
	});
}


const emptyUsage = (): UsageStats => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
});

// ---- In-process job registry (model-visible via subagent_status; independent of App UI) ----
type JobState = "running" | "ok" | "failed" | "aborted" | "interrupted";

interface JobRecord {
	agentId: string;
	/** Unique dispatch/run identity; agentId may be deliberately reused for a later completion. */
	runId: string;
	name: string;
	task: string; // truncated summary
	/** Short UI title (optional). */
	title?: string;
	/** Informational dependency tags (task/agentId short names); display-only, no scheduler. */
	blockedBy?: string[];
	state: JobState;
	startedAt: number;
	endedAt?: number;
	activity?: string;
	cost?: number;
	turns?: number;
	/** Model this run actually started on (pin or resolved); updated only on a real model switch. */
	model?: string;
	/** Full-ish result text for status-by-id (capped) */
	resultText?: string;
	/** Runtime-attested verify (when the brief carried `verify`). */
	verify?: VerifyAttestation;
	/**
	 * [subagent-interrupted-reminder] pushes for terminal jobs that still hold stored context.
	 * 0/undefined = never nudged this terminal episode; max 2 then silence. Reset on re-dispatch.
	 */
	nudgeCount?: number;
	/** Timestamp of the last interrupted-reminder push; undefined/0 = never this episode. */
	lastNudgeAt?: number;
	/** A watchdog-only interrupted result may be corrected by this same run's real terminal callback. */
	interruptedProvisional?: boolean;
	/** Boss/user closeout for this failed/aborted/interrupted episode; state and verify stay intact. */
	closeoutDisposition?: "cleaned";
	closeoutReason?: string;
	closeoutAt?: number;
	/** Structured failure classification for reminder/fresh-episode routing (see recovery-classification.ts). */
	recovery?: RecoveryDecision;
	/** Checkpoint artifact written at a context/provider-poisoned boundary, when evidence existed. */
	recoveryCheckpoint?: string;
	worktreePath?: string;
	worktreeBranch?: string;
	integrationState?: SubagentIntegrationState;
	worktreeFinalization?: string;
	/** Declared plan task slug this dispatch implements; surfaced by the plan-adherence seam. */
	planTask?: string;
	/** Declared scope prefixes, persisted past dispatch so completion can attest drift against them. */
	scope?: string[];
	/** Completion attestation: worker-branch files outside the declared scope (empty = none measured). */
	scopeDrift?: string[];
}

interface InterruptedReminder {
	agentId: string;
	runId: string;
	nudgeSeq: number;
	text: string;
}

const jobRegistry = new Map<string, JobRecord>();
/** Queued reminder tokens are memory-only: restart never resurrects an old interrupted nudge. */
const pendingInterruptedReminders = new Map<string, InterruptedReminder>();
/** Immediate in-process reservations close the selector-to-dispatch await/confirmation gap. */
const localAgentReservations = new Set<string>();
/** IDs whose dispatch acceptance is still awaiting validation, before they enter the queue.
 *  Multi-owner on purpose: overlapping acceptances of one id each hold their own token, so
 *  releasing one claimant can never make the id read unknown while another is still pending. */
const pendingDispatchAcceptances = new Map<string, Set<symbol>>();

function interruptedReminderKey(agentId: string, runId: string, nudgeSeq: number): string {
	return `${agentId}\u0000${runId}\u0000${nudgeSeq}`;
}

function cancelInterruptedReminders(agentId: string, runId?: string): void {
	for (const [key, reminder] of pendingInterruptedReminders) {
		if (reminder.agentId === agentId && (runId === undefined || reminder.runId === runId)) {
			pendingInterruptedReminders.delete(key);
		}
	}
}

// ---- Stall watchdog + abort：运行中后台 job 的外部可触达句柄 ----
const STALL_THRESHOLD_MS = 120_000;
const STALL_WATCHDOG_INTERVAL_MS = 30_000;
/** Start CPU pairs one tick after silence so the stall pass has a verdict at 120s. */
const LIVENESS_SAMPLE_AFTER_MS = STALL_WATCHDOG_INTERVAL_MS;
/** Max automatic re-spawns after a retryable transport/API death (total runs = 1 + this). */
const AUTO_RESUME_MAX = 2;
/** Backoff before each auto-resume attempt (ms). Index 0 = first resume. */
const AUTO_RESUME_BACKOFF_MS = [5_000, 15_000] as const;
/** Spread retry waves across a +/-25% window instead of synchronizing thousands of workers. */
const AUTO_RESUME_JITTER_RATIO = 0.25;
/** Context size above which a final retryable failure gets a fresh-redispatch hint. */
const AUTO_RESUME_CONTEXT_HINT_TOKENS = 100_000;
/**
 * Observed successful provider waits peak at ~82s; recover before the 300s transport idle guard.
 * The guard is not reliable on its own: a silently-dropped proxied stream keeps the socket
 * ESTABLISHED and can outlive it, so this deadline also covers initial and mid-stream waits.
 */
const PROVIDER_WAIT_TIMEOUT_MS_DEFAULT = 120_000;
/**
 * Stalls arrive in clusters: one observed cluster resumed onto the same model and went
 * silent again inside three minutes. A single resume therefore always lands the second
 * stall on the user, so the budget covers a short bad patch instead of one dropped stream.
 */
const PROVIDER_WAIT_AUTO_RESUME_MAX = 3;
export function providerWaitDeadlineMs(env: Record<string, string | undefined> = process.env): number {
	const configured = Number.parseInt(env.PIPIUI_PROVIDER_WAIT_TIMEOUT_MS || "", 10);
	return Number.isFinite(configured) && configured > 0
		? configured
		: PROVIDER_WAIT_TIMEOUT_MS_DEFAULT;
}

type ProviderWaitPhase = "model-active" | "running-tool" | "awaiting-model" | "resident-idle";
type ProviderWaitTimer = ReturnType<typeof setTimeout>;

/**
 * Exact tool-batch tracker plus provider-wait deadline. Tool runs stay unguarded
 * (the child process owner supplies timeout termination), but every model wait
 * arms the deadline: the first byte after spawn, a stream that stops producing
 * deltas mid-flight, and the post-tool-result wait. A silently-dropped proxied
 * connection never errors at the transport layer — the socket stays ESTABLISHED
 * forever — so only this app-layer deadline recovers those hangs.
 */
export function createProviderWaitController(options: {
	model: string;
	deadlineMs?: number;
	schedule?: (callback: () => void, delayMs: number) => ProviderWaitTimer;
	cancel?: (timer: ProviderWaitTimer) => void;
	onPhase: (phase: ProviderWaitPhase) => void;
	onTimeout: () => void;
}) {
	let pending = new Set<string>();
	let currentPhase: ProviderWaitPhase = "model-active";
	let timer: ProviderWaitTimer | undefined;
	const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const cancel = options.cancel ?? clearTimeout;
	const deadlineMs = options.deadlineMs ?? providerWaitDeadlineMs();
	const clearTimer = () => {
		if (timer !== undefined) cancel(timer);
		timer = undefined;
	};
	const setPhase = (phase: ProviderWaitPhase) => {
		currentPhase = phase;
		options.onPhase(phase);
	};
	const armDeadline = () => {
		clearTimer();
		timer = schedule(() => {
			timer = undefined;
			if (currentPhase !== "running-tool") options.onTimeout();
		}, deadlineMs);
		(timer as { unref?: () => void })?.unref?.();
	};
	armDeadline();
	return {
		noteToolBatch(toolCallIds: string[]) {
			pending = new Set(toolCallIds.filter(Boolean));
			// No usable ids means no tool result will ever arrive to re-arm: either a
			// text-only turn, or a provider that emitted tool calls without ids. Clearing
			// unconditionally here disarmed the deadline for the rest of the run and left a
			// silently-dropped stream to hang until a human noticed, so keep it armed.
			if (pending.size === 0) {
				armDeadline();
				return;
			}
			clearTimer();
			setPhase("running-tool");
		},
		noteToolResult(toolCallId: string) {
			if (currentPhase !== "running-tool" || !pending.delete(toolCallId) || pending.size > 0) return;
			setPhase("awaiting-model");
			armDeadline();
		},
		noteAssistantActivity() {
			clearTimer();
			pending.clear();
			setPhase("model-active");
			armDeadline();
		},
		dispose: clearTimer,
		phase: () => currentPhase,
		suspendForResidentIdle() {
			clearTimer();
			pending.clear();
			setPhase("resident-idle");
		},
		resumeFromResidentIdle() {
			if (currentPhase !== "resident-idle") return;
			setPhase("model-active");
			armDeadline();
		},
		activity: () => currentPhase === "awaiting-model"
			? `工具结果已返回，等待 ${options.model || "model"} 响应…`
			: currentPhase === "model-active"
				? `等待 ${options.model || "model"} 流式输出超时（连接无新增数据）…`
				: currentPhase === "resident-idle"
					? "resident RPC parent is idle while accepted descendants run"
					: "",
	};
}

/** Provider stalls have their own one-resume budget and never enter model-fallback classification. */
export function decideProviderStallRecovery(input: {
	timedOut: boolean;
	wasAborted: boolean;
	resumeCount: number;
}): "not-provider-stall" | "aborted" | "resume" | "terminal-failed" {
	if (!input.timedOut) return "not-provider-stall";
	if (input.wasAborted) return "aborted";
	return input.resumeCount < PROVIDER_WAIT_AUTO_RESUME_MAX ? "resume" : "terminal-failed";
}
/** Context tokens at/above which the session is compacted before an auto-resume re-spawn. */
const AUTO_COMPACT_BEFORE_RESUME_TOKENS = 80_000;
/** Keep the most recent tokens across the compaction boundary (pi default keepRecentTokens). */
const AUTO_COMPACT_KEEP_TOKENS = 20_000;
/** Min chain messages for a compaction to be meaningful. */
const AUTO_COMPACT_MIN_MESSAGES = 3;
/** Max messages kept by compaction (bounds the walk when usage tokens are missing). */
const AUTO_COMPACT_MAX_MESSAGES = 12;
/** Current-dispatch task text kept verbatim in the auto-resume compaction summary. */
const AUTO_COMPACT_TASK_SUMMARY_CHARS = 4_000;
/** Image content size heuristic (chars) for the per-message token estimate. */
const AUTO_COMPACT_IMAGE_CHARS = 4_800;

/**
 * Transient network / upstream API failures worth auto-resuming the worker session.
 * Auth, billing, and unknown-agent failures are excluded first (not retryable).
 * Matching is lowercase substring — same spirit as pi-ai retry.js.
 */
function isRetryableWorkerError(text: string): boolean {
	const t = (text || "").toLowerCase();
	if (!t.trim()) return false;
	const nonRetryable = [
		"insufficient_quota",
		"quota",
		"billing",
		"credit balance",
		"invalid api key",
		"unauthorized",
		"401",
		"403",
		"unknown agent",
	];
	for (const s of nonRetryable) {
		if (t.includes(s)) return false;
	}
	const retryable = [
		"fetch failed",
		"connection error",
		"econnreset",
		"econnrefused",
		"etimedout",
		"socket hang up",
		"network",
		"timed out",
		"timeout",
		"429",
		"rate limit",
		"rate_limit",
		"overloaded",
		"500",
		"502",
		"503",
		"504",
		"internal error",
		"unavailable",
		"502 bad gateway",
	];
	for (const s of retryable) {
		if (t.includes(s)) return true;
	}
	return false;
}

/**
 * Quota/budget exhaustion worth switching to the next fallback model immediately.
 * Separate from isRetryableWorkerError: same-model retries cannot fix a depleted
 * quota, so these never consume the same-model resume budget. Lowercase substring.
 */
const QUOTA_FALLBACK_MARKERS = [
	"insufficient_quota",
	"quota exceeded",
	"allocated quota",
	"out of budget",
	"usage limit",
	"available balance",
	"billing",
];

function isQuotaLikeWorkerError(text: string): boolean {
	const t = (text || "").toLowerCase();
	if (!t.trim()) return false;
	for (const s of QUOTA_FALLBACK_MARKERS) {
		if (t.includes(s)) return true;
	}
	return false;
}

function jitteredRetryBackoffMs(baseMs: number, random = Math.random): number {
	const unit = Math.max(0, Math.min(1, random()));
	const multiplier = 1 - AUTO_RESUME_JITTER_RATIO + unit * AUTO_RESUME_JITTER_RATIO * 2;
	return Math.max(1, Math.round(baseMs * multiplier));
}
/** stall 复推节奏：boss 决定继续等时，最多 5 分钟沉默一次，不必等心跳。 */
const STALL_RENOTIFY_INTERVAL_MS = 5 * 60 * 1000;
/** 同一无活动片段最多推送首次 + 两次复推；有新活动后重新武装。 */
const STALL_RENOTIFY_MAX = 3;
/**
 * Terminal interrupted/aborted/failed jobs that still hold stored context: first boss reminder
 * after this many seconds idle in that state, then one re-nudge at the renudge threshold.
 * Override via PIPIUI_INTERRUPTED_NUDGE_SECS / PIPIUI_INTERRUPTED_RENUDGE_SECS.
 */
const INTERRUPTED_NUDGE_SECS_DEFAULT = 1200;
const INTERRUPTED_RENUDGE_SECS_DEFAULT = 3600;
function envPositiveSecs(name: string, fallback: number): number {
	const raw = Number.parseInt(process.env[name] || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
const INTERRUPTED_NUDGE_SECS = envPositiveSecs(
	"PIPIUI_INTERRUPTED_NUDGE_SECS",
	INTERRUPTED_NUDGE_SECS_DEFAULT,
);
const INTERRUPTED_RENUDGE_SECS = envPositiveSecs(
	"PIPIUI_INTERRUPTED_RENUDGE_SECS",
	INTERRUPTED_RENUDGE_SECS_DEFAULT,
);
/** done 重投节奏：30s 扫描每次都看，但同一 agentId 两次投递至少隔 60s，避免轰炸正在处理中的 boss。 */
const DONE_RETRY_MIN_INTERVAL_MS = 60_000;
/** Initial delivery plus four retries; a broken follow-up channel must not retry forever. */
const DONE_MAX_ATTEMPTS = 5;
/**
 * Wall-clock check-ins for workers that are still producing output. Stall covers silence;
 * this path asks the boss whether a long-running worker has drifted. First gap defaults to
 * 10 minutes, then 20, then 30 thereafter (elapsed 10 / 30 / 60 / 90…). Override the first
 * gap with PIPIUI_HEARTBEAT_SECS; later gaps stay 2× and 3× that value.
 */
const CHECKIN_FIRST_MS = envPositiveSecs("PIPIUI_HEARTBEAT_SECS", 10 * 60) * 1000;
const CHECKIN_SECOND_MS = CHECKIN_FIRST_MS * 2;
const CHECKIN_REST_MS = CHECKIN_FIRST_MS * 3;

export function nextCheckinAt(startedAt: number, delivered: number, heartbeatMs?: number): number {
	const configured = configuredHeartbeatAt(startedAt, delivered, heartbeatMs);
	if (configured !== undefined) return configured;
	let due = startedAt;
	const count = Math.max(0, delivered);
	for (let i = 0; i <= count; i++) {
		due += i === 0 ? CHECKIN_FIRST_MS : i === 1 ? CHECKIN_SECOND_MS : CHECKIN_REST_MS;
	}
	return due;
}
/** A handle with no pid after this age is treated as vanished (spawn never attached). */
const NO_PID_VANISH_MS = 5 * 60 * 1000;

/** Signal 0 tests for existence without touching the process. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means it exists but belongs to someone else — alive for our purposes.
		return (err as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

interface RunningAgentHandle {
	/** This exact dispatch generation; a late prior callback must never touch a reused agentId. */
	runId: string;
	/** 外部中止入口（action=abort / subagent_abort 命令）；走 killProc SIGTERM→SIGKILL。 */
	controller: AbortController;
	name: string;
	task: string;
	title?: string;
	/** 最后一次有任何流式事件/输出（stdout/stderr）的时间戳。 */
	lastActivityAt: number;
	/** 上次推送 [subagent-stalled] 的时间戳；0 = 本卡死片段尚未推过（有新活动后复位为 0）。 */
	lastStallNotifyAt: number;
	/** 本无活动片段已推送 [subagent-stalled] 的次数；有新活动后复位为 0。 */
	stallNotifyCount: number;
	/** One in-flight stall wake; failed/held sends leave stallNotifyCount unchanged. */
	stallNotifyInFlight?: boolean;
	/** Successful wall-clock check-ins delivered for this dispatch. */
	checkinCount?: number;
	/** One in-flight follow-up; failed sends leave checkinCount unchanged so the 30s poll retries. */
	checkinInFlight?: boolean;
	/** When this worker was dispatched; check-ins are scheduled from this instant. */
	startedAt: number;
	/** Boss-selected regular check-in interval for this run; absent preserves stepped defaults. */
	heartbeatMs?: number;
	/** Boss-tailed live progress log (bundled GP only); samples/forwarding state below stay unset otherwise. */
	progressLogPath?: string;
	/** Last watchdog stat() of the progress log; the size/mtime delta pair decides "progressed". */
	progressLogSample?: ProgressLogSample;
	/** Forward offset into the progress log: bytes up to here were already consumed for Boss delivery. */
	progressLogOffset?: number;
	/** Last time the progress log itself changed (size/mtime); merged with lastActivityAt for idle math. */
	lastProgressLogAt?: number;
	/** Forward cadence for progress excerpts: heartbeatSecs when set, else 60s default. */
	progressLogIntervalMs?: number;
	/** When this path became the watched one; a never-written log is judged against this, not startedAt. */
	progressLogSetAt?: number;
	/** Spawn cwd, retained so a mid-run progressLog retarget is judged against this run's own roots. */
	spawnCwd?: string;
	/** True only for the exact bundled general-purpose dispatch, the same gate `progressLog` passes at dispatch. */
	progressLogEligible?: boolean;
	/** Progress-forward bookkeeping: last claimed send slot, monotonically growing sequence, one in-flight guard. */
	lastProgressReportAt?: number;
	progressReportCount?: number;
	/** The ProgressLogClaimState slice: token-checked single-flight for log reads/deliveries. */
	progressReportInFlight?: boolean;
	progressReportClaim?: number;
	progressReportClaimSeq?: number;
	/** Absolute runtime deadline for this exact generation, computed at first child spawn. */
	deadlineAt?: number;
	/**
	 * The child has emitted close/error and this run is performing verify/end-report closeout.
	 * This is set only after an actual child terminal event, so it cannot hide a child that
	 * disappeared without reporting; it only prevents the watchdog from mistaking expected
	 * post-exit cleanup for a vanished live worker.
	 */
	finalizing: boolean;
	/**
	 * Child pid, so liveness can be checked directly. Idleness is not death: a worker can be
	 * quiet while thinking, and a dead one can leave a registry entry behind if its close
	 * handler never ran — which is precisely when the boss would otherwise wait forever.
	 */
	pid?: number;
	/** Isolated writable worktree; absent for read-only / shared-cwd workers. */
	worktreePath?: string;
	worktreeBranch?: string;
	readOnly?: boolean;
	/** True when the boss turn is awaiting this worker inline (chain / sync dispatch). */
	syncWait?: boolean;
	/** A recursive RPC parent settled an assistant turn and is legally waiting for descendants. */
	residentIdleWait?: boolean;
	/**
	 * Set when the worker's last stdout was an assistant message that asked for tools, i.e.
	 * the silence that follows is the tools running. Without this the stall detector cannot
	 * tell explained silence from a wedge, and every tool call longer than the threshold —
	 * a build, a test sweep, a baseline verify — reported a healthy worker as stalled.
	 */
	toolWaitSince?: number;
	/** Tool names the worker is waiting on, for the state line. */
	toolWaitNames?: string[];
	/** Latest subtree CPU sample and the one before it; the pair is the progress evidence. */
	cpuSample?: CpuSample;
	cpuSamplePrevious?: CpuSample;
	/** Metadata-only stall probe for this exact run. */
	diagnostics: StallDiagnosticsState;
}

/** Every live child is externally abortable; parent cancellation is composed separately. */
const runningAgents = new Map<string, RunningAgentHandle>();

// --- Child → Boss question channel (ask_boss / subagent_reply) -------------------
// The question file is the authority; these maps only keep the Boss from being told
// twice and let the parent's stream reader hurry delivery along. See boss-question.ts.
let bossPi: ExtensionAPI | undefined;
const deliveredBossQuestions = new Set<string>();
const bossQuestionScans = new Map<string, ReturnType<typeof setTimeout>>();

function questionDirFor(agentId: string, runId: string): string | undefined {
	const root = resolveAgentSessionRoot(PIPIUI_PROJECT_ROOT, PIPIUI_MAIN_CWD);
	return root ? questionRunDir(root, agentId, runId) : undefined;
}

/** A worker blocked inside ask_boss is waiting on us, not stalled. */
function workerWaitingOnBoss(handle: RunningAgentHandle | undefined): boolean {
	return handle?.toolWaitNames?.includes(ASK_BOSS_TOOL_NAME) === true;
}

/** Deliver every pending, not-yet-delivered question of one run. Returns how many are pending. */
function deliverPendingBossQuestions(agentId: string, runId: string, dir: string): number {
	const pending = pendingQuestions(dir);
	const pi = bossPi;
	if (!pi) return pending.length;
	for (const question of pending) {
		const key = `${agentId}:${runId}:${question.id}`;
		if (deliveredBossQuestions.has(key)) continue;
		const handle = handleForRun(agentId, runId);
		if (!handle) continue;
		deliveredBossQuestions.add(key);
		const text = formatQuestionForBoss(question, { workerName: handle.name, timeoutMs: resolveAskBossTimeoutMs() });
		void sendUserMessageAfterCutIn(pi, text).then((ok) => {
			// Not delivered (host-stop quiet, cut-in hold): let the watchdog tick try again.
			if (!ok) deliveredBossQuestions.delete(key);
		});
	}
	return pending.length;
}

/** The child writes its question a beat after the parent sees the tool call; retry briefly. The watchdog tick is the net. */
function scheduleBossQuestionScan(agentId: string, runId: string, dir: string): void {
	const key = `${agentId}:${runId}`;
	const existing = bossQuestionScans.get(key);
	if (existing) clearTimeout(existing);
	const delays = [300, 1_000, 2_500, 5_000];
	let attempt = 0;
	const tick = () => {
		bossQuestionScans.delete(key);
		if (!handleForRun(agentId, runId)) return;
		const found = deliverPendingBossQuestions(agentId, runId, dir);
		if (found > 0 || attempt >= delays.length) return;
		const timer = setTimeout(tick, delays[attempt++]);
		timer.unref?.();
		bossQuestionScans.set(key, timer);
	};
	const timer = setTimeout(tick, delays[attempt++]);
	timer.unref?.();
	bossQuestionScans.set(key, timer);
}

/** Terminal event: questions are transient, so the run's directory goes with it. */
function forgetBossQuestions(agentId: string, runId: string, dir: string | undefined): void {
	const key = `${agentId}:${runId}`;
	const timer = bossQuestionScans.get(key);
	if (timer) {
		clearTimeout(timer);
		bossQuestionScans.delete(key);
	}
	for (const entry of [...deliveredBossQuestions]) {
		if (entry.startsWith(`${key}:`)) deliveredBossQuestions.delete(entry);
	}
	if (dir) removeQuestionRun(dir);
}

/**
 * Process-local `subagent_watch` subscriptions (Boss-side monitoring of exact runs).
 * Pure bookkeeping driven only by the shared 30s watchdog tick — the registry never owns
 * a timer. Cleared on session start, shutdown, and extension reload: a subscription
 * never outlives the session that made it, and completion delivery stays the only
 * terminal notification.
 */
const watchRegistry = createWatchRegistry();
let watchSessionGeneration = 0;
let watchSessionShutdownAbort: AbortController = new AbortController();

/**
 * Dispatch-idle fold timer. Independent one-shot setTimeout (default 4 min of
 * continuous inactivity), not the 30s stall watchdog. Shared per Boss session so
 * a wave folds once; any worker activity re-arms; completion cancels.
 */
const IDLE_FOLD_REGISTRY_KEY = "__pipiuiIdleFoldRegistry";
const idleFoldConfig = idleFoldConfigFromEnv();
let idleFoldRegistry: IdleFoldRegistry | undefined;
let lastIdleFoldUsage: IdleFoldUsage | undefined;
let lastIdleFoldMessages: unknown[] | undefined;

function idleFoldSessionKey(): string {
	return PIPIUI_SESSION || "default";
}

function noteIdleFoldContext(event: { messages?: unknown }, ctx: {
	getContextUsage?: () => { tokens?: number | null; contextWindow?: number | null } | undefined;
	model?: { contextWindow?: number } | null;
} | undefined): void {
	const usage = typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
	lastIdleFoldMessages = Array.isArray(event.messages) ? event.messages : undefined;
	lastIdleFoldUsage = {
		tokens: typeof usage?.tokens === "number" ? usage.tokens : null,
		contextWindow: typeof usage?.contextWindow === "number"
			? usage.contextWindow
			: (typeof ctx?.model?.contextWindow === "number" ? ctx.model.contextWindow : null),
	};
}

function runProductionIdleFold(): void {
	if (contextFoldIsStandby()) return;
	const usage = lastIdleFoldUsage;
	if (!contextAboveIdleFoldWatermark(usage, idleFoldConfig.lowWatermark)) return;
	const messages = lastIdleFoldMessages;
	if (!messages || messages.length === 0) return;
	void runDeterministicIdleFold({
		messages,
		tokens: usage?.tokens,
		contextWindow: usage?.contextWindow,
	}).catch((err) => {
		console.error("[pipiui-subagent] idle fold failed:", err);
	});
}

function bindIdleFoldRegistry(registry: IdleFoldRegistry): void {
	const g = globalThis as Record<string, unknown>;
	const prev = g[IDLE_FOLD_REGISTRY_KEY] as IdleFoldRegistry | undefined;
	if (prev && prev !== registry) prev.disposeAll();
	g[IDLE_FOLD_REGISTRY_KEY] = registry;
	idleFoldRegistry = registry;
}

function armIdleFoldForDispatch(agentId: string): void {
	if (PIPIUI_DEPTH !== 0 || !agentId) return;
	idleFoldRegistry?.arm(idleFoldSessionKey(), agentId);
}

function noteIdleFoldActivity(agentId: string): void {
	if (PIPIUI_DEPTH !== 0 || !agentId) return;
	idleFoldRegistry?.noteActivity(agentId);
}

function noteIdleFoldCompleted(agentId: string | undefined): void {
	if (!agentId) return;
	idleFoldRegistry?.noteCompleted(agentId);
}

function disposeAllIdleFoldTimers(): void {
	idleFoldRegistry?.disposeAll();
	lastIdleFoldUsage = undefined;
	lastIdleFoldMessages = undefined;
}

function handleForRun(agentId: string, runId: string): RunningAgentHandle | undefined {
	const handle = runningAgents.get(agentId);
	return handle?.runId === runId ? handle : undefined;
}

function noteAgentActivity(agentId: string, runId?: string): void {
	const handle = runningAgents.get(agentId);
	if (!handle || (runId !== undefined && handle.runId !== runId)) return;
	handle.lastActivityAt = Date.now();
	handle.lastStallNotifyAt = 0;
	handle.stallNotifyCount = 0;
	handle.stallNotifyInFlight = false;
	// Output after a tool request is the tool results coming back. The stdout handler
	// notes activity before the scanner parses the chunk, so the message_end that opens
	// the next tool wait re-arms this immediately afterwards.
	handle.toolWaitSince = undefined;
	handle.toolWaitNames = undefined;
	handle.cpuSample = undefined;
	handle.cpuSamplePrevious = undefined;
	noteIdleFoldActivity(agentId);
}

/** The worker asked for tools; the silence until the results arrive is expected. */
function noteAgentToolWait(agentId: string, runId: string, names: string[]): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	handle.toolWaitSince = Date.now();
	handle.toolWaitNames = names.length > 0 ? names : undefined;
	noteDiagnosticsToolStart(handle.diagnostics, handle.toolWaitSince);
	projectFinalizationPhase(agentId, runId, "tool-active");
}

function noteAgentToolEnd(agentId: string, runId: string): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	noteDiagnosticsToolEnd(handle.diagnostics, Date.now());
}

function diagnosticsSnapshotFor(agentId: string, handle: RunningAgentHandle, now = Date.now()): ReturnType<typeof snapshotStallDiagnostics> {
	const stall = stalledInfoFor(agentId, now);
	return snapshotStallDiagnostics({
		agentId,
		runId: handle.runId,
		state: handle.diagnostics,
		lastActivityAt: handle.lastActivityAt,
		childPid: handle.pid,
		toolWaitName: handle.toolWaitNames?.[0],
		cpuVerdict: stall.verdict,
	});
}

function attachDiagnostics<T extends { agentId: string; runId: string }>(payload: T, handle?: RunningAgentHandle): T & { diagnostics?: ReturnType<typeof snapshotStallDiagnostics> } {
	if (!handle || handle.runId !== payload.runId) return payload;
	return { ...payload, diagnostics: diagnosticsSnapshotFor(payload.agentId, handle) };
}

function projectFinalizationPhase(
	agentId: string,
	runId: string,
	phase: AgentFinalizationPhase,
	extras?: { error?: string; childExitedAt?: number; verifyPid?: number; doneEventSeq?: number },
): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	const now = Date.now();
	const changed = applyFinalizationTransition(handle.diagnostics, phase, now, extras);
	if (changed || extras) handle.diagnostics.eventSeq += 1;
	if (phase === "done-await-host" && handle.diagnostics.doneEventSeq === undefined) {
		handle.diagnostics.doneEventSeq = handle.diagnostics.eventSeq;
	}
	pipiuiReport({
		kind: "diagnostics",
		agentId,
		runId,
		diagnostics: diagnosticsSnapshotFor(agentId, handle, now),
	});
}

function projectChildExitDiagnostics(agentId: string, handle: RunningAgentHandle, exitReason: string): ReturnType<typeof snapshotStallDiagnostics> {
	const changed = noteDiagnosticsChildExit(handle.diagnostics, exitReason);
	if (changed) {
		logStallProbe("watchdog_decision", {
			agent: agentId,
			run: handle.runId,
			seq: handle.diagnostics.eventSeq,
			decision: "process-exited",
			reason: exitReason,
			childPid: handle.pid,
		});
	}
	const snapshot = diagnosticsSnapshotFor(agentId, handle);
	pipiuiReport({
		kind: "diagnostics",
		agentId,
		runId: handle.runId,
		diagnostics: snapshot,
	});
	return snapshot;
}

function markAgentFinalizing(agentId: string, runId: string, exitReason = "child-close"): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	const keptReason = preferSpecificExitReason(handle.diagnostics.exitReason, exitReason);
	const already = handle.finalizing;
	handle.pid = undefined;
	handle.finalizing = true;
	if (handle.diagnostics.childExitedAt === undefined) handle.diagnostics.childExitedAt = Date.now();
	if (already && handle.diagnostics.exitReason === keptReason) return;
	projectChildExitDiagnostics(agentId, handle, keptReason);
	if (!already) noteAgentActivity(agentId, runId);
}

function resumeAgentHandle(agentId: string, runId: string): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	handle.pid = undefined;
	handle.finalizing = false;
	resetFinalizationFields(handle.diagnostics);
	noteAgentActivity(agentId, runId);
	projectFinalizationPhase(agentId, runId, "generating");
}

function deleteRunningAgentHandle(agentId: string, runId: string): void {
	const handle = runningAgents.get(agentId);
	// `runId` was added after early test hooks/legacy handles existed; normal runtime handles
	// always carry it, while an old untagged handle is still safe to remove only here.
	if (handle && (handle.runId === runId || handle.runId === undefined)) {
		runningAgents.delete(agentId);
		watchRegistry.stop({ agentId, runId: handle.runId ?? runId });
		noteIdleFoldCompleted(agentId);
	}
}

/**
 * Quiet is not the same as stalled. A worker inside a tool call is quiet by
 * construction, so silence only counts as a stall once nothing explains it —
 * or once the CPU evidence says the explained wait stopped making progress.
 */
function stalledInfoFor(agentId: string, now: number): {
	stalled: boolean;
	idleSec: number;
	inTool?: { names: string[]; forSec: number };
	verdict?: LivenessVerdict;
} {
	const handle = runningAgents.get(agentId);
	if (!handle || handle.finalizing) return { stalled: false, idleSec: 0 };
	const idleMs = progressIdleMs(now, handle);
	const idleSec = Math.max(0, Math.floor(idleMs / 1000));
	const quiet = idleMs >= STALL_THRESHOLD_MS;
	const verdict = handle.cpuSample
		? classifyCpuProgress(handle.cpuSamplePrevious, handle.cpuSample)
		: undefined;
	if (handle.toolWaitSince === undefined) return { stalled: quiet, idleSec, verdict };
	const inTool = {
		names: handle.toolWaitNames ?? ["tool"],
		forSec: Math.max(0, Math.floor((now - handle.toolWaitSince) / 1000)),
	};
	// In-tool silence is excused only while CPU evidence shows real work.
	// Missing or unknown evidence is bounded: a wedged remote bash/scp/ssh
	// must still become stalled so the watchdog can notify and abort.
	const stalled = isQuietToolStalled({
		quiet,
		verdict,
		idleMs,
		stallThresholdMs: STALL_THRESHOLD_MS,
		sampleGraceMs: STALL_WATCHDOG_INTERVAL_MS,
	});
	return { stalled, idleSec, inTool, verdict };
}

/** Refresh the subtree CPU pair for one quiet worker. Callers pass a shared `ps` table. */
function sampleWorkerCpu(handle: RunningAgentHandle, rows: ReturnType<typeof readProcessTable>, now: number): void {
	if (handle.pid === undefined) return;
	const sample = sampleSubtreeCpu(rows, handle.pid, now);
	const previous = handle.cpuSample;
	handle.cpuSamplePrevious = previous;
	handle.cpuSample = sample;
	const deltaMs = previous && previous.at < sample.at
		? Math.round((sample.seconds - previous.seconds) * 1000)
		: undefined;
	noteDiagnosticsCpuSample(handle.diagnostics, now, deltaMs);
}

function cpuEvidenceFor(agentId: string): string | undefined {
	const handle = runningAgents.get(agentId);
	if (!handle?.cpuSample) return undefined;
	return formatCpuEvidence(
		classifyCpuProgress(handle.cpuSamplePrevious, handle.cpuSample),
		handle.cpuSamplePrevious,
		handle.cpuSample,
	);
}

function formatJobStateWithStall(job: JobRecord, now: number): string {
	if (job.state !== "running") {
		return isHandledJob(job) ? `${job.state} (resolved/handled)` : job.state;
	}
	const live = handleForRun(job.agentId, job.runId);
	if (live?.finalizing) return "finalizing";
	if (live?.residentIdleWait) return "running (resident RPC waiting for descendants)";
	const info = stalledInfoFor(job.agentId, now);
	if (info.stalled) {
		const why = info.inTool
			? `stalled in ${info.inTool.names.join("+")} for ${info.inTool.forSec}s`
			: `stalled, idle ${info.idleSec}s`;
		return `running (${why})`;
	}
	// Naming the tool and how long it has been in it is what lets the Boss judge
	// this against the task instead of guessing why the worker went quiet.
	if (info.inTool) return `running (in ${info.inTool.names.join("+")} for ${info.inTool.forSec}s)`;
	return "running";
}

/** Compact state tag for a heartbeat worker line; the verbose status view keeps idle detail. */
function formatHeartbeatWorkerState(agentId: string, handle: RunningAgentHandle, now: number): string {
	if (handle.finalizing) return "finalizing";
	if (handle.residentIdleWait) return "resident-idle(descendants)";
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== handle.runId || job.state === "running") {
		const info = stalledInfoFor(agentId, now);
		if (info.stalled) return "running(stalled)";
		return info.inTool ? `running(in ${info.inTool.names.join("+")} ${info.inTool.forSec}s)` : "running";
	}
	return job.state;
}

/** The progress-channel line a stall report carries, or nothing when none is configured. */
function progressEvidenceFor(handle: RunningAgentHandle, now: number): string | undefined {
	if (!handle.progressLogPath) return undefined;
	return describeProgressChannelForStall({
		path: handle.progressLogPath,
		now,
		...(handle.lastProgressLogAt !== undefined ? { lastProgressLogAt: handle.lastProgressLogAt } : {}),
		setAt: handle.progressLogSetAt ?? handle.startedAt,
		tail: readProgressLogTail({ path: handle.progressLogPath }),
	});
}

/**
 * Re-aim one live worker's progress channel at a different log file.
 *
 * The dispatch-time `progressLog` could only ever be a guess: Boss names the path before the
 * worker exists, and a test harness that turns out to write somewhere else leaves the watchdog
 * measuring silence on a file nobody appends to. The only remedy on offer was abort and
 * re-dispatch, which spends the run to fix the observation of it. Same gate, same containment
 * rule and same run-identity check as the dispatch field — this corrects where the runtime
 * looks, it does not grant a new reach.
 */
function retargetRunningProgressLog(input: {
	agentId: string;
	runId: string;
	progressLog: string;
	reportSecs?: number;
}): { ok: boolean; message: string } {
	const agentId = input.agentId.trim();
	const runId = input.runId.trim();
	if (!agentId || !runId) {
		return {
			ok: false,
			message: "subagent_progress requires both agentId and the exact runId from the dispatch receipt or subagent_status.",
		};
	}
	const handle = runningAgents.get(agentId);
	if (!handle) {
		const job = jobRegistry.get(agentId);
		return {
			ok: false,
			message: `Cannot re-point progressLog for agentId=${agentId}: no live run here (${job ? `job state "${job.state}"` : "no such job in this session process"}). A queued or finished run has no progress channel to aim; dispatch the next run with the corrected progressLog instead.`,
		};
	}
	if (handle.runId !== runId) {
		return {
			ok: false,
			message: `Cannot re-point progressLog for agentId=${agentId}: stale runId=${runId}; currentRunId=${handle.runId}. Re-check with subagent_status and pass the current run's exact runId.`,
		};
	}
	if (handle.finalizing) {
		return {
			ok: false,
			message: `Cannot re-point progressLog for agentId=${agentId} runId=${runId}: the worker already reported and is closing out. Read its result with subagent_status.`,
		};
	}
	if (!handle.progressLogEligible) {
		return {
			ok: false,
			message: `progressLog is only available for the bundled general-purpose worker, and agentId=${agentId} runs "${handle.name}". Dispatch long test runs as general-purpose if you need the progress channel.`,
		};
	}
	const interval = sanitizeProgressReportSecs(input.reportSecs);
	if (interval && "problem" in interval) return { ok: false, message: interval.problem };
	const resolved = resolveProgressLogPath({
		progressLog: input.progressLog,
		spawnCwd: handle.spawnCwd ?? PIPIUI_MAIN_CWD,
		allowedRoots: [PIPIUI_MAIN_CWD, handle.spawnCwd ?? "", handle.worktreePath ?? ""],
	});
	if ("problem" in resolved) return { ok: false, message: resolved.problem };
	const result = retargetProgressLog(handle, {
		path: resolved.path,
		now: Date.now(),
		...(interval && "ms" in interval ? { intervalMs: interval.ms } : {}),
	});
	logStallProbe("progress_retarget", {
		agent: agentId,
		run: runId,
		seq: handle.diagnostics.eventSeq,
		baselineBytes: result.baselineBytes,
		intervalMs: result.intervalMs,
		childPid: handle.pid,
	});
	return {
		ok: true,
		message: formatProgressLogRetargetReceipt({ agentId, runId, path: resolved.path, result }),
	};
}

/**
 * The `subagent_watch` control surface: start/update/stop/list bounded monitoring of exact
 * live runs. Mutations bind {agentId, runId} exactly — a stale runId is rejected, never
 * silently re-targeted at a newer run under the same agentId. Sampling itself is driven
 * only by the shared 30s watchdog (see the watch sweep in the unified tick); start merely
 * records a baseline, so an unchanged run stays silent and the run's normal completion
 * receipt remains the only terminal notification. The optional progressLog borrows the
 * exact subagent_progress path: same general-purpose gate, same containment, and the same
 * single-flight delivery — it corrects where the runtime looks, never what the worker does.
 */
export function runSubagentWatch(input: {
	action: string;
	agentId?: string;
	runId?: string;
	intervalSecs?: number;
	progressLog?: string;
}): { ok: boolean; message: string } {
	const action = typeof input.action === "string" ? input.action.trim() : "";
	if (!(WATCH_ACTIONS as readonly string[]).includes(action)) {
		return { ok: false, message: `subagent_watch action must be one of ${WATCH_ACTIONS.join(" | ")}.` };
	}

	const agentId = input.agentId?.trim() ?? "";
	const runId = input.runId?.trim() ?? "";

	if (action === "list") {
		const hasAgent = agentId !== "";
		const hasRun = runId !== "";
		if (hasAgent !== hasRun) {
			return {
				ok: false,
				message: 'subagent_watch action="list" takes either both agentId and runId (exact filter) or neither (every subscription).',
			};
		}
		const subs = watchRegistry.list(hasAgent ? { agentId, runId } : undefined);
		if (subs.length === 0) {
			return {
				ok: true,
				message: hasAgent
					? `No watch subscription for agentId=${agentId} runId=${runId}.`
					: "No active watch subscriptions.",
			};
		}
		const now = Date.now();
		const shown = subs.slice(0, WATCH_LIST_MAX_ROWS);
		const omitted = subs.length - shown.length;
		return {
			ok: true,
			message: [
				`Watch subscriptions: ${subs.length}${omitted > 0 ? ` (showing ${shown.length}, ${omitted} omitted)` : ""}`,
				...shown.map((sub) =>
					`  ${sub.agentId} runId=${sub.runId} every=${sub.intervalSecs}s next-in=${Math.max(0, Math.ceil((sub.nextSampleAt - now) / 1000))}s lastEventSeq=${sub.lastEventSeq}${sub.inFlight ? " delivering" : ""}${sub.pendingChange ? " (change coalesced)" : ""}`),
			].join("\n"),
		};
	}

	const target = sanitizeWatchTarget(agentId, runId);
	if ("problem" in target) {
		return {
			ok: false,
			message: `subagent_watch action="${action}" requires both agentId and the exact runId from the dispatch receipt or subagent_status. ${target.problem}`,
		};
	}
	const pair = target.value;

	if (action === "stop") {
		const removed = watchRegistry.stop(pair);
		if (removed.removed) {
			return { ok: true, message: `Watch stopped: agentId=${pair.agentId} runId=${pair.runId}. No further samples will be taken.` };
		}
		const live = runningAgents.get(pair.agentId);
		return {
			ok: false,
			message: live
				? `Cannot stop watch for agentId=${pair.agentId}: no subscription for runId=${pair.runId}${live.runId !== pair.runId ? ` (current run is runId=${live.runId}; stale runIds are rejected, never re-targeted)` : ""}.`
				: `Cannot stop watch for agentId=${pair.agentId}: no subscription for runId=${pair.runId}, and no live run under this agentId here.`,
		};
	}

	// start/update mutate a live exact run; same identity gate as subagent_progress.
	const handle = handleForRun(pair.agentId, pair.runId);
	if (!handle) {
		const live = runningAgents.get(pair.agentId);
		const job = jobRegistry.get(pair.agentId);
		return {
			ok: false,
			message: `Cannot ${action} watch for agentId=${pair.agentId}: no live run with runId=${pair.runId} here (${live ? `current runId=${live.runId}` : job ? `job state "${job.state}"` : "no such run in this session process"}). Re-check with subagent_status and pass the current run's exact runId.`,
		};
	}
	if (handle.finalizing) {
		return {
			ok: false,
			message: `Cannot ${action} watch for agentId=${pair.agentId} runId=${pair.runId}: the worker already reported and is closing out; its completion receipt is imminent. Read its result with subagent_status.`,
		};
	}
	const interval = input.intervalSecs === undefined ? undefined : sanitizeWatchIntervalSecs(input.intervalSecs);
	if (interval && "problem" in interval) return { ok: false, message: interval.problem };
	// Validate the optional progress aim before mutating anything: eligibility gate and path
	// containment are the subagent_progress ones, judged against this run's own roots.
	if (input.progressLog !== undefined && !handle.progressLogEligible) {
		return {
			ok: false,
			message: `watch progressLog is only available for the bundled general-purpose worker, and agentId=${pair.agentId} runs "${handle.name}".`,
		};
	}
	const resolvedLog = input.progressLog === undefined ? undefined : resolveProgressLogPath({
		progressLog: input.progressLog,
		spawnCwd: handle.spawnCwd ?? PIPIUI_MAIN_CWD,
		allowedRoots: [PIPIUI_MAIN_CWD, handle.spawnCwd ?? "", handle.worktreePath ?? ""],
	});
	if (resolvedLog && "problem" in resolvedLog) return { ok: false, message: resolvedLog.problem };

	if (action === "update") {
		const updated = watchRegistry.update({
			...pair,
			now: Date.now(),
			...(interval ? { intervalSecs: interval.secs } : {}),
		});
		if (!updated.ok) return { ok: false, message: updated.problem };
		if (resolvedLog && "path" in resolvedLog) {
			retargetProgressLog(handle, {
				path: resolvedLog.path,
				now: Date.now(),
				...(interval ? { intervalMs: interval.secs * 1000 } : {}),
			});
		}
		return {
			ok: true,
			message: [
				`Watch updated: agentId=${pair.agentId} runId=${pair.runId} now samples every ${updated.subscription.intervalSecs}s (cadence re-armed; identity, baseline, and receipt sequence unchanged).`,
				...(resolvedLog && "path" in resolvedLog ? [`Progress channel re-pointed to ${resolvedLog.path} with the same containment and single-flight delivery as subagent_progress.`] : []),
			].join("\n"),
		};
	}

	// start: the baseline is this instant's observation — the first event fires only when a
	// later sample differs from it. A duplicate start re-arms and re-baselines the same
	// subscription without rewinding its receipt sequence (the registry's documented contract).
	const fingerprint = watchObservationFor(pair.agentId, pair.runId, Date.now());
	if (fingerprint === undefined) {
		return { ok: false, message: `Cannot start watch for agentId=${pair.agentId} runId=${pair.runId}: the run left before the subscription could be armed.` };
	}
	const started = watchRegistry.start({
		...pair,
		now: Date.now(),
		fingerprint,
		...(interval ? { intervalSecs: interval.secs } : {}),
	});
	if (!started.ok) return { ok: false, message: started.problem };
	if (resolvedLog && "path" in resolvedLog) {
		retargetProgressLog(handle, {
			path: resolvedLog.path,
			now: Date.now(),
			...(interval ? { intervalMs: interval.secs * 1000 } : {}),
		});
	}
	return {
		ok: true,
		message: [
			`Watch ${started.created ? "started" : "re-armed"}: agentId=${pair.agentId} runId=${pair.runId} samples every ${started.subscription.intervalSecs}s.`,
			"Baseline recorded; you are told only on a state change (status/activity/tool/finalization/verify), routed through Supervisor — unchanged ticks stay silent, and the run's normal completion receipt remains the only terminal notification.",
			...(resolvedLog && "path" in resolvedLog ? [`Progress channel aimed at ${resolvedLog.path} (only appends from now are forwarded).`] : []),
		].join("\n"),
	};
}

/**
 * 中止一个后台 job：触发其 AbortController → killProc（SIGTERM，5s 后未退出则 SIGKILL）。
 * job 以 aborted 结束；精确单任务中止由 Supervisor 接收终态，stop sweep 保持静默。
 * runId 必填：queued 与 running 都按 {agentId, runId} 精确匹配，stale runId 拒绝而不是
 * 误杀同名 agentId 的新队列/新 run；成功取消 queued 项时同步释放 localAgentReservations。
 */
function abortRunningAgent(
	agentId: string,
	options: { reportTerminalToSupervisor?: boolean; runId: string },
): { ok: boolean; message: string } {
	const runId = options.runId.trim();
	if (!runId) {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: runId is required. Pass the exact runId from the dispatch receipt or subagent_status so a stale holder cannot abort a newer run under the same agentId.`,
		};
	}
	// A queued task has no process to signal, so abort means "drop it before it starts". This is
	// also the escape hatch offered by the [subagent-blocked] signal for a task no longer wanted.
	if (dispatchQueue.cancel(agentId, runId)) {
		// Accepted-but-unstarted work owns an id reservation; dropping it must give the id
		// back — and re-evaluate the queue, so dependents of this id are re-admitted or held
		// against its true post-cancel state instead of waiting on the stale reservation.
		noteResidentDescendantTerminal(agentId, runId, false);
		releaseAgentReservation(agentId);
		return {
			ok: true,
			message: `Dropped queued agentId=${agentId} runId=${runId} before it started; no process ran and no [subagent-done] will arrive for it.`,
		};
	}
	const job = jobRegistry.get(agentId);
	if (job && job.runId !== runId) {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: stale runId=${runId}${job.runId ? `; currentRunId=${job.runId}` : ""}. Re-check with subagent_status and abort the current run's exact runId.`,
		};
	}
	if (job && job.state !== "running") {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: job already finished with state "${job.state}".`,
		};
	}
	const handle = runningAgents.get(agentId);
	if (!handle) {
		if (!job) {
			return {
				ok: false,
				message: `Cannot abort agentId=${agentId} runId=${runId}: no queued item, run, or job matches that exact pair (no such job in this session process).`,
			};
		}
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: job is running but has no abort handle (already finishing?).`,
		};
	}
	if (handle.runId !== runId) {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: stale runId=${runId}; currentRunId=${handle.runId}. Re-check with subagent_status and abort the current run's exact runId.`,
		};
	}
	if (handle.finalizing) {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: child process already exited and is already finalizing closeout.`,
		};
	}
	noteDiagnosticsAbort(handle.diagnostics, options.reportTerminalToSupervisor ? "stall" : "user");
	const abortExactRun = () => handle.controller.abort();
	if (options.reportTerminalToSupervisor && supervisorAbortTerminalCloseout) {
		supervisorAbortTerminalCloseout.requestExternal(
			{ agentId, runId: handle.runId },
			abortExactRun,
		);
	} else {
		abortExactRun();
	}
	return {
		ok: true,
		message: `Abort requested for agentId=${agentId} runId=${runId} (${handle.name}). SIGTERM sent (SIGKILL after 5s if still alive). Aborted jobs do not push a [subagent-done] follow-up; check subagent_status.`,
	};
}

/**
 * Abort every queued/running background agent in this boss process (stop sweep).
 * Returns the agentIds that were actually signalled. Terminal [subagent-done]
 * receipts of these aborts are suppressed by notifySubagentDone, so the sweep
 * cannot restart turns by itself.
 */
function abortAllRunningAgents(): { aborted: string[] } {
	const targets = new Map<string, string>();
	for (const item of dispatchQueue.snapshot()) targets.set(item.agentId, item.runId);
	for (const [agentId, handle] of runningAgents) targets.set(agentId, handle.runId);
	const aborted: string[] = [];
	for (const [agentId, runId] of targets) {
		if (abortRunningAgent(agentId, { runId }).ok) aborted.push(agentId);
	}
	return { aborted };
}

interface ResolveSubagentEpisodeResult {
	ok: boolean;
	message: string;
	job?: JobRecord;
	currentRunId?: string;
	idempotent?: boolean;
}

function isHandledJob(job: JobRecord): boolean {
	return job.closeoutDisposition === "cleaned";
}

/**
 * Mark one terminal failure episode handled without changing its process state or verify attestation.
 * agentId is reusable, so runId is mandatory and stale requests are rejected rather than crossing runs.
 */
function resolveSubagentEpisode(
	agentId: string,
	runId: string,
	reason?: string,
): ResolveSubagentEpisodeResult {
	const job = jobRegistry.get(agentId);
	if (!job) {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId}: unknown agentId (no such job in this session process).`,
		};
	}
	if (job.runId !== runId) {
		return {
			ok: false,
			currentRunId: job.runId,
			message: `Resolve rejected for agentId=${agentId}: stale runId=${runId}; currentRunId=${job.runId}.`,
		};
	}
	if (isHandledJob(job)) {
		cancelInterruptedReminders(agentId, runId);
		return {
			ok: true,
			job,
			idempotent: true,
			message: `agentId=${agentId} runId=${runId} is already resolved/handled; state remains "${job.state}".`,
		};
	}
	if (job.state === "running") {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: job is still running. Use subagent_abort({agentId, runId}) or wait for it to finish.`,
		};
	}
	if (job.state === "ok") {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: job state is "ok"; resolve only handles failed, aborted, or interrupted episodes.`,
		};
	}
	if (!isInterruptedReminderState(job.state)) {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: unsupported job state "${job.state}".`,
		};
	}
	job.closeoutDisposition = "cleaned";
	job.closeoutReason = taskSummary(
		reason?.replace(/\s+/g, " ").trim() || "Boss marked this episode handled",
		500,
	);
	job.closeoutAt = Date.now();
	cancelInterruptedReminders(agentId, runId);
	return {
		ok: true,
		job,
		message: `Resolved agentId=${agentId} runId=${runId}: state remains "${job.state}" and verification was not changed; interrupted reminders cancelled.`,
	};
}

/**
 * Independent closeout bridge event; deliberately never impersonates a terminal end event.
 * Queue it after any outstanding end report for this agent so Swift cannot observe a resolved
 * closeout while its row still appears running.
 */
async function reportResolvedCloseout(job: JobRecord): Promise<void> {
	if (!isHandledJob(job)) return;
	let worktreeLifecycle: WorktreeLifecycleProjectionV1 | undefined;
	let worktreeFinalization: string | undefined;
	try {
		const state = await reenterFinalizeOnBossAccept({
			agentId: job.agentId,
			runId: job.runId,
			mainCwd: PIPIUI_MAIN_CWD,
			worktreePath: job.worktreePath,
			worktreeBranch: job.worktreeBranch,
			role: job.name === "secretary" ? "secretary" : "worker",
			terminalState: terminalStateForFinalization({
				ok: job.state === "ok",
				aborted: job.state === "aborted",
				interrupted: job.state === "interrupted",
			}),
			...(job.verify
				? {
					verify: {
						command: job.verify.command,
						exitCode: job.verify.timedOut ? -1 : (job.verify.exitCode ?? -1),
					},
				}
				: {}),
		});
		if (state) {
			worktreeFinalization = summarizeFinalization(state);
			worktreeLifecycle = lifecycleForFinalization(state);
			recordCloseoutDisposition({
				mainCwd: PIPIUI_MAIN_CWD,
				sessionKey: PIPIUI_SESSION,
				agentId: job.agentId,
				disposition: closeoutDispositionFor(state),
				reason: state.result.recovery.reason || worktreeFinalization,
			});
			applyWorktreeRecovery(state, {
				agentId: job.agentId,
				name: job.name,
				branch: job.worktreeBranch,
				worktreePath: job.worktreePath,
				verifyCommand: job.verify?.command,
			});
		}
	} catch (error) {
		worktreeFinalization = `finalization error: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (job.worktreePath && job.worktreeBranch) {
		jobPatchIntegration(job.agentId, job.runId, {
			integrationState: worktreeLifecycle ?? "pendingReview",
			...(worktreeFinalization ? { worktreeFinalization } : {}),
		});
	}
	await postTerminalPipiuiReport({
		kind: "closeout",
		agentId: job.agentId,
		runId: job.runId,
		disposition: "cleaned",
		reason: job.closeoutReason ?? "Boss marked this episode handled",
		closeoutAt: job.closeoutAt ?? Date.now(),
		...(worktreeFinalization ? { worktreeFinalization } : {}),
		...(worktreeLifecycle ? { worktreeLifecycle } : {}),
		...(job.worktreePath ? { worktreePath: job.worktreePath } : {}),
		...(job.worktreeBranch ? { worktreeBranch: job.worktreeBranch } : {}),
	});
}


function taskSummary(task: string, cap = 200): string {
	const t = task.replace(/\s+/g, " ").trim();
	return t.length <= cap ? t : `${t.slice(0, cap)}…`;
}

function jobPrune(): void {
	const finished = [...jobRegistry.entries()]
		.filter(([, j]) => j.state !== "running")
		.sort((a, b) => (a[1].endedAt ?? a[1].startedAt) - (b[1].endedAt ?? b[1].startedAt));
	const excess = finished.length - MAX_TERMINAL_JOB_RECORDS;
	for (let i = 0; i < excess; i++) {
		jobRegistry.delete(finished[i][0]);
	}
}

/** Matches worker-continuity's report-head window; bytes here, characters there. */
const FINDINGS_HEAD_BYTES = 16_000;

/**
 * Head of a findings report, or nothing. Bounded and never throwing: this runs inside dispatch
 * acceptance, where a slow or missing file must cost the dispatch nothing at all.
 */
function readFindingsHead(file: string): string | undefined {
	try {
		const fd = fs.openSync(file, "r");
		try {
			const buffer = Buffer.alloc(FINDINGS_HEAD_BYTES);
			const read = fs.readSync(fd, buffer, 0, FINDINGS_HEAD_BYTES, 0);
			return buffer.subarray(0, read).toString("utf-8");
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

/** One per session process: a continuity overlap is stated once, never re-raised. */
const continuityLedger = new ContinuityAdvisoryLedger();

/**
 * The finished workers a new dispatch could be continuing instead.
 *
 * Two sources, because neither alone covers the case. The in-process job registry knows the
 * declared scope, the role and the terminal state, but dies with the process; the reports
 * under `.pi/findings/` survive a restart and carry the file evidence a 200-char task summary
 * cannot. Merged by agentId, registry facts winning where both have an opinion.
 */
function continuityPriorsFor(
	agents: readonly AgentConfig[],
	mainCwd: string | undefined,
	excludeIds: ReadonlySet<string>,
): ContinuityPrior[] {
	const now = Date.now();
	const readOnlyFor = (name: string | undefined): boolean =>
		name ? agents.find((agent) => agent.name === name)?.traits.readOnly === true : false;
	const priors = new Map<string, ContinuityPrior>();

	for (const job of jobRegistry.values()) {
		if (excludeIds.has(job.agentId)) continue;
		priors.set(job.agentId, {
			agentId: job.agentId,
			agentName: job.name,
			title: job.title,
			state: job.state,
			anchors: extractPathAnchors(job.task ?? ""),
			scope: job.scope,
			ageMs: now - (job.endedAt ?? job.startedAt),
			readOnly: readOnlyFor(job.name),
		});
	}

	for (const entry of listFindings(mainCwd, undefined, now)) {
		if (excludeIds.has(entry.agentId)) continue;
		const summary = summarizeFindingsHead(readFindingsHead(entry.file));
		const existing = priors.get(entry.agentId);
		const agentName = existing?.agentName ?? summary.agentName;
		priors.set(entry.agentId, {
			agentId: entry.agentId,
			agentName,
			title: existing?.title ?? entry.title,
			// A report exists only for a terminal episode; a live re-dispatch of the same id
			// overwrites the registry row above, and that row's state wins.
			state: existing?.state,
			// The report is the better anchor source whenever it has any: the registry holds a
			// 200-char summary, the report holds the file list the worker actually touched.
			anchors: summary.anchors.length > 0 ? summary.anchors : (existing?.anchors ?? []),
			scope: existing?.scope,
			findingsFile: entry.file,
			ageMs: Math.min(existing?.ageMs ?? Number.POSITIVE_INFINITY, entry.ageMs),
			readOnly: existing ? existing.readOnly : readOnlyFor(agentName),
		});
	}

	return [...priors.values()];
}

function jobUpsertRunning(
	agentId: string,
	name: string,
	task: string,
	title?: string,
	blockedBy?: string[],
	runId?: string,
	model?: string,
	planAdherence?: { planTask?: string; scope?: string[] },
): string {
	// Every dispatch is a fresh episode, including a same-agentId continuation. A late old
	// close/finalize callback is therefore unable to mutate the new row or its reminders.
	const episodeRunId = runId ?? DeliveryObligationStore.runId();
	cancelInterruptedReminders(agentId);
	const declaredScope = planAdherence?.scope ? cleanScope(planAdherence.scope) : [];
	jobRegistry.set(agentId, {
		agentId,
		runId: episodeRunId,
		name,
		task: taskSummary(task),
		title,
		...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
		...(model ? { model } : {}),
		...(planAdherence?.planTask ? { planTask: planAdherence.planTask } : {}),
		...(declaredScope.length > 0 ? { scope: declaredScope } : {}),
		state: "running",
		startedAt: Date.now(),
	});
	jobPrune();
	// The ledger's task table is written from this event rather than by the boss, so a row can
	// only ever mean "someone is working on it". A worker's own nested dispatch is not the
	// boss's wave and must not appear in the boss's ledger.
	if (PIPIUI_DEPTH === 0) {
		recordTaskDispatch({
			mainCwd: PIPIUI_MAIN_CWD,
			sessionKey: PIPIUI_SESSION,
			agentId,
			title,
			task: taskSummary(task),
			role: name,
			blockedBy,
		});
	}
	return episodeRunId;
}

/** Job states the ledger records; `running` never reaches it because that is the dispatch row. */
function ledgerStatusFor(state: JobState): LedgerTaskStatus | undefined {
	switch (state) {
		case "ok":
			return "done";
		case "failed":
			return "failed";
		case "aborted":
			return "aborted";
		case "interrupted":
			return "interrupted";
		default:
			return undefined;
	}
}

function jobPatchRunning(
	agentId: string,
	runId: string,
	patch: { activity?: string; cost?: number; turns?: number },
): void {
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== runId || job.state !== "running") return;
	if (patch.activity !== undefined) job.activity = patch.activity;
	if (patch.cost !== undefined) job.cost = patch.cost;
	if (patch.turns !== undefined) job.turns = patch.turns;
}

/** Model-switch bookkeeping: the status card must show the model this run ACTUALLY uses now. */
function jobPatchModel(agentId: string, runId: string, model: string): void {
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== runId || job.state !== "running" || !model) return;
	if (job.model !== model) job.model = model;
}

type JobFinalizeFields = {
	name?: string;
	task?: string;
	state: JobState;
	resultText?: string;
	cost?: number;
	turns?: number;
	activity?: string;
	verify?: VerifyAttestation;
	worktreePath?: string;
	worktreeBranch?: string;
	integrationState?: SubagentIntegrationState;
	worktreeFinalization?: string;
	recovery?: RecoveryDecision;
	recoveryCheckpoint?: string;
	/** Only watchdog disappearance settle uses this; the real terminal callback may replace it. */
	provisional?: boolean;
	/** Completion scope-drift attestation (see plan-drift.ts). */
	scopeDrift?: string[];
};

function mergeTerminalJobFields(existing: JobRecord, fields: JobFinalizeFields): void {
	if (!existing.resultText && fields.resultText)
		existing.resultText = truncateTextHead(fields.resultText, JOB_RESULT_STORE_CAP);
	if (existing.cost === undefined && fields.cost !== undefined) existing.cost = fields.cost;
	if (existing.turns === undefined && fields.turns !== undefined) existing.turns = fields.turns;
	if (!existing.activity && fields.activity) existing.activity = fields.activity;
	if (!existing.verify && fields.verify) existing.verify = fields.verify;
	if (fields.worktreePath) existing.worktreePath = fields.worktreePath;
	if (fields.worktreeBranch) existing.worktreeBranch = fields.worktreeBranch;
	if (fields.integrationState) existing.integrationState = fields.integrationState;
	if (fields.worktreeFinalization) existing.worktreeFinalization = fields.worktreeFinalization;
	if (!existing.scopeDrift && fields.scopeDrift) existing.scopeDrift = fields.scopeDrift;
}

/**
 * Apply one terminal result to exactly one run. A watchdog interruption is provisional only:
 * the same run's real ok/failed/aborted terminal callback replaces it. Other terminal races are
 * idempotent and cannot overwrite a newer run sharing this agentId.
 */
function jobFinalize(agentId: string, runId: string, fields: JobFinalizeFields): boolean {
	if (fields.state === "running") return false;
	const existing = jobRegistry.get(agentId);
	const now = Date.now();
	if (existing && existing.runId !== runId) return false;

	const correctsProvisionalInterrupted =
		existing?.state === "interrupted" &&
		existing.interruptedProvisional === true &&
		fields.provisional !== true &&
		(fields.state === "ok" || fields.state === "failed" || fields.state === "aborted");
	if (existing && existing.state !== "running" && !correctsProvisionalInterrupted) {
		if (existing.state === fields.state) {
			mergeTerminalJobFields(existing, fields);
			rememberAgentSliceTerminal(agentId, runId, existing);
			dispatchQueue.onAgentTerminal(agentId);
		}
		return false;
	}

	// A new terminal boundary (or correction of watchdog-only interruption) invalidates every
	// queued reminder from its prior view of this episode. `ok` consequently has no reminder path.
	cancelInterruptedReminders(agentId, runId);
	watchRegistry.stop({ agentId, runId });
	jobRegistry.set(agentId, {
		agentId,
		runId,
		name: fields.name ?? existing?.name ?? "?",
		task: fields.task ? taskSummary(fields.task) : (existing?.task ?? ""),
		...(existing?.blockedBy && existing.blockedBy.length > 0
			? { blockedBy: existing.blockedBy }
			: {}),
		state: fields.state,
		startedAt: existing?.startedAt ?? now,
		endedAt: now,
		activity: fields.activity ?? existing?.activity,
		cost: fields.cost ?? existing?.cost,
		turns: fields.turns ?? existing?.turns,
		...(existing?.model ? { model: existing.model } : {}),
		resultText:
			fields.resultText !== undefined
				? truncateTextHead(fields.resultText, JOB_RESULT_STORE_CAP)
				: existing?.resultText,
		verify: fields.verify ?? existing?.verify,
		worktreePath: fields.worktreePath ?? existing?.worktreePath,
		worktreeBranch: fields.worktreeBranch ?? existing?.worktreeBranch,
		integrationState: fields.integrationState ?? existing?.integrationState,
		worktreeFinalization: fields.worktreeFinalization ?? existing?.worktreeFinalization,
		...(existing?.planTask ? { planTask: existing.planTask } : {}),
		...(existing?.scope && existing.scope.length > 0 ? { scope: existing.scope } : {}),
		...(fields.scopeDrift
			? { scopeDrift: fields.scopeDrift }
			: (existing?.scopeDrift ? { scopeDrift: existing.scopeDrift } : {})),
		...(fields.recovery ? { recovery: fields.recovery } : (existing?.recovery ? { recovery: existing.recovery } : {})),
		...(fields.recoveryCheckpoint || existing?.recoveryCheckpoint
			? { recoveryCheckpoint: fields.recoveryCheckpoint ?? existing?.recoveryCheckpoint }
			: {}),
		...(existing?.closeoutDisposition === "cleaned"
			? {
					closeoutDisposition: existing.closeoutDisposition,
					closeoutReason: existing.closeoutReason,
					closeoutAt: existing.closeoutAt,
				}
			: {}),
		...(fields.state === "interrupted" && fields.provisional ? { interruptedProvisional: true } : {}),
	});
	jobPrune();
	const ledgerStatus = ledgerStatusFor(fields.state);
	const finalized = jobRegistry.get(agentId);
	if (finalized) rememberAgentSliceTerminal(agentId, runId, finalized);
	if (PIPIUI_DEPTH === 0 && ledgerStatus && finalized) {
		const attestation = finalized.verify;
		recordTaskTerminal({
			mainCwd: PIPIUI_MAIN_CWD,
			sessionKey: PIPIUI_SESSION,
			agentId,
			title: finalized.title,
			task: finalized.task,
			role: finalized.name,
			status: ledgerStatus,
			// Only a runtime-attested exit code counts; a worker's own claim is not evidence.
			verified: attestation
				? attestation.exitCode === 0 && !attestation.timedOut
					? "pass"
					: "fail"
				: "none",
		});
	}
	// A registered resident descendant releases only through this exact run's terminal
	// boundary. Successful/failed results still retain a completion obligation until
	// its custom follow-up has a final assistant response; abort has no done wake.
	noteResidentDescendantTerminal(agentId, runId, fields.state !== "aborted");
	// A freed slot may admit a queued worker, and a satisfied dependency may release one.
	dispatchQueue.onAgentTerminal(agentId);
	return true;
}

/** Persist finalizer output onto the already-terminal worker episode before status publication. */
function jobPatchIntegration(
	agentId: string,
	runId: string,
	patch: Pick<JobRecord, "integrationState" | "worktreeFinalization">,
): void {
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== runId || job.state === "running") return;
	if (patch.integrationState) job.integrationState = patch.integrationState;
	if (patch.worktreeFinalization) job.worktreeFinalization = patch.worktreeFinalization;
	rememberAgentSliceTerminal(agentId, runId, job);
	// A dependency held while integration was active may now be releasable.
	dispatchQueue.onAgentTerminal(agentId);
}

/**
 * Read-only views behind the plan-adherence seam (plan-drift.ts → getPlanAdherenceSnapshot),
 * consumed by extensions/pipiui-plan.ts's plan_check. Queued items are projected in too: a
 * held dependency is exactly the work a plan_check must not miss.
 */
function planAdherenceJobForRecord(job: JobRecord): PlanAdherenceJob {
	return {
		agentId: job.agentId,
		runId: job.runId,
		...(job.title ? { title: job.title } : {}),
		state: job.state,
		...(job.planTask ? { planTask: job.planTask } : {}),
		...(job.scope && job.scope.length > 0 ? { scope: job.scope } : {}),
		...(job.scopeDrift ? { scopeDrift: job.scopeDrift } : {}),
	};
}

function planAdherenceJobsSnapshot(): PlanAdherenceJob[] {
	const jobs = [...jobRegistry.values()].map(planAdherenceJobForRecord);
	for (const item of dispatchQueue.snapshot()) {
		jobs.push({
			agentId: item.agentId,
			runId: item.runId,
			...(item.title ? { title: item.title } : {}),
			state: "queued",
			...(item.planTask ? { planTask: item.planTask } : {}),
			...(item.scope && item.scope.length > 0 ? { scope: item.scope } : {}),
		});
	}
	return jobs;
}

/**
 * Boss-facing signal channel for the dispatch queue, bound once the extension has `pi`.
 * A held task that nobody is told about is the forgetting this queue exists to end.
 */
let dispatchQueueNotify: (
	text: string,
	item: Pick<QueuedDispatchV1, "agentId" | "runId" | "heldReason">,
) => void = () => {};

/** Boss channel for runtime-budget escalations ([subagent-timeout]); bound to pi in the default export. */
let runtimeBudgetNotify: (text: string) => void = () => {};

const dispatchQueue = new DispatchQueueV1({
	limit: MAX_CONCURRENCY,
	lookup: (agentId): DependencyState => {
		// A sibling tool call may still be in async acceptance, before it can be queued or
		// registered as a job. Its explicit reservation is a deterministic running-like state.
		if (localAgentReservations.has(agentId) || pendingDispatchAcceptances.has(agentId)) return "running";
		const job = jobRegistry.get(agentId);
		if (!job) return "unknown";
		if (job.state === "running") return "running";
		// Only a clean finish satisfies a dependency; aborted and interrupted are not successes.
		if (job.state !== "ok") return "failed";
		const admission = integrationDependencyAdmission({
			workerState: job.state,
			integrationState: job.integrationState,
			worktreePath: job.worktreePath,
			worktreeBranch: job.worktreeBranch,
		});
		return admission === "ready" ? "ok" : admission === "waiting" ? "running" : "failed";
	},
	notify: (text, item) => dispatchQueueNotify(text, item),
});

function releasePendingDispatchAcceptance(agentIds: readonly string[], token: symbol): void {
	let released = false;
	for (const agentId of agentIds) {
		const owners = pendingDispatchAcceptances.get(agentId);
		// Token-matched: one claimant's release must not drop another claimant's pending
		// ownership of the same id — the id stays running-like while any owner remains.
		if (!owners?.delete(token)) continue;
		if (owners.size === 0) pendingDispatchAcceptances.delete(agentId);
		released = true;
	}
	if (released) dispatchQueue.onDependencyStateChanged();
}

/**
 * Release one agentId reservation deterministically. The reservation is a running-like
 * dependency state, so removing it changes what the dispatch queue's lookup answers: the
 * delete must land first and the queue must re-evaluate immediately, or a dependent whose
 * producer just settled, failed, or was exact-aborted keeps waiting on a reservation that
 * nobody will ever pump again.
 */
function releaseAgentReservation(agentId: string): void {
	if (!localAgentReservations.delete(agentId)) return;
	dispatchQueue.onDependencyStateChanged();
}

function queuedHeldRunIsCurrent(agentId: string, runId: string, heldReason: string | undefined): boolean {
	return dispatchQueue.snapshot().some(
		(item) => item.agentId === agentId && item.runId === runId && item.heldReason === heldReason,
	);
}

function isInterruptedReminderState(state: JobState): boolean {
	return state === "interrupted" || state === "aborted" || state === "failed";
}

function formatInterruptedReminder(job: JobRecord, idleSec: number, nudgeSeq: number): string {
	const title =
		job.title?.trim() || (job.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
	// A classified context/provider-poisoned boundary must not nudge the Boss toward blind
	// same-id resume — replaying that conversation is the failure mode, not the recovery.
	const continueLines =
		job.recovery?.route === "checkpoint-fresh-episode"
			? formatFreshEpisodeReminderLines(job.recoveryCheckpoint)
			: [
					`This worker is ${job.state} but its stored context is intact. Re-dispatch the same agentId to continue where it left off, or pass fresh:true to abandon that context. Do not treat this message as a new user request.`,
				];
	return [
		`[subagent-interrupted-reminder] agentId=${job.agentId} runId=${job.runId} state=${job.state} title=${title} idle=${idleSec}s nudge=${nudgeSeq}/2`,
		...continueLines,
		`If this episode's work is already complete, mark it handled with subagent_resolve({agentId:"${job.agentId}", runId:"${job.runId}"}) (or /subagent_resolve ${job.agentId} ${job.runId}) so no further reminders are sent; do not just reply "already completed".`,
	].join("\n");
}

/** Reserve due terminal reminders before delivery; reservations remain process-memory only. */
function scheduleInterruptedReminders(now: number, resumableIds: ReadonlySet<string>): InterruptedReminder[] {
	const reminders: InterruptedReminder[] = [];
	for (const job of jobRegistry.values()) {
		if (!isInterruptedReminderState(job.state) || isHandledJob(job) || !resumableIds.has(job.agentId)) continue;
		const priorCount = job.nudgeCount ?? 0;
		if (priorCount >= 2) continue;
		const endedAt = job.endedAt ?? job.startedAt;
		const idleSec = Math.max(0, Math.floor((now - endedAt) / 1000));
		const thresholdSec = priorCount === 0 ? INTERRUPTED_NUDGE_SECS : INTERRUPTED_RENUDGE_SECS;
		if (idleSec < thresholdSec) continue;
		const nudgeSeq = priorCount + 1;
		job.nudgeCount = nudgeSeq;
		job.lastNudgeAt = now;
		const reminder: InterruptedReminder = {
			agentId: job.agentId,
			runId: job.runId,
			nudgeSeq,
			text: formatInterruptedReminder(job, idleSec, nudgeSeq),
		};
		pendingInterruptedReminders.set(
			interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq),
			reminder,
		);
		reminders.push(reminder);
	}
	return reminders;
}

function isInterruptedReminderEligible(reminder: InterruptedReminder): boolean {
	const key = interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq);
	const queued = pendingInterruptedReminders.get(key);
	const job = jobRegistry.get(reminder.agentId);
	return (
		queued === reminder &&
		job !== undefined &&
		job.runId === reminder.runId &&
		!isHandledJob(job) &&
		isInterruptedReminderState(job.state) &&
		(job.nudgeCount ?? 0) >= reminder.nudgeSeq
	);
}

function discardInterruptedReminder(reminder: InterruptedReminder): void {
	const key = interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq);
	if (pendingInterruptedReminders.get(key) === reminder) pendingInterruptedReminders.delete(key);
}

/** Dead pid, or no pid attached after NO_PID_VANISH_MS. Finalizing follows an observed close. */
function isHandleVanished(handle: RunningAgentHandle, now: number): boolean {
	if (handle.finalizing) return false;
	if (handle.pid !== undefined) return !isProcessAlive(handle.pid);
	// Prefer lastActivityAt so auto-resume backoff (pid cleared + activity noted) is not vanished.
	return now - Math.max(handle.startedAt, handle.lastActivityAt) >= NO_PID_VANISH_MS;
}

/**
 * Settle a genuinely vanished worker on every ledger. A child that emitted close is marked
 * finalizing instead and reaches its own real terminal path after verify/end-report closeout.
 */
function markWorkerInterrupted(agentId: string, reason: string): boolean {
	const handle = runningAgents.get(agentId);
	const job = jobRegistry.get(agentId);
	if (!handle && !job) return false;
	if (!handle && job && job.state !== "running") return false;
	const runId = handle?.runId ?? job?.runId;
	if (!runId) return false;
	if (handle && job && handle.runId && handle.runId !== job.runId) {
		deleteRunningAgentHandle(agentId, handle.runId);
		return false;
	}

	if (handle) noteFinalizationDetails(handle.diagnostics, { error: "process-missing" });
	const exitSnapshot = handle ? projectChildExitDiagnostics(agentId, handle, "vanished") : undefined;
	const changed = jobFinalize(agentId, runId, {
		name: handle?.name ?? job?.name,
		task: handle?.task ?? job?.task,
		state: "interrupted",
		provisional: true,
		resultText: reason,
		activity: job?.activity,
		cost: job?.cost,
		turns: job?.turns,
	});
	deleteRunningAgentHandle(agentId, runId);
	noteIdleFoldCompleted(agentId);
	if (!changed) return false;
	void postTerminalPipiuiReport({
		kind: "end",
		agentId,
		runId,
		ok: false,
		aborted: true,
		interrupted: true,
		activity: null,
		activityActive: false,
		activityEndedAt: Date.now(),
		output: reason,
		...(job?.cost !== undefined ? { cost: job.cost } : {}),
		...(job?.turns !== undefined ? { turns: job.turns } : {}),
		...(exitSnapshot ? { diagnostics: exitSnapshot } : {}),
	});
	return true;
}

function jobStateFromResult(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): JobState {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	if (aborted) return "aborted";
	if (extra?.error || isFailedResult(result)) return "failed";
	return "ok";
}

/** Mark job terminal before/with notify so status works even if deliver fails. */
function ensureJobTerminalFromResult(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): string | undefined {
	const agentId = result.agentId;
	if (!agentId) return undefined;
	const runId = result.runId ?? jobRegistry.get(agentId)?.runId ?? DeliveryObligationStore.runId();
	const resultText = extra?.error || getResultOutput(result) || result.stderr || "(no output)";
	jobFinalize(agentId, runId, {
		name: result.agent,
		task: result.task,
		state: jobStateFromResult(result, extra),
		resultText,
		cost: result.usage.cost,
		turns: result.usage.turns,
		verify: result.verify,
		worktreePath: result.worktreePath,
		worktreeBranch: result.worktreeBranch,
		integrationState: result.integrationState,
		worktreeFinalization: result.worktreeFinalization,
		...(result.scopeDrift ? { scopeDrift: result.scopeDrift } : {}),
	});
	return runId;
}

function formatElapsedMs(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return `${m}m${rs}s`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return `${h}h${rm}m`;
}

/** Wave cap for the still-running list carried on every terminal receipt. */
const WAVE_CAP = 8;

/**
 * Running workers at the moment one worker went terminal. Shared by completion and
 * interruption receipts so both let the Boss make the same speak-or-wait decision.
 */
function currentWaveSnapshot(now: number): WaveSnapshot {
	const running = [...jobRegistry.values()]
		.filter((j) => j.state === "running")
		.sort((a, b) => a.startedAt - b.startedAt);
	const overflow = Math.max(0, running.length - WAVE_CAP);
	return {
		workers: running.slice(0, WAVE_CAP).map((j) => ({
			agentId: j.agentId,
			name: j.name,
			elapsed: formatElapsedMs(now - j.startedAt),
		})),
		...(overflow > 0 ? { overflow } : {}),
	};
}

function inFlightWorkerTitle(handle: RunningAgentHandle): string {
	return (handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60)) || "(untitled)";
}

function inFlightWorkerKind(handle: RunningAgentHandle, now: number): InFlightWorkerView["kind"] {
	if (handle.finalizing) return "finalizing";
	if (isHandleVanished(handle, now)) return "vanished";
	// Blocked on the Boss's answer: silence that is ours, and the one state the Boss must act on.
	if (workerWaitingOnBoss(handle)) return "waiting";
	if (progressIdleMs(now, handle) >= STALL_THRESHOLD_MS) return "stalled";
	return "running";
}

/** The oldest pending question, quantized for the prompt tail: id and bounded text, no clocks. */
function inFlightWorkerQuestion(agentId: string, handle: RunningAgentHandle): InFlightWorkerView["question"] {
	const dir = questionDirFor(agentId, handle.runId);
	const pending = dir ? pendingQuestions(dir) : [];
	const first = pending[0];
	return first ? { id: first.id, runId: handle.runId, text: first.question.replace(/\s+/g, " ").slice(0, 160) } : undefined;
}

/** Quantized live snapshot for a tail custom message. Null when nothing is in flight. */
function currentInFlightWorkersSnapshot(now: number): string | null {
	const workers: InFlightWorkerView[] = [];
	for (const [agentId, handle] of runningAgents) {
		const kind = inFlightWorkerKind(handle, now);
		const question = kind === "waiting" ? inFlightWorkerQuestion(agentId, handle) : undefined;
		workers.push({
			agentId,
			title: inFlightWorkerTitle(handle),
			kind,
			...(question ? { question } : {}),
		});
	}
	return formatInFlightWorkersBlock(workers, dispatchQueue.snapshot());
}

/**
 * Workers whose conversation survives on disk without a live job entry.
 *
 * The registry is memory in one process, so a restarted main session forgets every worker it
 * dispatched — while their stored conversations are still sitting there. An interrupted worker
 * is not a failed one: it was cut off mid-thought, and restarting it from zero throws away
 * context that is still perfectly good. This is what lets the boss find those again.
 */
function resumableAgentIds(): string[] {
	const root = resolveAgentSessionRoot(PIPIUI_PROJECT_ROOT, PIPIUI_MAIN_CWD);
	const dir = root ? path.join(root, ".pi", "agent-sessions") : undefined;
	if (!dir) return [];
	try {
		return fs
			.readdirSync(dir)
			.map((f) => /_pipiui-(.+)\.jsonl$/.exec(f)?.[1])
			.filter((id): id is string => Boolean(id))
			.filter((id) => jobRegistry.get(id)?.state !== "running")
			.sort();
	} catch {
		return [];
	}
}

interface AgentSliceMetadata {
	agentId: string;
	name: string;
	task: string;
	title?: string;
	runId?: string;
	state?: JobState;
	/** Conversation that dispatched this worker; absent on rows written before the field existed. */
	sessionId?: string;
	resultSummary?: string;
	worktreePath?: string;
	worktreeBranch?: string;
	integrationState?: SubagentIntegrationState;
	worktreeFinalization?: string;
	updatedAt: number;
}

export function agentResumeIdentityProblem(input: {
	agentId: string;
	requestedName: string;
	historicalName?: string;
	fresh?: boolean;
}): string | null {
	if (!input.historicalName || input.historicalName === input.requestedName) return null;
	return `agentId ${JSON.stringify(input.agentId)} belongs to ${JSON.stringify(input.historicalName)}, not ${JSON.stringify(input.requestedName)}; changing agent type requires a new agentId`;
}

function agentSliceMetadataFile(): string | undefined {
	return PIPIUI_MAIN_CWD ? path.join(PIPIUI_MAIN_CWD, ".pi", "agent-slices.json") : undefined;
}

function readAgentSliceMetadata(): AgentSliceMetadata[] {
	const file = agentSliceMetadataFile();
	if (!file) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.slices)) return [];
		return parsed.slices.filter((item: unknown): item is AgentSliceMetadata => {
			const value = item as Partial<AgentSliceMetadata> | null;
			return Boolean(value && typeof value.agentId === "string" && typeof value.name === "string" && typeof value.task === "string" && typeof value.updatedAt === "number");
		});
	} catch {
		return [];
	}
}

function writeAgentSliceMetadata(slices: AgentSliceMetadata[]): void {
	const file = agentSliceMetadataFile();
	if (!file) return;
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temp = `${file}.tmp-${process.pid}`;
		fs.writeFileSync(temp, JSON.stringify({ version: 1, slices: slices.slice(0, 1000) }, null, 2) + "\n", { mode: 0o600 });
		fs.renameSync(temp, file);
	} catch {
		// Discovery metadata is advisory; it must never block a real dispatch.
	}
}

/** Persist the exact task identity at dispatch. This is evidence for the Boss, not routing:
 * no program guesses whether two prose tasks are the same semantic work. */
function rememberAgentSlice(agentId: string, name: string, task: string, title: string | undefined, runId: string): void {
	const all = readAgentSliceMetadata();
	writeAgentSliceMetadata([
		{ agentId, name, task: task.slice(0, 12_000), ...(title ? { title: title.slice(0, 500) } : {}), runId, state: "running", ...(PIPIUI_SESSION_ID ? { sessionId: PIPIUI_SESSION_ID } : {}), updatedAt: Date.now() },
		...all.filter((item) => item.agentId !== agentId),
	]);
}

/**
 * Set when this process starts and finds workers its own session left persisted
 * as running. Consumed by the next turn's before_agent_start.
 */
let pendingOrphanNotice: string | undefined;

/** Only the Boss reports these; a worker has no business announcing its siblings. */
function armOrphanRecoveryNotice(): void {
	if (PIPIUI_DEPTH !== 0) return;
	const live = new Set(
		[...jobRegistry.values()].filter((job) => job.state === "running").map((job) => job.agentId),
	);
	const orphaned = selectOrphanedSlices(readAgentSliceMetadata(), {
		sessionId: PIPIUI_SESSION_ID,
		liveAgentIds: live,
	});
	pendingOrphanNotice = orphaned.length ? formatOrphanRecoveryNotice(orphaned) : undefined;
}

function takePendingOrphanNotice(): string | undefined {
	const notice = pendingOrphanNotice;
	pendingOrphanNotice = undefined;
	return notice;
}

function rememberAgentSliceTerminal(agentId: string, runId: string, job: JobRecord): void {
	const all = readAgentSliceMetadata();
	const current = all.find((item) => item.agentId === agentId);
	if (!current || (current.runId && current.runId !== runId)) return;
	const resultSummary = (job.resultText ?? "").replace(/\s+/g, " ").trim().slice(0, 4_000);
	writeAgentSliceMetadata([
		{
			...current,
			runId,
			state: job.state,
			...(resultSummary ? { resultSummary } : {}),
			...(job.worktreePath ? { worktreePath: job.worktreePath } : {}),
			...(job.worktreeBranch ? { worktreeBranch: job.worktreeBranch } : {}),
			...(job.integrationState ? { integrationState: job.integrationState } : {}),
			...(job.worktreeFinalization ? { worktreeFinalization: job.worktreeFinalization } : {}),
			updatedAt: Date.now(),
		},
		...all.filter((item) => item.agentId !== agentId),
	]);
}

function formatResumableSection(exclude: Set<string>, full = false): string[] {
	const ids = resumableAgentIds().filter((id) => !exclude.has(id));
	if (ids.length === 0) return [];
	const metadata = new Map(readAgentSliceMetadata().map((item) => [item.agentId, item]));
	const entries = ids.map((id) => ({ agentId: id, ...(metadata.get(id) ?? {}) }));
	return formatResumableSectionLines(entries, full ? entries.length : UNFILTERED_RESUMABLE_CAP);
}

function historicalWorkerCount(exclude: Set<string>): number {
	const stored = new Set(resumableAgentIds());
	return readAgentSliceMetadata().filter((item) => !exclude.has(item.agentId) && !stored.has(item.agentId)).length;
}

function formatHistoricalSection(exclude: Set<string>, cap = 8): string[] {
	const stored = new Set(resumableAgentIds());
	const history = readAgentSliceMetadata()
		.filter((item) => !exclude.has(item.agentId) && !stored.has(item.agentId))
		.slice(0, cap);
	if (history.length === 0) return [];
	const rows = history.map((item) => {
		const task = item.task.replace(/\s+/g, " ").trim().slice(0, 120) || "(task unavailable)";
		const result = item.resultSummary?.replace(/\s+/g, " ").trim().slice(0, 120);
		const state = formatCompactSubagentIntegrationStatus({
			workerState: item.state === "running" ? "interrupted(last-recorded=running)" : (item.state ?? "unknown"),
			integrationState: item.integrationState,
			worktreePath: item.worktreePath,
			worktreeBranch: item.worktreeBranch,
			finalizationSummary: item.worktreeFinalization,
		});
		return `- \`${item.agentId}\` (${item.name}) — ${state}; stored conversation=${stored.has(item.agentId) ? "yes" : "no"}; task=${task}${result ? `; result=${result}` : ""}`;
	});
	return [
		"",
		"Historical workers (persisted task and result summaries; newest first):",
		...rows,
		"The Boss chooses whether this exact agentId belongs to the same semantic work. Inspect it with subagent_status(agentId), then resume that id or deliberately create a new worker; the runtime never fuzzy-matches prose.",
	];
}

function formatJobsStatus(opts: { agentId?: string; onlyRunning?: boolean; full?: boolean }): string {
	const now = Date.now();
	if (opts.agentId) {
		const job = jobRegistry.get(opts.agentId);
		if (!job) {
			const resumable = resumableAgentIds().includes(opts.agentId);
			const historical = readAgentSliceMetadata().find((item) => item.agentId === opts.agentId);
			if (historical) {
				return [
					`agentId: ${opts.agentId}`,
					...(historical.runId ? [`runId: ${historical.runId}`] : []),
					`name: ${historical.name}`,
					...(historical.title ? [`title: ${historical.title}`] : []),
					...(historical.state === "running"
						? ["state: interrupted (not running in this process)", "last recorded state: running", "diagnostics: persisted-running leftover; process generation mismatch"]
						: [`state: ${historical.state ?? "not running in this process"}`]),
					...formatSubagentIntegrationStatus({
						workerState: historical.state === "running" ? "interrupted" : (historical.state ?? "unknown"),
						integrationState: historical.integrationState,
						worktreePath: historical.worktreePath,
						worktreeBranch: historical.worktreeBranch,
						finalizationSummary: historical.worktreeFinalization,
					}),
					`stored conversation: ${resumable ? "yes" : "no"}`,
					`Task: ${historical.task}`,
					...(historical.resultSummary ? ["Result:", opts.full ? historical.resultSummary : truncateTextHead(historical.resultSummary, JOB_RESULT_DISPLAY_CAP)] : []),
					resumable
						? "This worker's stored conversation is intact. Re-dispatch this same agentId to continue it, or choose a new id when the prior approach is poisoned."
						: "This historical result is inspectable, but no stored conversation remains; use it as evidence when deciding the next dispatch.",
				].join("\n");
			}
			if (resumable) {
				return [
					`agentId: ${opts.agentId}`,
					"state: not running in this process, but its stored conversation is intact.",
					"This is an interruption, not a failure — re-dispatch this same agentId to continue where it left off.",
				].join("\n");
			}
			return `No job found for agentId=${opts.agentId}. Use subagent_status without agentId to list recent jobs.`;
		}
		const elapsed =
			job.state === "running"
				? formatElapsedMs(now - job.startedAt)
				: formatElapsedMs((job.endedAt ?? now) - job.startedAt);
		const cost = typeof job.cost === "number" ? `$${job.cost.toFixed(4)}` : "-";
		const turns = job.turns ?? "-";
		const lines = [
			`agentId: ${job.agentId}`,
			`runId: ${job.runId}`,
			`name: ${job.name}`,
			...(job.title ? [`title: ${job.title}`] : []),
			...(job.blockedBy && job.blockedBy.length > 0
				? [`blocked-by: ${job.blockedBy.join(", ")}`]
				: []),
			`state: ${formatJobStateWithStall(job, now)}`,
			...(job.model ? [`model: ${job.model}`] : []),
			...formatSubagentIntegrationStatus({
				workerState: job.state,
				integrationState: job.integrationState,
				worktreePath: job.worktreePath,
				worktreeBranch: job.worktreeBranch,
				finalizationSummary: job.worktreeFinalization,
			}),
			...(handleForRun(job.agentId, job.runId)
				? [`diagnostics: ${formatDiagnosticsCompactLine(diagnosticsSnapshotFor(job.agentId, handleForRun(job.agentId, job.runId)!))}`]
				: job.state === "running"
					? ["diagnostics: persisted-running leftover; not live in this process generation"]
					: []),
			`turns: ${turns}`,
			`cost: ${cost}`,
			`elapsed: ${elapsed}`,
			`Task: ${job.task || "(none)"}`,
		];
		if (isHandledJob(job)) {
			const handledAt = job.closeoutAt ? new Date(job.closeoutAt).toISOString() : "(time unavailable)";
			lines.push(`closeout: cleaned (resolved/handled) at ${handledAt}`);
			lines.push(`reason: ${job.closeoutReason ?? "Boss marked this episode handled"}`);
		}
		if (job.verify) {
			lines.push(`Verify: $ ${job.verify.command} → exit ${formatVerifyExit(job.verify)} (attested)`);
			if (job.verify.tail) {
				lines.push("Verify tail:", ...job.verify.tail.split("\n").map((l) => `  ${l}`));
			}
		}
		if (job.state === "running") {
			lines.push(`activity: ${job.activity || "(starting/idle)"}`);
			const questionDir = questionDirFor(job.agentId, job.runId);
			for (const pending of questionDir ? pendingQuestions(questionDir) : []) {
				lines.push(`question pending: qid=${pending.id} "${pending.question.slice(0, 160)}" — answer with subagent_reply({agentId, runId, answer})`);
			}
			// The measurement the Boss otherwise has to go improvise in a terminal.
			const evidence = cpuEvidenceFor(job.agentId);
			if (evidence) lines.push(`liveness: ${evidence}`);
			// Which file the idle clock is actually reading. Without this the Boss cannot tell a
			// wedged worker from a correct one whose output lands somewhere nobody is watching,
			// and `subagent_progress` would be a guess at what it is replacing.
			const live = handleForRun(job.agentId, job.runId);
			if (live?.progressLogPath) {
				lines.push(
					`progress log: ${live.progressLogPath} — ${
						live.lastProgressLogAt
							? `last grew ${formatElapsedMs(now - live.lastProgressLogAt)} ago`
							: "no growth seen yet"
					}`,
				);
			} else if (live?.progressLogEligible) {
				lines.push(
					`progress log: none — if this worker's real output is appended to a log file, point the idle clock at it with subagent_progress({agentId:"${job.agentId}", runId:"${job.runId}", progressLog:"<path>"})`,
				);
			}
		} else {
			const stored = job.resultText || "(no result stored)";
			// Head-keep like the done message: the report's structured sections come first.
			const result = opts.full ? stored : truncateTextHead(stored, JOB_RESULT_DISPLAY_CAP);
			lines.push("Result:", result);
		}
		return lines.join("\n");
	}

	let jobs = [...jobRegistry.values()];
	if (opts.onlyRunning) jobs = jobs.filter((j) => j.state === "running");
	if (jobs.length === 0) {
		const head = opts.onlyRunning
			? "No running subagent jobs."
			: "No subagent jobs recorded in this process.";
		// A restarted main session has an empty registry while stored conversations remain.
		if (opts.onlyRunning) return head;
		const historical = historicalWorkerCount(new Set());
		return [
			head,
			...formatResumableSection(new Set(), opts.full),
			...formatHistoricalSection(new Set(), opts.full ? historical : 8),
			...formatUnfilteredOmissionNote(0, opts.full ? 0 : Math.max(0, historical - 8)),
		].join("\n");
	}

	// running first, then newest endedAt/startedAt
	jobs.sort((a, b) => {
		const ar = a.state === "running" ? 0 : 1;
		const br = b.state === "running" ? 0 : 1;
		if (ar !== br) return ar - br;
		const at = a.endedAt ?? a.startedAt;
		const bt = b.endedAt ?? b.startedAt;
		return bt - at;
	});

	const selected = selectUnfilteredJobs(jobs);
	const header = `| agentId | runId | name | state | turns | cost | elapsed | preview |`;
	const sep = `| --- | --- | --- | --- | --- | --- | --- | --- |`;
	const rows = selected.listed.map((j) => {
		const elapsed =
			j.state === "running"
				? formatElapsedMs(now - j.startedAt)
				: formatElapsedMs((j.endedAt ?? now) - j.startedAt);
		const cost = typeof j.cost === "number" ? `$${j.cost.toFixed(4)}` : "-";
		const turns = j.turns ?? "-";
		const previewRaw =
			j.state === "running"
				? j.activity || j.task || ""
				: j.resultText || j.task || "";
		const blockedByNote =
			j.blockedBy && j.blockedBy.length > 0 ? `blocked-by: ${j.blockedBy.join(", ")}` : "";
		const handledNote = isHandledJob(j)
			? `handled: ${j.closeoutReason ?? "Boss marked this episode handled"}`
			: "";
		const previewBase = previewRaw.replace(/\s+/g, " ").trim();
		const notes = [blockedByNote, handledNote].filter(Boolean).join(" · ");
		const preview = (notes
			? previewBase
				? `${notes} · ${previewBase}`
				: notes
			: previewBase
		).slice(0, 80);
		const state = formatCompactSubagentIntegrationStatus({
			workerState: formatJobStateWithStall(j, now),
			integrationState: j.integrationState,
			worktreePath: j.worktreePath,
			worktreeBranch: j.worktreeBranch,
			finalizationSummary: j.worktreeFinalization,
		});
		return `| ${j.agentId} | ${j.runId} | ${j.name} | ${state} | ${turns} | ${cost} | ${elapsed} | ${preview || "-"} |`;
	});
	const listedIds = new Set(jobs.map((j) => j.agentId));
	return [
		header,
		sep,
		...rows,
		...formatQueuedSection(now),
		...formatResumableSection(listedIds, opts.full),
		...formatUnfilteredOmissionNote(selected.omittedEnded, historicalWorkerCount(listedIds)),
		...formatUnacknowledgedAlarmSection(),
	].join("\n");
}

/**
 * Armed alarms nobody answered. An alarm that spent its wake budget stops
 * re-waking the Boss, which makes status the only place it can still be found.
 */
function formatUnacknowledgedAlarmSection(): string[] {
	const lines = formatUnacknowledgedAlarmLines(
		[...pendingDone.values()].map((entry) => entry.obligation),
	);
	return lines.length ? ["", ...lines] : [];
}

/**
 * Work already handed over that has not started: waiting for a slot, waiting for a declared
 * predecessor, or held because one failed. Listed because "what did I dispatch?" must be
 * answerable from status alone — that is the whole point of the boss not carrying it.
 */
function formatQueuedSection(now: number): string[] {
	const queued = dispatchQueue.snapshot();
	if (queued.length === 0) return [];
	return ["", `Queued (not started, ${queued.length}):`, ...formatQueuedDispatches(queued, now).map((l) => `  ${l}`)];
}

/**
 * A worker's id is what the boss has to type back to continue with the same worker, so it is
 * chosen by the boss and kept short and meaningful: `quota-pill`, not `agent-ms1mo5dx-pn6o1l`.
 * Long random ids drift when a model retypes them, and a drifted id silently becomes a new
 * worker with an empty head — the exact failure this naming exists to prevent.
 *
 * Also lands verbatim in a git branch (`pipiui/<id>`) and a session filename, so the character
 * set is the intersection of "safe there" and "hard to mistype".
 *
 * Identity contract: nothing here ever generates an agentId. Every dispatch — single,
 * tasks/parallel, chain, read-only or writable — must carry an explicit caller-chosen id;
 * runSingleAgent rejects a missing one instead of inventing `agent-<random>`. Randomness
 * stays correct only for the one-shot runId (DeliveryObligationStore.runId).
 */
// PIPIUI_PURE_AGENT_ID_BEGIN
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,23}$/;
const RESERVED_AGENT_IDS = new Set(["root", "main", "head", "master"]);
/** Shape of the retired generator ("agent-" + 16 lowercase hex chars): banned for new dispatch. */
const LEGACY_GENERATED_AGENT_ID_PATTERN = /^agent-[0-9a-f]{16}$/;

/** True only for the exact retired random-generator shape. Historical ids stay operable via abort/resolve/status. */
export function isLegacyGeneratedAgentId(id: string): boolean {
	return LEGACY_GENERATED_AGENT_ID_PATTERN.test(id);
}

/** Returns an error addressed to the model, or null when the id is usable. */
function validateAgentId(id: string): string | null {
	if (!AGENT_ID_PATTERN.test(id)) {
		return `Invalid agentId ${JSON.stringify(id)}. Use 2-24 chars of lowercase letters, digits, "-" or "_", starting with a letter or digit — a short name for this worker, e.g. "quota-pill".`;
	}
	if (RESERVED_AGENT_IDS.has(id)) {
		return `agentId ${JSON.stringify(id)} is reserved. Pick another short name.`;
	}
	if (id.includes("..")) {
		return `agentId ${JSON.stringify(id)} must not contain "..".`;
	}
	return null;
}

interface CallerAgentIdSelection {
	ids: string[];
	problem?: string;
}

/** Pure request gate: validates, de-duplicates, and excludes every currently active id. */
export function selectCallerAgentIds(
	candidates: readonly (string | undefined)[],
	activeIds: ReadonlySet<string>,
): CallerAgentIdSelection {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (candidate === undefined) continue;
		const normalized = candidate.trim();
		const invalid = validateAgentId(normalized);
		if (invalid) return { ids, problem: invalid };
		if (seen.has(normalized)) {
			return {
				ids,
				problem: `Duplicate agentId ${JSON.stringify(normalized)} in one request. Each dispatched worker must have a unique id.`,
			};
		}
		if (activeIds.has(normalized)) {
			return {
				ids,
				problem: `agentId ${JSON.stringify(normalized)} is already running. Wait for it to finish or abort it before resuming that worker.`,
			};
		}
		seen.add(normalized);
		ids.push(normalized);
	}
	return { ids };
}

/**
 * A worker that gets a worktree also gets `pipiui/<agentId>` as a real branch, so an unnamed
 * writable worker stamps an unidentified id onto the repository forever. The dispatch gate
 * already rejects a missing agentId for every form; this pure helper keeps the writable-role
 * specific wording available (and tested) for callers that want it.
 *
 * Pure: `createsWorktree` is injected so this stays testable without an agent catalog.
 */
export function unnamedWritableDispatchProblem(
	targets: readonly { agent: string; agentId?: string; worktree?: "isolated" | "none" }[],
	createsWorktree: (target: { agent: string; agentId?: string; worktree?: "isolated" | "none" }) => boolean,
): string | null {
	const unnamed = targets.filter((target) => !target.agentId?.trim() && createsWorktree(target));
	if (unnamed.length === 0) return null;
	const names = [...new Set(unnamed.map((target) => `"${target.agent}"`))].join(", ");
	return `Missing agentId for ${names}. A worker that writes code gets its own git branch named pipiui/<agentId>, so it needs a short semantic id naming the slice — e.g. "quota-pill", "doc-panel" (2-24 chars: lowercase letters, digits, "-", "_"). Re-dispatch with one agentId per writable task. Read-only roles may still omit it.`;
}

/**
 * Pure identity gate shared by every dispatch form (single / tasks / chain) before any
 * reservation: rejects a missing id, an agentId/resume_from conflict, and the retired
 * random-generator shape when no historical worker with that id actually exists.
 * `isResumable` is injected so this stays testable without the job registry.
 */
export function dispatchIdentityGateProblem(input: {
	targets: ReadonlyArray<{ agentId?: string; fresh?: boolean; agentName?: string; label: string }>;
	agentId?: string;
	resumeFrom?: string;
	/** Per-dispatch fresh flag (single form). Chain/task items carry their own. */
	fresh?: boolean;
	/**
	 * Actual resumability for one id under the ROLE it is being dispatched as: a retained
	 * session file exists AND this dispatch's runner would actually open it. Read-only
	 * roles force `--no-session` (their one-shot reports are ephemeral by design), so a
	 * stray file named after the id is not context that run will reuse.
	 */
	isResumable: (agentId: string, agentName: string | undefined) => boolean;
}): string | null {
	if (
		input.agentId?.trim() &&
		input.resumeFrom?.trim() &&
		input.agentId.trim() !== input.resumeFrom.trim()
	) {
		return `Conflicting identity: agentId ${JSON.stringify(input.agentId.trim())} and resume_from ${JSON.stringify(input.resumeFrom!.trim())} differ. To resume that worker, pass agentId ${JSON.stringify(input.resumeFrom!.trim())} (drop resume_from); for new work pick a fresh short semantic agentId.`;
	}
	for (const target of input.targets) {
		const id = target.agentId?.trim();
		if (!id) {
			return `Missing agentId for ${target.label}. Every dispatched worker needs a short semantic id you choose — e.g. "quota-pill", "doc-panel" (2-24 chars: lowercase letters, digits, "-", "_"). Re-dispatch with one agentId per worker; reusing an agentId resumes that worker (add fresh:true to start it cold).`;
		}
		if (isLegacyGeneratedAgentId(id)) {
			// Continuation-only: the retired generated shape may be used solely to resume a
			// worker that actually exists, with its stored context. fresh:true (cold start) or a
			// brand-new worker under this shape would recreate exactly the opaque identity this
			// contract retired — reject both. abort/resolve/status never pass through this gate.
			const fresh = target.fresh ?? input.fresh;
			if (fresh === true) {
				return `agentId ${JSON.stringify(id)} has the retired auto-generated shape and cannot be started cold. If you meant a new worker, pick a fresh short semantic id you choose — e.g. "quota-pill"; if you meant to discard that worker's context, resolve/abandon the episode and re-dispatch new work under a new semantic id.`;
			}
			if (!input.isResumable(id, target.agentName)) {
				return `agentId ${JSON.stringify(id)} has the retired auto-generated shape (agent-<random hex>) and is not resumable here: continuation requires a retained session this dispatch's role will actually reopen (writable/context-retaining workers only). Pick a fresh short semantic id you choose — e.g. "quota-pill". Historical ids of that shape remain operable with subagent_status / subagent_resolve / exact-run abort.`;
			}
		}
	}
	return null;
}

/**
 * Chain bookkeeping: ids of steps never handed to runSingleAgent. Each handed-over step
 * releases its own reservation in runSingleAgent's finally, so only the tail leaks when a
 * chain stops early — release exactly that tail.
 */
export function unstartedChainReservationIds(
	steps: ReadonlyArray<{ agentId?: string }>,
	dispatchedCount: number,
): string[] {
	const ids: string[] = [];
	for (let i = Math.max(0, dispatchedCount); i < steps.length; i++) {
		const id = steps[i]?.agentId?.trim();
		if (id) ids.push(id);
	}
	return ids;
}

/** Selector + synchronous reservation is one operation from the event loop's perspective. */
function selectAndReserveCallerAgentIds(
	candidates: readonly (string | undefined)[],
	activeIds: ReadonlySet<string>,
	reservations: Set<string>,
): CallerAgentIdSelection {
	const selection = selectCallerAgentIds(candidates, activeIds);
	if (selection.problem) return selection;
	for (const id of selection.ids) reservations.add(id);
	return selection;
}
// PIPIUI_PURE_AGENT_ID_END

/**
 * Where a reusable worker's conversation lives. Deliberately under the main project rather
 * than the worker's own cwd: that cwd is a worktree, and a successful merge deletes it — which
 * would throw away the context on exactly the runs that went well.
 */
/**
 * Retention for stored worker conversations.
 *
 * Deliberately conservative in both directions. Deleting one throws away the context that
 * makes continuing a worker worth anything, so age is the only "this is finished" signal
 * trusted here: a merged slice is often continued the next day, while a worker nobody has
 * touched in two weeks is reasoning about code that has since moved on. The count cap only
 * exists so a burst of short-lived workers cannot grow the directory without bound.
 */
// PIPIUI_PURE_SESSION_RETENTION_BEGIN
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_MAX_KEEP = 1000;
const SESSION_PRUNE_COMPLETION_INTERVAL = 256;
const SESSION_PRUNE_TIME_INTERVAL_MS = 5 * 60 * 1000;

interface StoredSession {
	name: string;
	agentId: string;
	mtimeMs: number;
}

/** Pure so the retention rule can be tested without touching a filesystem. */
function selectStaleSessions(
	entries: StoredSession[],
	opts: { now: number; maxAgeMs: number; maxKeep: number; running: Set<string> },
): string[] {
	const candidates = entries.filter((e) => !opts.running.has(e.agentId));
	const stale = new Set(
		candidates.filter((e) => opts.now - e.mtimeMs > opts.maxAgeMs).map((e) => e.name),
	);
	// Newest first, then anything past the cap goes too.
	const survivors = candidates
		.filter((e) => !stale.has(e.name))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
	for (const extra of survivors.slice(opts.maxKeep)) stale.add(extra.name);
	return [...stale];
}

interface SessionPruneSchedule {
	hasPruned: boolean;
	completionsSincePrune: number;
	lastPrunedAt: number;
}

/** Pure amortization policy: first access, every completed wave slice, or elapsed interval. */
function nextSessionPruneSchedule(
	state: SessionPruneSchedule,
	trigger: "access" | "completed",
	now: number,
): { state: SessionPruneSchedule; shouldPrune: boolean } {
	const completionsSincePrune =
		state.completionsSincePrune + (trigger === "completed" ? 1 : 0);
	const shouldPrune =
		!state.hasPruned ||
		completionsSincePrune >= SESSION_PRUNE_COMPLETION_INTERVAL ||
		now - state.lastPrunedAt >= SESSION_PRUNE_TIME_INTERVAL_MS;
	return {
		shouldPrune,
		state: shouldPrune
			? { hasPruned: true, completionsSincePrune: 0, lastPrunedAt: now }
			: { ...state, completionsSincePrune },
	};
}
// PIPIUI_PURE_SESSION_RETENTION_END

const SESSION_PRUNE_IO_BATCH = 64;

function yieldSessionPruneIO(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

// PIPIUI_PURE_ASYNC_BATCH_BEGIN
async function mapSessionPruneBatches<T, R>(
	items: readonly T[],
	batchSize: number,
	fn: (item: T) => Promise<R>,
	yieldBetween: () => Promise<void>,
): Promise<R[]> {
	const results: R[] = [];
	for (let offset = 0; offset < items.length; offset += batchSize) {
		results.push(...(await Promise.all(items.slice(offset, offset + batchSize).map(fn))));
		await yieldBetween();
	}
	return results;
}
// PIPIUI_PURE_ASYNC_BATCH_END

// PIPIUI_PURE_SESSION_REMOVE_GUARD_BEGIN
async function removeSessionWithLeaseGuard<TLease>(
	entry: StoredSession,
	isLocallyActive: () => boolean,
	acquireLease: () => TLease | undefined,
	releaseLease: (lease: TLease) => void,
	readCurrentMtime: () => Promise<number | undefined>,
	remove: () => Promise<void>,
): Promise<boolean> {
	// Close both race windows: activity may begin after the original directory snapshot,
	// and another Pi process may begin between this local check and deletion.
	if (isLocallyActive()) return false;
	const lease = acquireLease();
	if (!lease) return false;
	try {
		if (isLocallyActive()) return false;
		if ((await readCurrentMtime()) !== entry.mtimeMs) return false;
		await remove();
		return true;
	} finally {
		releaseLease(lease);
	}
}
// PIPIUI_PURE_SESSION_REMOVE_GUARD_END

async function readStoredSessions(dir: string): Promise<StoredSession[]> {
	let names: string[];
	try {
		names = await fs.promises.readdir(dir);
	} catch {
		return [];
	}
	const entries = await mapSessionPruneBatches(
		names,
		SESSION_PRUNE_IO_BATCH,
		async (name) => {
				const agentId = /_pipiui-(.+)\.jsonl$/.exec(name)?.[1];
				if (!agentId) return undefined;
				try {
					return { name, agentId, mtimeMs: (await fs.promises.stat(path.join(dir, name))).mtimeMs };
				} catch {
					return undefined;
				}
		},
		yieldSessionPruneIO,
	);
	return entries.filter((entry): entry is StoredSession => Boolean(entry));
}

async function leasedAgentIds(): Promise<Set<string>> {
	if (!PIPIUI_MAIN_CWD) return new Set();
	try {
		const names = await fs.promises.readdir(path.join(PIPIUI_MAIN_CWD, ".pi", "agent-leases"));
		return new Set(
			names
				.map((name) => /^(.*)\.lease$/.exec(name)?.[1])
				.filter((id): id is string => Boolean(id)),
		);
	} catch {
		return new Set();
	}
}

function isAgentLocallyActiveForSessionPrune(agentId: string): boolean {
	return (
		localAgentReservations.has(agentId) ||
		runningAgents.has(agentId) ||
		jobRegistry.get(agentId)?.state === "running"
	);
}

let sessionPruneSchedule: SessionPruneSchedule = {
	hasPruned: false,
	completionsSincePrune: 0,
	lastPrunedAt: 0,
};
let sessionPruneFlight: Promise<void> | undefined;
let sessionPruneRerun = false;
let sessionPruneRerunDir: string | undefined;

async function performAgentSessionPrune(dir: string): Promise<void> {
	if (!PIPIUI_MAIN_CWD) return;
	const running = new Set<string>([
		...localAgentReservations,
		...runningAgents.keys(),
		...[...jobRegistry.values()]
			.filter((j) => j.state === "running")
			.map((j) => j.agentId),
		...(await leasedAgentIds()),
	]);
	const stored = await readStoredSessions(dir);
	const staleNames = selectStaleSessions(stored, {
		now: Date.now(),
		maxAgeMs: SESSION_MAX_AGE_MS,
		maxKeep: SESSION_MAX_KEEP,
		running,
	});
	const stale = stored.filter((entry) => staleNames.includes(entry.name));
	await mapSessionPruneBatches(
		stale,
		SESSION_PRUNE_IO_BATCH,
		async (entry) => {
			const file = path.join(dir, entry.name);
			try {
				await removeSessionWithLeaseGuard(
					entry,
					() => isAgentLocallyActiveForSessionPrune(entry.agentId),
					() => acquireAgentLease(path.resolve(PIPIUI_MAIN_CWD), entry.agentId).lease,
					releaseAgentLease,
					async () => {
						try {
							return (await fs.promises.stat(file)).mtimeMs;
						} catch {
							return undefined;
						}
					},
					async () => fs.promises.rm(file),
				);
			} catch {
					// A file we cannot remove only costs disk; never fail a dispatch over housekeeping.
				}
		},
		yieldSessionPruneIO,
	);
}

function launchAgentSessionPrune(dir: string): void {
	sessionPruneFlight = performAgentSessionPrune(dir)
		.catch((err) => console.error("[pipiui-subagent] session housekeeping failed:", err))
		.finally(() => {
			sessionPruneFlight = undefined;
			if (!sessionPruneRerun) return;
			sessionPruneRerun = false;
			const rerunDir = sessionPruneRerunDir ?? dir;
			sessionPruneRerunDir = undefined;
			launchAgentSessionPrune(rerunDir);
		});
}

/** Amortized, single-flight housekeeping: no synchronous directory scan blocks dispatch. */
function pruneAgentSessions(dir: string, trigger: "access" | "completed"): void {
	const decision = nextSessionPruneSchedule(sessionPruneSchedule, trigger, Date.now());
	sessionPruneSchedule = decision.state;
	if (!decision.shouldPrune) return;
	if (sessionPruneFlight) {
		sessionPruneRerun = true;
		sessionPruneRerunDir = dir;
		return;
	}
	launchAgentSessionPrune(dir);
}


function agentSessionDir(): string | undefined {
	// Survive worktree cleanup: pin worker JSONL at the canonical project root, not
	// the session workspace (MAIN_CWD). Fall back to MAIN_CWD when PROJECT_ROOT is
	// unset — same intent as the original MAIN_CWD pin, never the worker's own cwd.
	const root = resolveAgentSessionRoot(PIPIUI_PROJECT_ROOT, PIPIUI_MAIN_CWD);
	if (!root) return undefined;
	const dir = path.join(root, ".pi", "agent-sessions");
	try {
		fs.mkdirSync(dir, { recursive: true });
		pruneAgentSessions(dir, "access");
		return dir;
	} catch {
		return undefined;
	}
}

/** pi writes `<timestamp>_<sessionId>.jsonl`, so presence is a suffix match. */
function agentSessionExists(dir: string, sessionId: string): boolean {
	try {
		return fs.readdirSync(dir).some((f) => f.endsWith(`_${sessionId}.jsonl`));
	} catch {
		return false;
	}
}

function agentSessionFiles(dir: string, sessionId: string): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(`_${sessionId}.jsonl`))
			.map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

/**
 * A writable worker resumes its `pipiui-<agentId>` session across dispatches, but Pi's
 * `SessionManager.open(oldFile)` derives the resumed session cwd from the session HEADER's `cwd`
 * field (`cwdOverride ?? header.cwd ?? process.cwd()`), never from the spawn directory — the
 * embedded CLI exposes no `--cwd` flag and no env-based cwd override (dist/cli/args.js,
 * dist/core/session-manager.js). A stale header (a previous dispatch that ran in the main checkout
 * or a removed worktree) would pin the resumed child to the OLD cwd: it writes files there while
 * our post-verify runs in this dispatch's worktree, so a correct change gets misreported
 * verified=fail. Rewriting ONLY the first-line `cwd` field to this dispatch's spawnCwd (canonicalized
 * via realpath, matching the child's process.cwd() verbatim) pins the resumed session back to the
 * worktree. Idempotent: no-op when the header cwd already equals the target; never touches any other
 * line; atomic (temp file + rename); any failure only skips the alignment — resume proceeds exactly
 * as before. Called for the writable + isolated-worktree + resuming branch, right before spawn.
 */
function alignResumedSessionCwd(sessionDir: string, sessionId: string, spawnCwd: string): void {
	try {
		const files = agentSessionFiles(sessionDir, sessionId);
		if (files.length === 0) return;
		// The child's exact-id lookup resumes the newest matching file (mtime desc), so align that one.
		let file = files[0];
		let newest = -1;
		for (const f of files) {
			const m = fs.statSync(f).mtimeMs;
			if (m > newest) {
				newest = m;
				file = f;
			}
		}
		// Write the canonical realpath: pi compares `resolvePath(childCwd)` (i.e. the OS-canonical
		// process.cwd()) with the header cwd verbatim, so a symlinked spawnCwd must be canonicalized
		// here or the child's exact-id lookup would miss the session again (e.g. /tmp → /private/tmp).
		let targetCwd = spawnCwd;
		try {
			targetCwd = fs.realpathSync(spawnCwd) ?? spawnCwd;
		} catch {
			// Worktree may not exist yet; keep the raw spawnCwd.
		}
		const raw = fs.readFileSync(file, "utf8");
		const firstLine = raw.split("\n", 1)[0]; // pi writes the session header as the first line
		let header: any;
		try {
			header = JSON.parse(firstLine);
		} catch {
			return; // unparseable header → leave the file untouched
		}
		if (!header || typeof header !== "object" || header.type !== "session") return;
		if (typeof header.cwd === "string" && header.cwd === targetCwd) return; // already aligned → no-op
		// Re-serialize only the header line with the new cwd; append the rest byte-for-byte.
		const updated = JSON.stringify({ ...header, cwd: targetCwd }) + raw.slice(firstLine.length);
		if (updated === raw) return;
		const tmp = `${file}.align-${process.pid}`;
		fs.writeFileSync(tmp, updated, "utf8");
		fs.renameSync(tmp, file);
	} catch {
		// Best effort: alignment must never block a resume.
	}
}

/** 8-char hex id for a compaction entry (matches pi's own compaction id shape). */
function compactionEntryId(): string {
	try {
		return randomBytes(4).toString("hex");
	} catch {
		return Math.floor(Math.random() * 0xffffffff)
			.toString(16)
			.padStart(8, "0");
	}
}

/**
 * A message entry's user-role text (string content or first text block).
 */
function entryUserText(entry: any): string {
	if (entry?.type !== "message" || entry.message?.role !== "user") return "";
	const content = entry.message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const block = content.find((b: any) => b?.type === "text" && typeof b.text === "string");
		if (block) return block.text;
	}
	return "";
}

/**
 * Per-message size estimate for the kept-tail walk: pi's own chars/4 heuristic over
 * the entry's own content (text/thinking/toolCall args; images ≈1200 tokens). Never
 * usage.totalTokens — that field is the cumulative context size at that point, so
 * accumulating it in an 80k+ context saturated the budget after one assistant
 * message and shrank the kept window to the tail of a single turn.
 */
function estimateMessageEntryTokens(entry: any): number {
	const message = entry?.message;
	if (!message) return 0;
	let chars = 0;
	const content = message.content;
	if (typeof content === "string") {
		chars = content.length;
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			if (block.type === "text" && typeof block.text === "string") chars += block.text.length;
			else if (block.type === "thinking" && typeof block.thinking === "string") chars += block.thinking.length;
			else if (block.type === "image") chars += AUTO_COMPACT_IMAGE_CHARS;
			else if (block.type === "toolCall") {
				chars += String(block.name ?? "").length;
				try {
					chars += JSON.stringify(block.arguments ?? {}).length;
				} catch {
					// Unserializable args only undercount this one message.
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

function clipAutoCompactText(text: string): string {
	const value = (text ?? "").trim();
	if (value.length <= AUTO_COMPACT_TASK_SUMMARY_CHARS) return value;
	return `${value.slice(0, AUTO_COMPACT_TASK_SUMMARY_CHARS - 1).trimEnd()}…`;
}

/**
 * Append a pi-native `{"type":"compaction",...}` entry to the session jsonl before an
 * auto-resume re-spawn, so the worker restarts from a compacted context instead of dying
 * on a full one. Append-only: never rewrites the file, never breaks the parent chain —
 * pi's buildContextEntries drops everything before `firstKeptEntryId` on resume and renders
 * `summary` as one user text. Any failure returns false: compaction must never block resume.
 *
 * The summary MUST carry the CURRENT dispatch's task (`taskText`). A worker session is
 * reused across dispatches (`--session-id pipiui-<agentId>`), so the chain's first user
 * message is usually an OLDER dispatch's task; a resumed worker that only sees it loses
 * the job it was actually running. Empty `taskText` falls back to the latest
 * "Task:"-prefixed user message, then the first user message.
 */
export function appendSessionCompaction(
	sessionDir: string,
	sessionId: string,
	taskText: string,
	lastContextTokens: number,
): boolean {
	try {
		const files = agentSessionFiles(sessionDir, sessionId);
		if (files.length === 0) return false;
		const lines = fs.readFileSync(files[files.length - 1], "utf8").split("\n");
		const entries: any[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				entries.push(JSON.parse(trimmed));
			} catch {
				// Bad line: pi's loader skips it, so do we.
			}
		}
		// No parseable header, or first entry is not a session header → treat file as empty.
		if (entries.length === 0 || entries[0]?.type !== "session") return false;

		// leafId = id of the last non-session entry (message / compaction / branch_summary …).
		let leafId: string | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].type !== "session") {
				leafId = entries[i].id;
				break;
			}
		}
		if (!leafId) return false;

		// Walk the parent chain root → leaf once; it serves both the keep-set and the summary.
		const byId = new Map<string, any>();
		for (const e of entries) if (e.id) byId.set(e.id, e);
		const chain: any[] = [];
		let cur: any = byId.get(leafId);
		while (cur) {
			chain.push(cur);
			cur = cur.parentId ? byId.get(cur.parentId) : undefined;
		}
		chain.reverse();

		// Walk the chain backwards from the leaf, estimating each message by its own
		// content size, until KEEP_TOKENS or MAX_MESSAGES. firstKeptEntryId is therefore
		// a real ~20k-token tail, not the last few entries of one turn.
		const kept: any[] = [];
		let acc = 0;
		for (let i = chain.length - 1; i >= 0; i--) {
			if (chain[i].type !== "message") continue;
			kept.push(chain[i]);
			acc += estimateMessageEntryTokens(chain[i]);
			if (acc >= AUTO_COMPACT_KEEP_TOKENS || kept.length >= AUTO_COMPACT_MAX_MESSAGES) break;
		}
		kept.reverse(); // kept[0] = earliest kept message
		if (kept.length < AUTO_COMPACT_MIN_MESSAGES) return false;
		const firstKeptEntryId = kept[0].id;

		const fallbackTask =
			entryUserText([...chain].reverse().find((e) => entryUserText(e).startsWith("Task:")))
			|| entryUserText(chain.find((e) => entryUserText(e)));
		const taskSummary = clipAutoCompactText(
			(typeof taskText === "string" && taskText.trim()) || fallbackTask,
		);
		const summary = taskSummary
			? `当前任务（本次派发）：\n${taskSummary}\n\n[pipiui] 早期上下文已压缩；以上是当前任务全文，请基于它继续。被压缩掉的原始记录可用 session_recall 工具检索本会话 JSONL。`
			: "任务描述见上方会话开头（已压缩）。";

		fs.appendFileSync(
			files[files.length - 1],
			"\n" +
				JSON.stringify({
					type: "compaction",
					id: compactionEntryId(),
					parentId: leafId,
					timestamp: new Date().toISOString(),
					summary,
					firstKeptEntryId,
					tokensBefore: lastContextTokens,
				}) +
				"\n",
		);
		return true;
	} catch {
		return false;
	}
}


async function sendUserMessageAfterCutIn(
	pi: ExtensionAPI,
	text: string,
	shouldSend?: () => boolean,
): Promise<boolean> {
	// Host-stop quiet: reminders/heartbeats/escalations must not restart a stopped
	// session. They are dropped for this cycle; the boss can still see every job
	// state through subagent_status and the Subagents panel.
	if (hostStopQuiet) return false;
	if (!admitOrHoldRuntimeSignal(text, shouldSend)) return false;
	// A resolved episode may have been queued behind the cut-in hold. Re-check immediately
	// before each actual send so resolve can suppress that stale reminder.
	if (shouldSend && !shouldSend()) return false;
	try {
		await pi.sendUserMessage(text, { deliverAs: "followUp" });
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// A live turn without deliverAs is the exact Pi error the host must never
		// surface. Only fall back when this Pi build does not understand deliverAs.
		if (message.includes("already processing") || !/unknown|unexpected|deliverAs|options/i.test(message)) {
			console.error("[pipiui-subagent] failed to deliver message:", err);
			return false;
		}
	}
	if (shouldSend && !shouldSend()) return false;
	try {
		await pi.sendUserMessage(text);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] failed to deliver message:", err);
		return false;
	}
}

async function trySendUserMessage(
	pi: ExtensionAPI,
	text: string,
	shouldSend?: () => boolean,
): Promise<boolean> {
	// 插队保护：用户批量消息未进 turn 前，自动信号不得抢跑（超时自动释放）。
	await awaitCutInHoldRelease();
	if (shouldSend && !shouldSend()) return false;
	const routed = await routeRuntimeSignalThroughSupervisor(text);
	if (routed === "accepted") return true;
	// The Supervisor has retained a pending durable receipt. Do not fall through
	// to a second Boss admission attempt, and let heartbeat/stall callers retry.
	if (routed === "pending") return false;
	return sendUserMessageAfterCutIn(pi, text, shouldSend);
}


// ---------------------------------------------------------------------------
// Runtime-owned worktree merge recovery (Swift SubagentStore parity, host-free)
// ---------------------------------------------------------------------------

// Boss escalation rides the same cut-in-safe channel as interrupted reminders; the binding
// happens once in export default, so the module-level recovery loop works without a host.
let worktreeRecoveryPi: ExtensionAPI | undefined;
const baseAdvanceDeduper = new BaseAdvanceDeduper();
const tipPreflightTracker = createTipPreflightTracker();

export function bindWorktreeRecoveryEscalation(pi: ExtensionAPI): void {
	worktreeRecoveryPi = pi;
}

async function notifyInflightWorkersOfBaseAdvance(event: WorktreeMergedEventV1): Promise<void> {
	try {
		const workers = [...runningAgents.entries()].map(([agentId, handle]) => ({
			agentId,
			worktreePath: handle.worktreePath,
			branch: handle.worktreeBranch,
			readOnly: handle.readOnly || handle.finalizing,
		}));
		const alerts = await evaluateBaseAdvanceAlerts({
			mainCwd: event.mainCwd,
			landedFiles: event.landedFiles,
			workers,
			skipAgentId: event.agentId,
		});
		const pi = worktreeRecoveryPi;
		if (!pi) return;
		for (const alert of alerts) {
			const detail = `${alert.overlap.join(",")}|${alert.conflicts.join(",")}`;
			if (!baseAdvanceDeduper.shouldInject(alert.agentId, detail)) continue;
			void trySendUserMessage(pi, formatBaseAdvancedSignal(alert));
		}
	} catch (error) {
		console.error("[pipiui-subagent] base-advance broadcast failed:", error);
	}
}

function tickInflightMergePreflight(): void {
	const mainCwd = PIPIUI_MAIN_CWD;
	const pi = worktreeRecoveryPi;
	if (!mainCwd || !pi) return;
	for (const [agentId, handle] of runningAgents) {
		if (handle.finalizing || handle.readOnly || !handle.worktreePath || !handle.worktreeBranch) continue;
		void tipPreflightTracker
			.onTick({ agentId, mainCwd, branch: handle.worktreeBranch })
			.then((flip) => {
				if (!flip) return;
				const detail = `preflight|${flip.conflictPaths.join(",")}`;
				if (!baseAdvanceDeduper.shouldInject(agentId, detail)) return;
				void trySendUserMessage(
					pi,
					formatPreflightConflictSignal({ agentId, conflictPaths: flip.conflictPaths }),
				);
			})
			.catch((error) => {
				console.error("[pipiui-subagent] heartbeat preflight failed:", error);
			});
	}
}

function escalateWorktreeFailureToBoss(text: string): void {
	if (!worktreeRecoveryPi) return;
	void trySendUserMessage(worktreeRecoveryPi, text);
}

function currentWorktreeRecoveryStore(): WorktreeRecoveryStoreV1 | undefined {
	if (!PIPIUI_MAIN_CWD) return undefined;
	return new WorktreeRecoveryStoreV1(worktreeRecoveryStorePath(PIPIUI_MAIN_CWD, PIPIUI_SESSION));
}

/**
 * Runtime recovery resume, shared by /subagent_recover and the automatic loop: it reuses the
 * original agentId so worktree placement and the session both carry over (fixer semantics).
 */
function recoverWorktreeIntegration(
	cwd: string,
	agentId: string,
	requestedName = "",
	fresh = false,
	verifyCommand?: string,
): void {
	if (jobRegistry.get(agentId)?.state === "running") return;
	const previous = jobRegistry.get(agentId);
	const discovery = discoverAgents(cwd, "both");
	const agentName = previous?.name ?? requestedName;
	if (!agentName || !discovery.agents.some((agent) => agent.name === agentName)) return;
	const task = [
		"Runtime recovery for the worktree integration failure. Continue the existing task in the existing worktree.",
		"Integrate the current main HEAD, resolve any committed-tree conflict, run the original verification, then finish normally.",
		"Do not ask the user for Git operations and do not use stash, reset, or clean.",
	].join(" ");
	// The terminal path dispatches recovery BEFORE the settling run's own finally releases its
	// cross-process agentId lease, so a same-agentId resume must tolerate one busy-lease window:
	// retry briefly instead of dropping the recovery on the floor.
	void (async () => {
		for (let leaseWait = 0; leaseWait < 20; leaseWait += 1) {
			if (leaseWait > 0) await new Promise((resolveTimer) => setTimeout(resolveTimer, 1_000));
			const result = await runSingleAgent(cwd, discovery.agents, agentName, task, undefined, undefined, undefined, undefined,
				(results) => ({ mode: "single", agentScope: "both", projectAgentsDir: discovery.projectAgentsDir, results }),
				{ toolCallId: null, agentId, background: true, fresh, title: previous?.title, verify: verifyCommand ?? previous?.verify?.command });
			const leaseBusy = result.stopReason === "error"
				&& typeof result.errorMessage === "string"
				&& result.errorMessage.includes("already running in Pi process");
			if (!leaseBusy) return;
		}
	})().catch(() => {
		/* fire-and-forget dispatch: failures surface through the job registry */
	});
}

interface WorktreeRecoveryInfo {
	agentId: string;
	name?: string;
	branch?: string;
	worktreePath?: string;
	verifyCommand?: string;
}

function worktreeRecoveryContext(
	store: WorktreeRecoveryStoreV1,
	state: WorktreeFinalizationStateV1,
	info: WorktreeRecoveryInfo,
) {
	return {
		agentId: info.agentId,
		name: info.name,
		mainCwd: PIPIUI_MAIN_CWD,
		branch: info.branch,
		worktreePath: info.worktreePath,
		verifyCommand: info.verifyCommand,
		state,
		depth: PIPIUI_DEPTH,
		dispatchRecovery: (dispatch: { agentId: string; name?: string; fresh: boolean; verifyCommand?: string }) =>
			recoverWorktreeIntegration(PIPIUI_MAIN_CWD ?? process.cwd(), dispatch.agentId, dispatch.name ?? "", dispatch.fresh, dispatch.verifyCommand),
		escalate: escalateWorktreeFailureToBoss,
		retryFinalization: async (retained: WorktreeFinalizationStateV1) => {
			// Re-run the audited service with the shell runner attached, then feed the settled
			// state back into the loop so a retry outcome still escalates or clears correctly.
			const [{ requestGitWorktreeServiceProviderV1 }, { piPostMergeVerifyRunner }] = await Promise.all([
				import("../../extensions/git-capability/host/worktree/provider.ts"),
				import("./worktree-finalize.ts"),
			]);
			const provider = requestGitWorktreeServiceProviderV1();
			if (!provider) throw new Error("git-capability worktree provider is unavailable; finalization retry is retained");
			const next = await provider.createFinalizationService({
				postMergeVerify: piPostMergeVerifyRunner,
				onMerged: (event) => notifyInflightWorkersOfBaseAdvance(event),
			}).retry(retained);
			applyWorktreeRecovery(next, info);
		},
	};
}

/** Feed one terminal finalization into the recovery loop (no-op when pi is not the finalizer's owner process). */
function applyWorktreeRecovery(state: WorktreeFinalizationStateV1, info: WorktreeRecoveryInfo): WorktreeRecoveryAction | undefined {
	const store = currentWorktreeRecoveryStore();
	if (!store) return undefined;
	return scheduleWorktreeRecovery(store, worktreeRecoveryContext(store, state, info));
}

/**
 * Restart rebuild of the loop (Swift dispatchPersistedRecoveryIfNeeded parity), Boss depth only:
 * a retained waiting-for-main record re-arms the retry window, and an in-flight claim without a
 * settled terminal re-dispatches exactly once (dispatch itself is idempotent per agentId).
 */
function resumePersistedWorktreeRecovery(): void {
	if (PIPIUI_DEPTH !== 0) return;
	const store = currentWorktreeRecoveryStore();
	if (!store) return;
	for (const [agentId, record] of Object.entries(store.load().records)) {
		if (record.waitingState) {
			scheduleWaitingForMainRetry(store, worktreeRecoveryContext(store, record.waitingState, { agentId, name: record.name }));
		} else if (record.inFlight) {
			// Ledgers written before the name field existed still resolve their role via the
			// persisted slice table; a totally unknown role simply skips instead of guessing.
			const sliceName = record.name ?? readAgentSliceMetadata().find((entry) => entry.agentId === agentId)?.name ?? "";
			recoverWorktreeIntegration(PIPIUI_MAIN_CWD ?? process.cwd(), agentId, sliceName, record.fresh);
		}
	}
}


/**
 * A reminder can wait behind a cut-in while the boss resumes/completes the worker. Revalidate
 * both before and after that wait, then immediately before the actual follow-up send, so an old
 * nudge token cannot surface after its agentId has begun another run or reached ok.
 */
async function deliverInterruptedReminder(
	pi: ExtensionAPI,
	reminder: InterruptedReminder,
	testHooks?: {
		waitForCutIn?: () => Promise<void>;
		send?: (text: string) => Promise<boolean>;
	},
): Promise<boolean> {
	if (!isInterruptedReminderEligible(reminder)) {
		discardInterruptedReminder(reminder);
		return false;
	}
	await (testHooks?.waitForCutIn ?? awaitCutInHoldRelease)();
	if (!isInterruptedReminderEligible(reminder)) {
		discardInterruptedReminder(reminder);
		return false;
	}
	try {
		const send = testHooks?.send ?? ((text: string) =>
			sendUserMessageAfterCutIn(pi, text, () => isInterruptedReminderEligible(reminder)));
		return await send(reminder.text);
	} catch (err) {
		console.error("[pipiui-subagent] failed to deliver interrupted reminder:", err);
		return false;
	} finally {
		discardInterruptedReminder(reminder);
	}
}

/** 一次性通知（stall / heartbeat / vanished）：投出去即可，失败由各自的重推节奏兜底。 */
function deliverSubagentDone(pi: ExtensionAPI, text: string): void {
	void trySendUserMessage(pi, text);
}

/** done 消息必须跨过 Pi 持久化与后续 Boss 响应边界；持久 obligation 让新进程恢复未完成投递。 */
interface PendingDoneEntry {
	obligation: DeliveryObligation;
	sessionId: string;
	firstFailedAt: number;
	inFlight: boolean;
	recoveredAmbiguous: boolean;
	/** Wall clock when a Boss-turn/host-quiet hold first captured this delivery. */
	holdSince?: number;
}
const pendingDone = new Map<string, PendingDoneEntry>();
let pendingDoneSettledRetryTimer: ReturnType<typeof setTimeout> | undefined;
let doneDeliveryStore: DeliveryObligationStore | undefined;
const volatileBossAlarmStore = new VolatileBossAlarmStore();
/** Present only in a recursive nested RPC worker; its descendants own this process lease. */
let nestedBackgroundLifecycle: NestedBackgroundLifecycle | undefined;
/** Bound at session start, then called from every exact lease/obligation transition. */
let residentParentShutdown: (() => void) | undefined;

function doneDeliveryRetryDue(record: DeliveryObligation, now: number): boolean {
	return record.acknowledgementRequired
		? alarmRetryDue(record, now)
		: deliveryRetryDue(record, now, DONE_RETRY_MIN_INTERVAL_MS, DONE_MAX_ATTEMPTS);
}

function doneDeliverySettled(record: DeliveryObligation): boolean {
	return record.state === "acknowledged" || record.state === "fulfilled";
}

function maybeShutdownResidentParent(): void {
	if (!nestedBackgroundLifecycle?.shouldShutdown()) return;
	nestedBackgroundLifecycle.markShutdownRequested();
	residentParentShutdown?.();
}

function registerResidentDescendant(agentId: string, runId: string): void {
	nestedBackgroundLifecycle?.register(agentId, runId);
}

function noteResidentDescendantTerminal(agentId: string | undefined, runId: string | undefined, completionRequired: boolean): void {
	if (!agentId || !runId) return;
	nestedBackgroundLifecycle?.noteTerminal(agentId, runId, completionRequired);
}

function noteResidentDeliveryExhausted(agentId: string, runId: string, obligationId: string): void {
	const job = jobRegistry.get(agentId);
	if (job?.runId === runId && job.state !== "aborted") {
		job.state = "failed";
		job.endedAt = Date.now();
		const failure = `[pipiui] completion delivery exhausted (obligationId=${obligationId}); parent follow-up was never consumed.`;
		job.resultText = job.resultText ? `${job.resultText}\n${failure}` : failure;
		dispatchQueue.onAgentTerminal(agentId);
	}
	nestedBackgroundLifecycle?.noteDeliveryExhausted(agentId, runId);
}

/**
 * An entry leaving the map while its delivery is still held must not leave a dangling
 * done-hold enter. One metadata-only skip state closes the interval.
 */
function clearDoneHoldOnForget(entry: PendingDoneEntry | undefined): void {
	if (!entry || entry.holdSince === undefined) return;
	logCloseoutProbe("done-hold", {
		agent: entry.obligation.agentId,
		run: entry.obligation.runId,
		phase: "done-await-host",
		state: "skip",
		elapsedMs: Math.max(0, Date.now() - entry.holdSince),
	});
	entry.holdSince = undefined;
}

/**
 * Test seam: expose the EXACT production lifecycle transitions so suites can execute
 * the delivery/hold state machines behaviorally (paired probes) instead of matching
 * source text. Aliases only — no semantic change to any closeout path.
 */
export const __doneLifecycleForTests = {
	forgetHold: clearDoneHoldOnForget,
	/** Full boss-delivery entry: obligation creation, store, probing included. */
	deliverToBoss: deliverConfirmedDoneToBossAsync,
};
export const __watchRuntimeForTests = {
	get generation(): number {
		return watchSessionGeneration;
	},
	set generation(val: number) {
		watchSessionGeneration = val;
	},
	get shutdownAbort(): AbortController {
		return watchSessionShutdownAbort;
	},
	set shutdownAbort(val: AbortController) {
		watchSessionShutdownAbort = val;
	},
	registry: watchRegistry,
	runningAgents,
	jobRegistry,
	isWatchDeliveryValid,
	isWatchDeliveryValidForAgent,
	deliverWatchSample,
};
/** Default-off injection point letting behavior tests exercise the rejection closure. */
let doneDeliverCutInOverride: (() => Promise<void>) | undefined;
export function setDoneDeliverCutInOverrideForTests(fn?: () => Promise<void>): void {
	doneDeliverCutInOverride = fn;
}
let hostSupervisor: HostSupervisorDelivery | undefined;
let supervisorAbortTerminalCloseout: ReturnType<typeof createSupervisorOwnedTerminalCloseout> | undefined;
let supervisorWaveIdentity: SupervisorWaveIdentityTracker | undefined;
let supervisorWaveIdentitySessionId: string | undefined;

/**
 * A compaction can make follow-up delivery reject as busy even though the done
 * obligation is otherwise ready. session_compact/agent_settled are the narrow
 * post-busy seams: coalesce them, wait one event-loop turn for the failed
 * attempt to settle, then retry only entries that are no longer in flight.
 */
function retryPendingDoneAfterSessionSettled(pi: ExtensionAPI): void {
	if (pendingDoneSettledRetryTimer) return;
	pendingDoneSettledRetryTimer = setTimeout(() => {
		pendingDoneSettledRetryTimer = undefined;
		const now = Date.now();
		for (const [obligationId, entry] of [...pendingDone]) {
			if (doneDeliverySettled(entry.obligation)) {
				clearDoneHoldOnForget(entry);
				pendingDone.delete(obligationId);
				continue;
			}
			if (!entry.inFlight && doneDeliveryRetryDue(entry.obligation, now)) {
				sendDoneWithConfirmation(pi, entry, true, { flushAfterSettle: true });
			}
		}
	}, 0);
	pendingDoneSettledRetryTimer.unref?.();
}
let doneDeliveryPiSessionId: string | undefined;
/** Captured at session_start: live active-branch source for done-delivery reconcile. */
let doneDeliveryBranchProvider: (() => readonly unknown[]) | undefined;

/**
 * Host-stop quiet gate. The backend stop sweep sends /subagent_abort_all; from that moment
 * until the next real user input, no automatic follow-up (completion receipts, interrupted
 * reminders, heartbeats) may start a boss turn. A stopped session that keeps waking itself
 * is exactly the 2026-08-15 receipt storm: every late [subagent-done] of an aborted worker
 * opened a new turn the user had already stopped.
 */
let hostStopQuiet = false;
/** True between before_agent_start and agent_settled. Signals must not enter Pi's follow-up queue while this is set. */
let bossTurnBusy = false;
type HeldRuntimeSignal = { text: string; shouldSend?: () => boolean };
const heldRuntimeSignals: HeldRuntimeSignal[] = [];

function releaseHostStopQuiet(pi: ExtensionAPI | undefined): void {
	if (!hostStopQuiet) return;
	hostStopQuiet = false;
	if (pi) {
		retryPendingDoneAfterSessionSettled(pi);
		flushHeldRuntimeSignals(pi);
	}
}

function workerRunningForSignal(text: string): boolean {
	const named = /(?:^|\s)agentId=([A-Za-z0-9_-]+)/.exec(text)?.[1];
	if (named) {
		const exactRun = /(?:^|\s)runId=([^\s]+)/.exec(text)?.[1];
		const handle = runningAgents.get(named);
		return Boolean(handle && (!exactRun || handle.runId === exactRun));
	}
	for (const agentId of runningAgents.keys()) {
		if (text.includes(`  ${agentId} (`)) return true;
	}
	return false;
}

function reminderOpenForSignal(text: string): boolean {
	const agentId = /(?:^|\s)agentId=([A-Za-z0-9_-]+)/.exec(text)?.[1];
	if (!agentId) return false;
	const job = jobRegistry.get(agentId);
	return Boolean(job && !isHandledJob(job) && isInterruptedReminderState(job.state));
}

function admitOrHoldRuntimeSignal(text: string, shouldSend?: () => boolean): boolean {
	if (shouldSend && !shouldSend()) return false;
	const kind = classifyRuntimeSignal(text);
	if (!kind) return true;
	const decision = admitSignal({
		kind,
		activity: sessionActivity({ quiet: hostStopQuiet, busy: bossTurnBusy }),
		workerRunning: workerRunningForSignal(text),
		episodeOpen: reminderOpenForSignal(text),
		alreadyDelivered: false,
	});
	if (decision === "send") return true;
	if (decision === "hold" && !heldRuntimeSignals.some((entry) => entry.text === text)) {
		heldRuntimeSignals.push({ text, shouldSend });
	}
	return false;
}

function flushHeldRuntimeSignals(pi: ExtensionAPI): void {
	if (hostStopQuiet || bossTurnBusy) return;
	const held = heldRuntimeSignals.splice(0).filter((entry) => !entry.shouldSend || entry.shouldSend());
	const byText = new Map(held.map((entry) => [entry.text, entry]));
	const plan = planHeldSignalFlush({
		held: held.map((entry) => entry.text),
		classify: (text) => classifyRuntimeSignal(text),
		admit: ({ kind, text }) => admitSignal({
			kind,
			activity: "idle",
			workerRunning: workerRunningForSignal(text),
			episodeOpen: reminderOpenForSignal(text),
			alreadyDelivered: false,
		}),
	});
	for (const text of plan.rehold) {
		const entry = byText.get(text);
		if (entry && (!entry.shouldSend || entry.shouldSend()) && !heldRuntimeSignals.some((heldEntry) => heldEntry.text === text)) {
			heldRuntimeSignals.push(entry);
		}
	}
	const deliver = plan.deliver;
	if (!deliver) return;
	const shouldSend = byText.get(deliver.text)?.shouldSend;
	if (shouldSend && !shouldSend()) return;
	if (deliver.channel === "stall-wake") {
		void deliverStallWake(pi, deliver.text).then((ok) => {
			if (deliver.confirmsStallDelivery) confirmStallDelivery(deliver.text, ok);
		});
		return;
	}
	void trySendUserMessage(pi, deliver.text, shouldSend);
}

/** Stall/recovery must wake a settled Boss; sendUserMessage(followUp) only queues. */
async function deliverStallWake(pi: ExtensionAPI, text: string): Promise<boolean> {
	const routed = await routeRuntimeSignalThroughSupervisor(text);
	if (routed === "accepted") return true;
	if (routed === "pending") return false;
	return deliverStallWakeToBoss(pi, text);
}

async function deliverStallWakeToBoss(pi: ExtensionAPI, text: string): Promise<boolean> {
	return deliverStallWakeThrough(pi, text, {
		quiet: () => hostStopQuiet,
		waitForCutIn: awaitCutInHoldRelease,
		admit: admitOrHoldRuntimeSignal,
	});
}

function confirmStallDelivery(text: string, delivered: boolean): void {
	const agentId = /(?:^|\s)agentId=([A-Za-z0-9_-]+)/.exec(text)?.[1];
	if (!agentId) return;
	const handle = runningAgents.get(agentId);
	if (!handle) return;
	confirmStallNotification(handle, delivered);
}

function logDonePersistenceFailure(action: string, obligationId: string, err: unknown): void {
	const code = (err as NodeJS.ErrnoException)?.code;
	console.error(
		`[pipiui-subagent] done delivery persistence ${action} failed` +
			` id=${obligationId || "unassigned"}${code ? ` code=${code}` : ""}`,
	);
}

function volatileObligation(agentId: string, runId: string, text: string, identityNamespace?: string): DeliveryObligation {
	const now = Date.now();
	return {
		version: 1,
		id: `volatile-${identityNamespace ?? "completion"}-${runId}-${randomBytes(6).toString("hex")}`,
		routingKeyHash: "unavailable",
		agentId,
		runId,
		payloadHash: "unavailable",
		text,
		state: "pending",
		attempts: 0,
		createdAt: now,
		updatedAt: now,
		lastAttemptAt: 0,
		acknowledgementRequired: false,
	};
}

/** Persist pending BEFORE attempting send; persistence failure degrades to the old in-memory path. */
function createDoneObligation(
	agentId: string,
	runId: string,
	text: string,
	identityNamespace?: string,
	acknowledgementRequired = false,
	formatAlarmText?: (alarmId: string) => string,
): DeliveryObligation {
	if (!doneDeliveryStore) {
		return acknowledgementRequired
			? volatileBossAlarmStore.create(agentId, runId, text, identityNamespace, formatAlarmText)
			: volatileObligation(agentId, runId, text, identityNamespace);
	}
	try {
		return doneDeliveryStore.create(agentId, runId, text, identityNamespace, acknowledgementRequired, formatAlarmText);
	} catch (err) {
		logDonePersistenceFailure("create", "", err);
		return acknowledgementRequired
			? volatileBossAlarmStore.create(agentId, runId, text, identityNamespace, formatAlarmText)
			: volatileObligation(agentId, runId, text, identityNamespace);
	}
}

function sendDoneWithConfirmation(
	pi: ExtensionAPI,
	entry: PendingDoneEntry,
	isRetry: boolean,
	options?: { flushAfterSettle?: boolean },
): Promise<boolean> {
	let obligation = entry.obligation;
	if (
		doneDeliverySettled(obligation) ||
		obligation.state === "delivered" ||
		entry.inFlight ||
		(!obligation.acknowledgementRequired && obligation.attempts >= DONE_MAX_ATTEMPTS)
	) {
		return Promise.resolve(doneDeliverySettled(obligation) || obligation.state === "delivered");
	}
	// Host-stop quiet always holds. A live Boss turn also holds, except the
	// just-idle settle flush which must send every sibling before the first
	// receipt flips bossTurnBusy and would otherwise stall the rest.
	const held = holdConfirmedDoneDelivery({ quiet: hostStopQuiet, busy: bossTurnBusy }, options);
	if (held) {
		if (entry.holdSince === undefined) {
			entry.holdSince = Date.now();
			logCloseoutProbe("done-hold", {
				agent: obligation.agentId,
				run: obligation.runId,
				phase: "done-await-host",
				state: "enter",
				elapsedMs: 0,
			});
		}
		return Promise.resolve(false);
	}
	if (entry.holdSince !== undefined) {
		logCloseoutProbe("done-hold", {
			agent: obligation.agentId,
			run: obligation.runId,
			phase: "done-await-host",
			state: "ok",
			elapsedMs: Math.max(0, Date.now() - entry.holdSince),
		});
		entry.holdSince = undefined;
	}
	if (!entry.sessionId || entry.sessionId !== doneDeliveryPiSessionId) return Promise.resolve(false);
	const now = Date.now();
	if (doneDeliveryStore && !obligation.id.startsWith("volatile-")) {
		try {
			const persisted = doneDeliveryStore.beginAttempt(obligation.id);
			if (persisted) {
				obligation = persisted;
			} else if (doneDeliveryStore.read(obligation.id)) {
				// Another live process/extension instance owns this exact obligation.
				// No done-deliver enter was emitted yet, so nothing can dangle here.
				return Promise.resolve(true);
			} else {
				// The row vanished/corrupted after create: do not suppress the actual completion.
				logDonePersistenceFailure("missing-before-send", obligation.id, undefined);
					obligation = obligation.acknowledgementRequired
						? volatileBossAlarmStore.create(obligation.agentId, obligation.runId, obligation.text, obligation.id, undefined, obligation.alarmId)
						: volatileObligation(obligation.agentId, obligation.runId, obligation.text);
			}
		} catch (err) {
			logDonePersistenceFailure("begin", obligation.id, err);
			obligation = {
				...obligation,
				state: "attempting",
				attempts: obligation.attempts + 1,
				lastAttemptAt: now,
			};
		}
	} else {
		obligation = {
			...obligation,
			state: "attempting",
			attempts: obligation.attempts + 1,
			lastAttemptAt: now,
		};
	}
	entry.obligation = obligation;
	entry.inFlight = true;
	// The delivery clock starts HERE — after every early return above, so each
	// `done-deliver` enter is guaranteed exactly one matching terminal record and
	// its duration covers only the actual send.
	const deliverStartedAt = Date.now();
	logCloseoutProbe("done-deliver", {
		agent: obligation.agentId,
		run: obligation.runId,
		phase: "done-deliver",
		state: "enter",
		elapsedMs: 0,
	});
	const prefix = entry.recoveredAmbiguous
		? `(recovered delivery: this completion may already have been queued or persisted before restart; obligationId=${obligation.id}; treat it as the same event.)`
		: isRetry
			? `(re-delivery #${obligation.attempts}: Pi did not confirm the prior completion; obligationId=${obligation.id}; treat it as the same event.)`
			: "";
	const outText = prefix ? `${prefix}\n${obligation.text}` : obligation.text;
	return queueCompletionAfterCutIn(pi, {
		sessionId: entry.sessionId,
		agentId: obligation.agentId,
		runId: obligation.runId,
		obligationId: obligation.id,
		text: outText,
		}, {
			waitForCutIn: doneDeliverCutInOverride ?? awaitCutInHoldRelease,
			currentSessionId: () => doneDeliveryPiSessionId,
			shouldSend: () => {
				if (pendingDone.get(obligation.id) !== entry) return false;
				const current = obligation.id.startsWith("volatile-")
					? volatileBossAlarmStore.read(obligation.id)
					: doneDeliveryStore?.read(obligation.id);
				return current?.state !== "acknowledged";
			},
		}).catch((err: unknown) => {
		// A rejected send still closes the enter it opened — then propagates unchanged.
		logCloseoutProbe("done-deliver", {
			agent: obligation.agentId,
			run: obligation.runId,
			phase: "done-deliver",
			state: "error",
			elapsedMs: Math.max(0, Date.now() - deliverStartedAt),
			attempt: obligation.attempts,
			error: "done-deliver-error",
		});
		throw err;
	}).then((queued) => {
		// Terminal record first, even when the pending map moved on (retry/recovery
		// replaced the entry mid-flight): every enter gets exactly one exit state.
		logCloseoutProbe("done-deliver", {
			agent: obligation.agentId,
			run: obligation.runId,
			phase: "done-deliver",
			// "ok" means accepted for post-cut-in queueing, not yet Boss-consumed.
			state: queued ? "ok" : "error",
			elapsedMs: Math.max(0, Date.now() - deliverStartedAt),
			attempt: obligation.attempts,
			...(queued ? {} : { error: "done-not-queued" }),
		});
		if (pendingDone.get(obligation.id) !== entry) return queued;
		entry.inFlight = false;
		let settled: DeliveryObligation = { ...entry.obligation, state: queued ? "queued" : "failed" };
		if (doneDeliveryStore && !obligation.id.startsWith("volatile-")) {
			try {
				settled = doneDeliveryStore.finishAttempt(obligation.id, queued) ?? settled;
			} catch (err) {
				logDonePersistenceFailure(queued ? "queue" : "fail", obligation.id, err);
			}
		}
		entry.obligation = settled;
		if (!queued && entry.firstFailedAt === 0) {
			entry.firstFailedAt = now;
		}
		if (!queued && !settled.acknowledgementRequired && settled.attempts >= DONE_MAX_ATTEMPTS) {
			clearDoneHoldOnForget(entry);
			pendingDone.delete(obligation.id);
			noteResidentDeliveryExhausted(obligation.agentId, obligation.runId, obligation.id);
			console.error(
				`[pipiui-subagent] giving up done delivery after ${settled.attempts} attempts: ${settled.agentId}`,
			);
		}
		return queued;
	});
}

/** [subagent-done] 专用：带送达确认 + 失败重投。job 此时已 terminal，重投只依赖保存的 text。 */
function deliverConfirmedDone(pi: ExtensionAPI, agentId: string, runId: string, text: string): void {
	if (hostSupervisor) {
		const request = supervisorRequestFromCompletion(agentId, runId, text);
		if (request) {
			void routeSupervisorDelivery(request).then((admission) => {
				// Pending has already written/retained the same durable obligation. A
				// second direct send would consume an attempt without Boss admission.
				if (admission === "unhandled") deliverConfirmedDoneToBoss(pi, agentId, runId, text);
			}).catch((err) => {
				console.error("[pipiui-subagent] supervisor completion routing failed:", err);
				deliverConfirmedDoneToBoss(pi, agentId, runId, text);
			});
			return;
		}
	}
	deliverConfirmedDoneToBoss(pi, agentId, runId, text);
}

function deliverConfirmedDoneToBoss(pi: ExtensionAPI, agentId: string, runId: string, text: string): void {
	void deliverConfirmedDoneToBossAsync(pi, agentId, runId, text);
}

async function deliverConfirmedDoneToBossAsync(
	pi: ExtensionAPI,
	agentId: string,
	runId: string,
	text: string,
	identityNamespace?: string,
	/**
	 * Arm the Boss alarm (repeat until acknowledged). Terminal episodes and
	 * escalations do; a periodic status summary must not, or it re-wakes the Boss
	 * forever over a line that has no acknowledgement to give.
	 */
	armAlarm = true,
): Promise<boolean> {
	// The durable channel can only address a bound Pi session. A nested leader (depth > 0)
	// and a terminal-only pi never bind one, and sendDoneWithConfirmation refuses an entry
	// with an empty sessionId — silently swallowing the receipt. Degrade to the one-shot.
	if (!doneDeliveryPiSessionId) {
		return trySendUserMessage(pi, text);
	}
	const acknowledgementRequired = PIPIUI_DEPTH === 0 && armAlarm;
	const obligation = createDoneObligation(
		agentId,
		runId,
		text,
		identityNamespace,
		acknowledgementRequired,
		acknowledgementRequired
			? alarmId => formatBossAlarmMessage({ text, agentId, alarmId })
			: undefined,
	);
	if (
		obligation.state === "acknowledged" ||
		obligation.state === "fulfilled" ||
		obligation.state === "delivered" ||
		(!obligation.acknowledgementRequired && obligation.state === "observed")
	) {
		return true;
	}
	// Duplicate close/finalize callbacks for the same completion share one in-flight promise.
	const existing = pendingDone.get(obligation.id);
	if (existing) {
		if (!existing.inFlight && doneDeliveryRetryDue(existing.obligation, Date.now())) {
			return sendDoneWithConfirmation(pi, existing, true);
		}
		return existing.inFlight || existing.obligation.state === "queued" || existing.obligation.state === "observed";
	}
	const entry: PendingDoneEntry = {
		obligation,
		sessionId: doneDeliveryPiSessionId ?? "",
		firstFailedAt: 0,
		inFlight: false,
		recoveredAmbiguous: false,
	};
	pendingDone.set(obligation.id, entry);
	return sendDoneWithConfirmation(pi, entry, false);
}

/** Reconcile only the active branch and inspect the first assistant after each exact wake. */
function reconcilePersistedDone(piSessionId: string, branch: readonly unknown[]): void {
	if (!doneDeliveryStore || doneDeliveryPiSessionId !== piSessionId) return;
	for (const value of branch) {
		for (const observed of completionObservations(value)) {
			if (observed.sessionId !== piSessionId) continue;
			const record = doneDeliveryStore.read(observed.obligationId) ?? pendingDone.get(observed.obligationId)?.obligation;
			if (!record) continue;
				const expected = {
					sessionId: piSessionId,
					agentId: record.agentId,
					runId: record.runId,
					obligationId: record.id,
					acknowledgementRequired: record.acknowledgementRequired,
				};
			if (!completionObservationMatches(observed, expected)) continue;
			try {
				const persistenceState = completionPersistenceState(branch, expected);
					const settled = persistenceState === "fulfilled"
						? doneDeliveryStore.markFulfilled(record.id)
					: persistenceState === "retryable"
						? doneDeliveryStore.markRetryable(record.id)
						: doneDeliveryStore.markObserved(record.id);
				if (!settled) continue;
					if (!doneDeliverySettled(settled) && (
						settled.acknowledgementRequired ||
						(settled.state === "failed" && settled.attempts < DONE_MAX_ATTEMPTS)
					)) {
					clearDoneHoldOnForget(pendingDone.get(record.id));
					pendingDone.set(record.id, {
						obligation: settled,
						sessionId: piSessionId,
						firstFailedAt: settled.updatedAt,
						inFlight: false,
						recoveredAmbiguous: false,
					});
				} else {
					clearDoneHoldOnForget(pendingDone.get(record.id));
					pendingDone.delete(record.id);
				}
			} catch (err) {
				logDonePersistenceFailure("reconcile", record.id, err);
			}
		}
	}
}

/** Bind persistence to Pi's durable session identity, then restore delivery only (not execution). */
function initializeDoneDeliveryStore(pi: ExtensionAPI, piSessionId: string, activeBranch: readonly unknown[]): void {
	// Bosses and resident nested RPC parents both need durable, exact completion
	// observations. Ordinary one-shot workers cannot outlive a future completion.
	if (!PIPIUI_MAIN_CWD || (!PIPIUI_NESTED_RPC_PARENT && PIPIUI_DEPTH !== 0) || !piSessionId) return;
	if (doneDeliveryPiSessionId === piSessionId && doneDeliveryStore) {
		reconcilePersistedDone(piSessionId, activeBranch);
		return;
	}
	if (doneDeliveryPiSessionId && doneDeliveryPiSessionId !== piSessionId) {
		// A runtime session switch must not retry the previous session's messages here.
		// Their durable rows remain for that Pi session's next startup. Every active
		// done-hold ends with an explicit skip first — no dangling enter may survive.
		for (const entry of pendingDone.values()) clearDoneHoldOnForget(entry);
		pendingDone.clear();
		doneDeliveryStore = undefined;
		supervisorWaveIdentity = undefined;
		supervisorWaveIdentitySessionId = undefined;
	}
	doneDeliveryPiSessionId = piSessionId;
	try {
			doneDeliveryStore = new DeliveryObligationStore(
			path.join(
				PIPIUI_MAIN_CWD,
				".pi",
				"subagent-delivery-obligations",
				DeliveryObligationStore.routingDirectory(piSessionId),
			),
			{ routingKey: piSessionId },
		);
		reconcilePersistedDone(piSessionId, activeBranch);
		for (const recovered of doneDeliveryStore.recoverable()) {
			clearDoneHoldOnForget(pendingDone.get(recovered.record.id));
			const entry: PendingDoneEntry = {
				obligation: recovered.record,
				sessionId: piSessionId,
				firstFailedAt: recovered.record.state === "failed" ? recovered.record.updatedAt : 0,
				inFlight: false,
				recoveredAmbiguous: recovered.ambiguous,
			};
			pendingDone.set(recovered.record.id, entry);
			// A new session lifecycle owns one replay. Same-process queued/observed
			// rows never retry while the healthy Boss turn may still be running.
			sendDoneWithConfirmation(pi, entry, recovered.record.attempts > 0);
		}
	} catch (err) {
		logDonePersistenceFailure("restore", "", err);
		doneDeliveryStore = undefined;
	}
}

function acknowledgeSubagentAlarm(alarmId: string, note?: string) {
	const durable = doneDeliveryStore?.readAlarm(alarmId);
	const alarmStore = durable
		? doneDeliveryStore
		: volatileBossAlarmStore;
	const record = durable ?? volatileBossAlarmStore.readAlarm(alarmId);
	const current = record ? jobRegistry.get(record.agentId) : undefined;
	const result = acknowledgeBossAlarm(alarmStore, {
		alarmId,
		...(note ? { note } : {}),
		...(current ? { currentJob: { runId: current.runId, state: current.state } } : {}),
	});
	if (!result.ok) return result;
	for (const [obligationId, entry] of [...pendingDone]) {
		if (entry.obligation.alarmId !== alarmId) continue;
		clearDoneHoldOnForget(entry);
		pendingDone.delete(obligationId);
	}
	return result;
}

function supervisorAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR
		|| (PIPIUI_MAIN_CWD ? path.join(PIPIUI_MAIN_CWD, ".pi", "agent") : getAgentDir());
}

function supervisorJobSnapshot(agentId: string, runId: string, fallbackStatus: SupervisorJobSnapshot["status"]): SupervisorJobSnapshot {
	const record = jobRegistry.get(agentId);
	const handle = runningAgents.get(agentId);
	const now = Date.now();
	let status: SupervisorJobSnapshot["status"] = fallbackStatus;
	if (record && record.runId === runId) {
		if (record.state === "ok") status = "completed";
		else if (record.state === "failed") status = "failed";
		else if (record.state === "interrupted" || record.state === "aborted") status = "interrupted";
		else if (stalledInfoFor(agentId, now).stalled) status = "stalled";
		else status = "running";
	} else if (handle && handle.runId === runId && stalledInfoFor(agentId, now).stalled) {
		status = "stalled";
	}
	const verify = record?.verify
		? (record.verify.timedOut || record.verify.exitCode !== 0 ? "failed" : "passed")
		: undefined;
	return {
		agentId,
		runId,
		status,
		...(record?.title || record?.name || handle?.title ? { title: record?.title ?? record?.name ?? handle?.title } : {}),
		...(record ? { elapsedMs: Math.max(0, now - record.startedAt) } : {}),
		...(handle ? { lastActivityAt: handle.lastActivityAt } : {}),
		...(verify ? { verify } : {}),
	};
}

function supervisorWaveFromRuntime(): SupervisorDeliveryRequest["wave"] {
	const jobs = [...jobRegistry.values()];
	const sessionId = doneDeliveryPiSessionId || "unbound";
	if (!supervisorWaveIdentity || supervisorWaveIdentitySessionId !== sessionId) {
		const directory = doneDeliveryStore?.directory ?? path.join(
			PIPIUI_MAIN_CWD || process.cwd(),
			".pi",
			"subagent-delivery-obligations",
			DeliveryObligationStore.routingDirectory(sessionId),
		);
		supervisorWaveIdentity = new SupervisorWaveIdentityTracker(directory, sessionId);
		supervisorWaveIdentitySessionId = sessionId;
	}
	return summarizeSupervisorRuntimeWave(supervisorWaveIdentity, jobs);
}

function supervisorTerminalReports(wave: NonNullable<SupervisorDeliveryRequest["wave"]>): SupervisorTerminalReport[] {
	return wave.agentIds.flatMap((agentId) => {
		const job = jobRegistry.get(agentId);
		if (!job) return [];
		const statusRef = `artifact://status/${agentId}/${job.runId}`;
		return [{
			agentId,
			runId: job.runId,
			status: supervisorJobSnapshot(agentId, job.runId, "completed").status,
			findings: (job.resultText || (job.state === "ok" ? "completed without a textual result" : job.state)).replace(/\0/g, " "),
			statusRef,
		}];
	});
}

function supervisorRequestFromHeartbeat(text: string): SupervisorDeliveryRequest | undefined {
	if (!text.startsWith("[subagent-heartbeat]")) return undefined;
	const ids = [...text.matchAll(/^\s{2}([A-Za-z0-9_-]+) \(/gm)].map((match) => match[1]!);
	const agentId = ids[0];
	if (!agentId) return undefined;
	const handle = runningAgents.get(agentId);
	const job = jobRegistry.get(agentId);
	const runId = handle?.runId ?? job?.runId;
	if (!runId) return undefined;
	return {
		kind: "heartbeat",
		agentId,
		runId,
		sequence: (handle?.checkinCount ?? 0) + 1,
		publicText: text,
		job: supervisorJobSnapshot(agentId, runId, "running"),
		summary: text.split("\n").slice(0, 4).join(" | ").slice(0, 400),
		activeJobs: [...runningAgents.entries()].map(([id, live]) =>
			supervisorJobSnapshot(id, live.runId ?? jobRegistry.get(id)?.runId ?? live.runId ?? id, "running")),
	};
}

function supervisorRequestFromStall(text: string): SupervisorDeliveryRequest | undefined {
	const kind = text.startsWith("[subagent-blocked]") ? "upgrade_failure" as const
		: text.startsWith("[subagent-stalled]") ? "stall" as const
		: undefined;
	if (!kind) return undefined;
	const agentId = /(?:^|\s)agentId=([A-Za-z0-9_-]+)/.exec(text)?.[1];
	if (!agentId) return undefined;
	const handle = runningAgents.get(agentId);
	const job = jobRegistry.get(agentId);
	const runId = /(?:^|\s)runId=([^\s]+)/.exec(text)?.[1] ?? handle?.runId ?? job?.runId;
	if (!runId) return undefined;
	if ((handle && handle.runId !== runId) || (job && job.runId !== runId)) return undefined;
	return {
		kind,
		agentId,
		runId,
		sequence: (handle?.stallNotifyCount ?? 0) + 1,
		publicText: text,
		job: supervisorJobSnapshot(agentId, runId, kind === "stall" ? "stalled" : "failed"),
		summary: text.split("\n")[0]?.slice(0, 400) || kind,
	};
}

/** One watchdog pass over a worker's live progress log: stat(), compare against the last
 *  sample, and record lastProgressLogAt on any size/mtime change. Metadata only — contents
 *  are never read here; a missing file is not an error. Exported for tests.
 */
export function applyProgressLogSampleTick(
	handle: Pick<RunningAgentHandle, "progressLogPath" | "progressLogSample" | "lastProgressLogAt">,
	now: number,
): void {
	if (!handle.progressLogPath) return;
	const sample = sampleProgressLog({ path: handle.progressLogPath, previous: handle.progressLogSample, now });
	handle.progressLogSample = sample;
	if (sample.progressed && sample.at !== undefined) handle.lastProgressLogAt = sample.at;
}

/** Forward newly appended progress-log bytes to Boss, bypassing the Supervisor LLM.
 *  Reads from the stored offset (≤4KB cap), then consumes those bytes regardless of delivery
 *  outcome so one failed send cannot loop the same excerpt forever. Never touches
 *  noteAgentActivity / toolWaitSince: log progress must not masquerade as JSONL activity.
 */
async function deliverProgressLogReport(pi: ExtensionAPI, agentId: string, handle: RunningAgentHandle): Promise<void> {
	const excerpt = consumeProgressLogExcerpt(handle, { path: handle.progressLogPath! });
	if (!excerpt.grew) return;
	const now = Date.now();
	const text = formatProgressLogReport({
		agentId,
		title: inFlightWorkerTitle(handle),
		elapsed: formatElapsedMs(now - handle.startedAt),
		idleSec: Math.max(0, Math.floor(progressIdleMs(now, handle) / 1000)),
		state: formatHeartbeatWorkerState(agentId, handle, now),
		excerpt: excerpt.excerpt,
		addedBytes: excerpt.addedBytes,
	});
	const sequence = (handle.progressReportCount ?? 0) + 1;
	handle.progressReportCount = sequence;
	const request: SupervisorDeliveryRequest = {
		kind: "heartbeat",
		agentId,
		runId: handle.runId,
		sequence,
		forceForward: true,
		publicText: text,
		job: supervisorJobSnapshot(agentId, handle.runId, "running"),
		summary: `[subagent-progress] +${excerpt.addedBytes} bytes`,
	};
	await awaitCutInHoldRelease();
	const routed = await routeSupervisorDelivery(request);
	// accepted → Supervisor delivered; pending → receipt retained, retry next cadence;
	// unhandled → no Supervisor host bound this session, send straight to Boss.
	if (routed !== "unhandled") return;
	await sendUserMessageAfterCutIn(pi, text);
}

/** Watch list output cap: bounded metadata rows, never a firehose. */
const WATCH_LIST_MAX_ROWS = 32;

/** Coarse status for a watch sample: transitions only, never the churning idle seconds. */
function watchStateFor(agentId: string, handle: RunningAgentHandle, now: number): string {
	if (handle.finalizing) return "finalizing";
	if (handle.residentIdleWait) return "resident-idle";
	if (stalledInfoFor(agentId, now).stalled) return "stalled";
	return "running";
}

/**
 * The compact observation one due watch tick takes of its exact run: coarse status,
 * finalization phase, current tool wait, and this run's verify verdict. Log bytes are
 * deliberately absent — new progress-log bytes already have their own single-flight
 * forward path, and a second wake channel for the same growth would double-notify.
 * Returns undefined when the exact run is gone or the completion receipt is imminent
 * (done-await-host): the registry then drops the subscription silently, so the normal
 * completion/verify delivery stays the only terminal notification.
 */
export function watchObservationFor(agentId: string, runId: string, now: number): string | undefined {
	const handle = handleForRun(agentId, runId);
	if (!handle) return undefined;
	if (handle.diagnostics.finalizationPhase === "done-await-host") return undefined;
	const record = jobRegistry.get(agentId);
	const verify = record && record.runId === runId && record.verify
		? (record.verify.timedOut || record.verify.exitCode !== 0 ? "failed" : "passed")
		: undefined;
	return buildWatchFingerprint({
		state: watchStateFor(agentId, handle, now),
		...(handle.diagnostics.finalizationPhase ? { phase: handle.diagnostics.finalizationPhase } : {}),
		...(handle.toolWaitNames?.[0] ? { tool: handle.toolWaitNames[0] } : {}),
		...(verify ? { verify } : {}),
		...(handle.lastActivityAt !== undefined ? { lastActivityAt: handle.lastActivityAt } : {}),
		...(handle.diagnostics?.eventSeq !== undefined ? { eventSeq: handle.diagnostics.eventSeq } : {}),
	});
}

/** The fingerprint is a canonical key=value join; the description is the same fields, readable. */
function describeWatchFingerprint(fingerprint: string): string {
	return fingerprint.split("\u0001").join(" ");
}

function isWatchDeliveryValid(
	agentId: string,
	runId: string,
	sequence: number,
	generation: number,
): boolean {
	if (generation !== watchSessionGeneration) return false;
	if (watchSessionShutdownAbort.signal.aborted) return false;

	const handle = handleForRun(agentId, runId);
	if (!handle || handle.finalizing || handle.diagnostics.finalizationPhase === "done-await-host") {
		return false;
	}

	const job = jobRegistry.get(agentId);
	if (
		job &&
		job.runId === runId &&
		(job.state === "ok" ||
			job.state === "failed" ||
			job.state === "aborted" ||
			job.state === "interrupted")
	) {
		return false;
	}

	const subs = watchRegistry.list({ agentId, runId });
	if (subs.length === 0) return false;
	const sub = subs[0];
	if (!sub.inFlight || sub.lastEventSeq !== sequence) return false;

	return true;
}

function isWatchDeliveryValidForAgent(agentId: string, runId: string): boolean {
	if (watchSessionShutdownAbort.signal.aborted) return false;
	const handle = handleForRun(agentId, runId);
	if (!handle || handle.finalizing || handle.diagnostics.finalizationPhase === "done-await-host") {
		return false;
	}
	const job = jobRegistry.get(agentId);
	if (
		job &&
		job.runId === runId &&
		(job.state === "ok" ||
			job.state === "failed" ||
			job.state === "aborted" ||
			job.state === "interrupted")
	) {
		return false;
	}
	return watchRegistry.list({ agentId, runId }).length > 0;
}

/**
 * Route one changed watch sample. The Supervisor judges the compact packet: wait/status
 * stay silent (durable receipt only), forward/escalate wake Boss once with bounded text —
 * and with no Supervisor bound this session the compact line goes straight to Boss, the
 * same fallback the progress excerpt rides. The registry's single in-flight slot is
 * settled in `finally` with the exact sequence, so a failed route can never wedge the
 * subscription; a coalesced change re-emits on the next due tick on its own.
 */
async function deliverWatchSample(
	pi: ExtensionAPI,
	event: WatchTickEvent,
	generation = watchSessionGeneration,
): Promise<void> {
	if (!isWatchDeliveryValid(event.agentId, event.runId, event.sequence, generation)) {
		return;
	}
	const handle = handleForRun(event.agentId, event.runId);
	const job = jobRegistry.get(event.agentId);
	const title = handle?.title?.trim() || job?.title?.trim() || job?.name || "(untitled)";
	const fields = describeWatchFingerprint(event.fingerprint);
	const text = [
		`[subagent-watch] ${event.agentId} (${title}) — ${fields}`,
		`runId=${event.runId} seq=${event.sequence}. Periodic watch sample: one state transition since the previous sample; unchanged ticks never send one. Keep waiting unless this shows abnormal activity or finalization trouble.`,
	].join("\n");
	const request: SupervisorDeliveryRequest = {
		kind: "watch",
		agentId: event.agentId,
		runId: event.runId,
		sequence: event.sequence,
		publicText: text,
		job: supervisorJobSnapshot(event.agentId, event.runId, "running"),
		summary: `watch: ${fields}`.slice(0, 600),
	};
	try {
		if (!isWatchDeliveryValid(event.agentId, event.runId, event.sequence, generation)) {
			return;
		}
		const routed = await routeSupervisorDelivery(request);
		if (routed !== "unhandled") return;
		if (!isWatchDeliveryValid(event.agentId, event.runId, event.sequence, generation)) {
			return;
		}
		await sendUserMessageAfterCutIn(pi, text);
	} finally {
		// A rejection (subscription pruned mid-delivery) is fine — the slot went with it.
		watchRegistry.ack({ agentId: event.agentId, runId: event.runId, sequence: event.sequence });
	}
}

function supervisorRequestFromCompletion(agentId: string, runId: string, text: string): SupervisorDeliveryRequest {
	const wave = supervisorWaveFromRuntime();
	const request: SupervisorDeliveryRequest = {
		kind: "completion",
		agentId,
		runId,
		sequence: 1,
		waveId: wave.waveId,
		publicText: text,
		job: supervisorJobSnapshot(agentId, runId, "completed"),
		summary: text.split("\n")[0]?.slice(0, 400) || "completion",
		wave,
		evidenceRefs: [`artifact://status/${agentId}/${runId}`, `artifact://wave/${wave.waveId}`],
	};
	if (wave.running === 0) {
		request.terminalReports = supervisorTerminalReports(wave);
		request.activeJobs = [];
	}
	return request;
}

function currentSupervisorManifest(): SupervisorTaskManifest {
	const tasks: SupervisorTaskManifest["tasks"] = [];
	for (const item of dispatchQueue.snapshot()) {
		tasks.push({
			taskId: item.agentId,
			title: item.title ?? item.role,
			status: item.heldReason ? "blocked" : "declared",
			...(item.blockedBy.length > 0 ? { blockedBy: [...item.blockedBy] } : {}),
			dispatch: { taskId: item.agentId, agentId: item.agentId, role: item.role, ...(item.title ? { title: item.title } : {}) },
		});
	}
	for (const job of jobRegistry.values()) {
		if (tasks.some((task) => task.taskId === job.agentId)) continue;
		tasks.push({
			taskId: job.agentId,
			title: job.title ?? job.name,
			status: job.state === "running" ? "running" : job.state === "ok" ? "completed" : "failed",
			...(job.blockedBy && job.blockedBy.length > 0 ? { blockedBy: [...job.blockedBy] } : {}),
			dispatch: { taskId: job.agentId, agentId: job.agentId, role: job.name, ...(job.title ? { title: job.title } : {}) },
		});
	}
	return { tasks };
}

async function routeSupervisorDelivery(request: SupervisorDeliveryRequest): Promise<SupervisorHostAdmission> {
	if (!hostSupervisor) return "unhandled";
	await hostSupervisor.runtime.setActiveWorkerCount(runningAgents.size);
	const result = await hostSupervisor.delivery.handle(request);
	if (runningAgents.size === 0) {
		void hostSupervisor.runtime.setActiveWorkerCount(0);
	}
	return classifySupervisorHostAdmission(result);
}

async function routeRuntimeSignalThroughSupervisor(text: string): Promise<SupervisorHostAdmission> {
	if (!hostSupervisor) return "unhandled";
	const request = supervisorRequestFromHeartbeat(text) ?? supervisorRequestFromStall(text);
	if (!request) return "unhandled";
	try {
		return await routeSupervisorDelivery(request);
	} catch (err) {
		console.error("[pipiui-subagent] supervisor signal routing failed:", err);
		return "unhandled";
	}
}

function bindHostSupervisor(pi: ExtensionAPI): void {
	if (hostSupervisor || PIPIUI_DEPTH !== 0 || !PIPIUI_MAIN_CWD || !PIPIUI_SESSION) return;
	try {
		const projectRoot = PIPIUI_MAIN_CWD;
		const agentDir = supervisorAgentDir();
		const factory = createPiSupervisorSessionFactory({
			createAgentSession: createAgentSession as unknown as Parameters<typeof createPiSupervisorSessionFactory>[0]["createAgentSession"],
			SessionManager,
			agentDir,
			async resolveModel(ref) {
				const runtime = await ModelRuntime.create({
					authPath: path.join(agentDir, "auth.json"),
					modelsPath: path.join(agentDir, "models.json"),
				});
				const slash = ref.indexOf("/");
				if (slash <= 0) return undefined;
				return runtime.getModel(ref.slice(0, slash), ref.slice(slash + 1)) ?? undefined;
			},
			createResourceLoader(systemPrompt) {
				return new DefaultResourceLoader({
					cwd: projectRoot,
					agentDir,
					...supervisorResourceLoaderFlags(systemPrompt),
				});
			},
		});
		const ownedTerminalCloseout = createSupervisorOwnedTerminalCloseout({
			mutate(id) {
				const job = jobRegistry.get(id.agentId);
				if (!job || job.runId !== id.runId) throw new Error("abort run identity mismatch");
				const result = abortRunningAgent(id.agentId, { runId: id.runId });
				if (!result.ok) throw new Error(result.message);
			},
		});
		hostSupervisor = createHostSupervisorDelivery({
			projectRoot,
			factory,
			models: () => {
				const overrides = loadSubagentModelOverrides();
				return {
					supervisor: overrides.supervisor?.models[0]?.model,
					generalPurpose: overrides["general-purpose"]?.models[0]?.model,
					boss: inheritMainModel(undefined),
				};
			},
			store: createFileSupervisorStateStore(supervisorSessionStatePath(projectRoot, PIPIUI_SESSION)),
			promptTimeoutMs: envPositiveSecs("PIPIUI_SUPERVISOR_PROMPT_TIMEOUT_SECS", 60) * 1000,
			activeWorkerCount: () => runningAgents.size,
			manifest: currentSupervisorManifest,
			lifecycle: {
				status(id) {
					return supervisorJobSnapshot(id.agentId, id.runId, "running");
				},
				resume() {
					throw new Error("resume is unsupported; Boss must explicitly redispatch the stable agentId");
				},
				retry() {
					throw new Error("retry is unsupported; Boss must explicitly redispatch from the immutable brief");
				},
				abort(id) {
					if (!ownedTerminalCloseout.request(id)) {
						throw new Error("Supervisor already requested abort for this exact run");
					}
				},
				resolve(id) {
					const result = resolveSubagentEpisode(id.agentId, id.runId);
					if (!result.ok) throw new Error(result.message);
				},
				startDeclared(spec) {
					if (!dispatchQueue.startDeclared(spec.agentId)) {
						throw new Error("declared task cannot start from the immutable queue");
					}
				},
			},
			boss: {
				get requestCount() { return 0; },
				get envelopes() { return []; },
				send(envelope) {
					const serialized = serializeBossEscalation(envelope);
					if (!serialized.ok) throw new Error(serialized.error);
				},
			},
			deliverCurrent: async ({ kind, publicText, agentId, runId, envelope }) => {
				if (envelope || kind === "completion" || kind === "wave" || kind === "upgrade_failure") {
					return deliverConfirmedDoneToBossAsync(
						pi,
						agentId,
						runId,
						publicText,
						supervisorBossObligationNamespace({ kind, envelope }),
						supervisorDeliveryArmsAlarm({ kind, envelope }),
					);
				}
				if (kind === "stall") {
					return deliverStallWakeToBoss(pi, publicText);
				}
				if (kind === "watch") {
					if (agentId && runId && !isWatchDeliveryValidForAgent(agentId, runId)) {
						return false;
					}
				}
				return sendUserMessageAfterCutIn(pi, publicText);
			},
		});
		supervisorAbortTerminalCloseout = ownedTerminalCloseout;
	} catch (err) {
		console.error("[pipiui-subagent] supervisor host bind failed; using current Boss delivery:", err);
		hostSupervisor = undefined;
		supervisorAbortTerminalCloseout = undefined;
	}
}

async function disposeHostSupervisor(): Promise<void> {
	const current = hostSupervisor;
	hostSupervisor = undefined;
	supervisorAbortTerminalCloseout = undefined;
	if (current) await current.dispose();
}

function notifySubagentDone(
	pi: ExtensionAPI,
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): void {
	// A completion (ok/failed/aborted) is the cancel hook for the dispatch-idle fold timer.
	noteIdleFoldCompleted(result.agentId);
	// Finalize job BEFORE notification: status must work even if Pi rejects the wake-up.
	const terminalRunId = ensureJobTerminalFromResult(result, extra);
	const aborted = extra?.aborted === true || result.stopReason === "aborted";
	const terminalAgentId = result.agentId;
	const runId = terminalAgentId
		? (result.runId ?? terminalRunId ?? jobRegistry.get(terminalAgentId)?.runId ?? DeliveryObligationStore.runId())
		: undefined;
	// A resident parent observes the exact terminal before completion delivery. A
	// normal result remains leased until the follow-up is actually consumed; an
	// abort has no [subagent-done] wake by existing contract and releases directly.
	if (terminalAgentId && runId) nestedBackgroundLifecycle?.noteTerminal(terminalAgentId, runId, !aborted);
	if (aborted) {
		const text = `[subagent-aborted] agentId=${terminalAgentId} runId=${runId}; this exact run reached aborted terminal state.`;
		if (terminalAgentId && runId && supervisorAbortTerminalCloseout) {
			void supervisorAbortTerminalCloseout.terminalize(
				{ agentId: terminalAgentId, runId },
				async () => {
					const admission = await routeSupervisorDelivery(
						supervisorRequestFromCompletion(terminalAgentId, runId, text),
					);
					if (admission === "unhandled") {
						await deliverConfirmedDoneToBossAsync(pi, terminalAgentId, runId, text);
					}
				},
			).catch((err) => {
				console.error("[pipiui-subagent] supervisor abort closeout failed:", err);
			});
		} else if (terminalAgentId && runId) {
			deliverConfirmedDoneToBoss(pi, terminalAgentId, runId, text);
		}
		// Host-stop quiet still holds this exact alarm until the next real user input;
		// once released, explicit acknowledgement is required to stop recurrence.
		return;
	}
	// Persist the full report next to the ledger BEFORE formatting, so the done message can
	// hand the next worker a path instead of making it rediscover this worker's ground.
	// A failed write only costs the handoff line; it never blocks the completion.
	logCloseoutProbe("findings", {
		agent: result.agentId,
		run: runId,
		phase: "findings",
		state: "enter",
		elapsedMs: 0,
	});
	const findingsStartedAt = Date.now();
	const findings = writeFindingsArtifact({
		mainCwd: PIPIUI_MAIN_CWD,
		agentId: result.agentId,
		agentName: result.agent,
		runId,
		title: result.title,
		task: result.task,
		// An error is not a finding. A worker that died without a report leaves no artifact;
		// continuing it by agentId is what recovers its work, per the continuity rule.
		text: extra?.error ? "" : getResultOutput(result),
	});
	logCloseoutProbe("findings", {
		agent: result.agentId,
		run: runId,
		phase: "findings",
		state: findings.ok ? "ok" : "error",
		elapsedMs: Date.now() - findingsStartedAt,
		...(findings.ok ? {} : { error: "findings-error" }),
	});
	const extraWithWave = {
		...extra,
		wave: currentWaveSnapshot(Date.now()),
		...(findings.ok && findings.file ? { findingsFile: findings.file } : {}),
	};
	const text = formatSubagentDoneMessage(result, runId ? { ...extraWithWave, runId } : extraWithWave);
	// 前台 job 可能没有 bridge agentId；那种情况下投递确认无从挂起，退化为一次性投递。
	if (result.agentId && runId) {
		deliverConfirmedDone(pi, result.agentId, runId, text);
	} else {
		deliverSubagentDone(pi, text);
	}
}


function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

/** Background fan-out finalizes each item and drops its full result immediately. */
async function forEachWithConcurrencyLimit<TIn>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<void>,
): Promise<void> {
	if (items.length === 0) return;
	const limit = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			await fn(items[current], current);
		}
	});
	await Promise.all(workers);
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const nodeShim = process.env.PIPIUI_NODE_PATH;
	const testChildEntry = process.env.PIPIUI_SUBAGENT_TEST_CHILD_ENTRY;
	if (testChildEntry) {
		if (!path.isAbsolute(testChildEntry) || !fs.existsSync(testChildEntry)) {
			throw new Error(`PIPIUI_SUBAGENT_TEST_CHILD_ENTRY must name an existing absolute file: ${testChildEntry}`);
		}
		const testRuntime = nodeShim && fs.existsSync(nodeShim) ? nodeShim : process.execPath;
		return { command: testRuntime, args: [testChildEntry, ...args] };
	}
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (nodeShim && fs.existsSync(nodeShim) && currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: nodeShim, args: [currentScript, ...args] };
	}
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

const SUBAGENT_SKILL_ISOLATION = `[DISPATCHED SUBAGENT ISOLATION — HIGHEST PRIORITY]
This session is a dispatched subagent. Automatic skill bootstrap and the ambient skill catalog are switched off here: you MUST NOT follow using-superpowers, brainstorming, writing-plans, subagent-driven-development, or any other implicit SKILL.md, and no skill may add gates, approvals, or extra process on top of your brief. You MUST NOT write a spec or plan document unless your brief names its exact path. Follow only this agent's own system prompt and the brief. When skill_search and skill_load are available, you may use them by name if the current task matches; loading is never a mandatory gate.`;

const PLAN_SUBAGENT_ARTIFACT_BAN = `You are read-only: you MUST NOT create or save plan artifacts. Your deliverable is the plan text in your final message.`;

// Read-only-ness now travels on the agent definition (`read-only: true`), so a new agent
// declares it instead of being remembered here. See AgentTraits in ./agents.ts.

const PI_SKILLS_PREAMBLE = [
	"The following skills provide specialized instructions for specific tasks.",
	"Use the read tool to load a skill's file when the task matches its description.",
	"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
	"",
].join("\n");

const AVAILABLE_SKILLS_BLOCK = /\n*<available_skills>[\s\S]*?<\/available_skills>/g;

function stripPiSkillsFromSystemPrompt(systemPrompt: string): string {
	return systemPrompt.split(PI_SKILLS_PREAMBLE).join("").replace(AVAILABLE_SKILLS_BLOCK, "");
}

function isSkillReadPath(requestedPath: unknown): boolean {
	if (typeof requestedPath !== "string") return false;
	const normalized = requestedPath.replace(/\\/g, "/");
	return /(?:^|\/)SKILL\.md$/i.test(normalized) || /(?:^|\/)skills\//i.test(normalized);
}

// Superpowers' Pi extension skips bootstrap injection when any context message contains
// this stable marker. Worker argv also passes `--no-extensions`, so settings-package
// Superpowers cannot load; the sentinel still covers an explicit `-e` mount.
const SUPERPOWERS_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE = `[PipiUI subagent isolation sentinel: ${SUPERPOWERS_BOOTSTRAP_MARKER}
The skill-library bootstrap is intentionally suppressed for this dispatched subagent. This sentinel is not a skill instruction; follow only this agent's own system prompt and its brief.]`;
// The Boss session keeps skills discoverable for an explicit user request, but the
// "invoke a skill before any response" auto-bootstrap is not the session's process owner:
// the Boss protocol is. Suppressing it is what makes the skill library opt-in.
const MAIN_BOOTSTRAP_SUPPRESSION_NOTE = `[PipiUI session skill policy: ${SUPERPOWERS_BOOTSTRAP_MARKER}
The skill-library auto-bootstrap is suppressed in this session. Skills remain available and may be loaded when the user explicitly asks for one by name; they are never a mandatory step and never add gates or approvals on top of this session's own protocol. This sentinel is not a skill instruction.]`;
// Fixed at module load: a per-turn timestamp on an always-present message would look like
// fresh content to the prompt cache.
const MAIN_SUPPRESSION_TIMESTAMP = Date.now();

/** True once any context message already carries the bootstrap marker (ours or theirs). */
function messagesContainSuperpowersMarker(messages: unknown[]): boolean {
	return messages.some((message) => {
		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") return content.includes(SUPERPOWERS_BOOTSTRAP_MARKER);
		if (!Array.isArray(content)) return false;
		return content.some(
			(part) =>
				part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string" &&
				(part as { text: string }).text.includes(SUPERPOWERS_BOOTSTRAP_MARKER),
		);
	});
}

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	options: RunSingleAgentOptions,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	// Identity is caller-chosen, full stop. Every dispatch path (single, tasks/parallel,
	// chain, runtime recovery) must pass a short semantic agentId; the public gates reject a
	// missing one with a named error before we ever get here, and no `agent-<random>` name is
	// ever generated for a worker identity. Randomness belongs to the one-shot runId only.
	const callerAgentId = options?.agentId?.trim() || "";
	if (!callerAgentId) {
		throw new Error(
			"runSingleAgent requires an explicit short semantic agentId (e.g. \"quota-pill\"): the dispatch contract rejects a missing id instead of generating one.",
		);
	}
	const pipiuiAgentId = callerAgentId;
	// Capture this invocation's generation before any early failure path can return a result.
	const runId = options?.runId ?? DeliveryObligationStore.runId();
	const isBackground = options?.background === true;
	localAgentReservations.add(pipiuiAgentId);

	if ((RETIRED_COMPUTER_AGENT_NAMES as readonly string[]).includes(agentName)) {
		const message = `Retired computer agents were removed: "${agentName}" no longer exists. Drive the desktop directly with the main-session \`computer\` / \`open_application\` tools instead of dispatching an agent.`;
		releaseAgentReservation(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: "retired",
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		const fail: SingleResult = {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
			errorMessage: `Unknown agent: "${agentName}"`,
		};
		jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: "failed",
			resultText: fail.stderr,
		});
		releaseAgentReservation(pipiuiAgentId);
		return fail;
	}
	// Budgets are parsed once, fail-closed, before any placement or spawn: a budget the
	// runtime cannot honor is a dispatch error, never a silently unbounded run.
	const toolBudgetParsed = options?.toolBudget !== undefined ? parseToolBudget(options.toolBudget) : undefined;
	const usageBudgetParsed = options?.usageBudget !== undefined ? parseUsageBudget(options.usageBudget) : undefined;
	const budgetProblem = toolBudgetParsed && !toolBudgetParsed.ok
		? toolBudgetParsed.problem
		: usageBudgetParsed && !usageBudgetParsed.ok
			? usageBudgetParsed.problem
			: undefined;
	if (budgetProblem) {
		const fail: SingleResult = {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Invalid budget: ${budgetProblem}`,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
			errorMessage: `Invalid budget: ${budgetProblem}`,
		};
		jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: "failed",
			resultText: fail.stderr,
		});
		releaseAgentReservation(pipiuiAgentId);
		return fail;
	}
	const toolBudget: ToolBudget | undefined = toolBudgetParsed?.ok ? toolBudgetParsed.value : undefined;
	const usageBudget: UsageBudget | undefined = usageBudgetParsed?.ok ? usageBudgetParsed.value : undefined;
	let parentToolCalls = 0;
	let usageBudgetState: UsageBudgetState | undefined;
	let usageBudgetNoticeSent = false;
	let usageBudgetAborted = false;
	let forkSanitizedSummary: { removedBlocks: number; touchedMessages: number; thinkingOff: boolean } | undefined;
	// A hard usage cap waits for the in-flight tool call to return (mutation-safe cut), bounded by a grace.
	let usageBudgetAbortPending = false;
	let usageBudgetGraceTimer: ReturnType<typeof setTimeout> | undefined;
	const identityProblem = agentResumeIdentityProblem({
		agentId: pipiuiAgentId,
		requestedName: agentName,
		historicalName: readAgentSliceMetadata().find((item) => item.agentId === pipiuiAgentId)?.name,
		fresh: options?.fresh,
	});
	if (identityProblem) {
		releaseAgentReservation(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: identityProblem,
			errorMessage: identityProblem,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	const executionPolicyResult = normalizeGeneralPurposeExecutionPolicy(agent, options);
	if (executionPolicyResult.problem) {
		const reason = executionPolicyResult.problem;
		releaseAgentReservation(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: reason,
			errorMessage: reason,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	const executionPolicy = executionPolicyResult.policy;
	const runtimePolicy = runtimeRolePolicyForAgent(agent);
	const childDepth = options?.depth ?? PIPIUI_DEPTH + 1;
	const allowRecursiveDelegation = childReceivesDelegationTools({
		allowRecursiveDelegation: runtimePolicy.allowRecursiveDelegation,
		childDepth,
		maxDepth: PIPIUI_MAX_DEPTH,
	});
	const createsWorktree = executionPolicy
		? executionPolicy.worktree === "isolated"
		: runtimePolicy.worktree === "isolated";
	if (createsWorktree && !callerAgentId) {
		const reason = `Agent "${agentName}" writes code, so it needs a short semantic agentId — it becomes the git branch pipiui/<agentId>. Re-dispatch with one that names this slice, e.g. "quota-pill" or "doc-panel" (2-24 chars: lowercase letters, digits, "-", "_").`;
		jobFinalize(pipiuiAgentId, runId, { name: agentName, task, state: "failed", resultText: reason });
		releaseAgentReservation(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			exitCode: 1,
			messages: [],
			stderr: reason,
			errorMessage: reason,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	const leaseResult = acquireAgentLease(path.resolve(PIPIUI_MAIN_CWD || defaultCwd), pipiuiAgentId);
	if (!leaseResult.lease) {
		const message = leaseResult.problem;
		releaseAgentReservation(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	const agentLease = leaseResult.lease;
	try {

	// Pre-dispatch recall is advisory and fail-soft; the launcher never gains a
	// backend handle and the serialized boundary remains visible to the child.
		task = await advisoryMemoryForSubagent(runId, path.resolve(PIPIUI_MAIN_CWD || defaultCwd), agentName, task);
	// The formal main extension owns the live registry and returns the only
	// capability tuple a child may receive. No Swift/AppStore RPC registration or
	// child-selected root is involved. An unavailable broker simply removes the
	// optional query/candidate surface for this dispatch.
	const memoryBrokerRole: MemoryBrokerChildRole | undefined =
		runtimePolicy.role === "worker" ? "worker" : undefined;
	const issuedMemoryBrokerEnvironment = memoryBrokerRole
		? await issueMemoryBrokerEnvironment({
			agentID: pipiuiAgentId,
			runID: runId,
			role: memoryBrokerRole,
		})
		: undefined;
	// A complete capability is not enough on its own: the child must also be
	// able to prove the exact installed package identity before it receives a
	// memory tool or mounts an extension.
	const terminalMemoryBrokerEnvironment = issuedMemoryBrokerEnvironment
		&& memoryBrokerExtensionPathForChild(issuedMemoryBrokerEnvironment)
		? issuedMemoryBrokerEnvironment
		: undefined;
	const placementPolicy = executionPolicy?.worktree === "none"
		? { ...runtimePolicy, worktree: "direct" as const }
		: runtimePolicy;
	const targetBaseCwd = executionPolicy?.worktree === "isolated" ? (cwd ?? defaultCwd) : defaultCwd;
	const placement = requestGitWorktreePlacementV1({
		mainCwd: PIPIUI_MAIN_CWD,
		agentId: pipiuiAgentId,
		defaultCwd: targetBaseCwd,
		explicitCwd: executionPolicy?.worktree === "isolated" ? undefined : cwd,
		readOnly: agent.traits.readOnly,
		policy: placementPolicy,
		allowEnvironmentOptOut: executionPolicy?.worktree === "isolated" ? false : undefined,
	});
	// ── Branded-pin contract ─────────────────────────────────────────────────────────
	// Only a host-validated pin may pass this point (see requireValidatedModelPin).
	const modelPin = requireValidatedModelPin(options?.model, options?.modelPin);
	let resolvedModel = resolveAgentModel(agentName, agent.model, options?.sessionModel, modelPin);
	// Tool-selected thinking belongs to this one dispatch only; it never reads the Boss's
	// current thinking level. The initial candidate may use it directly by priority. With a
	// pinned model the persisted role-thinking no longer describes the actual candidate, so
	// only an explicit task thinking (or Pi default) applies.
	const taskThinking = normalizeTaskThinking(options?.thinking);
	let resolvedThinking = modelPin ? taskThinking : resolveAgentThinking(agentName, taskThinking);
	const mainModelForChild = inheritMainModel(options?.sessionModel);
	if (placement.worktreeError) {
		const message = `Writable subagent isolation failed before spawn: ${placement.worktreeError}`;
		const fail: SingleResult = {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			model: resolvedModel,
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
		pipiuiReportQueue.beginRun(pipiuiAgentId, runId);
		await postPipiuiReport({
			kind: "start",
			agentId: pipiuiAgentId,
			runId,
			parentId: options?.parentAgentId === undefined ? PIPIUI_PARENT : options.parentAgentId,
			toolCallId: options.toolCallId,
			name: agentName,
			task,
			depth: options?.depth ?? PIPIUI_DEPTH + 1,
			model: resolvedModel ?? null,
			...(options?.title ? { title: options.title } : {}),
			...(options?.background ? { background: true } : {}),
			worktreeError: placement.worktreeError,
		});
		jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title, options?.blockedBy, runId, resolvedModel, { planTask: options?.planTask, scope: options?.scope });
		jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: "failed",
			resultText: message,
		});
		await postTerminalPipiuiReport({
			kind: "end",
			agentId: pipiuiAgentId,
			runId,
			ok: false,
			activity: null,
			activityActive: false,
			activityEndedAt: Date.now(),
			output: message,
			worktreeError: placement.worktreeError,
		});
		return fail;
	}
	const spawnCwd = placement.cwd;

	// progressLog 路径闸门（与 timeoutSecs 同门：仅 bundled general-purpose 会带值走到这里）。
	// 相对 spawnCwd 或绝对；realpath 归一后必须落在打开的项目、spawnCwd 或本 worker worktree
	// 内，越界/控制字符/空串一律拒发，错误信息点名 progressLog。文件此时不必存在。
	let progressLogSpec: { path: string } | undefined;
	if (executionPolicy?.progressLog) {
		const resolvedProgressLog = resolveProgressLogPath({
			progressLog: executionPolicy.progressLog,
			spawnCwd,
			allowedRoots: [PIPIUI_MAIN_CWD, spawnCwd, placement.worktreePath],
		});
		if ("problem" in resolvedProgressLog) {
			const message = resolvedProgressLog.problem;
			const fail: SingleResult = {
				agent: agentName,
				agentSource: agent.source,
				task,
				title: options?.title,
				exitCode: 1,
				messages: [],
				stderr: message,
				errorMessage: message,
				usage: emptyUsage(),
				model: resolvedModel,
				step,
				agentId: pipiuiAgentId,
				runId,
				stopReason: "error",
			};
			pipiuiReportQueue.beginRun(pipiuiAgentId, runId);
			await postPipiuiReport({
				kind: "start",
				agentId: pipiuiAgentId,
				runId,
				parentId: options?.parentAgentId === undefined ? PIPIUI_PARENT : options.parentAgentId,
				toolCallId: options.toolCallId,
				name: agentName,
				task,
				depth: options?.depth ?? PIPIUI_DEPTH + 1,
				model: resolvedModel ?? null,
				...(options?.title ? { title: options.title } : {}),
				...(options?.background ? { background: true } : {}),
			});
			jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title, options?.blockedBy, runId, resolvedModel, { planTask: options?.planTask, scope: options?.scope });
			jobFinalize(pipiuiAgentId, runId, {
				name: agentName,
				task,
				state: "failed",
				resultText: message,
			});
			await postTerminalPipiuiReport({
				kind: "end",
				agentId: pipiuiAgentId,
				runId,
				ok: false,
				activity: null,
				activityActive: false,
				activityEndedAt: Date.now(),
				output: message,
			});
			return fail;
		}
		progressLogSpec = resolvedProgressLog;
	}

	// A worker keeps its conversation across re-dispatches so a vertical slice — implement,
	// verify, debug, fix, re-verify — is done by someone who remembers writing the code, rather
	// than by a stranger who re-reads the files and re-derives the same wrong assumption every
	// round. Ordinary read-only reports stay ephemeral, but a Host-owned orchestrator can opt
	// into continuity without gaining any write authority: memory and authority are separate.
	// First real dispatch is exactly when the ledger becomes relevant (see the lazy-discovery
	// rule the orchestration layer states), so seed it here rather than on every session start.
	seedBossLedger(PIPIUI_MAIN_CWD, PIPIUI_SESSION);
	rememberAgentSlice(pipiuiAgentId, agentName, task, options?.title, runId);
	const sessionDir = agent.traits.readOnly && !options?.retainContext ? undefined : agentSessionDir();
	const sessionId = `pipiui-${pipiuiAgentId}`;
	const resumingSession = Boolean(
		sessionDir && !options?.fresh && agentSessionExists(sessionDir, sessionId),
	);
	// A fork copies this session's conversation into the child's new session, so the decision
	// needs the resume state (continuity outranks forking) and can only be made once the model
	// is known. On acceptance the child is pinned to the Boss's model: the copied prefix is only
	// cheap while it stays a cache hit, and a silent cross-model fork would pay full price for
	// every token of it.
	const forkDecision = resolveFork({
		fork: options?.fork,
		agentName,
		readOnly: agent.traits.readOnly,
		depth: PIPIUI_DEPTH,
		modelPin: options?.model,
		bossModel: mainModelForChild,
		sessionFile: options?.forkSourceFile,
		resuming: resumingSession,
	});
	if (options?.fork === true && !forkDecision.fork && forkDecision.reason) {
		const fail: SingleResult = {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: forkDecision.reason,
			errorMessage: forkDecision.reason,
			usage: emptyUsage(),
			model: resolvedModel,
			step,
			agentId: pipiuiAgentId,
			runId,
		};
		return fail;
	}
	if (forkDecision.fork && forkDecision.model) {
		// The role's persisted thinking level describes the role's own model, which a fork has
		// just replaced with the Boss's. Fall back to an explicit task thinking exactly as a
		// pinned model does, rather than sending a level the new model may not accept.
		resolvedModel = forkDecision.model;
		resolvedThinking = taskThinking;
	}

	if (sessionDir && options?.fresh) {
		// Explicitly starting over: drop the old conversation rather than resuming a poisoned one.
		for (const file of agentSessionFiles(sessionDir, sessionId)) {
			try {
				fs.rmSync(file);
			} catch {
				// Best effort; a leftover file only costs a stale resume the boss asked to avoid.
			}
		}
	}
	// Resume would otherwise inherit the stale session header cwd (possibly the main checkout) via
	// SessionManager.open's `header.cwd` fallback; pin the resumed session to this dispatch's
	// worktree so child writes and our post-verify share the same cwd. Writable + worktree only.
	if (sessionDir && resumingSession && placement.worktreePath) {
		alignResumedSessionCwd(sessionDir, sessionId, spawnCwd);
	}
	// A depth>0 worker that still receives delegation tools may return an immediate
	// background receipt. It must remain resident long enough to consume its child's
	// completion follow-up; Pi RPC is the supported stdin/stdout lifecycle for that.
	const useNestedRpc = childDepth > 0 && allowRecursiveDelegation;
	const promptDebugPath = promptDebugFile(pipiuiAgentId, runId);
	const args: string[] = useNestedRpc ? ["--mode", "rpc"] : ["--mode", "json", "-p"];
	if (sessionDir) {
		// `--fork <src>` mints a NEW session carrying the copied entries; pi treats the
		// `--session-id` beside it as that new session's id and refuses a collision, which is
		// why fork-policy makes a resume win outright rather than reaching this pair.
		// Signed Anthropic thinking cannot be replayed into a branch; fork from a sanitized
		// copy when the Boss session carries any, and start an Anthropic child with thinking off.
		const forkSanitized = forkDecision.fork
			? prepareSanitizedForkSource(forkDecision.sourcePath, path.join(sessionDir, "forks"), { agentId: pipiuiAgentId, runId })
			: undefined;
		if (forkSanitized) {
			forkSanitizedSummary = {
				removedBlocks: forkSanitized.removedBlocks,
				touchedMessages: forkSanitized.touchedMessages,
				thinkingOff: isAnthropicModelRef(resolvedModel),
			};
		}
		args.push(...forkSpawnArgs(forkSanitized && forkDecision.fork ? { ...forkDecision, sourcePath: forkSanitized.path } : forkDecision));
		args.push("--session-id", sessionId, "--session-dir", sessionDir);
	} else {
		args.push("--no-session");
	}
	// Automatic skill catalog stays off for every dispatched role: a worker that
	// discovers a process skill on its own turns a scoped brief into someone else's SOP.
	// Explicit `-e` skillloader below may still register skill_search/skill_load.
	args.push("--no-skills");
	// MAIN already uses `--no-extensions` so `settings.json` packages never load.
	// Workers must do the same: a discovered package can call `setActiveTools()`
	// and permanently replace the `--tools` allowlist (live failure: only `read`).
	// Explicit `-e` mounts below still load.
	args.push("--no-extensions");
	// PipiUI-only tool names must be filtered before `--tools`: Pi 0.84 applies that flag to
	// extension/custom registrations too, so an absent feature path cannot leave a dead name in
	// a role's allowlist. Generic `web_search` stays independent of that set because it may be
	// provider-native; it is hidden only when the worker model has effective native web_search.
	const pipiuiExtensionRouting = resolvePipiUIExtensionRouting({
		webAccessExtension: PIPIUI_WEB_ACCESS_EXT,
		arxivExtension: PIPIUI_ARXIV_EXT,
		// Registry-mounted extensions reach workers through PIPIUI_EXT_REGISTERED_PATHS,
		// not a legacy route export: when web-access-extension is in that snapshot, the
		// bare arxiv-fetch package must not mount too (duplicate arxiv_fetch kills the
		// worker's pi process at extension load).
		mountedExtensionIds: mountedExtensionIdsFromEnv(),
	});
	const hideGenericWebSearch = hideGenericWebSearchForModelRef(
		resolvedModel ? stripModelThinkingSuffix(resolvedModel) : undefined,
		loadNativeSearchCatalog(),
	);
	const workerSkillLoaderPath = resolveWorkerSkillLoaderPath({
		env: { PIPIUI_SKILLLOADER_EXT },
		bundledPath: fileURLToPath(new URL("../../extensions/pipiui-skillloader.ts", import.meta.url)),
		existsSync: (candidate) => fs.existsSync(candidate),
	});
	const memoryOmissionReason = terminalMemoryBrokerEnvironment
		? undefined
		: !memoryBrokerRole
			? "disabled-by-role"
			: !mainMemoryBrokerIssuer()
				? "no-host-broker"
				: !issuedMemoryBrokerEnvironment
					? "capability-not-issued"
					: "package-not-verified";
	const workerReadToolOmissions = diagnoseWorkerReadToolOmissions({
		hasMemoryBrokerCapability: !!terminalMemoryBrokerEnvironment,
		hasSessionRecall: Boolean(PIPIUI_SUBAGENT_EXT),
		hasSkillLoader: Boolean(workerSkillLoaderPath),
		memoryOmissionReason,
	});
	const workerReadToolOmissionText = formatWorkerReadToolOmissions(workerReadToolOmissions);
	const mountedExtensionIds = mountedExtensionIdsFromEnv();
	const toolPatch = dispatchToolPatch(
		agent,
		mountedExtensionIds,
		extensionToolOwnership(),
	);
	// Child → Boss question channel: only a Boss (depth 0) can answer, so only its direct
	// workers get the tool. A nested parent has no subagent_reply and would let it time out.
	const questionDir = PIPIUI_DEPTH === 0 ? questionDirFor(pipiuiAgentId, runId) : undefined;
	const toolSelection = resolveSubagentToolSelection({
		hasAskBoss: Boolean(questionDir),
		// Keep the role-local guard explicit at the caller as well as in the
		// shared resolver: a secretary may never regain recursive delegation.
		// Depth-gated: a child at/above PIPIUI_MAX_DEPTH must not even see the tools.
		// Extension extras stay provenance-tagged until this mount filter; runtime
		// suffixes (placement/isolation/closeout/findings) are appended after
		// the (already patched) definition prompt below.
		declaredTools: toolPatch.declaredTools?.filter(
			(t) => allowRecursiveDelegation || !isDelegationTool(t),
		),
		disabledTools: [...loadDisabledTools(), ...toolPatch.extraDisabledTools],
		hasMemoryBrokerCapability: !!terminalMemoryBrokerEnvironment,
		// The subagent extension that registers session_recall is mounted below
		// (`-e PIPIUI_SUBAGENT_EXT`); without recall a compacted worker cannot
		// find its own task back from the raw JSONL.
		hasSessionRecall: Boolean(PIPIUI_SUBAGENT_EXT),
		hasSkillLoader: Boolean(workerSkillLoaderPath),
		allowRecursiveDelegation,
		availableExtensionTools: pipiuiExtensionRouting.extensionOnlyTools,
		hideGenericWebSearch,
	});
	// 嵌套委派也加载补丁版 subagent（主会话通过 PIPIUI_SUBAGENT_EXT 传入目录）
	if (PIPIUI_SUBAGENT_EXT) args.push("-e", PIPIUI_SUBAGENT_EXT);
	if (PIPIUI_CODING_TOOLS_EXT) args.push("-e", PIPIUI_CODING_TOOLS_EXT);
	for (const part of workerSkillLoaderMountArgs(workerSkillLoaderPath)) {
		args.push(part);
	}
	if (PIPIUI_PHILOSOPHY_EXT) args.push("-e", PIPIUI_PHILOSOPHY_EXT);
	if (PIPIUI_OFFICE_DOC_SHOT_GATE_EXT) args.push("-e", PIPIUI_OFFICE_DOC_SHOT_GATE_EXT);
	// Registry-enabled project extensions: remount the main-session snapshot (D3 / D9).
	// Same `-e` paths assemblePiSpawn already mounted; do not scan bare files here.
	const registeredExtensionPaths = process.env.PIPIUI_EXT_REGISTERED_PATHS;
	if (registeredExtensionPaths) {
		for (const mount of registeredExtensionPaths.split(path.delimiter)) {
			if (mount) args.push("-e", mount);
		}
	}
	// The official package owns the child-side read-only query registration.
	// Mount it only alongside a complete main-issued capability tuple.
	if (terminalMemoryBrokerEnvironment) {
		const memoryBrokerExtension = memoryBrokerExtensionPathForChild(terminalMemoryBrokerEnvironment);
		if (memoryBrokerExtension) args.push("-e", memoryBrokerExtension);
	}
	if (PIPIUI_SEARCH_SCOPE_EXT) args.push("-e", PIPIUI_SEARCH_SCOPE_EXT);
	for (const route of selectPipiUIExtensionRoutes(pipiuiExtensionRouting, toolSelection)) {
		args.push("-e", route.path);
	}
	// Last on purpose: pi chains before_agent_start through extensions in mount order, so only
	// a final mount sees the prompt every other one has finished writing.
	if (promptDebugPath) args.push("-e", PIPIUI_PROMPT_OBSERVER_EXT!);
	for (const skillPath of options?.privateSkillPaths ?? []) args.push("--skill", skillPath);
	// A new explicit thinking override wins over Pi's older `model:thinking` shorthand.
	// Strip only a recognized shorthand suffix, preserving other colon-containing model ids.
	const forceThinkingOff = forkSanitizedSummary?.thinkingOff === true;
	if (resolvedModel) args.push("--model", resolvedThinking || forceThinkingOff ? stripModelThinkingSuffix(resolvedModel) : resolvedModel);
	if (forceThinkingOff) args.push("--thinking", "off");
	else if (resolvedThinking) args.push("--thinking", resolvedThinking);
	if (toolSelection.flag === "--no-tools") {
		args.push("--no-tools");
	} else {
		args.push(toolSelection.flag, toolSelection.names.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		// Carried on the result because the done formatter runs far from the agent definition.
		reportsInFull: agent.traits.reportsInFull,
		task,
		title: options?.title,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {
			...emptyUsage(),
			...(options?.contextWindow ? { contextWindow: options.contextWindow } : {}),
		},
		model: resolvedModel,
		step,
		agentId: pipiuiAgentId,
		runId,
		...(resumingSession ? { resumed: true } : {}),
	};

	let pipiuiLastUpdate = 0;
	let pipiuiActivity = "";
	let pipiuiActiveTools: ActiveTool[] = [];
	const currentActiveTool = (): ActiveTool | undefined => latestActiveTool(pipiuiActiveTools);
	const projectActiveTool = (emit: boolean) => {
		const tool = currentActiveTool();
		pipiuiActivity = tool?.summary ?? "";
		if (!emit) return;
		pipiuiReport(tool ? {
			kind: "activity",
			agentId: pipiuiAgentId,
			runId,
			activity: tool.summary,
			activityActive: true,
			...(tool.toolCallId ? { activityToolCallId: tool.toolCallId } : {}),
			activityToolName: tool.name,
			activityStartedAt: tool.startedAt,
		} : {
			kind: "activity",
			agentId: pipiuiAgentId,
			runId,
			activity: null,
			activityActive: false,
			activityEndedAt: Date.now(),
		});
	};
	const beginActiveTool = (tool: ActiveTool, emit = true) => {
		pipiuiActiveTools = upsertActiveTool(pipiuiActiveTools, tool);
		projectActiveTool(emit);
	};
	/** The usage-budget abort itself; callers decide when it is safe (see noteUsageBudget). */
	const abortForUsageBudget = () => {
		if (usageBudgetAborted || !usageBudgetState) return;
		if (usageBudgetGraceTimer) {
			clearTimeout(usageBudgetGraceTimer);
			usageBudgetGraceTimer = undefined;
		}
		usageBudgetAborted = true;
		usageBudgetState.aborted = true;
		currentResult.stopReason = "usage_budget";
		currentResult.errorMessage = formatUsageBudgetAbortReason(usageBudgetState);
		pipiuiActivity = currentResult.errorMessage;
		pipiuiUpdate(true);
		handleForRun(pipiuiAgentId, runId)?.controller.abort();
	};
	/** True while a tool other than ask_boss is in flight: not a safe point to cut. */
	const mutationCapableToolInFlight = () => pipiuiActiveTools.some((tool) => tool.name !== ASK_BOSS_TOOL_NAME);
	const finishActiveTool = (ref: { toolCallId?: string; name?: string }) => {
		pipiuiActiveTools = removeActiveTool(pipiuiActiveTools, ref);
		projectActiveTool(true);
		// The safe point a pending usage-budget abort was waiting for.
		if (usageBudgetAbortPending && !usageBudgetAborted && !mutationCapableToolInFlight()) abortForUsageBudget();
	};
	const clearActiveTools = () => {
		pipiuiActiveTools = [];
		projectActiveTool(true);
	};
	const stallDiagnostics = createStallDiagnosticsState();
	pipiuiReportQueue.beginRun(pipiuiAgentId, runId);
	await postPipiuiReport({
		kind: "start",
		agentId: pipiuiAgentId,
		runId,
		parentId: options?.parentAgentId === undefined ? PIPIUI_PARENT : options.parentAgentId,
		toolCallId: options.toolCallId,
		name: agentName,
		task,
		depth: options?.depth ?? PIPIUI_DEPTH + 1,
		model: resolvedModel ?? null,
		...(options?.contextWindow ? { contextWindow: options.contextWindow } : {}),
		...(options?.title ? { title: options.title } : {}),
		...(options?.deadlineAt ? { deadlineAt: options.deadlineAt } : {}),
		...(isBackground ? { background: true } : {}),
		...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
		...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
		...(placement.worktreeError ? { worktreeError: placement.worktreeError } : {}),
		diagnostics: snapshotStallDiagnostics({
			agentId: pipiuiAgentId,
			runId,
			state: stallDiagnostics,
			lastActivityAt: Date.now(),
		}),
	});
	jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title, options?.blockedBy, runId, resolvedModel, { planTask: options?.planTask, scope: options?.scope });
	// Foreground and background dispatches alike need a separately
	// addressable abort handle; the parent tool signal is composed at spawn.
	const dispatchAbort = new AbortController();
	// Prime the progress-log baseline at spawn time so watchdog deltas measure only THIS run's
	// appends (leftover bytes from a resumed agentId are never re-reported or credited as progress).
	let progressLogFields: Partial<RunningAgentHandle> = {};
	if (progressLogSpec) {
		const baseline = sampleProgressLog({ path: progressLogSpec.path, now: Date.now() });
		progressLogFields = {
			progressLogPath: progressLogSpec.path,
			progressLogSample: baseline,
			progressLogOffset: baseline.size,
			progressLogSetAt: Date.now(),
			...(executionPolicy?.heartbeatMs ? { progressLogIntervalMs: executionPolicy.heartbeatMs } : { progressLogIntervalMs: DEFAULT_PROGRESS_LOG_REPORT_MS }),
		};
	}
		runningAgents.set(pipiuiAgentId, {
			runId,
			controller: dispatchAbort,
			name: agentName,
			task,
			title: options?.title,
			lastActivityAt: Date.now(),
			lastStallNotifyAt: 0,
			stallNotifyCount: 0,
			checkinCount: 0,
			checkinInFlight: false,
			startedAt: Date.now(),
			spawnCwd,
			...(executionPolicy ? { progressLogEligible: true } : {}),
			...(executionPolicy?.heartbeatMs ? { heartbeatMs: executionPolicy.heartbeatMs } : {}),
			...progressLogFields,
			finalizing: false,
			...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
			...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
			readOnly: Boolean(agent.traits.readOnly),
			syncWait: !isBackground,
			diagnostics: stallDiagnostics,
		});
		projectFinalizationPhase(pipiuiAgentId, runId, "generating");
		armIdleFoldForDispatch(pipiuiAgentId);
	const pipiuiUpdate = (force = false) => {
		const now = Date.now();
		if (!force && now - pipiuiLastUpdate < 500) return;
		pipiuiLastUpdate = now;
		const liveHandle = handleForRun(pipiuiAgentId, runId);
		const liveTool = currentActiveTool();
		pipiuiReport(attachDiagnostics({
			kind: "update",
			agentId: pipiuiAgentId,
			runId,
			output: (getFinalOutput(currentResult.messages) || "").slice(-4000),
			...(liveTool ? {
				activity: liveTool.summary,
				activityActive: true,
				...(liveTool.toolCallId ? { activityToolCallId: liveTool.toolCallId } : {}),
				activityToolName: liveTool.name,
				activityStartedAt: liveTool.startedAt,
			} : {
				activity: null,
				activityActive: false,
			}),
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
		}, liveHandle));
		jobPatchRunning(pipiuiAgentId, runId, {
			activity: pipiuiActivity,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
		});
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	let runtimeTimedOut = false;
	let runtimeTimeout: ReturnType<typeof createRunScopedTimeout> | undefined;
	let runtimeTimeoutNotified = false;
	let runtimeProviderPhase: ProviderWaitPhase = "model-active";
	let runtimePendingTools: string[] = [];
	let firstChildSpawnedAt: number | undefined;
	const semanticGuardActive =
		agent.origin === "bundled" &&
		agent.name === "general-purpose" &&
		!agent.traits.readOnly;
	let semanticProgress: SemanticProgressState = createSemanticProgressState();
	let semanticNoProgress = false;
	/** One line of "what this worker was doing when its budget expired"; rides the boss
	 *  notification and the terminal receipt so neither is a bare "exceeded Ns" again. */
	const runtimeBudgetDiagnostic = (now: number): string => {
		const handle = handleForRun(pipiuiAgentId, runId);
		const idleSec = handle ? Math.max(0, Math.floor(progressIdleMs(now, handle) / 1000)) : -1;
		const phase =
			runtimeProviderPhase === "awaiting-model"
				? `awaiting model response (${currentResult.model || resolvedModel || agentName})`
				: runtimeProviderPhase === "running-tool"
					? `running tool${runtimePendingTools.length > 0 ? ` ${runtimePendingTools.join(",")}` : "s"}`
					: runtimeProviderPhase === "resident-idle"
						? "resident RPC parent waiting for descendants"
						: "streaming model output";
		const pid = handle?.pid;
		const alive = typeof pid === "number" ? (isProcessAlive(pid) ? "alive" : "dead") : "unknown";
		return [
			`budget=${Math.round((executionPolicy?.timeoutMs ?? 0) / 1000)}s`,
			`elapsed=${firstChildSpawnedAt !== undefined ? Math.round((now - firstChildSpawnedAt) / 1000) : 0}s`,
			`idle=${idleSec}s`,
			`phase=${phase}`,
			`turns=${currentResult.usage.turns}`,
			`contextTokens=${currentResult.usage.contextTokens}`,
			`cost=$${currentResult.usage.cost.toFixed(4)}`,
			`child pid=${pid ?? "?"}(${alive})`,
			`last=${(pipiuiActivity || "(none)").slice(0, 160)}`,
			sessionDir ? `session=${sessionId}` : "session=none",
		].join(" · ");
	};
	try {
		// Central child prompt: the agent's own system prompt plus any runtime
		// placement or bundled private-skill suffixes.
		const promptParts: string[] = [];
		if (agent.systemPrompt.trim()) promptParts.push(agent.systemPrompt);
		if (executionPolicy?.worktree === "none" && executionPolicy.noWorktreeReason) {
			promptParts.push(
				`[Runtime placement: shared cwd]\nThe Boss explicitly disabled worktree isolation for this dispatch. Reason: ${executionPolicy.noWorktreeReason}\nOperate directly in the assigned cwd. Do not assume automatic merge, cleanup, or isolation from concurrent work.`,
			);
		}
		for (const skillPath of options?.privateSkillPaths ?? []) {
			try {
				const content = fs.readFileSync(skillPath, "utf8").trim();
				if (content) promptParts.push(`[Bundled private skill: ${path.basename(path.dirname(skillPath))}]\n${content}`);
			} catch (error) {
				throw new Error(`Cannot load bundled private skill ${skillPath}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		// Base first, then the agent's own prompt: the base is the floor every later
		// instruction is more specific than, and Pi appends these in argument order.
		if (PIPIUI_CORE_PROMPT) args.push("--append-system-prompt", PIPIUI_CORE_PROMPT);
		if (promptParts.length > 0) {
			const tmp = await writePromptToTempFile(
				agent.name,
				promptParts.join("\n\n"),
			);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		// Print mode receives its sole prompt as argv. Resident RPC workers keep stdin
		// open and receive this exact initial task after stdout listeners are attached.
		if (!useNestedRpc) args.push(`Task: ${task}`);
		const initialRpcPromptId = `initial-${runId}`;
		let wasAborted = false;
		// Auto-resume: transport/API deaths used to mark the job failed with zero recovery even
		// though `--session-id` already supports resume. Re-spawn up to AUTO_RESUME_MAX times
		// (same args → session resume for stateful roles; cold restart for --no-session).
		let autoResumeCount = 0;
		let providerStallResumeCount = 0;
			let spawnAttempt = 0;
			let exitCode = 1;
		// Model fallback chain: only advances when Settings gave this agent an explicit
		// multi-model chain (index 0 is the primary model, i.e. resolvedModel).
			let modelChainIndex = 0;
			const modelFallbackNotes: string[] = [];
			const abortForSemanticNoProgress = (): void => {
				if (!semanticGuardActive || semanticNoProgress) return;
				semanticNoProgress = true;
				const now = Date.now();
				const elapsedSec = firstChildSpawnedAt === undefined
					? 0
					: Math.max(0, Math.floor((now - firstChildSpawnedAt) / 1000));
				currentResult.stopReason = "semantic_no_progress";
				currentResult.errorMessage = [
					"semantic_no_progress: inspect-stall watchdog stopped this worker after",
					`${GENERAL_PURPOSE_SEMANTIC_TURN_CAP} consecutive turns of repeated read-only actions with no write/validation progress.`,
					`elapsed=${elapsedSec}s`,
					`turns=${semanticProgress.completedTurns}`,
					`inspectOnlyStreak=${semanticProgress.inspectOnlyStreak}`,
					`progressEvents=${semanticProgress.progressEvents}`,
					`last=${semanticProgress.lastSummary.slice(0, 240)}`,
				].join(" ");
				pipiuiActivity = currentResult.errorMessage;
				pipiuiUpdate(true);
				dispatchAbort.abort();
			};
			const observeSemanticToolResult = (result: {
				toolCallId: string;
				toolName?: string;
				isError: boolean;
			}): void => {
				if (!semanticGuardActive || semanticNoProgress) return;
				const decision = advanceSemanticProgress(semanticProgress, {
					type: "tool-result",
					toolCallId: result.toolCallId,
					...(result.toolName ? { toolName: result.toolName } : {}),
					isError: result.isError,
				});
				semanticProgress = decision.state;
				if (decision.terminate) abortForSemanticNoProgress();
			};

		for (;;) {
			spawnAttempt += 1;
			// Snapshot so retry classification only sees THIS attempt (prior "fetch failed"
			// text in accumulated messages/stderr must not force another resume).
			const attemptMessagesFrom = currentResult.messages.length;
			const attemptStderrFrom = currentResult.stderr.length;
			let providerStallTimedOut = false;
			let rpcInitialPromptRejected = false;
			// Retry attempts are separate processes: a stale status from the old pipe
			// must never wake the new resident. Keep this opaque value transport-local.
			const residentRpcWakeToken = useNestedRpc ? randomBytes(24).toString("base64url") : undefined;
			const residentRpcWakeStatusKey = residentRpcWakeToken
				? residentRpcShutdownWakeStatusKey(residentRpcWakeToken)
				: undefined;
			const residentRpcWakeRequestId = residentRpcWakeToken ? randomUUID() : undefined;
			exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const childEnvironmentInput = {
					PIPIUI_AGENT_ID: pipiuiAgentId,
					PIPIUI_AGENT_RUN_ID: runId,
					...(questionDir ? { [QUESTION_DIR_ENV]: questionDir } : {}),
					...(toolBudget ? { [TOOL_BUDGET_ENV]: encodeToolBudgetEnv(toolBudget) } : {}),
					PIPIUI_AGENT_DEPTH: String(childDepth),
					PIPIUI_AGENT_TREE_DEPTH: String(childDepth),
					// Marks only recursive nested parents. A leaf never enters resident mode,
					// even if its own parent is resident.
					PIPIUI_NESTED_RPC_PARENT: useNestedRpc ? "1" : undefined,
					PIPIUI_RESIDENT_RPC_WAKE_TOKEN: residentRpcWakeToken,
					// Fan-out invariant propagation: workers cannot see the main-scoped philosophy
					// layer in their own state file, so the parent's resolved fan-out state rides
					// the env. fanoutLayerActive() reads it back and re-stamps its own children,
					// so grandchildren inherit transitively.
					...(fanoutLayerActive() ? { PIPIUI_FANOUT_ACTIVE: "1" } : {}),
					PIPIUI_AGENT_ROLE: runtimePolicy.role,
					...(terminalMemoryBrokerEnvironment ?? {}),
					// Scope marker read by the philosophy package. Every dispatched agent is a
					// worker, whatever it may itself dispatch. There used to be a third role
					// here — `lead`, for an agent that delegates — but the roster it was
					// invented for is gone, and the condition below could only ever select
					// `general-purpose`. A one-member role is not an abstraction, and this one
					// actively misdelivered: `lead` carried the boss layers, so the one agent
					// whose job is to hand back an implementation was told it does not work the
					// floor, and was handed a fan-out contract that is false at its depth.
					// Layers that genuinely belong to a delegating worker now address it by
					// name (`scope: [general-purpose]`), which also survives the
					// `scopes.worker` bulk switch — a layer that names its audience is not
					// untargeted bulk.
					PIPI_PHILOSOPHY_ROLE: "worker",
					// The agent's own name, so a philosophy layer can address one kind of worker:
					// craft rules to whoever writes code, research rules to whoever investigates.
					// Without it every dispatched agent looks alike and only role-wide layers land.
					PIPI_PHILOSOPHY_AGENT: agentName,
					// Absent when the observer is not mounted; the extension no-ops without it.
					PIPIUI_PROMPT_DEBUG_FILE: promptDebugPath,
					// This extension owns the orchestration / fan-out / nested-dispatch layers,
					// so a child that loads the philosophy has to be pointed at them too — the
					// nested-dispatch layer is scoped to `general-purpose` and reaches nobody
					// if only the main session is told where the directory is.
					PIPI_PHILOSOPHY_LAYER_DIRS: path.join(SUBAGENT_EXT_DIR, "layers"),
					...(mainModelForChild ? { PIPIUI_MAIN_MODEL: mainModelForChild } : {}),
					// Automatic skill catalog stays off; explicit skill_search/skill_load may still mount.
					// An agent that asks for it (`block-skill-reads: true`) also cannot read SKILL.md at all.
					PIPIUI_SUBAGENT_SKILL_ISOLATION: "1",
					PIPIUI_SKILL_READ_BLOCK: agent.traits.blockSkillReads ? "1" : undefined,
					...(workerReadToolOmissionText
						? { PIPIUI_WORKER_READ_TOOLS_OMISSION: workerReadToolOmissionText }
						: {}),
					...(runtimePolicy.worktree === "main-session"
						? { PIPIUI_WORKTREE: "0", PIPIUI_AGENT_NO_DELEGATION: "1" }
						: {}),
					...(placement.worktreePath ? { PIPIUI_WORKTREE_PATH: placement.worktreePath } : {}),
					...(placement.worktreeBranch ? { PIPIUI_WORKTREE_BRANCH: placement.worktreeBranch } : {}),
				};
				const childEnv = pipiuiChildProcessEnv(childEnvironmentInput);
				// chatrpg/keeper and similar packages skip setActiveTools(kpSet) when this is set.
				// `--no-extensions` is the primary isolation; this keeps the child surface if a
				// package is still mounted via explicit `-e`.
				childEnv.PI_SUBAGENT_CHILD = "1";
				const proc = spawn(invocation.command, invocation.args, {
					cwd: spawnCwd,
					shell: false,
					// RPC owns its stdin until ctx.shutdown() after descendant completion.
					stdio: [useNestedRpc ? "pipe" : "ignore", "pipe", "pipe"],
					detached: false,
					// 把 agent 树身份传给子进程：子进程再派 subagent 时 parentId/depth 自动正确
					// PIPIUI_SUBAGENT_EXT / SEARCH_SCOPE_EXT / grant file / bridge / session
					// 经 process.env 继承；子进程只读当前真人回合的 grant file。
					env: childEnv,
				});
				pipiuiTrackChild(proc);
				if (firstChildSpawnedAt === undefined) {
					firstChildSpawnedAt = Date.now();
					const handle = handleForRun(pipiuiAgentId, runId);
					if (handle) handle.startedAt = firstChildSpawnedAt;
				}
				if (executionPolicy?.timeoutMs !== undefined && runtimeTimeout === undefined) {
					runtimeTimeout = createRunScopedTimeout({
						runId,
						timeoutMs: executionPolicy.timeoutMs,
						now: () => firstChildSpawnedAt!,
						isCurrentRun: (candidateRunId) => handleForRun(pipiuiAgentId, candidateRunId) !== undefined,
						onTimeout() {
							// Budget expiry is progress-aware: a producing worker silently earns
							// another budget; a stalled background worker earns one diagnostic plus
							// one final budget; a stalled sync-wait aborts on the first expiry
							// because the boss turn cannot receive that diagnostic.
							const now = Date.now();
							const handle = handleForRun(pipiuiAgentId, runId);
							const idleMs = handle ? progressIdleMs(now, handle) : Number.POSITIVE_INFINITY;
							// Same subtree-CPU evidence the stall watchdog uses. A worker that
							// delegated is silent on its own stream while the grandchild works,
							// and without this it was killed for its child's silence.
							const budgetVerdict = stalledInfoFor(pipiuiAgentId, now).verdict;
							// Blocked on the Boss's answer: that silence is ours, not the worker's.
							const expiry = workerWaitingOnBoss(handle) ? "extend-silent" : decideRuntimeBudgetExpiry({
								idleMs,
								progressGraceMs: STALL_THRESHOLD_MS,
								notified: runtimeTimeoutNotified,
								syncWait: handle?.syncWait === true,
								...(budgetVerdict ? { verdict: budgetVerdict } : {}),
							});
							if (expiry === "abort") {
								runtimeTimedOut = true;
								currentResult.stopReason = "runtime_timeout";
								currentResult.errorMessage = `runtime_timeout: exceeded ${executionPolicy.timeoutMs! / 1000}s runtime budget with no progress (${runtimeBudgetDiagnostic(now)})`;
								pipiuiActivity = currentResult.errorMessage;
								pipiuiUpdate(true);
								handleForRun(pipiuiAgentId, runId)?.controller.abort();
								return;
							}
							const extendedDeadlineAt = runtimeTimeout!.extend();
							if (handle) handle.deadlineAt = extendedDeadlineAt;
							pipiuiReport({ kind: "update", agentId: pipiuiAgentId, runId, deadlineAt: extendedDeadlineAt });
							if (expiry === "notify-extend") {
								runtimeTimeoutNotified = true;
								const budgetSec = Math.round(executionPolicy.timeoutMs! / 1000);
								const title = options.title?.trim() || task.split("\n")[0]?.trim().slice(0, 80) || "(untitled)";
								runtimeBudgetNotify(
									[
										`[subagent-timeout] agentId=${pipiuiAgentId} runId=${runId} title=${title}`,
										`  ${runtimeBudgetDiagnostic(now)}`,
										`The ${budgetSec}s runtime budget expired while this worker made no progress. It has been re-armed once for another ${budgetSec}s instead of being killed.`,
										`Before the new budget expires, query subagent_status({agentId:"${pipiuiAgentId}"}), then choose exactly one: keep waiting and say why / subagent_abort({agentId:"${pipiuiAgentId}", runId:"${runId}"}) and re-dispatch by a materially different route / ask the user.`,
										`If the re-armed budget also expires with no progress the worker is aborted automatically and its result carries this same diagnostic. Do not treat this message as a new user request.`,
									].join("\n"),
								);
								pipiuiActivity = `runtime budget expired (idle ${Math.floor(idleMs / 1000)}s); re-armed once, boss notified`;
							} else {
								pipiuiActivity = `runtime budget re-armed (still producing, idle ${Math.floor(idleMs / 1000)}s)`;
							}
							pipiuiUpdate(true);
						},
					});
					const handle = handleForRun(pipiuiAgentId, runId);
					if (handle) {
						handle.startedAt = runtimeTimeout.deadlineAt - executionPolicy.timeoutMs;
						handle.deadlineAt = runtimeTimeout.deadlineAt;
					}
					pipiuiReport({ kind: "update", agentId: pipiuiAgentId, runId, deadlineAt: runtimeTimeout.deadlineAt });
				}
				let procExited = false;
				let forceKill: ReturnType<typeof setTimeout> | undefined;
				let detachChildAbort = (): void => {};
				const clearChildExitTimers = (): void => {
					if (forceKill !== undefined) {
						clearTimeout(forceKill);
						forceKill = undefined;
					}
					detachChildAbort();
					detachChildAbort = () => {};
				};
				const terminateAttempt = () => {
					if (procExited) return false;
					if (forceKill === undefined) {
						forceKill = setTimeout(() => {
							forceKill = undefined;
							if (!procExited) proc.kill("SIGKILL");
						}, 5000);
						forceKill.unref?.();
					}
					return proc.kill("SIGTERM");
				};
				const childExitRole = agent.traits.readOnly ? "read-only" : "writable";
				const childExitCloseout = createChildExitCloseout({
					agent: pipiuiAgentId,
					run: runId,
					role: childExitRole,
					pid: proc.pid,
					...(agent.traits.readOnly
						? { graceMs: readonlyChildExitGraceMs() }
						: { graceMs: writableChildExitGraceMs() }),
					terminate: terminateAttempt,
					onProbe(fields) {
						logCloseoutProbe("child-exit", fields);
						const error = closeoutPhaseError("child-exit", fields.state);
						if (!error) return;
						const phase = handleForRun(pipiuiAgentId, runId)?.diagnostics.finalizationPhase ?? "final-received";
						projectFinalizationPhase(pipiuiAgentId, runId, phase, { error });
					},
				});
				// Diagnostics only: never arms a deadline and never changes terminate.
				const childExitProbe = createChildExitTimelineProbe({
					proc,
					agent: pipiuiAgentId,
					run: runId,
					role: childExitRole,
					childPid: proc.pid,
					depth: childDepth,
					attempt: spawnAttempt,
					cause: () => {
						if (childExitCloseout.forced()) {
							return childExitRole === "writable" ? "post-final-grace-expired" : "grace-timeout";
						}
						if (providerStallTimedOut) return "provider-stall";
						if (runtimeTimedOut) return "runtime-budget";
						if (wasAborted) return "abort";
						return "none";
					},
				});
				let providerWait!: ReturnType<typeof createProviderWaitController>;
				providerWait = createProviderWaitController({
					model: currentResult.model || resolvedModel || agentName,
					onPhase(phase) {
						runtimeProviderPhase = phase;
						if (phase !== "running-tool") runtimePendingTools = [];
						if (phase !== "awaiting-model") return;
						pipiuiActivity = providerWait.activity();
						pipiuiUpdate(true);
					},
					onTimeout() {
						if (procExited || wasAborted) return;
						providerStallTimedOut = true;
						currentResult.stopReason = "provider_stall_timeout";
						currentResult.errorMessage = `provider_stall_timeout: ${providerWait.activity()}`;
						pipiuiActivity = currentResult.errorMessage;
						pipiuiUpdate(true);
						terminateAttempt();
					},
				});
				// Recorded so the heartbeat can tell "quiet" from "gone". Bind it to this
				// generation so an old child cannot attach its pid to a reused agentId.
				const setResidentRpcIdle = (idle: boolean) => {
					if (!useNestedRpc) return;
					const residentHandle = handleForRun(pipiuiAgentId, runId);
					if (residentHandle) residentHandle.residentIdleWait = idle;
					if (idle) providerWait.suspendForResidentIdle();
					else providerWait.resumeFromResidentIdle();
				};
				// ctx.shutdown() in bundled RPC marks a flag; its runtime checks that flag
				// only after agent_settled or another JSONL command. The waker accepts only
				// this attempt's opaque status channel after this child has settled idle.
				const residentRpcShutdownWaker = residentRpcWakeStatusKey && residentRpcWakeRequestId
					? createResidentRpcShutdownWaker({
						statusKey: residentRpcWakeStatusKey,
						requestId: residentRpcWakeRequestId,
						stdin: () => proc.stdin,
						isResidentIdle: () => handleForRun(pipiuiAgentId, runId)?.residentIdleWait === true,
						isClosed: () => procExited || wasAborted,
					})
					: undefined;
				const liveHandle = handleForRun(pipiuiAgentId, runId);
				if (liveHandle) {
					liveHandle.pid = proc.pid;
					liveHandle.finalizing = false;
					noteAgentActivity(pipiuiAgentId, runId);
				}
				// pi 0.84+: message_update carries assistantMessageEvent deltas only.
				// Assemble text/thinking by contentIndex and push throttled cumulative
				// snapshots (kind: log_delta) so the native panel streams live.
				// message_end remains authoritative for tools + non-streamed fallback.
				type StreamPart = { itemType: "text" | "thinking" | "tool"; text: string; name: string; toolCallId?: string; charCount?: number };
				const streamParts = new Map<number, StreamPart>();
				const streamDirty = new Set<number>();
				const fileChangeBuffers = new Map<number, { name: string; raw: string }>();
				const toolCallIdsByContentIndex = new Map<number, string>();
				let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
				// Throttle state and the openai-completions output estimate live in the emitter
				// now (streaming-usage.ts), where the read→fallback→combine→throttle sequence is
				// covered by behavior tests instead of source-text assertions.
				// usageBudget rides the same reported-usage stream the host sees: no reservations,
				// no estimates. Soft is one notice to the Boss; hard takes the timeoutSecs abort path.
				const noteUsageBudget = (usage: { input: number; output: number; cost: number }) => {
					if (!usageBudget || usageBudgetAborted) return;
					usageBudgetState = evaluateUsageBudget(usageBudget, usage);
					if (usageBudgetState.softExceeded && !usageBudgetNoticeSent) {
						usageBudgetNoticeSent = true;
						if (bossPi) void sendUserMessageAfterCutIn(bossPi, formatUsageBudgetSoftNotice(pipiuiAgentId, runId, usageBudgetState));
					}
					if (usageBudgetState.exhausted && !usageBudgetAbortPending) {
						usageBudgetAbortPending = true;
						if (!mutationCapableToolInFlight()) {
							abortForUsageBudget();
							return;
						}
						// Mid-tool: cut after it returns. A tool that never returns is not a safe
						// point that is coming, so the grace timer aborts anyway.
						const inFlight = currentActiveTool()?.name ?? "tool";
						pipiuiActivity = `usage_budget: hard limit reached; aborting after the current ${inFlight} call returns`;
						pipiuiUpdate(true);
						usageBudgetGraceTimer = setTimeout(abortForUsageBudget, USAGE_BUDGET_SAFE_POINT_GRACE_MS);
						usageBudgetGraceTimer.unref?.();
					}
				};
				const usageEmitter = createUsageEmitter({
					session: () => ({ usage: currentResult.usage, model: currentResult.model }),
					report: (payload) => {
						pipiuiReport({
							kind: "usage",
							agentId: pipiuiAgentId,
							runId,
							turn: payload.turn,
							model: payload.model,
							tools: payload.tools,
							usage: payload.usage,
						});
						noteUsageBudget(payload.usage);
					},
				});
				const countLiveEstimate = (delta: string) => usageEmitter.countDelta(delta);
				// The host/UI show a cumulative preview, not a token animation. A 50ms
				// cadence forced Electron to structured-clone and rebuild the complete
				// detail transcript twenty times per second for every selected worker.
				const STREAM_FLUSH_MS = 200;
				const STREAM_TEXT_CAP = 4000;
				const STREAM_THINKING_CAP = 600;

				const flushStreamParts = () => {
					if (streamDirty.size === 0) return;
					const indices = [...streamDirty].sort((a, b) => a - b);
					streamDirty.clear();
					for (const idx of indices) {
						const part = streamParts.get(idx);
						if (!part) continue;
						// Skip empty placeholders (e.g. bare text_start) until first delta.
						if (!part.text && part.itemType !== "tool") continue;
						pipiuiReport({
							kind: "log_delta",
							agentId: pipiuiAgentId,
							runId,
							contentIndex: idx,
							itemType: part.itemType,
							text: part.text,
							...(part.itemType === "thinking" && typeof part.charCount === "number"
								? { charCount: part.charCount }
								: {}),
							...(part.name ? { name: part.name } : {}),
							...(part.toolCallId ? { toolCallId: part.toolCallId } : {}),
						});
					}
					// log_delta already carries live preview/liveness. Emitting a second
					// full summary for the same flush made every worker invalidate the
					// root App as well as the selected detail transcript.
				};

				const scheduleStreamFlush = () => {
					if (streamFlushTimer) return;
					streamFlushTimer = setTimeout(() => {
						streamFlushTimer = null;
						flushStreamParts();
					}, STREAM_FLUSH_MS);
					streamFlushTimer.unref?.();
				};

				const forceFlushStreamParts = () => {
					if (streamFlushTimer) {
						clearTimeout(streamFlushTimer);
						streamFlushTimer = null;
					}
					flushStreamParts();
				};

				const emitUsageSnapshot = (
					usage: StreamingUsageSnapshot,
					options: { turn?: number; model?: string | null; tools?: string[] },
				) => usageEmitter.emitAuthoritative(usage, options);

				const emitStreamingUsage = (raw: unknown, force = false) => usageEmitter.emitLive(raw, force);

				const upsertStreamPart = (
					contentIndex: number,
					itemType: StreamPart["itemType"],
					delta: string,
					name?: string,
					replaceText?: string,
				) => {
					let part = streamParts.get(contentIndex);
					if (!part) {
						part = { itemType, text: "", name: name ?? "" };
						streamParts.set(contentIndex, part);
					} else if (part.itemType !== itemType) {
						part.itemType = itemType;
					}
					if (name) part.name = name;
					const cap = itemType === "thinking"
						? STREAM_THINKING_CAP
						: itemType === "tool"
							? Number.POSITIVE_INFINITY
							: STREAM_TEXT_CAP;
					applyCappedStreamText(part, delta, cap, replaceText);
					streamDirty.add(contentIndex);
					scheduleStreamFlush();
				};

				const processLine = (line: string) => {
					if (!line.trim()) return;
					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					// RPC responses are command-level truth, distinct from streamed agent
					// events. A rejected initial prompt never produces a turn, so do not
					// wait for a provider/stall timeout or attempt an auto-resume.
					if (useNestedRpc && event.type === "response" && event.id === initialRpcPromptId && event.command === "prompt") {
						if (event.success !== true) {
							rpcInitialPromptRejected = true;
							currentResult.stopReason = "error";
							currentResult.errorMessage = `nested RPC prompt rejected: ${typeof event.error === "string" && event.error ? event.error : "unknown prompt preflight failure"}`;
							pipiuiActivity = currentResult.errorMessage;
							pipiuiUpdate(true);
							proc.stdin?.end();
						}
						return;
					}
					if (useNestedRpc && residentRpcShutdownWaker?.consume(event)) {
						// Authenticated shutdown-ready: descendants/queued RPC are terminal,
						// ctx.shutdown() was requested, and this attempt accepted the wake.
						// No further tools will run. Arm here — never on the first assistant final.
						childExitCloseout.arm();
						childExitProbe.markFinal();
						return;
					}
					if (useNestedRpc && event.type === "agent_settled") {
						setResidentRpcIdle(true);
						return;
					}
					if (useNestedRpc && (event.type === "agent_start" || event.type === "turn_start")) {
						setResidentRpcIdle(false);
					}

					// Live deltas (pi 0.84+). Do not wait for message_end.
					if (event.type === "message_update") {
						// Top-level usage is the current assistant message's cumulative
						// provider report. Combine it with completed turns and emit a
						// throttled kind:"usage" so the panel can show live tokens.
						emitStreamingUsage(event.usage ?? event.message?.usage);
						const ame = event.assistantMessageEvent;
						if (ame && typeof ame === "object") {
							providerWait.noteAssistantActivity();
							const ctype = String(ame.type ?? "");
							const contentIndex =
								typeof ame.contentIndex === "number" && Number.isFinite(ame.contentIndex)
									? ame.contentIndex
									: 0;
							if (ctype === "text_start") {
								upsertStreamPart(contentIndex, "text", "");
							} else if (ctype === "text_delta") {
								countLiveEstimate(String(ame.delta ?? ""));
								upsertStreamPart(contentIndex, "text", String(ame.delta ?? ""));
							} else if (ctype === "text_end") {
								const finalText =
									typeof ame.content === "string"
										? ame.content
										: typeof ame.text === "string"
											? ame.text
											: undefined;
								if (typeof finalText === "string") {
									upsertStreamPart(contentIndex, "text", "", undefined, finalText);
								}
								forceFlushStreamParts();
							} else if (ctype === "thinking_start") {
								upsertStreamPart(contentIndex, "thinking", "");
							} else if (ctype === "thinking_delta") {
								countLiveEstimate(String(ame.delta ?? ""));
								upsertStreamPart(contentIndex, "thinking", String(ame.delta ?? ""));
							} else if (ctype === "thinking_end") {
								const finalThinking =
									typeof ame.thinking === "string"
										? ame.thinking
										: typeof ame.content === "string"
											? ame.content
											: undefined;
								if (typeof finalThinking === "string") {
									upsertStreamPart(contentIndex, "thinking", "", undefined, finalThinking);
								}
								forceFlushStreamParts();
							} else if (ctype === "toolcall_start") {
								const toolName = String(ame.name ?? "tool");
								const toolCallId = typeof ame.id === "string" && ame.id
									? ame.id
									: typeof ame.toolCallId === "string" && ame.toolCallId
										? ame.toolCallId
										: undefined;
								beginActiveTool({
									...(toolCallId ? { toolCallId } : {}),
									name: toolName,
									startedAt: Date.now(),
									summary: boundActivitySummary(toolName),
								});
								if (toolCallId) toolCallIdsByContentIndex.set(contentIndex, toolCallId);
								if (toolName === "write" || toolName === "edit") {
									fileChangeBuffers.set(contentIndex, { name: toolName, raw: "" });
									upsertStreamPart(contentIndex, "tool", "", toolName, stringifyCompactFileChange({
										path: "…",
										payloadChars: 0,
										addedChars: 0,
										removedChars: 0,
									}));
								}
								pipiuiUpdate();
							} else if (ctype === "toolcall_delta") {
								countLiveEstimate(String(ame.delta ?? ""));
								const buf = fileChangeBuffers.get(contentIndex);
								if (buf) {
									buf.raw += String(ame.delta ?? "");
									const compact = compactFileChangeFromPartial(buf.name, buf.raw);
									if (compact) {
										const pathLabel = compact.path && compact.path !== "…" ? compact.path : "…";
										const mappedId = toolCallIdsByContentIndex.get(contentIndex);
										const target = activeToolForContentIndex(
											pipiuiActiveTools,
											toolCallIdsByContentIndex,
											contentIndex,
											buf.name,
										);
										beginActiveTool({
											...(mappedId ? { toolCallId: mappedId } : {}),
											name: buf.name,
											startedAt: target?.startedAt ?? Date.now(),
											summary: boundActivitySummary(buf.name, pathLabel),
										}, false);
										upsertStreamPart(contentIndex, "tool", "", buf.name, stringifyCompactFileChange(compact));
									}
								}
							} else if (ctype === "toolcall_end") {
								const call = ame.toolCall && typeof ame.toolCall === "object" ? ame.toolCall : {};
								const parsed = readAssistantToolCall(call) ?? readAssistantToolCall(ame);
								const toolName = parsed?.name ?? (typeof call.name === "string" && call.name ? call.name : "tool");
								const toolCallId = parsed?.id
									?? (typeof call.id === "string" && call.id ? call.id : undefined);
								const args = parsed?.arguments ?? ((call.arguments ?? {}) as Record<string, unknown>);
								if (toolCallId) toolCallIdsByContentIndex.set(contentIndex, toolCallId);
								beginActiveTool({
									...(toolCallId ? { toolCallId } : {}),
									name: toolName,
									startedAt: Date.now(),
									summary: boundActivitySummary(toolName, summarizeToolArgsForUI(toolName, args)),
								});
								if (toolName === ASK_BOSS_TOOL_NAME && questionDir) {
									scheduleBossQuestionScan(pipiuiAgentId, runId, questionDir);
								} else {
									// Same events the child's own tool_call hook counts; the two tallies agree.
									parentToolCalls += 1;
								}
								if (toolName !== "write" && toolName !== "edit") {
									upsertStreamPart(contentIndex, "tool", "", toolName, summarizeToolArgsForUI(toolName, args));
									if (toolCallId) {
										const streamedPart = streamParts.get(contentIndex);
										if (streamedPart) streamedPart.toolCallId = toolCallId;
									}
									forceFlushStreamParts();
								}
								pipiuiUpdate();
							}
							return;
						}
						// Legacy cumulative snapshot message_update (pre-0.84 / jcode-style).
						const snap = event.message;
						if (snap?.role === "assistant" && Array.isArray(snap.content)) {
							providerWait.noteAssistantActivity();
							for (let idx = 0; idx < snap.content.length; idx++) {
								const part = snap.content[idx];
								if (part?.type === "text" && typeof part.text === "string") {
									upsertStreamPart(idx, "text", "", undefined, part.text);
								} else if (part?.type === "thinking" && typeof part.thinking === "string") {
									upsertStreamPart(idx, "thinking", "", undefined, part.thinking);
								}
							}
						}
						return;
					}

					if (event.type === "message_end" && event.message) {
						const msg = event.message as Message;
						currentResult.messages.push(msg);

							if (msg.role === "assistant") {
								providerWait.noteAssistantActivity();
								// Drain any pending live preview before authoritative tool rows.
								forceFlushStreamParts();
								const didStreamTextOrThinking = [...streamParts.values()].some(
									(p) =>
										(p.itemType === "text" || p.itemType === "thinking") &&
										p.text.trim().length > 0,
								);
								currentResult.usage.turns++;
								const usage = msg.usage;
								if (usage) {
									currentResult.usage.input += usage.input || 0;
									currentResult.usage.output += usage.output || 0;
									currentResult.usage.cacheRead += usage.cacheRead || 0;
									currentResult.usage.cacheWrite += usage.cacheWrite || 0;
									currentResult.usage.cost += usage.cost?.total || 0;
									currentResult.usage.contextTokens = usage.totalTokens || 0;
									// Authoritative session-total close-out. Replaces any live
									// message_update preview so the panel never snaps backwards.
									const toolSet = new Set<string>();
									for (const part of (msg as any).content ?? []) {
										const call = readAssistantToolCall(part);
										if (call?.name) toolSet.add(call.name);
									}
									const tools = [...toolSet].sort();
									emitUsageSnapshot({
										input: currentResult.usage.input,
										output: currentResult.usage.output,
										cacheRead: currentResult.usage.cacheRead,
										cacheWrite: currentResult.usage.cacheWrite,
										cost: currentResult.usage.cost,
										contextTokens: currentResult.usage.contextTokens,
									}, {
										force: true,
										turn: currentResult.usage.turns,
										model: msg.model || currentResult.model || null,
										tools,
									});
								}
							if (!currentResult.model && msg.model) currentResult.model = msg.model;
							if (msg.stopReason) currentResult.stopReason = msg.stopReason;
							if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
							// 完整工作流水上报：每轮的思考/文本/工具调用都进 UI 日志。
							// 若本回合已通过 log_delta 流式预览过 text/thinking，则不再整块追加，
							// 避免面板重复；tool 仍以 message_end 为权威落盘。
								const pipiuiItems: Record<string, unknown>[] = [];
								const toolCallIds: string[] = [];
								const toolNames: string[] = [];
								const semanticToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
								for (const [partIndex, part] of ((msg as any).content ?? []).entries()) {
									const parsedCall = readAssistantToolCall(part);
									if (parsedCall) {
									if (parsedCall.id) toolCallIds.push(parsedCall.id);
										if (parsedCall.name) toolNames.push(parsedCall.name);
										const args = parsedCall.arguments;
										semanticToolCalls.push({ id: parsedCall.id ?? "", name: parsedCall.name, arguments: args });
									const summary = summarizeToolArgsForUI(parsedCall.name, args);
									const toolName = parsedCall.name;
									const live = currentActiveTool();
									beginActiveTool({
										...(parsedCall.id ? { toolCallId: parsedCall.id } : {}),
										name: toolName,
										startedAt: live?.name === toolName ? live.startedAt : Date.now(),
										summary: boundActivitySummary(toolName, summary),
									});
									const compact = compactFileChangeFromArgs(toolName, args);
									if (compact) {
										let extra: Record<string, unknown> | undefined;
										if (toolName === "edit") {
											try {
												const bounded = JSON.parse(boundedEditPayloadForUI(args)) as Record<string, unknown>;
												if (Array.isArray(bounded.edits)) extra = { edits: bounded.edits };
											} catch { /* keep counts-only */ }
										}
										const compactText = stringifyCompactFileChange(compact, extra);
										const matchIndex = [...fileChangeBuffers.entries()].find(([_, buf]) => buf.name === toolName)?.[0];
										const contentIndex = matchIndex;
										if (typeof contentIndex === "number") {
											pipiuiReport({
												kind: "log_delta",
												agentId: pipiuiAgentId,
												runId,
												contentIndex,
												itemType: "tool",
												text: compactText,
												name: toolName,
												...(parsedCall.id ? { toolCallId: parsedCall.id } : {}),
											});
											fileChangeBuffers.delete(contentIndex);
											continue;
										}
										pipiuiItems.push({ itemType: "tool", name: toolName, text: compactText, ...(parsedCall.id ? { toolCallId: parsedCall.id } : {}) });
										continue;
									}
									if (streamParts.get(partIndex)?.itemType === "tool") continue;
									// Edit keeps a bounded, valid JSON payload so the native subagent log can
									// render the same line diff as the main-agent transcript. Other tools
									// retain their compact human-readable summary.
									const text = toolName === "edit" ? boundedEditPayloadForUI(args) : summary;
									pipiuiItems.push({ itemType: "tool", name: toolName, text, ...(parsedCall.id ? { toolCallId: parsedCall.id } : {}) });
								} else if (part?.type === "text" && String(part.text ?? "").trim()) {
									if (didStreamTextOrThinking) continue;
									pipiuiItems.push({ itemType: "text", text: String(part.text).slice(0, 4000) });
								} else if (part?.type === "thinking" && String(part.thinking ?? "").trim()) {
									if (didStreamTextOrThinking) continue;
									const thinking = String(part.thinking);
									pipiuiItems.push({ itemType: "thinking", text: thinking.slice(0, 600), charCount: thinking.length });
									}
								}
								if (semanticGuardActive && !semanticNoProgress) {
									const decision = advanceSemanticProgress(semanticProgress, {
										type: "assistant-turn",
										toolCalls: semanticToolCalls,
									});
									semanticProgress = decision.state;
									if (decision.terminate) abortForSemanticNoProgress();
								}
								providerWait.noteToolBatch(toolCallIds);
						runtimePendingTools = toolNames;
						// Tool calls without ids cannot be matched against their results, so the
						// wait can never re-enter running-tool. Say so instead of letting the run
						// look healthy while only the deadline is holding it up.
						if (toolNames.length > 0 && toolCallIds.length === 0) {
							pipiuiReport({
								kind: "log",
								agentId: pipiuiAgentId,
								runId,
								items: [{
									itemType: "text",
									text: `[pipiui] provider emitted ${toolNames.length} tool call(s) with no id: ${toolNames.join(", ")}`,
								}],
							});
						}
						// This message asked for tools, so the stdout silence that follows is the
						// tools running, not a wedge. Claimed here rather than on stopReason so a
						// provider that omits `toolUse` still gets the same explained window.
						if (toolNames.length > 0) noteAgentToolWait(pipiuiAgentId, runId, toolNames);
						else {
							projectFinalizationPhase(pipiuiAgentId, runId, "final-received");
							// A resident RPC parent may emit its first assistant final while
							// accepted descendants still run. Its extension calls ctx.shutdown()
							// only after their completion follow-up has been consumed, so the
							// print-mode final-exit grace must not kill it in between.
							if (!useNestedRpc) {
								childExitCloseout.arm();
								childExitProbe.markFinal();
							}
						}
							// Always emit log when we streamed text/thinking so Swift resets
							// contentIndex→row slots even if tools array is empty (otherwise the
							// next turn would overwrite the previous message's live rows).
							if (pipiuiItems.length > 0 || didStreamTextOrThinking) {
								pipiuiReport({ kind: "log", agentId: pipiuiAgentId, runId, items: pipiuiItems });
							}
							// Next assistant turn starts fresh contentIndex mapping on the Swift side
							// after kind:"log"; clear local assembly state here.
							streamParts.clear();
							streamDirty.clear();
							fileChangeBuffers.clear();
							toolCallIdsByContentIndex.clear();
							usageEmitter.resetEstimate();
						}
						emitUpdate();
						pipiuiUpdate();
					}

					applyToolResultEvent(event, currentResult, {
						noteAgentToolEnd: () => noteAgentToolEnd(pipiuiAgentId, runId),
							noteToolResult: (toolCallId) => providerWait.noteToolResult(toolCallId),
							finishActiveTool,
							onResult: observeSemanticToolResult,
							reportLog: (items) => pipiuiReport({ kind: "log", agentId: pipiuiAgentId, runId, items }),
						onProjected: () => {
							emitUpdate();
							pipiuiUpdate();
						},
					});
				};

					const stdoutScanner = new JSONLChunkScanner(processLine);
					proc.stdout.on("data", (data) => {
						const live = handleForRun(pipiuiAgentId, runId);
						if (live) noteDiagnosticsIo(live.diagnostics, "stdout", ioByteLength(data), Date.now());
						noteAgentActivity(pipiuiAgentId, runId);
						options?.onActivity?.();
						stdoutScanner.push(data);
				});

				proc.stderr.on("data", (data) => {
					const live = handleForRun(pipiuiAgentId, runId);
						if (live) noteDiagnosticsIo(live.diagnostics, "stderr", ioByteLength(data), Date.now());
					noteAgentActivity(pipiuiAgentId, runId);
					currentResult.stderr += data.toString();
				});

				if (useNestedRpc) {
					const stdin = proc.stdin;
					if (!stdin) {
						currentResult.errorMessage = "nested RPC worker has no writable stdin";
						terminateAttempt();
					} else {
						const initialPrompt = JSON.stringify({
							id: initialRpcPromptId,
							type: "prompt",
							message: `Task: ${task}`,
						}) + "\n";
						stdin.write(initialPrompt, (err) => {
							if (!err) return;
							currentResult.errorMessage = `nested RPC initial prompt failed: ${err.message}`;
							terminateAttempt();
						});
					}
				}

				proc.on("close", (code) => {
						residentRpcShutdownWaker?.dispose();
						procExited = true;
						clearChildExitTimers();
						providerWait.dispose();
						stdoutScanner.end();
					childExitCloseout.settled("ok");
					// The process is known closed. Keep the background handle alive as finalizing
					// while verify/end reporting runs; only an unreported dead live child is vanished.
					markAgentFinalizing(pipiuiAgentId, runId, `child-close:${code ?? 0}`);
					resolve(childExitCloseout.accepted() ? 0 : (code ?? 0));
				});

				proc.on("error", () => {
					residentRpcShutdownWaker?.dispose();
					procExited = true;
					clearChildExitTimers();
					providerWait.dispose();
					// Original semantics, restored: the error path terminates the attempt
					// IMMEDIATELY — never waiting for close or any fallback timer. The
					// probe's fine error mark is already on disk (its listener registered
					// first); after this terminal the probe is SEALED so any late
					// close/stdio/disconnect/sample is silently dropped and terminal-last
					// holds without deferring business completion.
					childExitCloseout.settled("error");
					markAgentFinalizing(pipiuiAgentId, runId, "child-error");
					resolve(childExitCloseout.accepted() ? 0 : 1);
					childExitProbe.seal();
				});

				const effectiveSignal = signal ? AbortSignal.any([signal, dispatchAbort.signal]) : dispatchAbort.signal;
				if (effectiveSignal) {
					const killProc = () => {
						wasAborted = true;
						providerWait.dispose();
						childExitCloseout.cancel();
						terminateAttempt();
					};
					if (effectiveSignal.aborted) killProc();
					else {
						effectiveSignal.addEventListener("abort", killProc, { once: true });
						detachChildAbort = () => effectiveSignal.removeEventListener("abort", killProc);
					}
				}
			});

				currentResult.exitCode = exitCode;
				if (semanticGuardActive && !semanticNoProgress) {
					const decision = advanceSemanticProgress(semanticProgress, { type: "settle" });
					semanticProgress = decision.state;
					if (decision.terminate) abortForSemanticNoProgress();
				}

				// Decide whether to auto-resume before verify/end (those run once, after the loop).
			if (wasAborted) break;
			const runFailed = exitCode !== 0 || Boolean(currentResult.errorMessage);
			if (!runFailed || rpcInitialPromptRejected) break;
			const providerRecovery = decideProviderStallRecovery({
				timedOut: providerStallTimedOut,
				wasAborted,
				resumeCount: providerStallResumeCount,
			});
			if (providerRecovery === "terminal-failed") break;
			if (providerRecovery === "resume") {
				providerStallResumeCount++;
				currentResult.stopReason = undefined;
				currentResult.errorMessage = undefined;
				// A provider that just went silent tends to stay silent, so a stall resume
				// advances the chain when one exists rather than re-dialling the same model.
				const stallChainEntry = chainAdvanceEntryFor(modelPin, agentName, modelChainIndex + 1);
				const stallProgress = `provider stall auto-resume ${providerStallResumeCount}/${PROVIDER_WAIT_AUTO_RESUME_MAX}`;
				if (stallChainEntry) {
					const stalledModel = resolveAgentModelChainEntry(agentName, modelChainIndex)?.model ?? "?";
					modelChainIndex++;
					const stallThinking = resolveFallbackThinking(stallChainEntry, taskThinking);
					rewriteSpawnModelArgs(args, stallChainEntry.model, stallThinking);
					currentResult.model = stallThinking
						? stripModelThinkingSuffix(stallChainEntry.model)
						: stallChainEntry.model;
					jobPatchModel(pipiuiAgentId, runId, currentResult.model);
					autoResumeCount = 0; // the new model gets its own same-model resume budget
					const stallNote = `model fallback: ${stalledModel} -> ${stallChainEntry.model} (provider stall)`;
					modelFallbackNotes.push(`\n[pipiui] ${stallNote}`);
					pipiuiActivity = `${stallProgress} 换模：${stallNote}`;
					pipiuiReport({
						kind: "log",
						agentId: pipiuiAgentId,
						runId,
						items: [{ itemType: "text", text: `[pipiui] ${stallNote}` }],
					});
				} else {
					pipiuiActivity = stallProgress;
				}
				resumeAgentHandle(pipiuiAgentId, runId);
				pipiuiUpdate(true);
				const waitSignal = signal ? AbortSignal.any([signal, dispatchAbort.signal]) : dispatchAbort.signal;
				const abortedDuringBackoff = await new Promise<boolean>((resolve) => {
					if (waitSignal?.aborted) return resolve(true);
					const timer = setTimeout(() => {
						waitSignal?.removeEventListener("abort", onAbort);
						resolve(false);
					}, jitteredRetryBackoffMs(AUTO_RESUME_BACKOFF_MS[0]));
					timer.unref?.();
					const onAbort = () => {
						clearTimeout(timer);
						resolve(true);
					};
					waitSignal?.addEventListener("abort", onAbort, { once: true });
				});
				if (abortedDuringBackoff || waitSignal?.aborted) {
					wasAborted = true;
					break;
				}
				continue;
			}
			const attemptMessages = currentResult.messages.slice(attemptMessagesFrom);
			const attemptStderr = currentResult.stderr.slice(attemptStderrFrom);
			const classifyText = [
				currentResult.errorMessage ?? "",
				currentResult.stopReason ?? "",
				attemptStderr,
				getFinalOutput(attemptMessages).slice(-2000),
			].join("\n");
			// Fallback chain classification:
			// a) quota family (isQuotaLikeWorkerError) → never consumes the same-model resume
			//    budget; switch to the next chain model immediately when one exists;
			// b) transient family (isRetryableWorkerError) → same-model auto-resume first
			//    (AUTO_RESUME_MAX budget); once exhausted, switch model if the chain has a
			//    next entry (the new model resets its own resume budget);
			// c) any other non-retryable (auth 401/403, unknown agent, …) → never switch;
			//    fall through to the existing failed path.
			const nextChainEntry = chainAdvanceEntryFor(modelPin, agentName, modelChainIndex + 1);
			let fallbackReason: string | undefined;
			if (isQuotaLikeWorkerError(currentResult.errorMessage ?? "")) {
				if (!nextChainEntry) break;
				fallbackReason = "quota";
			} else if (isRetryableWorkerError(classifyText)) {
				if (autoResumeCount >= AUTO_RESUME_MAX) {
					if (!nextChainEntry) break;
					fallbackReason = "retry budget exhausted";
				}
			} else {
				break;
			}

			const shortErr = (currentResult.errorMessage || currentResult.stderr || "retryable error")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 120);
			const baseBackoffMs = AUTO_RESUME_BACKOFF_MS[autoResumeCount] ?? 15_000;
			const backoffMs = jitteredRetryBackoffMs(baseBackoffMs);
			// Reset per-run failure flags; messages/usage/stderr keep accumulating across resumes.
			currentResult.stopReason = undefined;
			currentResult.errorMessage = undefined;
			if (fallbackReason && nextChainEntry) {
				// Model switch = same agentId / same session resume: --session-id untouched,
				// only --model / --thinking rewritten. Index only advances, so total switches
				// are naturally bounded by chain length - 1.
				const oldModel = resolveAgentModelChainEntry(agentName, modelChainIndex)?.model ?? "?";
				modelChainIndex++;
				const fallbackThinking = resolveFallbackThinking(nextChainEntry, taskThinking);
				rewriteSpawnModelArgs(args, nextChainEntry.model, fallbackThinking);
				currentResult.model = fallbackThinking
					? stripModelThinkingSuffix(nextChainEntry.model)
					: nextChainEntry.model;
				jobPatchModel(pipiuiAgentId, runId, currentResult.model);
				autoResumeCount = 0; // the new model gets its own same-model resume budget
				const fallbackNote = `model fallback: ${oldModel} -> ${nextChainEntry.model} (${fallbackReason})`;
				modelFallbackNotes.push(`\n[pipiui] ${fallbackNote}`);
				pipiuiActivity = `auto-resume 换模：${fallbackNote}；前次死于 ${shortErr}`;
				pipiuiReport({
					kind: "log",
					agentId: pipiuiAgentId,
					runId,
					items: [{ itemType: "text", text: `[pipiui] ${fallbackNote}` }],
				});
				pipiuiUpdate(true);
			} else {
				autoResumeCount++;
				pipiuiActivity = `auto-resume 第${autoResumeCount}次：前次死于 ${shortErr}`;
			}
			// A retry returns this same episode to live-running state; the just-closed pid is
			// intentionally cleared, but activity remains fresh throughout the short backoff.
			resumeAgentHandle(pipiuiAgentId, runId);
			// 压缩会话后再 resume：worker 进程已退出（无并发写窗口），满上下文会反复 fetch
			// failed，append 一条 pi 原生 compaction 条目让 buildContextEntries 丢弃旧上下文。
			// 只读角色（sessionDir undefined）无会话可压缩，跳过并走原 resume 路径（冷重跑）。
			if (sessionDir && (currentResult.usage?.contextTokens ?? 0) >= AUTO_COMPACT_BEFORE_RESUME_TOKENS) {
				const compacted = appendSessionCompaction(
					sessionDir,
					sessionId,
					task,
					currentResult.usage?.contextTokens ?? 0,
				);
				if (compacted) {
					pipiuiActivity += `；会话已压缩（${((currentResult.usage?.contextTokens ?? 0) / 1000) | 0}k tokens）`;
					pipiuiUpdate(true);
				}
			}
			pipiuiUpdate(true);

			// Backoff interruptible by parent or targeted worker abort.
			const waitSignal = signal ? AbortSignal.any([signal, dispatchAbort.signal]) : dispatchAbort.signal;
			const abortedDuringBackoff = await new Promise<boolean>((resolve) => {
				if (waitSignal?.aborted) {
					resolve(true);
					return;
				}
				const timer = setTimeout(() => {
					waitSignal?.removeEventListener("abort", onAbort);
					resolve(false);
				}, backoffMs);
				timer.unref?.();
				const onAbort = () => {
					clearTimeout(timer);
					resolve(true);
				};
				if (waitSignal) waitSignal.addEventListener("abort", onAbort, { once: true });
			});
			if (abortedDuringBackoff || waitSignal?.aborted) {
				wasAborted = true;
				break;
			}
		}
		// The absolute task timer spans retry attempts/backoff, then stops as soon as the
		// final child attempt has settled; verify/finalization are not child runtime.
		runtimeTimeout?.dispose();
		runtimeTimeout = undefined;

		// Child close/error has ended the live process. Keep its handle explicitly finalizing
		// through verify + end reporting so the 30s watchdog cannot manufacture interruption.
		markAgentFinalizing(pipiuiAgentId, runId);

		// Attested verify: runs AFTER the agent process exits and BEFORE the "end" report,
		// because Swift auto-merges and removes the worktree on "end". Skipped on abort
		// (user interrupted; don't block up to the configured verify timeout on a dead task).
		// A read-only role delivers a report, not a file: running a verify against it can
		// only ever fail, which used to burn the two-attempts budget on a re-dispatch that
		// was structurally incapable of passing. `verifyDropped` tells the boss why.
		const attestableVerify = agent.traits.readOnly ? undefined : options?.verify;
		if (agent.traits.readOnly && options?.verify && options.verify.trim()) {
			currentResult.verifyDropped = true;
		}
		if (attestableVerify && attestableVerify.trim() && !wasAborted) {
			projectFinalizationPhase(pipiuiAgentId, runId, "verifying");
			const verifyStartedAt = Date.now();
			const verifyRole = agent.traits.readOnly ? "read-only" : "writable";
			logCloseoutProbe("verify", {
				agent: pipiuiAgentId,
				run: runId,
				role: verifyRole,
				phase: "verifying",
				state: "enter",
				elapsedMs: 0,
			});
			currentResult.verify = await runVerifyCommand(attestableVerify.trim(), spawnCwd, {
				onSpawn(pid) {
					if (pid === undefined) return;
					const live = handleForRun(pipiuiAgentId, runId);
					if (!live) return;
					noteFinalizationDetails(live.diagnostics, { verifyPid: pid });
					live.diagnostics.eventSeq += 1;
					pipiuiReport({
						kind: "diagnostics",
						agentId: pipiuiAgentId,
						runId,
						diagnostics: diagnosticsSnapshotFor(pipiuiAgentId, live),
					});
				},
			});
			const verifyElapsedMs = Date.now() - verifyStartedAt;
			if (currentResult.verify.timedOut) {
				logCloseoutProbe("verify", {
					agent: pipiuiAgentId,
					run: runId,
					role: verifyRole,
					phase: "verifying",
					state: "timeout",
					elapsedMs: verifyElapsedMs,
					error: "verify-timeout",
				});
				projectFinalizationPhase(pipiuiAgentId, runId, "verifying", { error: "verify-timeout" });
			} else if (currentResult.verify.exitCode !== 0 && currentResult.verify.exitCode !== null) {
				logCloseoutProbe("verify", {
					agent: pipiuiAgentId,
					run: runId,
					role: verifyRole,
					phase: "verifying",
					state: "error",
					elapsedMs: verifyElapsedMs,
					error: "verify-failed",
				});
				projectFinalizationPhase(pipiuiAgentId, runId, "verifying", { error: "verify-failed" });
			} else {
				logCloseoutProbe("verify", {
					agent: pipiuiAgentId,
					run: runId,
					role: verifyRole,
					phase: "verifying",
					state: "ok",
					elapsedMs: verifyElapsedMs,
				});
			}
		} else if (attestableVerify && attestableVerify.trim()) {
			// Aborted: verify was in the brief but intentionally not run — record that
			// so the done message can say "skipped" instead of "no verify in brief".
			currentResult.verifySkipped = true;
		}
		const endOk = isHostEndOk(currentResult, { aborted: wasAborted });
		if (toolBudget) currentResult.toolBudget = summarizeToolBudget(toolBudget, parentToolCalls);
		if (usageBudgetState) currentResult.usageBudget = usageBudgetState;
		if (forkSanitizedSummary) currentResult.forkSanitized = forkSanitizedSummary;
		// Tally before the terminal cleanup removes the run's question directory.
		const bossQuestions = questionDir ? summarizeQuestionRun(questionDir) : undefined;
		if (bossQuestions) currentResult.bossQuestions = bossQuestions;
		if (usageBudgetGraceTimer) {
			clearTimeout(usageBudgetGraceTimer);
			usageBudgetGraceTimer = undefined;
		}
		// Failure classification + optional evidence-derived checkpoint (fresh-episode routing).
		let recoveryClassification: RecoveryDecision | undefined;
		let recoveryCheckpointFile: string | undefined;
		if (wasAborted) currentResult.stopReason = currentResult.stopReason ?? "aborted";
		// Notes appended after slice so they survive the -8000 tail trim on long outputs.
		let endOutput = (getFinalOutput(currentResult.messages) || currentResult.stderr || "").slice(-8000);
		let endResultText =
			getResultOutput(currentResult) || currentResult.stderr || getFinalOutput(currentResult.messages) || "(no output)";
			if ((runtimeTimedOut || semanticNoProgress) && currentResult.errorMessage) {
			const timeoutNote = `\n[pipiui] ${currentResult.errorMessage}`;
			if (!endOutput.includes(currentResult.errorMessage)) endOutput += timeoutNote;
			if (!endResultText.includes(currentResult.errorMessage)) endResultText += timeoutNote;
		}
		if (modelFallbackNotes.length > 0) {
			const note = modelFallbackNotes.join("");
			endOutput += note;
			endResultText += note;
		}
		if (endOk && autoResumeCount > 0) {
			const note = `\n[pipiui] auto-resumed ${autoResumeCount}× after retryable errors.`;
			endOutput += note;
			endResultText += note;
		} else if (!endOk && !wasAborted) {
			// Structured recovery classification (see recovery-classification.ts): an ordinary
			// implementation/test failure keeps same-agent continuity — INCLUDING at huge context;
			// size alone never mints a fresh episode. A provider-stall or saturated-context death
			// becomes checkpoint-fresh-episode ONLY with poisoned-broad-recon evidence: dispatched
			// recon/review role or a read/search-dominated mutation-free trajectory observed in the
			// tool-call record (the four-episode reviewer case). Insufficient evidence fails safe
			// to continuity and persists no checkpoint.
			recoveryClassification = classifyWorkerRecovery(
				{
					wasAborted,
					stopReason: currentResult.stopReason,
					errorText: [currentResult.errorMessage ?? "", currentResult.stderr.slice(-2000)].join("\n"),
					verifyFailure:
						!!currentResult.verify &&
						!(currentResult.verify.exitCode === 0 && !currentResult.verify.timedOut),
					contextTokens: currentResult.usage.contextTokens || 0,
					sameModelResumeCount: autoResumeCount,
					role: agentName,
					readOnly: Boolean(agent.traits.readOnly),
					footprint: extractReconFootprint(currentResult.messages),
				},
				{ contextHintTokens: AUTO_RESUME_CONTEXT_HINT_TOKENS },
			);
			if (recoveryClassification.route === "checkpoint-fresh-episode") {
				const checkpoint = writeRecoveryCheckpoint({
					mainCwd: PIPIUI_MAIN_CWD,
					agentId: pipiuiAgentId,
					runId,
					title: options?.title,
					task,
					decision: recoveryClassification,
					messages: currentResult.messages,
					worktreePath: placement.worktreePath,
					worktreeBranch: placement.worktreeBranch,
				});
				// A checkpoint is evidence-derived; none existing means none is written and the
				// route line alone still tells the Boss not to replay this conversation.
				if (checkpoint.ok && checkpoint.file) recoveryCheckpointFile = checkpoint.file;
			}
			let note = `\n${formatRecoveryReport({ agentId: pipiuiAgentId, runId, decision: recoveryClassification, checkpointFile: recoveryCheckpointFile })}`;
			if (recoveryClassification.kind === "context-overflow") {
				const n = Math.round((currentResult.usage.contextTokens || 0) / 1000);
				note += recoveryClassification.route === "checkpoint-fresh-episode"
					? `\n[pipiui] 侦查轨迹毒化证据成立（~${n}k tokens）：按上方报告走新的语义 episode。`
					: `\n[pipiui] 终态时上下文已达 ~${n}k tokens，但无侦查毒化证据：继续同一 agentId 切片，缩小任务范围并要求小窗口读取。`;
			}
			endOutput += note;
			endResultText += note;
			// Append only — never replace an existing terminal errorMessage.
			if (currentResult.errorMessage) currentResult.errorMessage += note;
		}
		// Terminal job state before bridge end/notify so a watchdog-only interruption is corrected
		// even while the bridge report is awaiting its bounded network timeout.
			const externallyAborted = wasAborted && !runtimeTimedOut && !semanticNoProgress;
		const endState: JobState = externallyAborted ? "aborted" : endOk ? "ok" : "failed";
		const closeoutRole = agent.traits.readOnly ? "read-only" : "writable";
		const persistStartedAt = Date.now();
		logCloseoutProbe("job-finalize", {
			agent: pipiuiAgentId,
			run: runId,
			role: closeoutRole,
			phase: "job-finalize",
			state: "enter",
			elapsedMs: 0,
		});
		let terminalFinalized = false;
		try {
			terminalFinalized = jobFinalize(pipiuiAgentId, runId, {
				name: agentName,
				task,
				state: endState,
				resultText: endResultText,
				cost: currentResult.usage.cost,
				turns: currentResult.usage.turns,
				activity: pipiuiActivity,
				verify: currentResult.verify,
				...(recoveryClassification ? { recovery: recoveryClassification } : {}),
				...(recoveryCheckpointFile ? { recoveryCheckpoint: recoveryCheckpointFile } : {}),
				...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
				...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
				...(placement.worktreePath && placement.worktreeBranch
					? { integrationState: "active" as const }
					: {}),
			});
			logCloseoutProbe("job-finalize", {
				agent: pipiuiAgentId,
				run: runId,
				role: closeoutRole,
				phase: "job-finalize",
				state: "ok",
				elapsedMs: Date.now() - persistStartedAt,
			});
		} catch {
			logCloseoutProbe("job-finalize", {
				agent: pipiuiAgentId,
				run: runId,
				role: closeoutRole,
				phase: "job-finalize",
				state: "error",
				elapsedMs: Date.now() - persistStartedAt,
				error: "job-finalize-error",
			});
			noteCloseoutLastPhaseError(pipiuiAgentId, runId, "job-finalize", "error");
			try {
				const existing = jobRegistry.get(pipiuiAgentId);
				if (existing?.runId === runId && existing.state !== "running") {
					dispatchQueue.onAgentTerminal(pipiuiAgentId);
				}
			} catch {
				/* best-effort idempotent release only */
			}
		}
		// Merge/cleanup runs before the terminal report so the report describes a settled tree:
		// a host that handed finalization to pi must not see "ok" while the branch is still
		// unmerged. A host that kept finalization gets undefined here and is unaffected.
		// Scope-drift attestation (worker closeout, layer 2 of plan adherence): compare the
		// worker branch's changed files against the declared scope BEFORE finalization — the
		// merge may delete the branch, and this is the same merge-base diff the finalizer's
		// inspection carries. Read-only roles and dispatches with no declared scope are
		// skipped: there is nothing to drift from. An unmeasurable diff stays undefined and
		// surfaces as NO attestation line, never as "none".
		if (!agent.traits.readOnly && placement.worktreePath && placement.worktreeBranch) {
			const declaredScope = cleanScope(options?.scope);
			if (declaredScope.length > 0) {
				const drift = computeScopeDrift(PIPIUI_MAIN_CWD, placement.worktreeBranch, declaredScope);
				if (drift) currentResult.scopeDrift = drift;
			}
		}
		let finalization: string | undefined;
		let worktreeLifecycle: WorktreeLifecycleProjectionV1 | undefined;
		const worktreeStartedAt = Date.now();
		const worktreeProber = createWorktreePhaseProber((event, fields) => {
			const error = closeoutPhaseError(event, fields.state);
			logCloseoutProbe(event, {
				agent: pipiuiAgentId,
				run: runId,
				role: closeoutRole,
				...fields,
				...(error ? { error } : {}),
			});
			if (error) noteCloseoutLastPhaseError(pipiuiAgentId, runId, event, fields.state);
		});
		logCloseoutProbe("worktree-finalize", {
			agent: pipiuiAgentId,
			run: runId,
			role: closeoutRole,
			phase: "worktree-finalize",
			state: "enter",
			elapsedMs: 0,
		});
		try {
			const state = await finalizeWorktreeIfOwned({
				agentId: pipiuiAgentId,
				runId,
				mainCwd: PIPIUI_MAIN_CWD,
				worktreePath: placement.worktreePath,
				worktreeBranch: placement.worktreeBranch,
				role: agentName === "secretary" ? "secretary" : "worker",
					terminalState: terminalStateForFinalization({ ok: endOk, aborted: externallyAborted }),
				onProgress(phase, detail) {
					projectFinalizationPhase(pipiuiAgentId, runId, phase);
					worktreeProber.note(phase, detail);
				},
				...(currentResult.verify
					? {
							verify: {
								command: currentResult.verify.command,
								exitCode: currentResult.verify.timedOut
									? -1
									: (currentResult.verify.exitCode ?? -1),
							},
						}
					: {}),
			});
			if (state) {
				finalization = summarizeFinalization(state);
				worktreeLifecycle = lifecycleForFinalization(state);
				// A non-empty state means pi is the finalizer, so pi also owns the closeout row.
				// The Swift app writes its own from its own lifecycle; only one of them ever runs.
				recordCloseoutDisposition({
					mainCwd: PIPIUI_MAIN_CWD,
					sessionKey: PIPIUI_SESSION,
					agentId: pipiuiAgentId,
					disposition: closeoutDispositionFor(state),
					reason: state.result.recovery.reason || finalization,
				});
				// Swift SubagentStore parity, host-free: every terminal finalization feeds the
				// runtime-owned recovery loop (fixer resume up to 3x, then Boss escalation).
					if (!semanticNoProgress) {
						applyWorktreeRecovery(state, {
							agentId: pipiuiAgentId,
							name: agentName,
							branch: placement.worktreeBranch,
							worktreePath: placement.worktreePath,
							verifyCommand: currentResult.verify?.command,
						});
					}
			}
			worktreeProber.finish("ok");
			logCloseoutProbe("worktree-finalize", {
				agent: pipiuiAgentId,
				run: runId,
				role: closeoutRole,
				phase: "worktree-finalize",
				state: "ok",
				elapsedMs: Date.now() - worktreeStartedAt,
			});
		} catch (error) {
			// The service retains unsafe work rather than forcing it; a thrown error here means
			// finalization did not run at all, which must be visible but must not lose the run.
			finalization = `finalization error: ${error instanceof Error ? error.message : String(error)}`;
			worktreeProber.finish("error");
			logCloseoutProbe("worktree-finalize", {
				agent: pipiuiAgentId,
				run: runId,
				role: closeoutRole,
				phase: "worktree-finalize",
				state: "error",
				elapsedMs: Date.now() - worktreeStartedAt,
				error: "worktree-finalize-error",
			});
			projectFinalizationPhase(pipiuiAgentId, runId, handleForRun(pipiuiAgentId, runId)?.diagnostics.finalizationPhase ?? "reconciling", {
				error: "finalization-error",
			});
		}
		try {
			const sessionMerge = await maybeMergeBoundSessionAfterSecretary({
				isCloseoutSecretary: Boolean(agent && agent.origin === "bundled" && agentName === "secretary"),
				terminalOk: endOk,
				escalate: escalateWorktreeFailureToBoss,
			});
			if (sessionMerge) {
				const summary = `session-merge ${summarizeFinalization(sessionMerge)}`;
				finalization = finalization ? `${finalization}; ${summary}` : summary;
			}
		} catch {
			/* session merge must not lose the secretary terminal report */
		}
		if (placement.worktreePath && placement.worktreeBranch) {
			const integrationState: SubagentIntegrationState = worktreeLifecycle ?? "pendingReview";
			currentResult.integrationState = integrationState;
			currentResult.worktreePath = placement.worktreePath;
			currentResult.worktreeBranch = placement.worktreeBranch;
			if (finalization) currentResult.worktreeFinalization = finalization;
			jobPatchIntegration(pipiuiAgentId, runId, {
				integrationState,
				...(finalization ? { worktreeFinalization: finalization } : {}),
			});
		}
		const endHandle = handleForRun(pipiuiAgentId, runId);
		clearActiveTools();
		forgetBossQuestions(pipiuiAgentId, runId, questionDir);
		if (endHandle) projectFinalizationPhase(pipiuiAgentId, runId, "done-await-host");
		await postTerminalPipiuiReport(attachDiagnostics({
			kind: "end",
			agentId: pipiuiAgentId,
			runId,
			ok: endOk,
			aborted: externallyAborted,
			activity: null,
			activityActive: false,
			activityEndedAt: Date.now(),
			output: endOutput,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
			contextTokens: currentResult.usage.contextTokens,
			stopReason: currentResult.stopReason ?? null,
			...(finalization ? { worktreeFinalization: finalization } : {}),
			...(worktreeLifecycle ? { worktreeLifecycle } : {}),
			...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
			...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
			...(placement.worktreeError ? { worktreeError: placement.worktreeError } : {}),
			...(currentResult.verify
				? {
						verifyCommand: currentResult.verify.command,
						verifyExit: currentResult.verify.timedOut ? -1 : (currentResult.verify.exitCode ?? -1),
					}
				: {}),
		}, endHandle));
		if (externallyAborted) throw Object.assign(new Error("Subagent was aborted"), {
			agentId: pipiuiAgentId,
			runId,
			exitCode: currentResult.exitCode,
			stopReason: currentResult.stopReason,
			errorMessage: currentResult.errorMessage,
			hadMessages: currentResult.messages.length > 0,
		});
		return currentResult;
	} finally {
		runtimeTimeout?.dispose();
		deleteRunningAgentHandle(pipiuiAgentId, runId);
		if (sessionDir) pruneAgentSessions(sessionDir, "completed");
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
					/* ignore */
				}
	}
	} finally {
		const leaseRole = agent.traits.readOnly ? "read-only" : "writable";
		await awaitTerminalPipiuiReports(pipiuiAgentId, { run: runId, role: leaseRole });
		const leaseStartedAt = Date.now();
		logCloseoutProbe("lease-release", {
			agent: pipiuiAgentId,
			run: runId,
			role: leaseRole,
			phase: "lease-release",
			state: "enter",
			elapsedMs: 0,
		});
		try {
			releaseAgentLease(agentLease);
			logCloseoutProbe("lease-release", {
				agent: pipiuiAgentId,
				run: runId,
				role: leaseRole,
				phase: "lease-release",
				state: "ok",
				elapsedMs: Date.now() - leaseStartedAt,
			});
		} catch {
			logCloseoutProbe("lease-release", {
				agent: pipiuiAgentId,
				run: runId,
				role: leaseRole,
				phase: "lease-release",
				state: "error",
				elapsedMs: Date.now() - leaseStartedAt,
				error: "lease-release-error",
			});
		}
		// Terminal state is already recorded; this release is what makes the queue actually
		// re-evaluate dependents of this id (jobFinalize pumped while the reservation still
		// answered running-like).
		releaseAgentReservation(pipiuiAgentId);
	}
}

const VERIFY_PARAM_DESCRIPTION =
	"Shell command run by the runtime in the agent's cwd after the agent process ends, before worktree merge/removal; exit code and tail output are attested into the done message. Boss must fill this for implementation tasks. Omit it for read-only agents — they deliver a report, not files, and the runtime drops any verify they are given.";

const AGENT_ID_DESCRIPTION =
	"Short semantic name you choose for this worker, e.g. \"quota-pill\": 2-24 chars of lowercase letters, digits, \"-\" or \"_\", starting with a letter or digit. Required on every dispatch — no id is generated for you. Re-dispatching the same agentId continues that worker with its previous conversation, worktree and branch pipiui/<agentId>: use one agentId per vertical slice (implement, verify, debug, fix, re-verify), and pass fresh:true only to start the same id cold. Also the target id for action=\"abort\" or action=\"resolve\".";
const FRESH_DESCRIPTION =
	"Discard this agentId's stored conversation and start it cold. Use when its context went wrong, not routinely.";
const FORK_DESCRIPTION =
	"Start this worker from a copy of THIS session's conversation instead of cold, so it already knows what you know and the prompt can be a directive rather than a briefing. A fork runs your own model. Use it when restating the background would take more than a paragraph, or when the worker must judge what the user actually wants. Do NOT use it for reviewer/explore/plan (their value is the cold start, and it is refused), nor when you can already write a complete brief — a cold worker with precise file:line anchors is cheaper and no less correct.";
const MODEL_PARAM_DESCRIPTION =
	'Optional exact model for THIS dispatch only, as a stable `provider/modelId` string (e.g. "openai/gpt-5", never a bare model id). It must exactly match one entry of the Available models list in your system prompt — unavailable or user-hidden models are rejected with an error, never silently replaced by a default. Omit it to follow the normal resolution (user role settings → current session/main model → agent frontmatter). A pin is never persisted and does not affect any later dispatch.';
const BLOCKED_BY_DESCRIPTION =
	'Optional dependency tags (task/agentId short names this task depends on), e.g. ["tldr-done-report"]. The runtime queue holds this task until every named agent succeeds; a failed or never-dispatched dependency holds the item and reports [subagent-blocked] instead of starting it.';
const SCOPE_DESCRIPTION =
	'Optional advisory path prefixes this worker expects to touch, e.g. ["Electron/packages/ui/src/session/", "Electron/packages/ui/src/session/store.ts"]. A trailing slash means that directory and everything under it. Concurrent dispatches whose scopes overlap get a [subagent-overlap] warning but still start. Omit when the task is read-only or has no predicted write set.';
const PLAN_TASK_DESCRIPTION =
	'Optional planTask: the semantic slug id of one task in the currently approved plan (.pi/plans) that this dispatch implements, so plan_check can tie the worker to the plan. When an approved plan still has open tasks, a dispatch that omits planTask or names an unknown task id gets an advisory [plan-drift] line on its receipt — it is never blocked. Legitimate out-of-plan work (failure recovery re-dispatches, secretary closeout, new user requests) may omit it.';
const PlanTaskParam = Type.Optional(Type.String({ maxLength: 120, description: PLAN_TASK_DESCRIPTION }));
const THINKING_PARAM_DESCRIPTION =
	"Optional per-task thinking for this dispatch only: off|minimal|low|medium|high|xhigh|max. It never inherits the Boss current thinking and does not select a model (pass `model` for that). It overrides the current candidate's configured thinking; if a fallback is needed, it carries only when the Swift capability catalog explicitly allows that fallback level, otherwise that fallback uses its configured thinking/default.";

/** Runtime shape check for blockedBy: array of strings, max 10, each ≤ 40 chars. */
function validateBlockedBy(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value)) {
		return `Invalid blockedBy on ${label}: must be an array of strings (got ${typeof value}).`;
	}
	if (value.length > 10) {
		return `Invalid blockedBy on ${label}: at most 10 entries (got ${value.length}).`;
	}
	for (let i = 0; i < value.length; i++) {
		const entry = value[i];
		if (typeof entry !== "string") {
			return `Invalid blockedBy on ${label}: entry [${i}] must be a string (got ${typeof entry}).`;
		}
		if (entry.length > 40) {
			return `Invalid blockedBy on ${label}: entry [${i}] must be ≤ 40 characters (got ${entry.length}).`;
		}
	}
	return null;
}

const BlockedByParam = Type.Optional(
	Type.Array(Type.String({ maxLength: 40 }), {
		description: BLOCKED_BY_DESCRIPTION,
		maxItems: 10,
	}),
);
const ScopeParam = Type.Optional(
	Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
		description: SCOPE_DESCRIPTION,
		maxItems: 32,
	}),
);
const ThinkingParam = Type.Optional(
	StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const, {
		description: THINKING_PARAM_DESCRIPTION,
	}),
);
const IsolationParam = Type.Optional(
	StringEnum(["worktree", "none"] as const, {
		description:
			'Writable general-purpose defaults to worktree (isolated tree, then merge). Read-only roles ignore this. "none" shares the assigned cwd.',
	}),
);
const HeartbeatSecsParam = Type.Optional(
	Type.Integer({ minimum: 30, maximum: 3600, description: "Bundled general-purpose only. Regular wall-clock check-in interval in seconds; omission preserves 10/+20/+30 minute defaults." }),
);
const TimeoutSecsParam = Type.Optional(
	Type.Integer({ minimum: 30, maximum: 604800, description: "Bundled general-purpose only. Absolute wall-clock hard timeout in seconds from actual child spawn." }),
);
const ProgressLogParam = Type.Optional(
	Type.String({
		description:
			'Bundled general-purpose only. Path of a live log this run appends to (e.g. `tee -a .pi/progress/<agentId>.log`). Relative to the worker cwd or absolute; after resolution it must stay inside the opened project, the spawn cwd, or this worker\'s worktree, else the dispatch fails. Watchdog counts file size/mtime changes as progress; appended bytes are forwarded to Boss every 60s (or heartbeatSecs).',
	}),
);

const ToolBudgetParam = Type.Optional(
	Type.Object({
		soft: Type.Optional(Type.Integer({ minimum: 1, description: "Tool-call count at which the worker is nudged once (steer) to finalize." })),
		hard: Type.Integer({ minimum: 1, description: "Tool-call count after which `block` tools are refused. The final answer is never blocked and the run does not end." }),
		block: Type.Optional(Type.Array(Type.String(), {
			minItems: 1,
			description: "Tools refused past hard; default read/grep/find/ls (browsing, not mutation). [\"*\"] refuses every tool.",
		})),
	}, {
		additionalProperties: false,
		description: "Per-dispatch tool-call budget enforced inside the worker. Fit for read-only recon and review; do not hard-cap a writer mid-edit.",
	}),
);
const UsageBudgetLimitParam = Type.Object({
	soft: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	hard: Type.Number({ exclusiveMinimum: 0 }),
}, { additionalProperties: false });
const UsageBudgetParam = Type.Optional(
	Type.Object({
		tokens: Type.Optional(UsageBudgetLimitParam),
		costUsd: Type.Optional(UsageBudgetLimitParam),
	}, {
		additionalProperties: false,
		description: "Per-dispatch reported-usage budget (input+output tokens, cost in USD). soft: one [subagent-budget] notice to you; hard: the worker is aborted (stopReason usage_budget) — read-only roles only; an abort is not a safe cut for a writer.",
	}),
);

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task; omit to fall back to task text",
		}),
	),
	blockedBy: BlockedByParam,
	scope: ScopeParam,
	planTask: PlanTaskParam,
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	thinking: ThinkingParam,
	model: Type.Optional(Type.String({ description: MODEL_PARAM_DESCRIPTION })),
	agentId: Type.String({ description: AGENT_ID_DESCRIPTION }),
	fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION })),
	fork: Type.Optional(Type.Boolean({ description: FORK_DESCRIPTION })),
	toolBudget: ToolBudgetParam,
	usageBudget: UsageBudgetParam,
}, { additionalProperties: false });

// Chain items speak the same Grok Build / Claude-family dispatch contract as the
// single `subagent` tool. Grok 4.6 cannot reliably emit a required long field
// named `task` on a subagent-dispatch tool (0/5 in the 2026-08-15 A/B probe: it
// filled every optional field and always skipped `task`; the prompt/description
// spelling arrived 6/6). Old names {agent, task, title, worktree} live only in
// the sanitizer and must never re-enter this property list.
const ChainItem = Type.Object({
	prompt: Type.String({
		minLength: 1,
		description: "The full task prompt for this step. May reference the prior step's output with the {previous} placeholder.",
	}),
	description: Type.String({
		minLength: 1,
		description: "Short description of the step (3-5 words).",
	}),
	subagent_type: Type.Optional(
		Type.String({
			description: "Subagent type. Defaults to general-purpose. Built-in: general-purpose, explore, plan, reviewer.",
		}),
	),
	agentId: Type.String({ description: AGENT_ID_DESCRIPTION }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	thinking: ThinkingParam,
	model: Type.Optional(Type.String({ description: MODEL_PARAM_DESCRIPTION })),
	isolation: IsolationParam,
	fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION })),
	heartbeatSecs: HeartbeatSecsParam,
	timeoutSecs: TimeoutSecsParam,
	progressLog: ProgressLogParam,
	toolBudget: ToolBudgetParam,
	usageBudget: UsageBudgetParam,
	scope: ScopeParam,
	planTask: PlanTaskParam,
}, { additionalProperties: false });

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SharedDispatchParams = {
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	background: Type.Optional(
		Type.Boolean({
			description:
				"If true, return immediately after starting agents; completion is delivered later as a follow-up message. Default: true for single and parallel dispatch at every permitted depth — Boss and nested workers alike; a multi-step chain runs synchronously so {previous} can be substituted. While the fan-out layer is active, every non-ordered dispatch is forced into the background regardless of this flag.",
		}),
	),
};

// Each public tool is one intent. The shared execute still accepts the internal
// union (single / chain / tasks / abort / resolve) so wrappers can delegate.
// The single schema speaks the same field set the execution layer actually reads for a
// single dispatch (title, fresh, verify, thinking, blockedBy, heartbeatSecs,
// timeoutSecs, agentScope): anything declared here survives the strict sanitizer, so a
// field the runner supports must not be silently dropped at the provider boundary.
const SubagentParams = Type.Object({
	// prompt/description/agentId are OPTIONAL at the schema level ONLY so the parallel
	// `tasks[]` mode fits this one strict schema — a legal wave carries per-item agentIds and
	// no root identity at all. Single-mode required-ness stays enforced at runtime: the
	// exactly-one-mode gate rejects empty/mixed calls with named errors, and the identity
	// gate rejects an id-less single dispatch before any worker spawns.
	prompt: Type.Optional(Type.String({
		minLength: 1,
		description: "The full task prompt for the subagent to execute. Required for a single dispatch; omit only when using tasks[].",
	})),
	description: Type.Optional(Type.String({
		minLength: 1,
		description: "Short description of the task (3-5 words). Required for a single dispatch; omit only when using tasks[].",
	})),
	subagent_type: Type.Optional(
		Type.String({
			description: "Subagent type. Defaults to general-purpose. Built-in: general-purpose, explore, plan, reviewer.",
			default: "general-purpose",
		}),
	),
	agentId: Type.Optional(Type.String({
		description: `${AGENT_ID_DESCRIPTION} Required for a single dispatch; a parallel tasks[] call omits this root field and gives each item its own agentId instead.`,
	})),
	run_in_background: Type.Optional(
		Type.Boolean({
			default: true,
			description: "If true, return immediately; completion arrives later. Default true at every permitted depth (single and parallel; a multi-step chain stays synchronous, and the fan-out layer forces background on non-ordered dispatches). Mirrors `background`.",
		}),
	),
	isolation: IsolationParam,
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process." })),
	resume_from: Type.Optional(
		Type.String({
			description: "Deprecated alias for agentId: resume a previous worker by passing its agentId. New dispatches pass agentId directly; nothing is generated.",
		}),
	),
	title: Type.Optional(
		Type.String({
			description: "Alias for description (3-5 word label); description wins when both are set.",
		}),
	),
	fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION })),
	fork: Type.Optional(Type.Boolean({ description: FORK_DESCRIPTION })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	thinking: ThinkingParam,
	model: Type.Optional(Type.String({ description: MODEL_PARAM_DESCRIPTION })),
	blockedBy: BlockedByParam,
	heartbeatSecs: HeartbeatSecsParam,
	timeoutSecs: TimeoutSecsParam,
	progressLog: ProgressLogParam,
	toolBudget: ToolBudgetParam,
	usageBudget: UsageBudgetParam,
	scope: ScopeParam,
	planTask: PlanTaskParam,
	tasks: Type.Optional(Type.Array(TaskItem, {
		minItems: 1,
		maxItems: MAX_PARALLEL_TASKS,
		description:
			"Parallel fan-out in THIS one call: independent tasks (several subagent calls in one message remain preferable for ordinary independent work). Exactly one mode per call — do not combine tasks[] with the single prompt/description fields or chain[].",
	})),
	...SharedDispatchParams,
}, { additionalProperties: false });
const SubagentChainParams = Type.Object({
	chain: Type.Array(ChainItem, {
		description: "Ordered steps. Each item needs prompt (full brief) and description (3-5 word label). Use {previous} to pass the prior step's output.",
		minItems: 1,
	}),
	...SharedDispatchParams,
}, { additionalProperties: false });
const SubagentAbortParams = Type.Object({
	agentId: Type.String({ description: "Running or queued job to abort." }),
	runId: Type.String({
		minLength: 1,
		description:
			"Exact run to abort, from the dispatch receipt or subagent_status (queued jobs carry their runId from acceptance). A stale runId — this agentId already moved to a newer run — is rejected instead of aborting the newer run.",
	}),
}, { additionalProperties: false });
const SubagentProgressParams = Type.Object({
	agentId: Type.String({ description: "Running worker whose progress channel should be re-aimed." }),
	runId: Type.String({
		minLength: 1,
		description: "Exact run to re-point, from the dispatch receipt, [subagent-stalled], or subagent_status. A stale runId is rejected.",
	}),
	progressLog: Type.String({
		minLength: 1,
		description:
			"Path to the file this worker actually appends its output to (relative to its spawn cwd, or absolute). Must resolve inside the opened project, that worker's spawn cwd, or its worktree. The file need not exist yet.",
	}),
	reportSecs: Type.Optional(Type.Integer({
		minimum: 30,
		maximum: 3600,
		description: "How often new bytes are forwarded to you as [subagent-progress]. Default: this run's existing cadence, else 60s.",
	})),
}, { additionalProperties: false });
const SubagentResolveParams = Type.Object({
	agentId: Type.String({ description: AGENT_ID_DESCRIPTION }),
	runId: Type.String({ minLength: 1, description: "Exact runId from [subagent-done] or subagent_status. Stale runIds are rejected." }),
	reason: Type.Optional(Type.String({ maxLength: 500, description: "Optional handled/superseded reason shown in closeout status." })),
}, { additionalProperties: false });
const SubagentAlarmAckParams = Type.Object({
	alarmId: Type.String({ minLength: 3, description: "Semantic alarm identity named by the Boss alarm, for example quota-pill.2. Internal opaque runId is never required." }),
	note: Type.Optional(Type.String({ maxLength: 500, description: "Optional short handling note. Acknowledgement stops only this exact episode's recurring alarm." })),
}, { additionalProperties: false });
const SubagentWatchParams = Type.Object({
	action: StringEnum(WATCH_ACTIONS, {
		description: "start arms sampling of one exact live run (baseline first: an unchanged run emits nothing); update re-arms cadence or re-points the progress channel of an existing subscription; stop removes the exact pair; list shows every subscription, or one exact pair when agentId and runId are both given.",
	}),
	agentId: Type.Optional(Type.String({ description: "Worker to observe. Required for start/update/stop; for list, supply both agentId and runId for an exact filter, or neither for everything." })),
	runId: Type.Optional(Type.String({
		minLength: 1,
		description: "Exact run to watch, from the dispatch receipt or subagent_status. start/update/stop bind this exact pair: a stale runId is rejected, never re-targeted at a newer run under the same agentId.",
	})),
	intervalSecs: Type.Optional(Type.Integer({
		minimum: 30,
		maximum: 3600,
		description: "Sampling cadence in seconds, driven by the shared 30s watchdog (never a new timer). Default 60.",
	})),
	progressLog: Type.Optional(Type.String({
		minLength: 1,
		description: "start/update only: optionally (re)aim this run's progress channel at this file first — same path containment, general-purpose eligibility, and single-flight delivery as subagent_progress.",
	})),
}, { additionalProperties: false });
type SubagentExecuteParams = {
	action?: "abort" | "resolve" | "progress";
	prompt?: string;
	description?: string;
	subagent_type?: string;
	run_in_background?: boolean;
	isolation?: "worktree" | "none";
	resume_from?: string;
	agent?: string;
	task?: string;
	title?: string;
	blockedBy?: string[];
	scope?: string[];
	planTask?: string;
	thinking?: string;
	/** Optional per-dispatch model pin: exact `provider/modelId`, catalog-validated at the gate. */
	model?: string;
	worktree?: "isolated" | "none";
	noWorktreeReason?: string;
	heartbeatSecs?: number;
	timeoutSecs?: number;
	progressLog?: string;
	/** action="progress" only: forwarding cadence for the re-pointed log. */
	reportSecs?: number;
	agentId?: string;
	runId?: string;
	reason?: string;
	fresh?: boolean;
	/** Start this worker from a copy of this session's conversation (see fork-policy.ts). */
	fork?: boolean;
	cwd?: string;
	verify?: string;
	// The public schema speaks Grok-family names (prompt/description/subagent_type/
	// isolation); adoptGrokBuildDispatch at execute entry fills the internal old names
	// this runner reads, so agent/task stay required here.
	chain?: Array<{
		agent: string;
		task: string;
		prompt?: string;
		description?: string;
		subagent_type?: string;
		isolation?: "worktree" | "none";
		agentId?: string;
		fresh?: boolean;
		title?: string;
		cwd?: string;
		verify?: string;
		thinking?: string;
		/** Optional per-dispatch model pin; catalog-validated before any step spawns. */
		model?: string;
		worktree?: "isolated" | "none";
		noWorktreeReason?: string;
		heartbeatSecs?: number;
		timeoutSecs?: number;
		progressLog?: string;
		scope?: string[];
		planTask?: string;
	}>;
	tasks?: Array<{
		agent: string;
		task: string;
		title?: string;
		blockedBy?: string[];
		cwd?: string;
		verify?: string;
		thinking?: string;
		/** Optional per-dispatch model pin; catalog-validated before any task spawns. */
		model?: string;
		agentId?: string;
		fresh?: boolean;
		fork?: boolean;
		scope?: string[];
		planTask?: string;
	}>;
	agentScope?: AgentScope;
	confirmProjectAgents?: boolean;
	background?: boolean;
};
const SecretaryCommitParams = Type.Object({
	closeout: StringEnum(["pass", "needs-action", "blocked"] as const),
	integrationVerify: StringEnum(["pass", "fail", "none"] as const),
	verificationUnavailable: Type.Optional(
		Type.String({
			description:
				"Required only when integrationVerify is none: one line stating why this task has no executable verification (for example a docs-only or prompt-layer change). Omit it when verification ran.",
		}),
	),
	commitMessage: Type.String({
		description: "Safe, non-empty one-line Git commit message (maximum 200 characters).",
	}),
	paths: Type.Array(
		Type.String({
			description:
				"Exact accepted repository-relative path. Absolute, traversal, .git, and .pi paths are denied.",
		}),
	),
	allRelevantItemsClassified: Type.Boolean({
		description: "Must be true only after every relevant closeout item has a final disposition.",
	}),
	dispositions: Type.Array(
		Type.Object({
			item: Type.String(),
			disposition: StringEnum(
				["cleaned", "retained", "unclassified", "needs-fixer", "needs-user"] as const,
			),
			reason: Type.Optional(Type.String()),
		}, { additionalProperties: false }),
	),
}, { additionalProperties: false });

/**
 * The Boss's ledger write, restored as a tool that can reach nothing else.
 *
 * Depth 0 only: a worker has no ledger and no business writing one. See boss-note.ts for why
 * this exists at all — with the main session read-only, `write` and `edit` are gone, and this
 * is the one write the orchestration layer has always called a management action rather than
 * working the floor.
 */
function registerLedgerNoteTool(pi: ExtensionAPI): void {
	if (PIPIUI_DEPTH !== 0 || !PIPIUI_MAIN_CWD) return;
	pi.registerTool(bossLedgerNoteTool({ mainCwd: PIPIUI_MAIN_CWD, sessionKey: PIPIUI_SESSION }) as never);
}

/**
 * The Boss's second write: the shared half of a wave's briefs, stored once.
 *
 * Depth 0 only, and for the same reason the ledger is: a worker writing shared context would
 * be N concurrent writers to one document across isolated worktrees. See context-doc.ts.
 */
function registerContextDocTool(pi: ExtensionAPI): void {
	if (PIPIUI_DEPTH !== 0 || !PIPIUI_MAIN_CWD) return;
	pi.registerTool(contextDocTool({ mainCwd: PIPIUI_MAIN_CWD, sessionKey: PIPIUI_SESSION }) as never);
}

/**
 * Boss-only self-compression: inspect a bounded candidate manifest, then fold by id.
 * Workers must not see this tool — same PIPIUI_DEPTH !== 0 guard as ledger_note.
 */
function registerContextManageTool(pi: ExtensionAPI): void {
	if (!shouldRegisterContextManageTool(PIPIUI_DEPTH, PIPIUI_MAIN_CWD)) return;
	pi.registerTool(contextManageTool({
		sessionKey: PIPIUI_SESSION,
		getMessages: () => lastIdleFoldMessages,
		getUsage: () => lastIdleFoldUsage,
		onSuccessfulFold: () => idleFoldRegistry?.noteFolded(idleFoldSessionKey()),
	}) as never);
}

export default function (pi: ExtensionAPI) {
	// Blocks a repeat whole-board subagent_status while nothing terminal has moved.
	// See status-poll-guard.ts: the prose "do not busy-loop poll" rule never held,
	// because a progressing worker changes turns/preview on every read.
	const statusPollGuard = new StatusPollGuard();
	// This module is mounted inside the recursive worker itself. Its background
	// descendants remain owned by that worker, so only this explicit RPC marker
	// may create a lease that defers ctx.shutdown().
	residentParentShutdown = undefined;
	nestedBackgroundLifecycle = PIPIUI_NESTED_RPC_PARENT && PIPIUI_RESIDENT_RPC_WAKE_TOKEN
		? new NestedBackgroundLifecycle(maybeShutdownResidentParent)
		: undefined;
	// Background jobs must survive a tool-turn abort, but not destruction of their
	// owning session. This controller closes the tiny pre-handle spawn race during
	// session_shutdown without coupling ordinary parent-turn aborts to descendants.
	watchSessionShutdownAbort = new AbortController();
	const sessionShutdownAbort = watchSessionShutdownAbort;
	// Publish the read-only plan-adherence seam over globalThis: jiti evaluates every
	// extension entry fresh, so a module-level registry here would be invisible to
	// extensions/pipiui-plan.ts importing plan-drift.ts in its own evaluation tree.
	publishPlanAdherenceSeam({
		jobs: planAdherenceJobsSnapshot,
		recentPlanDrift: recentPlanDriftSignals,
	});
	bindIdleFoldRegistry(createIdleFoldRegistry({
		...idleFoldConfig,
		isContextAboveWatermark: () => !contextFoldIsStandby() && contextAboveIdleFoldWatermark(lastIdleFoldUsage, idleFoldConfig.lowWatermark),
		onNudge: () => handleIdleFoldNudge(pi, { watermark: idleFoldConfig.lowWatermark }),
		onFold: () => runProductionIdleFold(),
	}));
	registerLedgerNoteTool(pi);
	registerContextDocTool(pi);
	registerContextManageTool(pi);
	// Last quantized in-flight snapshot injected as a custom message. Null at
	// startup and after a clear, so empty turns stay silent.
	let lastInFlightSnapshot: string | null = null;
	// Bind the queue's boss channel: a held task nobody is told about is the forgetting this
	// queue exists to end.
	dispatchQueueNotify = (text, item) => {
		// A blocked receipt is valid only for the exact queued generation that is still held.
		// It may wait behind a busy Boss turn; abort/drop must make that delayed signal vanish.
		const shouldSend = () => queuedHeldRunIsCurrent(item.agentId, item.runId, item.heldReason);
		void trySendUserMessage(pi, text, shouldSend);
	};
	// Runtime-budget escalations ([subagent-timeout]) ride the same boss channel so a
	// stalled worker's budget decision reaches the boss mid-turn instead of killing silently.
	runtimeBudgetNotify = (text) => {
		void trySendUserMessage(pi, text);
	};
	// Same channel carries worktree merge-recovery escalations; then rebuild the persisted loop
	// (waiting-for-main windows and in-flight claims) exactly once per Boss-depth process.
	bindWorktreeRecoveryEscalation(pi);
	bindWorktreeMergedHook((event) => notifyInflightWorkersOfBaseAdvance(event));
	resumePersistedWorktreeRecovery();
	bindHostSupervisor(pi);
	// 主会话上下文压缩走有界快路径（thinking off 的 LLM 摘要 → 确定性摘要 → pi 内置兜底）。
	// 见 main-compaction.ts：不覆盖 worker（PIPIUI_AGENT_DEPTH 守卫）。
	registerMainSessionCompactionHook(pi);
	registerMidTurnCompactionGuard(AgentSession);
	registerFollowUpCompactionGuard(AgentSession);
	registerFatalHookPropagation(ExtensionRunner);
	installExtensionToolOwnershipCapture(ExtensionRunner);
	pi.on("session_start", (_event, ctx) => {
		restoreNudgeThinking(pi);
		disposeAllIdleFoldTimers();
		statusPollGuard.reset();
		// A fresh process owns no jobs, so any of this session's slices still marked
		// running belong to a process that died without finalizing them.
		armOrphanRecoveryNotice();
		// A new session inherits nothing: old subscriptions point at runs that no longer
		// exist here, and a resurrected one would leak stale-run events into this session.
		watchSessionGeneration += 1;
		watchSessionShutdownAbort = new AbortController();
		watchRegistry.clear();
		const residentRpcWakeToken = PIPIUI_RESIDENT_RPC_WAKE_TOKEN;
		if (nestedBackgroundLifecycle && residentRpcWakeToken) {
			residentParentShutdown = () => {
				ctx.shutdown();
				// The owning runSingleAgent accepts only this attempt-private status and
				// sends get_state, which lets bundled RPC observe the shutdown flag without
				// a provider turn. This token stays on the RPC transport, never in Pi text.
				ctx.ui.setStatus(residentRpcShutdownWakeStatusKey(residentRpcWakeToken), "");
			};
		}
		const piSessionId = ctx.sessionManager.getSessionId().trim();
		doneDeliveryBranchProvider = () => ctx.sessionManager.getBranch();
		initializeDoneDeliveryStore(pi, piSessionId, ctx.sessionManager.getBranch());
	});
	pi.on("session_shutdown", async () => {
		restoreNudgeThinking(pi);
		disposeAllIdleFoldTimers();
		// Drop every watch subscription before the delivery host goes: no sample may enter
		// the Supervisor (or Boss) channel after the session that owned it is collecting.
		watchSessionGeneration += 1;
		watchSessionShutdownAbort.abort();
		watchRegistry.clear();
		// Cancel queued work before draining: otherwise a just-exited child could free a
		// slot and start the next queued worker while shutdown is already collecting.
		sessionShutdownAbort.abort();
		hostStopQuiet = true;
		heldRuntimeSignals.length = 0;
		abortAllRunningAgents();
		const [, childDrain] = await Promise.all([
			disposeHostSupervisor(),
			drainPipiuiTrackedChildren(),
		]);
		if (childDrain.remainingPids.length > 0) {
			console.error(`[pipiui-subagent] session shutdown left child pids=${childDrain.remainingPids.join(",")}`);
		}
	});
	pi.on("context", (event, ctx) => {
		noteIdleFoldContext(event, ctx);
	});
	// Extension handlers run before SessionManager persistence. Re-scan the active
	// branch one tick later; sibling branches cannot acknowledge this wake.
	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") restoreNudgeThinking(pi);
		const piSessionId = ctx.sessionManager.getSessionId().trim();
		const observations = completionObservations(event.message);
		// Resident parents distinguish "the completion entered Pi" from "the parent
		// answered that follow-up". Only the latter releases their RPC keepalive.
		for (const observed of observations) {
			if (observed.sessionId === piSessionId) {
				nestedBackgroundLifecycle?.noteCompletionObserved(observed.agentId, observed.runId);
			}
		}
		if (event.message.role === "assistant") {
			nestedBackgroundLifecycle?.noteAssistantFinal((event.message as { stopReason?: unknown }).stopReason);
		}
		const assistantEnded = event.message.role === "assistant";
		if ((observations.length === 0 && !assistantEnded) || observations.some(({ sessionId }) => sessionId !== piSessionId)) return;
		const timer = setTimeout(() => {
			if (doneDeliveryPiSessionId !== piSessionId) return;
			reconcilePersistedDone(piSessionId, ctx.sessionManager.getBranch());
			// A failed first Boss assistant becomes eligible only through the normal
			// spacing/budget gate; healthy queued/observed rows remain ineligible.
			retryPendingDoneAfterSessionSettled(pi);
		}, 0);
		timer.unref?.();
	});
	// Do not add another session_before_compact handler: Pi resolves that hook
	// last-wins. The existing main-compaction hook remains its only owner; these
	// post-compaction/settled notifications merely unblock pending done delivery.
	pi.on("session_compact", (_event, ctx) => {
		const piSessionId = ctx.sessionManager.getSessionId().trim();
		reconcilePersistedDone(piSessionId, ctx.sessionManager.getBranch());
		retryPendingDoneAfterSessionSettled(pi);
	});
	pi.on("agent_settled", (_event, ctx) => {
		bossTurnBusy = false;
		const piSessionId = ctx.sessionManager.getSessionId().trim();
		reconcilePersistedDone(piSessionId, ctx.sessionManager.getBranch());
		retryPendingDoneAfterSessionSettled(pi);
		flushHeldRuntimeSignals(pi);
		if (!nestedBackgroundLifecycle) return;
		nestedBackgroundLifecycle.noteSettled();
		// Queue cancellation can terminalize without a completion callback; it must
		// not strand a resident parent. Non-aborted completions are held separately
		// above until their custom follow-up has a successful assistant final.
		nestedBackgroundLifecycle.reconcileTerminal((agentId, runId) => {
			const job = jobRegistry.get(agentId);
			return Boolean(job && job.runId === runId && job.state !== "running");
		});
	});
	registerSessionRecallTool(pi);
	// UI-independent definition management. It only reads/scaffolds/installs
	// agent packages and never enters the dispatch path.
	registerSubagentManagementTool(pi);
	// Cut-in hold 提前释放：真实用户消息（本地/远程，非扩展自己的 followUp）已进入
	// turn，说明 cut-in prompt 抢到了先手，暂缓的自动信号可以按原逻辑继续投递。
	// 同一条真实消息也解除 host-stop 静默：用户的下一条输入是会话重新活动的唯一开关。
	pi.on("input", (event) => {
		if (event.source !== "extension") {
			// The user asking what is going on deserves a current read, not a refusal.
			statusPollGuard.reset();
			releaseCutInHold();
			const text = typeof (event as { text?: unknown }).text === "string"
				? (event as { text: string }).text.trim()
				: "";
			// Any input except runtime-owned /subagent_* control commands (stop sweep,
			// panel abort/resolve/recover) is the user acting again — release the gate.
			if (!text.startsWith("/subagent_")) releaseHostStopQuiet(pi);
		}
	});
	// Worker side of the question channel. The Boss issues the directory only to its own
	// direct workers; without it the tool does not exist and the prompt says nothing.
	const askBossDir = PIPIUI_DEPTH > 0 ? process.env[QUESTION_DIR_ENV] : undefined;
	const askBossAgentId = process.env.PIPIUI_AGENT_ID;
	const askBossRunId = process.env.PIPIUI_AGENT_RUN_ID;
	const askBossEnabled = Boolean(askBossDir && askBossAgentId && askBossRunId);
	if (askBossEnabled) {
		registerAskBossTool(pi, {
			dir: askBossDir!,
			agentId: askBossAgentId!,
			runId: askBossRunId!,
			timeoutMs: resolveAskBossTimeoutMs(),
		});
	}
	// Worker side of toolBudget: count every tool call, nudge once at soft, refuse the
	// `block` list past hard. The parent keeps its own tally for the done message.
	const childToolBudget = PIPIUI_DEPTH > 0 ? decodeToolBudgetEnv(process.env[TOOL_BUDGET_ENV]) : undefined;
	if (childToolBudget) {
		const tracker = createToolBudgetTracker(childToolBudget);
		pi.on("tool_call", (event) => {
			const verdict = tracker.note(event.toolName);
			if (verdict.softReached) {
				// Advisory: a nudge that cannot be delivered is not worth failing the call over.
				void pi.sendUserMessage(formatToolBudgetSoftNudge(verdict.count, childToolBudget), { deliverAs: "steer" }).catch(() => undefined);
			}
			if (verdict.block) return { block: true, reason: verdict.block };
			return undefined;
		});
	}
	if (PIPIUI_SUBAGENT_SKILL_ISOLATION) {
		// Pi still accepts extension-contributed skillPaths under --no-skills. Remove the
		// generated model-visible skill catalog and make this child extension the sole
		// authority for the dispatched-subagent isolation instruction.
		pi.on("before_agent_start", (event) => {
			const systemPrompt = stripPiSkillsFromSystemPrompt(event.systemPrompt).trimEnd();
			const isolation = PIPIUI_SKILL_READ_BLOCK
				? `${SUBAGENT_SKILL_ISOLATION}\n${PLAN_SUBAGENT_ARTIFACT_BAN}`
				: SUBAGENT_SKILL_ISOLATION;
			// The Boss naming a findings path in the brief is the precise route and stays the
			// primary one. This is the net under it: forwarding is a rule the Boss must recall at
			// dispatch time, turns after the completion and possibly past a compaction, and the
			// whole benefit should not hang on that. Titles only, and empty on a clean project.
			// PIPIUI_PARENT reads as the parent's id from the Boss's side, but in a dispatched
			// child the env carries that child's OWN agentId — which is exactly the report to
			// leave out, since it is the file this run is about to overwrite.
			const findingsIndex = formatFindingsIndexBlock(listFindings(PIPIUI_MAIN_CWD, PIPIUI_PARENT));
			return {
				// The question-channel note rides last: it is a runtime suffix like the others,
				// and the definition prompt must stay ahead of every one of them.
				systemPrompt: [systemPrompt, isolation, findingsIndex].filter(Boolean).join("\n\n")
					+ (askBossEnabled ? `\n\n${ASK_BOSS_GUIDANCE}` : ""),
			};
		});


		// The PipiUI extension is supplied explicitly with -e and loads before global
		// extensions. Superpowers sees this marker in its later context handler and uses
		// its own messageContainsBootstrap guard instead of injecting using-superpowers.
		pi.on("context", (event) => {
			if (messagesContainSuperpowersMarker(event.messages)) return;

			const taskIndex = event.messages.findIndex(
				(message) => (message as { role?: unknown }).role === "user",
			);
			if (taskIndex < 0) return;

			const messages = [...event.messages];
			const taskMessage = messages[taskIndex] as { content?: unknown };
			if (typeof taskMessage.content === "string") {
				messages[taskIndex] = {
					...messages[taskIndex],
					content: `${taskMessage.content}\n\n${SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE}`,
				};
			} else if (Array.isArray(taskMessage.content)) {
				messages[taskIndex] = {
					...messages[taskIndex],
					content: [
						...taskMessage.content,
						{ type: "text", text: SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE },
					],
				};
			} else {
				return;
			}
			return { messages };
		});

		// Even if another extension registers skill paths, a read-only planner cannot load
		// the discovered instructions through Pi's read tool. Deliberately not applied to
		// implementers: their own repository may legitimately contain a skills/ directory.
		if (PIPIUI_SKILL_READ_BLOCK) {
			pi.on("tool_call", (event) => {
				if (event.toolName !== "read") return;
				const input = event.input as { path?: unknown; file_path?: unknown };
				const requestedPath = input.path ?? input.file_path;
				if (!isSkillReadPath(requestedPath)) return;
				return {
					block: true,
					reason: "Plan subagents cannot load SKILL.md files or files under a skills directory.",
				};
			});
		}
	} else {
		// Main session: the same sentinel makes the skill library opt-in. Skills stay
		// discoverable for an explicit user request; what is suppressed is the injected
		// "invoke a skill before any response" bootstrap, which otherwise competes with
		// the session's own protocol and pulls trivial work into a heavyweight SOP.
		pi.on("context", (event) => {
			if (messagesContainSuperpowersMarker(event.messages)) return;
			let insertAt = 0;
			while ((event.messages[insertAt] as { role?: unknown } | undefined)?.role === "compactionSummary") {
				insertAt += 1;
			}
			return {
				messages: [
					...event.messages.slice(0, insertAt),
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: MAIN_BOOTSTRAP_SUPPRESSION_NOTE }],
						timestamp: MAIN_SUPPRESSION_TIMESTAMP,
					},
					...event.messages.slice(insertAt),
				],
			};
		});
	}

	// Routing is a function of config (stable within a model/session) so it may
	// stay in the system prompt. Live worker status must not: appending clocks
	// there busts the prefix cache every user turn during fan-out. Same discipline
	// as pipiui-git.ts — custom message at the tail, and only when the quantized
	// snapshot actually changed.
	pi.on("before_agent_start", (event) => {
		bossTurnBusy = true;
		nestedBackgroundLifecycle?.noteActive();
		// A new turn is a new wave: last turn's briefs are not the ones this one repeats.
		turnDispatchedBriefs.length = 0;
		turnRepeatNudged = false;
		const routing = formatSubagentModelRoutingBlock();
		const snapshot = currentInFlightWorkersSnapshot(Date.now());
		const injection = nextInFlightInjection(lastInFlightSnapshot, snapshot);
		lastInFlightSnapshot = injection.stored;
		const result: {
			systemPrompt?: string;
			message?: {
				customType: string;
				content: Array<{ type: "text"; text: string }>;
				display: boolean;
			};
		} = {};
		if (routing) {
			result.systemPrompt = `${event.systemPrompt.trimEnd()}\n\n${routing}`;
		}
		if (injection.text) {
			result.message = {
				customType: "pipiui-inflight-workers",
				content: [{ type: "text", text: injection.text }],
				display: false,
			};
		}
		const orphanNotice = takePendingOrphanNotice();
		if (orphanNotice) {
			// One-shot and rare, and it outranks the routine in-flight snapshot: a fresh
			// process has no in-flight workers, so the two do not realistically collide.
			result.message = {
				customType: SUBAGENT_ORPHANED_CUSTOM_TYPE,
				content: [{ type: "text", text: orphanNotice }],
				display: true,
			};
		}
		if (!result.systemPrompt && !result.message) return;
		return result;
	});

	// Prompt text is not a security boundary. The runtime-owned closeout secretary
	// may write only its state records and may not perform destructive cleanup.
	pi.on("tool_call", (event) => {
		const secretaryBlock = secretaryToolCallBlock(
			PIPIUI_AGENT_ROLE,
			{ toolName: event.toolName, input: event.input },
			PIPIUI_MAIN_CWD,
		);
		if (secretaryBlock) return secretaryBlock;
		if (event.toolName !== "subagent_status" || !isUnfilteredStatusQuery(event.input)) return;
		const decision = statusPollGuard.decide([...jobRegistry.values()]);
		// `terminate` only ends the turn when every call in the batch asks for it, so a
		// turn that also does real work is untouched; a turn whose only act was the
		// redundant poll is the one that stops.
		if (!decision.allow) return { block: true, reason: decision.reason, terminate: true };
	});

	pi.registerTool({
		name: "secretary_commit",
		label: "Secretary Commit",
		description: [
			"Runtime-owned final commit gate for the closeout secretary.",
			"Requires closeout=pass, a final structured disposition set, an empty pre-existing index, and an exact accepted-path manifest.",
			"Verification must be integrationVerify=pass, or integrationVerify=none plus verificationUnavailable stating why this task has no executable verification; integrationVerify=fail is never committed.",
			"Stages and commits only that manifest; raw git add/commit remains forbidden in bash.",
			"Returns commit=created:<sha>, already-clean:<sha>, or blocked:<reason>, plus committed and remaining dirty paths.",
		].join(" "),
		parameters: makeStrictJsonSchema(SecretaryCommitParams),
		prepareArguments: bindSanitizeStrictToolArguments(makeStrictJsonSchema(SecretaryCommitParams)),
		async execute(_toolCallId, params) {
			params = omitNulls(params);
			const result = runSecretaryCommit(params, {
				processRole: PIPIUI_AGENT_ROLE,
				mainCwd: PIPIUI_MAIN_CWD,
			});
			return {
				content: [{ type: "text", text: formatSecretaryCommitResult(result) }],
				details: result,
			};
		},
	});

	// ---- 统一轮询（30s）：承载五条按节奏补推的路径 ——
	// 1) done 重投：仅 Pi 明确拒绝/抛错或首个 Boss assistant 失败后的 pending/failed；
	//    queued/observed 可能仍在健康长 turn 中，当前进程绝不按墙钟重复。
	//    Boss alarm 例外：observed（已浮出未 ack）按 1m/2m/5m 复推；queued 副本在
	//    Pi 队列里等待浮出，宽限期内绝不重投叠副本（重投前先用活动分支对账，
	//    把已浮出的 queued 提升为 observed）。
	// 2) vanished 即时检测：pid 已死但没人报告 → 立刻推，推一次后从 runningAgents 删除。
		// 3) stall 复推 / 预裁决：idle ≥ 120s 时，同步等待立刻 abort（否则信号被 hold 形成死锁）；
		//    后台 worker 先推 [subagent-stalled]，同一无活动片段最多 STALL_RENOTIFY_MAX 次，
		//    每次仍至少间隔 5 分钟；次数用尽仍无进展则 abort，而不是永远挂着。
	// 4) 长跑检查点：仍在出活的 worker 按 10 / +20 / +30 分钟墙钟叫醒 Boss，带上最近 activity。
	// 5) interrupted/aborted/failed + stored context：idle ≥ NUDGE_SECS 推 [subagent-interrupted-reminder]，
	//    再于 RENUDGE_SECS 复推一次后沉默；同 agentId 再 dispatch 为 running 时字段被清零。
	// 复用 [subagent-done] 的 followUp 通道。无 PIPIUI_* 环境变量时桥接上报自动静默（pipiuiReport no-op）。
	const STALL_WATCHDOG_KEY = "__pipiuiSubagentStallWatchdog";
	const g = globalThis as Record<string, unknown>;
	const prevWatchdog = g[STALL_WATCHDOG_KEY] as ReturnType<typeof setInterval> | undefined;
	if (prevWatchdog) clearInterval(prevWatchdog); // 防扩展 reload 后旧定时器泄漏
	const stallWatchdog = setInterval(() => {
		const now = Date.now();
		// Idle-fold TTL is an independent one-shot timer. Watchdog only sweeps orphans
		// (vanished/aborted workers whose completion hook was missed) so handles cannot leak.
		idleFoldRegistry?.sweepOrphans(new Set(runningAgents.keys()));

		// (1) done 重投——先对账：把已浮出到活动分支的副本从 queued 提升为 observed，
		// 已 ack 的行从 pendingDone 移除，避免凭陈旧内存状态叠投副本。
		if (doneDeliveryStore && doneDeliveryPiSessionId && pendingDone.size > 0 && doneDeliveryBranchProvider) {
			try {
				reconcilePersistedDone(doneDeliveryPiSessionId, doneDeliveryBranchProvider());
			} catch {
				// Reconcile is best-effort; the retry gates below stay authoritative.
			}
		}
		for (const [obligationId, entry] of [...pendingDone]) {
			if (doneDeliverySettled(entry.obligation)) { clearDoneHoldOnForget(entry); pendingDone.delete(obligationId); continue; }
			if (!doneDeliveryRetryDue(entry.obligation, now)) continue;
			sendDoneWithConfirmation(pi, entry, true);
		}

		// (2) vanished 即时检测（isProcessAlive 只是 signal 0，很便宜）。先于 stall 扫描：
		// 死掉的进程不该再收到 stall 推送。必须 jobFinalize + pipiuiReport(end) 再 delete，
		// 否则 jobRegistry/Swift 面板会永远停在 running（半结算）。
		for (const [agentId, handle] of [...runningAgents]) {
			if (!isHandleVanished(handle, now)) continue;
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60) || "(untitled)";
			const elapsed = formatElapsedMs(now - handle.startedAt);
			const reason =
				handle.pid === undefined
					? `process never attached a pid after ${elapsed}; treated as interrupted (vanished)`
					: `process gone after ${elapsed}, no result reported`;
			// Capture before markWorkerInterrupted drops the handle; the receipt is
			// addressed to this exact episode and needs its runId.
			const runId = handle.runId ?? jobRegistry.get(agentId)?.runId;
			const name = handle.name ?? jobRegistry.get(agentId)?.name ?? "?";
			if (!markWorkerInterrupted(agentId, reason)) continue;
			const job = jobRegistry.get(agentId);
			// An interruption is this worker's terminal event, so it owes the Boss the same
			// confirmed receipt a completion does. The old one-shot rode the heartbeat
			// prefix and was dropped by admission whenever no worker was left running —
			// i.e. exactly when the Boss had nothing else to wait for and hung (2026-08-15).
			const text = formatSubagentInterruptedMessage({
				agentId,
				runId: runId ?? "?",
				name,
				title,
				reason,
				cost: job?.cost,
				turns: job?.turns,
				wave: currentWaveSnapshot(now),
			});
			if (runId) deliverConfirmedDone(pi, agentId, runId, text);
			else deliverSubagentDone(pi, text);
		}

		// (2b) Progress evidence for every quiet worker, from one shared `ps` table.
		// Sampled before the stall pass so `stalledInfoFor` can let measured progress
		// excuse a long tool call and, just as importantly, refuse to excuse a wedge.
		// Start one tick after silence so a CPU pair already exists at the 120s threshold.
		const quietWorkers = [...runningAgents.values()].filter(
			(handle) => !handle.finalizing
				&& !handle.residentIdleWait
				&& handle.pid !== undefined
				&& progressIdleMs(now, handle) >= LIVENESS_SAMPLE_AFTER_MS,
		);
		if (quietWorkers.length > 0) {
			const rows = readProcessTable();
			if (rows.length > 0) for (const handle of quietWorkers) sampleWorkerCpu(handle, rows, now);
		}

		// (2b+) progressLog 采样：Boss 指定的持续日志每拍 stat 一次（30s 节奏）。体积或 mtime
		// 变新即视为进展（更新 lastProgressLogAt）；只读元数据不读内容；文件不存在不算失败。
		// 先于 stall 判定执行，让同一拍的 idle 判定用上新样本。
		for (const handle of runningAgents.values()) {
			applyProgressLogSampleTick(handle, now);
		}
		// (2b++) progressLog 回传：独立于墙钟检查点。默认每 60s（设了 heartbeatSecs 用该间隔）
		// 读取自上次偏移的新增字节（≤4KB），经 Supervisor force-forward 直达 Boss；无新字节不打扰。
		// 单飞：上一次投递未结算就持有 claim，本拍直接跳过——不排队，也绝不重复读同一段字节。
		for (const [progressAgentId, progressHandle] of runningAgents) {
			if (!progressHandle.progressLogPath || progressHandle.finalizing) continue;
			const intervalMs = progressHandle.progressLogIntervalMs ?? DEFAULT_PROGRESS_LOG_REPORT_MS;
			if (now - (progressHandle.lastProgressReportAt ?? progressHandle.startedAt) < intervalMs) continue;
			const claim = claimProgressLogReport(progressHandle);
			if (!claim) continue;
			progressHandle.lastProgressReportAt = now;
			void deliverProgressLogReport(pi, progressAgentId, progressHandle)
				.catch((err) => {
					console.error("[pipiui-subagent] progress-log delivery failed:", progressAgentId, err instanceof Error ? err.message : err);
				})
				.finally(() => {
					releaseProgressLogReport(progressHandle, claim);
				});
		}

		// (2b*3) watch 订阅采样：subagent_watch 的到期订阅在同一拍各采样一次紧凑状态
		// （status/activity/tool/finalization/verify）。指纹不变 → 什么都不发；变化 → Supervisor
		// kind=watch 判定（wait/status 静默，forward/escalate 才唤醒 Boss）。订阅的 exact run
		// 消失或进入 done-await-host 时被静默丢弃——完成回执永远只由既有投递发一次。
		// 无新 timer：这里就是唯一的调度源（共享 30s watchdog tick）。
		for (const event of watchRegistry.tick({ now, observe: (target) => watchObservationFor(target.agentId, target.runId, now) })) {
			void deliverWatchSample(pi, event, watchSessionGeneration).catch((err) => {
				console.error("[pipiui-subagent] watch delivery failed:", event.agentId, err instanceof Error ? err.message : err);
			});
		}

		// (2c) Metadata-only stall probe. Logs only on decision change; never changes abort policy.
		for (const [agentId, handle] of runningAgents) {
			if (handle.finalizing || handle.residentIdleWait) continue;
			const stallInfo = stalledInfoFor(agentId, now);
			const idleMs = progressIdleMs(now, handle);
			const action = decideStallWatchdogAction({
				idleMs,
				stallThresholdMs: STALL_THRESHOLD_MS,
				notifyCount: handle.stallNotifyCount,
				maxNotifies: STALL_RENOTIFY_MAX,
				msSinceLastNotify: handle.lastStallNotifyAt > 0 ? now - handle.lastStallNotifyAt : idleMs,
				notifyIntervalMs: STALL_RENOTIFY_INTERVAL_MS,
				syncWait: handle.syncWait === true,
			});
			const probe = classifyWatchdogProbe({
				inTool: Boolean(stallInfo.inTool),
				stalled: stallInfo.stalled,
				stallAction: action,
				stallNotifyCount: handle.stallNotifyCount,
				childPid: handle.pid,
				finalizing: handle.finalizing,
				finalizationPhase: handle.diagnostics.finalizationPhase,
				cpuVerdict: stallInfo.verdict,
				lastOutputAt: handle.diagnostics.lastOutputAt,
				lastActivityAt: handle.lastActivityAt,
				now,
			});
			const changed = recordWatchdogDecision(handle.diagnostics, probe.decision, probe.reason);
			if (changed) {
				logStallProbe("watchdog_decision", {
					agent: agentId,
					run: handle.runId,
					seq: handle.diagnostics.eventSeq,
					decision: probe.decision,
					reason: probe.reason,
					childPid: handle.pid,
					cpuDeltaMs: handle.diagnostics.lastCpuDeltaMs,
					tool: handle.toolWaitNames?.[0],
				});
			}
			if (changed || idleMs >= LIVENESS_SAMPLE_AFTER_MS) {
				pipiuiReport({
					kind: "diagnostics",
					agentId,
					runId: handle.runId,
					diagnostics: diagnosticsSnapshotFor(agentId, handle, now),
				});
			}
		}

		// (3) stall 推送 / 复推 / 预裁决 abort
		for (const [agentId, handle] of runningAgents) {
			if (handle.finalizing || handle.residentIdleWait) continue;
			// A worker blocked in ask_boss is waiting on the Boss; nagging the Boss about a
			// stall it caused, or aborting the worker for it, would be exactly backwards.
			if (workerWaitingOnBoss(handle)) {
				const questionDir = handle.runId ? questionDirFor(agentId, handle.runId) : undefined;
				if (questionDir && handle.runId) deliverPendingBossQuestions(agentId, handle.runId, questionDir);
				continue;
			}
			// Explained, measurably-progressing silence is not a stall and must not spend a
			// notification — nor march toward the auto-abort. Crying wolf on every long build
			// is what taught the Boss to discount the signal in the first place.
			const stallInfo = stalledInfoFor(agentId, now);
			if (stallInfo.inTool && !stallInfo.stalled) continue;
			const idleMs = progressIdleMs(now, handle);
			const action = decideStallWatchdogAction({
				idleMs,
				stallThresholdMs: STALL_THRESHOLD_MS,
				notifyCount: handle.stallNotifyCount,
				maxNotifies: STALL_RENOTIFY_MAX,
				msSinceLastNotify: handle.lastStallNotifyAt > 0 ? now - handle.lastStallNotifyAt : idleMs,
				notifyIntervalMs: STALL_RENOTIFY_INTERVAL_MS,
				syncWait: handle.syncWait === true,
			});
			if (action === "ignore") continue;
			const idleSec = Math.floor(idleMs / 1000);
			const job = jobRegistry.get(agentId);
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
			const activityRaw = job?.activity?.trim() || "";
			const lastLine = (activityRaw.split("\n").pop() ?? "").trim().slice(0, 120) || "(no activity)";
			if (action === "abort") {
				const aborted = abortRunningAgent(agentId, { reportTerminalToSupervisor: true, runId: handle.runId });
				if (!aborted.ok) continue;
				logStallProbe("abort", {
					agent: agentId,
					run: handle.runId,
					seq: handle.diagnostics.eventSeq,
					reason: "stall",
					childPid: handle.pid,
				});
				if (handle.syncWait !== true) {
					void deliverStallWake(pi, formatBlockedMessage({ agentId, runId: handle.runId, title, idleSec, lastLine }));
				}
				pipiuiReport(attachDiagnostics({
					kind: "stalled",
					agentId,
					runId: handle.runId,
					stalled: true,
					idle: idleSec,
					activity: null,
					activityActive: false,
					activityEndedAt: Date.now(),
				}, handle));
				continue;
			}
			if (!claimStallNotification(handle, now, STALL_RENOTIFY_MAX, STALL_RENOTIFY_INTERVAL_MS)) continue;
			// One read of the log per report; the tail is the diagnosis, so it is built only
			// once the notification is actually claimed.
			const progressEvidence = progressEvidenceFor(handle, now);
			void deliverStallWake(
				pi,
				formatStallMessage({
					agentId,
					runId: handle.runId,
					title,
					idleSec,
					lastLine,
					...(stallInfo.inTool ? { inTool: stallInfo.inTool } : {}),
					...(cpuEvidenceFor(agentId) ? { liveness: cpuEvidenceFor(agentId) as string } : {}),
					...(progressEvidence ? { progress: progressEvidence } : {}),
				}),
			).then((ok) => confirmStallNotification(handle, ok));
			pipiuiReport(attachDiagnostics({
				kind: "stalled",
				agentId,
				runId: handle.runId,
				stalled: true,
				idle: idleSec,
				activity: null,
				activityActive: false,
				activityEndedAt: Date.now(),
			}, handle));
		}

		// (4) wall-clock check-in: still-active workers only. Stalled/vanished/finalizing stay
		// on their own paths so a busy-but-drifting worker is the one this message is about.
		const due: Array<{ agentId: string; handle: RunningAgentHandle }> = [];
		for (const [agentId, handle] of runningAgents) {
			if (handle.finalizing || handle.checkinInFlight) continue;
			if (isHandleVanished(handle, now)) continue;
			if (!handle.residentIdleWait && stalledInfoFor(agentId, now).stalled) continue;
			const delivered = handle.checkinCount ?? 0;
			if (now < nextCheckinAt(handle.startedAt, delivered, handle.heartbeatMs)) continue;
			due.push({ agentId, handle });
		}
		if (due.length > 0) {
			for (const item of due) item.handle.checkinInFlight = true;
			const lines: string[] = [
				`[subagent-heartbeat] outstanding=${due.length} vanished=0 stalled=0`,
			];
			const snapshots: string[] = [];
			for (const { agentId, handle } of due) {
				const title =
					handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60) || "(untitled)";
				const elapsed = formatElapsedMs(now - handle.startedAt);
				const idle = Math.max(0, Math.floor(progressIdleMs(now, handle) / 1000));
				const state = formatHeartbeatWorkerState(agentId, handle, now);
				lines.push(`  ${agentId} (${title}) — running ${elapsed}, idle ${idle}s, state=${state}`);
				const job = jobRegistry.get(agentId);
				const lastLine =
					(job?.activity?.trim().split("\n").pop() ?? "").trim().slice(0, 120) || "(no activity)";
				const turns = job?.turns ?? "-";
				const cost = typeof job?.cost === "number" ? `$${job.cost.toFixed(4)}` : "-";
				snapshots.push(`${agentId}: turns=${turns} cost=${cost} last=${lastLine}`);
			}
			lines.push(
				"This is a wall-clock check-in while the worker is still producing output, not a stall.",
				"This heartbeat requires one latest-state check in this same Boss turn before any wait decision. For multiple workers in this batch, call one unfiltered subagent_status; do not poll each worker separately. If this turn already has a full latest snapshot covering the same target worker(s), reuse it instead of issuing a duplicate status call.",
				"Compare each worker's original task against its latest activity, output, and tool phase, then explicitly classify it as on-task, possible-drift, or drifted.",
				"Only on-task may continue waiting, with a brief reason. For possible-drift, query that exact worker/detail and classify again before deciding. For drifted, abort it; wait for the old run to become terminal, then re-dispatch by a materially different route.",
				"Never dispatch a replacement while the old worker is still running; two workers must not write the same files concurrently.",
				...snapshots,
				"Do not treat this as a new user request; perform the required status-and-drift review as heartbeat handling in the current turn.",
			);
			void trySendUserMessage(pi, lines.join("\n")).then((ok) => {
				for (const { handle } of due) {
					handle.checkinInFlight = false;
					if (ok) handle.checkinCount = (handle.checkinCount ?? 0) + 1;
				}
			});
		}

		// (5) interrupted/aborted/failed + intact stored context → reserve a run-scoped reminder,
		// then revalidate it around the cut-in wait before any follow-up can enter the boss turn.
		const resumableIds = new Set(resumableAgentIds());
		for (const reminder of scheduleInterruptedReminders(now, resumableIds)) {
			void deliverInterruptedReminder(pi, reminder);
		}

		// (6) tip-move merge preflight vs main HEAD; Boss-only, flip clean→conflict.
		tickInflightMergePreflight();
	}, STALL_WATCHDOG_INTERVAL_MS);
	stallWatchdog.unref?.();
	g[STALL_WATCHDOG_KEY] = stallWatchdog;
	const HEARTBEAT_KEY = "__pipiuiSubagentHeartbeat";
	const prevHeartbeat = g[HEARTBEAT_KEY] as ReturnType<typeof setInterval> | undefined;
	if (prevHeartbeat) {
		clearInterval(prevHeartbeat);
		delete g[HEARTBEAT_KEY];
	}
	// 进程退出时清理定时器（unref 已保证不拖住退出；这里是显式清理）。
	process.on("exit", () => {
		clearInterval(stallWatchdog);
		if (g[STALL_WATCHDOG_KEY] === stallWatchdog) delete g[STALL_WATCHDOG_KEY];
		disposeAllIdleFoldTimers();
		if (g[IDLE_FOLD_REGISTRY_KEY] === idleFoldRegistry) delete g[IDLE_FOLD_REGISTRY_KEY];
	});

	// ---- RPC commands: GUI uses these same Node control paths instead of mutating Swift-only state. ----
	pi.registerCommand("subagent_abort", {
		description: "Abort a background subagent (running or queued): /subagent_abort <agentId> <runId> — runId must be the exact accepted run (PipiUI)",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const agentId = parts.shift();
			const runId = parts.shift();
			if (!agentId || !runId) {
				ctx.ui.notify("Usage: /subagent_abort <agentId> <runId>", "error");
				return;
			}
			const result = abortRunningAgent(agentId, { reportTerminalToSupervisor: true, runId });
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
		},
	});

	// Host-stop sweep. The backend stop button sends this after aborting the model turn:
	// stop must stop the whole session, not only the turn. It also arms the host-stop
	// quiet gate so no held receipt/reminder can wake the stopped session afterwards;
	// the next real user message releases the gate.
	pi.registerCommand("subagent_abort_all", {
		description: "Abort all running/queued background subagents and quiet this session until the next user message: /subagent_abort_all (PipiUI)",
		handler: async (_args, ctx) => {
			hostStopQuiet = true;
			heldRuntimeSignals.length = 0;
			const { aborted } = abortAllRunningAgents();
			ctx.ui.notify(
				aborted.length
					? `Stop sweep: aborted ${aborted.length} background agent(s) (${aborted.join(", ")}). Receipts are held until your next message.`
					: "Stop sweep: no background agents were running. Session is quiet until your next message.",
				"info",
			);
		},
	});

		pi.registerCommand("subagent_resolve", {
		description: "Mark one failed/aborted/interrupted subagent episode handled: /subagent_resolve <agentId> <runId> [reason] (PipiUI)",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const agentId = parts.shift();
			const runId = parts.shift();
			if (!agentId || !runId) {
				ctx.ui.notify("Usage: /subagent_resolve <agentId> <runId> [reason]", "error");
				return;
			}
			const result = resolveSubagentEpisode(agentId, runId, parts.join(" ") || undefined);
			if (result.ok && result.job) void reportResolvedCloseout(result.job);
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
		},
		});

		if (PIPIUI_DEPTH === 0) pi.registerCommand("subagent_alarm_ack", {
			description: "Stop one recurring terminal Boss alarm: /subagent_alarm_ack <alarmId> [note] (PipiUI)",
			handler: async (args, ctx) => {
				const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
				const alarmId = parts.shift();
				if (!alarmId) {
					ctx.ui.notify("Usage: /subagent_alarm_ack <alarmId> [note]", "error");
					return;
				}
				const result = acknowledgeSubagentAlarm(alarmId, parts.join(" ") || undefined);
				ctx.ui.notify(result.message, result.ok ? "info" : "error");
			},
		});

	// Runtime-owned recovery path. It deliberately reuses the original id: that makes
	// resolveSubagentWorktree reuse its branch/path and runSingleAgent reuse its session.
	// The cross-process lease plus running registry make duplicate bridge/restart commands no-ops.
	pi.registerCommand("subagent_recover", {
		description: "Internal: resume one failed worktree integration (PipiUI)",
		handler: async (args, ctx) => {
			const [agentId = "", requestedName = "", freshFlag = "0", verifyBase64 = ""] = (args ?? "").trim().split(/\s+/, 4);
			if (!agentId || validateAgentId(agentId)) return;
			let persistedVerify: string | undefined;
			try {
				const decoded = Buffer.from(verifyBase64, "base64").toString("utf8").trim();
				persistedVerify = decoded || undefined;
			} catch {
				persistedVerify = undefined;
			}
			recoverWorktreeIntegration(ctx.cwd, agentId, requestedName, freshFlag === "1", persistedVerify);
		},
	});

	// Per extension/session: explicit detail/archive queries bypass this cache and cannot
	// replace the last default snapshot used for adjacent duplicate suppression.
	let previousUnfilteredStatusSemanticKey: string | undefined;
	pi.registerTool({
		name: "subagent_status",
		label: "Subagent Status",
		promptSnippet: "See what workers are running, what finished, and what can be resumed — check before re-dispatching.",
		description: [
			"Query subagent job status (running / ok / failed / aborted / interrupted), including the exact runId required to resolve an old failed episode safely.",
			"The unfiltered view lists every running job plus the most recent ended jobs (same cap as a Wave line), then the most recently touched resumable workers. Older ended, resumable, and historical workers are omitted with a count; inspect one with subagent_status({agentId, full:true}), or list the whole archive with subagent_status({full:true}).",
			"An interrupted worker is not a failed one: re-dispatch its agentId to continue where it left off instead of starting someone cold.",
			"Before a user-facing conclusion, one unfiltered status call per turn is enough for the current wave. Do not call again for each [subagent-done]. While related work remains running or stalled, the gate is on the final closeout only: do not claim final completion or summarize the goal as finished until status confirms the whole related goal is terminal. This is not a silence rule — when the user directly asks about progress or what is going on, when an important diagnostic or route decision must be reported, or when you need to explain what you are waiting for, answer with a brief factual natural-language update grounded in this tool's output. Never fabricate results, never emit one update per done event, and never send an empty assistant message to comply with the waiting protocol.",
			"Prefer reading finished results via this tool or [subagent-done] over spawning a new agent for the same work.",
			"Do not busy-loop poll; one unfiltered check per turn is enough. This is enforced, not advised: a repeat unfiltered call is blocked while no worker's identity or state has changed, and the block carries the current states so a closeout gate can still be satisfied from it. A per-worker subagent_status({agentId}) is never blocked.",
		].join(" "),
		parameters: Type.Object({
			agentId: Type.Optional(Type.String({ description: "If set, return this job only with fuller Result text." })),
			onlyRunning: Type.Optional(Type.Boolean({ description: "If true, only running jobs. Default false." })),
			full: Type.Optional(
				Type.Boolean({
					description:
						"With agentId: return that job's full stored result text without display truncation. Without agentId: list the complete resumable/historical archive instead of the newest few. Default false.",
				}),
			),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params) {
			params = omitNulls(params);
			const query = {
				agentId: params.agentId,
				onlyRunning: params.onlyRunning === true,
				full: params.full === true,
			};
			const formatted = formatJobsStatus(query);
			const snapshot = decideAdjacentStatusSnapshot(
				previousUnfilteredStatusSemanticKey,
				formatted,
				query,
			);
			previousUnfilteredStatusSemanticKey = snapshot.semanticKey;
			return { content: [{ type: "text", text: snapshot.text }], details: null };
		},
	});

	const subagentParameters = SubagentParams;
	const subagentTool = {
		name: "subagent",
		label: "Subagent",
		// The Boss's own hands-on tools (read/grep/edit/bash) are all itemized in Pi's rendered
		// tool list; without a snippet the dispatch tool is the one thing missing from it, which
		// is exactly backwards for the tool it is supposed to reach for first. `subagent_chain`
		// and `subagent_watch` have carried snippets since they shipped; this one did not, and
		// the boss-tool policy check let it pass because the philosophy layer names it — an OR
		// that is too lenient for the primary tool.
		promptSnippet: "Dispatch a worker: recon you do not want to run yourself (explore), an implementation sidecar, or a review. Several in one message run concurrently.",
		description: [
			"Dispatch one worker. A single dispatch requires prompt (the full brief), description (3-5 word label), and agentId — a short semantic id you choose for this worker, e.g. \"quota-pill\" (2-24 chars: lowercase letters, digits, \"-\", \"_\"). No id is generated for you; re-dispatching the same agentId resumes that worker, and fresh:true starts the same id cold.",
			"Optional: subagent_type (default general-purpose), title, isolation (worktree|none), cwd, verify, thinking, model (exact provider/modelId pin for THIS dispatch only), blockedBy, heartbeatSecs, timeoutSecs, toolBudget ({soft?, hard, block?}: tool-call cap enforced in the worker; for recon/review), usageBudget ({tokens?/costUsd?: {soft?, hard}}: soft notifies you, hard aborts the worker; read-only roles only), progressLog, scope, planTask (semantic slug of the approved-plan task this dispatch implements; when an approved plan has open tasks, omitting it or naming an unknown task gets an advisory [plan-drift] line — never blocked), run_in_background. resume_from is a deprecated alias of agentId.",
			"Parallel mode: pass tasks[] (each item: task, agentId, and the same optional fields including its own model) instead of prompt/description. Independent workers: call this tool multiple times in the same response. Do not serialize them across turns.",
			"Ordered steps use subagent_chain (each step carries its own unique agentId). Stop a job with subagent_abort({agentId, runId}). Close a failed episode with subagent_resolve({agentId, runId}). Inspect with subagent_status before re-dispatching.",
		].join(" "),
		parameters: subagentParameters,
		// pi validates arguments before execute() runs; models that emit
		// `action: null`-style fillers or unknown keys would otherwise loop on
		// "root: must not have additional properties" forever (the error never
		// names the offending key), wedging the whole turn.
		prepareArguments: bindSanitizeStrictToolArguments(subagentParameters),

		async execute(_toolCallId, params: SubagentExecuteParams, signal, onUpdate, ctx) {
			params = adoptGrokBuildDispatch(omitNulls(params));
			const toolCallId = _toolCallId;
			// One invocation is one wave, however many tasks it carries — that is the unit the
			// fan-out layer plans in, so it is the unit the ledger's rows are grouped by.
			beginWave();
			const ctxModel = (ctx as { model?: { provider?: string; id?: string; contextWindow?: number } } | undefined)?.model;
			const sessionModel = formatCtxModel(ctxModel);
			const contextWindow = ctxContextWindow(ctxModel);
			// Fork source: this session's own JSONL. Resolved once per wave from the same
			// accessor session_recall uses; absent for an ephemeral/in-memory session, which
			// fork-policy turns into a named refusal rather than a silent cold dispatch.
			const forkSourceFile = bossSessionFile(ctx);
			// 多层深度护栏：达到上限的进程不允许继续派 subagent
			const depthLimitMessage = rejectDispatchAtDepth({ depth: PIPIUI_DEPTH, maxDepth: PIPIUI_MAX_DEPTH });
			if (depthLimitMessage) {
				return {
					content: [
						{
							type: "text",
							text: depthLimitMessage,
						},
					],
					details: { mode: "single", agentScope: params.agentScope ?? "user", projectAgentsDir: null, results: [] },
				};
			}
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			const isChain = hasChain;
			const makeDetails =
				(mode: "single" | "parallel" | "chain", extra?: { background?: boolean; agentIds?: string[] }) =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					...(extra?.background ? { background: true } : {}),
					...(extra?.agentIds ? { agentIds: extra.agentIds } : {}),
					...(discovery.diagnostics.length > 0
						? { agentDiagnostics: discovery.diagnostics.map((entry) => `[${entry.severity}] ${entry.message}`) }
						: {}),
				});

			// Default background for single/parallel at every permitted depth — Boss and
			// nested workers alike — so a nested dispatch returns a receipt and the caller
			// can keep fanning out instead of blocking its own tool call. Multi-step chain
			// stays sync so `{previous}` can be substituted. Fan-out also forces a one-step
			// chain into the background — that is not ordered work, and waiting on it
			// deadlocks stall recovery because signals are held while the caller turn is busy.
			const dispatchBackground = decideDispatchBackground({
				isChain,
				chainLength: params.chain?.length ?? 0,
				fanoutActive: fanoutLayerActive(),
				requestedBackground: params.background,
			});
			const useBackground = dispatchBackground.useBackground;
			const bgIgnoredWarning = dispatchBackground.warning;

			// action=resolve: close one exact old terminal episode without changing state/verify.
			if (params.action === "resolve") {
				const target = params.agentId?.trim();
				const runId = params.runId?.trim();
				if (!target || !runId) {
					return {
						content: [
							{ type: "text", text: 'action="resolve" requires both agentId and runId.' },
						],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
				const resolveResult = resolveSubagentEpisode(target, runId, params.reason);
				if (resolveResult.ok && resolveResult.job) void reportResolvedCloseout(resolveResult.job);
				return {
					content: [{ type: "text", text: resolveResult.message }],
					details: makeDetails("single")([]),
					isError: !resolveResult.ok,
				};
			}

			// action=progress: re-aim one live worker's progress log. Observation only — no state,
			// verify, or lifecycle change — so it does not consume a single/parallel/chain mode slot.
			if (params.action === "progress") {
				const progressResult = retargetRunningProgressLog({
					agentId: params.agentId ?? "",
					runId: params.runId ?? "",
					progressLog: params.progressLog ?? "",
					...(params.reportSecs !== undefined ? { reportSecs: params.reportSecs } : {}),
				});
				return {
					content: [{ type: "text", text: progressResult.message }],
					details: makeDetails("single")([]),
					isError: !progressResult.ok,
				};
			}

			// action=abort：中止一个后台 job（不占 single/parallel/chain 的 mode 名额）。runId 必填：
			// queued 与 running 都按 {agentId, runId} 精确匹配，stale runId 拒绝而不是误杀新 run。
			if (params.action === "abort") {
				const target = params.agentId?.trim();
				const runId = params.runId?.trim();
				if (!target || !runId) {
					return {
						content: [
							{
								type: "text",
								text: 'action="abort" requires both agentId and the exact runId (from the dispatch receipt or subagent_status; queued jobs carry their runId from acceptance). A stale runId is rejected instead of aborting a newer run.',
							},
						],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
				const abortResult = abortRunningAgent(target, {
					reportTerminalToSupervisor: true,
					runId,
				});
				return {
					content: [{ type: "text", text: abortResult.message }],
					details: makeDetails("single")([]),
					isError: !abortResult.ok,
				};
			}

			const startBackgroundAgent = (
				agentName: string,
				task: string,
				cwd: string | undefined,
				agentId: string,
				runId: string,
				mode: "single" | "parallel",
				title: string | undefined,
				verify: string | undefined,
				thinking: string | undefined,
				fresh?: boolean,
				blockedBy?: string[],
				worktree?: "isolated" | "none",
				noWorktreeReason?: string,
				heartbeatSecs?: number,
				timeoutSecs?: number,
				progressLog?: string,
				scope?: string[],
				model?: string,
				modelPin?: ValidatedModelPin,
				planTask?: string,
			): void => {
				// A receipt is an accepted lifecycle obligation even while queue/blockedBy
				// keeps it from spawning. The resident parent may not close over it.
				registerResidentDescendant(agentId, runId);
				recordRunningDispatchScope(agentId, scope);
				void runSingleAgent(
					ctx.cwd,
					agents,
					agentName,
					task,
					cwd,
					undefined,
					sessionShutdownAbort.signal, // session teardown (not a turn abort) owns this descendant subtree
					undefined,
					makeDetails(mode, { background: true, agentIds: [agentId] }),
					{ toolCallId, background: true, agentId, runId, title, sessionModel, contextWindow, verify, thinking, model, modelPin, fresh, fork: params.fork, forkSourceFile, blockedBy, scope, planTask, worktree, noWorktreeReason, heartbeatSecs, timeoutSecs, progressLog },
				)
					.then((result) => {
						clearRunningDispatchScope(agentId);
						notifySubagentDone(pi, result);
					})
					.catch((err) => {
						clearRunningDispatchScope(agentId);
						const msg = err instanceof Error ? err.message : String(err);
						console.error("[pipiui-subagent] background agent error:", agentId, msg);
						const aborted = /abort/i.test(msg);
						notifySubagentDone(
							pi,
							{
								agent: agentName,
								agentId,
								agentSource: agents.find((a) => a.name === agentName)?.source ?? "unknown",
								task,
								exitCode: 1,
								messages: [],
								stderr: msg,
								errorMessage: msg,
								usage: emptyUsage(),
								stopReason: aborted ? "aborted" : "error",
							},
							{ aborted, error: msg },
						);
					});
			};

			const formatStartedMessage = (
				items: { agentId: string; runId: string; name: string; task: string; title?: string; fresh?: boolean }[],
			): string => {
				const lines = items.map((it) => {
					// 派工回执的「将续跑」提示：parent 侧的 resumingSession 判定（会话文件存在、非 fresh）
					// 在消息组装时同步复算，Boss 派工瞬间就能看到撞名续跑与旧 cwd，不必等到 done 头部的
					// resumed=true。会话文件在 spawn 前会被 alignResumedSessionCwd 改写，但那是子进程
					// async 续体，晚于本回执的同步读取，所以这里读到的仍是改动前的旧 cwd。
					let resumeNote = "";
					if (it.fresh !== true) {
						const sessionId = `pipiui-${it.agentId}`;
						const resumeAgent = agents.find((a) => a.name === it.name);
						const resumeDir =
							resumeAgent && !resumeAgent.traits.readOnly ? agentSessionDir() : undefined;
						if (resumeDir && agentSessionExists(resumeDir, sessionId)) {
							let oldCwd = "unknown";
							try {
								for (const f of agentSessionFiles(resumeDir, sessionId)) {
									const header = JSON.parse(fs.readFileSync(f, "utf8").split("\n", 1)[0]);
									if (header && typeof header.cwd === "string") oldCwd = header.cwd;
								}
							} catch {
								// best effort; an unreadable header only weakens the hint
							}
							const worktree = PIPIUI_MAIN_CWD
								? path.join(PIPIUI_MAIN_CWD, ".pi", "worktrees", it.agentId)
								: "?";
							resumeNote = ` (resumed) 复用既有会话 ${sessionId}，旧 cwd=${oldCwd}，本次 worktree=${worktree}`;
						}
					}
					return (
						`- agentId=${it.agentId} runId=${it.runId} name=${it.name}${it.title ? ` title=${it.title}` : ""} task=${it.task.length > 120 ? `${it.task.slice(0, 120)}...` : it.task}` +
						(resumeNote ? `\n  ${resumeNote}` : "")
					);
				});
				return (
					`${bgIgnoredWarning}Started background agent(s) (${items.length}). Each line carries the exact runId for subagent_abort({agentId, runId}); queued jobs keep the runId from acceptance. ` +
					"You will receive a completion signal per agent when each finishes. " +
					"Do not busy-loop poll; use subagent_status before re-dispatch. " +
					"Continue other work or dispatch more independent agents.\n\n" +
					lines.join("\n")
				);
			};

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				const detectedModes = [
					hasSingle ? "single (prompt/description/agentId)" : "",
					hasTasks ? `tasks[${params.tasks?.length ?? 0}]` : "",
					hasChain ? `chain[${params.chain?.length ?? 0}]` : "",
				].filter(Boolean).join(" + ") || "none";
				const guidance = modeCount === 0
					? "Pick ONE mode: a single dispatch requires prompt + description + agentId together; otherwise pass tasks[] (each item: task, agentId) or chain[]."
					: "Exactly one mode per call: single (prompt/description/agentId) OR tasks[] OR chain[] — never combined.";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nDetected modes: ${detectedModes}. ${guidance}\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails(hasTasks ? "parallel" : hasChain ? "chain" : "single")([]),
					isError: true,
				};
			}

			const requestedAgentNames = hasChain
				? (params.chain ?? []).map((step) => step.agent)
				: hasTasks
					? (params.tasks ?? []).map((item) => item.agent)
					: [params.agent!];
			const nestedTypeProblem = rejectNestedDelegationTypes({
				callerDepth: PIPIUI_DEPTH,
				agentNames: requestedAgentNames,
			});
			if (nestedTypeProblem) {
				return {
					content: [{ type: "text", text: nestedTypeProblem }],
					details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}

			// blockedBy is display-only dependency metadata; reject malformed values early.
			if (hasSingle) {
				const blockedByErr = validateBlockedBy(params.blockedBy, "single");
				if (blockedByErr) {
					return {
						content: [{ type: "text", text: blockedByErr }],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
			}
			if (hasTasks && params.tasks) {
				for (let i = 0; i < params.tasks.length; i++) {
					const blockedByErr = validateBlockedBy(params.tasks[i].blockedBy, `tasks[${i}]`);
					if (blockedByErr) {
						return {
							content: [{ type: "text", text: blockedByErr }],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}
				}
			}

			// Announce these IDs before the FIRST asynchronous acceptance barrier (the project-agent
			// confirmation below, then model-pin validation). A concurrent dependent dispatch sees
			// this deterministic pending state instead of a transient "never dispatched" while the
			// wave is suspended at either await.
			const pendingDispatchIdTargets: Array<{ agentId: string | undefined; fresh?: boolean; agentName?: string; label: string }> = hasChain
				? (params.chain ?? []).map((step, index) => ({ agentId: step.agentId, fresh: step.fresh, agentName: step.agent, label: `chain step ${index + 1}` }))
				: hasTasks
					? (params.tasks ?? []).map((task, index) => ({ agentId: task.agentId, fresh: task.fresh, agentName: task.agent, label: `task ${index + 1}` }))
					: [{ agentId: params.agentId, fresh: params.fresh, agentName: params.agent, label: "this dispatch" }];
			const dispatchResumableLookup = (agentId: string, agentName?: string): boolean => {
				const config = agentName ? agents.find((agent) => agent.name === agentName) : undefined;
				if (!config || config.traits.readOnly) return false;
				const dir = agentSessionDir();
				return dir !== undefined && agentSessionExists(dir, `pipiui-${agentId}`);
			};
			const preAcceptanceIdentityProblem = dispatchIdentityGateProblem({
				targets: pendingDispatchIdTargets,
				agentId: params.agentId,
				resumeFrom: params.resume_from,
				isResumable: dispatchResumableLookup,
			});
			if (preAcceptanceIdentityProblem) {
				return {
					content: [{ type: "text", text: preAcceptanceIdentityProblem }],
					details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}
			// [plan-drift] advisory, measured at acceptance like [subagent-overlap] but never
			// gating admission: when an approved plan still has open tasks, every fresh dispatch
			// should either map onto one of them (planTask) or be a conscious out-of-plan move.
			// Known ids (terminal job, queued item, reservation, resumable conversation) are
			// re-dispatch/resume continuations and exempt, as are secretary closeouts.
			// Computed BEFORE pending-acceptance registration so this call's own ids cannot
			// whitelist themselves.
			const planDriftCandidates: PlanDriftCandidate[] = hasChain
				? (params.chain ?? []).map((step) => ({
					agentId: String(step.agentId ?? "").trim(),
					agentName: step.agent,
					subagentType: step.subagent_type,
					planTask: step.planTask,
				}))
				: hasTasks
					? (params.tasks ?? []).map((task) => ({
						agentId: String(task.agentId ?? "").trim(),
						agentName: task.agent,
						subagentType: task.subagent_type,
						planTask: task.planTask,
					}))
					: [{
						agentId: String(params.agentId ?? "").trim(),
						agentName: params.agent,
						subagentType: params.subagent_type,
						planTask: params.planTask,
					}];
			const planDriftAdvisory = planDriftAdvisoryFor(planDriftCandidates, {
				activePlan: readActivePlanTasks(PIPIUI_MAIN_CWD ?? ctx.cwd, process.env.PIPIUI_SESSION_ID),
				isKnownAgentId: (agentId) =>
					jobRegistry.has(agentId)
					|| localAgentReservations.has(agentId)
					|| dispatchQueue.snapshot().some((item) => item.agentId === agentId),
				isResumable: dispatchResumableLookup,
			});
			// Routing advisories, measured at the same acceptance boundary as [plan-drift] and
			// for the same reason: the Boss composes a dispatch from what it is holding, and the
			// two facts it is most often missing — that a finished worker already owns this
			// ground, and that this brief is a reconstruction a fork would carry for free — are
			// cheap to measure right here and impossible to remember three turns later.
			// Chain mode is exempt like the shape validator: an ordered chain names its own
			// continuity, and fork is not one of its parameters.
			const routingAdvisory = ((): string => {
				if (hasChain || PIPIUI_DEPTH !== 0) return "";
				const items: Array<{
					agentId: string;
					agentName?: string;
					brief: string;
					scope?: string[];
					fork?: boolean;
					fresh?: boolean;
				}> = hasTasks
					? (params.tasks ?? []).map((t) => ({
						agentId: String(t.agentId ?? "").trim(),
						agentName: t.agent,
						brief: t.task ?? "",
						scope: t.scope,
						fork: t.fork,
						fresh: t.fresh,
					}))
					: [{
						agentId: String(params.agentId ?? "").trim(),
						agentName: params.agent,
						brief: params.task ?? "",
						scope: params.scope,
						fork: params.fork,
						fresh: params.fresh,
					}];
				const dispatchedIds = new Set(items.map((item) => item.agentId).filter(Boolean));
				const isKnownId = (agentId: string, agentName?: string): boolean =>
					jobRegistry.has(agentId)
					|| localAgentReservations.has(agentId)
					|| dispatchQueue.snapshot().some((item) => item.agentId === agentId)
					|| dispatchResumableLookup(agentId, agentName);
				const priors = continuityPriorsFor(agents, PIPIUI_MAIN_CWD, dispatchedIds);
				const matches: ContinuityMatch[] = [];
				const handoffs: FindingsHandoff[] = [];
				const forkOpportunities: ForkOpportunity[] = [];
				for (const item of items) {
					if (!item.agentId || !item.brief) continue;
					const config = item.agentName
						? agents.find((agent) => agent.name === item.agentName)
						: undefined;
					const readOnly = config?.traits.readOnly === true;
					const known = isKnownId(item.agentId, item.agentName) && item.fresh !== true;
					const candidate = {
						agentId: item.agentId,
						agentName: item.agentName,
						brief: item.brief,
						scope: item.scope,
						readOnly,
						known,
					};
					const found = detectContinuityTarget(candidate, priors);
					// One statement per pair for the life of this session: the second telling is
					// how a true measurement became a dispatch loop (see ContinuityAdvisoryLedger).
					const match = found && continuityLedger.claim(found.candidateAgentId, found.priorAgentId)
						? found
						: undefined;
					if (match) matches.push(match);
					// The continuity line already names its own worker's report; this one covers the
					// reports nothing else would mention — an `explore` above all, which is never a
					// continuation target and is exactly the role whose report must travel onward.
					const handoff = detectFindingsHandoff(
						candidate,
						priors,
						new Set(match ? [match.priorAgentId] : []),
					);
					if (handoff) handoffs.push(handoff);
					const opportunity = detectForkOpportunity({
						fork: item.fork,
						agentId: item.agentId,
						agentName: item.agentName ?? "",
						readOnly,
						depth: PIPIUI_DEPTH,
						resuming: known,
						brief: item.brief,
						anchorCount: extractPathAnchors(item.brief).length,
						sessionFile: forkSourceFile,
					});
					if (opportunity) forkOpportunities.push(opportunity);
				}
				return [
					formatContinuityAdvisory(matches),
					formatFindingsHandoffAdvisory(handoffs),
					formatForkOpportunityAdvisory(forkOpportunities),
				]
					.filter(Boolean)
					.join("\n\n");
			})();
			/** Every acceptance-time advisory this dispatch earned, in one prefix. */
			const acceptanceAdvisory = [planDriftAdvisory, routingAdvisory].filter(Boolean).join("\n\n");
			const pendingAcceptanceToken = Symbol("dispatch-acceptance");
			const pendingAcceptanceIds = pendingDispatchIdTargets.map((target) => target.agentId!.trim());
			for (const agentId of pendingAcceptanceIds) {
				// Overlapping acceptances coexist: each claimant registers its own token so a
				// later duplicate can neither overwrite nor orphan an earlier pending claim.
				let owners = pendingDispatchAcceptances.get(agentId);
				if (!owners) pendingDispatchAcceptances.set(agentId, (owners = new Set()));
				owners.add(pendingAcceptanceToken);
			}
			// Wave-scoped bindings the post-acceptance dispatch paths still read. Declared out here
			// and assigned inside the try, so one finally below can centralize pending release on
			// every exit from the acceptance window.
			let dispatchStatsTasks: readonly DispatchStatsTask[] = hasChain
				? params.chain!
				: hasTasks
					? params.tasks!
					: [{ agent: params.agent!, task: params.task!, title: params.title, fork: params.fork }];
			let dispatchMode: DispatchStatsMode = hasChain ? "chain" : hasTasks ? "tasks" : "single";
			let dispatchNudgePrefix = "";
			let dispatchValidatorStats: DispatchValidatorStats | null = null;
			let validatedModelPins = new Map<string, ValidatedModelPin>();
			/** Branded pin lookup for downstream spawn options; undefined when the item carries no model. */
			const validatedPinOf = (model: unknown): ValidatedModelPin | undefined => {
				if (model === undefined || model === null) return undefined;
				return validatedModelPins.get(String(model).trim());
			};
			try {
				if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
					const requestedAgentNames = new Set<string>();
					if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
					if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
					if (params.agent) requestedAgentNames.add(params.agent);

					const projectAgentsRequested = Array.from(requestedAgentNames)
						.map((name) => agents.find((a) => a.name === name))
						.filter((a): a is AgentConfig => a?.source === "project");

					if (projectAgentsRequested.length > 0) {
						const names = projectAgentsRequested.map((a) => a.name).join(", ");
						const dir = discovery.projectAgentsDir ?? "(unknown)";
						const ok = await ctx.ui.confirm(
							"Run project-local agents?",
							`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
						);
						if (!ok)
							return {
								content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
								details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
							};
					}
				}

				dispatchStatsTasks = hasChain
					? params.chain!
					: hasTasks
						? params.tasks!
						: [{ agent: params.agent!, task: params.task!, title: params.title, fork: params.fork }];
				dispatchMode = hasChain ? "chain" : hasTasks ? "tasks" : "single";

				// Shape validator: single / tasks[] only. chain and same-agentId resume are exempt.
				if (!hasChain) {
					const shapeTasks = hasTasks
						? (params.tasks ?? []).map((t) => ({
								task: t.task,
								agentId: t.agentId,
								fresh: t.fresh,
								title: t.title,
							}))
						: [
								{
									task: params.task!,
									agentId: params.agentId,
									fresh: params.fresh,
									title: params.title,
								},
							];
					const assessment = assessDispatchShape({
						mode: hasTasks ? "tasks" : "single",
						tasks: shapeTasks,
					});
					dispatchValidatorStats = assessment.stats;
					if (assessment.enforceError) {
						recordSubagentDispatchStats(
							dispatchMode,
							dispatchStatsTasks,
							useBackground,
							dispatchValidatorStats,
						);
						return {
							content: [{ type: "text", text: assessment.enforceError }],
							details: makeDetails(hasTasks ? "parallel" : "single")([]),
							isError: true,
						};
					}
						dispatchNudgePrefix = assessment.nudgeText;

					// Shared-context detection. context_doc asks the Boss to foresee that a wave's
					// briefs will repeat; nobody foresees that. The repetition is trivial to measure
					// once the second brief exists, so say it here — at the dispatch where it becomes
					// true — rather than as a standing rule to remember. Advisory only: the shared
					// half cannot be lifted automatically without mangling coincidental overlap.
					if (PIPIUI_DEPTH === 0 && PIPIUI_MAIN_CWD) {
						// Accumulate as we go so two briefs in the SAME tasks[] call compare against
						// each other, not only against earlier calls in the turn.
						for (const task of shapeTasks) {
							if (!turnRepeatNudged) {
								const match = detectRepeatedBrief(
									{ agentId: task.agentId, label: task.agentId || task.title || "(unnamed)", brief: task.task },
									turnDispatchedBriefs,
								);
								if (match) {
									dispatchNudgePrefix += formatRepeatedBriefNudge(
										match,
										contextDocPath(PIPIUI_MAIN_CWD, PIPIUI_SESSION),
									);
									turnRepeatNudged = true;
								}
							}
							turnDispatchedBriefs.push({
								agentId: task.agentId,
								label: task.agentId || task.title || "(unnamed)",
								brief: task.task,
							});
						}
						if (turnDispatchedBriefs.length > TURN_BRIEF_MEMORY) {
							turnDispatchedBriefs.splice(0, turnDispatchedBriefs.length - TURN_BRIEF_MEMORY);
						}
					}
					}

				if (hasTasks && (params.tasks?.length ?? 0) > MAX_PARALLEL_TASKS) {
					return {
						content: [{ type: "text", text: `Too many parallel tasks (${params.tasks!.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
						details: makeDetails("parallel")([]),
						isError: true,
					};
				}
				const requestedNames = hasChain
					? (params.chain ?? []).map((step) => step.agent)
					: hasTasks
						? (params.tasks ?? []).map((task) => task.agent)
						: [params.agent!];
				const unknownNames = [...new Set(requestedNames.filter((name) => !agents.some((agent) => agent.name === name)))];
				if (unknownNames.length > 0) {
					const available = agents.map((agent) => `"${agent.name}"`).join(", ") || "none";
					const packageDiagnostics = discovery.diagnostics.length > 0
						? `\n\nAgent package diagnostics:\n${formatAgentDiagnostics(discovery.diagnostics)}`
						: "";
					return {
						content: [{ type: "text", text: `Unknown agent(s): ${unknownNames.map((name) => `"${name}"`).join(", ")}. Available agents: ${available}.${packageDiagnostics}` }],
						details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						isError: true,
					};
				}
				const executionTargets = hasChain
					? (params.chain ?? [])
					: hasSingle
						? [params]
						: [];
				for (const target of executionTargets) {
					const config = agents.find((agent) => agent.name === target.agent)!;
					const normalized = normalizeGeneralPurposeExecutionPolicy(config, target);
					if (normalized.problem) {
						return {
							content: [{ type: "text", text: normalized.problem }],
							details: makeDetails(hasChain ? "chain" : "single")([]),
							isError: true,
						};
					}
				}

				// Per-dispatch model pins: ONE batched authoritative RPC before anything reserves or
				// spawns. A pin names exactly one usable provider/modelId for one dispatch; any
				// transport/host failure or logical deny fails the WHOLE wave loudly at acceptance
				// time — never a silent substitution with the user's default model, never a disk read.
				const modelPinItems = [
					...(hasSingle ? [{ label: "model", model: params.model }] : []),
					...(hasTasks ? (params.tasks ?? []).map((t, i) => ({ label: `tasks[${i}].model`, model: t.model })) : []),
					...(hasChain ? (params.chain ?? []).map((s, i) => ({ label: `chain[${i}].model`, model: s.model })) : []),
				];
				if (modelPinItems.some((item) => item.model !== undefined && item.model !== null)) {
					const pinResult = await validateDispatchModelPinsViaHost(modelPinItems);
					if (!pinResult.ok) {
						// Pending release is centralized in the finally below.
						return {
							content: [{ type: "text", text: pinResult.problem }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
							isError: true,
						};
					}
					validatedModelPins = pinResult.pins;
				}

				// Identity contract, one pure gate for every dispatch form. agentId is caller-chosen and
				// required on every worker — single, tasks/parallel and chain steps alike; nothing is
				// generated. The retired random-generator shape (agent-<16hex>) is refused for new work
				// and may only resume when the role being dispatched would actually reopen a retained
				// session for that id (read-only roles never do); abort/resolve/status never pass
				// through this gate, so historical ids stay operable.
				const dispatchIdTargets: Array<{ agentId: string | undefined; fresh?: boolean; agentName?: string; label: string }> = hasChain
					? (params.chain ?? []).map((step, index) => ({ agentId: step.agentId, fresh: step.fresh, agentName: step.agent, label: `chain step ${index + 1}` }))
					: hasTasks
						? (params.tasks ?? []).map((task, index) => ({ agentId: task.agentId, fresh: task.fresh, agentName: task.agent, label: `task ${index + 1}` }))
						: [{ agentId: params.agentId, fresh: params.fresh, agentName: params.agent, label: "this dispatch" }];
				const identityProblem = dispatchIdentityGateProblem({
					targets: dispatchIdTargets,
					agentId: params.agentId,
					resumeFrom: params.resume_from,
					// Continuation-only gate for retired `agent-<16hex>` ids: actual resumability,
					// not bookkeeping — and resumability under the ROLE being dispatched. The runner
					// only opens a session for context-retaining (writable) roles: read-only roles force
					// --no-session (runSingleAgent: sessionDir === undefined), so even a stray session
					// file named after the id is not context this dispatch would reuse. Job/slice
					// metadata alone proves nothing. Active ids never reach this check: the reservation
					// selector below already rejects them as "already running", and abort/resolve/status
					// do not pass through this gate at all.
					isResumable: (agentId, agentName) => {
						const config = agentName ? agents.find((agent) => agent.name === agentName) : undefined;
						if (!config || config.traits.readOnly) return false;
						const dir = agentSessionDir();
						return dir !== undefined && agentSessionExists(dir, `pipiui-${agentId}`);
					},
				});
				if (identityProblem) {
					return {
						content: [
							{
								type: "text",
								text: identityProblem,
							},
						],
						details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						isError: true,
					};
				}
				// This is deliberately after the final await/validation and immediately before
				// dispatch. Add to the module reservation set synchronously so a concurrent tool call
				// cannot pass the same selector during any later async setup.
				const activeAgentIds = new Set<string>([
					...localAgentReservations,
					...[...pendingDispatchAcceptances]
						// An id with ANY other pending claimant is still taken: only this wave's own
						// tokens are excluded, so a later duplicate selection is rejected as running.
						.filter(([, owners]) => [...owners].some((owner) => owner !== pendingAcceptanceToken))
						.map(([agentId]) => agentId),
					...runningAgents.keys(),
					...[...jobRegistry.values()]
						.filter((job) => job.state === "running")
						.map((job) => job.agentId),
				]);
				const callerSelection = selectAndReserveCallerAgentIds(
					dispatchIdTargets.map((target) => target.agentId),
					activeAgentIds,
					localAgentReservations,
				);
				const writableProblem = unnamedWritableDispatchProblem(
					hasChain
						? (params.chain ?? []).map((step) => ({ agent: step.agent, agentId: step.agentId, worktree: step.worktree }))
						: hasTasks
							? (params.tasks ?? []).map((task) => ({ agent: task.agent, agentId: task.agentId }))
							: [{ agent: params.agent!, agentId: params.agentId, worktree: params.worktree }],
					(target) => {
						const config = agents.find((agent) => agent.name === target.agent);
						if (!config) return false;
						const execution = normalizeGeneralPurposeExecutionPolicy(config, target).policy;
						return execution ? execution.worktree === "isolated" : runtimeRolePolicyForAgent(config).worktree === "isolated";
					},
				);
				if (writableProblem) {
					// Pending release is centralized in the finally below.
					return {
						content: [{ type: "text", text: writableProblem }],
						details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						isError: true,
					};
				}
				if (callerSelection.problem) {
					// Pending release is centralized in the finally below.
					return {
						content: [{ type: "text", text: callerSelection.problem }],
						details: makeDetails(isChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						isError: true,
					};
				}
				// The selector has synchronously transferred accepted IDs to local reservations;
				// they keep the same running-like visibility without the pending map.
			} finally {
				// Centralized release for EVERY exit from the acceptance window — success after the
				// reservation transfer, confirm denial, model-pin/identity/writable/selection
				// rejection, and any thrown error. The token-matched delete repumps the queue, so no
				// rejection can strand dependents on a phantom running-like id.
				releasePendingDispatchAcceptance(pendingAcceptanceIds, pendingAcceptanceToken);
			}
			recordSubagentDispatchStats(
				dispatchMode,
				dispatchStatsTasks,
				useBackground,
				dispatchValidatorStats,
			);

			if (params.chain && params.chain.length > 0) {
				if (useBackground) {
					const step = params.chain[0]!;
					const agentName = step.agent;
					const task = (step.task ?? step.prompt ?? "").replace(/\{previous\}/g, "");
					const agentCfg = agents.find((a) => a.name === agentName);
					if (!agentCfg) {
						const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
						return {
							content: [
								{
									type: "text",
									text: `Unknown agent: "${agentName}". Available agents: ${available}.`,
								},
							],
							details: makeDetails("chain")([]),
							isError: true,
						};
					}
					const agentId = step.agentId!.trim();
					const stepRunId = DeliveryObligationStore.runId();
					startBackgroundAgent(
						agentName,
						task,
						step.cwd,
						agentId,
						stepRunId,
						"single",
						step.title,
						step.verify,
						step.thinking,
						step.fresh,
						undefined,
						step.worktree,
						step.noWorktreeReason,
						step.heartbeatSecs,
						step.timeoutSecs,
						step.progressLog,
						step.scope,
						step.model,
						validatedPinOf(step.model),
						step.planTask,
					);
					const placeholder: SingleResult = {
						agent: agentName,
						agentId,
						runId: stepRunId,
						agentSource: agentCfg.source,
						task,
						title: step.title,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: emptyUsage(),
						model: step.model ?? resolveAgentModel(agentName, agentCfg.model, sessionModel),
					};
					return {
						content: [
							{
								type: "text",
								// formatStartedMessage already prefixes bgIgnoredWarning — adding it here
								// duplicated the warning/note on one-step-chain receipts.
								text:
									(acceptanceAdvisory ? `${acceptanceAdvisory}\n\n` : "") +
									dispatchNudgePrefix +
									formatStartedMessage([
										{ agentId, runId: stepRunId, name: agentName, task, title: step.title, fresh: step.fresh },
									]),
							},
						],
						details: makeDetails("chain", { background: true, agentIds: [agentId] })([placeholder]),
					};
				}
				const results: SingleResult[] = [];
				let previousOutput = "";
				// Reservation bookkeeping: the gate reserved every step id up front; each step
				// handed to runSingleAgent releases its own id in runSingleAgent's finally. This
				// finally releases the ids of steps that never started — early stop, an abort
				// throw, or any exit path — so those ids are immediately re-dispatchable.
				let chainDispatchedCount = 0;
				try {

					for (let i = 0; i < params.chain.length; i++) {
						const step = params.chain[i];
						const taskWithContext = (step.task ?? step.prompt ?? "").replace(/\{previous\}/g, previousOutput);

						// Create update callback that includes all previous results
						const chainUpdate: OnUpdateCallback | undefined = onUpdate
							? (partial) => {
									// Combine completed results with current streaming result
									const currentResult = partial.details?.results[0];
									if (currentResult) {
										const allResults = [...results, currentResult];
										onUpdate({
											content: partial.content,
											details: makeDetails("chain")(allResults),
										});
									}
								}
							: undefined;

						// Ownership transfers at hand-over, not completion: runSingleAgent releases
						// its own id in its finally from this point on.
						chainDispatchedCount = i + 1;
						const result = await runSingleAgent(
							ctx.cwd,
							agents,
							step.agent,
							taskWithContext,
							step.cwd,
							i + 1,
							signal,
							chainUpdate,
							makeDetails("chain"),

							{
								toolCallId,
								title: step.title,
								sessionModel,
								contextWindow,
								verify: step.verify,
								thinking: step.thinking,
								model: step.model,
								modelPin: validatedPinOf(step.model),
								agentId: step.agentId!.trim(),
								fresh: step.fresh,
								worktree: step.worktree,
								noWorktreeReason: step.noWorktreeReason,
								heartbeatSecs: step.heartbeatSecs,
								timeoutSecs: step.timeoutSecs,
								toolBudget: step.toolBudget,
								usageBudget: step.usageBudget,
								progressLog: step.progressLog,
								scope: step.scope,
								planTask: step.planTask,
							},
						);
						results.push(result);

						const isError = isFailedResult(result);
						if (isError) {
							const errorMsg = getResultOutput(result);
							return {
								content: [
									{
										type: "text",
										text: `${bgIgnoredWarning}${formatChainVerifyPrefix(results)}Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
									},
								],
								details: makeDetails("chain")(results),
								isError: true,
							};
						}
						const integrationProblem = dependentStepIntegrationProblem({
							workerState: "ok",
							integrationState: result.integrationState,
							worktreePath: result.worktreePath,
							worktreeBranch: result.worktreeBranch,
							finalizationSummary: result.worktreeFinalization,
						});
						if (integrationProblem) {
							return {
								content: [{
									type: "text",
									text: `${bgIgnoredWarning}${formatChainVerifyPrefix(results)}Chain stopped at step ${i + 1} (${step.agent}): ${integrationProblem}`,
								}],
								details: makeDetails("chain")(results),
								isError: true,
							};
						}
						previousOutput = getFinalOutput(result.messages);
					}
				} finally {
					// Steps never handed over keep reservations only until this exit; stale
					// reservations would block re-dispatching those ids forever.
					for (const idleId of unstartedChainReservationIds(params.chain, chainDispatchedCount)) {
						releaseAgentReservation(idleId);
					}
				}
				const lastChainResult = results[results.length - 1];
				// Chain aggregated output = final step output; capped by that agent's done
				// cap, head-keep (templates put the key sections first).
				const chainOutput = truncateTextHead(
					getFinalOutput(lastChainResult.messages) || "(no output)",
					doneCapForResult(lastChainResult, false),
				);
				return {
					content: [
						{
							type: "text",
							text:
								(acceptanceAdvisory ? `${acceptanceAdvisory}\n\n` : "") +
								bgIgnoredWarning + formatChainVerifyPrefix(results) + chainOutput,
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				if (useBackground) {
					const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
					const unknown = params.tasks.filter((t) => !agents.some((a) => a.name === t.agent));
					if (unknown.length > 0) {
						const names = unknown.map((t) => `"${t.agent}"`).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Unknown agent(s): ${names}. Available agents: ${available}.`,
								},
							],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}

					// One-shot run ids are assigned at acceptance, before queueing: a queued
					// job is exactly abortable from its receipt, and the id survives into the
					// eventual runSingleAgent call so status/abort never see two runIds.
					const startedItems: { agentId: string; runId: string; name: string; task: string; title?: string; fresh?: boolean }[] = [];
					const placeholders: SingleResult[] = [];
					const agentIds: string[] = [];
					const runIds: string[] = [];

					for (const t of params.tasks) {
						const agentCfg = agents.find((a) => a.name === t.agent)!;
						const agentId = t.agentId!.trim();
						const acceptedRunId = DeliveryObligationStore.runId();
						// Batch/blocked items are accepted before the scheduler starts them.
						// Register every exact receipt now so an initial parent final cannot
						// close over a queued sibling.
						registerResidentDescendant(agentId, acceptedRunId);
						agentIds.push(agentId);
						runIds.push(acceptedRunId);
						startedItems.push({ agentId, runId: acceptedRunId, name: t.agent, task: t.task, title: t.title, fresh: t.fresh });
						placeholders.push({
							agent: t.agent,
							agentId,
							runId: acceptedRunId,
							agentSource: agentCfg.source,
							task: t.task,
							title: t.title,
							exitCode: -1,
							messages: [],
							stderr: "",
							usage: emptyUsage(),
							model: t.model ?? resolveAgentModel(t.agent, agentCfg.model, sessionModel),
						});
					}

					// Declared before it is queued: enqueueBatch schedules synchronously, so a `const`
					// referenced from run() would be in its temporal dead zone at the first pump.
					const runQueuedParallelTask = async (
						t: (typeof params.tasks)[number],
						index: number,
					) => {
						const agentId = agentIds[index];
						const acceptedRunId = runIds[index]!;
						recordRunningDispatchScope(agentId, t.scope);
						try {
							const result = await runSingleAgent(
								ctx.cwd,
								agents,
								t.agent,
								t.task,
								t.cwd,
								undefined,
								sessionShutdownAbort.signal, // session teardown owns queued descendants too
								undefined,
								makeDetails("parallel", { background: true, agentIds }),
								{ toolCallId, background: true, agentId, runId: acceptedRunId, title: t.title, sessionModel, contextWindow, verify: t.verify, thinking: t.thinking, model: t.model, modelPin: validatedPinOf(t.model), fresh: t.fresh, fork: t.fork, forkSourceFile, blockedBy: t.blockedBy, scope: t.scope, planTask: t.planTask },
							);
							notifySubagentDone(pi, result);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error("[pipiui-subagent] background parallel agent error:", agentId, msg);
							const aborted = /abort/i.test(msg);
							const failResult: SingleResult = {
								agent: t.agent,
								agentId,
								runId: acceptedRunId,
								agentSource: agents.find((a) => a.name === t.agent)?.source ?? "unknown",
								task: t.task,
								title: t.title,
								exitCode: 1,
								messages: [],
								stderr: msg,
								errorMessage: msg,
								usage: emptyUsage(),
								stopReason: aborted ? "aborted" : "error",
							};
							notifySubagentDone(pi, failResult, { aborted, error: msg });
						} finally {
							clearRunningDispatchScope(agentId);
						}
					};

					// Handed to the queue rather than started here: it owns the concurrency slot and
					// the `blockedBy` gate, so the boss is free of both the moment this call returns.
					// Per-item notification is still the finalization boundary, so completed full
					// results are not retained until the slowest sibling settles.
					const incomingScopes = params.tasks.map((t, index) => ({
						agentId: agentIds[index],
						scope: cleanScope(t.scope),
					}));
					const scopeOverlapNotice = formatDispatchScopeWarning(
						incomingScopes,
						dispatchQueue.snapshot(),
					);
					const bossOverlapNotice = formatBossWriteOverlapWarning(incomingScopes, currentBossWriteSet());
					const acceptanceNotices = [scopeOverlapNotice, bossOverlapNotice, acceptanceAdvisory].filter(Boolean).join("\n\n");
					dispatchQueue.enqueueBatch(
						params.tasks.map((t, index) => ({
							agentId: agentIds[index],
							runId: runIds[index]!,
							role: t.agent,
							title: t.title,
							task: t.task,
							blockedBy: t.blockedBy ?? [],
							scope: cleanScope(t.scope),
							...(t.planTask ? { planTask: t.planTask } : {}),
							queuedAt: Date.now(),
							run: () => runQueuedParallelTask(t, index),
						})),
					);

					return {
						content: [
							{
								type: "text",
								text:
									(acceptanceNotices ? `${acceptanceNotices}\n\n` : "") +
									dispatchNudgePrefix +
									formatStartedMessage(startedItems),
							},
						],
						details: makeDetails("parallel", { background: true, agentIds })(placeholders),
					};
				}

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						title: params.tasks[i].title,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: emptyUsage(),
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),

						{
							toolCallId,
							title: t.title,
							sessionModel,
							contextWindow,
							verify: t.verify,
							thinking: t.thinking,
							model: t.model,
							modelPin: validatedPinOf(t.model),
							agentId: t.agentId!.trim(),
							fresh: t.fresh,
							blockedBy: t.blockedBy,
							scope: t.scope,
							planTask: t.planTask,
						},
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const failed = isFailedResult(r);
					const status = failed
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					// Same attestation surface as [subagent-done]: verified field + Verify line.
					const verified = verifiedStateFor(r, { error: failed });
					const verifyLine = r.verify && verified !== "none" ? `${formatVerifyLine(r.verify)}\n\n` : "";
					return `### [${r.agent}] ${status} · verified=${verified}\n\n${verifyLine}${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text:
								dispatchNudgePrefix +
								bgIgnoredWarning +
								`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				if (useBackground) {
					const agentCfg = agents.find((a) => a.name === params.agent);
					if (!agentCfg) {
						const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
						return {
							content: [
								{
									type: "text",
									text: `Unknown agent: "${params.agent}". Available agents: ${available}.`,
								},
							],
							details: makeDetails("single")([]),
							isError: true,
						};
					}
					const agentId = params.agentId!.trim();
					// Assigned here, not inside runSingleAgent, so the receipt names the exact
					// abortable run from the moment dispatch is accepted.
					const runId = DeliveryObligationStore.runId();
					const scopeOverlapNotice = formatDispatchScopeWarning(
						[{ agentId, scope: cleanScope(params.scope) }],
						dispatchQueue.snapshot(),
					);
					const bossOverlapNotice = formatBossWriteOverlapWarning(
						[{ agentId, scope: cleanScope(params.scope) }],
						currentBossWriteSet(),
					);
					const acceptanceNotices = [scopeOverlapNotice, bossOverlapNotice, acceptanceAdvisory].filter(Boolean).join("\n\n");
					if (params.blockedBy && params.blockedBy.length > 0) {
						// A blocked receipt is already an accepted descendant obligation.
						registerResidentDescendant(agentId, runId);
						// blockedBy is declared on the single schema with queue semantics ("held until every
						// named agent succeeds"), so a single background dispatch with dependencies goes
						// through the same queue as parallel batches: accepted runId, exact-run cancel,
						// reservation released on drop — never a silently ungated immediate spawn.
						dispatchQueue.enqueueBatch([
							{
								agentId,
								runId,
								role: params.agent,
								title: params.title,
								task: params.task,
								blockedBy: params.blockedBy,
								scope: cleanScope(params.scope),
								...(params.planTask ? { planTask: params.planTask } : {}),
								queuedAt: Date.now(),
								run: () =>
									new Promise<void>((resolveRun) => {
										// Pre-spawn ownership: this queued run still holds the reservation transferred
										// at acceptance until runSingleAgent takes over cleanup. Any exit before that
										// handoff must finalize honestly and release the exact reservation — or the id
										// answers "running" forever, blocking redispatch and stranding dependents.
										let queuedSpawnStarted = false;
										let queuedTerminalSettled = false;
										releaseBlockedQueuedSingle().catch((setupError) => {
											const setupMsg = setupError instanceof Error ? setupError.message : String(setupError);
											console.error("[pipiui-subagent] background queued agent setup error:", agentId, setupMsg);
											if (!queuedTerminalSettled) {
												queuedTerminalSettled = true;
												notifySubagentDone(pi, {
													agent: params.agent!,
													agentId,
													runId,
													agentSource: agentCfg.source,
													task: params.task!,
													title: params.title,
													exitCode: 1,
													messages: [],
													stderr: setupMsg,
													errorMessage: setupMsg,
													usage: emptyUsage(),
													stopReason: "error",
												});
											}
											if (!queuedSpawnStarted) releaseAgentReservation(agentId);
											resolveRun();
										});

										// A saved pin is one linearization point at acceptance; a blockedBy item may
										// be released much later, after the authority invalidated or re-committed.
										// The stale grant must not authorize this later spawn: present the saved
										// model to the authority again right before its spawn through the same
										// batched RPC seam. Transport failure or deny fails THIS agent closed without
										// spawning — an honest terminal, never a default-model substitution.
										async function releaseBlockedQueuedSingle(): Promise<void> {
											let releasedModelPin = validatedPinOf(params.model);
											if (releasedModelPin) {
												const revalidated = await validateDispatchModelPinsViaHost([{ label: "model", model: params.model }]);
												if (!revalidated.ok) {
													const msg = `[subagent-pin-stale] ${revalidated.problem}`;
													console.error("[pipiui-subagent] background queued agent refused before spawn:", agentId, msg);
													const refusedResult: SingleResult = {
														agent: params.agent!,
														agentId,
														runId,
														agentSource: agentCfg.source,
														task: params.task!,
														title: params.title,
														exitCode: 1,
														messages: [],
														stderr: msg,
														errorMessage: msg,
														usage: emptyUsage(),
														stopReason: "error",
													};
													queuedTerminalSettled = true;
													notifySubagentDone(pi, refusedResult);
													// No-spawn terminal: release the reservation this queued run still owns —
													// after the job is terminal, so the repump reads the failure and the id is
													// immediately redispatchable instead of answering running forever.
													releaseAgentReservation(agentId);
													resolveRun();
													return;
												}
												releasedModelPin = revalidated.pins.get(String(params.model).trim())!;
											}
											// The spawn lives inside this setup function so it is gated on the pin
											// revalidation above, and releasedModelPin stays in scope for the call.
											recordRunningDispatchScope(agentId, params.scope);
											// From this call on, runSingleAgent owns the reservation release.
											queuedSpawnStarted = true;
											void runSingleAgent(
												ctx.cwd,
												agents,
												params.agent!,
												params.task!,
												params.cwd,
												undefined,
												sessionShutdownAbort.signal,
												undefined,
												makeDetails("single", { background: true, agentIds: [agentId] }),
												{ toolCallId, background: true, agentId, runId, title: params.title, sessionModel, contextWindow, verify: params.verify, thinking: params.thinking, model: params.model, modelPin: releasedModelPin, fresh: params.fresh, fork: params.fork, forkSourceFile, scope: params.scope, planTask: params.planTask, worktree: params.worktree, noWorktreeReason: params.noWorktreeReason, heartbeatSecs: params.heartbeatSecs, timeoutSecs: params.timeoutSecs, toolBudget: params.toolBudget, usageBudget: params.usageBudget, progressLog: params.progressLog },
											)
											.then((result) => {
												clearRunningDispatchScope(agentId);
												notifySubagentDone(pi, result);
												resolveRun();
											})
											.catch((err) => {
												clearRunningDispatchScope(agentId);
												const msg = err instanceof Error ? err.message : String(err);
												console.error("[pipiui-subagent] background queued agent error:", agentId, msg);
												notifySubagentDone(pi, {
													agent: params.agent!,
													agentId,
													runId,
													agentSource: agentCfg.source,
													task: params.task!,
													title: params.title,
													exitCode: 1,
													messages: [],
													stderr: msg,
													errorMessage: msg,
													usage: emptyUsage(),
													stopReason: /abort/i.test(msg) ? "aborted" : "error",
												});
												// A rejection that escaped before runSingleAgent's own cleanup took ownership
												// still holds the acceptance reservation; release it here. Idempotent once
												// the run's finally has already released.
												releaseAgentReservation(agentId);
												resolveRun();
											});
										}
									}),
							},
						]);
					} else {
						startBackgroundAgent(params.agent, params.task, params.cwd, agentId, runId, "single", params.title, params.verify, params.thinking, params.fresh, params.blockedBy, params.worktree, params.noWorktreeReason, params.heartbeatSecs, params.timeoutSecs, params.progressLog, params.scope, params.model, validatedPinOf(params.model), params.planTask);
					}
					const placeholder: SingleResult = {
						agent: params.agent,
						agentId,
						runId,
						agentSource: agentCfg.source,
						task: params.task,
						title: params.title,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: emptyUsage(),
						model: params.model ?? resolveAgentModel(params.agent, agentCfg.model, sessionModel),
					};
					return {
						content: [
							{
								type: "text",
								text:
									(acceptanceNotices ? `${acceptanceNotices}\n\n` : "") +
									dispatchNudgePrefix +
									formatStartedMessage([
										{ agentId, runId, name: params.agent, task: params.task, title: params.title, fresh: params.fresh },
									]),
							},
						],
						details: makeDetails("single", { background: true, agentIds: [agentId] })([
							placeholder,
						]),
					};
				}

				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),

					{
						toolCallId,
						title: params.title,
						sessionModel,
						contextWindow,
						verify: params.verify,
						thinking: params.thinking,
						model: params.model,
						modelPin: validatedPinOf(params.model),
						agentId: params.agentId!.trim(),
						fresh: params.fresh,
						blockedBy: params.blockedBy,
						scope: params.scope,
						planTask: params.planTask,
						worktree: params.worktree,
						noWorktreeReason: params.noWorktreeReason,
						heartbeatSecs: params.heartbeatSecs,
						timeoutSecs: params.timeoutSecs,
						toolBudget: params.toolBudget,
						usageBudget: params.usageBudget,
						progressLog: params.progressLog,
					},
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					return {
						content: [
							{
								type: "text",
								text: `${dispatchNudgePrefix}${bgIgnoredWarning}Agent ${result.stopReason || "failed"}: ${errorMsg}`,
							},
						],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text:
								dispatchNudgePrefix +
								bgIgnoredWarning +
								(getFinalOutput(result.messages) || "(no output)") +
								// Same attestation surface as [subagent-done]: verified field + Verify line.
								`\n\nverified=${verifiedStateFor(result)}` +
								(result.verify ? `\n${formatVerifyLine(result.verify)}` : ""),
						},
					],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			if (args.action === "abort") {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("warning", "abort ") +
						theme.fg("accent", args.agentId || "?"),
					0,
					0,
				);
			}
			if (args.action === "resolve") {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("success", "resolve ") +
						theme.fg("accent", args.agentId || "?") +
						theme.fg("muted", ` ${args.runId || "?"}`),
					0,
					0,
				);
			}
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i] as Record<string, unknown>;
					// Clean up {previous} placeholder for display; accept both name families.
					const cleanTask = String((step.prompt ?? step.task) || "").replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", String(step.subagent_type ?? step.agent ?? "general-purpose")) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isRunning = r.exitCode === -1 || details.background === true;
				// Background tool result is an immediate "started" placeholder; prefer content text.
				if (isRunning && details.background) {
					const text = result.content[0];
					const body = text?.type === "text" ? text.text : "(background agent started)";
					const header =
						theme.fg("warning", "⏳") +
						" " +
						theme.fg("toolTitle", theme.bold(r.agent)) +
						theme.fg("muted", ` (${r.agentSource}) background`);
					return new Text(`${header}\n${theme.fg("dim", body)}`, 0, 0);
				}
				const isError = isFailedResult(r);
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	};
	pi.registerTool(subagentTool);
	pi.registerTool({
		name: "subagent_chain",
		label: "Subagent Chain",
		description:
			"Run ordered worker steps. Each chain item needs prompt (the full brief), description (3-5 word label), and agentId — a short semantic id you choose, unique within the chain (2-24 chars: lowercase letters, digits, \"-\", \"_\"). A step may reference the prior step's output as {previous}. Optional per step: planTask, the approved-plan task slug this step implements (missing/unknown planTask under an approved plan with open tasks only earns an advisory [plan-drift] line).",
		promptSnippet: "Run ordered subagent steps in sequence; a step references the prior step's output as {previous}.",
		promptGuidelines: [
			"Use subagent_chain only for genuinely ordered multi-step work; a one-step chain is dispatched in the background while fan-out is on.",
			"Independent tasks belong in multiple subagent calls in one response, not a one-step chain used as a wait.",
		],
		parameters: SubagentChainParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentChainParams),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			// Public chain items carry prompt/description; the shared execute re-runs
			// adoptGrokBuildDispatch and reads the internal old names it fills.
			return subagentTool.execute(toolCallId, omitNulls(params) as unknown as SubagentExecuteParams, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			const steps = args.chain ?? [];
			let text =
				theme.fg("toolTitle", theme.bold("subagent_chain ")) +
				theme.fg("accent", `${steps.length} steps`);
			for (let i = 0; i < Math.min(steps.length, 3); i++) {
				const step = steps[i] as Record<string, unknown>;
				// Raw args may carry either spelling: new prompt/description or replayed old task/agent.
				const cleanTask = String(step.prompt ?? step.task ?? "").replace(/\{previous\}/g, "").trim();
				const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
				text +=
					"\n  " +
					theme.fg("muted", `${i + 1}.`) +
					" " +
					theme.fg("accent", String(step.subagent_type ?? step.agent ?? "general-purpose")) +
					theme.fg("dim", ` ${preview}`);
			}
			if (steps.length > 3) text += `\n  ${theme.fg("muted", `... +${steps.length - 3} more`)}`;
			return new Text(text, 0, 0);
		},
	});
	pi.registerTool({
		name: "subagent_abort",
		label: "Subagent Abort",
		description:
			"Abort one background worker (running or queued). Required: agentId and the exact runId from the dispatch receipt or subagent_status. A stale runId is rejected instead of aborting a newer run under the same agentId.",
		parameters: SubagentAbortParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentAbortParams),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return subagentTool.execute(
				toolCallId,
				{
					action: "abort",
					agentId: params.agentId,
					runId: params.runId,
				} as SubagentExecuteParams,
				signal,
				onUpdate,
				ctx,
			);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_abort ")) +
					theme.fg("accent", args.agentId || "?") +
					(args.runId ? theme.fg("muted", ` ${args.runId}`) : ""),
				0,
				0,
			);
		},
	});
	pi.registerTool({
		name: "subagent_progress",
		label: "Subagent Progress",
		description: [
			"Re-point one running worker's live progress log at the file it actually writes to. Required: agentId, runId (exact, from the dispatch receipt / [subagent-stalled] / subagent_status) and progressLog.",
			"Use it when a worker looks stalled but is really running something that reports through its own log — a pytest run, a playtest driver, a build — and the dispatch either named the wrong path or named none. Progress is then measured by that file growing, not by the worker's own stream, and its new bytes are forwarded to you as [subagent-progress].",
			"This corrects an observation, not the work: it resets the idle clock and this run's stall-notification budget, and it never touches the worker, its prompt, or its files. Only the bundled general-purpose worker has a progress channel. If the worker never appends to the path you name, it will be reported stalled again — so name a path its brief actually tees output to, and abort instead when it is genuinely wedged.",
		].join(" "),
		parameters: SubagentProgressParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentProgressParams),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return subagentTool.execute(
				toolCallId,
				{
					action: "progress",
					agentId: params.agentId,
					runId: params.runId,
					progressLog: params.progressLog,
					reportSecs: params.reportSecs,
				} as SubagentExecuteParams,
				signal,
				onUpdate,
				ctx,
			);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_progress ")) +
					theme.fg("accent", args.agentId || "?") +
					theme.fg("muted", ` → ${args.progressLog || "?"}`),
				0,
				0,
			);
		},
	});
	pi.registerTool({
		name: "subagent_resolve",
		label: "Subagent Resolve",
		description: "Close one terminal failed/aborted/interrupted episode. Required: agentId, runId.",
		parameters: SubagentResolveParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentResolveParams),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return subagentTool.execute(
				toolCallId,
				{ action: "resolve", agentId: params.agentId, runId: params.runId, reason: params.reason } as SubagentExecuteParams,
				signal,
				onUpdate,
				ctx,
			);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_resolve ")) +
					theme.fg("accent", args.agentId || "?") +
					theme.fg("muted", ` ${args.runId || "?"}`),
				0,
				0,
			);
		},
	});
	if (PIPIUI_DEPTH === 0) {
		// The Boss answers its direct workers' ask_boss questions; nested parents never
		// get the tool, and their children never get ask_boss (see questionDir at dispatch).
		bossPi = pi;
		registerSubagentReplyTool(pi, {
			dirFor: questionDirFor,
			currentRunId: (agentId) => runningAgents.get(agentId)?.runId,
		});
	}
	if (PIPIUI_DEPTH === 0) pi.registerTool({
		name: "subagent_alarm_ack",
		label: "Subagent Alarm Ack",
		description: "Stop the recurring Boss alarm for one handled terminal episode. Requires the semantic alarmId printed by the alarm; internal runId is never model-facing here. This does not verify, resolve, or clean up the job.",
		promptSnippet: "After handling a terminal worker alarm, acknowledge its semantic alarmId; text replies do not stop alarms.",
		parameters: SubagentAlarmAckParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentAlarmAckParams),
		async execute(_toolCallId, params) {
			const clean = omitNulls(params);
			const result = acknowledgeSubagentAlarm(clean.alarmId.trim(), clean.note);
			return {
				content: [{ type: "text", text: result.message }],
				details: null,
				isError: !result.ok,
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_alarm_ack ")) +
					theme.fg("accent", args.alarmId || "?"),
				0,
				0,
			);
		},
	});
	pi.registerTool({
		name: "subagent_watch",
		label: "Subagent Watch",
		description: [
			"Periodically observe one running worker without polling subagent_status. start arms a bounded sampling subscription on the exact run: the shared 30s watchdog takes one compact sample per due tick (status/activity/tool/finalization/verify), and only a CHANGE since the previous sample is routed as a Supervisor watch event — wait/status stay silent, forward/escalate wake you. Unchanged ticks emit nothing.",
			"Required for start/update/stop: agentId and the exact runId (from the dispatch receipt or subagent_status); a stale runId is rejected, never re-targeted at a newer run. list shows every subscription, or one exact pair when both agentId and runId are given.",
			"intervalSecs (30–3600, default 60) only sets the sampling cadence — it is not a new timer. Optional progressLog on start/update re-aims the run's progress channel first, under the same path containment, general-purpose eligibility, and single-flight delivery as subagent_progress.",
			"The registry is process-local and cleared on session start/shutdown. A terminal run drops its subscription silently: the run's normal completion receipt stays the only terminal notification, and watch never re-runs verify.",
		].join(" "),
		promptSnippet: "Periodically observe one exact run via the shared watchdog; only state changes surface, unchanged ticks stay silent.",
		parameters: SubagentWatchParams,
		prepareArguments: bindSanitizeStrictToolArguments(SubagentWatchParams),
		async execute(_toolCallId, params) {
			const result = runSubagentWatch(params);
			return { content: [{ type: "text", text: result.message }], details: null, isError: !result.ok };
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_watch ")) +
					theme.fg("accent", String(args.action ?? "?")) +
					theme.fg("muted", ` ${args.agentId ?? ""}${args.runId ? ` ${args.runId}` : ""}`),
				0,
				0,
			);
		},
	});
}

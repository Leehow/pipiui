// Stable portable-state entry point. Integration may import this directory directly
// without changing the existing subagent-host/index.ts barrel.

export {
	AGENT_PROJECTION_SCHEMA_VERSION,
	DEFAULT_AGENT_PROJECTION_LOG_LIMIT,
	agentRunKeyV1,
	createAgentProjectionStateV1,
	applyAgentEventV1,
	reduceAgentEventV1,
	decodeAndApplyAgentEventV1,
	reconcileJobsSnapshotV1,
	applyJobsSnapshotV1,
	selectJobsSnapshotV1,
	jobsSnapshotFromAgentProjectionV1,
	decodeAndReconcileJobsSnapshotV1,
	reconcileInterruptedAgentRunsV1,
	decodeAgentProjectionStateV1,
	agentProjectionStateCodecV1,
	loadAgentProjectionStateV1,
	saveAgentProjectionStateV1,
	createAgentProjectionPersistenceV1,
} from "./agent-projection.ts";
export type {
	AgentRunKeyV1,
	AgentWorktreeLifecycleV1,
	AgentTerminalFlagsV1,
	AgentUsageProjectionV1,
	AgentProjectionLogItemV1,
	AgentWorktreeProjectionV1,
	AgentVerifyProjectionV1,
	AgentRunProjectionV1,
	AgentProjectionStateV1,
	AgentProjectionReduceOptionsV1,
	DecodedAgentProjectionApplyResultV1,
	DecodedSnapshotReconcileResultV1,
	AgentProjectionLoadOptionsV1,
	AgentProjectionLoadResultV1,
	JobsSnapshotSelectorOptionsV1,
} from "./agent-projection.ts";

export {
	PLAN_STATE_SCHEMA_VERSION,
	PLAN_MAX_TASKS_V1,
	PLAN_MAX_USED_IDS_V1,
	createPlanStateV1,
	planAggregateStateV1,
	isPlanTerminalV1,
	applyPlanEventV1,
	reducePlanEventV1,
	decodeAndApplyPlanEventV1,
	decodePlanStateV1,
	planStateCodecV1,
	loadPlanStateV1,
	savePlanStateV1,
	createPlanStatePersistenceV1,
} from "./plan.ts";
export type {
	PlanLifecycleV1,
	PlanAggregateStateV1,
	PlanSnapshotV1,
	PlanStateV1,
	PlanReduceOptionsV1,
	PlanEventApplyResultV1,
	DecodedPlanEventApplyResultV1,
} from "./plan.ts";

export {
	loadVersionedStateV1,
	saveVersionedStateV1,
} from "./persistence.ts";
export { createNodeFsStorageAdapterV1 } from "./node-fs-storage.ts";
export type {
	PortableStateStorageAdapterV1,
	VersionedStateDecodeResultV1,
	VersionedStateCodecV1,
	PortableStateLoadStatusV1,
	PortableStateLoadResultV1,
	PortableStateSaveResultV1,
} from "./persistence.ts";

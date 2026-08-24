export type SubagentIntegrationState =
	| "active"
	| "pendingReview"
	| "merged"
	| "mergedCleanupPending"
	| "discarded";

export interface SubagentIntegrationStatus {
	workerState: string;
	integrationState?: SubagentIntegrationState;
	worktreePath?: string;
	worktreeBranch?: string;
	finalizationSummary?: string;
}

/** User-visible delivery contract for one worker episode. */
export function formatSubagentIntegrationStatus(input: SubagentIntegrationStatus): string[] {
	const lines = [`workerState: ${input.workerState}`];
	if (!input.worktreePath || !input.worktreeBranch) return lines;

	const integrationState = input.integrationState ?? "pendingReview";
	lines.push(
		`integrationState: ${integrationState}`,
		`worktreePath: ${input.worktreePath}`,
		`worktreeBranch: ${input.worktreeBranch}`,
	);
	if (input.finalizationSummary) lines.push(`worktreeFinalization: ${input.finalizationSummary}`);
	if (integrationState === "discarded") {
		lines.push(
			"Delivery failure: the isolated worktree was discarded; its artifact is unavailable. Do not read or recover from the recorded worktreePath.",
		);
	} else if (integrationState !== "merged" && integrationState !== "mergedCleanupPending") {
		lines.push(
			`Delivery warning: work is not confirmed merged. Do not read a relative path from the main cwd; recover or read the artifact through the absolute worktreePath above (${input.worktreePath}) until integrationState is merged.`,
		);
	}
	return lines;
}

/** Stop ordered/dependent work until an isolated worktree's delivery is confirmed. */
export function dependentStepIntegrationProblem(input: SubagentIntegrationStatus): string | null {
	if (!input.worktreePath || !input.worktreeBranch) return null;
	const integrationState = input.integrationState ?? "pendingReview";
	if (integrationState === "merged" || integrationState === "mergedCleanupPending") return null;
	if (integrationState === "discarded") {
		return `workerState=${input.workerState}, but integrationState=discarded; dependent work cannot start and there is no artifact recovery from the recorded worktreePath.`;
	}
	return `workerState=${input.workerState}, but integrationState=${integrationState}; dependent work cannot start until ${input.worktreeBranch} is merged. Recover from ${input.worktreePath}.`;
}

/** One table-cell summary for the mandatory unfiltered status snapshot. */
export function formatCompactSubagentIntegrationStatus(input: SubagentIntegrationStatus): string {
	if (!input.worktreePath || !input.worktreeBranch) return `worker=${input.workerState}`;
	const integrationState = input.integrationState ?? "pendingReview";
	if (integrationState === "discarded") {
		return `worker=${input.workerState} integration=discarded artifact=unavailable`;
	}
	if (integrationState === "merged" || integrationState === "mergedCleanupPending") {
		return `worker=${input.workerState} integration=${integrationState}`;
	}
	return `worker=${input.workerState} integration=${integrationState} worktree=${input.worktreePath}`;
}

/** Scheduler projection: an active finalizer may settle; a terminal non-merge needs a Boss decision. */
export function integrationDependencyAdmission(
	input: SubagentIntegrationStatus,
): "ready" | "waiting" | "blocked" {
	if (!input.worktreePath || !input.worktreeBranch) return "ready";
	const integrationState = input.integrationState ?? "pendingReview";
	if (integrationState === "merged" || integrationState === "mergedCleanupPending") return "ready";
	if (integrationState === "active") return "waiting";
	return "blocked";
}

/**
 * Dispatch queue: the runtime remembers work that cannot start yet, so the boss does not have to.
 *
 * Two different things used to be called a queue here, and only one of them was ever a problem.
 * A boss that accepts a task, writes it down, and decides later when to begin is deferring — that
 * is the failure fan-out exists to prevent. A task that is already handed over and is merely
 * waiting on capacity or on a declared predecessor is scheduling, and nothing about it waits on
 * the boss. This is the second kind.
 *
 * It exists because undispatched intent had nowhere to live except the boss's context, which is
 * cleared at every compaction. `blockedBy` was accepted, validated, and printed, but gated
 * nothing — so "dispatch the fixer after the reviewer reports" was a promise the boss made to
 * itself and then forgot. Now the boss hands the whole chain over in one call and stops carrying
 * it.
 *
 * A failed dependency never silently cancels or silently runs its dependents: they are held and
 * handed back, because both alternatives lose work the boss would have wanted to decide about.
 */

/** What the scheduler needs to know about one dependency name. */
export type DependencyState = "ok" | "failed" | "running" | "unknown";

export interface QueuedDispatchV1 {
	agentId: string;
	role: string;
	title?: string;
	task: string;
	blockedBy: string[];
	queuedAt: number;
	/** Set once a dependency ended badly. The item stays queued and waits for the boss. */
	heldReason?: string;
	/** Launches the worker. Resolves when it reaches a terminal state. */
	run: () => Promise<void>;
}

export interface DispatchQueueOptionsV1 {
	/** Concurrent workers this process will run. Further items wait for a slot. */
	limit: number;
	/** Terminal-state lookup for a dependency name the queue does not itself hold. */
	lookup: (agentId: string) => DependencyState;
	/** One-line signal to the boss. Called at most once per held item. */
	notify: (text: string) => void;
	now?: () => number;
}

type Admission =
	| { kind: "ready" }
	| { kind: "waiting" }
	| { kind: "held"; reason: string };

export class DispatchQueueV1 {
	private readonly options: DispatchQueueOptionsV1;
	private readonly queued: QueuedDispatchV1[] = [];
	private readonly running = new Set<string>();
	private readonly now: () => number;

	constructor(options: DispatchQueueOptionsV1) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	get runningCount(): number {
		return this.running.size;
	}

	/**
	 * Admit a whole dispatch call at once, then schedule.
	 *
	 * Batched deliberately: a task may depend on a sibling in the same call, and evaluating the
	 * first item before the second is registered would read that sibling as an unknown name and
	 * hold a chain that was perfectly well formed.
	 */
	enqueueBatch(items: QueuedDispatchV1[]): void {
		for (const item of items) this.queued.push(item);
		this.pump();
	}

	/** Called when any agent reaches a terminal state, including agents this queue never held. */
	onAgentTerminal(agentId: string): void {
		this.running.delete(agentId);
		this.pump();
	}

	/** Drop a queued item that has not started. Returns false when it is unknown or already running. */
	cancel(agentId: string): boolean {
		const index = this.queued.findIndex((item) => item.agentId === agentId);
		if (index === -1) return false;
		this.queued.splice(index, 1);
		this.pump();
		return true;
	}

	/** Queued items, in admission order, for the status listing. */
	snapshot(): ReadonlyArray<Readonly<QueuedDispatchV1>> {
		return this.queued.map((item) => ({ ...item }));
	}

	private stateOf(agentId: string): DependencyState {
		if (this.running.has(agentId)) return "running";
		// An item still in this queue has not run yet, so nothing downstream of it may start.
		if (this.queued.some((item) => item.agentId === agentId)) return "running";
		return this.options.lookup(agentId);
	}

	private admit(item: QueuedDispatchV1): Admission {
		for (const dep of item.blockedBy) {
			switch (this.stateOf(dep)) {
				case "ok":
					continue;
				case "running":
					return { kind: "waiting" };
				case "failed":
					return { kind: "held", reason: `dependency ${dep} did not succeed` };
				default:
					// Never dispatched and not queued: waiting for it would wait forever.
					return { kind: "held", reason: `dependency ${dep} was never dispatched` };
			}
		}
		return { kind: "ready" };
	}

	/**
	 * Start every admissible item, oldest first, up to the concurrency limit.
	 *
	 * An item that is waiting or held is skipped rather than blocking the scan: head-of-line
	 * blocking here would turn one slow dependency into an idle machine.
	 */
	private pump(): void {
		for (const item of [...this.queued]) {
			if (this.running.size >= this.options.limit) return;
			if (!this.queued.includes(item)) continue; // started or cancelled during this scan
			const admission = this.admit(item);
			if (admission.kind === "waiting") continue;
			if (admission.kind === "held") {
				if (!item.heldReason) {
					item.heldReason = admission.reason;
					this.options.notify(
						`[subagent-blocked] agentId=${item.agentId} title=${item.title ?? item.role} is held: ${admission.reason}. ` +
							"It has NOT run and will NOT run on its own. Re-dispatch that dependency — this task starts automatically when the dependency succeeds — " +
							`or drop it with action:"abort" + agentId="${item.agentId}" if it is no longer wanted.`,
					);
				}
				continue;
			}
			this.start(item);
		}
	}

	private start(item: QueuedDispatchV1): void {
		const index = this.queued.indexOf(item);
		if (index === -1) return;
		this.queued.splice(index, 1);
		this.running.add(item.agentId);
		void (async () => {
			try {
				await item.run();
			} finally {
				// onAgentTerminal also fires from the job registry; deleting twice is harmless and
				// this path guarantees a slot is released even if no terminal event is recorded.
				this.running.delete(item.agentId);
				this.pump();
			}
		})();
	}
}

/** Concurrent workers per process. 1000 was effectively no limit and would spawn 1000 pi processes. */
export function resolveDispatchConcurrency(
	env: NodeJS.ProcessEnv = process.env,
	fallback = 16,
): number {
	const raw = Number.parseInt(env.PIPIUI_MAX_CONCURRENCY ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * The queue's contribution to the boss's live system-prompt block.
 *
 * Handed-over work is in flight from the boss's point of view, so it belongs in the block that
 * answers "what is happening right now" — otherwise a task held by a failed dependency is
 * invisible in exactly the moment it needs a decision, which is how it got forgotten before.
 */
export function formatQueuedPromptSections(
	items: ReadonlyArray<Readonly<QueuedDispatchV1>>,
): string[] {
	const held = items.filter((item) => item.heldReason);
	const waiting = items.filter((item) => !item.heldReason);
	const lines: string[] = [];
	if (waiting.length > 0) {
		lines.push(
			"",
			`### Handed over, not started yet (${waiting.length})`,
			...waiting.map((item) => {
				const title = item.title?.trim() || item.agentId;
				const reason =
					item.blockedBy.length > 0
						? `waiting for ${item.blockedBy.join(", ")}`
						: "waiting for a free slot";
				return `- \`${item.agentId}\` (${title}) — ${reason}`;
			}),
			"These start by themselves. Do not re-dispatch them and do not wait on them.",
		);
	}
	if (held.length > 0) {
		lines.push(
			"",
			`### Held — these will NOT run without a decision from you (${held.length})`,
			...held.map((item) => {
				const title = item.title?.trim() || item.agentId;
				return `- \`${item.agentId}\` (${title}) — ${item.heldReason}`;
			}),
			'Each is waiting on a dependency that did not succeed. Re-dispatch that dependency and the held task resumes automatically, or drop it with `action:"abort"` + its agentId. Do not declare the goal finished while anything above is held.',
		);
	}
	return lines;
}

/** One line per queued item for `subagent_status`. */
export function formatQueuedDispatches(
	items: ReadonlyArray<Readonly<QueuedDispatchV1>>,
	now: number,
): string[] {
	return items.map((item) => {
		const waited = Math.max(0, Math.round((now - item.queuedAt) / 1000));
		const state = item.heldReason
			? `held (${item.heldReason})`
			: item.blockedBy.length > 0
				? `waiting for ${item.blockedBy.join(", ")}`
				: "waiting for a slot";
		const title = item.title ? ` title=${item.title}` : "";
		return `agentId=${item.agentId} role=${item.role}${title} state=queued: ${state} queued=${waited}s`;
	});
}

export interface NestedDescendantState {
	agentId: string;
	runId: string;
	terminal: boolean;
	completionRequired: boolean;
	completionObserved: boolean;
}

function key(agentId: string, runId: string): string {
	return `${agentId}\u0000${runId}`;
}

/**
 * Keeps an RPC nested parent alive only for background work it accepted itself.
 * A normal terminal descendant is not enough: its completion wake must receive a
 * final assistant response before the parent may request RPC shutdown.
 */
export class NestedBackgroundLifecycle {
	private readonly descendants = new Map<string, NestedDescendantState>();
	private settled = false;
	private shutdownRequested = false;
	private readonly onChange?: () => void;

	constructor(onChange?: () => void) {
		this.onChange = onChange;
	}

	private changed(): void {
		this.onChange?.();
	}

	register(agentId: string, runId: string): void {
		this.descendants.set(key(agentId, runId), {
			agentId,
			runId,
			terminal: false,
			completionRequired: false,
			completionObserved: false,
		});
		this.shutdownRequested = false;
		this.changed();
	}

	noteTerminal(agentId: string, runId: string, completionRequired: boolean): void {
		const descendant = this.descendants.get(key(agentId, runId));
		// The first exact terminal wins. A duplicate callback must not reopen an
		// already consumed completion obligation for the same run generation.
		if (!descendant || descendant.terminal) return;
		descendant.terminal = true;
		descendant.completionRequired = completionRequired;
		this.changed();
	}

	noteCompletionObserved(agentId: string, runId: string): void {
		const descendant = this.descendants.get(key(agentId, runId));
		if (!descendant || !descendant.completionRequired || descendant.completionObserved) return;
		descendant.completionObserved = true;
		this.changed();
	}

	/** A successful assistant final is the consumption acknowledgement for observed wakes. */
	noteAssistantFinal(stopReason: unknown): void {
		let changed = false;
		for (const descendant of this.descendants.values()) {
			if (!descendant.completionObserved) continue;
			if (stopReason === "stop") {
				descendant.completionRequired = false;
				changed = true;
			} else if (stopReason === "error" || stopReason === "aborted" || stopReason === "length") {
				// The durable delivery path will requeue a failed wake. Do not let a
				// later unrelated assistant final acknowledge this earlier attempt.
				descendant.completionObserved = false;
				changed = true;
			}
		}
		if (changed) this.changed();
	}

	noteActive(): void {
		if (!this.settled) return;
		this.settled = false;
		this.changed();
	}

	noteSettled(): void {
		if (this.settled) return;
		this.settled = true;
		this.changed();
	}

	/** Queue cancellation can terminalize without notifySubagentDone; retain only live work. */
	reconcileTerminal(isTerminal: (agentId: string, runId: string) => boolean): void {
		let changed = false;
		for (const descendant of this.descendants.values()) {
			if (!descendant.terminal && isTerminal(descendant.agentId, descendant.runId)) {
				descendant.terminal = true;
				changed = true;
			}
		}
		if (changed) this.changed();
	}

	/** Delivery exhaustion is terminally visible, not an unbounded resident lease. */
	noteDeliveryExhausted(agentId: string, runId: string): void {
		const descendant = this.descendants.get(key(agentId, runId));
		if (!descendant || !descendant.completionRequired) return;
		descendant.completionRequired = false;
		descendant.completionObserved = false;
		this.changed();
	}

	shouldShutdown(): boolean {
		return this.settled && !this.shutdownRequested && [...this.descendants.values()].every(
			(descendant) => descendant.terminal && !descendant.completionRequired,
		);
	}

	markShutdownRequested(): void {
		this.shutdownRequested = true;
	}

	snapshot(): NestedDescendantState[] {
		return [...this.descendants.values()].map((descendant) => ({ ...descendant }));
	}
}

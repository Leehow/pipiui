import type { ChildProcess } from "node:child_process";

export type ChildProcessDrainResult = Readonly<{
	requested: number;
	termExited: number;
	forceKilled: number;
	remainingPids: number[];
}>;

type TrackedChild = ChildProcess;

function childPid(child: TrackedChild): number | undefined {
	return typeof child.pid === "number" && child.pid > 0 ? child.pid : undefined;
}

function isSettled(child: TrackedChild): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, Math.max(0, ms));
		timer.unref?.();
	});
}

/**
 * Owns direct child processes for one runtime instance.
 *
 * `terminateNow` is the synchronous process-exit backstop. Normal shutdown and
 * test teardown use `drain`, which can prove exit and escalate TERM to KILL.
 */
export class ChildProcessTracker {
	private readonly children = new Set<TrackedChild>();
	private drainInFlight: Promise<ChildProcessDrainResult> | undefined;

	track(child: TrackedChild): void {
		if (isSettled(child)) return;
		this.children.add(child);
		const done = (): void => {
			this.children.delete(child);
			child.off("close", done);
			child.off("error", done);
		};
		child.on("close", done);
		child.on("error", done);
	}

	size(): number {
		return this.children.size;
	}

	terminateNow(signal: NodeJS.Signals = "SIGTERM"): void {
		for (const child of this.children) {
			if (isSettled(child)) continue;
			try {
				child.kill(signal);
			} catch {
				// Best effort only: process "exit" handlers cannot wait.
			}
		}
	}

	drain(graceMs = 2_000, killGraceMs = 2_000): Promise<ChildProcessDrainResult> {
		if (this.drainInFlight) return this.drainInFlight;
		this.drainInFlight = this.drainOnce(graceMs, killGraceMs).finally(() => {
			this.drainInFlight = undefined;
		});
		return this.drainInFlight;
	}

	private async drainOnce(graceMs: number, killGraceMs: number): Promise<ChildProcessDrainResult> {
		const targets = [...this.children].filter((child) => !isSettled(child));
		if (targets.length === 0) {
			return { requested: 0, termExited: 0, forceKilled: 0, remainingPids: [] };
		}

		for (const child of targets) {
			try {
				child.kill("SIGTERM");
			} catch {
				// The close/error listener or the liveness check below decides the outcome.
			}
		}
		await this.waitForTargets(targets, graceMs);

		const afterTerm = targets.filter((child) => this.children.has(child) && !isSettled(child));
		for (const child of afterTerm) {
			try {
				child.kill("SIGKILL");
			} catch {
				// Report any survivor after the second bounded wait.
			}
		}
		await this.waitForTargets(afterTerm, killGraceMs);

		const remaining = targets.filter((child) => this.children.has(child) && !isSettled(child));
		return {
			requested: targets.length,
			termExited: targets.length - afterTerm.length,
			forceKilled: afterTerm.length - remaining.length,
			remainingPids: remaining.map(childPid).filter((pid): pid is number => pid !== undefined),
		};
	}

	private async waitForTargets(targets: readonly TrackedChild[], timeoutMs: number): Promise<void> {
		if (targets.length === 0) return;
		const settled = Promise.all(targets.map((child) => {
			if (!this.children.has(child) || isSettled(child)) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const done = (): void => {
					child.off("close", done);
					child.off("error", done);
					resolve();
				};
				child.once("close", done);
				child.once("error", done);
			});
		}));
		await Promise.race([settled, delay(timeoutMs)]);
	}
}

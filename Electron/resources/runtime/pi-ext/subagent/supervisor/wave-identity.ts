import * as fs from "node:fs";
import * as path from "node:path";

import type { SupervisorWaveSnapshot } from "./contract.ts";

interface PersistedWaveIdentityV1 {
	version: 1;
	sessionId: string;
	generation: number;
	terminalRunKeys: string[];
}

interface PersistedWaveIdentity {
	version: 2;
	sessionId: string;
	generation: number;
	closedRunKeys: string[];
	waveOpen: boolean;
	openRunKeys: string[];
}

export interface SupervisorRuntimeWaveJob {
	agentId: string;
	runId: string;
	state: string;
}

function validKeys(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((key) => typeof key === "string" && key.length > 0);
}

function parsedState(value: unknown, sessionId: string): PersistedWaveIdentity | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const state = value as Partial<PersistedWaveIdentity & PersistedWaveIdentityV1>;
	if (state.sessionId !== sessionId || !Number.isSafeInteger(state.generation) || (state.generation ?? -1) < 0) {
		return undefined;
	}
	if (state.version === 2 && validKeys(state.closedRunKeys) && typeof state.waveOpen === "boolean") {
		return {
			version: 2,
			sessionId,
			generation: state.generation!,
			closedRunKeys: [...new Set(state.closedRunKeys)].sort(),
			waveOpen: state.waveOpen,
			openRunKeys: validKeys(state.openRunKeys) ? [...new Set(state.openRunKeys)].sort() : [],
		};
	}
	if (state.version === 1 && validKeys(state.terminalRunKeys)) {
		return {
			version: 2,
			sessionId,
			generation: state.generation!,
			closedRunKeys: [...new Set(state.terminalRunKeys)].sort(),
			waveOpen: false,
			openRunKeys: [],
		};
	}
	return undefined;
}

function runKey(job: Pick<SupervisorRuntimeWaveJob, "agentId" | "runId">): string {
	return `${job.agentId}\0${job.runId}`;
}

function terminalState(state: string): boolean {
	return state !== "running";
}

function failedState(state: string): boolean {
	return state === "failed" || state === "aborted" || state === "interrupted";
}

/**
 * Persists batch membership as well as generation. Closed runs form the
 * baseline for the next batch, so an old failure cannot pollute a later wave.
 */
export class SupervisorWaveIdentityTracker {
	private state: PersistedWaveIdentity;
	private readonly filePath: string;
	private readonly sessionId: string;

	constructor(directory: string, sessionId: string) {
		this.sessionId = sessionId;
		this.filePath = path.join(directory, "supervisor-wave-identity.json");
		this.state = this.load();
	}

	observe(allRunKeys: readonly string[], close: boolean): { waveId: string; memberRunKeys: string[] } {
		const keys = [...new Set(allRunKeys.filter((key) => key.length > 0))].sort();
		const closed = new Set(this.state.closedRunKeys);
		const memberRunKeys = keys.filter((key) => !closed.has(key));
		let changed = false;
		if (memberRunKeys.length > 0) {
			if (!this.state.waveOpen) {
				this.state = {
					...this.state,
					generation: this.state.generation + 1,
					waveOpen: true,
					openRunKeys: memberRunKeys,
				};
				changed = true;
			} else {
				const open = new Set(this.state.openRunKeys);
				const overlapsOpenWave = memberRunKeys.some((key) => open.has(key));
				if (open.size === 0 || !overlapsOpenWave) {
					this.state = {
						...this.state,
						generation: this.state.generation + 1,
						closedRunKeys: [...new Set([...this.state.closedRunKeys, ...this.state.openRunKeys])].sort(),
						openRunKeys: memberRunKeys,
					};
					changed = true;
				} else if (memberRunKeys.some((key) => !open.has(key))) {
					this.state = {
						...this.state,
						openRunKeys: [...new Set([...this.state.openRunKeys, ...memberRunKeys])].sort(),
					};
					changed = true;
				}
			}
		}
		const waveId = `${this.sessionId}:wave:${this.state.generation}`;
		if (close && memberRunKeys.length > 0) {
			this.state = {
				...this.state,
				closedRunKeys: [...new Set([...this.state.closedRunKeys, ...this.state.openRunKeys, ...memberRunKeys])].sort(),
				waveOpen: false,
				openRunKeys: [],
			};
			changed = true;
		}
		if (changed) this.persist();
		return { waveId, memberRunKeys };
	}

	/** Compatibility helper for terminal-only callers and persisted duplicate probes. */
	waveId(terminalRunKeys: readonly string[]): string {
		return this.observe(terminalRunKeys, true).waveId;
	}

	private load(): PersistedWaveIdentity {
		try {
			const parsed = parsedState(JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown, this.sessionId);
			if (parsed) return parsed;
		} catch {
			// First use and corrupt optional metadata both start from the deterministic base.
		}
		return { version: 2, sessionId: this.sessionId, generation: 0, closedRunKeys: [], waveOpen: false, openRunKeys: [] };
	}

	private persist(): void {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		const temporary = `${this.filePath}.tmp-${process.pid}`;
		fs.writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
		fs.renameSync(temporary, this.filePath);
	}
}

export function summarizeSupervisorRuntimeWave(
	tracker: SupervisorWaveIdentityTracker,
	jobs: readonly SupervisorRuntimeWaveJob[],
): SupervisorWaveSnapshot {
	const allRunKeys = jobs.map(runKey);
	const close = jobs.length > 0 && jobs.every((job) => terminalState(job.state));
	const observed = tracker.observe(allRunKeys, close);
	const members = new Set(observed.memberRunKeys);
	const batchJobs = jobs.filter((job) => members.has(runKey(job)));
	return {
		waveId: observed.waveId,
		running: batchJobs.filter((job) => !terminalState(job.state)).length,
		completed: batchJobs.filter((job) => job.state === "ok").length,
		failed: batchJobs.filter((job) => failedState(job.state)).length,
		agentIds: [...new Set(batchJobs.map((job) => job.agentId))].sort(),
	};
}

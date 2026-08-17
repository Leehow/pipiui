/**
 * Session-activity admission for runtime signals.
 *
 * Automatic [subagent-*] texts must not enter Pi's follow-up queue unless the
 * session is idle and the signal is still valid. Pi abort does not clear that
 * queue, so a send during a live turn is how a stale stall restarts a stopped
 * session.
 */

export type SessionActivity = "idle" | "busy" | "quiet";

export type RuntimeSignalKind =
	| "heartbeat"
	| "stall"
	| "done"
	| "reminder"
	| "blocked"
	| "vanished";

export interface SignalAdmissionInput {
	kind: RuntimeSignalKind;
	activity: SessionActivity;
	workerRunning?: boolean;
	episodeOpen?: boolean;
	alreadyDelivered?: boolean;
}

export type Admission = "send" | "hold" | "drop";

export function sessionActivity(state: { quiet: boolean; busy: boolean }): SessionActivity {
	if (state.quiet) return "quiet";
	if (state.busy) return "busy";
	return "idle";
}

export function classifyRuntimeSignal(text: string): RuntimeSignalKind | undefined {
	if (text.startsWith("[subagent-stalled]")) return "stall";
	if (text.startsWith("[subagent-heartbeat]")) return "heartbeat";
	if (text.startsWith("[subagent-done]")) return "done";
	if (text.startsWith("[subagent-interrupted-reminder]")) return "reminder";
	if (text.startsWith("[subagent-blocked]")) return "blocked";
	return undefined;
}

export function admitSignal(input: SignalAdmissionInput): Admission {
	if (input.activity === "quiet") {
		return input.kind === "done" ? "hold" : "drop";
	}
	if (input.activity === "busy") return "hold";
	switch (input.kind) {
		case "heartbeat":
		case "stall":
		case "vanished":
			return input.workerRunning ? "send" : "drop";
		case "reminder":
			return input.episodeOpen ? "send" : "drop";
		case "done":
			return input.alreadyDelivered ? "drop" : "send";
		case "blocked":
			return "send";
	}
}

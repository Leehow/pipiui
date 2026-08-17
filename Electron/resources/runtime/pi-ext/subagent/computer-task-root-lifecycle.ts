import type { AgentBridgeEventPayloadV1 } from "./host-bridge.ts";

type RootIdentity = Readonly<Pick<AgentBridgeEventPayloadV1, "agentId" | "runId">>;
type RootReportBody = Record<string, unknown>;
type RootReportPost = (report: AgentBridgeEventPayloadV1) => Promise<unknown>;

/** Own one run-qualified Computer Task root from its first start through one terminal report. */
export function createComputerTaskRootLifecycle(
	identity: RootIdentity,
	postStart: RootReportPost,
	postEnd: RootReportPost,
) {
	let started = false;
	let closed = false;
	return {
		async start(payload: RootReportBody): Promise<void> {
			await postStart({ ...payload, kind: "start", ...identity });
			started = true;
		},
		async close(payload: RootReportBody): Promise<boolean> {
			if (!started || closed) return false;
			closed = true;
			await postEnd({ ...payload, kind: "end", ...identity });
			return true;
		},
	};
}

import type {
	SupervisorDelivery,
	SupervisorDeliveryRequest,
	SupervisorDeliveryResult,
} from "./delivery.ts";
import type { BossEscalationEnvelope, SupervisorEventKind } from "./contract.ts";

/** What the host must do after the Supervisor has inspected a runtime signal. */
export type SupervisorHostAdmission = "accepted" | "pending" | "unhandled";

export interface SupervisorOwnedRunIdentity {
	agentId: string;
	runId: string;
}

/**
 * Tracks exact abort mutations that must close through the hidden Supervisor.
 * Supervisor actions use `request`; one-worker UI/Boss/watchdog aborts use
 * `requestExternal`. Host-wide stop sweeps deliberately bypass both methods.
 */
export function createSupervisorOwnedTerminalCloseout(deps: {
	mutate(id: SupervisorOwnedRunIdentity): void;
}): {
	request(id: SupervisorOwnedRunIdentity): boolean;
	requestExternal(id: SupervisorOwnedRunIdentity, mutate: () => void): boolean;
	terminalize(id: SupervisorOwnedRunIdentity, deliver: () => Promise<unknown>): Promise<boolean>;
} {
	const pending = new Set<string>();
	const settled = new Set<string>();
	const keyOf = (id: SupervisorOwnedRunIdentity) => `${id.agentId}\0${id.runId}`;
	const requestMutation = (id: SupervisorOwnedRunIdentity, mutate: () => void): boolean => {
		const key = keyOf(id);
		if (pending.has(key) || settled.has(key)) return false;
		pending.add(key);
		try {
			mutate();
			return true;
		} catch (error) {
			pending.delete(key);
			throw error;
		}
	};
	return {
		request(id) {
			return requestMutation(id, () => deps.mutate(id));
		},
		requestExternal(id, mutate) {
			return requestMutation(id, mutate);
		},
		async terminalize(id, deliver) {
			const key = keyOf(id);
			if (!pending.has(key) || settled.has(key)) return false;
			await deliver();
			pending.delete(key);
			settled.add(key);
			return true;
		},
	};
}

/**
 * `pending` is deliberately not treated as handled: the Supervisor owns the
 * durable receipt, but the Boss-facing delivery has not admitted it yet.
 */
export function classifySupervisorHostAdmission(
	result: Pick<SupervisorDeliveryResult, "outcome" | "useCurrentPath">,
): SupervisorHostAdmission {
	if (result.outcome === "pending") return "pending";
	return result.useCurrentPath ? "unhandled" : "accepted";
}

export async function routeHostSupervisorDelivery(
	delivery: SupervisorDelivery | undefined,
	request: SupervisorDeliveryRequest,
): Promise<SupervisorHostAdmission> {
	if (!delivery) return "unhandled";
	return classifySupervisorHostAdmission(await delivery.handle(request));
}

/**
 * Whether a Supervisor delivery to the Boss becomes an armed alarm — one that
 * keeps re-waking the Boss (1m, 2m, then every 5m) until it is explicitly
 * acknowledged.
 *
 * That relentlessness is right for something the Boss must act on and would
 * otherwise drop: a terminal episode, or an escalation asking for a decision.
 * It is wrong for a periodic status summary. A `wave` line reports what is
 * running; the correct response to it is often "nothing, keep waiting", and
 * there is no acknowledgement that fits — so arming it produced a notice that
 * re-woke the Boss every minute forever, and, because a confirmed delivery is
 * held while the Boss is busy, kept real completion receipts queued behind it.
 */
export function supervisorDeliveryArmsAlarm(input: {
	kind: SupervisorEventKind;
	envelope?: BossEscalationEnvelope;
}): boolean {
	if (input.envelope) return true;
	return input.kind !== "wave";
}

/** Stable namespaces keep a Supervisor escalation from consuming a worker's final receipt. */
export function supervisorBossObligationNamespace(input: {
	kind: SupervisorEventKind;
	envelope?: BossEscalationEnvelope;
}): string | undefined {
	if (input.envelope?.kind === "escalate") return "supervisor-escalation";
	if (input.kind === "wave") return "supervisor-wave";
	return undefined;
}

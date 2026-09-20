import { CHANNEL_DISCOVER, CHANNEL_PROVIDE, CHANNEL_WITHDRAW, JEV_PROVIDER } from "./protocol.js";
import { executeAvailability, executeRerank } from "./rerank.js";
import type { JevDeps, JevExtensionAPI, RerankOffer, RerankWithdraw } from "./types.js";

export type { JevDeps, RerankInput, RerankOutcome, RerankOffer } from "./types.js";
export {
  CHANNEL_DISCOVER,
  CHANNEL_PROVIDE,
  CHANNEL_WITHDRAW,
  JEV_API_URL,
  JEV_DEADLINE_MS,
  JEV_MAX_CANDIDATES,
  JEV_MAX_JSON_BYTES,
  JEV_MODEL,
  JEV_POLL_MS,
  JEV_PROVIDER,
  SCORE_CRITERIA,
} from "./protocol.js";
export { buildPayload, buildSystemOneBody, toWireCandidate } from "./payload.js";
export { parseHostState, checkAvailability } from "./state.js";
export { executeRerank } from "./rerank.js";

export type JevHandle = {
  dispose: () => void;
  instanceId: string;
};

function newInstanceId(): string {
  return `jev-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createJevOptimizer(pi: JevExtensionAPI, deps: JevDeps = {}): JevHandle {
  const instanceId = newInstanceId();
  const sessionAbort = new AbortController();
  let withdrawn = false;
  const unsubscribers: Array<() => void> = [];

  const gate = {
    withdrawn: () => withdrawn,
    signal: sessionAbort.signal,
  };

  const offer = (): RerankOffer => ({
    version: 1,
    provider: JEV_PROVIDER,
    instanceId,
    availability: (projectRoot, signal) => executeAvailability(projectRoot, deps, gate, signal),
    rerank: (input) => executeRerank(input, deps, gate),
  });

  const emitOffer = () => {
    if (withdrawn) return;
    pi.events?.emit(CHANNEL_PROVIDE, offer());
  };

  const dispose = () => {
    if (withdrawn) return;
    withdrawn = true;
    sessionAbort.abort();
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    const payload: RerankWithdraw = { version: 1, provider: JEV_PROVIDER, instanceId };
    try {
      pi.events?.emit(CHANNEL_WITHDRAW, payload);
    } catch {
      /* ignore */
    }
  };

  const bus = pi.events;
  if (bus && typeof bus.on === "function" && typeof bus.emit === "function") {
    const unsub = bus.on(CHANNEL_DISCOVER, () => {
      emitOffer();
    });
    if (typeof unsub === "function") unsubscribers.push(unsub);
    emitOffer();
  }

  if (typeof pi.on === "function") {
    pi.on("session_shutdown", () => {
      dispose();
    });
  }

  return { dispose, instanceId };
}

export default function registerJevOptimizer(pi: JevExtensionAPI): void {
  createJevOptimizer(pi);
}

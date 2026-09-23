import { CHANNEL_DISCOVER, CHANNEL_PROVIDE, CHANNEL_WITHDRAW, JEV_PROVIDER } from "./protocol.js";
import { BROWSER_DISCOVER, BROWSER_PROVIDE, BROWSER_WITHDRAW, executeBrowserAvailability, executeBrowserRerank, type BrowserRerankOffer } from "./browser-rerank.js";
export { executeBrowserRerank } from "./browser-rerank.js";
import { BROWSER_CHOICE_DISCOVER, BROWSER_CHOICE_PROVIDE, BROWSER_CHOICE_WITHDRAW, executeBrowserChoiceAvailability, executeBrowserChoice, type BrowserChoiceOffer } from "./browser-choice.js";
export * from "./browser-choice.js";
import { COMPUTER_CHOICE_DISCOVER, COMPUTER_CHOICE_PROVIDE, COMPUTER_CHOICE_WITHDRAW, executeComputerChoiceAvailability, executeComputerChoice, type ComputerChoiceOffer } from "./computer-choice.js";
export * from "./computer-choice.js";
import { executeAvailability, executeRerank } from "./rerank.js";
import { registerContextSelector } from "./context-selector.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  const computerAbort = new AbortController();
  let withdrawn = false;
  const unsubscribers: Array<() => void> = [];

  const gate = {
    withdrawn: () => withdrawn,
    signal: sessionAbort.signal,
  };

  const computerGate = { withdrawn: () => withdrawn, signal: computerAbort.signal };

  registerContextSelector(pi as unknown as ExtensionAPI, deps, gate);

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
  const emitBrowserOffer = () => {
    if (withdrawn) return;
    const browser: BrowserRerankOffer = {
      version: 1, provider: JEV_PROVIDER, instanceId,
      availability: (root, signal) => executeBrowserAvailability(root, deps, gate, signal),
      rerank: (input) => executeBrowserRerank(input, deps, gate),
    };
    pi.events?.emit(BROWSER_PROVIDE, browser);
  };

  const emitChoiceOffer = () => {
    if (withdrawn) return;
    const choice: BrowserChoiceOffer = {
      version: 1, provider: JEV_PROVIDER, instanceId,
      availability: (root, signal) => executeBrowserChoiceAvailability(root, deps, gate, signal),
      choose: (input) => executeBrowserChoice(input, deps, gate),
    };
    pi.events?.emit(BROWSER_CHOICE_PROVIDE, choice);
  };

  const emitComputerChoiceOffer = () => {
    if (withdrawn) return;
    const choice: ComputerChoiceOffer = {
      version: 1, provider: JEV_PROVIDER, instanceId,
      availability: (root, signal) => executeComputerChoiceAvailability(root, deps, computerGate, signal),
      choose: (input) => executeComputerChoice(input, deps, computerGate),
    };
    pi.events?.emit(COMPUTER_CHOICE_PROVIDE, choice);
  };

  const dispose = () => {
    if (withdrawn) return;
    withdrawn = true;
    sessionAbort.abort();
    computerAbort.abort();
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    const payload: RerankWithdraw = { version: 1, provider: JEV_PROVIDER, instanceId };
    for (const channel of [CHANNEL_WITHDRAW, BROWSER_WITHDRAW, BROWSER_CHOICE_WITHDRAW, COMPUTER_CHOICE_WITHDRAW]) {
      try { pi.events?.emit(channel, payload); } catch { /* One consumer cannot prevent another withdrawal. */ }
    }
  };

  const bus = pi.events;
  if (bus && typeof bus.on === "function" && typeof bus.emit === "function") {
    const unsub = bus.on(CHANNEL_DISCOVER, () => {
      emitOffer();
    });
    if (typeof unsub === "function") unsubscribers.push(unsub);
    const browserUnsub = bus.on(BROWSER_DISCOVER, emitBrowserOffer);
    if (typeof browserUnsub === "function") unsubscribers.push(browserUnsub);
    const choiceUnsub = bus.on(BROWSER_CHOICE_DISCOVER, emitChoiceOffer);
    if (typeof choiceUnsub === "function") unsubscribers.push(choiceUnsub);
    const computerUnsub = bus.on(COMPUTER_CHOICE_DISCOVER, emitComputerChoiceOffer);
    if (typeof computerUnsub === "function") unsubscribers.push(computerUnsub);
    emitOffer();
    emitBrowserOffer();
    emitChoiceOffer();
    emitComputerChoiceOffer();
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

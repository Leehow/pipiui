/** Process-local, structural contract. No static dependency on the optional Jev extension. */
export const COMPUTER_DISCOVER = 'pipiui.computer-choice.discover.v1';
export const COMPUTER_PROVIDE = 'pipiui.computer-choice.provide.v1';
export const COMPUTER_WITHDRAW = 'pipiui.computer-choice.withdraw.v1';
export type ChoiceCandidate = { id: string; description: string };
export type ComputerChoiceInput = {
  projectRoot: string; goal: string; candidates: ChoiceCandidate[];
  history?: Array<{ operation: string; outcome: string }>;
  coverage?: { collected: number; omitted: number; truncated: boolean };
  redactions?: string[]; signal?: AbortSignal;
};
export type ComputerChoiceOutcome = {
  status: 'applied' | 'skipped' | 'fallback'; candidateId?: string; reason?: string;
  model?: string; inputTokens?: number;
};
export type ComputerChoiceOffer = {
  version: 1; provider: 'jev-optimizer'; instanceId: string;
  availability(root: string, signal?: AbortSignal): Promise<{ ready: boolean; reason?: string; generation?: string }>;
  choose(input: ComputerChoiceInput): Promise<ComputerChoiceOutcome>;
};
type Bus = { on(channel: string, handler: (value: any) => void): (() => void) | void; emit(channel: string, value?: unknown): void };
export type ComputerChoiceConnection = ReturnType<typeof connectComputerChoice>;
export function connectComputerChoice(bus?: Bus) {
  let current: { offer: ComputerChoiceOffer; signal: AbortSignal } | undefined;
  let abort: AbortController | undefined;
  let closed = false;
  const withdraw = () => { abort?.abort(); current = undefined; };
  const onProvide = bus?.on(COMPUTER_PROVIDE, offer => {
    if (closed || offer?.version !== 1 || offer.provider !== 'jev-optimizer' || typeof offer.instanceId !== 'string'
      || typeof offer.availability !== 'function' || typeof offer.choose !== 'function') return;
    if (current?.offer.instanceId === offer.instanceId) return;
    withdraw(); abort = new AbortController(); current = { offer, signal: abort.signal };
  });
  const onWithdraw = bus?.on(COMPUTER_WITHDRAW, value => {
    if (value?.version === 1 && value.provider === 'jev-optimizer' && value.instanceId === current?.offer.instanceId) withdraw();
  });
  bus?.emit(COMPUTER_DISCOVER);
  return {
    current: () => current,
    dispose() { closed = true; withdraw(); if (typeof onProvide === 'function') onProvide(); if (typeof onWithdraw === 'function') onWithdraw(); },
  };
}

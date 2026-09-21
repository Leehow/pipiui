// Browser-side Choice consumer. The Jev extension owns credentials and decisions;
// this module alone coordinates the existing, guarded browser executor.
export type Operation = 'CLICK' | 'TYPE_TEXT' | 'SELECT' | 'SCROLL_UP' | 'SCROLL_DOWN' | 'WAIT' | 'DONE' | 'BLOCKED';
export type ChoiceCandidate = { id: string; role: string; name: string; operations: Array<'CLICK' | 'TYPE_TEXT' | 'SELECT'>; options?: Array<{ id: string; label: string }> };
type Decision = { operation: Operation; candidateId?: string; optionId?: string };
type Outcome = { status: 'applied' | 'skipped' | 'fallback'; reason?: string; decision?: Decision; inputTokens?: number; model?: string };
type Offer = {
  version: 1; provider: 'jev-optimizer'; instanceId: string;
  availability(root: string, signal?: AbortSignal): Promise<{ ready: boolean; reason?: string }>;
  choose(input: { projectRoot: string; goal: string; candidates: ChoiceCandidate[]; scroll: { canUp: boolean; canDown: boolean }; history?: Array<{ operation: string; candidateName?: string }>; signal?: AbortSignal }): Promise<Outcome>;
};
type Bus = { on(channel: string, listener: (value: unknown) => void): (() => void) | void; emit(channel: string, value: unknown): void };
type Connected = { offer: Offer; signal: AbortSignal };
export type BrowserChoiceConnection = { current(): Connected | undefined; dispose(): void };
const PROVIDE = 'pipiui.browser-choice.provide.v1';
const WITHDRAW = 'pipiui.browser-choice.withdraw.v1';
const DISCOVER = 'pipiui.browser-choice.discover.v1';
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const reason = (v: unknown, fallback: string) => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(v) ? v : fallback;

export function connectBrowserChoice(bus?: Bus): BrowserChoiceConnection {
  let active: Connected | undefined;
  let lifetime: AbortController | undefined;
  let disposed = false;
  const retired = new Set<string>();
  const unsubs: Array<(() => void) | void> = [];
  const retire = () => { if (active) retired.add(active.offer.instanceId); lifetime?.abort(); active = undefined; };
  if (bus) {
    unsubs.push(bus.on(PROVIDE, raw => {
      if (disposed || !record(raw) || raw.version !== 1 || raw.provider !== 'jev-optimizer'
        || typeof raw.instanceId !== 'string' || !raw.instanceId || retired.has(raw.instanceId)
        || typeof raw.availability !== 'function' || typeof raw.choose !== 'function') return;
      if (active?.offer.instanceId === raw.instanceId) return;
      retire(); lifetime = new AbortController(); active = { offer: raw as Offer, signal: lifetime.signal };
    }));
    unsubs.push(bus.on(WITHDRAW, raw => {
      if (!record(raw) || raw.version !== 1 || raw.provider !== 'jev-optimizer' || typeof raw.instanceId !== 'string') return;
      retired.add(raw.instanceId); if (active?.offer.instanceId === raw.instanceId) retire();
    }));
    bus.emit(DISCOVER, { version: 1 });
  }
  return { current: () => active, dispose() { disposed = true; retire(); for (const off of unsubs) off?.(); retired.clear(); } };
}

export type GoalTextRequest = { goal: string; field: { role: string; name: string }; signal: AbortSignal };
export type GoalTextResult = { text: string; usage?: { inputTokens: number; outputTokens: number } };
export type GoalDependencies = {
  projectRoot: string;
  connection?: BrowserChoiceConnection;
  signal?: AbortSignal;
  bridge(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
  generateText?: (input: GoalTextRequest) => Promise<string | GoalTextResult>;
};
type GoalStatus = 'invalid_request' | 'fallback' | 'aborted' | 'blocked' | 'budget_exhausted' | 'needs_verification';
type Step = { operation: Operation; candidateId?: string; outcome: string };

// Copy only the public action contract, never a node token, guard, value, URL or locator.
function candidatesFrom(raw: unknown): ChoiceCandidate[] | undefined {
  if (!Array.isArray(raw) || raw.length > 64) return;
  const ids = new Set<string>(); const candidates: ChoiceCandidate[] = [];
  for (const item of raw) {
    if (!record(item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(item.id) || ids.has(item.id)
      || typeof item.name !== 'string' || typeof item.role !== 'string' || !Array.isArray(item.operations)
      || item.operations.length > 3 || new Set(item.operations).size !== item.operations.length
      || item.operations.some((op: unknown) => !['CLICK', 'TYPE_TEXT', 'SELECT'].includes(String(op)))) return;
    ids.add(item.id);
    let options: ChoiceCandidate['options'];
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length > 255) return;
      const seen = new Set<string>(); options = [];
      for (const option of item.options) {
        if (!record(option) || typeof option.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(option.id)
          || seen.has(option.id) || typeof option.label !== 'string') return;
        seen.add(option.id); options.push({ id: option.id, label: option.label });
      }
    }
    candidates.push({ id: item.id, role: item.role, name: item.name, operations: [...item.operations], ...(options ? { options } : {}) });
  }
  return candidates;
}

function validDecision(value: unknown, candidates: ChoiceCandidate[], scroll: { canUp: boolean; canDown: boolean }): value is Decision {
  if (!record(value)) return false;
  const op = value.operation;
  if (['WAIT', 'DONE', 'BLOCKED', 'SCROLL_UP', 'SCROLL_DOWN'].includes(op)) {
    return value.candidateId === undefined && value.optionId === undefined
      && (op !== 'SCROLL_UP' || scroll.canUp) && (op !== 'SCROLL_DOWN' || scroll.canDown);
  }
  if (!['CLICK', 'TYPE_TEXT', 'SELECT'].includes(op)) return false;
  const candidate = candidates.find(item => item.id === value.candidateId);
  return !!candidate?.operations.includes(op) && (op === 'SELECT'
    ? !!candidate.options?.some(option => option.id === value.optionId) : value.optionId === undefined);
}

/** One explicit tool call, many bounded Choice decisions. DONE is never proof of success. */
export async function runBrowserGoal(params: Record<string, any>, deps: GoalDependencies): Promise<Record<string, any>> {
  const steps: Step[] = []; const history: Array<{ operation: string; candidateName?: string }> = [];
  const started = Date.now(); let decisions = 0; let inputTokens = 0;
  let observationsTruncated = false;
  let textModelCalls = 0; let textUsageResponses = 0; let textInputTokens = 0; let textOutputTokens = 0;
  const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;
  const result = (status: GoalStatus, code: string, observation?: unknown) => {
    const out: Record<string, any> = { ok: status === 'needs_verification', action: 'goal', status, code, verified: false,
      steps, decisions, inputTokens, textModelCalls, observationsTruncated,
      textModelUsage: { reportedResponses: textUsageResponses, inputTokens: textInputTokens, outputTokens: textOutputTokens },
      elapsedMs: Date.now() - started,
      requiresObservation: true, ...(observation ? { observation } : {}) };
    if (JSON.stringify(out).length > 20_000) { delete out.observation; out.observationOmitted = 'output-budget'; }
    return out;
  };
  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  const maxSteps = params.max_steps ?? 12; const timeoutSecs = params.timeoutSecs ?? 30;
  if (!goal || Array.from(goal).length > 512 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30
    || typeof timeoutSecs !== 'number' || !Number.isFinite(timeoutSecs) || timeoutSecs < 1 || timeoutSecs > 60
    || (params.target !== undefined && !['active', 'desktop', 'mobile'].includes(params.target))) return result('invalid_request', 'invalid-goal-request');
  if (deps.signal?.aborted) return result('aborted', 'aborted');
  const connected = deps.connection?.current();
  if (!connected) return result('fallback', 'jev-choice-unavailable');
  const ac = new AbortController(); let timedOut = false;
  const abort = () => ac.abort();
  deps.signal?.addEventListener('abort', abort, { once: true });
  connected.signal.addEventListener('abort', abort, { once: true });
  if (deps.signal?.aborted || connected.signal.aborted) ac.abort();
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutSecs * 1000);
  const stopped = new Promise<never>((_, reject) => {
    if (ac.signal.aborted) { reject(new Error('stopped')); return; }
    ac.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
  });
  void stopped.catch(() => {});
  const check = () => { if (ac.signal.aborted || deps.connection?.current()?.offer !== connected.offer) throw new Error('stopped'); };
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => { check(); const value = await Promise.race([work(), stopped]); check(); return value; };
  let target = params.target ?? 'active';
  const browser = (action: string, data: Record<string, unknown> = {}) => bounded(() => deps.bridge(action, { ...data, target }, ac.signal));
  const finish = async (status: GoalStatus, code: string) => {
    try { return result(status, code, await browser('observe')); }
    catch { return result(ac.signal.aborted ? (timedOut ? 'budget_exhausted' : 'aborted') : status, ac.signal.aborted ? (timedOut ? 'time-budget' : 'aborted') : code); }
  };
  let staleRetries = 0;
  try {
    for (let i = 0; i < maxSteps; i++) {
      const ready = await bounded(() => connected.offer.availability(deps.projectRoot, ac.signal));
      if (!ready.ready) return result('fallback', reason(ready.reason, 'jev-choice-unavailable'));
      const prepared = await browser('prepare_choice_observation', { intent: goal });
      if (!prepared?.ok) return result(prepared?.requiresUserInput ? 'blocked' : 'fallback', reason(prepared?.code, 'choice-observation-failed'));
      if (prepared.viewportTarget === 'desktop' || prepared.viewportTarget === 'mobile') {
        if (target === 'active') target = prepared.viewportTarget;
        else if (target !== prepared.viewportTarget) return result('fallback', 'choice-target-changed');
      }
      observationsTruncated ||= prepared.truncated === true;
      const candidates = candidatesFrom(prepared.candidates);
      if (!candidates || typeof prepared.snapshotID !== 'string' || !prepared.snapshotID
        || typeof prepared.choiceGuard !== 'string' || !prepared.choiceGuard
        || typeof prepared.goal !== 'string' || !prepared.goal.trim()) return result('fallback', 'invalid-choice-observation');
      const scroll = { canUp: prepared.scroll?.canUp === true, canDown: prepared.scroll?.canDown === true };
      const selected = await bounded(() => connected.offer.choose({ projectRoot: deps.projectRoot, goal: prepared.goal,
        candidates, scroll, history: history.slice(-10), signal: ac.signal }));
      decisions++;
      if (validCount(selected.inputTokens)) inputTokens += selected.inputTokens;
      if (selected.status !== 'applied') return result('fallback', reason(selected.reason, 'choice-failed'));
      if (!validDecision(selected.decision, candidates, scroll)) return result('fallback', 'invalid-choice-decision');
      const d = selected.decision;
      if (d.operation === 'DONE') return await finish('needs_verification', 'jev-done-unverified');
      if (d.operation === 'BLOCKED') return await finish('blocked', 'jev-blocked');
      if (d.operation === 'WAIT') {
        await bounded(() => new Promise<void>(resolve => {
          const done = () => { clearTimeout(wait); ac.signal.removeEventListener('abort', done); resolve(); };
          const wait = setTimeout(done, 200);
          ac.signal.addEventListener('abort', done, { once: true });
        }));
        steps.push({ operation: 'WAIT', outcome: 'waited' }); history.push({ operation: 'WAIT' }); continue;
      }
      const candidate = candidates.find(item => item.id === d.candidateId);
      // Delegate consequential submissions to the main agent/user instead of a fast local loop.
      if (candidate && /\b(delete|purchase|pay|send|publish|confirm order)\b|删除|付款|支付|购买|发送|发布|确认订单/i.test(candidate.name)) return await finish('blocked', 'consequential-action-handoff');
      let text: string | undefined;
      if (d.operation === 'TYPE_TEXT') {
        if (!deps.generateText) return await finish('fallback', 'text-model-unavailable');
        textModelCalls++;
        const generated = await bounded(() => deps.generateText!({ goal, field: { role: candidate!.role, name: candidate!.name }, signal: ac.signal }));
        text = typeof generated === 'string' ? generated : generated?.text;
        if (record(generated) && validCount(generated.usage?.inputTokens) && validCount(generated.usage?.outputTokens)) {
          textUsageResponses++; textInputTokens += generated.usage.inputTokens; textOutputTokens += generated.usage.outputTokens;
        }
        if (typeof text !== 'string' || text.length > 2000 || /\u0000/.test(text)) return result('fallback', 'invalid-generated-text');
      }
      // Text generation may take time. Recheck authorization immediately before execution.
      const before = await bounded(() => connected.offer.availability(deps.projectRoot, ac.signal));
      if (!before.ready) return result('fallback', reason(before.reason, 'jev-choice-unavailable'));
      const executed = await browser('execute_choice', { snapshot_id: prepared.snapshotID, choice_guard: prepared.choiceGuard,
        operation: d.operation, ...(d.candidateId ? { candidate_id: d.candidateId } : {}),
        ...(d.optionId ? { option_id: d.optionId } : {}), ...(text !== undefined ? { text } : {}) });
      if (!executed?.ok) {
        const code = reason(executed?.code, 'choice-execution-failed');
        steps.push({ operation: d.operation, ...(d.candidateId ? { candidateId: d.candidateId } : {}), outcome: code });
        if (['stale_browser_snapshot', 'browser_observation_changed', 'stale_choice_snapshot'].includes(code) && staleRetries++ < 2) continue;
        return result(executed?.requiresUserInput ? 'blocked' : 'fallback', code);
      }
      staleRetries = 0;
      history.push({ operation: d.operation, ...(candidate ? { candidateName: candidate.name } : {}) });
      steps.push({ operation: d.operation, ...(d.candidateId ? { candidateId: d.candidateId } : {}), outcome: 'executed' });
      if (executed.requiresUserInput) return await finish('blocked', 'user-handoff-required');
    }
    return await finish('budget_exhausted', 'step-budget');
  } catch {
    return result(ac.signal.aborted ? (timedOut ? 'budget_exhausted' : 'aborted') : 'fallback', ac.signal.aborted ? (timedOut ? 'time-budget' : 'aborted') : 'choice-loop-failed');
  } finally {
    clearTimeout(timer); deps.signal?.removeEventListener('abort', abort); connected.signal.removeEventListener('abort', abort); ac.abort();
  }
}

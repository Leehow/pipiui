import type { ComputerChoiceConnection } from './computer-choice.js';
import { GoalIndex, observationRedactions, record, semanticFingerprint, type AxRecord } from './computer-goal-candidates.js';
export type GoalInput = { id: string; label: string; value: string };
export type GoalParams = { action: 'goal'; goal: string; inputs?: GoalInput[]; max_steps?: number; timeoutSecs?: number };
export type GoalDependencies = {
  projectRoot: string; connection: ComputerChoiceConnection; signal?: AbortSignal;
  request(action: string, params: AxRecord, signal?: AbortSignal): Promise<AxRecord>;
};
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
export function validGoalParams(params: unknown): params is GoalParams {
  if (!record(params) || params.action !== 'goal' || Object.keys(params).some(key => !['action', 'goal', 'inputs', 'max_steps', 'timeoutSecs'].includes(key))) return false;
  if (typeof params.goal !== 'string' || !params.goal.trim() || Array.from(params.goal.trim()).length > 512) return false;
  if (!Number.isInteger(params.max_steps ?? 12) || (params.max_steps ?? 12) < 1 || (params.max_steps ?? 12) > 30) return false;
  if (!Number.isFinite(params.timeoutSecs ?? 30) || (params.timeoutSecs ?? 30) < 1 || (params.timeoutSecs ?? 30) > 60) return false;
  if (params.inputs === undefined) return true;
  if (!Array.isArray(params.inputs) || params.inputs.length > 16) return false;
  const ids = new Set<string>(); let total = 0;
  for (const input of params.inputs) {
    if (!record(input) || Object.keys(input).some(key => !['id', 'label', 'value'].includes(key))
      || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.id) || ids.has(input.id)
      || typeof input.label !== 'string' || !input.label.trim() || Array.from(input.label).length > 128
      || typeof input.value !== 'string' || bytes(input.value) > 8192) return false;
    ids.add(input.id); total += bytes(input.value);
  }
  return total <= 32768;
}
class Stop extends Error { constructor(readonly code: string) { super(code); } }
const failureCode = (value: AxRecord) => typeof value.runtimeError?.code === 'string' ? value.runtimeError.code
  : typeof value.interruptionReason === 'string' ? value.interruptionReason : 'driver_failed';

/** No free-form generation and no private input values in the returned trace. */
export async function runComputerGoal(params: unknown, deps: GoalDependencies): Promise<AxRecord> {
  const began = Date.now(); let decisions = 0, completedActions = 0, inputTokens = 0, usageResponses = 0;
  let observeMs = 0, decisionMs = 0, executeMs = 0, indexMs = 0;
  let observation: AxRecord | undefined, coverage: AxRecord | undefined;
  const history: Array<{ operation: string; outcome: string }> = [];
  const result = (status: string, reason: string): AxRecord => ({ action: 'goal', status, reason, verified: false,
    requiresObservation: true, decisions, completedActions, history: history.map(item => ({ ...item })), coverage,
    outcomeUnknown: history.some(item => item.outcome === 'outcome_unknown'),
    doNotReplay: history.some(item => item.outcome === 'outcome_unknown'),
    usage: { inputTokens, reportedResponses: usageResponses },
    timings: { elapsedMs: Date.now() - began, observeMs, decisionMs, executeMs, indexMs },
    ...(observation ? { observation } : {}) });
  if (!validGoalParams(params)) return result('invalid_request', 'invalid_goal_request');
  const connected = deps.connection.current();
  if (!connected) return result('unavailable', 'no_provider');
  const controller = new AbortController(); let deadline = false;
  const abort = () => controller.abort();
  deps.signal?.addEventListener('abort', abort, { once: true });
  connected.signal.addEventListener('abort', abort, { once: true });
  if (deps.signal?.aborted || connected.signal.aborted) controller.abort();
  const timer = setTimeout(() => { deadline = true; controller.abort(); }, (params.timeoutSecs ?? 30) * 1000);
  const stopped = new Promise<never>((_, reject) => {
    const stop = () => reject(new Stop(deadline ? 'time_budget' : 'aborted'));
    if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
  });
  void stopped.catch(() => {});
  const bounded = <T>(work: Promise<T>) => Promise.race([work, stopped]);
  let generation: string | undefined, lease: string | undefined, stale = 0, noProgress = 0;
  let pendingMutation: { operation: string; outcome: string } | undefined;
  const index = new GoalIndex(params.inputs);
  const knownValues = new Set<string>(); let knownValueBytes = 0;
  const rememberValue = (value: string) => {
    if (!value || knownValues.has(value)) return;
    const size = bytes(value);
    if (knownValues.size >= 2048 || size > 65536 - knownValueBytes) throw new Stop('redaction_budget');
    knownValues.add(value); knownValueBytes += size;
  };
  const rememberObservation = (current: AxRecord) => { for (const value of observationRedactions(current)) rememberValue(value); };
  const authorize = async () => {
    if (controller.signal.aborted) throw new Stop(deadline ? 'time_budget' : 'aborted');
    if (deps.connection.current()?.offer !== connected.offer) throw new Stop('provider_withdrawn');
    const ready = await bounded(connected.offer.availability(deps.projectRoot, controller.signal));
    if (!ready.ready || !ready.generation) throw new Stop(ready.reason ?? 'computer_disabled');
    if (generation && ready.generation !== generation) throw new Stop('computer_generation_changed');
    generation = ready.generation;
  };
  const request = async (action: string, extra: AxRecord, onDispatch?: () => void) => {
    await authorize();
    onDispatch?.();
    return bounded(deps.request(action, { ...extra, goalGeneration: generation, ...(lease ? { goalLease: lease } : {}) }, controller.signal));
  };
  const refresh = async () => {
    const started = Date.now();
    const next = await request('computer_batch', { actions: [{ type: 'screenshot' }] });
    observeMs += Date.now() - started;
    if (!next.ok || next.batchOK === false || !record(next.target)) throw new Stop(failureCode(next));
    observation = next;
  };
  try {
    for (const input of params.inputs ?? []) rememberValue(input.value);
    const started = Date.now();
    const opened = await request('computer_goal_begin', { timeoutSecs: params.timeoutSecs ?? 30 });
    observeMs += Date.now() - started;
    if (!opened.ok) return result('handoff', failureCode(opened));
    if (typeof opened.goalLease !== 'string' || !record(opened.target)) throw new Stop('invalid_goal_lease');
    lease = opened.goalLease; observation = opened;
    const pinnedPid = opened.target.pid;
    for (; decisions < (params.max_steps ?? 12);) {
      await authorize();
      if (observation?.target?.pid !== pinnedPid) { observation = undefined; return result('handoff', 'target_handoff_untrusted'); }
      rememberObservation(observation!);
      const indexStarted = Date.now(), built = index.build(observation!, params.goal);
      indexMs += Date.now() - indexStarted; coverage = built.coverage;
      if (built.discovered) noProgress = 0;
      const before = semanticFingerprint(observation!);
      const redactions = [...knownValues];
      const choosing = Date.now(); decisions++;
      const choice = await bounded(connected.offer.choose({ projectRoot: deps.projectRoot, goal: params.goal.trim(),
        candidates: built.operations.map(({ id, description }) => ({ id, description })),
        history: history.slice(-12), coverage: built.coverage, redactions, signal: controller.signal }));
      decisionMs += Date.now() - choosing;
      if (typeof choice.inputTokens === 'number' && Number.isFinite(choice.inputTokens) && choice.inputTokens >= 0) { inputTokens += choice.inputTokens; usageResponses++; }
      await authorize();
      if (choice.status !== 'applied') return result('handoff', choice.reason ?? 'invalid_decision');
      const operation = built.operations.find(item => item.id === choice.candidateId);
      if (!operation) return result('handoff', 'invalid_decision');
      if (operation.kind === 'finish') return result('needs_verification', 'controller_done');
      if (operation.kind === 'handoff') return result('handoff', built.coverage.truncated ? 'coverage_incomplete' : 'controller_handoff');
      if (operation.kind === 'bind') { index.bind(operation); history.push({ operation: 'bind', outcome: 'local' }); continue; }
      if (operation.kind === 'inspect') { index.navigate(operation); history.push({ operation: 'inspect', outcome: 'local' }); continue; }
      if (operation.kind === 'refresh') { await refresh(); history.push({ operation: 'refresh', outcome: 'ok' }); continue; }
      const executing = Date.now();
      const executed = await request('computer_batch', { actions: operation.actions }, () => {
        if (operation.actions?.some(action => !['screenshot', 'wait'].includes(action.type))) {
          pendingMutation = { operation: operation.kind, outcome: 'submitted' }; history.push(pendingMutation);
        }
      });
      executeMs += Date.now() - executing;
      completedActions += typeof executed.completedActions === 'number' ? executed.completedActions
        : Array.isArray(executed.outcomes) ? executed.outcomes.filter((outcome: AxRecord) => outcome.status === 'ok').length : 0;
      rememberObservation(executed);
      if (!executed.ok || executed.batchOK === false) {
        const code = failureCode(executed);
        if (pendingMutation) pendingMutation.outcome = code === 'mutation_outcome_unknown' ? 'outcome_unknown' : code;
        else history.push({ operation: operation.kind, outcome: code });
        pendingMutation = undefined;
        observation = undefined; // An old screenshot must not stand in for an unknown outcome.
        if (code === 'actionable_context_changed') { await refresh(); continue; }
        if (['stale_snapshot', 'snapshot_changed'].includes(code) && stale++ < 2) { await refresh(); continue; }
        return result('handoff', code);
      }
      if (!record(executed.target) || !record(executed.accessibility)) throw new Stop('observation_missing');
      observation = executed;
      if (operation.kind === 'input') {
        const outcome = index.inputOutcome(operation, observation);
        if (outcome !== 'matched') {
          if (pendingMutation) pendingMutation.outcome = outcome === 'unverified' ? 'outcome_unknown' : 'input_value_mismatch';
          pendingMutation = undefined;
          return result('handoff', outcome === 'unverified' ? 'input_value_unavailable' : 'input_value_mismatch');
        }
        index.applied(operation);
      }
      if (pendingMutation) pendingMutation.outcome = 'ok'; else history.push({ operation: operation.kind, outcome: 'ok' });
      pendingMutation = undefined;
      noProgress = semanticFingerprint(observation) === before ? noProgress + 1 : 0;
      if (noProgress >= 2) return result('handoff', 'no_progress');
    }
    return result('budget_exhausted', 'step_budget');
  } catch (error) {
    if (pendingMutation) { pendingMutation.outcome = 'outcome_unknown'; observation = undefined; }
    const reason = controller.signal.aborted ? deadline ? 'time_budget' : 'aborted' : error instanceof Stop ? error.code : 'bridge_failed';
    if (reason === 'bridge_failed' || reason === 'aborted' || reason === 'time_budget') observation = undefined;
    return result(reason === 'time_budget' ? 'budget_exhausted' : reason === 'aborted' ? 'aborted' : 'handoff', reason);
  } finally {
    clearTimeout(timer); deps.signal?.removeEventListener('abort', abort); connected.signal.removeEventListener('abort', abort); controller.abort();
    if (lease) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          deps.request('computer_goal_end', { goalLease: lease }, AbortSignal.timeout(1000)).catch(() => {}),
          new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 1000); }),
        ]);
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
      // Cleanup cannot renew the goal budget; the host lease also expires.
    }
  }
}

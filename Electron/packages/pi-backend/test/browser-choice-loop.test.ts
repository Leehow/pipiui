import { describe, it, expect } from 'vitest';
import { runBrowserGoal, connectBrowserChoice } from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-choice-loop.ts';

const candidate = { id: 'field-1', role: 'textbox', name: 'Destination', operations: ['TYPE_TEXT'], token: 'private-token' };
function fixture(decisions: any[], extra: any = {}) {
  const calls: any[] = []; let step = 0;
  const offer: any = {
    version: 1, provider: 'jev-optimizer', instanceId: 'test-provider',
    availability: async () => ({ ready: true }),
    choose: async (input: any) => { calls.push(['choose', input]); return { status: 'applied', decision: decisions[step++] }; },
    ...extra.offer,
  };
  const life = new AbortController();
  const connection: any = { current: () => ({ offer, signal: life.signal }), dispose() { life.abort(); } };
  const bridge = async (action: string, params: any, signal?: AbortSignal) => {
    calls.push([action, params]);
    if (signal?.aborted) throw new Error('aborted');
    if (action === 'prepare_choice_observation') return { ok: true, snapshotID: 'snapshot-1', choiceGuard: 'private-guard', goal: 'Find Paris', candidates: [candidate], scroll: { canUp: false, canDown: true } };
    if (action === 'observe') return { ok: true, title: 'Results', elements: [] };
    return { ok: true };
  };
  return { calls, connection, bridge, life, ...extra };
}

describe('Jev browser goal loop', () => {
  it('runs TYPE_TEXT and DONE without another main-agent action, but never claims verified completion', async () => {
    const f = fixture([{ operation: 'TYPE_TEXT', candidateId: 'field-1' }, { operation: 'DONE' }]);
    const r = await runBrowserGoal({ goal: 'Find Paris' }, { ...f, projectRoot: '/project', generateText: async () => 'Paris' });
    expect(r.status).toBe('needs_verification');
    expect(r.verified).toBe(false);
    const executed = f.calls.filter(c => c[0] === 'execute_choice');
    expect(executed).toHaveLength(1);
    expect(executed[0][1]).toMatchObject({ operation: 'TYPE_TEXT', candidate_id: 'field-1', text: 'Paris', snapshot_id: 'snapshot-1', choice_guard: 'private-guard' });
    const input = f.calls.find(c => c[0] === 'choose')[1];
    expect(JSON.stringify(input)).not.toContain('private-token');
    expect(JSON.stringify(input)).not.toContain('private-guard');
    expect(JSON.stringify(r)).not.toContain('Paris'); // no generated field text in history
  });
  it('requires the extension provider; never substitutes local guesses', async () => {
    let calls = 0;
    const r = await runBrowserGoal({ goal: 'Click next' }, { projectRoot: '/p', bridge: async () => { calls++; return {}; } });
    expect(r.status).toBe('fallback'); expect(calls).toBe(0);
  });
  it('rejects an unobserved target and mismatched operation', async () => {
    for (const decision of [{ operation: 'CLICK', candidateId: 'field-1' }, { operation: 'TYPE_TEXT', candidateId: 'invented' }]) {
      const f = fixture([decision]);
      const r = await runBrowserGoal({ goal: 'Find Paris' }, { ...f, projectRoot: '/p' });
      expect(r.status).toBe('fallback');
      expect(f.calls.some(c => c[0] === 'execute_choice')).toBe(false);
    }
  });
  it('does not execute after withdrawal while text generation is pending', async () => {
    const f = fixture([{ operation: 'TYPE_TEXT', candidateId: 'field-1' }]);
    const r = await runBrowserGoal({ goal: 'Find Paris' }, { ...f, projectRoot: '/p', generateText: async () => { f.life.abort(); return 'Paris'; } });
    expect(r.status).toBe('aborted');
    expect(f.calls.some(c => c[0] === 'execute_choice')).toBe(false);
  });
  it('limits decisions and reports a partial run rather than success', async () => {
    const f = fixture([{ operation: 'WAIT' }, { operation: 'WAIT' }]);
    const r = await runBrowserGoal({ goal: 'Wait for results', max_steps: 1 }, { ...f, projectRoot: '/p' });
    expect(r.status).toBe('budget_exhausted'); expect(r.verified).toBe(false);
    expect(f.calls.filter(c => c[0] === 'choose')).toHaveLength(1);
  });
  it('rejects both and malformed limits before any provider or browser request', async () => {
    for (const params of [{ target: 'both' }, { max_steps: 0 }, { max_steps: 31 }, { timeoutSecs: NaN }]) {
      const f = fixture([]);
      const r = await runBrowserGoal({ goal: 'Find Paris', ...params }, { ...f, projectRoot: '/p' });
      expect(r.status).toBe('invalid_request'); expect(f.calls).toHaveLength(0);
    }
  });
  it('bounds a provider that ignores cancellation', async () => {
    const f = fixture([], { offer: { availability: () => new Promise(() => {}) } });
    const abort = new AbortController();
    const promise = runBrowserGoal({ goal: 'Find Paris' }, { ...f, projectRoot: '/p', signal: abort.signal });
    abort.abort();
    expect((await promise).status).toBe('aborted'); expect(f.calls).toHaveLength(0);
  });
  it('never accepts a withdrawn provider instance on rediscovery', () => {
    const handlers = new Map<string, Function>();
    const conn = connectBrowserChoice({ on: (name: string, cb: Function) => { handlers.set(name, cb); }, emit() {} } as any);
    const f = fixture([]); const offer = f.connection.current().offer;
    handlers.get('pipiui.browser-choice.provide.v1')!(offer);
    const original = conn.current()!;
    handlers.get('pipiui.browser-choice.withdraw.v1')!({ version: 1, provider: 'jev-optimizer', instanceId: offer.instanceId });
    handlers.get('pipiui.browser-choice.provide.v1')!(offer);
    expect(original.signal.aborted).toBe(true); expect(conn.current()).toBeUndefined(); conn.dispose();
  });
});

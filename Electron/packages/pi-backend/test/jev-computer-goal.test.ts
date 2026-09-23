import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CuaDriverHost } from '../../../apps/electron/src/main/cua-driver-host.js';
import { HostCapabilityBroker } from '../src/host-capability.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const roots: string[] = [];
import { validGoalParams } from '../../../resources/runtime/extensions/cua-extension/agent/computer-goal.js';
import { createAxScenarioSession, AX_FIXTURE_PID, AX_FIXTURE_WINDOW_ID, type AxScenarioSession } from './fixtures/jev-computer-scenarios.js';
const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../resources/runtime/extensions/cua-extension/agent/host-capability-client.js', () => ({
  createNativeCuaClient: () => ({ call: transport.call }),
}));
const provide = 'pipiui.computer-choice.provide.v1';
const discover = 'pipiui.computer-choice.discover.v1';
const withdraw = 'pipiui.computer-choice.withdraw.v1';

async function fixture(options: { ready?: boolean; executionEnabled?: boolean; pinned?: boolean; noChange?: boolean; realProvider?: boolean;
  choose?: (input: any) => any; elements?: (revision: number) => any[]; focused?: () => number | undefined;
  onAction?: (name: string, args: any) => void; driverSession?: AxScenarioSession } = {}) {
  const host: any = new CuaDriverHost('/fake/cua-driver', { displayID: 1, width: 800, height: 600 });
  host.usable = () => true;
  if (options.pinned !== false) host.targets.set('test-goal', { session: 'test-goal',
    pid: options.driverSession ? AX_FIXTURE_PID : 42, window_id: options.driverSession ? AX_FIXTURE_WINDOW_ID : 77 });
  const calls: Array<{ name: string; args: any }> = [];
  let revision = 1, selected = false, generation = 'desktop-generation', enabled = options.ready !== false;
  let executionEnabled = options.executionEnabled !== false;
  const projectRoot = mkdtempSync(join(tmpdir(), 'jev-ax-goal-')); roots.push(projectRoot);
  const stateFile = join(projectRoot, '.pi', 'agent', 'jev-optimizer', 'runtime-state.json');
  mkdirSync(join(projectRoot, '.pi', 'agent', 'jev-optimizer'), { recursive: true });
  const saveState = () => writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true,
    generation: 'base-generation', computerEnabled: enabled, computerGeneration: generation, computerUseEnabled: executionEnabled, browserEnabled: false }));
  saveState();
  const controls: { beforeRequest?: (request: any) => Promise<void>; beforeObserve?: () => Promise<void> } = {};
  host.ensureStarted = async () => {};
  let fixtureFocus: number | undefined;
  host.invoke = async (name: string, args: any) => {
    calls.push({ name, args });
    if (options.driverSession) {
      const session = options.driverSession;
      if (name === 'check_permissions') return { structuredContent: {} };
      // The baseline state machine owns task truth; this adapter models only
      // OS focus/select-all, which its direct-driver replay does not need.
      const field = session.publicElements().find(node => node.element_token === args.element_token);
      if (name === 'click' && field && /TextField|SearchField|TextArea/.test(field.role) && !field.secure
        && args.snapshot_id === session.snapshotId()) { fixtureFocus = field.element_index; return { structuredContent: {} }; }
      if (name === 'hotkey' && args.keys?.join('+') === 'CMD+A' && fixtureFocus !== undefined) return { structuredContent: {} };
      const result = await session.call(name, args);
      if (result.isError) throw Object.assign(new Error(String(result.structuredContent.code ?? 'fixture_error')), { code: result.structuredContent.code });
      return name === 'get_window_state' ? { ...result, structuredContent: { ...result.structuredContent,
        ...(fixtureFocus !== undefined ? { focused_element_index: fixtureFocus } : {}) } } : result;
    }
    if (name === 'get_window_state') { await controls.beforeObserve?.(); return { structuredContent: { pid: 42, window_id: 77,
      screenshot_png_b64: 'UE5H', focused_window_id: 77, snapshot_id: `snapshot-${revision}`,
      ...(options.focused ? { focused_element_index: options.focused() } : {}),
      elements: options.elements?.(revision) ?? [{ element_index: 1, element_token: `snapshot-${revision}:1`, role: 'AXCheckbox', label: 'Enable notifications', value: selected ? 'on' : 'off' }] } }; }
    if (name === 'click' && !options.noChange) { revision++; selected = true; }
    options.onAction?.(name, args);
    return { structuredContent: {} };
  };
  const broker = new HostCapabilityBroker({ drivers: { native: host }, policy: {
    declaredPermissions: () => ['native.exec'], projectAllows: (_id, root) => root === projectRoot,
    verifyDesktopGrant: ({ computerCapability }) => computerCapability === 'synthetic',
  } });
  transport.call.mockImplementation(async (request: any) => {
    await controls.beforeRequest?.(request);
    const issued = broker.issueToken({ extensionId: 'cua-extension', projectRoot, permission: 'native.exec' });
    const response: any = await broker.dispatch({ schemaVersion: 1, extensionId: 'cua-extension', hostApi: '>=1.0.0 <2.0.0',
      permission: 'native.exec', op: 'native.cua', projectRoot, token: issued.token,
      params: { ...request, goalProjectRoot: '/spoofed/project', sessionKey: 'test-goal', computerCapability: 'synthetic' } }, 'test-goal');
    if (!response.ok) throw new Error(response.error);
    return response.result;
  });
  const handlers = new Map<string, Set<(value: any) => any>>();
  const events = {
    on(channel: string, handler: (value: any) => any) { const set = handlers.get(channel) ?? new Set(); set.add(handler); handlers.set(channel, set); return () => set.delete(handler); },
    emit(channel: string, value?: any) { for (const handler of [...(handlers.get(channel) ?? [])]) handler(value); },
  };
  const choose = vi.fn(async (input: any) => options.choose ? options.choose(input)
    : { status: 'applied', candidateId: selected ? 'finish' : input.candidates.find((value: any) => value.description.includes('Enable notifications')).id, inputTokens: 42 });
  const offer = { version: 1, provider: 'jev-optimizer', instanceId: 'test-provider',
    availability: vi.fn(async () => ({ ready: enabled, reason: !enabled ? 'computer-disabled' : undefined, generation })), choose };
  const http = vi.fn(async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    const out = await choose(body.state);
    return new Response(JSON.stringify({ model: 'jev-test', answers: { action: { type: 'choice', choice: out.candidateId,
      confidence: 1, probabilities: Object.fromEntries(body.state.candidates.map((candidate: any) => [candidate.id, candidate.id === out.candidateId ? 1 : 0])) } }, usage: { input_tokens: 42 } }));
  });
  if (options.realProvider) {
    const { createJevOptimizer } = await import('../../../resources/runtime/extensions/jev-optimizer/agent/index.js');
    createJevOptimizer({ events }, { fetch: http, env: { EXT_JEV_OPTIMIZER_APIKEY: 'synthetic-jev-secret',
      PIPIUI_JEV_STATE_FILE: stateFile, PIPIUI_JEV_GENERATION: 'base-generation' },
      readState: async () => readFileSync(stateFile, 'utf8') });
  } else events.on(discover, () => events.emit(provide, offer));
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  const module = await import('../../../resources/runtime/extensions/cua-extension/agent/index.js');
  module.default({ events, registerTool(tool: any) { tools.set(tool.name, tool); }, on(name: string, handler: any) { hooks.set(name, handler); } } as any);
  const invoke = (params: any, signal?: AbortSignal) => tools.get('computer').execute('goal-call', params, signal, undefined, { cwd: projectRoot });
  return { host, calls, tools, hooks, events, offer, choose, http, invoke, controls,
    setGeneration(value: string) { generation = value; saveState(); }, setEnabled(value: boolean) { enabled = value; saveState(); },
    setExecutionEnabled(value: boolean) { if (value !== executionEnabled) generation += '-execution'; executionEnabled = value; saveState(); } };
}

beforeEach(() => {
  vi.resetModules(); transport.call.mockReset();
  for (const [key, value] of Object.entries({ PIPIUI_BRIDGE_PORT: '1234', PIPIUI_SESSION_CAPABILITY: 'synthetic',
    PIPIUI_SESSION_KEY: 'test-goal', PIPIUI_COMPUTER_CAPABILITY: 'synthetic', PIPIUI_COMPUTER_DISPLAY_ID: '1',
    PIPIUI_COMPUTER_WIDTH: '800', PIPIUI_COMPUTER_HEIGHT: '600' })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('computer goal validation', () => {
  it('validates standalone goals and exact input bounds before any effects', () => {
    expect(validGoalParams({ action: 'goal', goal: '点击设置' })).toBe(true);
    for (const params of [
      { action: 'goal', goal: 'x', actions: [{ type: 'click' }] },
      { action: 'click', goal: 'x' }, { action: 'goal', goal: ' ' },
      { action: 'goal', goal: 'x', max_steps: 31 }, { action: 'goal', goal: 'x', timeoutSecs: NaN },
      { action: 'goal', goal: 'x', inputs: [{ id: 'text', label: 'Text', value: '界'.repeat(3000) }] },
      { action: 'goal', goal: 'x', inputs: [{ id: 'text', label: 'Text', value: 'a' }, { id: 'text', label: 'Other', value: 'b' }] },
    ]) expect(validGoalParams(params)).toBe(false);
  });
});

describe.skipIf(process.platform !== 'darwin')('registered computer → actual host → fake driver', () => {
  it('executes a visible AX goal and injects only the final screenshot', async () => {
    const f = await fixture();
    const out = await f.invoke({ action: 'goal', goal: 'Enable notifications' });
    expect(out.details.goal).toMatchObject({ status: 'needs_verification', verified: false, decisions: 2, completedActions: 1 });
    expect(f.calls.filter(call => call.name === 'click')).toEqual([{ name: 'click', args: expect.objectContaining({ pid: 42, window_id: 77, element_token: 'snapshot-1:1', snapshot_id: 'snapshot-1' }) }]);
    expect(out.content.filter((block: any) => block.type === 'image')).toHaveLength(1);
    expect(f.host.goalLease).toBeUndefined();
    expect(f.choose.mock.calls[0][0].candidates).toEqual(expect.arrayContaining([expect.objectContaining({ description: 'Click checkbox Enable notifications (value=off)' })]));
    expect(JSON.stringify(f.choose.mock.calls[0][0].candidates)).not.toContain('snapshot-1');
  });
  it('uses the actual optional provider and HTTP contract through the same host seam', async () => {
    const f = await fixture({ realProvider: true });
    const out = await f.invoke({ action: 'goal', goal: 'Enable notifications' });
    expect(out.details.goal).toMatchObject({ status: 'needs_verification', decisions: 2, completedActions: 1 });
    expect(f.http).toHaveBeenCalledTimes(2);
    for (const [, init] of f.http.mock.calls) {
      const wire = init.body;
      expect(wire).not.toContain('snapshot-'); expect(wire).not.toContain('element_token');
      expect(wire).not.toContain('synthetic-jev-secret'); expect(wire).not.toContain('redactions');
    }
  });
  it('disabled cloud and invalid inputs perform no host requests', async () => {
    const f = await fixture({ ready: false });
    const out = await f.invoke({ action: 'goal', goal: 'click' });
    expect(out.details.goal.status).toBe('handoff');
    expect(transport.call).not.toHaveBeenCalled(); expect(f.choose).not.toHaveBeenCalled();
    expect((await f.invoke({ action: 'goal', goal: 'click', keys: ['RETURN'] })).details.goal.status).toBe('invalid_request');
  });
  it('does not observe the desktop when no app was pinned', async () => {
    const f = await fixture({ pinned: false });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal).toMatchObject({ status: 'handoff', reason: 'target_unavailable' });
    expect(f.calls.map(call => call.name)).not.toContain('get_desktop_state');
    expect(f.choose).not.toHaveBeenCalled();
  });
  it('rejects invented choices without executing or leaking the lease', async () => {
    const f = await fixture({ choose: () => ({ status: 'applied', candidateId: 'invented' }) });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal.reason).toBe('invalid_decision');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
    expect(f.host.goalLease).toBeUndefined();
  });
  it('stops on unchanged UI instead of looping indefinitely', async () => {
    const f = await fixture({ noChange: true });
    const out = await f.invoke({ action: 'goal', goal: 'Enable notifications' });
    expect(out.details.goal).toMatchObject({ status: 'handoff', reason: 'no_progress', decisions: 2 });
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(2);
  });
  it('holds a desktop lease without holding the RPC lane while choosing', async () => {
    const f = await fixture();
    f.choose.mockImplementationOnce(async () => {
      const blocked = await f.host.handle({ protocolVersion: 1, sessionKey: 'test-goal', action: 'computer_batch', actions: [{ type: 'click', element_index: 1 }] });
      expect(blocked).toMatchObject({ ok: false, runtimeError: { code: 'desktop_already_active' } });
      const other = await f.host.handle({ protocolVersion: 1, sessionKey: 'other', action: 'computer_open_application', application_name: 'Finder' });
      expect(other.runtimeError.code).toBe('desktop_already_active');
      return { status: 'applied', candidateId: 'finish' };
    });
    expect((await f.invoke({ action: 'goal', goal: 'Observe' })).details.goal.status).toBe('needs_verification');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
  });
  it('does not execute a decision returned after desktop authorization changed', async () => {
    const f = await fixture();
    f.choose.mockImplementationOnce(async (input: any) => { f.setGeneration('replacement'); return { status: 'applied', candidateId: input.candidates[0].id }; });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal.reason).toBe('computer_generation_changed');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
  });
  it('rejects revocation during the capability/queue wait, before driver submission', async () => {
    const f = await fixture();
    f.controls.beforeRequest = async request => {
      if (request.action === 'computer_batch' && request.actions?.[0]?.type === 'click') f.setEnabled(false);
    };
    const out = await f.invoke({ action: 'goal', goal: 'Enable notifications' });
    expect(out.details.goal.reason).toBe('computer_authorization_revoked');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
  });
  it('rechecks authorization after driver startup waits, not only at batch entry', async () => {
    const f = await fixture();
    f.choose.mockImplementationOnce(async input => {
      f.host.ensureStarted = async () => { f.setEnabled(false); };
      return { status: 'applied', candidateId: input.candidates[0].id };
    });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal.reason).toBe('computer_authorization_revoked');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
  });
  it('retains an unknown submitted mutation when cancellation wins the post-click observation', async () => {
    const f = await fixture(), abort = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.choose.mockImplementationOnce(async input => {
      f.controls.beforeObserve = async () => { abort.abort(); await gate; };
      return { status: 'applied', candidateId: input.candidates[0].id };
    });
    const out = await f.invoke({ action: 'goal', goal: 'click' }, abort.signal);
    expect(out.details.goal).toMatchObject({ status: 'aborted', completedActions: 0, outcomeUnknown: true, doNotReplay: true,
      history: [{ operation: 'click', outcome: 'outcome_unknown' }] });
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(1);
    release();
  });
  it('preserves the function schema on Anthropic when the Jev provider is mounted', async () => {
    const f = await fixture();
    expect(f.hooks.get('before_provider_request')({ payload: { tools: [{ name: 'computer' }] } }, { model: { api: 'anthropic-messages', id: 'claude-sonnet-4-5' } })).toBeUndefined();
    expect(f.tools.get('computer').parameters.properties).toHaveProperty('goal');
  });
  it('withdrawal cancels pending decisions and does not consume a late answer', async () => {
    const f = await fixture();
    f.choose.mockImplementationOnce(async () => { f.events.emit(withdraw, { version: 1, provider: 'jev-optimizer', instanceId: 'test-provider' }); return { status: 'applied', candidateId: 'operation_1' }; });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal.status).toBe('aborted');
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(0);
    expect(f.host.goalLease).toBeUndefined();
  });
  it('finds a late AX target by local paging and executes its original token', async () => {
    let clicked = false;
    const f = await fixture({
      elements: revision => Array.from({ length: 80 }, (_, i) => ({ role: 'AXButton', label: `Widget ${i + 1}`, element_token: `snapshot-${revision}:${i + 1}` })),
      choose: input => ({ status: 'applied', candidateId: clicked ? 'finish' : input.candidates.find((item: any) => item.description === 'Click button Widget 65')?.id ?? 'next_page' }),
      onAction: (name, args) => { if (name === 'click') { expect(args.element_token).toBe('snapshot-1:65'); clicked = true; } },
    });
    const out = await f.invoke({ action: 'goal', goal: 'Open the requested widget' });
    expect(out.details.goal.status).toBe('needs_verification');
    expect(out.details.goal.history[0]).toEqual({ operation: 'inspect', outcome: 'local' });
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(1);
  });
  it('discovers an AX target exposed only after scrolling and opening a menu', async () => {
    let phase = 0;
    const f = await fixture({ elements: revision => phase === 0 ? [{ role: 'AXScrollArea', label: 'Items', element_token: `snapshot-${revision}:1` }] : [{ role: phase === 1 ? 'AXMenuButton' : 'AXMenuItem',
      label: phase === 1 ? 'More options' : 'Export', element_token: `snapshot-${revision}:1` }],
      onAction: name => { if (name === 'scroll' || name === 'click') phase++; },
      choose: input => ({ status: 'applied', candidateId: phase === 3 ? 'finish' : phase === 0 ? 'scroll_1_down'
        : input.candidates.find((item: any) => item.description.startsWith('Click ')).id }),
    });
    expect((await f.invoke({ action: 'goal', goal: 'Open Export' })).details.goal.status).toBe('needs_verification');
    expect(f.calls.filter(call => ['click', 'scroll'].includes(call.name)).map(call => call.name)).toEqual(['scroll', 'click', 'click']);
  });
  it('does not reset no-progress merely by revisiting an already seen AX page', async () => {
    const sequence = ['next_page', 'previous_page', 'operation_1', 'next_page', 'operation_65'];
    const f = await fixture({ noChange: true,
      elements: revision => Array.from({ length: 80 }, (_, i) => ({ role: 'AXButton', label: `Widget ${i + 1}`, element_token: `snapshot-${revision}:${i + 1}` })),
      choose: () => ({ status: 'applied', candidateId: sequence.shift() ?? 'finish' }),
    });
    const out = await f.invoke({ action: 'goal', goal: 'Open a widget' });
    expect(out.details.goal).toMatchObject({ reason: 'no_progress', decisions: 5 });
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(2);
  });
  it('does not submit a scroll selected against an expired AX container binding', async () => {
    const f = await fixture({ elements: revision => [{ role: 'AXScrollArea', label: 'Items', element_token: `snapshot-${revision}:1` }] });
    const invoke = f.host.invoke;
    f.host.invoke = async (name: string, args: any) => {
      if (name === 'scroll') throw Object.assign(new Error('stale_snapshot'), { code: 'stale_snapshot' });
      return invoke(name, args);
    };
    f.choose.mockImplementation(async () => ({ status: 'applied', candidateId: 'scroll_1_down' }));
    const out = await f.invoke({ action: 'goal', goal: 'Find more items' });
    expect(out.details.goal).toMatchObject({ status: 'handoff', doNotReplay: true });
    expect(f.calls.filter(call => call.name === 'scroll')).toHaveLength(0);
  });
  it('fills a known value through the actual provider, rebinds fresh tokens, and submits search', async () => {
    const literal = 'synthetic-private-query', oldValue = 'synthetic-old-private-query'; let value = oldValue, focused = 0, submitted = false;
    const f = await fixture({ realProvider: true, focused: () => focused,
      elements: revision => [{ role: 'AXTextField', label: 'Search query', value, element_index: 1, element_token: `snapshot-${revision}:1` }],
      choose: input => ({ status: 'applied', candidateId: submitted ? 'finish' : value === literal ? 'submit_search_1'
        : input.candidates.find((item: any) => item.id.startsWith('input_')).id }),
      onAction: (name, args) => {
        if (name === 'click') focused = 1;
        if (name === 'type_text') { expect(args.element_token).toBe('snapshot-2:1'); value = args.text; }
        if (name === 'press_key' && args.key === 'RETURN') submitted = true;
      },
    });
    const out = await f.invoke({ action: 'goal', goal: `Replace ${oldValue} and search the provided term`, inputs: [{ id: 'query', label: 'Search term', value: literal }] });
    expect(out.details.goal).toMatchObject({ status: 'needs_verification', completedActions: 4, verified: false });
    expect(value).toBe(literal); expect(submitted).toBe(true);
    expect(f.calls.filter(call => ['click', 'hotkey', 'type_text', 'press_key'].includes(call.name)).map(call => call.name))
      .toEqual(['click', 'hotkey', 'type_text', 'press_key']);
    expect(JSON.stringify(out.details.goal)).not.toContain(literal);
    for (const [, init] of f.http.mock.calls) { expect(init.body).not.toContain(literal); expect(init.body).not.toContain(oldValue); }
  });
  it('selects bindings explicitly without expanding every field/value pair', async () => {
    const values = ['', '']; let focused = 0;
    const f = await fixture({ focused: () => focused,
      elements: revision => ['First name', 'Last name'].map((label, i) => ({ role: 'AXTextField', label, value: values[i], element_index: i + 1, element_token: `snapshot-${revision}:${i + 1}` })),
      choose: input => {
        const field = values[0] ? 2 : 1;
        return { status: 'applied', candidateId: values.every(Boolean) ? 'finish'
          : input.candidates.some((item: any) => item.id === `input_${field}_${field}`) ? `input_${field}_${field}` : `bind_${field}` };
      },
      onAction: (name, args) => {
        if (name === 'click') focused = Number(args.element_token.split(':').pop());
        if (name === 'type_text') values[focused - 1] = args.text;
      },
    });
    const out = await f.invoke({ action: 'goal', goal: 'Fill first and last name', inputs: [
      { id: 'given', label: 'First name', value: 'synthetic-alpha' }, { id: 'family', label: 'Last name', value: 'synthetic-beta' },
    ] });
    expect(out.details.goal.status).toBe('needs_verification');
    expect(values).toEqual(['synthetic-alpha', 'synthetic-beta']);
    expect(f.choose.mock.calls[0][0].candidates.some((item: any) => item.id.startsWith('input_'))).toBe(false);
    expect(out.details.goal.history.filter((item: any) => item.operation === 'bind')).toHaveLength(2);
  });
  it('stops before typing when the selected field did not receive focus', async () => {
    const f = await fixture({ focused: () => 2,
      elements: revision => ['Search', 'Other'].map((label, i) => ({ role: 'AXTextField', label, value: '', element_index: i + 1, element_token: `snapshot-${revision}:${i + 1}` })),
      choose: () => ({ status: 'applied', candidateId: 'input_1_1' }),
    });
    const out = await f.invoke({ action: 'goal', goal: 'Fill search', inputs: [{ id: 'query', label: 'Search', value: 'literal' }] });
    expect(out.details.goal.reason).toBe('input_focus_unverified');
    expect(f.calls.filter(call => ['hotkey', 'type_text'].includes(call.name))).toHaveLength(0);
  });
  it('does not claim successful input when the observed value disagrees', async () => {
    let focused = 0;
    const f = await fixture({ focused: () => focused,
      elements: revision => [{ role: 'AXTextField', label: 'Search', value: 'unchanged', element_index: 1, element_token: `snapshot-${revision}:1` }],
      choose: () => ({ status: 'applied', candidateId: 'input_1_1' }),
      onAction: name => { if (name === 'click') focused = 1; },
    });
    expect((await f.invoke({ action: 'goal', goal: 'Fill search', inputs: [{ id: 'query', label: 'Search', value: 'literal' }] })).details.goal.reason).toBe('input_value_mismatch');
    expect(f.calls.filter(call => call.name === 'type_text')).toHaveLength(1);
  });
  it('clears a field for an explicitly empty literal without inventing text', async () => {
    let focused = 0, value = 'old';
    const f = await fixture({ focused: () => focused,
      elements: revision => [{ role: 'AXTextField', label: 'Search', value, element_index: 1, element_token: `snapshot-${revision}:1` }],
      choose: () => ({ status: 'applied', candidateId: value ? 'input_1_1' : 'finish' }),
      onAction: (name, args) => { if (name === 'click') focused = 1; if (name === 'press_key' && args.key === 'BACKSPACE') value = ''; },
    });
    expect((await f.invoke({ action: 'goal', goal: 'Clear search', inputs: [{ id: 'empty', label: 'Empty search', value: '' }] })).details.goal.status).toBe('needs_verification');
    expect(f.calls.filter(call => call.name === 'type_text')).toHaveLength(0);
  });
  it('keeps all earlier field values private and stops rather than evicting them at the budget', async () => {
    let advanced = false;
    const f = await fixture({ realProvider: true,
      elements: revision => [{ role: 'AXButton', label: 'Next', element_token: `snapshot-${revision}:1` },
        { role: 'AXTextArea', label: 'Long content', value: (advanced ? 'b' : 'a').repeat(40000), element_token: `snapshot-${revision}:2` }],
      choose: () => ({ status: 'applied', candidateId: 'operation_1' }),
      onAction: name => { if (name === 'click') advanced = true; },
    });
    expect((await f.invoke({ action: 'goal', goal: 'Continue' })).details.goal.reason).toBe('redaction_budget');
    expect(f.http).toHaveBeenCalledTimes(1);
  });
  it('blocks goal start when the desktop execution switch is off despite a valid cloud offer', async () => {
    const f = await fixture({ executionEnabled: false });
    expect((await f.invoke({ action: 'goal', goal: 'click' })).details.goal.reason).toBe('computer_authorization_revoked');
    expect(f.choose).not.toHaveBeenCalled();
    expect(f.calls.filter(call => call.name === 'get_window_state' || call.name === 'click')).toHaveLength(0);
  });
  it.each(['click', 'hotkey'])('stops later input sub-actions when desktop execution is disabled after %s', async stopAfter => {
    let focused = 0;
    const f = await fixture({ focused: () => focused,
      elements: revision => [{ role: 'AXTextField', label: 'Search', value: '', element_index: 1, element_token: `snapshot-${revision}:1` }],
      choose: () => ({ status: 'applied', candidateId: 'input_1_1' }),
      onAction: name => { if (name === 'click') focused = 1; if (name === stopAfter) f.setExecutionEnabled(false); },
    });
    const out = await f.invoke({ action: 'goal', goal: 'Fill search', inputs: [{ id: 'query', label: 'Search', value: 'private literal' }] });
    expect(out.details.goal.reason).toBe('computer_authorization_revoked');
    expect(f.calls.filter(call => call.name === 'type_text')).toHaveLength(0);
    expect(f.calls.filter(call => call.name === 'hotkey')).toHaveLength(stopAfter === 'click' ? 0 : 1);
  });
  it('does not rebind a same-name field in another region after snapshot reordering', async () => {
    let reordered = false, focused = 0;
    const f = await fixture({ focused: () => focused,
      elements: revision => (reordered ? ['Shipping', 'Billing'] : ['Billing', 'Shipping']).map((region, i) => ({
        role: 'AXTextField', label: 'Name', region, value: '', element_index: i + 1, element_token: `snapshot-${revision}:${i + 1}`,
      })),
      choose: () => ({ status: 'applied', candidateId: 'input_1_1' }),
      onAction: name => { if (name === 'click') { reordered = true; focused = 1; } },
    });
    const out = await f.invoke({ action: 'goal', goal: 'Fill Billing Name', inputs: [{ id: 'name', label: 'Billing name', value: 'private-name' }] });
    expect(out.details.goal.reason).toBe('input_focus_unverified');
    expect(f.calls.filter(call => ['hotkey', 'type_text', 'press_key'].includes(call.name))).toHaveLength(0);
  });
  it.each([
    ['settings-visible-toggle', ['Settings', 'Show line numbers']],
    ['menu-expand-find', ['Edit', 'Find...']],
    ['scroll-reveal-row', ['Release notes']],
    ['search-known-term', ['Search']],
  ] as const)('runs synthetic %s through the registered tool with independent fixture completion', async (id, labels) => {
    const session = createAxScenarioSession(id);
    const input = session.inputCatalog().map(item => ({ ...item, value: session.inputValue(item.id)! }));
    const f = await fixture({ driverSession: session, realProvider: true, choose: state => {
      if (session.completed()) return { status: 'applied', candidateId: 'finish' };
      const candidates = state.candidates as Array<{ id: string; description: string }>;
      const fill = candidates.find(item => item.id.startsWith('input_'));
      const click = candidates.find(item => item.description.startsWith('Click ') && labels.some(label => item.description.includes(label)));
      const scroll = candidates.find(item => item.id.startsWith('scroll_') && item.id.endsWith('_down'));
      const selected = fill ?? click ?? scroll ?? candidates.find(item => item.id === 'next_page');
      if (!selected) throw new Error('Synthetic chooser has no supported fixture action');
      return { status: 'applied', candidateId: selected.id };
    } });
    const out = await f.invoke({ action: 'goal', goal: session.goal, ...(input.length ? { inputs: input } : {}) });
    expect(out.details.goal.status).toBe('needs_verification');
    expect(out.details.goal.verified).toBe(false);
    expect(session.completed()).toBe(true);
    expect(session.forbiddenViolations()).toEqual([]);
    expect(session.wrongActions()).toBe(0);
    for (const [, init] of f.http.mock.calls) for (const item of input) expect(init.body).not.toContain(item.value);
  });
  it('old direct computer calls do not use Jev', async () => {
    const f = await fixture();
    await f.invoke({ action: 'click', element_token: 'snapshot-1:1' });
    expect(f.choose).not.toHaveBeenCalled();
    expect(f.calls.filter(call => call.name === 'click')).toHaveLength(1);
  });
});

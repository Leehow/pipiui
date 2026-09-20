import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import registerBrowserTool from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-tool.ts';
import { createJevOptimizer } from '../../../resources/runtime/extensions/jev-optimizer/agent/index.ts';
import { capabilityCall } from '../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts';
import { tagObservation, untaggedRequest } from '../../../apps/electron/src/main/browser/dom-bridge.ts';

vi.mock('../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts', () => ({ capabilityCall: vi.fn() }));
const bridge = vi.mocked(capabilityCall);
const source = readFileSync(new URL('../../../resources/runtime/browser-dom/controller.js', import.meta.url), 'utf8');
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.clearAllMocks(); });

function fixture(response: 'rank' | 'error' | 'mutate' | 'flat' = 'rank', browserEnabled = true) {
  const dom = new JSDOM('<main aria-label="Controls"><textarea>synthetic-draft</textarea><input value="1"><button id="invoice">Invoice</button><button id="settings">Settings</button></main>', {
    url: 'https://synthetic.invalid/private-url', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }) });
  Object.defineProperty(dom.window.document, 'elementFromPoint', { value: () => dom.window.document.body });
  dom.window.eval(source);
  cleanup.push(() => dom.window.close());
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const events = {
    on(channel: string, fn: (data: unknown) => void) { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel)!.add(fn); return () => { listeners.get(channel)!.delete(fn); }; },
    emit(channel: string, data?: unknown) { for (const fn of listeners.get(channel) || []) fn(data); },
  };
  let tool: any;
  const pi: any = { events, registerTool: (value: any) => { tool = value; }, on: () => {} };
  const calls: Record<string, any>[] = [];
  bridge.mockImplementation(async (_method, request) => {
    calls.push(request);
    const value = (dom.window as any).__pipiBrowserDOM.dispatch(untaggedRequest(request, 'desktop'));
    return tagObservation(value, 'desktop');
  });
  const http = vi.fn(async (_url: string, init?: RequestInit) => {
    const serialized = String(init!.body);
    const body = JSON.parse(serialized);
    expect(Object.keys(body.state)).toEqual(['intent', 'candidates']);
    expect(serialized).not.toMatch(/synthetic-draft|private-url|snapshot|element-|preparation|domPath|valueHint|test-secret-key/);
    expect(body.state.candidates.every((c: any) => /^candidate-\d+$/.test(c.id))).toBe(true);
    if (response === 'error') return new Response('untrusted service error', { status: 503 });
    if (response === 'mutate') dom.window.document.querySelector('#settings')!.setAttribute('disabled', '');
    const answers = Object.fromEntries(body.state.candidates.map((c: any) => [c.id, { type: 'score', score: response === 'flat' ? 2 : c.name === 'Settings' ? 3 : 0 }]));
    return new Response(JSON.stringify({ answers, model: 'mock-contract-only', usage: { input_tokens: 99 } }));
  });
  const handle = createJevOptimizer(pi, {
    env: { EXT_JEV_OPTIMIZER_APIKEY: 'test-secret-key', PIPIUI_JEV_GENERATION: 'code', PIPIUI_JEV_STATE_FILE: 'injected' },
    readState: async () => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: 'code', browserEnabled, browserGeneration: 'browser' }),
    fetch: http,
  });
  registerBrowserTool(pi);
  cleanup.push(handle.dispose);
  const run = (params: Record<string, unknown>) => tool.execute('test', params, undefined, undefined, { cwd: '/synthetic' });
  return { dom, run, http, calls };
}

describe('production DOM + registered browser + real provider (HTTP mocked, not an efficacy benchmark)', () => {
  it('ranks once, publishes real viewport-scoped refs and uses one to click the intended node', async () => {
    const { dom, run, http, calls } = fixture();
    const result = await run({ action: 'observe', intent: 'Invoice' });
    expect(result.isError).toBeUndefined();
    expect(result.details.observationOptimization.status).toBe('applied');
    expect(result.details.elements[0].name).toBe('Settings');
    expect(result.details.elements[0].token).toMatch(/^desktop:element-/);
    expect(http).toHaveBeenCalledTimes(1);
    expect(calls.map(call => call.action)).toEqual(['prepare_intent_observation', 'finalize_intent_observation']);
    expect(JSON.stringify(result)).not.toContain('preparationID');
    let clicked = false;
    dom.window.document.querySelector('#settings')!.addEventListener('click', () => { clicked = true; });
    const click = await run({ action: 'click', snapshot_id: result.details.snapshotID, element_token: result.details.elements[0].token });
    expect(click.isError).toBeUndefined();
    expect(clicked).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'flat'] as const)('%s response uses the same prepared local order without another scan or request', async mode => {
    const { run, http, calls } = fixture(mode);
    const result = await run({ action: 'observe', intent: 'Invoice' });
    expect(result.isError).toBeUndefined();
    expect(result.details.elements[0].name).toBe('Invoice');
    expect(result.details.observationOptimization.status).toBe(mode === 'flat' ? 'skipped' : 'fallback');
    expect(calls.map(call => call.action)).toEqual(['prepare_intent_observation', 'finalize_intent_observation']);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('never uploads a known key prefix already clipped by the controller name budget', async () => {
    const { dom, run, http } = fixture();
    const key = 'test-secret-key';
    dom.window.document.querySelector('#settings')!.textContent = 'x'.repeat(512 - key.length + 1) + key;
    const result = await run({ action: 'observe', intent: 'Invoice' });
    expect(result.isError).toBeUndefined();
    // Either fail closed before HTTP or redact the recognizable boundary fragment.
    for (const [, init] of http.mock.calls) expect(String(init?.body)).not.toContain(key.slice(0, -2));
  });

  it('page mutation during cloud response fails publication and never pretends applied', async () => {
    const { run, http } = fixture('mutate');
    const result = await run({ action: 'observe', intent: 'Invoice' });
    expect(result.isError).toBe(true);
    expect(result.details.code).toBe('browser_observation_changed');
    expect(result.details.snapshotID).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('"status":"applied"');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])('keeps both viewport metadata in a %i-observation batch', async count => {
    const left = fixture(); const right = fixture();
    bridge.mockImplementation(async (_method, request) => {
      const pane = (dom: JSDOM, kind: 'desktop' | 'mobile') => {
        const value = tagObservation((dom.window as any).__pipiBrowserDOM.dispatch({ ...request, action: 'observe' }), kind);
        Object.assign(value.observationOptimization as object, { reason: 'multi-target-local' });
        return value;
      };
      return { ok: true, target: 'both', desktop: pane(left.dom, 'desktop'), mobile: pane(right.dom, 'mobile') };
    });
    const result = await left.run({ actions: Array.from({ length: count }, () => ({ action: 'observe', intent: 'Invoice', target: 'both' })) });
    expect(result.isError).toBeUndefined();
    for (const entry of result.details.results) for (const kind of ['desktop', 'mobile']) {
      expect(entry.details[kind].observationOptimization).toMatchObject({ status: 'local', reason: 'multi-target-local', evaluatedCount: 0 });
    }
    const last = result.details.results.at(-1).details;
    expect(last.desktop.elements[0].token).toMatch(/^desktop:/);
    expect(last.mobile.elements[0].token).toMatch(/^mobile:/);
    expect(left.http).not.toHaveBeenCalled(); expect(right.http).not.toHaveBeenCalled();
  });

  it('rechecks each pane budget after the host adds both-viewport metadata', async () => {
    const left = fixture(); const right = fixture();
    bridge.mockImplementation(async (_method, request) => {
      const desktop: any = tagObservation((left.dom.window as any).__pipiBrowserDOM.dispatch({ ...request, action: 'observe' }), 'desktop');
      const mobile: any = tagObservation((right.dom.window as any).__pipiBrowserDOM.dispatch({ ...request, action: 'observe' }), 'mobile');
      // A valid bounded synthetic region envelope; each name stays under the field cap.
      while (JSON.stringify(desktop).length < 19998 - 512) desktop.regions.push({ id: `region-${desktop.regions.length}`, name: 'x'.repeat(400), role: 'region', count: 1 });
      desktop.title = 'x'.repeat(19998 - JSON.stringify(desktop).length);
      expect(JSON.stringify(desktop).length).toBe(19998);
      desktop.observationOptimization.reason = 'multi-target-local';
      mobile.observationOptimization.reason = 'multi-target-local';
      expect(JSON.stringify(desktop).length).toBeGreaterThan(20000);
      return { ok: true, target: 'both', desktop, mobile };
    });
    const result = await left.run({ actions: [{ action: 'observe', intent: 'Invoice', target: 'both' }, { action: 'observe' }] });
    expect(result.isError).toBe(true);
    expect(result.details.failedIndex).toBe(0);
    expect(result.details.results[0].details.desktop.code).toBe('browser_observation_budget');
    expect(result.details.results[0].details.desktop.snapshotID).toBeUndefined();
    expect(JSON.stringify(result.details.results[0].details.desktop).length).toBeLessThanOrEqual(20000);
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(left.http).not.toHaveBeenCalled();
  });

  it('disabled browser consent returns a genuine local snapshot in one host call, no HTTP', async () => {
    const { run, http, calls } = fixture('rank', false);
    const result = await run({ action: 'observe', intent: 'Invoice' });
    expect(result.isError).toBeUndefined();
    expect(result.details.elements[0].name).toBe('Invoice');
    expect(result.details.observationOptimization).toMatchObject({ status: 'local', reason: 'browser-disabled' });
    expect(calls.map(call => call.action)).toEqual(['observe']);
    expect(http).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runUpstreamGoal, pythonExecutable } from '../../../resources/runtime/extensions/webview-browser-extension/agent/jev-upstream/run.ts';
import { createUpstreamTextTransport } from '../../../resources/runtime/extensions/webview-browser-extension/agent/jev-upstream/text.ts';
import { evaluateUpstreamChoice } from '../../../resources/runtime/extensions/jev-optimizer/agent/browser-choice.ts';

const vendor = new URL('../../../resources/runtime/extensions/webview-browser-extension/agent/jev-upstream/vendor/', import.meta.url);
const root = '/test/jev-upstream';
const key = 'synthetic-credential-not-a-real-key';

function fixture() {
  const dom = new JSDOM('<main><label>Destination<input id="text" aria-label="Destination"></label><select id="select" aria-label="Travel class"><option value="economy">Economy</option><option value="business">Business</option></select></main>', { url: 'https://fixture.invalid/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as any;
  const input = w.document.querySelector('#text'), select = w.document.querySelector('#select');
  const box = (y: number) => ({ x: 10, y, left: 10, top: y, right: 210, bottom: y + 30, width: 200, height: 30 });
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', { value() { return box((this as any).id === 'select' ? 100 : 20); } });
  Object.defineProperty(w.HTMLElement.prototype, 'checkVisibility', { value() { return true; } });
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return (this as any).textContent; } });
  Object.defineProperty(w.Range.prototype, 'getBoundingClientRect', { value: () => box(10) });
  Object.defineProperty(w.document, 'elementFromPoint', { value: (_x: number, y: number) => y > 90 ? select : input });
  const commands: string[] = [];
  const bridge = vi.fn(async (action: string, params: any) => {
    if (action === 'jev_begin') return { ok: true, lease: 'internal-lease', viewportTarget: 'desktop' };
    if (action === 'jev_end') return { ok: true };
    expect(params.jev_lease).toBe('internal-lease');
    if (action === 'jev_sanitize') return { ok: true, result: params.cdp_params };
    const { cdp_method: method, cdp_params: p } = params; commands.push(method);
    if (method === 'Runtime.evaluate') return { ok: true, result: { result: { value: await w.eval(p.expression) } } };
    if (method === 'Input.dispatchMouseEvent') { w.document.elementFromPoint(p.x, p.y)?.focus(); return { ok: true, result: {} }; }
    if (method === 'Input.dispatchKeyEvent') return { ok: true, result: {} };
    if (method === 'Input.insertText') { w.document.activeElement.value = p.text; return { ok: true, result: {} }; }
    throw new Error('unexpected-command');
  });
  const requests: any[] = [];
  const deps = {
    env: { EXT_JEV_OPTIMIZER_APIKEY: key, PIPIUI_JEV_STATE_FILE: root + '/.pi/agent/jev-optimizer/runtime-state.json', PIPIUI_JEV_GENERATION: 'generation' },
    readState: async () => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: 'generation', browserEnabled: true, browserGeneration: 'browser' }),
    fetch: async (_url: any, init: any) => {
      const body = JSON.parse(init.body); requests.push(body);
      const elements = body.state.elements;
      const text = elements.find((e: any) => e.label === 'Destination');
      const dropdown = elements.find((e: any) => e.label === 'Travel class');
      const operation = !text.value ? 'TYPE_TEXT' : dropdown.value !== 'Business' ? 'SELECT' : 'DONE';
      const selected: any = { operation, type_text_target: text.index };
      if (operation === 'SELECT') selected.select_target = dropdown.options.find((o: any) => o.label.endsWith('Business')).index;
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]: any) => {
        const ids = Object.keys(q.criteria), choice = selected[id] ?? ids[0];
        // Real API probabilities are rounded. Preserve the original upstream tolerance.
        return [id, { type: 'choice', choice, confidence: .99, probabilities: Object.fromEntries(ids.map(k => [k, k === choice ? .99 : 0])) }];
      }));
      return new Response(JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 20 } }));
    },
  };
  const offer: any = { availability: async () => ({ ready: true }), evaluate: (input: any) => evaluateUpstreamChoice(input, deps) };
  const connection: any = { current: () => ({ offer, signal: new AbortController().signal }) };
  return { dom, input, select, bridge, requests, commands, connection, offer };
}

describe('upstream Python control core across production host/model interfaces', () => {
  it('keeps snapshot and questions byte-identical to the pinned upstream source', () => {
    const manifest = JSON.parse(readFileSync(new URL('upstream.json', vendor), 'utf8'));
    for (const file of ['jev_ultrafast/snapshot.js', 'jev_ultrafast/questions.py', 'LICENSE']) {
      expect(createHash('sha256').update(readFileSync(new URL(file, vendor))).digest('hex')).toBe(manifest.files[file]);
    }
  });

  it('executes original snapshot/decision/typing/selection loop in real Python, observing completed values', async () => {
    expect(pythonExecutable(), 'Run node scripts/fetch-jev-python.mjs for this integration test').toBeTruthy();
    const f = fixture();
    const complete = vi.fn(async (_model, context, options) => {
      expect(context.systemPrompt).toContain('text');
      expect(options).not.toHaveProperty('maxTokens');
      return { content: [{ type: 'text', text: '{"text":"Paris"}' }], usage: { input: 30, output: 7 }, stopReason: 'stop' };
    });
    try {
      const result = await runUpstreamGoal({ goal: 'Fill Destination with Paris and select Business', timeoutSecs: 15 }, {
        projectRoot: root, connection: f.connection, bridge: f.bridge,
        spawnWorker: ((command: string, args: string[], options: any) => {
          expect(options.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', PIPIUI_JEV_WORKER: '1', PYTHONDONTWRITEBYTECODE: '1' });
          expect(options.env).not.toHaveProperty('EXT_JEV_OPTIMIZER_APIKEY');
          expect(options.env).not.toHaveProperty('EXT_FLAPCODE_APIKEY');
          return spawn(command, args, options);
        }) as typeof spawn,
        generateText: createUpstreamTextTransport({ model: { id: 'current-model' }, modelRegistry: { complete } }),
      });
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'needs_verification', verified: false, decisions: 3, textModelCalls: 1 });
      expect(result.steps.map((s: any) => s.operation)).toEqual(['TYPE_TEXT', 'SELECT']);
      expect(f.input.value).toBe('Paris');
      expect(f.select.value).toBe('business');
      expect(f.requests[1].state.elements.find((e: any) => e.label === 'Destination').value).toBe('Paris');
      expect(f.requests[2].state.elements.find((e: any) => e.label === 'Travel class').value).toBe('Business');
      expect(complete).toHaveBeenCalledTimes(1);
      expect(f.bridge).toHaveBeenLastCalledWith('jev_end', { target: 'desktop', jev_lease: 'internal-lease' });
      expect(JSON.stringify(f.requests)).not.toContain(key);
    } finally { f.dom.window.close(); }
  });

  it('does no browser work when authorization is missing', async () => {
    const bridge = vi.fn();
    const offer: any = { evaluate: vi.fn(), availability: async () => ({ ready: false, reason: 'browser-disabled' }) };
    const result = await runUpstreamGoal({ goal: 'Click a link' }, { projectRoot: root, bridge,
      connection: { current: () => ({ offer, signal: new AbortController().signal }), dispose() {} } });
    expect(result).toMatchObject({ status: 'fallback', code: 'browser-disabled' });
    expect(bridge).not.toHaveBeenCalled();
    expect(offer.evaluate).not.toHaveBeenCalled();
  });

  it('structurally refuses recursive worker startup', async () => {
    const previous = process.env.PIPIUI_JEV_WORKER;
    process.env.PIPIUI_JEV_WORKER = '1';
    const spawnWorker = vi.fn() as unknown as typeof spawn;
    try {
      expect(await runUpstreamGoal({ goal: 'Click a link' }, { projectRoot: root, bridge: vi.fn(), spawnWorker }))
        .toMatchObject({ code: 'nested-jev-worker-denied' });
      expect(spawnWorker).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.PIPIUI_JEV_WORKER;
      else process.env.PIPIUI_JEV_WORKER = previous;
    }
  });

  it('cancels a live Python run during text generation without typing or leaking a lease', async () => {
    const f = fixture(); const ac = new AbortController();
    try {
      const result = await runUpstreamGoal({ goal: 'Fill Destination with Paris' }, {
        projectRoot: root, connection: f.connection, bridge: f.bridge, signal: ac.signal,
        generateText: async () => { ac.abort(); return new Promise(() => {}); },
      });
      expect(result).toMatchObject({ status: 'aborted', code: 'aborted', textModelCalls: 1 });
      expect(f.input.value).toBe('');
      expect(f.commands).not.toContain('Input.insertText');
      expect(f.bridge).toHaveBeenLastCalledWith('jev_end', { target: 'desktop', jev_lease: 'internal-lease' });
    } finally { f.dom.window.close(); }
  });

  it('rechecks authority after text generation before any input', async () => {
    const f = fixture();
    try {
      const result = await runUpstreamGoal({ goal: 'Fill Destination with Paris' }, {
        projectRoot: root, connection: f.connection, bridge: f.bridge,
        generateText: async () => {
          f.offer.availability = async () => ({ ready: false, reason: 'browser-disabled' });
          return { choices: [{ message: { content: '{"text":"Paris"}' } }] };
        },
      });
      expect(result).toMatchObject({ status: 'fallback', code: 'browser-disabled' });
      expect(f.input.value).toBe('');
      expect(f.commands).not.toContain('Input.insertText');
    } finally { f.dom.window.close(); }
  });
});

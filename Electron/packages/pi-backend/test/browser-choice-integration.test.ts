import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createJevOptimizer } from '../../../resources/runtime/extensions/jev-optimizer/agent/index.ts';
import { connectBrowserChoice, runBrowserGoal } from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-choice-loop.ts';
import { createGoalTextGenerator } from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-choice-text.ts';
import { tagObservation, untaggedRequest } from '../../../apps/electron/src/main/browser/dom-bridge.ts';

const source = readFileSync(new URL('../../../resources/runtime/browser-dom/controller.js', import.meta.url), 'utf8');
const windows: JSDOM[] = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
const ROOT = '/test/choice-project';
const KEY = 'synthetic-jev-key-not-a-real-credential';
function bus() {
  const handlers = new Map<string, Set<(v: any) => void>>();
  return {
    on(name: string, cb: (v: any) => void) { let set = handlers.get(name); if (!set) handlers.set(name, set = new Set()); set.add(cb); return () => { set!.delete(cb); }; },
    emit(name: string, value: any) { for (const cb of handlers.get(name) ?? []) cb(value); },
  };
}
function fixture(browserEnabled = true, invalidChoice = false, extraOptions = 0) {
  const filler = Array.from({ length: extraOptions }, (_, i) => `<option value="internal-extra-${i}">Other option ${i}</option>`).join('');
  const dom = new JSDOM('<main><label>Destination<input id="destination" aria-label="Destination"></label><select id="class" aria-label="Travel class"><option value="internal-economy">Economy</option>' + filler + '<option value="internal-business">Business</option></select><button id="search">Search</button><output id="result"></output></main>', { url: 'https://fixture.invalid/search', runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom);
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', { value() {
    // Native option elements have no standalone clickable viewport box in Chromium;
    // their choices are exposed by the owning select, not as hundreds of buttons.
    if ((this as HTMLElement).localName === 'option') return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  } });
  Object.defineProperty(w.document, 'elementFromPoint', { value: () => w.document.body });
  w.document.querySelector('#search')!.addEventListener('click', () => {
    w.document.querySelector('#result')!.textContent = `${(w.document.querySelector('#destination') as HTMLInputElement).value}|${(w.document.querySelector('#class') as HTMLSelectElement).value}`;
  });
  w.eval(source);
  const actions: string[] = []; const targets: string[] = [];
  const bridge = async (action: string, params: any) => {
    actions.push(action); targets.push(params.target);
    const raw = await (w as any).__pipiBrowserDOM.dispatch(untaggedRequest({ action, ...params }, 'desktop'));
    return tagObservation(raw, 'desktop');
  };
  const events = bus(); const requests: any[] = [];
  const handle = createJevOptimizer({ events } as any, {
    env: { EXT_JEV_OPTIMIZER_APIKEY: KEY, PIPIUI_JEV_GENERATION: 'generation', PIPIUI_JEV_STATE_FILE: `${ROOT}/.pi/agent/jev-optimizer/runtime-state.json` },
    readState: async () => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: 'generation', browserEnabled, browserGeneration: 'browser-generation' }),
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
      // Deterministic test double only for the remote decision, not the transport/loop/DOM.
      const history = body.state.history ?? [];
      const operation = !history.some((s: any) => s.operation === 'TYPE_TEXT') ? 'TYPE_TEXT'
        : !history.some((s: any) => s.operation === 'SELECT') ? 'SELECT'
        : !history.some((s: any) => s.operation === 'CLICK') ? 'CLICK' : 'DONE';
      const selected: Record<string, string> = { operation: invalidChoice ? 'INVENTED' : operation };
      const candidates = body.state.candidates as any[];
      if (operation === 'TYPE_TEXT') selected.type_text_target = candidates.find(c => c.name === 'Destination').id;
      if (operation === 'CLICK') selected.click_target = candidates.find(c => c.name === 'Search').id;
      if (operation === 'SELECT') {
        const candidate = candidates.find(c => c.name === 'Travel class');
        selected.select_target = JSON.stringify([candidate.id, candidate.options.find((o: any) => o.label === 'Business').id]);
      }
      const answers = Object.fromEntries(Object.entries(body.questions).map(([head, q]: [string, any]) => {
        const ids = Object.keys(q.criteria); const choice = selected[head] ?? ids[0];
        return [head, { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) }];
      }));
      return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-test', usage: { input_tokens: 20 }, answers }) };
    },
  });
  const connection = connectBrowserChoice(events);
  return { dom, bridge, actions, targets, requests, connection, close() { connection.dispose(); handle.dispose(); } };
}

describe('production Choice pipeline with deterministic remote-model doubles', () => {
  it.each([0, 200, 300])('fills, selects and clicks inside one goal call with %i extra dropdown options; independent DOM checker proves the outcome', async extraOptions => {
    const f = fixture(true, false, extraOptions); let textCalls = 0;
    try {
      const generateText = createGoalTextGenerator({ model: { id: 'existing-model' }, modelRegistry: { complete: async () => {
        textCalls++; return { content: [{ type: 'text', text: '{"text":"Paris"}' }], usage: { input: 30, output: 8 } };
      } } });
      const result = await runBrowserGoal({ goal: 'Find business class options for Paris' }, { projectRoot: ROOT, connection: f.connection, bridge: f.bridge, generateText });
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'needs_verification', verified: false, decisions: 4, inputTokens: 80, textModelCalls: 1 });
      expect(result.steps.map((s: any) => s.operation)).toEqual(['TYPE_TEXT', 'SELECT', 'CLICK']);
      if (extraOptions > 255) expect(result.observationsTruncated).toBe(true);
      expect(f.dom.window.document.querySelector('#result')!.textContent).toBe('Paris|internal-business');
      expect(textCalls).toBe(1); expect(f.actions.filter(a => a === 'execute_choice')).toHaveLength(3);
      expect(f.requests).toHaveLength(4);
      expect(f.targets[0]).toBe('active');
      expect(f.targets.slice(1).every(target => target === 'desktop')).toBe(true);
      expect(JSON.stringify(f.requests)).not.toContain(KEY);
      expect(JSON.stringify(f.requests)).not.toMatch(/choiceGuard|snapshotID|internal-business|internal-economy|valueHint/);
    } finally { f.close(); }
  });
  it('disabled browser permission prevents both HTTP and browser execution', async () => {
    const f = fixture(false);
    try {
      const result = await runBrowserGoal({ goal: 'Search Paris' }, { projectRoot: ROOT, connection: f.connection, bridge: f.bridge });
      expect(result).toMatchObject({ status: 'fallback', code: 'browser-disabled' });
      expect(f.requests).toHaveLength(0); expect(f.actions).toHaveLength(0);
    } finally { f.close(); }
  });
  it('invalid remote decision never changes the DOM', async () => {
    const f = fixture(true, true);
    try {
      const result = await runBrowserGoal({ goal: 'Search Paris' }, { projectRoot: ROOT, connection: f.connection, bridge: f.bridge });
      expect(result.status).toBe('fallback');
      expect(f.actions).not.toContain('execute_choice');
      expect((f.dom.window.document.querySelector('#destination') as HTMLInputElement).value).toBe('');
    } finally { f.close(); }
  });
});

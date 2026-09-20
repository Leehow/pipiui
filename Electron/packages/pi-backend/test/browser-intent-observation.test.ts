import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../resources/runtime/browser-dom/controller.js', import.meta.url), 'utf8');
const bridge = vi.hoisted(() => vi.fn());
vi.mock('../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts', () => ({ capabilityCall: bridge }));
import registerBrowser, { executeBrowserTool } from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-tool.ts';

const windows: JSDOM[] = [];
function page(html: string) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/orders', runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom);
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', { value() { return { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; } });
  Object.defineProperty(w.document, 'elementFromPoint', { value: () => w.document.body });
  w.eval(source);
  const dispatch = (params: Record<string, unknown>) => (w as any).__pipiBrowserDOM.dispatch(params);
  return { dom, dispatch };
}
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); bridge.mockReset(); vi.restoreAllMocks(); });
const buttons = Array.from({ length: 20 }, (_, i) => `<button>Other ${i}</button>`).join('');

describe('goal-aware DOM observation', () => {
  it('finds a target outside ordinary previews and publishes usable native refs', () => {
    const { dom, dispatch } = page(`<main>${buttons}<button id="invoice">Download invoice</button></main>`);
    expect(dispatch({ action: 'observe' }).elements.some((e: any) => e.name === 'Download invoice')).toBe(false);
    const observed = dispatch({ action: 'observe', intent: 'Download invoice' });
    expect(observed.ok).toBe(true);
    expect(observed.elements[0].name).toBe('Download invoice');
    expect(observed.elements.length).toBeLessThanOrEqual(12);
    expect(observed.observationOptimization).toMatchObject({ status: 'local', collectedCount: 22, displayedCount: 12 });
    let clicked = false;
    dom.window.document.querySelector('#invoice')!.addEventListener('click', () => { clicked = true; });
    expect(dispatch({ action: 'click', snapshot_id: observed.snapshotID, element_token: observed.elements[0].token }).ok).toBe(true);
    expect(clicked).toBe(true);
  });

  it('honors hard filters and uses Chinese terms, preserving ordinary pagination', () => {
    const { dispatch } = page('<nav><button>下载发票</button></nav><main><button>申请下载电子发票</button><a href="/invoice">下载发票</a></main>');
    const result = dispatch({ action: 'observe', intent: '下载发票', role: 'button', region: 'main' });
    expect(result.elements.map((e: any) => e.name)).toEqual(['申请下载电子发票']);
    // Hard filters restrict actionable candidates, not safety-relevant page structure.
    expect(result.regions.some((region: any) => region.role === 'main')).toBe(true);
    expect(dispatch({ action: 'observe', intent: 'invoice', cursor: 0 }).code).toBe('invalid_browser_intent');
    expect(dispatch({ action: 'observe', role: 'button', cursor: 0 }).ok).toBe(true);
  });

  it('caps collection and reports incomplete coverage rather than absence', () => {
    const { dispatch } = page(`<main>${Array.from({ length: 270 }, (_, i) => `<button>Item ${i}</button>`).join('')}</main>`);
    const result = dispatch({ action: 'observe', intent: 'Item 269' });
    expect(result.observationOptimization.collectedCount).toBe(256);
    expect(result.observationOptimization.incomplete).toBe(true);
    expect(result.observationOptimization.reason).toBe('candidate-limit');
    expect(result.truncated).toBe(true);
    expect(result.limitations.join(' ')).toContain('ordinary observe');
  });

  it('keeps dialogs and limitations even when unrelated controls rank first', () => {
    const { dispatch } = page(`<dialog open aria-label="Confirmation"><button>Cancel</button></dialog><main>${buttons}<button>Invoice</button><canvas></canvas></main>`);
    const result = dispatch({ action: 'observe', intent: 'Invoice' });
    expect(result.regions.some((r: any) => r.role === 'dialog')).toBe(true);
    expect(result.limitations.join(' ')).toContain('canvas');
  });

  it('keeps plain observes unchanged and rejects invalid intents', () => {
    const { dispatch } = page('<button>Save</button>');
    const result = dispatch({ action: 'observe' });
    expect(result.observationOptimization).toBeUndefined();
    expect(result.elements[0].name).toBe('Save');
    for (const intent of ['', '  ', 'x'.repeat(513), 12]) expect(dispatch({ action: 'observe', intent }).code).toBe('invalid_browser_intent');
  });

  it('prepares only sanitized descriptors and publishes a valid caller ordering', () => {
    const { dispatch } = page('<main><input type="password" value="private-secret" aria-label="Password"><button>private-secret invoice</button><button>Settings</button></main>');
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'private-secret invoice' });
    expect(prepared.ok).toBe(true);
    expect(prepared.snapshotID).toBeUndefined();
    expect(prepared.candidates.every((c: any) => Object.keys(c).sort().join(',') === 'id,name,region,role')).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain('private-secret');
    expect(JSON.stringify(prepared.candidates)).not.toContain('Password');
    expect(JSON.stringify(prepared.candidates)).not.toMatch(/valueHint|token|locator|https:/);
    const ids = prepared.candidates.map((c: any) => c.id).reverse();
    const result = dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID, candidate_ids: ids });
    expect(result.ok).toBe(true);
    expect(result.elements[0].name).toBe('Settings');
    expect(result.elements[0].token).toBeTruthy();
  });

  it('does not export ordinary form values echoed by ancestor names or intent', () => {
    const { dispatch } = page('<main><textarea>personal-draft</textarea><div contenteditable="true">private-note</div><input value="customer-data"><a href="/invoice">https://example.invalid/private-link Invoice</a></main>');
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'customer-data invoice' });
    expect(prepared.ok).toBe(true);
    const payload = JSON.stringify({ intent: prepared.intent, candidates: prepared.candidates });
    for (const value of ['personal-draft', 'private-note', 'customer-data', 'https://example.invalid']) expect(payload).not.toContain(value);
  });

  it.each(['1', 'a'])('keeps runtime candidate ids intact with short form value %s', value => {
    const { dispatch } = page(`<input value="${value}"><button>Invoice</button>`);
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'Invoice' });
    expect(prepared.candidates.every((c: any) => /^candidate-\d+$/.test(c.id))).toBe(true);
    expect(dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID, candidate_ids: prepared.candidates.map((c: any) => c.id) }).ok).toBe(true);
  });

  it('redacts long values before truncating labels and regions', () => {
    const secret = 'Q'.repeat(600);
    const { dispatch } = page(`<main><textarea>${secret}</textarea><button>Invoice</button></main>`);
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'edit' });
    expect(JSON.stringify(prepared.candidates)).not.toContain('Q'.repeat(20));
  });

  it.each(['checked', 'focus', 'selected'])('invalidates prepared interactive state changes: %s', kind => {
    const { dom, dispatch } = page('<input id="agree" type="checkbox" aria-label="Agree"><select><option>One</option><option>Two</option></select>');
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'Agree' });
    if (kind === 'checked') (dom.window.document.querySelector('input') as HTMLInputElement).checked = true;
    if (kind === 'focus') (dom.window.document.querySelector('input') as HTMLInputElement).focus();
    if (kind === 'selected') (dom.window.document.querySelector('select') as HTMLSelectElement).selectedIndex = 1;
    expect(dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID }).code).toBe('browser_observation_changed');
  });

  it('spends collection budgets inside hard filters, not on preceding unrelated controls', () => {
    const { dispatch } = page(`<nav>${Array.from({ length: 270 }, (_, i) => `<a href="/x">Link ${i}</a>`).join('')}</nav><main><button>Download invoice</button></main>`);
    const result = dispatch({ action: 'observe', intent: 'Download invoice', region: 'main', role: 'button' });
    expect(result.elements.map((e: any) => e.name)).toEqual(['Download invoice']);
    expect(result.observationOptimization.collectedCount).toBe(1);
    expect(result.observationOptimization.incomplete).toBe(false);
  });

  it('preserves global same-name ordinals for safe same-page relocation', () => {
    const { dom, dispatch } = page('<nav><button>Save</button></nav><main><button id="save">Save</button></main>');
    const observed = dispatch({ action: 'observe', intent: 'Save', region: 'main', role: 'button' });
    dom.window.document.querySelector('#save')!.outerHTML = '<button id="save">Save</button>';
    const result = dispatch({ action: 'click', snapshot_id: observed.snapshotID, element_token: observed.elements[0].token });
    expect(result).toMatchObject({ ok: true, relocated: true });
  });

  it('retains dialogs and limitations after the candidate budget has filled', () => {
    const { dispatch } = page(`<main>${Array.from({ length: 270 }, (_, i) => `<button>Item ${i}</button>`).join('')}</main><dialog open aria-label="Confirmation"><button>Cancel</button></dialog><canvas></canvas>`);
    const result = dispatch({ action: 'observe', intent: 'Item 1' });
    expect(result.observationOptimization.incomplete).toBe(true);
    expect(result.regions.some((r: any) => r.role === 'dialog' && r.name === 'Confirmation')).toBe(true);
    expect(result.limitations.join(' ')).toContain('canvas');
  });

  it('rejects container scrolling and moved geometry before publication', () => {
    const { dom, dispatch } = page('<div style="overflow:auto"><button>Invoice</button></div>');
    let y = 10;
    Object.defineProperty(dom.window.document.querySelector('button'), 'getBoundingClientRect', { value: () => ({ x: 10, y, left: 10, top: y, right: 110, bottom: y + 30, width: 100, height: 30 }) });
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'Invoice' });
    y = -300;
    expect(dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID }).code).toBe('browser_observation_changed');
  });

  it('does not accept fabricated or duplicate candidate ids', () => {
    const { dispatch } = page('<button>Invoice</button><button>Settings</button>');
    for (const invalid of [['new-id'], ['candidate-1', 'candidate-1']]) {
      const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'Invoice' });
      expect(dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID, candidate_ids: invalid }).code).toBe('invalid_browser_candidates');
    }
  });

  it.each(['mutation', 'navigation', 'observe', 'expiry'])('rejects a prepared snapshot after %s', kind => {
    const { dom, dispatch } = page('<button>Invoice</button>');
    const prepared = dispatch({ action: 'prepare_intent_observation', intent: 'Invoice' });
    if (kind === 'mutation') dom.window.document.querySelector('button')!.textContent = 'Delete';
    if (kind === 'navigation') dom.reconfigure({ url: 'https://fixture.invalid/elsewhere' });
    if (kind === 'observe') dispatch({ action: 'observe' });
    if (kind === 'expiry') vi.spyOn(dom.window.Date, 'now').mockReturnValue(Date.now() + 6000);
    const result = dispatch({ action: 'finalize_intent_observation', preparation_id: prepared.preparationID });
    expect(result).toMatchObject({ ok: false, code: 'browser_observation_changed', requiresObservation: true });
    expect(result.snapshotID).toBeUndefined();
  });
});

describe('current browser tool intent contract', () => {
  it('registers intent in both single and batch schemas', () => {
    let definition: any;
    registerBrowser({ registerTool: (tool: any) => { definition = tool; } } as any);
    expect(definition.parameters.properties.intent).toBeDefined();
    expect(definition.parameters.properties.actions.items.properties.intent).toBeDefined();
  });
  it('forwards a local intent in one bridge request, without affecting old observations', async () => {
    bridge.mockResolvedValue({ ok: true, snapshotID: 'local', elements: [] });
    await executeBrowserTool({ action: 'observe', intent: '  invoice  ', role: 'button' });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge.mock.calls[0][1]).toMatchObject({ action: 'observe', intent: 'invoice', role: 'button' });
    bridge.mockClear();
    await executeBrowserTool({ action: 'observe' });
    expect(bridge.mock.calls[0][1]).not.toHaveProperty('intent');
  });
  it.each([{ action: 'click', intent: 'invoice' }, { action: 'observe', intent: '' }, { action: 'observe', intent: 'x', cursor: 0 }])('rejects invalid combinations without a bridge call: %j', async params => {
    expect((await executeBrowserTool(params)).isError).toBe(true);
    expect(bridge).not.toHaveBeenCalled();
  });
  it('never calls the host after cancellation', async () => {
    const abort = new AbortController(); abort.abort();
    expect((await executeBrowserTool({ action: 'observe', intent: 'invoice' }, abort.signal)).isError).toBe(true);
    expect(bridge).not.toHaveBeenCalled();
  });
});

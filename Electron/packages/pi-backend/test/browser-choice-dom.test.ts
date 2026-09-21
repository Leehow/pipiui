import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../resources/runtime/browser-dom/controller.js', import.meta.url), 'utf8');
const windows: JSDOM[] = [];

function page(html: string, url = 'https://fixture.invalid/checkout') {
  const dom = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom);
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', {
    value() { return { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; },
  });
  Object.defineProperty(w.document, 'elementFromPoint', { configurable: true, value: () => w.document.body });
  w.eval(source);
  const dispatch = (params: Record<string, unknown>) => (w as any).__pipiBrowserDOM.dispatch(params);
  return { dom, dispatch, document: w.document };
}

afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); vi.restoreAllMocks(); });

function prepare(dispatch: (params: Record<string, unknown>) => any, intent = 'Go') {
  return dispatch({ action: 'prepare_choice_observation', intent });
}

function execute(dispatch: (params: Record<string, unknown>) => any, prepared: any, extra: Record<string, unknown>) {
  return dispatch({
    action: 'execute_choice',
    snapshot_id: prepared.snapshotID,
    choice_guard: prepared.choiceGuard,
    ...extra,
  });
}

function providerPayload(prepared: any) {
  return {
    goal: prepared.goal,
    candidates: (prepared.candidates || []).map((candidate: any) => ({
      id: candidate.id,
      role: candidate.role,
      name: candidate.name,
      operations: candidate.operations,
      options: candidate.options,
    })),
    scroll: prepared.scroll,
  };
}

describe('choice snapshot + guarded execute', () => {
  it('rejects an oversized Choice envelope without clipping a potential secret boundary or exposing references', () => {
    const { dispatch } = page(`<button aria-label="${'x'.repeat(70_000)}">Go</button>`);
    const prepared = prepare(dispatch, 'Go');
    expect(prepared).toMatchObject({ ok: false, code: 'choice_observation_budget' });
    expect(JSON.stringify(prepared).length).toBeLessThan(1000);
    expect(prepared.choiceGuard).toBeUndefined();
  });

  it('clicks a synthesized button using the snapshot candidate', () => {
    const { dom, dispatch } = page('<main><button id="go">Go</button></main>');
    let clicked = false;
    dom.window.document.querySelector('#go')!.addEventListener('click', () => { clicked = true; });
    const prepared = prepare(dispatch, 'Go');
    expect(prepared).toMatchObject({ ok: true });
    expect(prepared.snapshotID).toBeTruthy();
    expect(prepared.choiceGuard).toBeTruthy();
    expect(prepared.goal).toBe('Go');
    const candidate = prepared.candidates.find((item: any) => item.name === 'Go');
    expect(candidate).toMatchObject({ role: 'button', operations: ['CLICK'] });
    expect(candidate.token).toBeTruthy();
    const result = execute(dispatch, prepared, { operation: 'CLICK', candidate_id: candidate.id });
    expect(result).toMatchObject({ ok: true, consumed: true });
    expect(clicked).toBe(true);
  });

  it('keeps the explicit goal stable after ordinary form values are filled, while still redacting secrets', () => {
    const { dispatch } = page('<input aria-label="Destination" value="Paris"><input type="password" value="private-password">');
    const prepared = prepare(dispatch, 'Find Paris hotels, not private-password');
    expect(prepared.goal).toContain('Paris');
    expect(prepared.goal).not.toContain('private-password');
  });

  it('types into a synthesized input using TYPE_TEXT', () => {
    const { dispatch, document } = page('<main><input id="name" aria-label="Name"></main>');
    const prepared = prepare(dispatch, 'Name');
    const candidate = prepared.candidates.find((item: any) => item.operations?.includes('TYPE_TEXT'));
    expect(candidate).toBeTruthy();
    const result = execute(dispatch, prepared, { operation: 'TYPE_TEXT', candidate_id: candidate.id, text: 'Ada Lovelace' });
    expect(result).toMatchObject({ ok: true, consumed: true });
    expect((document.querySelector('#name') as HTMLInputElement).value).toBe('Ada Lovelace');
  });

  it('maps a native select option id to the real value without exporting it', () => {
    const { dispatch, document } = page(
      '<main><label>Color<select aria-label="Color"><option value="secret-value-blue">Blue</option><option value="secret-value-red">Red</option></select></label></main>',
    );
    const prepared = prepare(dispatch, 'Color');
    const candidate = prepared.candidates.find((item: any) => item.operations?.includes('SELECT'));
    expect(candidate.options.map((item: any) => item.label)).toEqual(['Blue', 'Red']);
    expect(candidate.options.every((item: any) => item.id && !('value' in item))).toBe(true);
    const payload = JSON.stringify(providerPayload(prepared));
    expect(payload).not.toContain('secret-value-blue');
    expect(payload).not.toContain('secret-value-red');
    expect(payload).not.toMatch(/valueHint|locator|https:/);
    const red = candidate.options.find((item: any) => item.label === 'Red');
    const result = execute(dispatch, prepared, { operation: 'SELECT', candidate_id: candidate.id, option_id: red.id });
    expect(result).toMatchObject({ ok: true, consumed: true });
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('secret-value-red');
  });

  it('rejects a wrong snapshot, candidate, option, or unsupported operation without acting', () => {
    const { dom, dispatch } = page(
      '<main><button id="go">Go</button><select aria-label="Color"><option value="blue">Blue</option></select></main>',
    );
    let clicks = 0;
    dom.window.document.querySelector('#go')!.addEventListener('click', () => { clicks += 1; });
    const prepared = prepare(dispatch, 'Go');
    const button = prepared.candidates.find((item: any) => item.name === 'Go');
    const select = prepared.candidates.find((item: any) => item.operations?.includes('SELECT'));
    const wrongSnap = dispatch({
      action: 'execute_choice', snapshot_id: 'missing', choice_guard: prepared.choiceGuard,
      operation: 'CLICK', candidate_id: button.id,
    });
    expect(wrongSnap).toMatchObject({ ok: false, consumed: false, code: 'stale_browser_snapshot' });
    const wrongCandidate = execute(dispatch, prepared, { operation: 'CLICK', candidate_id: 'candidate-999' });
    expect(wrongCandidate).toMatchObject({ ok: false, consumed: true, code: 'invalid_choice_target' });
    const preparedAgain = prepare(dispatch, 'Go');
    const selectAgain = preparedAgain.candidates.find((item: any) => item.operations?.includes('SELECT'));
    const wrongOption = execute(dispatch, preparedAgain, {
      operation: 'SELECT', candidate_id: selectAgain.id, option_id: 'option-999',
    });
    expect(wrongOption).toMatchObject({ ok: false, consumed: true, code: 'invalid_choice_target' });
    const preparedWait = prepare(dispatch, 'Go');
    for (const operation of ['WAIT', 'DONE', 'BLOCKED', 'HOVER']) {
      const refused = execute(dispatch, preparedWait, { operation, candidate_id: button.id });
      expect(refused).toMatchObject({ ok: false, consumed: false, code: 'invalid_choice_operation' });
    }
    expect(clicks).toBe(0);
    expect((dom.window.document.querySelector('select') as HTMLSelectElement).value).toBe('blue');
  });

  it('does not execute after DOM mutation, form-value change, same-name replacement, occlusion, or expiry', () => {
    let clicks = 0;
    const track = () => { clicks += 1; };

    const mutated = page('<main><button id="go">Go</button></main>');
    mutated.document.querySelector('#go')!.addEventListener('click', track);
    const preparedMut = prepare(mutated.dispatch, 'Go');
    const go = preparedMut.candidates.find((item: any) => item.name === 'Go');
    mutated.document.querySelector('#go')!.textContent = 'Stop';
    expect(execute(mutated.dispatch, preparedMut, { operation: 'CLICK', candidate_id: go.id })).toMatchObject({
      ok: false, code: 'stale_browser_snapshot', consumed: true,
    });

    const formPage = page('<main><button id="go">Go</button><input id="note" aria-label="Note" value="draft"></main>');
    formPage.document.querySelector('#go')!.addEventListener('click', track);
    const formChanged = prepare(formPage.dispatch, 'Go');
    const go2 = formChanged.candidates.find((item: any) => item.name === 'Go');
    (formPage.document.querySelector('#note') as HTMLInputElement).value = 'edited';
    expect(execute(formPage.dispatch, formChanged, { operation: 'CLICK', candidate_id: go2.id })).toMatchObject({
      ok: false, code: 'stale_browser_snapshot', consumed: true,
    });

    const replacedPage = page('<main><button id="go">Go</button></main>');
    const preparedRep = prepare(replacedPage.dispatch, 'Go');
    const go3 = preparedRep.candidates.find((item: any) => item.name === 'Go');
    replacedPage.document.querySelector('#go')!.outerHTML = '<button id="go">Go</button>';
    replacedPage.document.querySelector('#go')!.addEventListener('click', track);
    expect(execute(replacedPage.dispatch, preparedRep, { operation: 'CLICK', candidate_id: go3.id })).toMatchObject({
      ok: false, code: 'stale_browser_snapshot', consumed: true,
    });

    const overlay = page('<main><button id="pay">Pay</button><div id="mask">mask</div></main>');
    overlay.document.querySelector('#pay')!.addEventListener('click', track);
    Object.defineProperty(overlay.document, 'elementFromPoint', { value: () => overlay.document.querySelector('#mask') });
    const obscured = prepare(overlay.dispatch, 'Pay');
    const pay = obscured.candidates.find((item: any) => item.name === 'Pay');
    expect(execute(overlay.dispatch, obscured, { operation: 'CLICK', candidate_id: pay.id })).toMatchObject({
      ok: false, code: 'browser_target_obscured', consumed: true,
    });

    const expiring = page('<main><button id="go">Go</button></main>');
    expiring.document.querySelector('#go')!.addEventListener('click', track);
    const prepared = prepare(expiring.dispatch, 'Go');
    const go4 = prepared.candidates.find((item: any) => item.name === 'Go');
    vi.spyOn(expiring.dom.window.Date, 'now').mockReturnValue(Date.now() + 31_000);
    expect(execute(expiring.dispatch, prepared, { operation: 'CLICK', candidate_id: go4.id })).toMatchObject({
      ok: false, code: 'stale_browser_snapshot', consumed: true,
    });
    expect(clicks).toBe(0);
  });

  it('consumes a successful execute and rejects a repeat against the same guard', () => {
    const { dom, dispatch } = page('<main><button id="go">Go</button></main>');
    let clicks = 0;
    dom.window.document.querySelector('#go')!.addEventListener('click', () => { clicks += 1; });
    const prepared = prepare(dispatch, 'Go');
    const candidate = prepared.candidates.find((item: any) => item.name === 'Go');
    expect(execute(dispatch, prepared, { operation: 'CLICK', candidate_id: candidate.id })).toMatchObject({ ok: true, consumed: true });
    expect(execute(dispatch, prepared, { operation: 'CLICK', candidate_id: candidate.id })).toMatchObject({
      ok: false, consumed: false, code: 'stale_browser_snapshot',
    });
    expect(clicks).toBe(1);
  });

  it('excludes sensitive, hidden, and disabled controls from the executable set', () => {
    const { dispatch } = page(`
      <main>
        <input type="password" aria-label="Password" value="private-secret">
        <button hidden>Ghost</button>
        <button disabled>Stopped</button>
        <button id="ok">Continue</button>
      </main>
    `);
    const prepared = prepare(dispatch, 'Continue');
    const names = prepared.candidates.map((item: any) => item.name);
    expect(names).toContain('Continue');
    expect(names).not.toContain('Password');
    expect(names).not.toContain('Ghost');
    expect(names).not.toContain('Stopped');
    expect(JSON.stringify(providerPayload(prepared))).not.toContain('private-secret');
  });

  it('redacts original labels before truncating and errors clearly on redaction overflow', () => {
    const secret = `Q`.repeat(600);
    const labeled = page(`<main><textarea>${secret}</textarea><button>Invoice ${secret}</button></main>`);
    const prepared = prepare(labeled.dispatch, 'Invoice');
    expect(JSON.stringify(prepared.candidates)).not.toContain('Q'.repeat(20));
    expect(prepared.candidates[0].name.length).toBeLessThanOrEqual(512);

    const fields = Array.from({ length: 70 }, (_, i) => `<input aria-label="Field ${i}" value="unique-form-value-${i}-xxxx">`).join('');
    const overflow = page(`<main>${fields}<button>Save</button></main>`);
    const failed = prepare(overflow.dispatch, 'Save');
    expect(failed).toMatchObject({ ok: false, code: 'browser_redaction_capacity_exceeded' });
    expect(failed.snapshotID).toBeUndefined();
    expect(failed.candidates).toBeUndefined();
  });

  it('keeps a single active choice snapshot and ranks by intent without regressing observe', () => {
    const { dispatch } = page(`<main>${Array.from({ length: 80 }, (_, i) => `<button>Item ${i}</button>`).join('')}<button>Download invoice</button></main>`);
    const first = prepare(dispatch, 'Item 1');
    expect(first.candidates.length).toBeLessThanOrEqual(64);
    const second = prepare(dispatch, 'Download invoice');
    expect(second.candidates[0].name).toBe('Download invoice');
    expect(execute(dispatch, first, { operation: 'CLICK', candidate_id: first.candidates[0].id })).toMatchObject({
      ok: false, consumed: false, code: 'stale_browser_snapshot',
    });
    const observed = dispatch({ action: 'observe' });
    expect(observed.ok).toBe(true);
    expect(observed.observationOptimization).toBeUndefined();
  });

  it('collects same-origin shadow controls and reports page scroll without executing WAIT', () => {
    const { dom, dispatch } = page('<main id="root"><button>Outside</button></main>');
    const host = dom.window.document.createElement('div');
    dom.window.document.querySelector('#root')!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Shadow save</button>';
    const root = dom.window.document.scrollingElement || dom.window.document.documentElement;
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 4000 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 500 });
    root.scrollTop = 0;
    const scrolled: unknown[] = [];
    (root as any).scrollBy = (opts: unknown) => { scrolled.push(opts); };
    const prepared = prepare(dispatch, 'Shadow save');
    expect(prepared.candidates.some((item: any) => item.name === 'Shadow save')).toBe(true);
    expect(prepared.scroll).toEqual({ canUp: false, canDown: true });
    const wait = execute(dispatch, prepared, { operation: 'WAIT' });
    expect(wait).toMatchObject({ ok: false, consumed: false, code: 'invalid_choice_operation' });
    expect(scrolled).toEqual([]);
    const down = execute(dispatch, prepared, { operation: 'SCROLL_DOWN' });
    expect(down).toMatchObject({ ok: true, consumed: true });
    expect(scrolled.length).toBeGreaterThan(0);
  });
});

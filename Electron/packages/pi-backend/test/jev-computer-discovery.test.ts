import { describe, expect, it } from 'vitest';
import { GoalIndex, semanticFingerprint, targetAction } from '../../../resources/runtime/extensions/cua-extension/agent/computer-goal-candidates.js';
const observation = (elements: any[], extra: any = {}) => ({ target: { pid: 42, window_id: 77 }, accessibility: { snapshot_id: 's', elements, ...extra } });
const buttons = (count: number) => Array.from({ length: count }, (_, i) => ({ role: 'AXButton', label: `Control ${i + 1}`, element_index: i + 1, element_token: `s:${i + 1}` }));

describe('AX snapshot-local discovery', () => {
  it('ranks a target beyond the old 48-row cut before truncating', () => {
    const nodes = buttons(160); nodes[145].label = '打开导出设置';
    const built = new GoalIndex().build(observation(nodes), '导出设置');
    expect(built.operations[0]).toMatchObject({ id: 'operation_146', actions: [{ type: 'click', element_token: 's:146', snapshot_id: 's' }] });
    expect(built.coverage).toMatchObject({ collected: 160, truncated: true });
    expect(built.operations.length).toBeLessThanOrEqual(48);
  });
  it('pages flat AX without pretending the UI changed or discarding omitted controls', () => {
    const index = new GoalIndex(), obs = observation(buttons(80)), before = semanticFingerprint(obs);
    const first = index.build(obs, 'unrelated');
    expect(first.operations.some(item => item.id === 'operation_65')).toBe(false);
    index.navigate(first.operations.find(item => item.id === 'next_page')!);
    const second = index.build(obs, 'unrelated');
    expect(second.operations.some(item => item.id === 'operation_65')).toBe(true);
    expect(second.operations.find(item => item.id === 'operation_65')?.actions?.[0].element_token).toBe('s:65');
    expect(semanticFingerprint(obs)).toBe(before);
    expect(second.coverage).toMatchObject({ collected: 80, truncated: true });
  });
  it('offers real AX groups while retaining directly actionable controls', () => {
    const nodes = buttons(70).map((node, i) => ({ ...node, region: i < 35 ? 'Editor' : 'Export' }));
    const index = new GoalIndex(), obs = observation(nodes);
    const first = index.build(obs, 'choose');
    expect(first.operations.some(item => item.kind === 'click')).toBe(true);
    const group = first.operations.find(item => item.kind === 'inspect' && item.view?.region === 'Export')!;
    expect(group).toBeDefined(); index.navigate(group);
    const grouped = index.build(obs, 'choose');
    expect(grouped.operations.filter(item => item.kind === 'click').every(item => item.region === 'Export')).toBe(true);
    expect(grouped.operations.some(item => item.id === 'all_groups')).toBe(true);
  });
  it('uses a provided parent label and never invents hierarchy from token text', () => {
    const nodes = [{ role: 'AXGroup', element_index: 500, label: 'Settings' },
      ...buttons(40).map(node => ({ ...node, parent_index: 500 }))];
    const built = new GoalIndex().build(observation(nodes), 'Settings');
    expect(built.operations.some(item => item.description.includes('in Settings'))).toBe(true);
    expect(built.operations.map(item => item.description).join(' ')).not.toMatch(/s:\d+/);
  });
  it('distinguishes same-name controls using only the supplied group metadata', () => {
    const built = new GoalIndex().build(observation([
      { role: 'AXButton', label: 'Enable', group: 'Telemetry', element_token: 's:1' },
      { role: 'AXButton', label: 'Enable', group: 'Spellcheck', element_token: 's:2' },
    ]), 'Enable Spellcheck');
    expect(built.operations[0]).toMatchObject({ description: 'Click button Enable in Spellcheck', actions: [{ type: 'click', element_token: 's:2', snapshot_id: 's' }] });
  });
  it('does not claim complete collection when a driver exceeds the requested AX cap', () => {
    const built = new GoalIndex().build(observation(buttons(2001)), 'Control');
    expect(built.coverage).toMatchObject({ collected: 2000, truncated: true });
  });
  it('rebuilds view bindings after a physical UI change instead of reusing an old page', () => {
    const index = new GoalIndex(), obs = observation(buttons(80));
    index.navigate(index.build(obs, 'unrelated').operations.find(item => item.id === 'next_page')!);
    const next = observation([{ role: 'AXMenuItem', label: 'New choice', element_token: 'new:1' }], { snapshot_id: 'new' });
    const rebuilt = index.build(next, 'choose');
    expect(rebuilt.operations.find(item => item.kind === 'click')?.actions?.[0]).toMatchObject({ element_token: 'new:1', snapshot_id: 'new' });
    expect(rebuilt.operations.some(item => item.id === 'previous_page')).toBe(false);
  });
  it('maps expansion and scrolling to existing real actions, without new subtree RPCs', () => {
    const built = new GoalIndex().build(observation([
      { role: 'AXDisclosureTriangle', label: 'Advanced', element_token: 's:1', expanded: false },
      { role: 'AXScrollArea', label: 'Items', element_token: 's:2' },
    ]), 'Advanced options');
    expect(built.operations.find(item => item.kind === 'click')?.description).toContain('expanded=false');
    expect(built.operations.find(item => item.id === 'scroll_2_down')?.actions).toEqual([{ type: 'scroll', element_token: 's:2', snapshot_id: 's', scroll_direction: 'down', scroll_amount: 3 }]);
  });
  it('keeps incomplete coverage and never offers unsafe or unbound clicks', () => {
    const built = new GoalIndex().build(observation([
      { role: 'AXButton', label: 'No reference' },
      { role: 'AXButton', label: 'Delete account', element_token: 's:1' },
      { role: 'AXButton', label: 'Disabled', element_token: 's:2', enabled: false },
      { role: 'AXSecureTextField', label: 'Password', element_token: 's:3', value: 'secret' },
    ], { truncated: true }), 'continue');
    expect(built.operations.filter(item => item.kind === 'click')).toEqual([]);
    expect(built.operations.filter(item => item.kind === 'scroll')).toEqual([]);
    expect(built.coverage.truncated).toBe(true);
    expect(targetAction({ element_index: 1 }, { accessibility: {} })).toBeUndefined();
  });
});

import { createHash } from 'node:crypto';
import type { ChoiceCandidate } from './computer-choice.js';
export type AxRecord = Record<string, any>;
export type BoundInput = { id: string; label: string; value: string };
export type GoalOperation = ChoiceCandidate & {
  kind: 'click' | 'scroll' | 'inspect' | 'bind' | 'input' | 'key' | 'refresh' | 'wait' | 'finish' | 'handoff'; actions?: AxRecord[];
  region?: string; view?: { region?: string; offset: number }; inputId?: string; inputKey?: string;
};
export const record = (value: unknown): value is AxRecord => !!value && typeof value === 'object' && !Array.isArray(value);
export const roleOf = (node: AxRecord) => String(node.role ?? '').replace(/^AX/i, '').toLowerCase();
export const nameOf = (node: AxRecord) => [node.label, node.name, node.title, node.description].find(value => typeof value === 'string' && value.trim()) ?? '';
export const secure = (node: AxRecord) => /secure|password/.test(roleOf(node)) || node.secure === true || node.is_secure === true || node.sensitive === true
  || /password|passcode|api.?key|access.?token|密码|口令|验证码|密钥/i.test(nameOf(node));
const writable = (node: AxRecord) => ['textfield', 'textarea', 'textbox', 'searchfield', 'combobox'].includes(roleOf(node));
export const consequential = (name: string) => /\b(delete|remove|send|purchase|buy|pay|payment|install|authorize|grant|sign.?in|log.?in)\b|删除|移除|发送|购买|支付|付款|安装|授权|登录/i.test(name);
const clickable = new Set(['button', 'checkbox', 'radiobutton', 'radio', 'popupbutton', 'combobox', 'menuitem', 'menubutton', 'link', 'switch', 'tab', 'disclosuretriangle', 'row', 'cell', 'toolbarbutton', 'menubaritem']);
export function axElements(observation: AxRecord): AxRecord[] {
  return Array.isArray(observation.accessibility?.elements) ? observation.accessibility.elements.filter(record).slice(0, 2000) : [];
}
export function targetAction(node: AxRecord, observation: AxRecord): AxRecord | undefined {
  const token = node.element_token, index = node.element_index ?? node.index;
  const hasToken = typeof token === 'string' && token.length > 0;
  if (!hasToken && (!Number.isInteger(index) || index < 0)) return undefined;
  const snapshot = observation.accessibility?.snapshot_id ?? (hasToken ? /^(.*):\d+$/.exec(token)?.[1] : undefined);
  if (typeof snapshot !== 'string' || !snapshot) return undefined;
  return { ...(hasToken ? { element_token: token } : { element_index: index }), snapshot_id: snapshot };
}
export function semanticFingerprint(observation: AxRecord): string {
  return createHash('sha256').update(JSON.stringify({ window: observation.target?.window_id,
    focus: observation.accessibility?.focused_element_index,
    elements: axElements(observation).map(node => ({ role: roleOf(node), name: nameOf(node),
      value: secure(node) ? undefined : node.value, selected: node.selected, checked: node.checked,
      enabled: node.enabled, expanded: node.expanded, region: node.region ?? node.group, parent: node.parent_index ?? node.parent_id })) })).digest('hex');
}
export function observationRedactions(observation: AxRecord): string[] {
  // Text field values remain local, including echoes in labels. Checkbox state
  // such as "on"/"off" is not a text secret and must not redact operation IDs.
  return axElements(observation).flatMap(node => (secure(node) || /textfield|textarea|textbox|searchfield|combobox/.test(roleOf(node)) || node.editable === true)
    && typeof node.value === 'string' && node.value ? [node.value] : []);
}
function controlState(node: AxRecord): string {
  const flags = ['checked', 'selected', 'expanded'].flatMap(key => typeof node[key] === 'boolean' ? [`${key}=${node[key]}`] : []);
  if (/checkbox|radio|switch/.test(roleOf(node)) && ['0', '1', 'true', 'false', 'on', 'off'].includes(String(node.value))) flags.push(`value=${node.value}`);
  return flags.length ? ` (${flags.join(', ')})` : '';
}
function regionOf(node: AxRecord, elements: AxRecord[]): string | undefined {
  const region = node.region ?? node.group;
  if (typeof region === 'string' && region.trim()) return region;
  const parentId = node.parent_index ?? node.parent_id;
  if (parentId === undefined) return undefined;
  const parent = elements.find(item => (item.element_index ?? item.index) === parentId || item.element_token === parentId || item.id === parentId);
  return parent && nameOf(parent) || undefined;
}
function relevance(goal: string, description: string): number {
  const text = description.toLowerCase(), query = goal.toLowerCase();
  const tokens = [...(query.match(/[a-z0-9]+/g) ?? []), ...(query.match(/[\u3400-\u9fff]+/g) ?? []).flatMap(word => Array.from(word).slice(1).map((_, i) => word.slice(i, i + 2)))];
  return tokens.reduce((score, token) => score + (text.includes(token) ? token.length : 0), 0);
}
/** Views only select within a frozen snapshot; physical discovery still uses the existing driver. */
export class GoalIndex {
  private fingerprint = '';
  private view: { region?: string; offset: number } = { offset: 0 };
  private visited = new Set<string>();
  private seenCandidates = new Set<string>();
  private readonly inputs: readonly BoundInput[];
  private activeInput?: string;
  private appliedInputs = new Set<string>();
  constructor(inputs: readonly BoundInput[] = []) { this.inputs = inputs; if (inputs.length === 1) this.activeInput = inputs[0].id; }
  bind(operation: GoalOperation): void {
    if (!this.inputs.some(input => input.id === operation.inputId)) throw new Error('invalid input binding');
    this.activeInput = operation.inputId;
  }
  applied(operation: GoalOperation): void { if (operation.inputKey) this.appliedInputs.add(operation.inputKey); }
  inputOutcome(operation: GoalOperation, observation: AxRecord): 'matched' | 'unverified' | 'mismatch' {
    const input = this.inputs.find(item => item.id === operation.inputId), field = operation.actions?.[1]?.goalField;
    if (!input || !field) return 'unverified';
    const elements = axElements(observation);
    const matches = elements.filter(node => roleOf(node) === field.role && nameOf(node) === field.name && regionOf(node, elements) === operation.region);
    if (matches.length !== 1 || typeof matches[0].value !== 'string') return 'unverified';
    return matches[0].value === input.value ? 'matched' : 'mismatch';
  }
  navigate(operation: GoalOperation): void {
    if (operation.kind !== 'inspect' || !operation.view) throw new Error('invalid index navigation');
    this.view = operation.view; this.visited.add(JSON.stringify(this.view));
  }
  build(observation: AxRecord, goal: string) {
    const fingerprint = semanticFingerprint(observation);
    if (fingerprint !== this.fingerprint) { this.fingerprint = fingerprint; this.view = { offset: 0 }; this.visited.clear(); this.seenCandidates.clear(); }
    const elements = axElements(observation), operations: GoalOperation[] = [];
    const input = this.inputs.find(item => item.id === this.activeInput);
    const fieldIdentity = (node: AxRecord) => JSON.stringify([roleOf(node), nameOf(node), regionOf(node, elements)]);
    const fieldCounts = new Map<string, number>();
    for (const node of elements.filter(writable)) { const identity = fieldIdentity(node); fieldCounts.set(identity, (fieldCounts.get(identity) ?? 0) + 1); }
    for (const [index, node] of elements.entries()) {
      const target = targetAction(node, observation), name = nameOf(node), region = regionOf(node, elements);
      if (!target || !name || secure(node) || node.enabled === false || node.disabled === true
        || node.is_enabled === false || node.visible === false || node.is_visible === false || consequential(name)) continue;
      if (clickable.has(roleOf(node))) operations.push({ id: `operation_${index + 1}`, kind: 'click', region,
        description: `Click ${roleOf(node)} ${name}${controlState(node)}${region ? ` in ${region}` : ''}`, actions: [{ type: 'click', ...target }] });
      if (writable(node) && fieldCounts.get(fieldIdentity(node)) === 1 && !/terminal|console|shell|command|终端|控制台|命令/i.test(name)) {
        const fieldIndex = node.element_index ?? node.index ?? Number(/:(\d+)$/.exec(String(node.element_token))?.[1]);
        if (Number.isInteger(fieldIndex) && fieldIndex >= 0) {
          const goalField = { index: fieldIndex, role: roleOf(node), name, region };
          const inputKey = JSON.stringify([observation.target?.window_id, fieldIdentity(node), input?.id]);
          if (input && node.value !== input.value && !this.appliedInputs.has(inputKey)) operations.push({
            id: `input_${index + 1}_${this.inputs.indexOf(input) + 1}`, kind: 'input', region, inputId: input.id, inputKey,
            description: `Fill ${roleOf(node)} ${name}${region ? ` in ${region}` : ''} with provided input ${input.label}; literal value stays local`,
            actions: [{ type: 'click', ...target }, { type: 'key', keys: ['CMD', 'A'], goalField },
              input.value ? { type: 'type', text: input.value, goalField } : { type: 'key', keys: ['BACKSPACE'], goalField }],
          });
          if (observation.accessibility?.focused_element_index === fieldIndex && /search|find|filter|搜索|查找|筛选/i.test(name)) operations.push({
            id: `submit_search_${index + 1}`, kind: 'key', region, description: `Press Return in focused search field ${name}`,
            actions: [{ type: 'key', ...target, keys: ['RETURN'], goalField }],
          });
        }
      }
      if (['scrollarea', 'list', 'outline', 'table'].includes(roleOf(node))) for (const direction of ['down', 'up']) operations.push({
        id: `scroll_${index + 1}_${direction}`, kind: 'scroll', region, description: `Scroll ${direction} in ${name} to discover more controls`,
        actions: [{ type: 'scroll', ...target, scroll_direction: direction, scroll_amount: 3 }],
      });
    }
    for (const [index, available] of this.inputs.entries()) if (available.id !== this.activeInput) operations.push({
      id: `bind_${index + 1}`, kind: 'bind', inputId: available.id, description: `Use the provided input ${available.label} for subsequent field selection; value stays local`,
    });
    const regions = [...new Set(operations.map(item => item.region).filter((value): value is string => !!value))];
    let pool = this.view.region ? operations.filter(item => item.kind === 'bind' || item.region === this.view.region) : [...operations];
    if (!this.view.region && operations.length > 36) for (const [index, region] of regions.entries()) {
      const preview = operations.filter(item => item.region === region).slice(0, 3).map(item => item.description).join('; ');
      pool.splice(index, 0, { id: `region_${index + 1}`, kind: 'inspect', description: `Inspect AX group ${region}: ${preview}`, view: { region, offset: 0 } });
    }
    pool = pool.map((item, index) => ({ item, index, score: relevance(goal, item.description) }))
      .sort((a, b) => b.score - a.score || a.index - b.index).map(({ item }) => item);
    const offset = Math.min(this.view.offset, Math.max(0, Math.floor((pool.length - 1) / 36) * 36));
    const selected = pool.slice(offset, offset + 36);
    const navigation = (id: string, description: string, view: { region?: string; offset: number }) => selected.push({
      id, kind: 'inspect', description: description + (this.visited.has(JSON.stringify(view)) ? ' (previously inspected)' : ''), view,
    });
    if (offset + 36 < pool.length) navigation('next_page', 'Inspect the next page of AX candidates; omitted controls have not been ruled out', { ...this.view, offset: offset + 36 });
    if (offset > 0) navigation('previous_page', 'Inspect the previous page of AX candidates', { ...this.view, offset: offset - 36 });
    if (this.view.region) navigation('all_groups', 'Return to all AX groups', { offset: 0 });
    // Without a real scroll container there is no snapshot-bound scroll target.
    selected.push({ id: 'refresh', kind: 'refresh', description: 'Read a fresh accessibility snapshot of the pinned window' },
      { id: 'wait', kind: 'wait', description: 'Wait briefly for the current UI to settle', actions: [{ type: 'wait', duration_ms: 250 }] },
      { id: 'finish', kind: 'finish', description: 'The observed UI appears to satisfy the goal; stop for independent verification' },
      { id: 'handoff', kind: 'handoff', description: 'Stop: missing input, sensitive or consequential action, unsupported controls, or insufficient evidence' });
    const concrete = selected.filter(item => item.actions?.some(action => !['wait', 'screenshot'].includes(action.type)));
    const discovered = concrete.some(item => !this.seenCandidates.has(item.id));
    for (const item of concrete) this.seenCandidates.add(item.id);
    const omitted = Math.max(0, pool.length - Math.min(36, pool.length - offset));
    return { operations: selected, discovered, coverage: { collected: elements.length, omitted,
      truncated: observation.accessibility?.truncated === true || (observation.accessibility?.elements?.length ?? 0) > 2000 || omitted > 0 } };
  }
}

import { describe, expect, it } from 'vitest';
import { BashDetailsStore, boundedText, bashInputSummary, maskBashWindowEdges } from '../src/bash-details.js';

describe('bash UI detail snapshots', () => {
  it('masks secrets split by a worker window or page boundary', () => {
    const secrets = [{ value: 'private-token-value', envName: 'TOKEN' }];
    expect(maskBashWindowEdges('line private-tok', secrets, false, true)).toBe('line {{secret:TOKEN}}');
    expect(maskBashWindowEdges('en-value next', secrets, true, false)).toBe('{{secret:TOKEN}} next');
    expect(maskBashWindowEdges('line private-tok', secrets, false, false)).toBe('line private-tok');
  });
  it('bounds UTF-8 text without broken characters', () => {
    expect(boundedText('你好世界', false, 7)).toBe('你好');
    expect(boundedText('你好世界', true, 7)).toBe('世界');
    expect(boundedText('😀'.repeat(100), true, 9)).toBe('😀😀');
  });
  it('isolates calls and sessions and never revives terminal snapshots', () => {
    const store = new BashDetailsStore();
    store.set('a', 'call', { input: 'first', output: 'live' });
    store.set('b', 'call', { input: 'second', output: 'other' });
    const revision = store.get('a', 'call')!.revision;
    store.set('a', 'call', { output: 'done', state: 'completed' });
    store.set('a', 'call', { output: 'late', state: 'running' });
    expect(store.get('a', 'call')).toMatchObject({ input: 'first', output: 'done', state: 'completed' });
    expect(store.get('a', 'call')!.revision).toBeGreaterThan(revision);
    expect(store.get('b', 'call')!.output).toBe('other');
    store.interrupt('b');
    expect(store.get('b', 'call')!.state).toBe('interrupted');
  });
  it('caps total body bytes and even empty entry count', () => {
    const store = new BashDetailsStore(1024);
    for (let i = 0; i < 1000; i++) store.set('s', String(i), { output: 'x'.repeat(300) });
    expect(store.retainedBytes).toBeLessThanOrEqual(1024);
    expect(store.get('s', '0')).toBeUndefined();
    expect(store.get('s', '999')!.output).toHaveLength(300);
    store.clear();
    for (let i = 0; i < 1000; i++) store.set('s', String(i), {});
    expect(store.count).toBe(512);
    store.clear();
    expect(store.count).toBe(0);
    expect(store.retainedBytes).toBe(0);
  });
  it('retains bounded input head/output tail and marks truncation', () => {
    const store = new BashDetailsStore();
    store.set('s', 'c', { input: 'start' + 'x'.repeat(100000), output: 'x'.repeat(100000) + 'end' });
    const value = store.get('s', 'c')!;
    expect(value.input.startsWith('start')).toBe(true);
    expect(value.output.endsWith('end')).toBe(true);
    expect(value.inputTruncated && value.outputTruncated).toBe(true);
    expect(Buffer.byteLength(value.input + value.output)).toBeLessThanOrEqual(65536);
    expect(JSON.parse(bashInputSummary({ command: 'a'.repeat(10000) })).command).toHaveLength(120);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { BashDetailStore, createBashDetailConsumer, handleBashDetailCommand, BASH_DETAIL_PAGE_BYTES } from '../bash-details.ts';

const id = { agentId: 'worker', runId: 'run-one', toolCallId: 'bash-one' };
const request = { ...id, requestId: 'request-one' };
const result = (text: string) => ({ content: [{ type: 'text', text }] });
const start = (store: BashDetailStore, identity = id, command = 'echo hello') => store.consume(identity.agentId, identity.runId, { type: 'tool_execution_start', toolName: 'bash', toolCallId: identity.toolCallId, args: { command } });

describe('worker bash details', () => {
  it('isolates tools and exact runs, replacing cumulative snapshots without reports', () => {
    const store = new BashDetailStore();
    const report = vi.fn();
    start(store); start(store, { ...id, runId: 'run-two' }, 'second');
    start(store, { ...id, toolCallId: 'other' }, 'third');
    for (const text of ['a', 'ab', 'abc']) store.consume(id.agentId, id.runId, { type: 'tool_execution_update', toolCallId: id.toolCallId, partialResult: result(text) });
    expect(store.read(request)).toMatchObject({ input: JSON.stringify({ command: 'echo hello' }), output: 'abc', state: 'running' });
    expect(store.read({ ...request, runId: 'run-two' })).toMatchObject({ input: JSON.stringify({ command: 'second' }), output: '' });
    expect(store.read({ ...request, toolCallId: 'other' })).toMatchObject({ input: JSON.stringify({ command: 'third' }), output: '' });
    expect(report).not.toHaveBeenCalled();
  });
  it('captures toolcall_end and authoritative message_end without execution_end', () => {
    const store = new BashDetailStore();
    store.consume(id.agentId, id.runId, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', toolCall: { type: 'toolCall', id: id.toolCallId, name: 'bash', arguments: { command: 'false' } } } });
    store.consume(id.agentId, id.runId, { type: 'message_end', message: { role: 'toolResult', toolName: 'bash', toolCallId: id.toolCallId, isError: true, ...result('failure') } });
    store.consume(id.agentId, id.runId, { type: 'tool_execution_update', toolCallId: id.toolCallId, partialResult: result('late') });
    start(store);
    expect(store.read(request)).toMatchObject({ state: 'failed', output: 'failure', input: JSON.stringify({ command: 'false' }) });
  });
  it('execution_end settles before duplicate authoritative message and interruption does not revive it', () => {
    const store = new BashDetailStore(); start(store);
    store.consume(id.agentId, id.runId, { type: 'tool_execution_end', toolCallId: id.toolCallId, toolName: 'bash', result: result('done') });
    store.interrupt(id.agentId, id.runId);
    expect(store.read(request)).toMatchObject({ state: 'completed', output: 'done' });
  });
  it('marks open tools interrupted, retains ended-run lookup and clears all body on shutdown', () => {
    const store = new BashDetailStore(); start(store); start(store, { ...id, runId: 'run-two' });
    store.interrupt(id.agentId, id.runId);
    store.update(id, result('late'));
    expect(store.read(request)).toMatchObject({ state: 'interrupted', output: '' });
    expect(store.read({ ...request, runId: 'run-two' })).toMatchObject({ state: 'running' });
    store.close(); start(store); expect(store.stats).toEqual({ bytes: 0, entries: 0 });
    expect(store.read(request)).toEqual({ state: 'unavailable' });
  });
  it('UTF8 input pages roundtrip, tail stays bounded and live body is at most 64KiB', () => {
    const store = new BashDetailStore(); const command = '🙂你好'.repeat(24000); start(store, id, command);
    store.update(id, result(command));
    const live: any = store.read(request);
    expect(Buffer.byteLength(live.input) + Buffer.byteLength(live.output)).toBeLessThanOrEqual(65536);
    expect(live.output).not.toContain('�'); expect(live.outputTruncated).toBe(true);
    let offset = 0, joined = '';
    do {
      const page: any = store.read({ ...request, field: 'input', offset });
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(BASH_DETAIL_PAGE_BYTES);
      expect(page.text).not.toContain('�'); joined += page.text; offset = page.nextOffset;
    } while (offset !== undefined);
    expect(joined).toBe(JSON.stringify({ command }));
    expect(store.read({ ...request, field: 'input', offset: 13 })).toEqual({ state: 'unavailable' });
    expect(store.read({ ...request, sinceRevision: live.revision })).toMatchObject({ unchanged: true });
    const ascii = new BashDetailStore();
    start(ascii, { ...id, toolCallId: 'ascii' }, 'echo ascii');
    ascii.update({ ...id, toolCallId: 'ascii' }, result('0123456789'));
    const asciiLive: any = ascii.read({ ...request, toolCallId: 'ascii' });
    expect(ascii.read({ ...request, toolCallId: 'ascii', field: 'output', offset: 6, sinceRevision: asciiLive.revision })).toMatchObject({ text: '6789', state: 'running' });
    expect(ascii.read({ ...request, toolCallId: 'ascii', field: 'output', offset: 6, sinceRevision: asciiLive.revision + 1 })).toEqual({ state: 'unavailable' });
  });
  it('caps 256KiB input and global bytes/entries with LRU unavailable eviction', () => {
    const store = new BashDetailStore(); start(store, id, 'x'.repeat(300000));
    const page: any = store.read({ ...request, field: 'input' });
    expect(page.totalBytes).toBe(262144); expect(page.truncated).toBe(true);
    const small = new BashDetailStore(48, 2);
    start(small, id, '1234567890'); start(small, { ...id, runId: 'two' }, '1234567890');
    small.read(request); start(small, { ...id, runId: 'three' }, '1234567890');
    expect(small.stats).toEqual({ bytes: 48, entries: 2 });
    expect(small.read({ ...request, runId: 'two' })).toEqual({ state: 'unavailable' });
  });
  it('reports only requested body and validates commands without chat notifications', async () => {
    const store = new BashDetailStore(); start(store);
    const report = vi.fn(async () => {});
    await handleBashDetailCommand(encodeURIComponent(JSON.stringify(request)), store, report);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'bash_detail', agentId: id.agentId, runId: id.runId, requestId: request.requestId, detail: expect.objectContaining({ input: expect.stringContaining('echo hello') }) }));
  });
  it('wires stdout capture, close cleanup and a command rather than a model tool', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).toContain('consumeBashDetail(event)');
    expect(source).toContain('createBashDetailConsumer(workerBashDetails, pipiuiAgentId, runId, pipiuiReport)');
    expect(source).toContain('workerBashDetails.interrupt(pipiuiAgentId, runId)');
    expect(source).toContain('workerBashDetails.close()');
    expect(source).toContain('pi.registerCommand("subagent_bash_detail"');
    expect(source).not.toMatch(/registerTool\(\{\s*name:\s*"subagent_bash_detail"/);
    const adapter = readFileSync(new URL('../bash-details.ts', import.meta.url), 'utf8');
    const consume = adapter.slice(adapter.indexOf('\tconsume('), adapter.indexOf('\n/** One closure per run'));
    expect(consume).not.toMatch(/report\(|setInterval|writeFile|pipiuiReport/);
  });
  it.each(['toolcall_end', 'tool_execution_start'])('announces readiness once per run from %s, without body', (type) => {
    const store = new BashDetailStore();
    const report = vi.fn();
    const consume = createBashDetailConsumer(store, id.agentId, id.runId, report);
    const args = { command: 'echo secret', timeout: 91 };
    const call = { type: 'toolCall', name: 'bash', id: id.toolCallId, arguments: args };
    const event = type === 'toolcall_end'
      ? { type: 'message_update', assistantMessageEvent: { type, toolCall: call } }
      : { type, toolName: 'bash', toolCallId: id.toolCallId, args };
    consume({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'read-one', args: {} });
    expect(report).not.toHaveBeenCalled();
    consume(event); consume(event);
    consume({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'second-bash', args });
    consume({ type: 'tool_execution_update', toolCallId: id.toolCallId, partialResult: result('private output') });
    consume({ type: 'tool_execution_end', toolCallId: id.toolCallId, result: result('done') });
    expect(report.mock.calls).toEqual([[{ kind: 'bash_detail_ready', agentId: id.agentId, runId: id.runId, ownerPid: process.pid }]]);
    expect(store.read(request)).toMatchObject({ input: JSON.stringify(args), state: 'completed', output: 'done' });
    const anotherRun = createBashDetailConsumer(store, id.agentId, 'run-two', report);
    anotherRun(event);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ kind: 'bash_detail_ready', agentId: id.agentId, runId: 'run-two', ownerPid: process.pid });
    store.close();
    createBashDetailConsumer(store, id.agentId, 'run-three', report)(event);
    expect(report).toHaveBeenCalledTimes(2);
  });
  it.each([{ offset: -1 }, { offset: 0.5 }, { field: 'file' }, { path: '/etc/passwd' }, { sinceRevision: -1 }, { requestId: 'x'.repeat(161) }, { toolCallId: 'x'.repeat(513) }])('fails closed for invalid request %j', async (invalid) => {
    const store = new BashDetailStore(); start(store);
    const report = vi.fn(async () => {});
    await handleBashDetailCommand(encodeURIComponent(JSON.stringify({ ...request, ...invalid })), store, report);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { state: 'unavailable' } }));
  });
});

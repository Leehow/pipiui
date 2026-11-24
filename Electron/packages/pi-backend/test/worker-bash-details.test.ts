import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiHostBackend } from '../src/index.js';
import { putSecret, mountSecret } from '../src/secret-vault.js';
import { BashDetailStore, createBashDetailConsumer, handleBashDetailCommand } from '../../../resources/runtime/pi-ext/subagent/bash-details.ts';

let root = '';
let backend: ReturnType<typeof createPiHostBackend>;
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); if (backend) await backend.close(); if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); });
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'pipi-worker-bash-'));
  const cwd = join(root, 'project');
  const sessionsRoot = join(root, 'sessions');
  await mkdir(cwd, { recursive: true });
  await mkdir(join(sessionsRoot, 'project'), { recursive: true });
  await writeFile(join(sessionsRoot, 'project/s.jsonl'), JSON.stringify({ type: 'session', version: 3, id: 's', cwd }) + '\n');
  backend = createPiHostBackend({ agentDir: join(root, 'agent'), sessionsRoot, runtimeRoot: root, piPath: process.execPath });
  const internal = backend as any;
  const owner = { runtimeToken: 1, process: { pid: process.pid } };
  vi.spyOn(internal, 'liveSessionProcess').mockReturnValue(owner);
  const emit = (event: object, sessionId = 's') => internal.mapAgentEvent(event, sessionId);
  emit({ kind: 'start', agentId: 'worker', runId: 'r1', name: 'general-purpose' });
  emit({ kind: 'log', agentId: 'worker', runId: 'r1', items: [
    { itemType: 'tool', name: 'bash', toolCallId: 'call', text: 'x'.repeat(2000) },
    { itemType: 'toolResult', toolCallId: 'call', text: 'OLD_RESULT_TAIL' },
  ] });
  return { internal, emit, owner };
}

describe('worker bash details', () => {
  it('does not preload adjacent legacy bash results without call ids', async () => {
    const { emit } = await fixture();
    emit({ kind: 'log', agentId: 'worker', runId: 'r1', items: [
      { itemType: 'tool', name: 'bash', text: 'echo old' },
      { itemType: 'toolResult', text: 'LEGACY_BASH_BODY' },
      { itemType: 'tool', name: 'read', text: 'a.txt' },
      { itemType: 'toolResult', text: 'READ_BODY' },
    ] });
    const logs = await backend.handle('getAgentLogs', ['worker', 's', 'r1']);
    expect(JSON.stringify(logs)).not.toContain('LEGACY_BASH_BODY');
    expect(JSON.stringify(logs)).toContain('READ_BODY');
  });
  it('does not skip ordinary characters when redaction expands a worker page', async () => {
    const { internal, emit } = await fixture();
    await putSecret(join(root, 'agent'), { name: 'page', envName: 'VERY_LONG_TOKEN_VARIABLE_NAME', value: 'abcDEF12' });
    await mountSecret(join(root, 'agent'), 's', 'page');
    const store = new BashDetailStore();
    const consume = createBashDetailConsumer(store, 'worker', 'r1', event => emit(event));
    consume({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'pages', args: { command: 'x'.repeat(32710) + 'abcDEF12' + 'z'.repeat(100) } });
    vi.spyOn(internal, 'writeCommand').mockImplementation(async (_owner: unknown, wire: any) => {
      await handleBashDetailCommand(wire.message.slice('/subagent_bash_detail '.length), store, async event => { emit(event); });
    });
    let offset: number | undefined = 0;
    let combined = '';
    let count = 0;
    while (offset !== undefined) {
      const page: any = await backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'pages', field: 'input', offset }]);
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(32768);
      combined += page.text;
      offset = page.nextOffset;
      if (++count > 5) throw new Error('pagination did not advance');
    }
    expect(combined).not.toContain('abcDEF12');
    expect(combined.match(/x/g)?.length).toBe(32710);
    expect(combined.match(/z/g)?.length).toBe(100);
  });
  it('round-trips the actual runtime command and consumer without broadcasting stdout', async () => {
    const { internal, emit } = await fixture();
    const store = new BashDetailStore();
    const consume = createBashDetailConsumer(store, 'worker', 'r1', event => emit(event));
    const frames: unknown[] = [];
    backend.subscribe(frame => frames.push(frame));
    consume({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'live-call', args: { command: 'echo FULL_COMMAND', timeout: 7 } });
    consume({ type: 'tool_execution_update', toolName: 'bash', toolCallId: 'live-call', partialResult: { content: [{ type: 'text', text: 'RUNTIME_PRIVATE_BODY' }] } });
    expect(JSON.stringify(frames)).not.toContain('RUNTIME_PRIVATE_BODY');
    vi.spyOn(internal, 'writeCommand').mockImplementation(async (_owner: unknown, wire: any) => {
      await handleBashDetailCommand(wire.message.slice('/subagent_bash_detail '.length), store, async event => { emit(event); });
      return {};
    });
    const details: any = await backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'live-call' }]);
    expect(details.state).toBe('running');
    expect(details.output).toBe('RUNTIME_PRIVATE_BODY');
    expect(details.input).toContain('FULL_COMMAND');
    expect(details.input).toContain('timeout');
    expect(JSON.stringify(frames)).not.toContain('RUNTIME_PRIVATE_BODY');
    store.close();
  });
  it('returns summary-only logs, with old tails available only through explicit detail reads', async () => {
    await fixture();
    const logs: any = await backend.handle('getAgentLogs', ['worker', 's', 'r1']);
    expect(logs[0].text.length).toBeLessThanOrEqual(120);
    expect(logs[1].text).toBe('');
    const details = await backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' }]);
    expect(details).toMatchObject({ state: 'unavailable', output: 'OLD_RESULT_TAIL', outputTruncated: true });
  });
  it('does not send an unknown slash command to an old runtime', async () => {
    const { internal } = await fixture();
    const command = vi.spyOn(internal, 'writeCommand');
    await backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' }]);
    expect(command).not.toHaveBeenCalled();
  });
  it('accepts only a matching point-to-point reply and never broadcasts its body', async () => {
    const { internal, emit } = await fixture();
    emit({ kind: 'bash_detail_ready', agentId: 'worker', runId: 'r1', ownerPid: process.pid });
    const frames: unknown[] = [];
    backend.subscribe(frame => frames.push(frame));
    vi.spyOn(internal, 'writeCommand').mockImplementation(async (_owner: unknown, wire: any) => {
      const request = JSON.parse(decodeURIComponent(wire.message.split(' ')[1]));
      emit({ kind: 'bash_detail', agentId: 'worker', runId: 'wrong', requestId: request.requestId, detail: { state: 'completed', output: 'WRONG_RUN' } });
      emit({ kind: 'bash_detail', agentId: 'worker', runId: 'r1', requestId: request.requestId, detail: { state: 'running', revision: 2, output: 'LIVE_PRIVATE' } });
      return {};
    });
    const details = await backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' }]);
    expect(details).toMatchObject({ identity: { sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' }, output: 'LIVE_PRIVATE', state: 'running' });
    expect(JSON.stringify(frames)).not.toContain('LIVE_PRIVATE');
    expect(JSON.stringify(frames)).not.toContain('WRONG_RUN');
    expect(internal.workerBashRequests.size).toBe(0);
  });
  it('releases a timed-out detail request and reports a retryable error', async () => {
    const { internal, emit } = await fixture();
    emit({ kind: 'bash_detail_ready', agentId: 'worker', runId: 'r1', ownerPid: process.pid });
    vi.spyOn(internal, 'writeCommand').mockResolvedValue({});
    vi.useFakeTimers();
    const pending = internal.readWorkerBashDetails({ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' });
    const assertion = expect(pending).rejects.toThrow('读取超时');
    await vi.advanceTimersByTimeAsync(2600);
    await assertion;
    expect(internal.workerBashRequests.size).toBe(0);
  });

  it('does not reuse readiness after the owner process is replaced, including a send-time race', async () => {
    const { internal, emit, owner } = await fixture();
    emit({ kind: 'bash_detail_ready', agentId: 'worker', runId: 'r1', ownerPid: process.pid });
    const write = vi.spyOn(internal, 'writeCommand');
    const replacement = { runtimeToken: 2, process: { pid: process.pid + 1 } };
    internal.liveSessionProcess.mockReturnValue(replacement);
    // A late handshake from the old process must not bless the replacement.
    emit({ kind: 'bash_detail_ready', agentId: 'worker', runId: 'r1', ownerPid: process.pid });
    expect(await internal.readWorkerBashDetails({ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' })).toMatchObject({ state: 'unavailable' });
    internal.liveSessionProcess.mockReset().mockReturnValueOnce(owner).mockReturnValue(replacement);
    expect(await internal.readWorkerBashDetails({ sessionId: 's', agentId: 'worker', runId: 'r1', toolCallId: 'call' })).toMatchObject({ state: 'unavailable' });
    expect(write).not.toHaveBeenCalled();
    expect(internal.workerBashRequests.size).toBe(0);
  });

  it('rejects ambiguous worker identity instead of falling through to the main session', async () => {
    await fixture();
    await expect(backend.handle('getBashDetails', [{ sessionId: 's', agentId: 'worker', toolCallId: 'call' }])).rejects.toThrow('Exact worker run');
  });
});

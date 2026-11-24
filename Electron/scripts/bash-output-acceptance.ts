/**
 * Single-process transport stress for bash detail on-demand loading.
 * Not a UI interaction latency test, not real IPC, and not 40 model workers.
 *
 * Usage (from repo root or Electron/):
 *   node --experimental-strip-types Electron/scripts/bash-output-acceptance.ts
 *   node --experimental-strip-types scripts/bash-output-acceptance.ts --seconds 1
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

// The mandated runner is strip-types, which cannot load parameter properties in the
// real modules. Re-exec once under transform-types; this file itself stays strip-safe.
if (process.env.BASH_OUTPUT_ACCEPTANCE_RUNTIME !== 'transform') {
  const child = spawnSync(process.execPath, ['--experimental-transform-types', process.argv[1]!, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, BASH_OUTPUT_ACCEPTANCE_RUNTIME: 'transform' },
  });
  process.exit(child.status ?? 1);
}

const { BashDetailStore, createBashDetailConsumer, handleBashDetailCommand } = await import('../resources/runtime/pi-ext/subagent/bash-details.ts');
const { BashDetailsStore } = await import('../packages/pi-backend/src/bash-details.ts');

const COMMANDS = 40;
const TICK_MS = 100;
const BYTES_PER_TICK = Math.round((32 * 1024 * TICK_MS) / 1000); // ~32 KiB/s
const SNAPSHOT_BYTES = 50 * 1024;
const BODY_BUDGET = 8 * 1024 * 1024;
const ENTRY_BUDGET = 512;
const READS_PER_SEC = 5;

type Mode = 'baseline' | 'collapsed' | 'one' | 'many';

const secondsArg = process.argv.find((arg, i) => process.argv[i - 1] === '--seconds');
const SECONDS = Math.max(1, Number(secondsArg ?? 60) || 60);
const TICKS = Math.floor((SECONDS * 1000) / TICK_MS) + 1;
const CHUNK = 'x'.repeat(BYTES_PER_TICK);

function progressDir(): string {
  const cwd = process.cwd();
  const root = cwd.endsWith('/Electron') || cwd.endsWith('\\Electron') ? resolve(cwd, '..') : cwd;
  return resolve(root, '.pi/progress');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

interface CaseResult {
  name: Mode;
  wallSec: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssPeak: number;
  heapPeak: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  bodyTransferBytes: number;
  bodyRefreshCount: number;
  readySummaryCount: number;
  generatedSnapshotBytes: number;
  workerBytes: number;
  workerEntries: number;
  hostBytes: number;
  hostEntries: number;
  requestedToolIds: string[];
  foreignBodyReports: number;
  resurrectionOk: boolean | null;
}

const failures: string[] = [];
function check(cond: boolean, message: string) {
  if (!cond) failures.push(message);
}

async function runCase(mode: Mode): Promise<CaseResult> {
  const worker = new BashDetailStore();
  const host = new BashDetailsStore();
  const agentId = 'stress-agent';
  const runId = `stress-${mode}`;
  let readySummaryCount = 0;
  let bodyTransferBytes = 0;
  let bodyRefreshCount = 0;
  let foreignBodyReports = 0;
  const requested = new Set<string>();
  const consumer = mode === 'baseline'
    ? null
    : createBashDetailConsumer(worker, agentId, runId, () => { readySummaryCount++; });

  const tails = Array.from({ length: COMMANDS }, () => '');
  const ids = Array.from({ length: COMMANDS }, (_, i) => `bash-${mode}-${i}`);
  if (consumer) {
    for (const toolCallId of ids) {
      const started = {
        type: 'tool_execution_start',
        toolName: 'bash',
        toolCallId,
        args: { command: `stress ${toolCallId}` },
      };
      consumer(JSON.parse(JSON.stringify(started)));
    }
  }

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const cpu0 = process.cpuUsage();
  let rssPeak = 0;
  let heapPeak = 0;
  let generatedSnapshotBytes = 0;
  let reads = 0;
  const wall0 = performance.now();

  for (let tick = 0; tick < TICKS; tick++) {
    const target = wall0 + tick * TICK_MS;
    const wait = target - performance.now();
    if (wait > 1) await delay(wait);

    for (let i = 0; i < COMMANDS; i++) {
      tails[i] = (tails[i] + CHUNK).slice(-SNAPSHOT_BYTES);
      const event = {
        type: 'tool_execution_update',
        toolCallId: ids[i],
        partialResult: { content: [{ type: 'text', text: tails[i] }] },
      };
      const parsed = JSON.parse(JSON.stringify(event));
      generatedSnapshotBytes += Buffer.byteLength(parsed.partialResult.content[0].text);
      if (consumer) consumer(parsed);
    }

    if (worker.stats.bytes > BODY_BUDGET || worker.stats.entries > ENTRY_BUDGET) {
      failures.push(`${mode}: worker cache ${worker.stats.bytes}/${worker.stats.entries} over budget`);
    }
    if (host.retainedBytes > BODY_BUDGET || host.count > ENTRY_BUDGET) {
      failures.push(`${mode}: host cache ${host.retainedBytes}/${host.count} over budget`);
    }

    const mem = process.memoryUsage();
    rssPeak = Math.max(rssPeak, mem.rss);
    heapPeak = Math.max(heapPeak, mem.heapUsed);

    if (mode === 'one' || mode === 'many') {
      if (tick % Math.round(1000 / TICK_MS / READS_PER_SEC) === 0) {
        const index = mode === 'one' ? 0 : reads % COMMANDS;
        const toolCallId = ids[index]!;
        requested.add(toolCallId);
        const requestId = `r-${index}-${reads}`;
        const args = encodeURIComponent(JSON.stringify({
          requestId, agentId, runId, toolCallId, field: 'live',
        }));
        await handleBashDetailCommand(args, worker, async (payload) => {
          if (payload.requestId !== requestId) foreignBodyReports++;
          const output = typeof payload.detail.output === 'string' ? payload.detail.output : '';
          const text = typeof payload.detail.text === 'string' ? payload.detail.text : '';
          const body = output || text;
          if (payload.detail.unchanged === true || body.length === 0) return;
          bodyRefreshCount++;
          bodyTransferBytes += Buffer.byteLength(body);
          host.set('stress-session', toolCallId, { input: '', output: body, state: 'running' });
          if (mode === 'one' && toolCallId !== ids[0]) foreignBodyReports++;
        });
        reads++;
      }
    }
  }

  let resurrectionOk: boolean | null = null;
  if (mode === 'one' && consumer) {
    const toolCallId = ids[0]!;
    consumer({
      type: 'tool_execution_end',
      toolName: 'bash',
      toolCallId,
      result: { content: [{ type: 'text', text: 'DONE_SENTINEL' }] },
    });
    const settled = worker.read({ requestId: 'settle', agentId, runId, toolCallId, field: 'live' });
    consumer({
      type: 'tool_execution_update',
      toolCallId,
      partialResult: { content: [{ type: 'text', text: 'LATE_SHOULD_NOT_REVIVE' }] },
    });
    const after = worker.read({ requestId: 'late', agentId, runId, toolCallId, field: 'live' });
    resurrectionOk = settled.state === 'completed' && settled.output === 'DONE_SENTINEL'
      && after.state === 'completed' && after.output === 'DONE_SENTINEL';
    check(resurrectionOk, 'terminal tool revived or output replaced by a late partial');
  }

  const cpu = process.cpuUsage(cpu0);
  histogram.disable();
  const wallSec = (performance.now() - wall0) / 1000;
  const result: CaseResult = {
    name: mode,
    wallSec: Number(wallSec.toFixed(3)),
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    rssPeak,
    heapPeak,
    eventLoopDelayP95Ms: Number((histogram.percentile(95) / 1e6).toFixed(3)),
    eventLoopDelayP99Ms: Number((histogram.percentile(99) / 1e6).toFixed(3)),
    bodyTransferBytes,
    bodyRefreshCount,
    readySummaryCount,
    generatedSnapshotBytes,
    workerBytes: worker.stats.bytes,
    workerEntries: worker.stats.entries,
    hostBytes: host.retainedBytes,
    hostEntries: host.count,
    requestedToolIds: [...requested],
    foreignBodyReports,
    resurrectionOk,
  };
  worker.close();
  host.clear();
  console.log(JSON.stringify({ case: result }));
  return result;
}

function assertCases(cases: CaseResult[]) {
  const byName = Object.fromEntries(cases.map((item) => [item.name, item])) as Record<Mode, CaseResult>;
  const collapsed = byName.collapsed;
  check(collapsed.bodyRefreshCount === 0 && collapsed.bodyTransferBytes === 0, `collapsed body reports ${collapsed.bodyRefreshCount}/${collapsed.bodyTransferBytes}`);
  check(collapsed.readySummaryCount > 0, 'collapsed ready summary was not counted separately');
  check(collapsed.requestedToolIds.length === 0, 'collapsed issued detail reads');
  const one = byName.one;
  check(one.requestedToolIds.length === 1, `one-view subscribed ${one.requestedToolIds.length} tools`);
  check(one.foreignBodyReports === 0, `one-view forwarded foreign bodies ${one.foreignBodyReports}`);
  check(one.bodyRefreshCount > 0, 'one-view produced no body refresh');
  const many = byName.many;
  const expectedTools = SECONDS >= 60 ? COMMANDS : Math.min(COMMANDS, many.bodyRefreshCount);
  check(many.requestedToolIds.length === expectedTools, `many-view covered ${many.requestedToolIds.length}, expected ${expectedTools}`);
  for (const item of cases) {
    check(item.workerBytes <= BODY_BUDGET && item.workerEntries <= ENTRY_BUDGET, `${item.name} worker budget`);
    check(item.hostBytes <= BODY_BUDGET && item.hostEntries <= ENTRY_BUDGET, `${item.name} host budget`);
    if (SECONDS >= 60) {
      const expected = COMMANDS * BYTES_PER_TICK * TICKS * 0.85;
      check(item.generatedSnapshotBytes >= expected, `${item.name} generated ${item.generatedSnapshotBytes} < ${expected}`);
    }
  }
  check(byName.baseline.bodyTransferBytes === 0 && byName.baseline.workerEntries === 0, 'baseline touched the detail cache');
}

function cycleClear() {
  for (let i = 0; i < 100; i++) {
    const store = new BashDetailStore();
    const host = new BashDetailsStore();
    store.consume('a', 'r', { type: 'tool_execution_start', toolName: 'bash', toolCallId: 't', args: { command: 'echo' } });
    store.consume('a', 'r', { type: 'tool_execution_update', toolCallId: 't', partialResult: { content: [{ type: 'text', text: 'body' }] } });
    const live = store.read({ requestId: 'c', agentId: 'a', runId: 'r', toolCallId: 't', field: 'live' });
    check(live.output === 'body', `cycle ${i} read missed body`);
    host.set('s', 't', { output: 'body', state: 'running' });
    store.clear();
    host.clear();
    check(store.stats.bytes === 0 && store.stats.entries === 0, `cycle ${i} clear left ${store.stats.bytes}/${store.stats.entries}`);
    check(host.retainedBytes === 0 && host.count === 0, `cycle ${i} host clear left stats`);
    store.close();
    check(store.stats.bytes === 0 && store.stats.entries === 0, `cycle ${i} close left stats`);
  }
}

function pipeDrain(): Promise<{ stdoutBytes: number; stderrBytes: number; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const script = `
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const total = 8 * 1024 * 1024;
    function writeAll(stream) {
      return new Promise((resolve, reject) => {
        let left = total;
        const pump = () => {
          while (left > 0) {
            const size = Math.min(chunk.length, left);
            const ok = stream.write(chunk.subarray(0, size));
            left -= size;
            if (!ok) { stream.once('drain', pump); return; }
          }
          resolve();
        };
        stream.on('error', reject);
        pump();
      });
    }
    Promise.all([writeAll(process.stdout), writeAll(process.stderr)]).then(() => {
      process.stdout.end();
      process.stderr.end();
    });
  `;
  return new Promise((resolvePipe, reject) => {
    const child: ChildProcess = spawn(process.execPath, ['-e', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout?.on('data', (buf: Buffer) => { stdoutBytes += buf.length; });
    child.stderr?.on('data', (buf: Buffer) => { stderrBytes += buf.length; });
    const timer = setTimeout(() => {
      if (child.pid) child.kill('SIGKILL');
    }, 30_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolvePipe({ stdoutBytes, stderrBytes, exitCode, signal });
    });
  });
}

const cases: CaseResult[] = [];
for (const mode of ['baseline', 'collapsed', 'one', 'many'] as const) {
  cases.push(await runCase(mode));
}
assertCases(cases);
cycleClear();
const pipe = await pipeDrain();
check(pipe.exitCode === 0, `pipe exit ${pipe.exitCode} signal ${pipe.signal}`);
check(pipe.stdoutBytes === 8 * 1024 * 1024 && pipe.stderrBytes === 8 * 1024 * 1024, `pipe bytes stdout=${pipe.stdoutBytes} stderr=${pipe.stderrBytes}`);

const report = {
  disclaimer: 'Single-process transport simulation. eventLoopDelay is Node loop lag under this load, not UI interaction latency, not IPC, and not multi-model worker cost.',
  seconds: SECONDS,
  commands: COMMANDS,
  bytesPerTick: BYTES_PER_TICK,
  snapshotCap: SNAPSHOT_BYTES,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cases,
  pipe,
  failures,
};
const dir = progressDir();
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'bash-output-stress-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: failures.length === 0, failures, result: resolve(dir, 'bash-output-stress-result.json') }));
if (failures.length) process.exit(1);

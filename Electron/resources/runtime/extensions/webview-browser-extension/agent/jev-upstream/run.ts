import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { BrowserChoiceConnection } from '../browser-choice-loop.ts';

const here = dirname(fileURLToPath(import.meta.url));
const upstreamCommit: string = JSON.parse(readFileSync(join(here, 'vendor/upstream.json'), 'utf8')).commit;
const codeOf = (error: unknown, fallback: string) => error instanceof Error && /^[a-z][a-z0-9-]{0,79}$/.test(error.message) ? error.message : fallback;

export function pythonExecutable(): string | undefined {
  const executable = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
  const resources = resolve(dirname(process.execPath), process.platform === 'win32' ? '../..' : '../../..');
  const packaged = join(resources, 'pipiui-runtime/extensions/webview-browser-extension/runtime/python', executable);
  if (existsSync(packaged)) return packaged;
  const beside = resolve(here, '../../runtime/python', executable);
  if (existsSync(beside)) return beside;
  for (let directory = here; dirname(directory) !== directory; directory = dirname(directory)) {
    const candidate = join(directory, '.jev-python', `${process.platform}-${process.arch}`, 'python', executable);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export type UpstreamGoalDependencies = {
  projectRoot: string; connection?: BrowserChoiceConnection; signal?: AbortSignal;
  bridge(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
  generateText?: (body: any, signal: AbortSignal) => Promise<unknown>;
  python?: string;
  spawnWorker?: typeof spawn;
};

/** Run the vendored upstream policy; Node owns every model/browser request and cancellation. */
export async function runUpstreamGoal(params: Record<string, any>, deps: UpstreamGoalDependencies): Promise<Record<string, any>> {
  const started = Date.now();
  let progress: Record<string, any> = { decisions: 0, steps: [], textModelCalls: 0, inputTokens: 0 };
  let textCalls = 0;
  let truncated = false;
  const result = (status: string, code: string) => ({ ...progress, ok: status === 'needs_verification', action: 'goal',
    engine: 'browser-use/jev-ultrafast', upstreamCommit,
    status, code, verified: false, textModelCalls: textCalls, observationsTruncated: truncated,
    elapsedMs: Date.now() - started, requiresObservation: true });
  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  const maxSteps = params.max_steps ?? 12, timeoutSecs = params.timeoutSecs ?? 30;
  if (!goal || Array.from(goal).length > 512 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30
    || !Number.isFinite(timeoutSecs) || timeoutSecs < 1 || timeoutSecs > 60
    || (params.target !== undefined && !['active', 'desktop', 'mobile'].includes(params.target))) return result('invalid_request', 'invalid-goal-request');
  if (process.env.PIPIUI_JEV_WORKER === '1') return result('fallback', 'nested-jev-worker-denied');
  const python = deps.python ?? pythonExecutable();
  if (!python) return result('fallback', 'jev-python-unavailable');
  const connected = deps.connection?.current();
  if (!connected?.offer.evaluate) return result('fallback', 'jev-upstream-unavailable');
  const ac = new AbortController();
  let stopCode = 'aborted';
  const abort = () => ac.abort();
  deps.signal?.addEventListener('abort', abort, { once: true });
  connected.signal.addEventListener('abort', abort, { once: true });
  if (deps.signal?.aborted || connected.signal.aborted) ac.abort();
  const timer = setTimeout(() => { stopCode = 'time-budget'; ac.abort(); }, timeoutSecs * 1000);
  const stopped = new Promise<never>((_, reject) => {
    if (ac.signal.aborted) reject(new Error(stopCode));
    else ac.signal.addEventListener('abort', () => reject(new Error(stopCode)), { once: true });
  });
  void stopped.catch(() => {});
  const bounded = <T>(work: Promise<T>) => Promise.race([work, stopped]);
  let lease: string | undefined, target = params.target ?? 'active';
  let child: ReturnType<typeof spawn> | undefined;
  const authorize = async () => {
    if (ac.signal.aborted) throw new Error(stopCode);
    if (deps.connection?.current()?.offer !== connected.offer) throw new Error('jev-provider-withdrawn');
    const ready = await bounded(connected.offer.availability(deps.projectRoot, ac.signal));
    if (!ready.ready) throw new Error(ready.reason ?? 'jev-unavailable');
  };
  const browser = async (action: string, extra: Record<string, unknown> = {}) => {
    await authorize();
    const response = await bounded(deps.bridge(action, { ...extra, target, ...(lease ? { jev_lease: lease } : {}) }, ac.signal));
    if (!response?.ok) throw new Error(response?.code?.replaceAll('_', '-') ?? 'jev-browser-failed');
    return response;
  };
  try {
    const opened = await browser('jev_begin', params.url ? { url: params.url } : {});
    lease = opened.lease; target = opened.viewportTarget;
    if (typeof lease !== 'string' || !['desktop', 'mobile'].includes(target)) throw new Error('invalid-jev-lease');
    const env: NodeJS.ProcessEnv = { PIPIUI_JEV_WORKER: '1', ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1', LANG: process.env.LANG ?? 'en_US.UTF-8', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
    child = (deps.spawnWorker ?? spawn)(python, ['-I', '-B', '-u', join(here, 'worker.py')], { cwd: here, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const worker = child;
    const completion = new Promise<Record<string, any>>((resolveResult, reject) => {
      let final: Record<string, any> | undefined;
      let bytes = 0;
      worker.stdout!.on('data', chunk => { bytes += chunk.length; if (bytes > 12_000_000) reject(new Error('jev-worker-output-budget')); });
      worker.stderr!.resume(); // Never include Python tracebacks/payloads in tool logs.
      const lines = createInterface({ input: worker.stdout! });
      lines.on('line', line => {
        let message: any;
        try { message = JSON.parse(line); } catch { reject(new Error('invalid-jev-worker-message')); return; }
        if (message.type === 'progress') { progress = message.value; truncated ||= progress.observationsTruncated === true; return; }
        if (message.type === 'result') { final = message.value; progress = final!; return; }
        if (message.type === 'error') { reject(new Error(message.code)); return; }
        if (message.type !== 'request' || !Number.isInteger(message.id)) { reject(new Error('invalid-jev-worker-message')); return; }
        void (async () => {
          await authorize();
          let value: unknown;
          if (message.operation === 'cdp') {
            value = (await browser('jev_cdp', { cdp_method: message.value.method, cdp_params: message.value.params })).result;
          } else if (message.operation === 'jev' || message.operation === 'text') {
            const body = (await browser('jev_sanitize', { cdp_params: message.value })).result;
            if (message.operation === 'jev') {
              const out = await bounded(connected.offer.evaluate!({ projectRoot: deps.projectRoot, body, signal: ac.signal }));
              if (out.status !== 'applied') throw new Error(out.reason ?? 'jev-request-failed');
              value = out.response;
            } else {
              if (!deps.generateText) throw new Error('text-model-unavailable');
              textCalls++;
              value = await bounded(deps.generateText(body, ac.signal));
            }
          } else throw new Error('invalid-jev-worker-operation');
          await authorize();
          worker.stdin!.write(JSON.stringify({ id: message.id, ok: true, value }) + '\n');
        })().catch(error => {
          if (!worker.stdin?.destroyed) worker.stdin?.write(JSON.stringify({ id: message.id, ok: false, code: codeOf(error, 'jev-request-failed') }) + '\n');
        });
      });
      worker.once('error', () => reject(new Error('jev-worker-start-failed')));
      worker.once('close', () => { lines.close(); final ? resolveResult(final) : reject(new Error('jev-worker-exited')); });
    });
    worker.stdin!.on('error', () => {});
    worker.stdin!.write(JSON.stringify({ goal, maxSteps }) + '\n');
    const ended = await bounded(completion);
    return ended.status === 'done' ? result('needs_verification', 'jev-done-unverified')
      : ended.status === 'blocked' ? result('blocked', 'jev-blocked') : result('budget_exhausted', 'step-budget');
  } catch (error) {
    return result(ac.signal.aborted ? (stopCode === 'time-budget' ? 'budget_exhausted' : 'aborted') : 'fallback', codeOf(error, 'jev-upstream-failed'));
  } finally {
    clearTimeout(timer); deps.signal?.removeEventListener('abort', abort); connected.signal.removeEventListener('abort', abort); ac.abort();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => { if (child?.exitCode === null) child.kill('SIGKILL'); }, 1000); kill.unref();
      child.once('close', () => clearTimeout(kill));
    }
    if (lease) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([deps.bridge('jev_end', { target, jev_lease: lease }).catch(() => {}),
        new Promise<void>(resolveCleanup => { cleanupTimer = setTimeout(resolveCleanup, 1000); })]);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  }
}

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiHostBackend } from '../src/index.js';

let root = '';
let settle: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await settle?.();
  settle = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  root = '';
});

async function fixture() {
  root = await fs.mkdtemp(join(tmpdir(), 'pipi-win-settings-'));
  const target = join(root, 'pipiui-settings.json');
  const original = { hiddenModelIds: ['keep/model'], marker: 'keep original fields' };
  await fs.writeFile(target, JSON.stringify(original));
  const backend = createPiHostBackend({ agentDir: root });
  settle = () => (backend as unknown as { materializeSubagentModelCatalog(): Promise<void> }).materializeSubagentModelCatalog();
  await backend.handle('listModels', []);
  await settle();
  const save = () => backend.handle('setSidebarSessionPreferences', [{ pinnedSessionIds: ['acceptance'], archivedSessionIds: [], orderedSessionIds: ['acceptance'], sessionOrderVersion: 2 }]);
  return { target, original, save };
}

describe.skipIf(process.platform !== 'win32')('Windows settings atomic replacement', () => {
  it('saves after a real Windows reader holds a delete-sharing lock beyond one second', async () => {
    const { target, original, save } = await fixture();
    const ready = join(root, 'reader-ready');
    const release = join(root, 'reader-release');
    const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
    const script = `$s=[IO.File]::Open(${quote(target)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{[IO.File]::WriteAllText(${quote(ready)},'ready');$until=[DateTime]::UtcNow.AddSeconds(5);while(!(Test-Path ${quote(release)}) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 10}}finally{$s.Dispose()}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    const rename = fs.rename.bind(fs);
    let sharingViolationObserved = false;
    let releaseTimer: NodeJS.Timeout | undefined;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      try { await rename(from, to); }
      catch (error) {
        if (!sharingViolationObserved && to === target && ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          sharingViolationObserved = true;
          releaseTimer = setTimeout(() => { void fs.writeFile(release, 'release'); }, 1200);
        }
        throw error;
      }
    });
    try {
      const until = Date.now() + 5000;
      while (!(await fs.stat(ready).catch(() => undefined))) {
        if (Date.now() > until) throw new Error('Test reader did not acquire the file');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await expect(save()).resolves.toMatchObject({ pinnedSessionIds: ['acceptance'] });
      expect(sharingViolationObserved).toBe(true);
    } finally { clearTimeout(releaseTimer); await fs.writeFile(release, 'release'); await exited; }
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toMatchObject({ ...original, sidebarSessionPreferences: { pinnedSessionIds: ['acceptance'] } });
  }, 10000);

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries transient %s on the same temporary file', async code => {
    const { target, original, save } = await fixture();
    const rename = fs.rename.bind(fs);
    const sources: unknown[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === target) {
        sources.push(from);
        if (sources.length <= 2) throw Object.assign(new Error('temporary sharing violation'), { code });
      }
      await rename(from, to);
    });
    await expect(save()).resolves.toMatchObject({ pinnedSessionIds: ['acceptance'] });
    expect(sources.length).toBeGreaterThan(2);
    expect(new Set(sources).size).toBe(1);
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toMatchObject(original);
    expect((await fs.readdir(root)).filter(name => name.includes('.tmp-'))).toEqual([]);
  });

  it.each(['EPERM', 'EIO'])('preserves the original on permanent %s and removes its failed temporary file', async code => {
    const { target, original, save } = await fixture();
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === target) { attempts++; throw Object.assign(new Error('persistent failure'), { code }); }
      await rename(from, to);
    });
    await expect(save()).rejects.toMatchObject({ code });
    expect(attempts).toBeLessThanOrEqual(10);
    if (code === 'EIO') expect(attempts).toBe(1);
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual(original);
    expect((await fs.readdir(root)).filter(name => name.includes('.tmp-'))).toEqual([]);
  }, 10000);
});

import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncJevUpstream, publishCandidate, validateCandidate } from './sync-jev-upstream.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const relative = 'Electron/resources/runtime/extensions/webview-browser-extension/agent/jev-upstream';
const oldCommit = 'a'.repeat(40), nextCommit = 'b'.repeat(40);
const owned: string[] = [];
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jev-update-test-')); owned.push(root);
  const base = join(root, relative), vendor = join(base, 'vendor');
  mkdirSync(base, { recursive: true });
  cpSync(join(repositoryRoot, relative, 'vendor'), vendor, { recursive: true });
  cpSync(join(repositoryRoot, relative, 'adapter.patch'), join(base, 'adapter.patch'));
  const receipt = JSON.parse(readFileSync(join(vendor, 'upstream.json'), 'utf8')); receipt.commit = oldCommit;
  writeFileSync(join(vendor, 'upstream.json'), JSON.stringify(receipt));
  const manifestPath = join(root, 'Electron/resources/runtime/extensions/webview-browser-extension/pipiui-extension.json');
  const manifest = { id: 'webview-browser-extension', unrelated: 'keep', updateComponents: [{ id: 'browser-use-jev', version: oldCommit,
    source: { type: 'githubCommits', owner: 'browser-use', repo: 'jev-ultrafast', ref: 'main' } }] };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const original = join(root, 'original'); cpSync(vendor, original, { recursive: true });
  execFileSync('git', ['apply', '-R', join(base, 'adapter.patch')], { cwd: original, stdio: 'pipe' });
  const requests: string[] = []; let head = nextCommit; let conflict = false;
  const fetchImpl = async (url: string) => {
    requests.push(url);
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: head }));
    if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', ahead_by: 1 }));
    const file = url.split('/').slice(6).join('/');
    let text = readFileSync(join(original, file), 'utf8');
    if (conflict && file === 'jev_ultrafast/agent.py') text = text.replace('class Agent:', 'class IncompatibleAgent:');
    if (file.endsWith('snapshot.js')) text += '\n// new upstream commit\n';
    return new Response(text);
  };
  const validate = (candidate: string) => validateCandidate(candidate, repositoryRoot);
  return { root, base, vendor, manifestPath, requests, fetchImpl, validate, setHead: (value: string) => { head = value; }, breakPatch: () => { conflict = true; } };
}

describe('upstream Jev source update transaction', () => {
  it('checks a candidate without changing source, then applies that exact reviewed commit', async () => {
    const f = fixture(); const before = readFileSync(join(f.vendor, 'upstream.json'), 'utf8');
    expect(await syncJevUpstream(f)).toMatchObject({ status: 'updateAvailable', applied: false, compatible: true, targetCommit: nextCommit });
    expect(readFileSync(join(f.vendor, 'upstream.json'), 'utf8')).toBe(before);
    f.setHead('c'.repeat(40)); f.requests.length = 0;
    expect(await syncJevUpstream({ ...f, apply: true })).toMatchObject({ status: 'updated', applied: true, targetCommit: nextCommit });
    expect(f.requests.some(url => url.includes('/commits/main'))).toBe(false);
    const receipt = JSON.parse(readFileSync(join(f.vendor, 'upstream.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
    expect(receipt.commit).toBe(nextCommit);
    expect(manifest.updateComponents[0].version).toBe(nextCommit);
    expect(manifest.unrelated).toBe('keep');
    expect(readFileSync(join(f.vendor, 'jev_ultrafast/agent.py'), 'utf8')).toContain('choose_fn');
    expect(readdirSync(f.base).some(name => name.startsWith('.jev-update-'))).toBe(false);
  });
  it('preserves the current tree if the maintained patch conflicts', async () => {
    const f = fixture(); f.breakPatch(); const before = readFileSync(join(f.vendor, 'upstream.json'), 'utf8');
    await expect(syncJevUpstream(f)).rejects.toThrow('patch conflict');
    expect(readFileSync(join(f.vendor, 'upstream.json'), 'utf8')).toBe(before);
  });
  it('preserves the current tree when candidate regression fails', async () => {
    const f = fixture();
    await expect(syncJevUpstream({ ...f, validate: () => { throw new Error('bad candidate'); } })).rejects.toThrow('regression failed');
    expect(JSON.parse(readFileSync(f.manifestPath, 'utf8')).updateComponents[0].version).toBe(oldCommit);
  });
  it('refuses local edits and refuses source drift after a check', async () => {
    const f = fixture(); await syncJevUpstream(f);
    const file = join(f.vendor, 'jev_ultrafast/snapshot.js'); writeFileSync(file, readFileSync(file, 'utf8') + '\n// local work\n');
    await expect(syncJevUpstream({ ...f, apply: true })).rejects.toThrow('Local source changed');
    expect(readFileSync(file, 'utf8')).toContain('// local work');
  });
  it('does not overwrite a manifest edited during validation', async () => {
    const f = fixture();
    await expect(syncJevUpstream({ ...f, validate: () => { writeFileSync(f.manifestPath, '{"userChange":true}'); } })).rejects.toThrow('Local source changed during check');
    expect(JSON.parse(readFileSync(f.manifestPath, 'utf8'))).toEqual({ userChange: true });
  });
  it('restores the prior vendor tree if publishing the manifest fails', () => {
    const f = fixture(); const candidate = join(f.root, 'candidate'); mkdirSync(candidate); writeFileSync(join(candidate, 'new.py'), 'new');
    expect(() => publishCandidate({ vendor: f.vendor, candidate, manifestPath: f.manifestPath, manifestText: '{}',
      writeManifest: () => { throw new Error('write failed'); } })).toThrow('write failed');
    expect(JSON.parse(readFileSync(join(f.vendor, 'upstream.json'), 'utf8')).commit).toBe(oldCommit);
    expect(JSON.parse(readFileSync(f.manifestPath, 'utf8')).unrelated).toBe('keep');
  });
});

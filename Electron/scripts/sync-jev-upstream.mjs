import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const relativeBase = 'Electron/resources/runtime/extensions/webview-browser-extension/agent/jev-upstream';
const relativeManifest = 'Electron/resources/runtime/extensions/webview-browser-extension/pipiui-extension.json';
const repository = 'browser-use/jev-ultrafast';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const commitId = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const files = ['LICENSE', 'jev_ultrafast/__init__.py', 'jev_ultrafast/agent.py', 'jev_ultrafast/browser.py', 'jev_ultrafast/model.py', 'jev_ultrafast/questions.py', 'jev_ultrafast/snapshot.js'];
const atomicWrite = (path, bytes) => {
  const temporary = `${path}.jev-update-${process.pid}`;
  try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
};

function inventory(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error('Local vendor contains a symlink; preserving it without update');
    const name = prefix + e.name;
    return e.isDirectory() ? inventory(join(path, e.name), name + '/') : [name];
  });
}

function assertLocal(vendor, metadata) {
  if (!commitId(metadata.commit) || !metadata.patchedFiles) throw new Error('Missing pinned/patched source receipt');
  const expected = [...files, 'upstream.json'].sort();
  if (JSON.stringify(inventory(vendor).sort()) !== JSON.stringify(expected)) throw new Error('Unexpected local vendor files; update refused');
  for (const file of files) if (sha(readFileSync(join(vendor, file))) !== metadata.patchedFiles[file]) {
    throw new Error(`Local source changed: ${file}; update refused`);
  }
}

export function validateCandidate(candidate, root = repoRoot) {
  const executable = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
  const python = join(root, 'Electron/.jev-python', `${process.platform}-${process.arch}`, 'python', executable);
  const packaged = join(root, 'build/PipiUI.app/Contents/Resources/pipiui-runtime/extensions/webview-browser-extension/runtime/python', executable);
  const selected = existsSync(python) ? python : packaged;
  if (!existsSync(selected)) throw new Error('Prepare the pinned runtime with node Electron/scripts/fetch-jev-python.mjs');
  const env = { ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1', LANG: 'en_US.UTF-8', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  execFileSync(process.execPath, ['--check', join(candidate, 'jev_ultrafast/snapshot.js')], { env, timeout: 10_000, stdio: 'pipe' });
  execFileSync(selected, ['-I', '-B', join(root, 'Electron/scripts/verify-jev-vendor.py'), candidate], { env, cwd: candidate, timeout: 10_000, stdio: 'pipe' });
}

/** Atomic source publish with a recoverable previous tree until both metadata writes succeed. */
export function publishCandidate({ vendor, candidate, manifestPath, manifestText, writeManifest = atomicWrite }) {
  const staging = mkdtempSync(join(dirname(vendor), '.jev-update-'));
  const previous = join(staging, 'previous');
  const next = join(staging, 'next');
  cpSync(candidate, next, { recursive: true });
  let moved = false;
  try {
    renameSync(vendor, previous); moved = true;
    renameSync(next, vendor);
    writeManifest(manifestPath, manifestText);
  } catch (error) {
    if (moved) { rmSync(vendor, { recursive: true, force: true }); renameSync(previous, vendor); }
    throw error;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

/** `--check` stages/validates only. `--apply` repeats every check before changing source. */
export async function syncJevUpstream({ root = repoRoot, apply = false, revision, fetchImpl = globalThis.fetch, validate = validateCandidate } = {}) {
  const base = join(root, relativeBase), vendor = join(base, 'vendor'), manifestPath = join(root, relativeManifest);
  const receiptText = readFileSync(join(vendor, 'upstream.json'), 'utf8');
  const metadata = JSON.parse(receiptText);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const declared = JSON.parse(manifestText).updateComponents?.find(c => c.id === 'browser-use-jev');
  const tracked = declared?.source;
  if (declared?.version !== metadata.commit || tracked?.type !== 'githubCommits'
    || `${tracked.owner}/${tracked.repo}` !== repository || typeof tracked.ref !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(tracked.ref) || tracked.ref.includes('..')) {
    throw new Error('Update-center source/pin does not match the upstream receipt');
  }
  const patch = readFileSync(join(base, 'adapter.patch'));
  assertLocal(vendor, metadata);
  const proposalPath = join(root, '.pi/agent/jev-upstream-update/proposal.json');
  const identity = { currentCommit: metadata.commit, receiptSha: sha(Buffer.from(receiptText)), manifestSha: sha(Buffer.from(manifestText)), patchSha: sha(patch) };
  let proposal;
  if (apply) {
    if (!existsSync(proposalPath)) throw new Error('Run --check and review its proposal before --apply');
    proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
    if (!commitId(proposal.targetCommit) || Object.entries(identity).some(([key, value]) => proposal[key] !== value)
      || revision && revision !== proposal.targetCommit) throw new Error('Checked proposal no longer matches local source; run --check again');
  }
  const request = async (url, json = false) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 1_000_000) throw new Error('Upstream response exceeds source budget');
    return json ? JSON.parse(text) : text;
  };
  const target = proposal?.targetCommit ?? revision ?? (await request(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(tracked.ref)}`, true)).sha;
  if (!commitId(target)) throw new Error('Invalid target commit');
  if (target !== metadata.commit) {
    const comparison = await request(`https://api.github.com/repos/${repository}/compare/${metadata.commit}...${target}`, true);
    if (comparison.status !== 'ahead' || !(comparison.ahead_by > 0)) throw new Error('Target is not a forward upstream update');
  }
  const temporary = mkdtempSync(join(tmpdir(), 'pipiui-jev-update-'));
  const candidate = join(temporary, 'vendor');
  try {
    const next = { repository: `https://github.com/${repository}`, commit: target, license: 'MIT', files: {}, patchedFiles: {} };
    for (const file of files) {
      const text = await request(`https://raw.githubusercontent.com/${repository}/${target}/${file}`);
      mkdirSync(dirname(join(candidate, file)), { recursive: true });
      writeFileSync(join(candidate, file), text);
      next.files[file] = sha(Buffer.from(text));
    }
    const patchPath = join(temporary, 'adapter.patch'); writeFileSync(patchPath, patch);
    try {
      execFileSync('git', ['apply', '--check', patchPath], { cwd: candidate, stdio: 'pipe', timeout: 10_000 });
      execFileSync('git', ['apply', patchPath], { cwd: candidate, stdio: 'pipe', timeout: 10_000 });
    } catch { throw new Error('Upstream adapter patch conflict; current version preserved'); }
    try { await validate(candidate, root); }
    catch { throw new Error('Candidate regression failed; current version preserved'); }
    for (const file of files) next.patchedFiles[file] = sha(readFileSync(join(candidate, file)));
    writeFileSync(join(candidate, 'upstream.json'), JSON.stringify(next, null, 2) + '\n');
    assertLocal(vendor, metadata);
    if (receiptText !== readFileSync(join(vendor, 'upstream.json'), 'utf8') || manifestText !== readFileSync(manifestPath, 'utf8')
      || !patch.equals(readFileSync(join(base, 'adapter.patch')))) throw new Error('Local source changed during check; update refused');
    if (apply && target !== metadata.commit) {
      const manifest = JSON.parse(manifestText);
      const component = manifest.updateComponents?.find(c => c.id === 'browser-use-jev');
      if (!component || component.version !== metadata.commit) throw new Error('Update-center pin does not match the vendor receipt');
      component.version = target;
      publishCandidate({ vendor, candidate, manifestPath, manifestText: JSON.stringify(manifest, null, 2) + '\n' });
    } else if (!apply) {
      mkdirSync(dirname(proposalPath), { recursive: true });
      atomicWrite(proposalPath, JSON.stringify({ ...identity, targetCommit: target, checkedAt: new Date().toISOString() }, null, 2) + '\n');
    }
    return { ok: true, status: target === metadata.commit ? 'upToDate' : apply ? 'updated' : 'updateAvailable',
      currentCommit: metadata.commit, targetCommit: target, compatible: true, applied: apply && target !== metadata.commit,
      compareUrl: `https://github.com/${repository}/compare/${metadata.commit}...${target}` };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => !['--check', '--apply'].includes(a)) || args.includes('--check') && args.includes('--apply')) {
    console.error('Usage: node Electron/scripts/sync-jev-upstream.mjs [--check | --apply]'); process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await syncJevUpstream({ apply: args.includes('--apply') }), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Jev update failed'); process.exitCode = 1; }
  }
}

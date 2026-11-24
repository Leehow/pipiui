import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const release = '20260901';
export const version = '3.12.14';
export const targets = {
  'darwin-arm64': ['aarch64-apple-darwin', '81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b'],
  'darwin-x64': ['x86_64-apple-darwin', '65b195c9cedc1fef6767f044f9822069adbd1bd9204d424ece4628776fdc04bb'],
  'linux-x64': ['x86_64-unknown-linux-gnu', '72748da13197c1fb161e3afeef20a6a385ff24f2165e6e2758e47008e7faba4c'],
  'win32-x64': ['x86_64-pc-windows-msvc', '7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14'],
};
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Pinned python-build-standalone; no system Python, pip, or first-run network dependency. */
export function prepareJevPython(target = `${process.platform}-${process.arch}`) {
  const spec = targets[target];
  if (!spec) throw new Error(`Unsupported Jev Python target: ${target}`);
  const destination = join(root, '.jev-python', target);
  const executable = join(destination, 'python', target.startsWith('win32-') ? 'python.exe' : 'bin/python3.12');
  const receipt = join(destination, 'receipt.json');
  if (existsSync(receipt) && existsSync(executable)) {
    const saved = JSON.parse(readFileSync(receipt, 'utf8'));
    if (saved.archiveSha256 === spec[1] && saved.executableSha256 === sha(executable)) return destination;
    throw new Error(`Jev Python cache integrity mismatch: ${destination}`);
  }
  if (existsSync(destination)) throw new Error(`Incomplete Jev Python cache: ${destination}`);
  mkdirSync(join(root, '.jev-python'), { recursive: true });
  const temporary = mkdtempSync(join(root, '.jev-python', '.prepare-'));
  const cleanup = () => rmSync(temporary, { recursive: true, force: true });
  const interrupted = () => { cleanup(); process.exit(130); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, interrupted);
  try {
    const asset = `cpython-${version}+${release}-${spec[0]}-install_only_stripped.tar.gz`;
    const archive = join(temporary, 'python.tar.gz');
    execFileSync('curl', ['--fail', '--location', '--retry', '2', '--max-time', '180', '--silent', '--show-error',
      '--output', archive, `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${encodeURIComponent(asset)}`], { stdio: 'inherit' });
    if (sha(archive) !== spec[1]) throw new Error('Jev Python archive checksum mismatch');
    execFileSync('tar', ['-xzf', archive, '-C', temporary]);
    rmSync(archive);
    const relativeExecutable = target.startsWith('win32-') ? 'python.exe' : 'bin/python3.12';
    writeFileSync(join(temporary, 'receipt.json'), JSON.stringify({ version, release, target,
      source: 'https://github.com/astral-sh/python-build-standalone', archiveSha256: spec[1],
      executableSha256: sha(join(temporary, 'python', relativeExecutable)) }, null, 2) + '\n');
    renameSync(temporary, destination);
    return destination;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, interrupted);
    cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(prepareJevPython(process.argv[2]));

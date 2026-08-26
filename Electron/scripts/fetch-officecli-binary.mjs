import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

export const OFFICECLI_RECEIPT_NAME = 'receipt.json'
export const OFFICECLI_SKIP_UPDATE_ENV = 'OFFICECLI_SKIP_UPDATE'
export const DOWNLOAD_TIMEOUT_MS = 180_000
export const LOCK_HEARTBEAT_MS = 5_000
/** Conservative backup: must exceed the entire bounded fetch+verify path. Heartbeat keeps a live owner fresh; a live PID is never stolen. */
export const LOCK_STALE_MS = DOWNLOAD_TIMEOUT_MS + 60_000
/** Bounded grace for a half-created empty lock directory (crash after mkdir, before the owner file exists). */
export const LOCK_INIT_GRACE_MS = 2_000
export const MAX_REDIRECTS = 5
/** Exactly one `<32-hex>.owner` file may live inside a lock directory. */
export const OWNER_FILE_RE = /^[0-9a-f]{32}\.owner$/
export const ALLOWED_DOWNLOAD_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutputRoot = join(electronRoot, '.officecli')
const defaultMetadataUrl = new URL('../officecli-assets.json', import.meta.url)

export function usage() {
  console.log(`Prepare or validate one architecture-specific OfficeCLI native binary.

Usage:
  node scripts/fetch-officecli-binary.mjs [--platform <darwin|win32|linux>] [--arch <x64|arm64>]
                                          [--check | --force] [--output-root <absolute path>]

Modes:
  prepare (default)  Reuse a checksum-valid target cache; otherwise download once.
  --check            Offline/read-only validation. Never creates, downloads, or locks.
  --force            Re-download even when the cache is current.

Never PATH, never ~/.local/bin, never npm postinstall, never d.officecli.ai,
never /releases/latest, never SDK install().
`)
}

export function parseArgs(argv) {
  const result = {
    check: false,
    force: false,
    help: false,
    platform: undefined,
    arch: undefined,
    outputRoot: undefined
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--check') result.check = true
    else if (value === '--force') result.force = true
    else if (value === '--help' || value === '-h') result.help = true
    else if (value === '--platform' || value === '--arch' || value === '--output-root') {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`)
      result[value === '--output-root' ? 'outputRoot' : value.slice(2)] = next
      index += 1
    } else throw new Error(`Unknown argument: ${value}`)
  }
  if (result.check && result.force) throw new Error('--check and --force are mutually exclusive')
  return result
}

export function binaryName(platform) {
  return platform === 'win32' ? 'officecli.exe' : 'officecli'
}

export function targetKey(platform, arch) {
  return `${platform}-${arch}`
}

export function publishedRelativeDir(platform, arch) {
  return join('extensions', 'office-extension', 'bin', targetKey(platform, arch))
}

export function cacheBinaryPath(outputRoot, platform, arch) {
  return join(outputRoot, targetKey(platform, arch), publishedRelativeDir(platform, arch), binaryName(platform))
}

export function packagedBinaryPath(runtimeRoot, platform, arch) {
  return join(runtimeRoot, publishedRelativeDir(platform, arch), binaryName(platform))
}

export function assetUrl(metadata, asset) {
  return `${metadata.baseUrl}/${asset.asset}`
}

export async function loadMetadata(from = defaultMetadataUrl) {
  return JSON.parse(await readFile(from, 'utf8'))
}

export function resolveAsset(metadata, platform, arch) {
  const key = targetKey(platform, arch)
  const asset = metadata?.assets?.[key]
  if (!asset) throw new Error(`No pinned OfficeCLI asset for ${key}`)
  if (!asset.asset || !asset.sha256 || !Number.isInteger(asset.bytes)) {
    throw new Error(`OfficeCLI metadata for ${key} is incomplete`)
  }
  if (typeof metadata.baseUrl !== 'string' || metadata.baseUrl.includes('latest') || metadata.baseUrl.includes('d.officecli.ai')) {
    throw new Error('OfficeCLI metadata baseUrl must be an immutable GitHub release URL')
  }
  return { key, asset }
}

export function nativeArchitectures(bytes, platform) {
  if (platform === 'darwin' && bytes.length >= 8) {
    const cpuName = value => value === 0x01000007 ? 'x64' : value === 0x0100000c ? 'arm64' : undefined
    if (bytes.readUInt32LE(0) === 0xfeedfacf) return [cpuName(bytes.readUInt32LE(4))].filter(Boolean)
    const magic = bytes.readUInt32BE(0)
    if ((magic === 0xcafebabe || magic === 0xcafebabf) && bytes.length >= 8) {
      const count = bytes.readUInt32BE(4)
      const stride = magic === 0xcafebabf ? 32 : 20
      const values = []
      for (let index = 0; index < count; index += 1) {
        const offset = 8 + index * stride
        if (offset + 4 > bytes.length) break
        const name = cpuName(bytes.readUInt32BE(offset))
        if (name) values.push(name)
      }
      return values
    }
  }
  if (platform === 'linux' && bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const little = bytes[5] === 1
    const machine = little ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    return machine === 62 ? ['x64'] : machine === 183 ? ['arm64'] : []
  }
  if (platform === 'win32' && bytes.length >= 64 && bytes.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = bytes.readUInt32LE(0x3c)
    if (peOffset + 6 <= bytes.length && bytes.subarray(peOffset, peOffset + 4).toString('binary') === 'PE\0\0') {
      const machine = bytes.readUInt16LE(peOffset + 4)
      return machine === 0x8664 ? ['x64'] : machine === 0xaa64 ? ['arm64'] : []
    }
  }
  return []
}

export function receiptBody({ version, asset, sha256, target, bytes, generatedAt }) {
  const body = { version, asset, sha256, target, bytes }
  if (generatedAt) body.generatedAt = generatedAt
  return `${JSON.stringify(body, null, 2)}\n`
}

function generatedAtFromEnv(env = process.env) {
  const raw = env.SOURCE_DATE_EPOCH
  if (raw === undefined || String(raw).trim() === '') return undefined
  if (!/^\d+$/.test(String(raw).trim())) throw new Error(`SOURCE_DATE_EPOCH must be integer seconds, got ${JSON.stringify(raw)}`)
  return new Date(Number(raw) * 1000).toISOString()
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function assertAllowedDownloadUrl(urlString) {
  let parsed
  try { parsed = new URL(urlString) } catch {
    throw new Error(`OfficeCLI download URL is invalid: ${urlString}`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`OfficeCLI download rejected protocol drift: ${urlString}`)
  if (parsed.username || parsed.password) throw new Error(`OfficeCLI download rejected credentials in URL: ${parsed.hostname}`)
  if (parsed.port && parsed.port !== '443') throw new Error(`OfficeCLI download rejected non-443 port: ${urlString}`)
  if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)) {
    throw new Error(`OfficeCLI download rejected host drift: ${parsed.hostname}`)
  }
  if (parsed.hostname === 'github.com' && parsed.pathname.includes('/releases/latest')) {
    throw new Error(`Refusing mutable OfficeCLI URL: ${urlString}`)
  }
  return parsed
}

export async function inspectPublishedBinary(dir, { platform, arch, metadata, asset, key }) {
  const binary = join(dir, publishedRelativeDir(platform, arch), binaryName(platform))
  const receiptFile = join(dirname(binary), OFFICECLI_RECEIPT_NAME)
  let st
  try { st = await lstat(binary) } catch { return { ok: false, reason: `OfficeCLI binary is missing: ${binary}` } }
  if (st.isSymbolicLink()) return { ok: false, reason: `OfficeCLI binary must not be a symlink: ${binary}` }
  if (!st.isFile()) return { ok: false, reason: `OfficeCLI binary is not a regular file: ${binary}` }
  if (platform !== 'win32' && (st.mode & 0o100) === 0) {
    return { ok: false, reason: `OfficeCLI binary is not owner-executable: ${binary}` }
  }
  if (st.size !== asset.bytes) {
    return { ok: false, reason: `OfficeCLI size mismatch for ${key}: expected ${asset.bytes}, got ${st.size}` }
  }
  const bytes = await readFile(binary)
  const actual = sha256(bytes)
  if (actual !== asset.sha256) {
    return { ok: false, reason: `OfficeCLI checksum mismatch for ${key}: expected ${asset.sha256}, got ${actual}` }
  }
  const architectures = nativeArchitectures(bytes, platform)
  if (!architectures.includes(arch)) {
    return {
      ok: false,
      reason: `OfficeCLI binary is ${architectures.join('+') || 'an unrecognized binary'}, expected ${arch}`
    }
  }
  if (architectures.length !== 1) {
    return { ok: false, reason: `OfficeCLI binary for ${key} must be a single-arch slice, got ${architectures.join('+')}` }
  }
  let receipt
  try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')) } catch {
    return { ok: false, reason: `OfficeCLI receipt is missing or invalid: ${receiptFile}` }
  }
  if (receipt.version !== metadata.version || receipt.asset !== asset.asset || receipt.sha256 !== asset.sha256 || receipt.target !== key || receipt.bytes !== asset.bytes) {
    return { ok: false, reason: `OfficeCLI receipt does not match pinned metadata for ${key}` }
  }
  return { ok: true, binary, receipt, architectures }
}

function verifyHostTools(path, platform, arch) {
  if (platform !== 'darwin' || process.platform !== 'darwin') return
  const lipo = spawnSync('lipo', ['-info', path], { encoding: 'utf8' })
  if (lipo.status !== 0) return
  const text = `${lipo.stdout || ''} ${lipo.stderr || ''}`
  const hasX64 = text.includes('x86_64')
  const hasArm = /\barm64\b/.test(text)
  if (!hasX64 && !hasArm) return
  if (hasX64 && hasArm) throw new Error(`OfficeCLI binary must not be universal: ${path}`)
  if (arch === 'x64' && !hasX64) throw new Error(`lipo -info did not report x86_64 for ${path}: ${text.trim()}`)
  if (arch === 'arm64' && !hasArm) throw new Error(`lipo -info did not report arm64 for ${path}: ${text.trim()}`)
}

async function fetchWithBoundedRedirects(url, { fetchImpl, signal, maxRedirects = MAX_REDIRECTS }) {
  let current = url
  const seen = new Set()
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertAllowedDownloadUrl(current)
    if (seen.has(current)) throw new Error(`OfficeCLI download redirect loop at ${current}`)
    seen.add(current)
    const response = await fetchImpl(current, { signal, redirect: 'manual' })
    const status = response.status
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`OfficeCLI download redirect ${status} missing Location from ${current}`)
      let next
      try { next = new URL(location, current).href } catch {
        throw new Error(`OfficeCLI download redirect is not a URL: ${location}`)
      }
      assertAllowedDownloadUrl(next)
      current = next
      continue
    }
    if (status !== 200) {
      throw new Error(`OfficeCLI download failed: ${status} ${response.statusText || ''}`.trim())
    }
    assertAllowedDownloadUrl(current)
    return { response, url: current }
  }
  throw new Error(`OfficeCLI download exceeded ${maxRedirects} redirects`)
}

async function writeBodyToFile(response, destination, expectedBytes) {
  let written = 0
  const cleanup = async () => { await rm(destination, { force: true }) }
  const tooLarge = () => new Error(`OfficeCLI stream exceeded expected ${expectedBytes} bytes (got at least ${written})`)
  try {
    if (response.body && typeof Readable.fromWeb === 'function') {
      const input = Readable.fromWeb(response.body)
      const output = createWriteStream(destination)
      try {
        for await (const chunk of input) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          written += buf.length
          if (written > expectedBytes) {
            input.destroy()
            output.destroy()
            await cleanup()
            throw tooLarge()
          }
          if (!output.write(buf)) {
            await new Promise((resolve, reject) => {
              output.once('drain', resolve)
              output.once('error', reject)
            })
          }
        }
        await new Promise((resolve, reject) => output.end(err => err ? reject(err) : resolve()))
      } catch (error) {
        output.destroy()
        throw error
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer())
      written = bytes.length
      if (written > expectedBytes) {
        await cleanup()
        throw tooLarge()
      }
      await writeFile(destination, bytes)
    }
  } catch (error) {
    await cleanup()
    throw error
  }
  if (written !== expectedBytes) {
    await cleanup()
    throw new Error(`OfficeCLI size mismatch: expected ${expectedBytes}, got ${written}`)
  }
}

async function downloadToFile(url, destination, { fetchImpl, timeoutMs, expectedBytes, maxRedirects }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const { response } = await fetchWithBoundedRedirects(url, {
      fetchImpl,
      signal: controller.signal,
      maxRedirects
    })
    const length = response.headers.get('content-length')
    if (length !== null && length !== undefined && length !== '') {
      if (Number(length) !== expectedBytes) {
        throw new Error(`OfficeCLI Content-Length mismatch: expected ${expectedBytes}, got ${length}`)
      }
    }
    await writeBodyToFile(response, destination, expectedBytes)
  } catch (error) {
    await rm(destination, { force: true })
    if (error?.name === 'AbortError') throw new Error(`OfficeCLI download timed out after ${timeoutMs}ms: ${url}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function replaceDir(staging, destination) {
  const parent = dirname(destination)
  await mkdir(parent, { recursive: true })
  const backup = join(parent, `.previous-${basename(destination)}-${process.pid}-${Date.now()}`)
  let previous = false
  try {
    try { await rename(destination, backup); previous = true } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try { await rename(staging, destination) } catch (error) {
      if (previous) await rename(backup, destination)
      throw error
    }
    if (previous) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    try {
      if (previous) {
        const destStat = await stat(destination).catch(() => undefined)
        if (!destStat && await stat(backup).catch(() => undefined)) await rename(backup, destination)
      }
    } catch { /* keep original error */ }
    throw error
  }
}

function encodeOwner({ pid, token, startedAt, heartbeatMs }) {
  return `${JSON.stringify({ pid, token, startedAt, heartbeatMs })}\n`
}

export function createOwnerToken() {
  return randomBytes(16).toString('hex')
}

/** Strict owner-file body: PID/start/heartbeat metadata for exactly one token. */
export function parseOwnerBody(text) {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null
    if (typeof parsed.token !== 'string' || !OWNER_FILE_RE.test(`${parsed.token}.owner`)) return null
    if (!Number.isFinite(parsed.startedAt) || !Number.isFinite(parsed.heartbeatMs)) return null
    return { pid: parsed.pid, token: parsed.token, startedAt: parsed.startedAt, heartbeatMs: parsed.heartbeatMs }
  } catch {
    return null
  }
}

function isStrictOwnerEntry(entry) {
  return Boolean(entry) && entry.isFile() && !entry.isSymbolicLink() && OWNER_FILE_RE.test(entry.name)
}
/**
 * Stale recovery for a lock directory we do not own. Enumerates entries and accepts
 * only the strict single-owner-file shape; anything else (multiple entries, symlinks,
 * unexpected names, unreadable bodies) fails closed — nothing is touched. A verified
 * dead owner past the stale window is removed by its exact observed unique filename,
 * then the directory is removed with a non-recursive `rmdir` that can only succeed on
 * an empty directory. Concurrent recoverers race safely: at most one unlinks/rmdirs;
 * every loser simply retries `mkdir`.
 */
async function recoverStaleLockDir(lockDir, { now, pidAlive, staleMs, initGraceMs }) {
  let entries
  try {
    entries = await readdir(lockDir, { withFileTypes: true })
  } catch {
    return
  }
  if (entries.length === 0) {
    // Crash between mkdir and owner-file creation: bounded grace, then rmdir.
    try {
      const st = await stat(lockDir)
      if (now() - st.mtimeMs >= initGraceMs) await rmdir(lockDir)
    } catch { /* raced with another recoverer */ }
    return
  }
  if (entries.length !== 1) return
  const entry = entries[0]
  if (!isStrictOwnerEntry(entry)) return
  let owner
  try {
    owner = parseOwnerBody(await readFile(join(lockDir, entry.name), 'utf8'))
  } catch {
    return
  }
  if (!owner || owner.token !== entry.name.slice(0, -'.owner'.length)) return
  if (pidAlive(owner.pid)) return
  if (now() - owner.heartbeatMs < staleMs) return
  try {
    await rm(join(lockDir, entry.name), { force: true })
    await rmdir(lockDir)
  } catch { /* another recoverer won the race */ }
}

/**
 * Lock-directory protocol (TOCTOU-safe):
 * - Acquisition is a single atomic `mkdir` of the per-target lock directory.
 * - The winner creates exactly one unguessable `<token>.owner` file inside and keeps
 *   that FileHandle open for the whole critical section; heartbeats write through the
 *   stable open handle only (positional write + truncate on the inode we hold), so a
 *   replaced directory can never be written, truncated, or resurrected by us.
 * - Release closes the handle, removes only our unique token filename, then one
 *   non-recursive `rmdir`. A replaced directory yields ENOENT on our filename and
 *   ENOTEMPTY on the rmdir — both swallowed; nothing foreign is ever removed.
 */
export async function withLock(lockDir, options, fn) {
  const now = options.now || Date.now
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const lockTimeoutMs = options.lockTimeoutMs ?? LOCK_STALE_MS
  const heartbeatMs = options.heartbeatMs ?? LOCK_HEARTBEAT_MS
  const initGraceMs = options.initGraceMs ?? LOCK_INIT_GRACE_MS
  const pidAlive = options.pidAlive || isProcessAlive
  const token = options.token && OWNER_FILE_RE.test(`${options.token}.owner`) ? options.token : createOwnerToken()
  const pid = options.pid ?? process.pid
  await mkdir(dirname(lockDir), { recursive: true })
  const ownerFile = join(lockDir, `${token}.owner`)
  const start = now()
  for (;;) {
    try {
      await mkdir(lockDir)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await recoverStaleLockDir(lockDir, { now, pidAlive, staleMs: lockTimeoutMs, initGraceMs })
      if (now() - start > lockTimeoutMs) throw new Error(`OfficeCLI fetch lock timed out: ${lockDir}`)
      await sleep(25)
      continue
    }
    // We own a fresh empty directory: publish exactly one unique owner file and keep
    // the handle open. Every later heartbeat writes through this handle only.
    const startedAt = now()
    let owner
    try {
      owner = await open(ownerFile, 'wx')
      const first = Buffer.from(encodeOwner({ pid, token, startedAt, heartbeatMs: now() }))
      await owner.writeFile(first)
      await owner.truncate(first.length)
      // Verify the directory still holds exactly our file; anything else means the
      // directory was replaced under us — abandon it (own filename only) and retry.
      const entries = await readdir(lockDir)
      if (entries.length !== 1 || entries[0] !== `${token}.owner`) throw new Error('lock directory changed under us')
    } catch (error) {
      await owner?.close().catch(() => undefined)
      await rm(ownerFile, { force: true }).catch(() => undefined)
      await rmdir(lockDir).catch(() => undefined)
      if (now() - start > lockTimeoutMs) {
        throw new Error(`OfficeCLI fetch lock init failed: ${error?.message || error}`)
      }
      await sleep(25)
      continue
    }
    // Immediately-cancellable heartbeat through the stable open handle: each sleep
    // owns a clearable timer, so finish/release never waits out the interval and no
    // timer or promise outlives the lock.
    let stopped = false
    let currentSleep = { promise: Promise.resolve(), cancel: () => {} }
    const heart = (async () => {
      while (!stopped) {
        let wake
        const promise = new Promise(resolve => { wake = resolve })
        const timer = setTimeout(wake, heartbeatMs)
        currentSleep = { promise, cancel: () => { clearTimeout(timer); wake() } }
        await promise
        if (stopped) break
        const buf = Buffer.from(encodeOwner({ pid, token, startedAt, heartbeatMs: now() }))
        try {
          await owner.write(buf, 0, buf.length, 0)
          await owner.truncate(buf.length)
        } catch {
          break
        }
      }
    })()
    try {
      return await fn()
    } finally {
      stopped = true
      currentSleep.cancel()
      await heart.catch(() => undefined)
      await owner.close().catch(() => undefined)
      // Remove only this owner's unique token filename, then one non-recursive rmdir.
      // Replaced directory: ENOENT here, ENOTEMPTY (or ENOENT) on rmdir — swallowed.
      await rm(ownerFile, { force: true }).catch(() => undefined)
      await rmdir(lockDir).catch(() => undefined)
    }
  }
}

export function resolveOutputRoot({ outputRoot, env = process.env } = {}) {
  const fromFlag = outputRoot
  const fromEnv = env.PIPIUI_OFFICECLI_OUTPUT_ROOT
  const root = fromFlag || fromEnv || defaultOutputRoot
  if (!isAbsolute(root)) throw new Error(`OfficeCLI output root must be absolute: ${root}`)
  return resolve(root)
}

/** Copy one target cache tree onto a pipiui-runtime extraResources destination. `to` is fixed. */
export async function materializeOfficeCliOverlay(targetCacheDir, runtimeDest) {
  await mkdir(runtimeDest, { recursive: true })
  await cp(targetCacheDir, runtimeDest, { recursive: true })
  return runtimeDest
}

export async function fetchOfficeCliBinary(options = {}) {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const metadata = options.metadata || await loadMetadata(options.metadataPath || defaultMetadataUrl)
  const { key, asset } = resolveAsset(metadata, platform, arch)
  const outputRoot = resolveOutputRoot(options)
  const destination = join(outputRoot, key)
  const now = options.now || Date.now
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  const lockTimeoutMs = options.lockTimeoutMs ?? LOCK_STALE_MS
  const heartbeatMs = options.heartbeatMs ?? LOCK_HEARTBEAT_MS

  if (options.check) {
    const current = await inspectPublishedBinary(destination, { platform, arch, metadata, asset, key })
    if (!current.ok) throw new Error(`OfficeCLI binary check failed for ${key}: ${current.reason}.\nPrepare it with: node Electron/scripts/fetch-officecli-binary.mjs --platform ${platform} --arch ${arch}`)
    return { ...current, key, destination, downloaded: false }
  }

  return withLock(join(outputRoot, `.lock-${key}`), {
    now,
    sleep,
    lockTimeoutMs,
    heartbeatMs,
    initGraceMs: options.initGraceMs,
    pidAlive: options.pidAlive,
    pid: options.pid,
    token: options.token
  }, async () => {
    if (!options.force) {
      const current = await inspectPublishedBinary(destination, { platform, arch, metadata, asset, key })
      if (current.ok) return { ...current, key, destination, downloaded: false }
    }

    const url = assetUrl(metadata, asset)
    if (url.includes('/latest') || url.includes('d.officecli.ai')) {
      throw new Error(`Refusing mutable OfficeCLI URL: ${url}`)
    }
    assertAllowedDownloadUrl(url)
    const scratch = await mkdtemp(join(tmpdir(), `pipiui-officecli-${key}-`))
    const staging = await mkdtemp(join(outputRoot, `.staging-${key}-`))
    try {
      const partial = join(scratch, asset.asset)
      await downloadToFile(url, partial, {
        fetchImpl,
        timeoutMs,
        expectedBytes: asset.bytes,
        maxRedirects: options.maxRedirects ?? MAX_REDIRECTS
      })
      const st = await lstat(partial)
      if (st.isSymbolicLink()) throw new Error(`downloaded OfficeCLI asset is a symlink: ${partial}`)
      if (st.size !== asset.bytes) throw new Error(`OfficeCLI size mismatch for ${key}: expected ${asset.bytes}, got ${st.size}`)
      const bytes = await readFile(partial)
      const actual = sha256(bytes)
      if (actual !== asset.sha256) throw new Error(`OfficeCLI checksum mismatch for ${key}: expected ${asset.sha256}, got ${actual}`)
      const architectures = nativeArchitectures(bytes, platform)
      if (!architectures.includes(arch) || architectures.length !== 1) {
        throw new Error(`OfficeCLI binary is ${architectures.join('+') || 'unrecognized'}, expected single-arch ${arch}`)
      }
      verifyHostTools(partial, platform, arch)
      const stagedDir = join(staging, publishedRelativeDir(platform, arch))
      await mkdir(stagedDir, { recursive: true })
      const stagedBinary = join(stagedDir, binaryName(platform))
      await copyFile(partial, stagedBinary)
      if (platform !== 'win32') await chmod(stagedBinary, 0o755)
      await writeFile(join(stagedDir, OFFICECLI_RECEIPT_NAME), receiptBody({
        version: metadata.version,
        asset: asset.asset,
        sha256: asset.sha256,
        target: key,
        bytes: asset.bytes,
        generatedAt: generatedAtFromEnv(options.env || process.env)
      }))
      await replaceDir(staging, destination)
      const published = await inspectPublishedBinary(destination, { platform, arch, metadata, asset, key })
      if (!published.ok) throw new Error(`Published OfficeCLI failed validation: ${published.reason}`)
      console.log(`OfficeCLI ${metadata.version} ready for ${key}: ${published.binary}`)
      return { ...published, key, destination, downloaded: true, url }
    } finally {
      await rm(scratch, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  const result = await fetchOfficeCliBinary({
    platform: options.platform,
    arch: options.arch,
    check: options.check,
    force: options.force,
    outputRoot: options.outputRoot
  })
  if (options.check) console.log(`OfficeCLI ${result.receipt.version} ok for ${result.key}: ${result.binary}`)
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try { return fileURLToPath(import.meta.url) === resolve(entry) } catch { return false }
}

if (invokedAsCli()) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_DOWNLOAD_HOSTS,
  DOWNLOAD_TIMEOUT_MS,
  LOCK_STALE_MS,
  MAX_REDIRECTS,
  OFFICECLI_RECEIPT_NAME,
  assertAllowedDownloadUrl,
  assetUrl,
  binaryName,
  cacheBinaryPath,
  createOwnerToken,
  fetchOfficeCliBinary,
  loadMetadata,
  materializeOfficeCliOverlay,
  nativeArchitectures,
  packagedBinaryPath,
  parseArgs,
  receiptBody,
  resolveAsset,
  withLock
} from './fetch-officecli-binary.mjs'

const script = new URL('./fetch-officecli-binary.mjs', import.meta.url).pathname

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

function darwinBinary(arch: 'arm64' | 'x64', size = 64) {
  const buf = Buffer.alloc(size)
  buf.writeUInt32LE(0xfeedfacf, 0)
  buf.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
  return buf
}

function linuxBinary(arch: 'arm64' | 'x64', size = 64) {
  const buf = Buffer.alloc(size)
  buf[0] = 0x7f
  buf[1] = 0x45
  buf[2] = 0x4c
  buf[3] = 0x46
  buf[5] = 1
  buf.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
  return buf
}

function winBinary(arch: 'arm64' | 'x64', size = 128) {
  const buf = Buffer.alloc(size)
  buf.write('MZ', 0, 'ascii')
  buf.writeUInt32LE(0x40, 0x3c)
  buf.write('PE\0\0', 0x40, 'binary')
  buf.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 0x44)
  return buf
}

function metadataFor(platform: string, arch: string, bytes: Buffer) {
  const key = `${platform}-${arch}`
  const asset = platform === 'darwin'
    ? `officecli-mac-${arch}`
    : platform === 'linux'
      ? `officecli-linux-${arch}`
      : `officecli-win-${arch}.exe`
  return {
    version: '1.0.144',
    tag: 'v1.0.144',
    repository: 'https://github.com/iOfficeAI/OfficeCLI',
    license: 'Apache-2.0',
    baseUrl: 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144',
    assets: {
      [key]: { asset, sha256: sha256(bytes), bytes: bytes.length }
    }
  }
}

function headers(init?: Record<string, string>) {
  return new Headers(init)
}

function streamBody(chunks: Array<Buffer | Uint8Array>, delayMs = 0) {
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
        controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
      }
      controller.close()
    }
  })
}

function fakeFetch(payload: Buffer, hits: { url?: string; count: number }, opts?: { status?: number, headers?: Record<string, string>, body?: ReadableStream | null }) {
  return async (url: string) => {
    hits.count += 1
    hits.url = url
    if (opts?.status && opts.status !== 200) {
      return { ok: false, status: opts.status, statusText: 'error', headers: headers(opts.headers), body: opts?.body ?? null }
    }
    const hdrs = headers(opts?.headers ?? { 'content-length': String(payload.length) })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: hdrs,
      body: opts?.body === undefined ? null : opts.body,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
    }
  }
}

describe('OfficeCLI native binary fetch', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function tempRoot() {
    root = await mkdtemp(join(tmpdir(), 'pipiui-officecli-test-'))
    return root
  }

  it('pins immutable GitHub v1.0.163 URLs, checksums, and supported targets', async () => {
    const metadata = await loadMetadata()
    expect(metadata.version).toBe('1.0.163')
    expect(metadata.tag).toBe('v1.0.163')
    expect(metadata.repository).toBe('https://github.com/iOfficeAI/OfficeCLI')
    expect(metadata.license).toBe('Apache-2.0')
    expect(metadata.baseUrl).toBe('https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163')
    expect(metadata.baseUrl).not.toContain('latest')
    expect(metadata.baseUrl).not.toContain('d.officecli.ai')
    expect(Object.keys(metadata.assets).sort()).toEqual([
      'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'
    ])
    // Re-fetched official SHA256SUMS via curl from the immutable v1.0.163 GitHub
    // release (file sha256 6c3fa68aba6f0fccfee8cc0be1053040132f2b45b3d107e17b7d9761fa6d50f5).
    // Not persisted. Every checked-in asset hash must match that manifest.
    const officialSha256sums: Record<string, string> = {
      'officecli-linux-arm64': '94dd4e1e5db095d2eec691a74c6fd508bf4b651432aade07d41a217cf997ff83',
      'officecli-linux-x64': 'ba4d75d293aefee222659793074d569a3f94a34a28e2894bfe6d018015cffa95',
      'officecli-mac-arm64': '12bbe7c322a4114533bcc115e8ff6255917a35de0432c85111be534c82a9cbe1',
      'officecli-mac-x64': 'd9737acd91771bcdbc33850423a7edc4a805cc8dd4053a910cd88401baba630c',
      'officecli-win-arm64.exe': '0ef9eff51e2df2ee7cdbfa35e3b5660914412bd288960ce0323c43720856f7f9',
      'officecli-win-x64.exe': '8c351bff88728b538f2754bbfd3a09ea2cf6199c78a9e4feeca717d0135a9f56'
    }
    for (const asset of Object.values(metadata.assets) as Array<{ asset: string, sha256: string }>) {
      expect(asset.sha256).toBe(officialSha256sums[asset.asset])
    }
    const arm = resolveAsset(metadata, 'darwin', 'arm64')
    expect(arm.asset.asset).toBe('officecli-mac-arm64')
    expect(arm.asset.sha256).toBe(officialSha256sums['officecli-mac-arm64'])
    expect(arm.asset.bytes).toBe(33961904)
    expect(assetUrl(metadata, arm.asset)).toBe(
      'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-mac-arm64'
    )
    const win = resolveAsset(metadata, 'win32', 'x64')
    expect(win.asset.asset).toBe('officecli-win-x64.exe')
    expect(binaryName('win32')).toBe('officecli.exe')
    expect(() => resolveAsset(metadata, 'linux', 'ia32')).toThrow(/No pinned OfficeCLI asset/)
    expect(() => parseArgs(['--check', '--force'])).toThrow(/mutually exclusive/)
    expect(LOCK_STALE_MS).toBeGreaterThan(DOWNLOAD_TIMEOUT_MS)
    expect(MAX_REDIRECTS).toBeLessThanOrEqual(5)
    expect(ALLOWED_DOWNLOAD_HOSTS).toEqual([
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com'
    ])
  })

  it('downloads to an isolated temp, verifies size/checksum/arch, chmod 0755, and publishes the overlay layout', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 96)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const hits = { count: 0 }
    const result = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, hits)
    })
    expect(result.downloaded).toBe(true)
    expect(hits.count).toBe(1)
    expect(hits.url).toBe('https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-arm64')
    expect(result.binary).toBe(cacheBinaryPath(outputRoot, 'darwin', 'arm64'))
    expect(result.binary.endsWith(join('extensions', 'office-extension', 'bin', 'darwin-arm64', 'officecli'))).toBe(true)
    const st = await stat(result.binary)
    expect(st.size).toBe(96)
    expect((st.mode & 0o777)).toBe(0o755)
    expect(st.isFile()).toBe(true)
    const receipt = JSON.parse(await readFile(join(dirname(result.binary), OFFICECLI_RECEIPT_NAME), 'utf8'))
    expect(receipt).toEqual({
      version: '1.0.144',
      asset: 'officecli-mac-arm64',
      sha256: sha256(bytes),
      target: 'darwin-arm64',
      bytes: 96
    })
    expect(receipt.generatedAt).toBeUndefined()
    expect(nativeArchitectures(bytes, 'darwin')).toEqual(['arm64'])
  })

  it('omits receipt timestamp unless SOURCE_DATE_EPOCH is set', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('x64', 80)
    const metadata = metadataFor('darwin', 'x64', bytes)
    const hits = { count: 0 }
    await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'x64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, hits),
      env: { SOURCE_DATE_EPOCH: '1700000000' }
    })
    const receipt = JSON.parse(await readFile(join(dirname(cacheBinaryPath(outputRoot, 'darwin', 'x64')), OFFICECLI_RECEIPT_NAME), 'utf8'))
    expect(receipt.generatedAt).toBe(new Date(1700000000 * 1000).toISOString())
    expect(receiptBody({ version: '1.0.144', asset: 'a', sha256: 'b', target: 'darwin-x64', bytes: 1 })).not.toContain('generatedAt')
  })

  it('--check is strictly offline and fails if absent, wrong checksum, mode, or arch', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const exploding = async () => { throw new Error('network should not run') }

    const missing = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, check: true, fetchImpl: exploding
    }).catch((error: Error) => error)
    expect(missing).toBeInstanceOf(Error)
    expect((missing as Error).message).toContain('OfficeCLI binary check failed for darwin-arm64')
    expect((missing as Error).message).toContain('fetch-officecli-binary.mjs --platform darwin --arch arm64')
    await expect(stat(join(outputRoot, 'darwin-arm64'))).rejects.toMatchObject({ code: 'ENOENT' })

    const hits = { count: 0 }
    await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl: fakeFetch(bytes, hits)
    })
    const ok = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, check: true, fetchImpl: exploding
    })
    expect(ok.downloaded).toBe(false)
    expect(hits.count).toBe(1)

    await chmod(ok.binary, 0o644)
    const mode = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, check: true, fetchImpl: exploding
    }).catch((error: Error) => error)
    expect((mode as Error).message).toContain('not owner-executable')
    await chmod(ok.binary, 0o755)

    await writeFile(ok.binary, darwinBinary('x64', 64))
    const arch = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, check: true, fetchImpl: exploding
    }).catch((error: Error) => error)
    expect((arch as Error).message).toMatch(/checksum mismatch|unrecognized binary|x64/)
  })

  it('rejects a corrupt or partial cache and does not leave the dest half-written on failure', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 72)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const binary = cacheBinaryPath(outputRoot, 'darwin', 'arm64')
    await mkdir(dirname(binary), { recursive: true })
    await writeFile(binary, bytes.subarray(0, 10))
    await writeFile(join(dirname(binary), OFFICECLI_RECEIPT_NAME), '{')
    const before = await readFile(binary)

    const exploding = async () => { throw new Error('network should not run') }
    const check = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata, check: true, fetchImpl: exploding
    }).catch((error: Error) => error)
    expect((check as Error).message).toContain('check failed')
    expect(await readFile(binary)).toEqual(before)

    const mismatch = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(Buffer.concat([bytes, Buffer.from('x')]), { count: 0 })
    }).catch((error: Error) => error)
    expect((mismatch as Error).message).toMatch(/size mismatch|Content-Length|exceeded expected/)
    expect(await readFile(binary)).toEqual(before)
  })

  it('rejects a checksum mismatch from the network and cleans the staging tree', async () => {
    const outputRoot = await tempRoot()
    const good = darwinBinary('arm64', 64)
    const bad = darwinBinary('arm64', 64)
    bad[20] = 1
    const metadata = metadataFor('darwin', 'arm64', good)
    const error = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bad, { count: 0 })
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('checksum mismatch')
    const entries = await readFile(cacheBinaryPath(outputRoot, 'darwin', 'arm64')).catch((err: NodeJS.ErrnoException) => err)
    expect((entries as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  it('rejects the wrong target and never executes install', async () => {
    const outputRoot = await tempRoot()
    const source = await readFile(new URL('./fetch-officecli-binary.mjs', import.meta.url), 'utf8')
    expect(source).not.toContain('https://d.officecli.ai')
    expect(source).not.toContain('/releases/latest/download')
    expect(source).toContain('Refusing mutable OfficeCLI URL')
    expect(source).toContain('Never PATH')
    expect(source).toContain("redirect: 'manual'")
    const linux = linuxBinary('x64', 80)
    const metadata = metadataFor('linux', 'x64', linux)
    const error = await fetchOfficeCliBinary({
      platform: 'linux',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(linux, { count: 0 })
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('No pinned OfficeCLI asset for linux-arm64')
  })

  it('revalidates a warm cache without downloading', async () => {
    const outputRoot = await tempRoot()
    const bytes = winBinary('x64', 160)
    const metadata = metadataFor('win32', 'x64', bytes)
    const hits = { count: 0 }
    const first = await fetchOfficeCliBinary({
      platform: 'win32', arch: 'x64', outputRoot, metadata, fetchImpl: fakeFetch(bytes, hits)
    })
    expect(first.downloaded).toBe(true)
    expect(first.binary.endsWith('officecli.exe')).toBe(true)
    const second = await fetchOfficeCliBinary({
      platform: 'win32', arch: 'x64', outputRoot, metadata, fetchImpl: fakeFetch(bytes, hits)
    })
    expect(second.downloaded).toBe(false)
    expect(hits.count).toBe(1)
  })

  it('serializes concurrent invocations with a lock so only one download runs', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 88)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    let current = 0
    let max = 0
    let fetches = 0
    const fetchImpl = async (url: string) => {
      fetches += 1
      current += 1
      max = Math.max(max, current)
      await new Promise(resolve => setTimeout(resolve, 80))
      current -= 1
      return fakeFetch(bytes, { count: 0 })(url)
    }
    const [a, b] = await Promise.all([
      fetchOfficeCliBinary({ platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl, lockTimeoutMs: 5_000 }),
      fetchOfficeCliBinary({ platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl, lockTimeoutMs: 5_000 })
    ])
    expect(max).toBe(1)
    expect(fetches).toBe(1)
    expect(a.binary).toBe(b.binary)
    expect(a.downloaded !== b.downloaded).toBe(true)
  })

  it('does not steal a lock whose recorded live PID still exists, even past the stale age', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const token = randomBytes(16).toString('hex')
    const foreignBody = `${JSON.stringify({ pid: process.pid, token, startedAt: 1, heartbeatMs: 0 })}\n`
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir, { recursive: true })
    const foreignFile = join(lockDir, `${token}.owner`)
    await writeFile(foreignFile, foreignBody)
    const error = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      lockTimeoutMs: 80,
      heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('lock timed out')
    expect(await readFile(foreignFile, 'utf8')).toBe(foreignBody)
    expect(await readdir(lockDir)).toEqual([`${token}.owner`])
    expect(existsSync(cacheBinaryPath(outputRoot, 'darwin', 'arm64'))).toBe(false)
  })

  it('steals only a dead-and-stale owner lock and removes only the observed token file', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const token = randomBytes(16).toString('hex')
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, `${token}.owner`), `${JSON.stringify({ pid: 999_999_999, token, startedAt: 1, heartbeatMs: 0 })}\n`)
    const result = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      lockTimeoutMs: 2_000,
      heartbeatMs: 20
    })
    expect(result.downloaded).toBe(true)
    expect(existsSync(lockDir)).toBe(false)
  })

  it('does not steal a dead owner whose heartbeat is still inside the stale window', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const token = randomBytes(16).toString('hex')
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir, { recursive: true })
    const foreignFile = join(lockDir, `${token}.owner`)
    const foreignBody = `${JSON.stringify({ pid: 999_999_999, token, startedAt: 1, heartbeatMs: Date.now() + 60_000 })}\n`
    await writeFile(foreignFile, foreignBody)
    const error = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      lockTimeoutMs: 80,
      heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('lock timed out')
    expect(await readFile(foreignFile, 'utf8')).toBe(foreignBody)
    expect(existsSync(cacheBinaryPath(outputRoot, 'darwin', 'arm64'))).toBe(false)
  })

  it('a replaced lock directory is never written, truncated, or deleted by the old owner', async () => {
    const outputRoot = await tempRoot()
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    let entered!: () => void
    const enteredP = new Promise<void>(resolve => { entered = resolve })
    let openGate!: () => void
    const gate = new Promise<void>(resolve => { openGate = resolve })
    const job = withLock(lockDir, { heartbeatMs: 20, lockTimeoutMs: 10_000 }, async () => {
      entered()
      await gate
      return 'owned'
    })
    await enteredP
    const ours = await readdir(lockDir)
    expect(ours).toHaveLength(1)
    expect(ours[0]).toMatch(/^[0-9a-f]{32}\.owner$/)
    // Replace the lock directory wholesale with a foreign one.
    await rm(join(lockDir, ours[0]))
    await rmdir(lockDir)
    await mkdir(lockDir)
    const foreignToken = randomBytes(16).toString('hex')
    const foreignBody = `${JSON.stringify({ pid: 4242, token: foreignToken, startedAt: 5, heartbeatMs: Date.now() })}\n`
    const foreignFile = join(lockDir, `${foreignToken}.owner`)
    await writeFile(foreignFile, foreignBody)
    // Several heartbeat ticks fire while the directory is replaced.
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(await readFile(foreignFile, 'utf8')).toBe(foreignBody)
    openGate()
    await expect(job).resolves.toBe('owned')
    expect(await readFile(foreignFile, 'utf8')).toBe(foreignBody)
    expect(await readdir(lockDir)).toEqual([`${foreignToken}.owner`])
  })

  it('two simultaneous stale recoverers converge on exactly one download', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const token = randomBytes(16).toString('hex')
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, `${token}.owner`), `${JSON.stringify({ pid: 999_999_999, token, startedAt: 1, heartbeatMs: 0 })}\n`)
    let fetches = 0
    const fetchImpl = async (url: string) => {
      fetches += 1
      await new Promise(resolve => setTimeout(resolve, 40))
      return fakeFetch(bytes, { count: 0 })(url)
    }
    const [a, b] = await Promise.all([
      fetchOfficeCliBinary({ platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl, lockTimeoutMs: 5_000 }),
      fetchOfficeCliBinary({ platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl, lockTimeoutMs: 5_000 })
    ])
    expect(fetches).toBe(1)
    expect(a.downloaded !== b.downloaded).toBe(true)
    expect(existsSync(lockDir)).toBe(false)
  })

  it('recovers an empty half-created lock directory only after the bounded grace', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir)
    const started = Date.now()
    const result = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      initGraceMs: 40,
      lockTimeoutMs: 5_000,
      heartbeatMs: 20
    })
    expect(result.downloaded).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
    expect(existsSync(lockDir)).toBe(false)
  })

  it('fails closed on a symlinked owner entry and never touches it or its target', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(lockDir)
    const secret = join(outputRoot, 'secret-target')
    await writeFile(secret, 'do-not-read-or-delete')
    const token = randomBytes(16).toString('hex')
    await symlink(secret, join(lockDir, `${token}.owner`))
    const error = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      lockTimeoutMs: 100,
      heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('lock timed out')
    expect((await lstat(join(lockDir, `${token}.owner`))).isSymbolicLink()).toBe(true)
    expect(await readFile(secret, 'utf8')).toBe('do-not-read-or-delete')
    expect(await readdir(lockDir)).toEqual([`${token}.owner`])
  })

  it('fails closed on multiple entries, unexpected names, and invalid owner bodies', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const tokenA = randomBytes(16).toString('hex')
    const tokenB = randomBytes(16).toString('hex')

    const multi = join(outputRoot, '.lock-darwin-arm64')
    await mkdir(multi)
    await writeFile(join(multi, `${tokenA}.owner`), `${JSON.stringify({ pid: 999_999_999, token: tokenA, startedAt: 1, heartbeatMs: 0 })}\n`)
    await writeFile(join(multi, `${tokenB}.owner`), `${JSON.stringify({ pid: 999_999_999, token: tokenB, startedAt: 1, heartbeatMs: 0 })}\n`)
    const multiError = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }), lockTimeoutMs: 80, heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((multiError as Error).message).toContain('lock timed out')
    expect((await readdir(multi)).sort()).toEqual([`${tokenA}.owner`, `${tokenB}.owner`].sort())

    const weird = join(outputRoot, '.lock-darwin-arm64')
    await rm(multi, { recursive: true, force: true })
    await mkdir(weird)
    await writeFile(join(weird, 'not-an-owner'), 'x')
    const weirdError = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }), lockTimeoutMs: 80, heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((weirdError as Error).message).toContain('lock timed out')
    expect(await readdir(weird)).toEqual(['not-an-owner'])

    const garbage = join(outputRoot, '.lock-darwin-arm64')
    await rm(weird, { recursive: true, force: true })
    await mkdir(garbage)
    await writeFile(join(garbage, `${tokenA}.owner`), 'not json at all')
    const garbageError = await fetchOfficeCliBinary({
      platform: 'darwin', arch: 'arm64', outputRoot, metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }), lockTimeoutMs: 80, heartbeatMs: 20
    }).catch((err: Error) => err)
    expect((garbageError as Error).message).toContain('lock timed out')
    expect(await readFile(join(garbage, `${tokenA}.owner`), 'utf8')).toBe('not json at all')
  })

  it('names owner files with unguessable strict-shape tokens', async () => {
    const outputRoot = await tempRoot()
    const lockDir = join(outputRoot, '.lock-uniqueness')
    const names: string[] = []
    for (let i = 0; i < 2; i += 1) {
      await withLock(lockDir, { heartbeatMs: 10_000, lockTimeoutMs: 1_000 }, async () => {
        names.push(...(await readdir(lockDir)))
      })
    }
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name).toMatch(/^[0-9a-f]{32}\.owner$/)
    expect(createOwnerToken()).not.toBe(createOwnerToken())
    expect(createOwnerToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('keeps a live lock through a slow download longer than the old 120s stale window via heartbeat', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 80)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    let fetches = 0
    const fetchImpl = async (url: string) => {
      fetches += 1
      await new Promise(resolve => setTimeout(resolve, 120))
      return fakeFetch(bytes, { count: 0 })(url)
    }
    const started = Date.now()
    const [a, b] = await Promise.all([
      fetchOfficeCliBinary({
        platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl,
        lockTimeoutMs: 80, heartbeatMs: 15
      }),
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        return fetchOfficeCliBinary({
          platform: 'darwin', arch: 'arm64', outputRoot, metadata, fetchImpl,
          lockTimeoutMs: 2_000, heartbeatMs: 15
        })
      })()
    ])
    expect(Date.now() - started).toBeGreaterThanOrEqual(80)
    expect(fetches).toBe(1)
    expect(a.downloaded !== b.downloaded).toBe(true)
  })

  it('rejects missing Content-Length overflow and lying Content-Length before/during stream', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)

    const noLengthOversize = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }, {
        headers: {},
        body: streamBody([bytes, Buffer.from('x')])
      })
    }).catch((err: Error) => err)
    expect((noLengthOversize as Error).message).toMatch(/exceeded expected 64/)
    expect(existsSync(cacheBinaryPath(outputRoot, 'darwin', 'arm64'))).toBe(false)

    const lyingHeader = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }, { headers: { 'content-length': '999999' } })
    }).catch((err: Error) => err)
    expect((lyingHeader as Error).message).toContain('Content-Length mismatch')

    const exactNoLength = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }, {
        headers: {},
        body: streamBody([bytes])
      })
    })
    expect(exactNoLength.downloaded).toBe(true)

    const lyingMatchButLonger = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      force: true,
      fetchImpl: fakeFetch(bytes, { count: 0 }, {
        headers: { 'content-length': String(bytes.length) },
        body: streamBody([bytes, Buffer.from('!')])
      })
    }).catch((err: Error) => err)
    expect((lyingMatchButLonger as Error).message).toMatch(/exceeded expected 64/)
  })

  it('follows a small number of HTTPS GitHub redirects and rejects host/protocol drift and loops', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const start = 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-arm64'
    const asset = 'https://objects.githubusercontent.com/github-production-release-asset-2e65be/officecli-mac-arm64'

    const okHits: string[] = []
    const ok = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: async (url: string, init?: { redirect?: string }) => {
        okHits.push(url)
        expect(init?.redirect).toBe('manual')
        if (url === start) {
          return { ok: false, status: 302, statusText: 'Found', headers: headers({ location: asset }), body: null }
        }
        return fakeFetch(bytes, { count: 0 })(url)
      }
    })
    expect(ok.downloaded).toBe(true)
    expect(okHits).toEqual([start, asset])

    expect(() => assertAllowedDownloadUrl('http://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/x')).toThrow(/protocol drift/)
    expect(() => assertAllowedDownloadUrl('https://evil.example/x')).toThrow(/host drift/)

    const drift = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      force: true,
      fetchImpl: async () => ({
        ok: false, status: 302, statusText: 'Found',
        headers: headers({ location: 'https://evil.example/payload' }),
        body: null
      })
    }).catch((err: Error) => err)
    expect((drift as Error).message).toContain('host drift')

    const loopA = 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-arm64'
    const loopB = 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-arm64-loop'
    const loop = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      force: true,
      fetchImpl: async (url: string) => ({
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: headers({ location: url === loopA ? loopB : loopA }),
        body: null
      })
    }).catch((err: Error) => err)
    expect((loop as Error).message).toMatch(/redirect loop/)
  })

  it('CLI --check does not create the output root', async () => {
    const outputRoot = await tempRoot()
    const missing = join(outputRoot, 'empty-cache')
    const result = spawnSync(process.execPath, [script, '--platform', 'darwin', '--arch', 'arm64', '--check', '--output-root', missing], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' }
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('OfficeCLI binary check failed')
    await expect(stat(join(missing, 'darwin-arm64'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symlink at the published path', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const binary = cacheBinaryPath(outputRoot, 'darwin', 'arm64')
    await mkdir(dirname(binary), { recursive: true })
    const target = join(dirname(binary), 'real')
    await writeFile(target, bytes)
    await chmod(target, 0o755)
    await symlink(target, binary)
    await writeFile(join(dirname(binary), OFFICECLI_RECEIPT_NAME), receiptBody({
      version: '1.0.144',
      asset: 'officecli-mac-arm64',
      sha256: sha256(bytes),
      target: 'darwin-arm64',
      bytes: bytes.length
    }))
    const error = await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      check: true,
      fetchImpl: async () => { throw new Error('network') }
    }).catch((err: Error) => err)
    expect((error as Error).message).toContain('must not be a symlink')
  })

  it('materializes extraResources overlay onto fixed pipiui-runtime without opposite-arch leakage', async () => {
    const outputRoot = await tempRoot()
    const arm = darwinBinary('arm64', 64)
    const x64 = darwinBinary('x64', 64)
    await mkdir(dirname(cacheBinaryPath(outputRoot, 'darwin', 'arm64')), { recursive: true })
    await mkdir(dirname(cacheBinaryPath(outputRoot, 'darwin', 'x64')), { recursive: true })
    await writeFile(cacheBinaryPath(outputRoot, 'darwin', 'arm64'), arm)
    await writeFile(join(dirname(cacheBinaryPath(outputRoot, 'darwin', 'arm64')), OFFICECLI_RECEIPT_NAME), 'arm')
    await writeFile(cacheBinaryPath(outputRoot, 'darwin', 'x64'), x64)
    await writeFile(join(dirname(cacheBinaryPath(outputRoot, 'darwin', 'x64')), OFFICECLI_RECEIPT_NAME), 'x64')

    const runtime = join(outputRoot, 'Resources', 'pipiui-runtime')
    await materializeOfficeCliOverlay(join(outputRoot, 'darwin-arm64'), runtime)
    expect(existsSync(packagedBinaryPath(runtime, 'darwin', 'arm64'))).toBe(true)
    expect(existsSync(packagedBinaryPath(runtime, 'darwin', 'x64'))).toBe(false)
    expect(await readFile(packagedBinaryPath(runtime, 'darwin', 'arm64'))).toEqual(arm)
    expect(await readFile(join(dirname(packagedBinaryPath(runtime, 'darwin', 'arm64')), OFFICECLI_RECEIPT_NAME), 'utf8')).toBe('arm')
  })

  it('caps download time below the conservative lock stale window', () => {
    expect(DOWNLOAD_TIMEOUT_MS).toBe(180_000)
    expect(LOCK_STALE_MS).toBeGreaterThan(DOWNLOAD_TIMEOUT_MS)
  })

  it('releases the lock immediately without waiting out the heartbeat interval', async () => {
    const outputRoot = await tempRoot()
    const bytes = darwinBinary('arm64', 64)
    const metadata = metadataFor('darwin', 'arm64', bytes)
    const lockDir = join(outputRoot, '.lock-darwin-arm64')
    const started = Date.now()
    await fetchOfficeCliBinary({
      platform: 'darwin',
      arch: 'arm64',
      outputRoot,
      metadata,
      fetchImpl: fakeFetch(bytes, { count: 0 }),
      heartbeatMs: 10_000,
      lockTimeoutMs: 20_000
    })
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(2_000)
    expect(existsSync(lockDir)).toBe(false)
    // No timer survived the release: nothing fires or mutates afterwards.
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(existsSync(lockDir)).toBe(false)
  })

  it('clears the heartbeat timer: advancing time past the interval cannot resurrect the lock', async () => {
    vi.useFakeTimers()
    try {
      const outputRoot = await tempRoot()
      const bytes = darwinBinary('arm64', 64)
      const metadata = metadataFor('darwin', 'arm64', bytes)
      const lockDir = join(outputRoot, '.lock-darwin-arm64')
      await fetchOfficeCliBinary({
        platform: 'darwin',
        arch: 'arm64',
        outputRoot,
        metadata,
        fetchImpl: fakeFetch(bytes, { count: 0 }),
        heartbeatMs: 5_000,
        lockTimeoutMs: 20_000
      })
      expect(existsSync(lockDir)).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(existsSync(lockDir)).toBe(false)
      // A stale owner writes only through its own open handle, so a foreign lock
      // directory can never be rewritten or removed by our leftover timers.
      const foreignToken = randomBytes(16).toString('hex')
      await mkdir(lockDir)
      const foreignBody = `${JSON.stringify({ pid: 1, token: foreignToken, startedAt: 1, heartbeatMs: Date.now() })}\n`
      await writeFile(join(lockDir, `${foreignToken}.owner`), foreignBody)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await readFile(join(lockDir, `${foreignToken}.owner`), 'utf8')).toBe(foreignBody)
      expect(await readdir(lockDir)).toEqual([`${foreignToken}.owner`])
    } finally {
      vi.useRealTimers()
    }
  })
})

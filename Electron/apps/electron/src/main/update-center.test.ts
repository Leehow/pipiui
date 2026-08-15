import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compareSemver, createUpdateCenterService, latestCuaDriverVersion, latestNodeVersion, npmLatestVersion, UPDATE_CENTER_FRAMEWORK_VERSIONS } from './update-center.js'

const response = (payload: unknown, ok = true, status = 200) => ({ ok, status, json: async () => payload })

describe('update center version discovery', () => {
  it('compares newer, equal, older, prerelease and malformed semvers', () => {
    expect(compareSemver('0.84.2', '0.84.0')).toBeGreaterThan(0)
    expect(compareSemver('0.84.0', '0.84.0')).toBe(0)
    expect(compareSemver('0.83.9', '0.84.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('not-a-version', '1.0.0')).toBeUndefined()
  })

  it('uses npm dist-tags.latest and rejects malformed registry data', () => {
    expect(npmLatestVersion({ 'dist-tags': { latest: '0.84.2', next: '0.85.0-beta.1' } })).toBe('0.84.2')
    expect(npmLatestVersion({ version: '0.84.2' })).toBeUndefined()
    expect(npmLatestVersion({ 'dist-tags': { latest: 'latest' } })).toBeUndefined()
  })

  it('filters mixed Cua monorepo releases by driver prefix and includes non-draft prerelease-marked releases', () => {
    expect(latestCuaDriverVersion([
      { tag_name: 'computer-v1.9.0', draft: false },
      { tag_name: 'cua-driver-rs-v0.19.2', draft: false, prerelease: false },
      { tag_name: 'cua-driver-rs-v0.19.4', draft: true, prerelease: false },
      { tag_name: 'cua-driver-rs-v0.19.3', draft: false, prerelease: true },
      { tag_name: 'cua-driver-rs-vbroken', draft: false }
    ])).toBe('0.19.3')
  })

  it('selects the highest semver from the official Node distribution index', () => {
    expect(latestNodeVersion([{ version: 'v22.19.0' }, { version: 'v24.8.0', security: true }, { version: 'nightly' }])).toBe('24.8.0')
  })

  it('keeps explicit framework versions aligned with the resolved Electron app lockfile', () => {
    const lock = JSON.parse(readFileSync(new URL('../../../../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string }> }
    expect(UPDATE_CENTER_FRAMEWORK_VERSIONS).toEqual({
      electron: lock.packages['node_modules/electron'].version,
      vite: lock.packages['apps/electron/node_modules/vite'].version,
      'electron-vite': lock.packages['apps/electron/node_modules/electron-vite'].version
    })
  })

  it('returns update, current, malformed-local, malformed-remote, and offline statuses independently', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('pi-new')) return response({ 'dist-tags': { latest: '2.0.0' } })
      if (url.includes('pi-current')) return response({ 'dist-tags': { latest: '1.0.0' } })
      if (url.includes('pi-malformed-remote')) return response({ 'dist-tags': { latest: 'banana' } })
      throw new Error('offline')
    })
    const check = createUpdateCenterService({ now: () => 123, fetch, catalog: [
      { id: 'new', name: 'New', category: 'extension', currentVersion: '1.0.0', source: { type: 'npm', packageName: 'pi-new' } },
      { id: 'current', name: 'Current', category: 'extension', currentVersion: '1.0.0', source: { type: 'npm', packageName: 'pi-current' } },
      { id: 'bad-local', name: 'Bad local', category: 'extension', currentVersion: 'workspace:*', source: { type: 'npm', packageName: 'pi-bad-local' } },
      { id: 'bad-remote', name: 'Bad remote', category: 'extension', currentVersion: '1.0.0', source: { type: 'npm', packageName: 'pi-malformed-remote' } },
      { id: 'offline', name: 'Offline', category: 'extension', currentVersion: '1.0.0', source: { type: 'npm', packageName: 'pi-offline' } }
    ] })
    const snapshot = await check()
    expect(snapshot.checkedAt).toBe(123)
    expect(snapshot.items.map(item => item.status)).toEqual(['updateAvailable', 'upToDate', 'notCheckable', 'checkFailed', 'checkFailed'])
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('selects Cua from the official GitHub release listing', async () => {
    const fetch = vi.fn(async () => response([
      { tag_name: 'computer-v9.0.0', draft: false },
      { tag_name: 'cua-driver-rs-v0.19.3', draft: false, prerelease: true }
    ]))
    const snapshot = await createUpdateCenterService({ fetch, catalog: [
      { id: 'cua', name: 'Cua Driver', category: 'runtime', currentVersion: '0.19.2', source: { type: 'cuaGitHub' } }
    ] })()
    expect(snapshot.items[0]).toMatchObject({ latestVersion: '0.19.3', status: 'updateAvailable' })
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/trycua/cua/releases?per_page=100')
  })

  it('checks embedded Node against the official distribution index and preserves hierarchy metadata', async () => {
    const fetch = vi.fn(async () => response([{ version: 'v24.8.0' }, { version: 'v22.19.0' }]))
    const snapshot = await createUpdateCenterService({ fetch, catalog: [
      { id: 'node', name: 'Node.js 内置 Pi 运行时', category: 'runtime', currentVersion: '22.19.0', source: { type: 'nodeDist' } }
    ] })()
    expect(snapshot.items[0]).toMatchObject({ category: 'runtime', latestVersion: '24.8.0', status: 'updateAvailable' })
    expect(fetch.mock.calls[0][0]).toBe('https://nodejs.org/dist/index.json')
  })

  it('aborts a version request after the bounded timeout', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<ReturnType<typeof response>>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const snapshot = await createUpdateCenterService({ timeoutMs: 5, fetch, catalog: [
      { id: 'slow', name: 'Slow', category: 'extension', currentVersion: '1.0.0', source: { type: 'npm', packageName: 'slow-package' } }
    ] })()
    expect(snapshot.items[0]).toMatchObject({ status: 'checkFailed', error: 'aborted' })
  })
})

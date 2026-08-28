import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compareSemver, createUpdateCenterService, extensionUpdateCatalogItems, latestCuaDriverVersion, latestGitHubReleaseVersion, latestNodeVersion, npmLatestVersion, pypiLatestVersion, UPDATE_CENTER_FRAMEWORK_VERSIONS, type UpdateCatalogItem } from './update-center.js'

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

  it('uses the official PyPI info.version field and rejects malformed project data', () => {
    expect(pypiLatestVersion({ info: { name: 'headroom-ai', version: '0.36.5' } })).toBe('0.36.5')
    expect(pypiLatestVersion({ version: '0.36.5' })).toBeUndefined()
    expect(pypiLatestVersion({ info: { version: 'latest' } })).toBeUndefined()
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

  it('selects the highest LTS semver from the official Node distribution index', () => {
    expect(latestNodeVersion([
      { version: 'v24.19.0', lts: 'Krypton' },
      { version: 'v26.7.0', lts: false },
      { version: 'nightly', lts: 'Krypton' }
    ])).toBe('24.19.0')
  })

  it('keeps explicit framework versions aligned with the resolved Electron app lockfile', () => {
    const lock = JSON.parse(readFileSync(new URL('../../../../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string }> }
    expect(UPDATE_CENTER_FRAMEWORK_VERSIONS).toEqual({
      electron: lock.packages['node_modules/electron'].version,
      vite: (lock.packages['apps/electron/node_modules/vite'] ?? lock.packages['node_modules/vite']).version,
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

  it('checks Headroom against the official PyPI project endpoint', async () => {
    const fetch = vi.fn(async () => response({ info: { name: 'headroom-ai', version: '0.37.0' } }))
    const snapshot = await createUpdateCenterService({ fetch, catalog: [
      { id: 'headroom-ai', name: 'Headroom', category: 'extension', currentVersion: '0.36.5', source: { type: 'pypi', packageName: 'headroom-ai' } }
    ] })()
    expect(snapshot.items[0]).toMatchObject({ packageName: 'headroom-ai', latestVersion: '0.37.0', status: 'updateAvailable' })
    expect(fetch.mock.calls[0][0]).toBe('https://pypi.org/pypi/headroom-ai/json')
  })

  it('checks embedded Node against the official distribution index and preserves hierarchy metadata', async () => {
    const fetch = vi.fn(async () => response([
      { version: 'v26.7.0', lts: false },
      { version: 'v24.19.0', lts: 'Krypton' },
      { version: 'v22.23.2', lts: 'Jod' }
    ]))
    const snapshot = await createUpdateCenterService({ fetch, catalog: [
      { id: 'node', name: 'Node.js 内置 Pi 运行时', category: 'runtime', currentVersion: '22.19.0', source: { type: 'nodeDist' } }
    ] })()
    expect(snapshot.items[0]).toMatchObject({ category: 'runtime', latestVersion: '24.19.0', status: 'updateAvailable' })
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

describe('bundled extension update components', () => {
  it('parses generic GitHub Releases payloads and ignores drafts and off-convention tags', () => {
    expect(latestGitHubReleaseVersion([
      { tag_name: 'v1.2.0', draft: false },
      { tag_name: 'v2.0.0-rc.1', draft: false, prerelease: true },
      { tag_name: 'v2.0.0', draft: true },
      { tag_name: 'nightly-9', draft: false },
      { tag_name: 'computer-v9.0.0', draft: false }
    ])).toBe('2.0.0-rc.1')
    expect(latestGitHubReleaseVersion({ tag_name: 'v1.0.0' })).toBeUndefined()
    expect(latestGitHubReleaseVersion([])).toBeUndefined()
  })

  it('maps enabled bundled extension declarations into namespaced catalog items with owner metadata', () => {
    const items = extensionUpdateCatalogItems([
      {
        id: 'pdf-extension',
        name: 'PipiUI PDF',
        state: 'enabled',
        origin: 'app',
        updateComponents: [
          { id: 'pdf-inspector', name: 'Firecrawl PDF Inspector', version: '1.15.0', source: { type: 'npm', packageName: '@firecrawl/pdf-inspector' } },
          { id: 'pdf-inspector-wasm', name: 'Firecrawl PDF Inspector WASM', version: '1.15.0', source: { type: 'githubReleases', owner: 'firecrawl', repo: 'pdf-inspector' } }
        ]
      },
      { id: 'disabled-ext', name: 'Disabled', state: 'disabled', origin: 'app', updateComponents: [{ id: 'c', name: 'C', version: '1.0.0', source: { type: 'npm', packageName: 'c' } }] },
      { id: 'project-ext', name: 'Project', state: 'enabled', origin: 'project', updateComponents: [{ id: 'c', name: 'C', version: '1.0.0', source: { type: 'npm', packageName: 'c' } }] },
      { id: 'bare-ext', name: 'Bare', state: 'enabled', origin: 'builtin' }
    ])
    expect(items).toEqual([
      { id: 'pdf-extension:pdf-inspector', name: 'Firecrawl PDF Inspector', category: 'extension', currentVersion: '1.15.0', source: { type: 'npm', packageName: '@firecrawl/pdf-inspector' }, ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' },
      { id: 'pdf-extension:pdf-inspector-wasm', name: 'Firecrawl PDF Inspector WASM', category: 'extension', currentVersion: '1.15.0', source: { type: 'githubReleases', owner: 'firecrawl', repo: 'pdf-inspector' }, ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' }
    ])
  })

  it('maps the read-only backend snapshot: extra list-item fields are ignored and project-origin or disabled entries never contribute', () => {
    const snapshot = [
      {
        id: 'pdf-extension',
        name: 'PipiUI PDF',
        state: 'enabled',
        origin: 'app',
        source: 'app',
        capabilities: ['bridge.emit'],
        directory: '/extensions/pdf-extension',
        contributions: {},
        updateComponents: [
          {
            id: 'pdf-inspector',
            name: 'Firecrawl PDF Inspector',
            version: '1.15.0',
            upstream: 'https://github.com/firecrawl/pdf-inspector',
            license: 'MIT',
            source: { type: 'npm', packageName: '@firecrawl/pdf-inspector' }
          }
        ]
      },
      { id: 'proj-ext', name: 'Project Ext', state: 'enabled', origin: 'project', updateComponents: [{ id: 'c', name: 'C', version: '1.0.0', source: { type: 'npm', packageName: 'c' } }] },
      { id: 'off-builtin', name: 'Off Builtin', state: 'disabled', origin: 'builtin', updateComponents: [{ id: 'c', name: 'C', version: '1.0.0', source: { type: 'npm', packageName: 'c' } }] }
    ] as Parameters<typeof extensionUpdateCatalogItems>[0]
    const items = extensionUpdateCatalogItems(snapshot)
    expect(items.map(item => item.id)).toEqual(['pdf-extension:pdf-inspector'])
    expect(items[0]).toMatchObject({
      name: 'Firecrawl PDF Inspector',
      category: 'extension',
      currentVersion: '1.15.0',
      source: { type: 'npm', packageName: '@firecrawl/pdf-inspector' },
      ownerExtensionId: 'pdf-extension',
      ownerExtensionName: 'PipiUI PDF'
    })
  })

  it('resolves a declared githubReleases component at the fixed GitHub API and keeps owner, category and source on failure', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.github.com/repos/firecrawl/pdf-inspector/releases?per_page=100') {
        expect(init?.headers).toEqual({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' })
        return response([{ tag_name: 'v1.17.0', draft: false }])
      }
      if (url === 'https://registry.npmjs.org/electron') return response({ 'dist-tags': { latest: '44.0.0' } })
      throw new Error('offline')
    })
    const catalog: UpdateCatalogItem[] = [
      { id: 'electron', name: 'Electron', category: 'platform', currentVersion: '44.0.0', source: { type: 'npm', packageName: 'electron' } },
      { id: 'pdf-extension:pdf-inspector', name: 'Firecrawl PDF Inspector', category: 'extension', currentVersion: '1.15.0', source: { type: 'githubReleases', owner: 'firecrawl', repo: 'pdf-inspector' }, ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' },
      { id: 'pdf-extension:pdf-inspector-wasm', name: 'Firecrawl PDF Inspector WASM', category: 'extension', currentVersion: '1.15.0', source: { type: 'npm', packageName: '@firecrawl/pdf-inspector-wasm' }, ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' }
    ]
    const snapshot = await createUpdateCenterService({ fetch, catalog: () => catalog })()
    expect(snapshot.items[0]).toMatchObject({ id: 'electron', category: 'platform', status: 'upToDate' })
    expect(snapshot.items[1]).toEqual({
      id: 'pdf-extension:pdf-inspector',
      name: 'Firecrawl PDF Inspector',
      category: 'extension',
      sourceLabel: 'firecrawl/pdf-inspector',
      ownerExtensionId: 'pdf-extension',
      ownerExtensionName: 'PipiUI PDF',
      currentVersion: '1.15.0',
      latestVersion: '1.17.0',
      status: 'updateAvailable'
    })
    expect(snapshot.items[2]).toMatchObject({
      packageName: '@firecrawl/pdf-inspector-wasm',
      category: 'extension',
      ownerExtensionId: 'pdf-extension',
      ownerExtensionName: 'PipiUI PDF',
      status: 'checkFailed',
      error: 'offline'
    })
  })

  it('merges discovered extension components per check without dropping fixed items and preserves owner when a local version is not SemVer', async () => {
    const fetch = vi.fn(async () => response({ 'dist-tags': { latest: '1.16.0' } }))
    const fixed: UpdateCatalogItem[] = [
      { id: 'vite', name: 'Vite', category: 'toolchain', currentVersion: '7.3.6', source: { type: 'npm', packageName: 'vite' } }
    ]
    const discovered = extensionUpdateCatalogItems([
      { id: 'pdf-extension', name: 'PipiUI PDF', state: 'enabled', origin: 'app', updateComponents: [{ id: 'pdf-inspector', name: 'Firecrawl PDF Inspector', version: 'not-a-version', source: { type: 'npm', packageName: '@firecrawl/pdf-inspector' } }] }
    ])
    const snapshot = await createUpdateCenterService({ fetch, catalog: () => [...fixed, ...discovered] })()
    expect(snapshot.items.map(item => item.id)).toEqual(['vite', 'pdf-extension:pdf-inspector'])
    expect(snapshot.items[1]).toMatchObject({ category: 'extension', ownerExtensionId: 'pdf-extension', status: 'notCheckable' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

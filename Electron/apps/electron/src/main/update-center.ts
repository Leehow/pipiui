import type { ExtensionComponentUpdateResult, HostBackend, UpdateCenterItem, UpdateCenterItemCategory, UpdateCenterSnapshot } from '@pipi/host-api'

/** Build-time tools are not shipped as runtime dependencies, so keep their resolved versions explicit and test them against the lockfile. */
export const UPDATE_CENTER_FRAMEWORK_VERSIONS = {
  electron: '45.4.1',
  vite: '8.3.8',
  'electron-vite': '6.0.0'
} as const

export type UpdateCatalogItem = {
  id: string
  name: string
  category: UpdateCenterItemCategory
  currentVersion: string
  source: { type: 'npm'; packageName: string } | { type: 'pypi'; packageName: string } | { type: 'cuaGitHub' } | { type: 'nodeDist' } | { type: 'githubReleases'; owner: string; repo: string } | { type: 'githubCommits'; owner: string; repo: string; ref: string }
  /** Owning bundled extension when this item was discovered from a manifest `updateComponents` declaration. */
  ownerExtensionId?: string
  ownerExtensionName?: string
  /** Human-facing version source when `packageName` does not apply (e.g. GitHub `owner/repo`). */
  sourceLabel?: string
  /** Host can run the one-click update transaction for this component (official githubReleases package artifact). */
  transactional?: boolean
}

/**
 * App-side structural view of a manifest-declared update component (pi-backend
 * `ExtensionUpdateComponent`): the same closed fixed-registry source union.
 */
export type DeclaredUpdateComponent = {
  id: string
  name: string
  version: string
  source: UpdateCatalogItem['source']
}

/** Structural subset of the backend's bundled-extension list items this catalog consumes. */
export type UpdateComponentSourceExtension = {
  id: string
  name: string
  state?: string
  origin?: string
  updateComponents?: readonly DeclaredUpdateComponent[]
}

/**
 * Maps bundled-extension declared update components into catalog items.
 * Only enabled non-project (builtin/app) extensions contribute; component ids are
 * namespaced by extension id so cross-extension collisions cannot shadow fixed items.
 */
export function extensionUpdateCatalogItems(extensions: readonly UpdateComponentSourceExtension[]): UpdateCatalogItem[] {
  return extensions.flatMap(extension => {
    if (extension.state !== 'enabled' || extension.origin === 'project') return []
    return (extension.updateComponents ?? []).map(component => ({
      id: `${extension.id}:${component.id}`,
      name: component.name,
      category: 'extension' as const,
      currentVersion: component.version,
      source: component.source,
      ownerExtensionId: extension.id,
      ownerExtensionName: extension.name,
      // The update transaction ships the extension package itself, so a
      // component is one-click updatable exactly when its id equals the owning
      // extension id and the release source is a fixed githubReleases repo
      // (upstream-artifact components like office's `officecli` stay
      // evaluation-only; the recovery seed keeps their binaries current).
      ...(component.source.type === 'githubReleases' && component.id === extension.id ? { transactional: true } : {})
    }))
  })
}

export type UpdateCenterFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

type Semver = { core: [number, number, number]; prerelease: Array<number | string> }

export function parseSemver(raw: string): Semver | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(raw)
  if (!match) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part) ?? []
  }
}

/** SemVer precedence: positive when left is newer, zero when equivalent. */
export function compareSemver(left: string, right: string): number | undefined {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return undefined
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i]
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const av = a.prerelease[i]
    const bv = b.prerelease[i]
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? -1 : 1
    if (av === bv) continue
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    if (typeof av === 'number') return -1
    if (typeof bv === 'number') return 1
    return av.localeCompare(bv)
  }
  return 0
}

export function npmLatestVersion(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const tags = (payload as { ['dist-tags']?: unknown })['dist-tags']
  if (!tags || typeof tags !== 'object') return undefined
  const latest = (tags as { latest?: unknown }).latest
  return typeof latest === 'string' && parseSemver(latest) ? latest : undefined
}

export function pypiLatestVersion(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const info = (payload as { info?: unknown }).info
  if (!info || typeof info !== 'object') return undefined
  const version = (info as { version?: unknown }).version
  return typeof version === 'string' && parseSemver(version) ? version : undefined
}

/** Generic GitHub Releases discovery: non-draft tags that are exactly `v<semver>` or `<semver>`, highest wins. */
export function latestGitHubReleaseVersion(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined
  const candidates = payload.flatMap(release => {
    if (!release || typeof release !== 'object' || (release as { draft?: unknown }).draft === true) return []
    const tag = (release as { tag_name?: unknown }).tag_name
    if (typeof tag !== 'string') return []
    const match = /^v?(.+)$/.exec(tag)
    return match && parseSemver(match[1]) ? [match[1]] : []
  })
  return candidates.sort((a, b) => compareSemver(b, a) ?? 0)[0]
}

export function latestCuaDriverVersion(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined
  const candidates = payload.flatMap(release => {
    if (!release || typeof release !== 'object' || (release as { draft?: unknown }).draft === true) return []
    const tag = (release as { tag_name?: unknown }).tag_name
    if (typeof tag !== 'string') return []
    const match = /^cua-driver-rs-v(.+)$/.exec(tag)
    return match && parseSemver(match[1]) ? [match[1]] : []
  })
  return candidates.sort((a, b) => compareSemver(b, a) ?? 0)[0]
}

export function latestNodeVersion(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined
  const versions = payload.flatMap(release => {
    if (!release || typeof release !== 'object') return []
    if (!(release as { lts?: unknown }).lts) return []
    const version = (release as { version?: unknown }).version
    return typeof version === 'string' && parseSemver(version) ? [version.replace(/^v/, '')] : []
  })
  return versions.sort((a, b) => compareSemver(b, a) ?? 0)[0]
}

/** Wire fields every outcome must carry, so category/ownership/source survive check failures. */
function itemBase(item: UpdateCatalogItem): Omit<UpdateCenterItem, 'status' | 'latestVersion' | 'error'> {
  const sourceLabel = item.source.type === 'githubReleases' || item.source.type === 'githubCommits' ? `${item.source.owner}/${item.source.repo}` : item.sourceLabel
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    ...(item.source.type === 'npm' || item.source.type === 'pypi' ? { packageName: item.source.packageName } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(item.ownerExtensionId ? { ownerExtensionId: item.ownerExtensionId } : {}),
    ...(item.ownerExtensionName ? { ownerExtensionName: item.ownerExtensionName } : {}),
    ...(item.transactional ? { transactional: true } : {}),
    currentVersion: item.currentVersion,
    ...(item.source.type === 'githubCommits' ? {
      gitSource: { owner: item.source.owner, repo: item.source.repo, ref: item.source.ref },
      upstreamUrl: `https://github.com/${item.source.owner}/${item.source.repo}`,
    } : {})
  }
}

function checkedItem(item: UpdateCatalogItem, latestVersion: string): UpdateCenterItem {
  const precedence = compareSemver(latestVersion, item.currentVersion)
  if (precedence === undefined) return {
    ...itemBase(item),
    status: 'notCheckable',
    error: '本机版本不是可识别的 SemVer'
  }
  return {
    ...itemBase(item),
    latestVersion,
    status: precedence > 0 ? 'updateAvailable' : 'upToDate'
  }
}

function failedItem(item: UpdateCatalogItem, error: unknown): UpdateCenterItem {
  return {
    ...itemBase(item),
    status: 'checkFailed',
    error: error instanceof Error ? error.message : String(error)
  }
}

export function createUpdateCenterService(options: {
  /** Fixed items, or a per-check resolver merging discovered extension components into them. */
  catalog: readonly UpdateCatalogItem[] | (() => readonly UpdateCatalogItem[] | Promise<readonly UpdateCatalogItem[]>)
  fetch?: UpdateCenterFetch
  timeoutMs?: number
  now?: () => number
}): () => Promise<UpdateCenterSnapshot> {
  const fetcher = options.fetch ?? (globalThis.fetch as UpdateCenterFetch)
  const timeoutMs = options.timeoutMs ?? 8_000
  const now = options.now ?? Date.now
  return async () => {
    const catalog = typeof options.catalog === 'function' ? await options.catalog() : options.catalog
    const items = await Promise.all(catalog.map(async item => {
      if (item.source.type !== 'githubCommits' && !parseSemver(item.currentVersion)) return checkedItem(item, '')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        if (item.source.type === 'githubCommits') {
          const { owner, repo, ref } = item.source
          if (!/^[0-9a-f]{40}$/.test(item.currentVersion)) return { ...itemBase(item), status: 'notCheckable' as const, error: '本机提交标识无效' }
          const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
          const request = async (url: string) => {
            const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
            if (!response.ok) throw new Error(`版本服务返回 HTTP ${response.status}`)
            return await response.json() as any
          }
          const head = await request(`${api}/commits/${encodeURIComponent(ref)}`)
          const latestVersion = head?.sha
          if (typeof latestVersion !== 'string' || !/^[0-9a-f]{40}$/.test(latestVersion)) throw new Error('上游返回了无效提交标识')
          if (latestVersion === item.currentVersion) return { ...itemBase(item), latestVersion, status: 'upToDate' as const }
          const comparison = await request(`${api}/compare/${item.currentVersion}...${latestVersion}`)
          const base = { ...itemBase(item), latestVersion, compareUrl: `https://github.com/${owner}/${repo}/compare/${item.currentVersion}...${latestVersion}` }
          if (comparison?.status === 'ahead' && comparison?.ahead_by > 0) return { ...base, status: 'updateAvailable' as const }
          if (comparison?.status === 'identical') return { ...base, status: 'upToDate' as const }
          return { ...base, status: 'notCheckable' as const, error: '上游分支发生回退或分叉，请先查看变更' }
        }
        const url = item.source.type === 'npm'
          ? `https://registry.npmjs.org/${encodeURIComponent(item.source.packageName)}`
          : item.source.type === 'pypi'
            ? `https://pypi.org/pypi/${encodeURIComponent(item.source.packageName)}/json`
            : item.source.type === 'cuaGitHub'
              ? 'https://api.github.com/repos/trycua/cua/releases?per_page=100'
              : item.source.type === 'githubReleases'
                ? `https://api.github.com/repos/${encodeURIComponent(item.source.owner)}/${encodeURIComponent(item.source.repo)}/releases?per_page=100`
                : 'https://nodejs.org/dist/index.json'
        const response = await fetcher(url, {
          signal: controller.signal,
          headers: item.source.type === 'cuaGitHub' || item.source.type === 'githubReleases'
            ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
            : { Accept: 'application/json' }
        })
        if (!response.ok) throw new Error(`版本服务返回 HTTP ${response.status}`)
        const payload = await response.json()
        const latest = item.source.type === 'npm'
          ? npmLatestVersion(payload)
          : item.source.type === 'pypi'
            ? pypiLatestVersion(payload)
            : item.source.type === 'cuaGitHub'
              ? latestCuaDriverVersion(payload)
              : item.source.type === 'githubReleases'
                ? latestGitHubReleaseVersion(payload)
                : latestNodeVersion(payload)
        if (!latest) throw new Error('版本服务返回了无法识别的数据')
        return checkedItem(item, latest)
      } catch (error) {
        return failedItem(item, error)
      } finally {
        clearTimeout(timer)
      }
    }))
    return { checkedAt: now(), items }
  }
}

/** Adds read-only update checks and, when a transaction handler is supplied, the one-click extension update method; no URL, command or filesystem capability crosses into the renderer. */
export function withUpdateCenter(
  backend: HostBackend,
  checkForUpdates: () => Promise<UpdateCenterSnapshot>,
  updateExtensionComponent?: (extensionId: string, componentId?: string) => Promise<ExtensionComponentUpdateResult>,
  applyOfficialUpdate?: (action: unknown, id: unknown, version: unknown) => Promise<void>
): HostBackend {
  return {
    handle: (method, params) => {
      if (method === 'applyOfficialUpdate') {
        if (!applyOfficialUpdate || params.length !== 3) return Promise.reject(new Error('invalid official update request'))
        return applyOfficialUpdate(params[0], params[1], params[2])
      }
      if (method === 'checkForUpdates') {
        return params.length ? Promise.reject(new Error('checkForUpdates takes no parameters')) : checkForUpdates()
      }
      if (method === 'updateExtensionComponent') {
        if (!updateExtensionComponent) return Promise.reject(new Error('updateExtensionComponent is not available'))
        const [extensionId, componentId] = params
        if (typeof extensionId !== 'string' || !extensionId.trim()) return Promise.reject(new Error('updateExtensionComponent requires an extensionId string'))
        if (componentId !== undefined && typeof componentId !== 'string') return Promise.reject(new Error('updateExtensionComponent componentId must be a string'))
        return updateExtensionComponent(extensionId, componentId)
      }
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener)
  }
}

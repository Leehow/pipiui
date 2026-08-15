import type { HostBackend, UpdateCenterItem, UpdateCenterItemCategory, UpdateCenterSnapshot } from '@pipi/host-api'

/** Build-time tools are not shipped as runtime dependencies, so keep their resolved versions explicit and test them against the lockfile. */
export const UPDATE_CENTER_FRAMEWORK_VERSIONS = {
  electron: '43.4.0',
  vite: '7.3.6',
  'electron-vite': '5.0.0'
} as const

export type UpdateCatalogItem = {
  id: string
  name: string
  category: UpdateCenterItemCategory
  currentVersion: string
  source: { type: 'npm'; packageName: string } | { type: 'cuaGitHub' } | { type: 'nodeDist' }
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
    const version = (release as { version?: unknown }).version
    return typeof version === 'string' && parseSemver(version) ? [version.replace(/^v/, '')] : []
  })
  return versions.sort((a, b) => compareSemver(b, a) ?? 0)[0]
}

function checkedItem(item: UpdateCatalogItem, latestVersion: string): UpdateCenterItem {
  const precedence = compareSemver(latestVersion, item.currentVersion)
  if (precedence === undefined) return {
    id: item.id,
    name: item.name,
    category: item.category,
    ...(item.source.type === 'npm' ? { packageName: item.source.packageName } : {}),
    currentVersion: item.currentVersion,
    status: 'notCheckable',
    error: '本机版本不是可识别的 SemVer'
  }
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    ...(item.source.type === 'npm' ? { packageName: item.source.packageName } : {}),
    currentVersion: item.currentVersion,
    latestVersion,
    status: precedence > 0 ? 'updateAvailable' : 'upToDate'
  }
}

function failedItem(item: UpdateCatalogItem, error: unknown): UpdateCenterItem {
  return {
    id: item.id,
    name: item.name,
    ...(item.source.type === 'npm' ? { packageName: item.source.packageName } : {}),
    currentVersion: item.currentVersion,
    status: 'checkFailed',
    error: error instanceof Error ? error.message : String(error)
  }
}

export function createUpdateCenterService(options: {
  catalog: readonly UpdateCatalogItem[]
  fetch?: UpdateCenterFetch
  timeoutMs?: number
  now?: () => number
}): () => Promise<UpdateCenterSnapshot> {
  const fetcher = options.fetch ?? (globalThis.fetch as UpdateCenterFetch)
  const timeoutMs = options.timeoutMs ?? 8_000
  const now = options.now ?? Date.now
  return async () => {
    const items = await Promise.all(options.catalog.map(async item => {
      if (!parseSemver(item.currentVersion)) return checkedItem(item, '')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const url = item.source.type === 'npm'
          ? `https://registry.npmjs.org/${encodeURIComponent(item.source.packageName)}`
          : item.source.type === 'cuaGitHub'
            ? 'https://api.github.com/repos/trycua/cua/releases?per_page=100'
            : 'https://nodejs.org/dist/index.json'
        const response = await fetcher(url, {
          signal: controller.signal,
          headers: item.source.type === 'cuaGitHub'
            ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
            : { Accept: 'application/json' }
        })
        if (!response.ok) throw new Error(`版本服务返回 HTTP ${response.status}`)
        const payload = await response.json()
        const latest = item.source.type === 'npm'
          ? npmLatestVersion(payload)
          : item.source.type === 'cuaGitHub'
            ? latestCuaDriverVersion(payload)
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

/** Adds one read-only method; no URL, command or filesystem capability crosses into the renderer. */
export function withUpdateCenter(backend: HostBackend, checkForUpdates: () => Promise<UpdateCenterSnapshot>): HostBackend {
  return {
    handle: (method, params) => method === 'checkForUpdates'
      ? (params.length ? Promise.reject(new Error('checkForUpdates takes no parameters')) : checkForUpdates())
      : backend.handle(method, params),
    subscribe: listener => backend.subscribe(listener)
  }
}

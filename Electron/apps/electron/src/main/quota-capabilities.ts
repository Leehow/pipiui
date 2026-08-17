import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { session } from 'electron'

type CookieReader = (provider: 'kimi' | 'qwen-token-plan' | 'cursor') => Promise<string | undefined>
type CookiePersister = (provider: 'qwen-token-plan', cookie: string) => Promise<void>

const DEFAULT_BROWSER_PARTITION = 'pipiui-browser'
const COOKIE_CACHE_FILE = 'qwen-token-plan-cookie.json'

/**
 * Cookie reader for browser-authenticated quota providers, mirroring the Swift
 * client's WKWebsiteDataStore flow: the user logs into the provider console in
 * pipiui's built-in browser, and the session cookies are read back from that
 * browser's persistent partition(s).
 *
 * Like Swift's `QwenTokenPlanAuthStore.cookieString`, only a fully logged-in
 * cookie set (containing the `login_aliyunid_ticket` session ticket) is
 * adopted; partial tracking-cookie sets are ignored. The ticket itself is a
 * session cookie that Electron does NOT restore after a restart (only the
 * persistent tracking cookies survive on disk), so the last cookie that
 * produced a successful quota fetch is cached in `qwen-token-plan-cookie.json`
 * and used as a fallback — Swift `cachedCookie`/`persistCookie` parity.
 */
function aliyunCookieHeader(cookies: Electron.Cookie[]): string | undefined {
  const filtered = cookies.filter(cookie => {
    const domain = cookie.domain.toLowerCase()
    return domain.includes('aliyun.com') || domain.includes('alibabacloud.com')
  })
  if (!filtered.some(cookie => cookie.name === 'login_aliyunid_ticket')) return undefined
  return filtered.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

function cookieCachePath(userDataPath: string): string {
  return join(userDataPath, COOKIE_CACHE_FILE)
}

async function cachedCookie(userDataPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(cookieCachePath(userDataPath), 'utf8')) as { cookie?: unknown }
    return typeof parsed.cookie === 'string' && parsed.cookie.trim().length > 0 ? parsed.cookie : undefined
  } catch {
    return undefined
  }
}

async function qwenTokenPlanCookie(userDataPath: string): Promise<string | undefined> {
  // Default browser space first, then every per-session partition on disk.
  const partitions = [DEFAULT_BROWSER_PARTITION]
  try {
    for (const entry of await fs.readdir(join(userDataPath, 'Partitions'))) {
      if (entry.startsWith(`${DEFAULT_BROWSER_PARTITION}-`)) partitions.push(entry)
    }
  } catch { /* no partitions yet */ }
  for (const partition of partitions) {
    try {
      const cookies = await session.fromPartition(`persist:${partition}`).cookies.get({})
      const header = aliyunCookieHeader(cookies)
      if (header) return header
    } catch { /* unreadable partition — keep scanning */ }
  }
  // No live logged-in session: the ticket is a session cookie that vanished on
  // restart, so fall back to the last-known-good cached cookie.
  return cachedCookie(userDataPath)
}

const CURSOR_COOKIE_NAMES = new Set([
  'WorkosCursorSessionToken',
  '__Secure-next-auth.session-token',
  'next-auth.session-token',
])

function cursorCookieHeader(cookies: Electron.Cookie[]): string | undefined {
  const matched = cookies.filter(cookie => {
    const domain = cookie.domain.toLowerCase()
    return (domain.includes('cursor.com') || domain.includes('cursor.sh')) && CURSOR_COOKIE_NAMES.has(cookie.name)
  })
  if (!matched.length) return undefined
  return matched.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

async function cursorBrowserCookie(userDataPath: string): Promise<string | undefined> {
  const partitions = [DEFAULT_BROWSER_PARTITION]
  try {
    for (const entry of await fs.readdir(join(userDataPath, 'Partitions'))) {
      if (entry.startsWith(`${DEFAULT_BROWSER_PARTITION}-`)) partitions.push(entry)
    }
  } catch { /* no partitions yet */ }
  for (const partition of partitions) {
    try {
      const cookies = await session.fromPartition(`persist:${partition}`).cookies.get({})
      const header = cursorCookieHeader(cookies)
      if (header) return header
    } catch { /* unreadable partition */ }
  }
}

export function createQuotaCookieReader(userDataPath: string): CookieReader {
  return provider => {
    if (provider === 'qwen-token-plan') return qwenTokenPlanCookie(userDataPath)
    if (provider === 'cursor') return cursorBrowserCookie(userDataPath)
    return Promise.resolve(undefined)
  }
}

function cursorStateDbPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
}

/** Read-only Cursor JWT. Never writes into Cursor's Application Support dir. */
export async function readCursorAccessToken(): Promise<string | undefined> {
  const path = cursorStateDbPath()
  try { await fs.access(path) } catch { return undefined }
  const wal = existsSync(`${path}-wal`)
  const shm = existsSync(`${path}-shm`)
  const { DatabaseSync } = await import('node:sqlite')
  const uri = wal && !shm
    ? `file:${path}?mode=ro&immutable=1`
    : `file:${path}?mode=ro`
  let database: InstanceType<typeof DatabaseSync> | undefined
  try {
    database = new DatabaseSync(uri, { readOnly: true, timeout: 250 })
    const row = database.prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1').get('cursorAuth/accessToken') as { value?: unknown } | undefined
    return typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : undefined
  } catch {
    return undefined
  } finally {
    try { database?.close() } catch { /* ignore */ }
  }
}

/** Writes back only after a successful quota fetch (adapter calls this), so an
 *  expired ticket can never clobber the last-known-good cache. */
export function createQuotaCookiePersister(userDataPath: string): CookiePersister {
  return async (_provider, cookie) => {
    try {
      await fs.writeFile(cookieCachePath(userDataPath), JSON.stringify({ cookie, updatedAt: Date.now() }), 'utf8')
    } catch { /* best-effort cache; a failed write only loses the restart fallback */ }
  }
}

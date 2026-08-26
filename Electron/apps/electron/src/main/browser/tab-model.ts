/**
 * Virtual tab model helpers: URL normalization, tab titles, history
 * bookkeeping, and the opaque per-session partition name. Pure functions over
 * BrowserTabRecord; no view or pane state.
 */
import { createHash } from 'node:crypto'
import type { BrowserTab, BrowserTabsSnapshot } from '@pipi/host-api'
import type { BrowserTabRecord } from './types.js'

/** Stable, opaque profile name: raw session ids never become filesystem path components. */
export function browserPartitionForSession(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return `persist:pipiui-browser-${digest}`
}

export function normalizeBrowserURL(value: string): string {
  const input = value.trim()
  if (!input) return ''
  if (/^(about:|file:|https?:\/\/)/i.test(input)) return input
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)) return `http://${input}`
  if (/\s/.test(input) || !input.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  return `https://${input}`
}

export function tabTitle(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try { return new URL(url).hostname || url } catch { return url }
}

export function copyTab(tab: BrowserTabRecord): BrowserTab {
  const { history: _history, historyIndex: _historyIndex, ...publicTab } = tab
  return { ...publicTab }
}

export function copyTabs(tabs: BrowserTabRecord[], activeTabId?: string): BrowserTabsSnapshot {
  return { tabs: tabs.map(copyTab), activeTabId }
}

export function pushTabHistory(tab: BrowserTabRecord, url: string): void {
  if (tab.history[tab.historyIndex] === url) {
    tab.url = url
  } else {
    tab.history.splice(tab.historyIndex + 1)
    tab.history.push(url)
    tab.historyIndex = tab.history.length - 1
    tab.url = url
  }
  syncTabNavigationButtons(tab)
}

export function syncTabNavigationButtons(tab: BrowserTabRecord): void {
  tab.canGoBack = tab.historyIndex > 0
  tab.canGoForward = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1
}

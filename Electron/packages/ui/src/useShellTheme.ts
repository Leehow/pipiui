import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  CORE_THEMES,
  SYSTEM_THEME_VALUE,
  THEME_STORAGE_KEY,
  getAllThemes,
  isThemeId,
  resolveThemeSelection,
  subscribeThemes,
  type ThemeDefinition,
} from './theme-registry'

/** Fired on window whenever any hook instance persists a selection, so sibling
 *  instances (App shell ↔ settings pane) stay in sync — same cross-instance
 *  pattern as custom-logo's logo event. The CustomEvent detail carries the new
 *  selection: listeners trust the payload instead of re-reading storage, so a
 *  broken store cannot clobber the in-memory choice it just broadcast. */
export const THEME_CHANGED_EVENT = 'pipiui:theme-changed'

/** First-paint cache keys read by both index.html boot scripts: the resolved
 *  theme's --bg and full token map, rewritten on every applied theme change so
 *  extension-contributed themes also paint correctly before React boots. */
const THEME_BG_STORAGE_KEY = 'pipiui.theme-bg'
const THEME_TOKENS_STORAGE_KEY = 'pipiui.theme-tokens'

const SELECTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/

function readStoredSelection(): string | null {
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY)
    // 不能用 isThemeId 校验：冷启动时扩展主题包尚未异步加载，存储的包主题 id
    // 会被误判为非法而丢失。这里只认形态合法（'system' 或 id 形状），可用性
    // 由 resolveThemeSelection 在渲染时判定——包加载完成后主题自动恢复。
    return typeof stored === 'string' && (stored === SYSTEM_THEME_VALUE || SELECTION_ID_PATTERN.test(stored)) ? stored : null
  } catch {
    return null
  }
}

/** Every theme the shell can currently apply: core defaults plus whatever
 *  enabled extension packs contribute. Re-renders when packs load/unload. */
export function useAllThemes(): readonly ThemeDefinition[] {
  return useSyncExternalStore(subscribeThemes, getAllThemes)
}

/** Resolved shell theme: an explicit selection ('system' or a theme id) persists
 *  locally and wins; with no stored choice the shell follows `prefers-color-scheme`
 *  live. `theme` is always a concrete theme id (never 'system') for
 *  `<main data-theme>`; a selected theme whose pack is disabled resolves to the
 *  system scheme without clearing the stored selection. */
export function useShellTheme(): {
  theme: string          // 解析后的具体 theme id（App.tsx 照旧传给 <main data-theme>）
  scheme: 'dark' | 'light' // 解析主题的明暗（终端配色、侧栏 toggle 图标用）
  selection: string      // 用户选择：'system' 或 theme id
  setThemeSelection: (sel: string) => void  // 校验 + localStorage + 生效
  toggleTheme: () => void // 保持现有行为（显式切 light/dark，供侧栏底部按钮）
} {
  const available = useAllThemes()
  const [selection, setSelection] = useState<string>(() => readStoredSelection() ?? SYSTEM_THEME_VALUE)
  const [systemScheme, setSystemScheme] = useState<'dark' | 'light'>(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => setSystemScheme(media.matches ? 'dark' : 'light')
    update(); media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  useEffect(() => {
    // Another instance (e.g. the settings pane) picked a selection: follow the
    // event payload instead of re-reading storage, so a broken store cannot
    // clobber the in-memory choice it just broadcast.
    const sync = (event: Event) => setSelection((event as CustomEvent<string>).detail ?? readStoredSelection() ?? SYSTEM_THEME_VALUE)
    window.addEventListener(THEME_CHANGED_EVENT, sync)
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync)
  }, [])
  const setThemeSelection = useCallback((sel: string) => {
    if (sel !== SYSTEM_THEME_VALUE && !isThemeId(sel, getAllThemes())) return
    setSelection(sel)
    try { window.localStorage?.setItem(THEME_STORAGE_KEY, sel) } catch { /* storage unavailable: keep the in-memory choice */ }
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: sel }))
  }, [])
  const theme = resolveThemeSelection(selection, systemScheme, available)
  const resolvedDefinition = available.find(definition => definition.id === theme) ?? CORE_THEMES[0]
  const scheme = resolvedDefinition.scheme
  // Persist the resolved theme's bg + token map for the index.html boot script:
  // the next launch's first paint then matches even extension-contributed themes.
  useEffect(() => {
    try {
      window.localStorage?.setItem(THEME_BG_STORAGE_KEY, resolvedDefinition.tokens['--bg'])
      window.localStorage?.setItem(THEME_TOKENS_STORAGE_KEY, JSON.stringify(resolvedDefinition.tokens))
    } catch { /* storage unavailable: first paint falls back to the dark/light table */ }
  }, [resolvedDefinition])
  // Scheme-based, like the old dark/light toggle: any dark-scheme theme toggles
  // to light, any light-scheme theme toggles to dark.
  const toggleTheme = useCallback(() => setThemeSelection(scheme === 'light' ? 'dark' : 'light'), [scheme, setThemeSelection])
  return { theme, scheme, selection, setThemeSelection, toggleTheme }
}

import { useCallback, useEffect, useState } from 'react'
import { BUILTIN_THEMES, SYSTEM_THEME_VALUE, THEME_STORAGE_KEY, isBuiltinThemeId, resolveThemeSelection } from './theme-registry'

function readStoredSelection(): string | null {
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY)
    return stored === SYSTEM_THEME_VALUE || isBuiltinThemeId(stored) ? stored : null
  } catch {
    return null
  }
}

/** Resolved shell theme: an explicit selection ('system' or a theme id) persists
 *  locally and wins; with no stored choice the shell follows `prefers-color-scheme`
 *  live. `theme` is always a concrete theme id (never 'system') for
 *  `<main data-theme>`; `selection` is what the settings pane reflects. */
export function useShellTheme(): {
  theme: string          // 解析后的具体 theme id（App.tsx 照旧传给 <main data-theme>）
  selection: string      // 用户选择：'system' 或 theme id
  setThemeSelection: (sel: string) => void  // 校验 + localStorage + 生效
  toggleTheme: () => void // 保持现有行为（显式切 light/dark，供侧栏底部按钮）
} {
  const [selection, setSelection] = useState<string>(() => readStoredSelection() ?? SYSTEM_THEME_VALUE)
  const [systemScheme, setSystemScheme] = useState<'dark' | 'light'>(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => setSystemScheme(media.matches ? 'dark' : 'light')
    update(); media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  const setThemeSelection = useCallback((sel: string) => {
    if (sel !== SYSTEM_THEME_VALUE && !isBuiltinThemeId(sel)) return
    setSelection(sel)
    try { window.localStorage?.setItem(THEME_STORAGE_KEY, sel) } catch { /* storage unavailable: keep the in-memory choice */ }
  }, [])
  const theme = resolveThemeSelection(selection, systemScheme)
  // Scheme-based, like the old dark/light toggle: forest/neon count as dark
  // (switch to light), paper as light (switch to dark).
  const toggleTheme = useCallback(() => setThemeSelection(BUILTIN_THEMES.find(themeDefinition => themeDefinition.id === theme)?.scheme === 'light' ? 'dark' : 'light'), [theme, setThemeSelection])
  return { theme, selection, setThemeSelection, toggleTheme }
}

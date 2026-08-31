/** Builtin shell themes: the single registry behind the settings "主题" pane.
 *  Pure data + pure functions — no DOM access — so both the shell hook
 *  (useShellTheme) and settings preview cards can import it freely.
 *
 *  Storage semantics: `localStorage[THEME_STORAGE_KEY]` holds either
 *  SYSTEM_THEME_VALUE ('system') or a builtin theme id. Missing or invalid
 *  values mean 'system' (= follow prefers-color-scheme, resolved to the
 *  concrete 'dark'/'light' id). `<main data-theme>` only ever receives a
 *  resolved concrete id, never 'system'. Legacy stored values 'light'/'dark'
 *  are theme ids themselves, so they keep working unchanged. */

export interface ThemeDefinition {
  id: string;            // 'dark' | 'light' | 'forest' | 'neon' | 'paper'
  name: string;          // 中文显示名：暗夜 / 明亮 / 护眼绿 / 赛博紫 / 暖米白
  description: string;   // 一句话
  scheme: 'dark' | 'light';
}

export const THEME_STORAGE_KEY = 'pipiui.theme'
export const SYSTEM_THEME_VALUE = 'system'
export const DEFAULT_THEME_ID = 'dark'

export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
  { id: 'dark', name: '暗夜', description: '默认深色主题，柔和深灰底色配靛蓝点缀。', scheme: 'dark' },
  { id: 'light', name: '明亮', description: '经典浅色主题，清爽干净的日间配色。', scheme: 'light' },
  { id: 'forest', name: '护眼绿', description: '深绿基底的低饱和深色主题，长时间阅读更舒适。', scheme: 'dark' },
  { id: 'neon', name: '赛博紫', description: '深紫夜色底配霓虹紫点缀的赛博朋克主题。', scheme: 'dark' },
  { id: 'paper', name: '暖米白', description: '温暖米白纸感的浅色主题，柔和不刺眼。', scheme: 'light' },
]

/** Type guard: true only for concrete builtin theme ids ('system' is a
 *  selection value, not a theme id). */
export function isBuiltinThemeId(value: unknown): value is string {
  return typeof value === 'string' && BUILTIN_THEMES.some(theme => theme.id === value)
}

/** Resolve a stored selection ('system' | theme id | anything else) to the
 *  concrete theme id the shell should render. null, SYSTEM_THEME_VALUE and
 *  invalid values all fall through to the live system scheme. */
export function resolveThemeSelection(selection: string | null, systemScheme: 'dark' | 'light'): string {
  if (selection !== null && selection !== SYSTEM_THEME_VALUE && isBuiltinThemeId(selection)) return selection
  return systemScheme
}

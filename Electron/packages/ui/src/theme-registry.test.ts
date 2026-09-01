import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_THEMES,
  DEFAULT_THEME_ID,
  SYSTEM_THEME_VALUE,
  THEME_STORAGE_KEY,
  THEME_TOKEN_KEYS,
  getAllThemes,
  isThemeId,
  resolveThemeSelection,
  setContributedThemes,
  subscribeThemes,
  validateThemeContribution,
  type ThemeDefinition,
  type ThemeTokenKey,
} from './theme-registry'

const tokens = (value = '#112233'): Record<ThemeTokenKey, string> =>
  Object.fromEntries(THEME_TOKEN_KEYS.map(key => [key, value])) as Record<ThemeTokenKey, string>

const makeTheme = (id: string, scheme: 'dark' | 'light' = 'dark'): ThemeDefinition => ({
  id,
  name: `主题 ${id}`,
  description: `${id} 的描述`,
  scheme,
  tokens: tokens(),
})

afterEach(() => {
  setContributedThemes([])
})

describe('core themes', () => {
  it('核心默认只有 dark/light，id 唯一且各自带满 17 个 token', () => {
    expect(CORE_THEMES.map(theme => theme.id)).toEqual(['dark', 'light'])
    for (const theme of CORE_THEMES) {
      expect(Object.keys(theme.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
      for (const value of Object.values(theme.tokens)) expect(typeof value).toBe('string')
    }
    expect(CORE_THEMES.find(theme => theme.id === 'dark')?.scheme).toBe('dark')
    expect(CORE_THEMES.find(theme => theme.id === 'light')?.scheme).toBe('light')
  })

  it('pins the cross-file storage contract (index.html boot script reads the same keys)', () => {
    expect(THEME_STORAGE_KEY).toBe('pipiui.theme')
    expect(SYSTEM_THEME_VALUE).toBe('system')
    expect(DEFAULT_THEME_ID).toBe('dark')
  })
})

describe('validateThemeContribution', () => {
  it('接受合法贡献并原样归一化', () => {
    const theme = validateThemeContribution(makeTheme('forest'))
    expect(theme?.id).toBe('forest')
    expect(theme?.scheme).toBe('dark')
  })

  it('拒绝：非对象、坏 id、保留 id、空文案、坏 scheme', () => {
    expect(validateThemeContribution(null)).toBeNull()
    expect(validateThemeContribution('forest')).toBeNull()
    expect(validateThemeContribution(makeTheme('Dark'))).toBeNull()
    expect(validateThemeContribution(makeTheme('1bad'))).toBeNull()
    expect(validateThemeContribution(makeTheme('dark'))).toBeNull()
    expect(validateThemeContribution(makeTheme('light'))).toBeNull()
    expect(validateThemeContribution(makeTheme('system'))).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), name: '' })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), description: ' ' })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), scheme: 'auto' })).toBeNull()
  })

  it('拒绝：tokens 缺 key、多 key、非 string 值、非对象', () => {
    const missing = tokens(); delete (missing as Record<string, string>)['--bg']
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: missing })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: { ...tokens(), '--x': '#000' } })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: { ...tokens(), '--bg': 42 } })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: ['#000'] })).toBeNull()
  })
  it('拒绝：token 值可逃逸规则块（CSS 注入）或超长', () => {
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: tokens('#000;}body{display:none}') })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: tokens('#000;background:url(x)') })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: tokens('#000</style>') })).toBeNull()
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: tokens('x'.repeat(129)) })).toBeNull()
    // 合法的函数式颜色值不受影响。
    expect(validateThemeContribution({ ...makeTheme('ok'), tokens: tokens('color-mix(in srgb, #000 50%, transparent)') })).not.toBeNull()
  })
})

describe('contributed themes store', () => {
  it('热更新：同 id 但 tokens 变化会通知订阅者（同 id/name 则不会）', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeThemes(listener)
    setContributedThemes([makeTheme('forest')])
    expect(listener).toHaveBeenCalledTimes(1)
    setContributedThemes([{ ...makeTheme('forest'), tokens: tokens('#aabbcc') }])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getAllThemes().find(theme => theme.id === 'forest')?.tokens['--bg']).toBe('#aabbcc')
    unsubscribe()
  })

  it('getAllThemes = core 在前 + 贡献在后；setContributedThemes 按 id 去重（先来先得）', () => {
    setContributedThemes([makeTheme('forest'), makeTheme('neon'), makeTheme('forest')])
    expect(getAllThemes().map(theme => theme.id)).toEqual(['dark', 'light', 'forest', 'neon'])
  })

  it('内容变化才通知订阅者', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeThemes(listener)
    setContributedThemes([makeTheme('forest')])
    setContributedThemes([makeTheme('forest')])
    expect(listener).toHaveBeenCalledTimes(1)
    setContributedThemes([])
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    setContributedThemes([makeTheme('neon')])
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('resolveThemeSelection（可用性感知）', () => {
  it('null/system/非法值 → 跟随系统 scheme', () => {
    expect(resolveThemeSelection(null, 'dark')).toBe('dark')
    expect(resolveThemeSelection(SYSTEM_THEME_VALUE, 'light')).toBe('light')
    expect(resolveThemeSelection('retro', 'dark')).toBe('dark')
  })

  it('核心 id 原样通过；贡献主题在可用时通过、不可用时落回系统（存储值不动）', () => {
    expect(resolveThemeSelection('light', 'dark')).toBe('light')
    setContributedThemes([makeTheme('forest')])
    expect(resolveThemeSelection('forest', 'light')).toBe('forest')
    setContributedThemes([])
    expect(resolveThemeSelection('forest', 'light')).toBe('light')
  })
})

describe('isThemeId', () => {
  it('按可用列表判定；system/非字符串拒绝', () => {
    expect(isThemeId('dark')).toBe(true)
    expect(isThemeId('forest')).toBe(false)
    setContributedThemes([makeTheme('forest')])
    expect(isThemeId('forest')).toBe(true)
    expect(isThemeId(SYSTEM_THEME_VALUE)).toBe(false)
    expect(isThemeId(null)).toBe(false)
    expect(isThemeId('forest', [])).toBe(false)
  })
})

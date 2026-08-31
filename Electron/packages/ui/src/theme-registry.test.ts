import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES, DEFAULT_THEME_ID, SYSTEM_THEME_VALUE, THEME_STORAGE_KEY, isBuiltinThemeId, resolveThemeSelection } from './theme-registry'

const EXPECTED_IDS = ['dark', 'light', 'forest', 'neon', 'paper']

describe('theme registry', () => {
  it('has 5 builtin themes with unique ids', () => {
    expect(BUILTIN_THEMES).toHaveLength(5)
    const ids = BUILTIN_THEMES.map(theme => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort())
  })

  it('defines display metadata and a scheme for every theme', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.name.length).toBeGreaterThan(0)
      expect(theme.description.length).toBeGreaterThan(0)
      expect(['dark', 'light']).toContain(theme.scheme)
    }
    expect(BUILTIN_THEMES.find(t => t.id === 'dark')?.scheme).toBe('dark')
    expect(BUILTIN_THEMES.find(t => t.id === 'light')?.scheme).toBe('light')
    expect(BUILTIN_THEMES.find(t => t.id === 'forest')?.scheme).toBe('dark')
    expect(BUILTIN_THEMES.find(t => t.id === 'neon')?.scheme).toBe('dark')
    expect(BUILTIN_THEMES.find(t => t.id === 'paper')?.scheme).toBe('light')
  })

  it('pins the cross-file storage contract (index.html boot script reads the same key)', () => {
    expect(THEME_STORAGE_KEY).toBe('pipiui.theme')
    expect(SYSTEM_THEME_VALUE).toBe('system')
    expect(DEFAULT_THEME_ID).toBe('dark')
    expect(isBuiltinThemeId(DEFAULT_THEME_ID)).toBe(true)
  })
})

describe('resolveThemeSelection', () => {
  it('resolves null (no stored choice) to the system scheme', () => {
    expect(resolveThemeSelection(null, 'dark')).toBe('dark')
    expect(resolveThemeSelection(null, 'light')).toBe('light')
  })

  it("resolves 'system' to the system scheme", () => {
    expect(resolveThemeSelection(SYSTEM_THEME_VALUE, 'dark')).toBe('dark')
    expect(resolveThemeSelection(SYSTEM_THEME_VALUE, 'light')).toBe('light')
  })

  it('passes builtin theme ids through unchanged', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(resolveThemeSelection(theme.id, 'light')).toBe(theme.id)
      expect(resolveThemeSelection(theme.id, 'dark')).toBe(theme.id)
    }
  })

  it('resolves invalid values to the system scheme', () => {
    expect(resolveThemeSelection('retro', 'dark')).toBe('dark')
    expect(resolveThemeSelection('retro', 'light')).toBe('light')
    expect(resolveThemeSelection('', 'dark')).toBe('dark')
    expect(resolveThemeSelection('Dark', 'light')).toBe('light')
  })
})

describe('isBuiltinThemeId', () => {
  it('accepts exactly the builtin theme ids', () => {
    for (const theme of BUILTIN_THEMES) expect(isBuiltinThemeId(theme.id)).toBe(true)
  })

  it("rejects 'system' and non-theme values", () => {
    expect(isBuiltinThemeId(SYSTEM_THEME_VALUE)).toBe(false)
    expect(isBuiltinThemeId('retro')).toBe(false)
    expect(isBuiltinThemeId('')).toBe(false)
    expect(isBuiltinThemeId(null)).toBe(false)
    expect(isBuiltinThemeId(undefined)).toBe(false)
    expect(isBuiltinThemeId(42)).toBe(false)
  })
})

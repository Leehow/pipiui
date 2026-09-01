// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionDescriptor, PipiHostAPI } from '@pipi/host-api'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import { collectThemeContributions, useExtensionThemeSync } from './theme-contribution-loader'
import { THEME_TOKEN_KEYS, getAllThemes, setContributedThemes, type ThemeTokenKey } from './theme-registry'

const tokens = (): Record<ThemeTokenKey, string> =>
  Object.fromEntries(THEME_TOKEN_KEYS.map(key => [key, '#112233'])) as Record<ThemeTokenKey, string>

const themeEntry = (id: string) => ({
  id,
  name: `主题 ${id}`,
  description: `${id} 的描述`,
  scheme: 'dark' as const,
  tokens: tokens(),
})

const descriptor = (id: string, state: 'enabled' | 'disabled', themes?: unknown[]): ExtensionDescriptor =>
  ({ id, state, source: 'builtin', ...(themes ? { ui: { themes } } : {}) }) as unknown as ExtensionDescriptor

afterEach(() => {
  cleanup()
  setContributedThemes([])
})

describe('collectThemeContributions', () => {
  it('只收 enabled 扩展，按扩展 id 字典序稳定排序', () => {
    const themes = collectThemeContributions([
      descriptor('zeta-pack', 'enabled', [themeEntry('neon')]),
      descriptor('alpha-pack', 'enabled', [themeEntry('forest')]),
      descriptor('disabled-pack', 'disabled', [themeEntry('paper')]),
      descriptor(BUILTIN_EXTENSION_ID, 'enabled', [themeEntry('builtin-theme')]),
      descriptor('no-themes', 'enabled'),
    ])
    expect(themes.map(theme => theme.id)).toEqual(['forest', 'neon'])
  })

  it('坏条目与重复 id 丢弃并告警，不抛出', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const themes = collectThemeContributions([
        descriptor('a-pack', 'enabled', [themeEntry('forest'), { id: 'bad id' }, 'nope']),
        descriptor('b-pack', 'enabled', [themeEntry('forest'), themeEntry('paper')]),
      ])
      expect(themes.map(theme => theme.id)).toEqual(['forest', 'paper'])
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('useExtensionThemeSync', () => {
  it('启用扩展的主题进入注册表；extension_updated 后禁用即移除', async () => {
    let list = [descriptor('theme-pack', 'enabled', [themeEntry('forest')])]
    const listeners = new Map<string, () => void>()
    const host = {
      listExtensions: async () => list,
      subscribeExt: (id: string, cb: () => void) => { listeners.set(id, cb); return () => { listeners.delete(id) } },
    } as unknown as PipiHostAPI

    renderHook(() => useExtensionThemeSync(host, 'proj'))
    await waitFor(() => expect(getAllThemes().map(theme => theme.id)).toContain('forest'))

    // 扩展被禁用：触发订阅事件 → refresh → 注册表回落到核心主题。
    list = [descriptor('theme-pack', 'disabled', [themeEntry('forest')])]
    act(() => { listeners.get('theme-pack')?.() })
    await waitFor(() => expect(getAllThemes().map(theme => theme.id)).toEqual(['dark', 'light']))
  })
})

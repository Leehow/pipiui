// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SYSTEM_THEME_VALUE,
  THEME_STORAGE_KEY,
  THEME_TOKEN_KEYS,
  setContributedThemes,
  type ThemeDefinition,
  type ThemeTokenKey,
} from './theme-registry'
import { useShellTheme } from './useShellTheme'

const FOREST: ThemeDefinition = {
  id: 'forest',
  name: '护眼绿',
  description: '测试主题',
  scheme: 'dark',
  tokens: Object.fromEntries(THEME_TOKEN_KEYS.map(key => [key, '#141a16'])) as Record<ThemeTokenKey, string>,
}

beforeEach(() => {
  localStorage.clear()
  // forest 现在来自扩展主题包：测试里显式注入贡献。
  act(() => { setContributedThemes([FOREST]) })
})
afterEach(() => {
  cleanup()
  act(() => { setContributedThemes([]) })
  localStorage.clear()
})

describe('useShellTheme', () => {
  it('一个实例 setThemeSelection 后，另一个实例的 theme/selection 实时同步（App 壳 ↔ 设置页）', () => {
    // jsdom 的 prefers-color-scheme 不匹配 → system 解析为 light。
    const shell = renderHook(() => useShellTheme())  // App 壳实例
    const pane = renderHook(() => useShellTheme())   // 设置页实例
    expect(shell.result.current.theme).toBe('light')

    act(() => { pane.result.current.setThemeSelection('forest') })

    expect(pane.result.current.selection).toBe('forest')
    expect(shell.result.current.selection).toBe('forest')
    expect(shell.result.current.theme).toBe('forest')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('forest')

    // 切回 system 同样同步：theme 回到系统解析值。
    act(() => { pane.result.current.setThemeSelection(SYSTEM_THEME_VALUE) })
    expect(shell.result.current.selection).toBe(SYSTEM_THEME_VALUE)
    expect(shell.result.current.theme).toBe('light')
  })

  it('system 解析：初始无存储时跟随系统（jsdom 为 light），显式选择 system 时写回存储', () => {
    const { result } = renderHook(() => useShellTheme())
    expect(result.current.selection).toBe(SYSTEM_THEME_VALUE)
    expect(result.current.theme).toBe('light')
    act(() => { result.current.setThemeSelection(SYSTEM_THEME_VALUE) })
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(SYSTEM_THEME_VALUE)
    expect(result.current.selection).toBe(SYSTEM_THEME_VALUE)
    expect(result.current.theme).toBe('light')
  })

  it('存储写入失败时：自身内存选择不被自身事件冲掉，其他实例经事件负载同步', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    try {
      const shell = renderHook(() => useShellTheme())
      const pane = renderHook(() => useShellTheme())
      act(() => { pane.result.current.setThemeSelection('forest') })
      // 存储不可写：两个实例都经事件负载拿到 forest，自身实例不被重读冲掉。
      expect(pane.result.current.selection).toBe('forest')
      expect(shell.result.current.selection).toBe('forest')
      expect(shell.result.current.theme).toBe('forest')
    } finally {
      spy.mockRestore()
    }
  })

  it('非法值被忽略：selection/theme 保持不变，localStorage 不写入非法值', () => {
    const { result } = renderHook(() => useShellTheme())
    act(() => { result.current.setThemeSelection('forest') })
    act(() => { result.current.setThemeSelection('not-a-theme') })
    expect(result.current.selection).toBe('forest')
    expect(result.current.theme).toBe('forest')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('forest')
  })

  it('应用主题时把解析后的 --bg 与 token 表写入首帧缓存（pipiui.theme-bg / pipiui.theme-tokens）', () => {
    const { result } = renderHook(() => useShellTheme())
    // 初始（system→light）：缓存写 light 的值。
    expect(localStorage.getItem('pipiui.theme-bg')).toBe('#f5f5f7')
    act(() => { result.current.setThemeSelection('forest') })
    expect(localStorage.getItem('pipiui.theme-bg')).toBe('#141a16')
    const cached = JSON.parse(localStorage.getItem('pipiui.theme-tokens') ?? '{}') as Record<string, string>
    expect(Object.keys(cached).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    expect(cached['--bg']).toBe('#141a16')
  })

  it('选中的贡献主题消失（扩展被禁用）时 theme 落回系统解析，但存储的 selection 不动', () => {
    const { result } = renderHook(() => useShellTheme())
    act(() => { result.current.setThemeSelection('forest') })
    expect(result.current.theme).toBe('forest')

    act(() => { setContributedThemes([]) })
    expect(result.current.selection).toBe('forest')               // 选择保留
    expect(result.current.theme).toBe('light')                    // 渲染落回系统
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('forest')

    // 扩展重新启用：主题自动恢复。
    act(() => { setContributedThemes([FOREST]) })
    expect(result.current.theme).toBe('forest')
  })

  it('冷启动：存储的包主题在包尚未加载时不被丢弃，包到达后自动生效', () => {
    // 冷启动时序：localStorage 已有 forest，但注册表此刻还没有它（扩展异步加载中）。
    localStorage.setItem(THEME_STORAGE_KEY, 'forest')
    act(() => { setContributedThemes([]) })
    const { result } = renderHook(() => useShellTheme())
    expect(result.current.selection).toBe('forest')   // 选择不丢
    expect(result.current.theme).toBe('light')        // 暂落系统解析
    // 主题包异步加载完成：无需任何操作，主题恢复。
    act(() => { setContributedThemes([FOREST]) })
    expect(result.current.theme).toBe('forest')
  })

  it('scheme 跟随解析主题：forest 为 dark、light 为 light', () => {
    const { result } = renderHook(() => useShellTheme())
    expect(result.current.scheme).toBe('light')
    act(() => { result.current.setThemeSelection('forest') })
    expect(result.current.scheme).toBe('dark')
  })
})

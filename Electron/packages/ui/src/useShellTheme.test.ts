// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_THEME_VALUE, THEME_STORAGE_KEY } from './theme-registry'
import { useShellTheme } from './useShellTheme'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
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
})

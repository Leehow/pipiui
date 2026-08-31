// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { createElement } from 'react'
import { ThemeSettingsPane } from './ThemeSettingsPane'
import { SYSTEM_THEME_VALUE, THEME_STORAGE_KEY } from './theme-registry'
import { useShellTheme } from './useShellTheme'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ThemeSettingsPane', () => {
  it('渲染 当前主题 / 全部主题 / 品牌 Logo 三段', () => {
    render(createElement(ThemeSettingsPane))
    expect(screen.getByText('当前主题')).toBeTruthy()
    expect(screen.getByText('全部主题')).toBeTruthy()
    expect(screen.getByText('品牌 Logo')).toBeTruthy()
  })

  it('主题网格包含 system + 5 套内置主题共 6 张卡', () => {
    render(createElement(ThemeSettingsPane))
    const ids = ['system', 'dark', 'light', 'forest', 'neon', 'paper']
    for (const id of ids) {
      expect(screen.getByTestId(`theme-card-${id}`), `缺少卡片 ${id}`).toBeTruthy()
    }
    expect(screen.getAllByTestId(/^theme-card-/)).toHaveLength(ids.length)
  })

  it('点击主题卡后 localStorage[pipiui.theme] 变为对应 id，点 system 卡恢复 system', () => {
    render(createElement(ThemeSettingsPane))
    fireEvent.click(screen.getByTestId('theme-card-forest'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('forest')
    fireEvent.click(screen.getByTestId('theme-card-paper'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('paper')
    fireEvent.click(screen.getByTestId('theme-card-system'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('点击主题卡后，另一个 useShellTheme 消费者（App 壳）实时同步', () => {
    // jsdom 的 system 解析为 light。
    const consumer = renderHook(() => useShellTheme())
    render(createElement(ThemeSettingsPane))
    expect(consumer.result.current.theme).toBe('light')
    fireEvent.click(screen.getByTestId('theme-card-forest'))
    expect(consumer.result.current.theme).toBe('forest')
    expect(consumer.result.current.selection).toBe('forest')
    fireEvent.click(screen.getByTestId('theme-card-system'))
    expect(consumer.result.current.selection).toBe(SYSTEM_THEME_VALUE)
    expect(consumer.result.current.theme).toBe('light')
  })

  it('预览容器携带 data-scheme：主题卡 / 当前卡 / system 卡两个半分', () => {
    const { container } = render(createElement(ThemeSettingsPane))
    expect(screen.getByTestId('theme-card-forest').getAttribute('data-scheme')).toBe('dark')
    expect(screen.getByTestId('theme-card-paper').getAttribute('data-scheme')).toBe('light')
    expect(container.querySelector('.tsp-current')!.getAttribute('data-scheme')).toBeTruthy()
    expect(container.querySelector('.tsp-sys-half[data-theme="dark"]')!.getAttribute('data-scheme')).toBe('dark')
    expect(container.querySelector('.tsp-sys-half[data-theme="light"]')!.getAttribute('data-scheme')).toBe('light')
  })

  it('logo 错误提示可通过 × 关闭', async () => {
    render(createElement(ThemeSettingsPane))
    const input = screen.getByTestId('theme-logo-file-picker') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['hello'], 'notes.txt', { type: 'text/plain' })], configurable: true })
    fireEvent.change(input)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('仅支持图片文件')
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('品牌 Logo 区域提供 选择图片 / 恢复默认 按钮，无 logo 时恢复默认禁用', () => {
    render(createElement(ThemeSettingsPane))
    expect(screen.getByRole('button', { name: '选择图片' })).toBeTruthy()
    const reset = screen.getByRole('button', { name: '恢复默认' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
  })
})

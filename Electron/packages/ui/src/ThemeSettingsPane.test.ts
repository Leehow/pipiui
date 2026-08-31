// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { ThemeSettingsPane } from './ThemeSettingsPane'
import { THEME_STORAGE_KEY } from './theme-registry'

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

  it('品牌 Logo 区域提供 选择图片 / 恢复默认 按钮，无 logo 时恢复默认禁用', () => {
    render(createElement(ThemeSettingsPane))
    expect(screen.getByRole('button', { name: '选择图片' })).toBeTruthy()
    const reset = screen.getByRole('button', { name: '恢复默认' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
  })
})

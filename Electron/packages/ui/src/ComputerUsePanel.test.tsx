// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockHost } from './App'
import { ComputerUsePanel } from './ComputerUsePanel'

afterEach(cleanup)

describe('ComputerUsePanel', () => {
  it('loads and persists the master desktop-control switch', async () => {
    const host = createMockHost()
    render(<ComputerUsePanel host={host} onClose={() => undefined} />)
    const toggle = await screen.findByRole('switch', { name: '启用 Computer Use' })
    expect(screen.getByText('管理单个 Computer Use Agent 的桌面控制总开关。')).toBeTruthy()
    expect(screen.getByText(/它自行规划、操作、恢复并核验/)).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    await expect(host.getComputerUseState?.()).resolves.toEqual({ enabled: true })
    expect(screen.getByText('屏幕录制')).toBeTruthy()
    expect(screen.getByText('辅助功能')).toBeTruthy()
    expect((screen.getByRole('button', { name: '去授权屏幕录制' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '去授权辅助功能' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens system permission settings from the 去授权 buttons', async () => {
    const opened: string[] = []
    const host = createMockHost()
    host.getComputerUseState = async () => ({ enabled: true, screenRecording: false, accessibility: false })
    host.openComputerUsePermission = async kind => {
      opened.push(kind)
      return {
        enabled: true,
        screenRecording: kind === 'screenRecording',
        accessibility: kind === 'accessibility',
      }
    }
    render(<ComputerUsePanel host={host} onClose={() => undefined} />)
    const screenButton = await screen.findByRole('button', { name: '去授权屏幕录制' })
    const accessibilityButton = screen.getByRole('button', { name: '去授权辅助功能' })
    expect((screenButton as HTMLButtonElement).disabled).toBe(false)
    expect((accessibilityButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screenButton)
    await waitFor(() => expect(opened).toEqual(['screenRecording']))
    expect(await screen.findByRole('button', { name: '打开屏幕录制设置' })).toBeTruthy()
    fireEvent.click(accessibilityButton)
    await waitFor(() => expect(opened).toEqual(['screenRecording', 'accessibility']))
  })

  it('keeps 去授权 clickable when permission status is not yet provided', async () => {
    const opened: string[] = []
    const host = createMockHost()
    host.getComputerUseState = async () => ({ enabled: true })
    host.openComputerUsePermission = async kind => {
      opened.push(kind)
      return { enabled: true, screenRecording: false, accessibility: false }
    }
    render(<ComputerUsePanel host={host} onClose={() => undefined} />)
    const screenButton = await screen.findByRole('button', { name: '去授权屏幕录制' })
    expect((screenButton as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByText('未提供')).toHaveLength(2)
    fireEvent.click(screenButton)
    await waitFor(() => expect(opened).toEqual(['screenRecording']))
  })
})

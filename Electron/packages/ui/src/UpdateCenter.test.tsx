// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, UpdateCenterSnapshot } from '@pipi/host-api'
import { UpdateCenter, updateRequestPrompt } from './UpdateCenter'

afterEach(cleanup)
const snapshot: UpdateCenterSnapshot = { checkedAt: 1, items: [
  { id: 'pi', name: 'Pi', packageName: '@earendil-works/pi-coding-agent', currentVersion: '0.84.0', latestVersion: '0.84.2', status: 'updateAvailable' },
  { id: 'cua', name: 'Cua Driver', currentVersion: '0.19.3', latestVersion: '0.19.3', status: 'upToDate' },
  { id: 'broken', name: 'Broken Extension', currentVersion: '1.0.0', status: 'checkFailed', error: 'offline' }
] }
describe('UpdateCenter', () => {
  it('emits a Hermes-specific compatibility and acceptance contract without changing ordinary prompts', () => {
    const prompt = updateRequestPrompt({
      id: 'pi-hermes-memory', name: 'pi-hermes-memory', packageName: 'pi-hermes-memory',
      currentVersion: '0.9.4', latestVersion: '0.10.0', status: 'updateAvailable'
    })
    expect(prompt).toContain('pi-hermes-memory 从 0.9.4 更新到 0.10.0')
    expect(prompt).toContain('memory-broker、自动召回、角色化记忆策略和 Hermes 复核模型设置')
    expect(prompt).toContain('内部 API、配置格式及数据库兼容性')
    expect(prompt).toContain('pin、lockfile、运行时 manifest 与 Hermes adapter 必须一起更新')
    expect(prompt).toContain('若不兼容，保留旧 pin')
    expect(prompt).toContain('禁止用真实用户数据库测试迁移')
    expect(prompt).toContain('memory-broker 测试/typecheck、角色策略回归、包版本/签名检查')
    expect(prompt).toContain('canonical Electron App')
    expect(prompt).toContain('主 Agent 自动召回、显式 memory_query 和 subagent 召回')
    expect(prompt).toContain('不改 Swift，不 push，不 deploy')
    expect(updateRequestPrompt(snapshot.items[0])).toBe('帮我把 Pi 从 0.84.0 更新到 0.84.2，并完成必要的测试和 Electron 打包验收。')
  })

  it('shows loading, update/current/error states and emits one ordinary update prompt', async () => {
    let resolve!: (value: UpdateCenterSnapshot) => void
    const checkForUpdates = vi.fn(() => new Promise<UpdateCenterSnapshot>(done => { resolve = done }))
    const onRequestUpdate = vi.fn()
    render(<UpdateCenter host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={onRequestUpdate} />)
    expect(screen.getByTestId('update-center-loading')).toBeTruthy()
    resolve(snapshot)
    expect(await screen.findByText('有新版本')).toBeTruthy()
    expect(screen.getByText('已是最新')).toBeTruthy()
    expect(screen.getByText('检查失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(onRequestUpdate).toHaveBeenCalledTimes(1)
    expect(onRequestUpdate).toHaveBeenCalledWith('帮我把 Pi 从 0.84.0 更新到 0.84.2，并完成必要的测试和 Electron 打包验收。')
  })
  it('refreshes and exposes a dismissible non-blocking request error', async () => {
    const checkForUpdates = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot)
    render(<UpdateCenter host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={() => undefined} />)
    expect(await screen.findByText('检查更新失败：offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭更新错误' }))
    expect(screen.queryByTestId('update-center-error')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '⟳ 刷新' }))
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('有新版本')).toBeTruthy()
  })
})

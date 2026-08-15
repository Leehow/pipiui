// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX, PIPIUI_UPDATE_EVALUATION_INTENT_VERSION, type PipiHostAPI, type UpdateCenterSnapshot } from '@pipi/host-api'
import { UpdateCenter } from './UpdateCenter'

afterEach(cleanup)
const snapshot: UpdateCenterSnapshot = { checkedAt: 1, items: [
  { id: 'pi', name: 'Pi', packageName: '@earendil-works/pi-coding-agent', currentVersion: '0.84.0', latestVersion: '0.84.2', status: 'updateAvailable' },
  { id: 'cua', name: 'Cua Driver', currentVersion: '0.19.3', latestVersion: '0.19.3', status: 'upToDate' },
  { id: 'broken', name: 'Broken Extension', currentVersion: '1.0.0', status: 'checkFailed', error: 'offline' }
] }
describe('UpdateCenter', () => {
  it('shows loading, update/current/error states and emits one evaluation prompt', async () => {
    let resolve!: (value: UpdateCenterSnapshot) => void
    const checkForUpdates = vi.fn(() => new Promise<UpdateCenterSnapshot>(done => { resolve = done }))
    const onRequestUpdate = vi.fn()
    render(<UpdateCenter host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={onRequestUpdate} />)
    expect(screen.getByTestId('update-center-loading')).toBeTruthy()
    resolve(snapshot)
    expect(await screen.findByText('有新版本')).toBeTruthy()
    expect(screen.getByText('已是最新')).toBeTruthy()
    expect(screen.getByText('检查失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '评估更新' }))
    fireEvent.click(screen.getByRole('button', { name: '评估更新' }))
    expect(onRequestUpdate).toHaveBeenCalledTimes(1)
    const intent = onRequestUpdate.mock.calls[0][0]
    expect(intent.startsWith(PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX)).toBe(true)
    expect(JSON.parse(intent.slice(PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX.length))).toEqual({
      version: PIPIUI_UPDATE_EVALUATION_INTENT_VERSION,
      id: 'pi', name: 'Pi', packageName: '@earendil-works/pi-coding-agent',
      currentVersion: '0.84.0', latestVersion: '0.84.2'
    })
    expect(intent).not.toContain('release notes')
    expect(intent).not.toContain('Hermes')
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

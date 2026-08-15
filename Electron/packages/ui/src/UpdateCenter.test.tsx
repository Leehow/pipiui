// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX, PIPIUI_UPDATE_EVALUATION_INTENT_VERSION, type PipiHostAPI, type UpdateCenterSnapshot } from '@pipi/host-api'
import { UpdateCenter } from './UpdateCenter'
import { useUpdateCenter } from './useUpdateCenter'

afterEach(cleanup)
const snapshot: UpdateCenterSnapshot = { checkedAt: 1, items: [
  { id: 'electron', name: 'Electron', category: 'platform', packageName: 'electron', currentVersion: '43.4.0', latestVersion: '43.4.0', status: 'upToDate' },
  { id: 'pi', name: 'Pi', category: 'runtime', packageName: '@earendil-works/pi-coding-agent', currentVersion: '0.84.0', latestVersion: '0.84.2', status: 'updateAvailable' },
  { id: 'cua', name: 'Cua Driver', category: 'runtime', currentVersion: '0.19.3', latestVersion: '0.19.3', status: 'upToDate' },
  { id: 'vite', name: 'Vite', category: 'toolchain', packageName: 'vite', currentVersion: '5.4.21', latestVersion: '8.2.1', status: 'updateAvailable' },
  { id: 'broken', name: 'Broken Extension', category: 'extension', currentVersion: '1.0.0', status: 'checkFailed', error: 'offline' }
] }

function UpdatesHarness({ host, onRequestUpdate = () => undefined, show = true }: {
  host: PipiHostAPI
  onRequestUpdate?: (prompt: string) => void
  show?: boolean
}) {
  const updates = useUpdateCenter(host)
  return show ? <UpdateCenter updates={updates} onRequestUpdate={onRequestUpdate} /> : <div data-testid="updates-hidden" />
}

describe('UpdateCenter', () => {
  it('shows loading, update/current/error states and emits one evaluation prompt', async () => {
    let resolve!: (value: UpdateCenterSnapshot) => void
    const checkForUpdates = vi.fn(() => new Promise<UpdateCenterSnapshot>(done => { resolve = done }))
    const onRequestUpdate = vi.fn()
    render(<UpdatesHarness host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={onRequestUpdate} />)
    expect(screen.getByTestId('update-center-loading')).toBeTruthy()
    resolve(snapshot)
    expect((await screen.findAllByText('有新版本')).length).toBe(2)
    expect(screen.getAllByText('已是最新')).toHaveLength(2)
    expect(screen.getByText('检查失败')).toBeTruthy()
    expect(screen.getByTestId('update-group-platform')).toBeTruthy()
    expect(screen.getByTestId('update-group-runtime')).toBeTruthy()
    expect(screen.getByTestId('update-group-toolchain')).toBeTruthy()
    expect(screen.getByTestId('update-group-extension')).toBeTruthy()
    expect(screen.getByText('应用平台')).toBeTruthy()
    expect(screen.getByText('核心运行时')).toBeTruthy()
    expect(screen.getByText('构建工具')).toBeTruthy()
    expect(screen.getByText('Pi 扩展')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: '评估更新' })
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
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
    render(<UpdatesHarness host={{ checkForUpdates } as unknown as PipiHostAPI} />)
    expect(await screen.findByText('检查更新失败：offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭更新错误' }))
    expect(screen.queryByTestId('update-center-error')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '⟳ 刷新' }))
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2))
    expect((await screen.findAllByText('有新版本')).length).toBe(2)
  })
  it('prefetches once at mount and reuses the cache when the pane remounts', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(snapshot)
    function Toggle() {
      const [show, setShow] = useState(true)
      return <>
        <button type="button" onClick={() => setShow(value => !value)}>toggle-updates</button>
        <UpdatesHarness host={{ checkForUpdates } as unknown as PipiHostAPI} show={show} />
      </>
    }
    render(<Toggle />)
    await screen.findByTestId('update-item-pi')
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'toggle-updates' }))
    expect(screen.getByTestId('updates-hidden')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'toggle-updates' }))
    expect(await screen.findByTestId('update-item-pi')).toBeTruthy()
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '⟳ 刷新' }))
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2))
  })
})

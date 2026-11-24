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

const extensionSnapshot: UpdateCenterSnapshot = { checkedAt: 2, items: [
  { id: 'pdf-extension:firecrawl-pdf-inspector', name: 'Firecrawl pdf-inspector', category: 'extension', packageName: '@firecrawl/pdf-inspector', currentVersion: '1.15.0', latestVersion: '1.17.0', status: 'updateAvailable', ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' },
  { id: 'pdf-extension:firecrawl-pdf-inspector-wasm', name: '@firecrawl/pdf-inspector-wasm', category: 'extension', sourceLabel: 'firecrawl/pdf-inspector', currentVersion: '1.15.0', status: 'checkFailed', error: '版本服务返回 HTTP 503', ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' },
  { id: 'pdf-extension:firecrawl-pdf-inspector-darwin-arm64', name: '@firecrawl/pdf-inspector-darwin-arm64', category: 'extension', packageName: '@firecrawl/pdf-inspector-darwin-arm64', currentVersion: 'workspace:*', status: 'notCheckable', error: '本机版本不是可识别的 SemVer', ownerExtensionId: 'pdf-extension', ownerExtensionName: 'PipiUI PDF' },
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
  it('shows upstream Git revisions and sends an evaluation intent carrying the exact source', async () => {
    const gitSource = { owner: 'browser-use', repo: 'jev-ultrafast', ref: 'main' }
    const currentVersion = 'a'.repeat(40), latestVersion = 'b'.repeat(40)
    const checkForUpdates = vi.fn().mockResolvedValue({ checkedAt: 1, items: [{ id: 'webview-browser-extension:browser-use-jev', name: 'Browser Use Jev', category: 'extension',
      gitSource, currentVersion, latestVersion, status: 'updateAvailable', upstreamUrl: 'https://github.com/browser-use/jev-ultrafast',
      compareUrl: `https://github.com/browser-use/jev-ultrafast/compare/${currentVersion}...${latestVersion}` }] })
    const onRequestUpdate = vi.fn()
    render(<UpdatesHarness host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={onRequestUpdate} />)
    expect(await screen.findByText('Browser Use Jev')).toBeTruthy()
    expect(screen.getByText('aaaaaaaaaaaa')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看变更' }).getAttribute('href')).toContain(`${currentVersion}...${latestVersion}`)
    expect(screen.queryByRole('button', { name: '一键更新' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '评估更新' }))
    expect(JSON.parse(onRequestUpdate.mock.calls[0][0].slice(PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX.length))).toMatchObject({ gitSource, currentVersion, latestVersion })
  })
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
  it('renders extension-declared components with owner and source across status variants', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(extensionSnapshot)
    const onRequestUpdate = vi.fn()
    render(<UpdatesHarness host={{ checkForUpdates } as unknown as PipiHostAPI} onRequestUpdate={onRequestUpdate} />)
    await screen.findByTestId('update-item-pdf-extension:firecrawl-pdf-inspector')
    expect(screen.getAllByText('来自扩展 PipiUI PDF')).toHaveLength(3)
    const row = screen.getByTestId('update-item-pdf-extension:firecrawl-pdf-inspector')
    expect(row.textContent).toContain('@firecrawl/pdf-inspector')
    expect(screen.getByTestId('update-item-pdf-extension:firecrawl-pdf-inspector-wasm').textContent).toContain('firecrawl/pdf-inspector')
    const extensionGroup = screen.getByTestId('update-group-extension')
    expect(extensionGroup.textContent).toContain('检查失败')
    expect(extensionGroup.textContent).toContain('来自扩展 PipiUI PDF')
    expect(screen.getByText('有新版本')).toBeTruthy()
    expect(screen.getByText('无法检查')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: '评估更新' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onRequestUpdate).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onRequestUpdate.mock.calls[0][0].slice(PIPIUI_UPDATE_EVALUATION_INTENT_PREFIX.length))).toEqual({
      version: PIPIUI_UPDATE_EVALUATION_INTENT_VERSION,
      id: 'pdf-extension:firecrawl-pdf-inspector',
      name: 'Firecrawl pdf-inspector',
      packageName: '@firecrawl/pdf-inspector',
      ownerExtensionId: 'pdf-extension',
      ownerExtensionName: 'PipiUI PDF',
      currentVersion: '1.15.0',
      latestVersion: '1.17.0',
    })
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

it('downloads official software, then offers restart, and installs the plugin independently', async () => {
  let ready = false
  let installed = false
  const applyOfficialUpdate = vi.fn(async (action: string) => {
    if (action === 'download') ready = true
    if (action === 'extension') installed = true
  })
  const checkForUpdates = async () => ({ checkedAt: Date.now(), items: [
    { id: 'pipiui', name: 'PipiUI', officialUpdate: 'desktop', status: 'updateAvailable', currentVersion: '1.0.0', latestVersion: '1.1.0', downloaded: ready },
    { id: 'official:flapcode', name: 'Flapcode', officialUpdate: 'extension', ownerExtensionId: 'flapcode', status: installed ? 'upToDate' : 'updateAvailable', currentVersion: installed ? '0.1.1' : '0.1.0', latestVersion: '0.1.1' },
  ] })
  render(<UpdatesHarness host={{ checkForUpdates, applyOfficialUpdate } as unknown as PipiHostAPI} onRequestUpdate={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '更新插件' }))
  await screen.findByText('已是最新')
  fireEvent.click(screen.getByRole('button', { name: '下载软件更新' }))
  fireEvent.click(await screen.findByRole('button', { name: '重启并安装' }))
  expect(applyOfficialUpdate.mock.calls).toEqual([
    ['extension', 'flapcode', '0.1.1'], ['download', 'pipiui', '1.1.0'], ['restart', 'pipiui', '1.1.0'],
  ])
})

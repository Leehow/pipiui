// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserEvent } from '@pipi/host-api'
import { createMockHost } from './App'
import { BrowserPanel } from './BrowserPanel'

function renderPanel(host = createMockHost(), sessionId = 'welcome') {
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  const view = render(<BrowserPanel host={host} sessionId={sessionId} headerSlot={slot} />)
  return { view, slot }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 400, y: 100, width: 800, height: 600 }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BrowserPanel', () => {
  it('gives the portaled-tab layout remaining height to the native browser surface', () => {
    const css = readFileSync(join(import.meta.dirname, 'browser-panel.css'), 'utf8')
    const panelRule = css.match(/\.browser-panel\{[^}]*\}/)?.[0] ?? ''
    expect(panelRule).toContain('grid-template-rows:auto minmax(0,1fr)')
    expect(panelRule).not.toContain('grid-template-rows:auto auto minmax(0,1fr)')
  })

  it('adds, switches, and closes virtual tabs through the host API', async () => {
    const host = createMockHost()
    renderPanel(host)

    await screen.findByRole('tab', { name: '新标签页' })
    const address = screen.getByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'first.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://first.example'))

    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
    fireEvent.change(address, { target: { value: 'second.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://second.example'))

    fireEvent.click(screen.getByRole('tab', { name: 'first.example' }))
    await waitFor(() => expect(address.value).toBe('https://first.example'))
    fireEvent.click(screen.getByRole('button', { name: '关闭标签页 first.example' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1))
    await waitFor(() => expect(address.value).toBe('https://second.example'))
  })

  it('exposes back, forward, and refresh against mock navigation state', async () => {
    const host = createMockHost()
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    const address = screen.getByLabelText('浏览器地址') as HTMLInputElement

    fireEvent.change(address, { target: { value: 'one.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://one.example'))
    fireEvent.change(address, { target: { value: 'two.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://two.example'))

    const back = screen.getByRole('button', { name: '后退' }) as HTMLButtonElement
    const forward = screen.getByRole('button', { name: '前进' }) as HTMLButtonElement
    expect(back.disabled).toBe(false)
    expect(forward.disabled).toBe(true)
    fireEvent.click(back)
    await waitFor(() => expect(address.value).toBe('https://one.example'))
    await waitFor(() => expect(forward.disabled).toBe(false))
    fireEvent.click(forward)
    await waitFor(() => expect(address.value).toBe('https://two.example'))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  })

  it('emits loading navigation snapshots and exposes the agent-browser-shaped snapshot API', async () => {
    const host = createMockHost()
    const browser = host.browser
    if (!browser) throw new Error('mock browser unavailable')
    const events: boolean[] = []
    const unsubscribe = browser.subscribe(event => events.push(event.type === 'tabs' ? event.snapshot.tabs.find(tab => tab.id === event.snapshot.activeTabId)?.isLoading ?? false : false))

    await browser.loadURL('welcome', 'first.example')
    await browser.loadURL('welcome', 'second.example')
    expect(events).toContain(true)
    expect((await browser.getActiveTab('welcome'))?.canGoBack).toBe(true)
    await browser.goBack('welcome')
    expect((await browser.getActiveTab('welcome'))?.url).toBe('https://first.example')
    await browser.goForward('welcome')
    const snapshot = await browser.snapshot('welcome')
    expect(snapshot).toMatchObject({ url: 'https://second.example', text: 'mock browser snapshot' })
    unsubscribe()
  })

  it('dismisses a floating operation error and re-shows it when the failure re-occurs', async () => {
    const host = createMockHost()
    const browser = host.browser
    if (!browser) throw new Error('mock browser unavailable')
    const reload = vi.fn(async () => { throw new Error('mock reload failure') })
    browser.reload = reload
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock reload failure')
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('mock reload failure')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('switches to the selected session browser space and ignores other session tab events', async () => {
    const host = createMockHost()
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    const address = await screen.findByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'welcome.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))

    rerender(<BrowserPanel host={host} sessionId="layout" />)
    await waitFor(() => expect(address.value).toBe(''))
    fireEvent.change(address, { target: { value: 'layout.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://layout.example'))

    rerender(<BrowserPanel host={host} sessionId="welcome" />)
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))
  })

  it('does not blank address or tabs when returning to a session before listTabs resolves', async () => {
    const host = createMockHost()
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    const address = await screen.findByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'welcome.example' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))

    rerender(<BrowserPanel host={host} sessionId="layout" />)
    await waitFor(() => expect(address.value).toBe(''))

    const original = host.browser!.listTabs.bind(host.browser)
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    host.browser!.listTabs = vi.fn(async sessionId => {
      if (sessionId === 'welcome') await blocked
      return original(sessionId)
    })

    rerender(<BrowserPanel host={host} sessionId="welcome" />)
    expect(address.value).toBe('https://welcome.example')
    expect(address.value).not.toBe('')
    release()
    await waitFor(() => expect(address.value).toBe('https://welcome.example'))
  })

  it('hides the native browser view while occluded and restores its current bounds', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('welcome', expect.objectContaining({ visible: true })))

    rerender(<BrowserPanel host={host} sessionId="welcome" occluded />)
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('welcome', expect.objectContaining({ x: 0, y: 0, width: 0, height: 0, visible: false, mode: 'desktop' })))

    rerender(<BrowserPanel host={host} sessionId="welcome" occluded={false} />)
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true }))
  })

  it('keeps a nonzero visible presentation last after hidden mount, late session ownership, and StrictMode cleanup', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    const panel = (sessionId: string | undefined, occluded: boolean) => (
      <StrictMode><BrowserPanel host={host} sessionId={sessionId} occluded={occluded} /></StrictMode>
    )
    const { rerender } = render(panel(undefined, true))
    expect(setViewBounds).not.toHaveBeenCalled()

    rerender(panel('welcome', true))
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ x: 0, y: 0, width: 0, height: 0, visible: false, mode: 'desktop' }))

    rerender(panel('welcome', false))
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ x: 400, y: 100, width: 800, height: 600, visible: true, mode: 'desktop' }))
  })

  it('hides the empty-tab hint once a real URL is present and shows host load errors', async () => {
    const host = createMockHost()
    const original = host.browser!.subscribe.bind(host.browser)
    const extra = new Set<(event: BrowserEvent) => void>()
    host.browser!.subscribe = listener => {
      extra.add(listener)
      const unsubscribe = original(listener)
      return () => {
        extra.delete(listener)
        unsubscribe()
      }
    }
    renderPanel(host)
    expect(screen.getByText('桌面宿主将在此显示网页内容')).toBeTruthy()
    const address = await screen.findByLabelText('浏览器地址') as HTMLInputElement
    fireEvent.change(address, { target: { value: 'google.com' } })
    fireEvent.submit(address.closest('form')!)
    await waitFor(() => expect(address.value).toBe('https://google.com'))
    expect(screen.queryByText('桌面宿主将在此显示网页内容')).toBeNull()

    extra.forEach(listener => listener({ type: 'error', sessionId: 'welcome', message: '无法加载页面：ERR_NAME_NOT_RESOLVED' }))
    expect((await screen.findByRole('alert')).textContent).toContain('无法加载页面：ERR_NAME_NOT_RESOLVED')
  })

  it('re-pushes current bounds when the host requests reveal', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    const original = host.browser!.subscribe.bind(host.browser)
    let panelListener: ((event: BrowserEvent) => void) | undefined
    host.browser!.subscribe = listener => {
      panelListener = listener
      return original(listener)
    }
    renderPanel(host)
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('welcome', expect.objectContaining({ visible: true })))
    const before = setViewBounds.mock.calls.length
    panelListener?.({ type: 'reveal', sessionId: 'welcome' })
    await waitFor(() => expect(setViewBounds.mock.calls.length).toBeGreaterThan(before))
    expect(setViewBounds.mock.calls.at(-1)?.[0]).toBe('welcome')
    expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true, mode: 'desktop' })
  })

  it('keeps the desktop surface unchanged while opening and closing the native mobile window', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    renderPanel(host)
    expect(screen.queryByRole('radio', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Compare' })).toBeNull()
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({
      visible: true,
      mode: 'desktop',
      x: 400, y: 100, width: 800, height: 600,
      mobileOverlay: expect.objectContaining({ visible: false })
    }))
    expect(setViewBounds.mock.calls.at(-1)?.[1]).not.toHaveProperty('slots')

    const desktopBounds = setViewBounds.mock.calls.at(-1)?.[1]
    fireEvent.click(await screen.findByTestId('browser-mobile-window-toggle'))
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({
      visible: true,
      mode: 'desktop',
      x: 400, y: 100, width: 800, height: 600,
      mobileOverlay: expect.objectContaining({ visible: true, applyDeviceEmulation: true })
    }))
    expect(setViewBounds.mock.calls.at(-1)?.[1]).not.toHaveProperty('slots')
    expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({
      x: desktopBounds?.x,
      y: desktopBounds?.y,
      width: desktopBounds?.width,
      height: desktopBounds?.height
    })
    expect(screen.queryByTestId('browser-mobile-overlay')).toBeNull()

    fireEvent.click(screen.getByTestId('browser-mobile-window-toggle'))
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].mobileOverlay?.visible).toBe(false))
  })

  it('changes only the native mobile window device preset', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    renderPanel(host)
    fireEvent.click(await screen.findByTestId('browser-mobile-window-toggle'))
    fireEvent.change(screen.getByLabelText('手机设备'), { target: { value: 'pixel-7' } })
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].mobileOverlay!).toMatchObject({
      visible: true,
      deviceId: 'pixel-7',
      viewport: { width: 412, height: 915 }
    }))
  })

  it('reflects a native titlebar close event without changing desktop bounds', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    const original = host.browser!.subscribe.bind(host.browser)
    let listener: ((event: BrowserEvent) => void) | undefined
    host.browser!.subscribe = next => {
      listener = next
      return original(next)
    }
    renderPanel(host)
    fireEvent.click(await screen.findByTestId('browser-mobile-window-toggle'))
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].mobileOverlay?.visible).toBe(true))
    listener?.({ type: 'mobile-window', sessionId: 'welcome', open: false, deviceId: 'responsive' })
    await waitFor(() => expect(screen.getByTestId('browser-mobile-window-toggle').getAttribute('aria-pressed')).toBe('false'))
    expect(setViewBounds.mock.calls.at(-1)?.[1]).toMatchObject({ x: 400, y: 100, width: 800, height: 600 })
  })

  it('invokes workspace fullscreen without toggling tools collapse', async () => {
    const host = createMockHost()
    const onToggle = vi.fn()
    render(<BrowserPanel host={host} sessionId="welcome" onToggleWorkspaceFullscreen={onToggle} workspaceFullscreen={false} />)
    fireEvent.click(await screen.findByTestId('browser-workspace-fullscreen'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('hides the device preset until the phone preview is open and places zoom then fullscreen after the URL', async () => {
    const host = createMockHost()
    const setZoomFactor = vi.spyOn(host.browser!, 'setZoomFactor')
    render(<BrowserPanel host={host} sessionId="welcome" onToggleWorkspaceFullscreen={() => undefined} />)
    await screen.findByLabelText('浏览器地址')
    expect(screen.queryByLabelText('手机设备')).toBeNull()
    expect(screen.queryByText('响应式 / 自定义')).toBeNull()

    fireEvent.click(await screen.findByTestId('browser-mobile-window-toggle'))
    const device = await screen.findByLabelText('手机设备')
    expect((device as HTMLSelectElement).options[0]?.textContent).toBe('响应式 / 自定义')

    const toolbar = screen.getByLabelText('浏览器地址').closest('form')!
    const controls = [...toolbar.querySelectorAll('input, button, select')].map(node => {
      if (node instanceof HTMLInputElement) return 'url'
      return node.getAttribute('data-testid') ?? node.getAttribute('aria-label')
    })
    expect(controls.indexOf('url')).toBeLessThan(controls.indexOf('browser-zoom-out'))
    expect(controls.indexOf('browser-zoom-out')).toBeLessThan(controls.indexOf('browser-zoom-in'))
    expect(controls.indexOf('browser-zoom-in')).toBeLessThan(controls.indexOf('browser-workspace-fullscreen'))

    fireEvent.click(screen.getByTestId('browser-zoom-out'))
    fireEvent.click(screen.getByTestId('browser-zoom-in'))
    await waitFor(() => expect(setZoomFactor).toHaveBeenCalled())
    expect(setZoomFactor.mock.calls.map(call => call[1])).toEqual([0.9, 1])
  })

  it('sends distinct device presets to the host', async () => {
    const host = createMockHost()
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    renderPanel(host)
    fireEvent.click(await screen.findByTestId('browser-mobile-window-toggle'))
    const select = await screen.findByLabelText('手机设备')
    fireEvent.change(select, { target: { value: 'iphone-se' } })
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].mobileOverlay).toMatchObject({
      deviceId: 'iphone-se', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2
    }))
    fireEvent.change(select, { target: { value: 'iphone-15-pro-max' } })
    await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].mobileOverlay).toMatchObject({
      deviceId: 'iphone-15-pro-max', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3
    }))
    expect((select as HTMLSelectElement).value).toBe('iphone-15-pro-max')
  })
})

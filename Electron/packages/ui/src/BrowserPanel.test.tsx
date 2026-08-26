// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserEvent } from '@pipi/host-api'
import type { BrowserSurfaceEvent, BrowserWatchInfo } from '@pipi/host-api/browser'
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
    const extra = new Set<(event: BrowserSurfaceEvent) => void>()
    host.browser!.subscribe = listener => {
      const surfaceListener = asSurfaceListener(listener)
      extra.add(surfaceListener)
      const unsubscribe = original(listener)
      return () => {
        extra.delete(surfaceListener)
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
    let panelListener: ((event: BrowserSurfaceEvent) => void) | undefined
    host.browser!.subscribe = listener => {
      panelListener = asSurfaceListener(listener)
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
    let listener: ((event: BrowserSurfaceEvent) => void) | undefined
    host.browser!.subscribe = next => {
      listener = asSurfaceListener(next)
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

/** Grabs the listener BrowserPanel registered, so tests can push host events. */
function interceptPanelListener(host: ReturnType<typeof createMockHost>) {
  const original = host.browser!.subscribe.bind(host.browser)
  let listener: ((event: BrowserSurfaceEvent) => void) | undefined
  host.browser!.subscribe = next => {
    listener = asSurfaceListener(next)
    return original(next)
  }
  return () => listener
}

/**
 * Narrow seam cast at the root-subscribe boundary: the root contract types the
 * handler parameter as the stable `BrowserEvent` union, while the panel (and
 * these tests) receive the wider `BrowserSurfaceEvent` union this subpath
 * owns. Only the handler's parameter type is widened; nothing else is cast.
 */
function asSurfaceListener(listener: (event: BrowserEvent) => void): (event: BrowserSurfaceEvent) => void {
  return listener as (event: BrowserSurfaceEvent) => void
}

function pageConsoleEvent(index: number, level: 'error' | 'warn' | 'log'): BrowserSurfaceEvent {
  return { type: 'console', sessionId: 'welcome', entry: { timestamp: 1700000000000 + index, level, message: `page-${index}`, sourceId: `s${index}.js`, line: index, url: 'https://page.example/app', tabId: 't1' } }
}

describe('BrowserPanel page visibility', () => {
  it('hydrates the watch strip from the synchronous selectSession snapshot without any list RPC', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    // Main-side contract (session-host.ts): selectSession re-emits the active
    // watch list as one `watch` event, synchronously, to already-registered
    // listeners. The panel must subscribe BEFORE announcing, otherwise this
    // emission is dropped and hydration never happens — so the test emits
    // strictly through the listener the panel registered, never a test-side
    // push; if the listener is not up yet, the mock throws and this test fails.
    // Mount re-runs the effect (surface attach), so the registry content — not
    // a call counter — decides what each announcement emits, exactly like main.
    let currentWatches: BrowserWatchInfo[] = [
      { watchId: 'w1', condition: { type: 'url_matches', pattern: 'done' }, createdAt: 1, timeoutAt: Date.now() + 30_000, intervalMs: 500, status: 'active' },
      { watchId: 'w2', condition: { type: 'expression', expression: 'window.ready === true' }, createdAt: 1, timeoutAt: null, intervalMs: 500, status: 'checking' }
    ]
    const selectSession = vi.spyOn(host.browser!, 'selectSession').mockImplementation(async () => {
      const listener = getListener()
      if (!listener) throw new Error('selectSession emitted its snapshot before the panel subscribed to browser events')
      listener({ type: 'watch', sessionId: 'welcome', watches: currentWatches })
    })
    const { view, slot } = renderPanel(host)

    const strip = await screen.findByTestId('browser-watches')
    expect(strip.textContent).toContain('监听中 2')
    expect(strip.textContent).toContain('URL 匹配 /done/')
    // Live countdown may tick past the boundary mid-render; assert the band.
    expect(strip.textContent).toMatch(/剩 3[01]s/)
    expect(strip.textContent).toContain('表达式 window.ready === true')
    expect(strip.textContent).toContain('无超时')
    // Hydration contract: mount announces ownership via selectSession; there is
    // no listActiveWatches call because the method is not on the host contract.
    expect(selectSession).toHaveBeenCalledWith('welcome')
    expect((host.browser as { listActiveWatches?: unknown }).listActiveWatches).toBeUndefined()

    // Effect re-run (occlusion flip) re-announces ownership; once the registry
    // drains, the empty snapshot from that re-select must clear the old chips.
    currentWatches = []
    view.rerender(<BrowserPanel host={host} sessionId="welcome" headerSlot={slot} occluded />)
    await waitFor(() => expect(screen.queryByTestId('browser-watches')).toBeNull())
  })

  it('shows the latest watch trigger banner and dismisses it without dropping the strip', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    getListener()?.({
      type: 'watch',
      sessionId: 'welcome',
      watches: [{ watchId: 'w1', condition: { type: 'url_matches', pattern: 'done' }, createdAt: 1, timeoutAt: Date.now() + 60_000, intervalMs: 500, status: 'active' }] satisfies BrowserWatchInfo[],
      trigger: { watchId: 'w1', reason: 'matched', waitedMs: 4200, url: 'https://page.example/done', title: '任务完成', firedAt: Date.now() }
    } satisfies BrowserSurfaceEvent)
    const banner = await screen.findByTestId('browser-watch-trigger')
    expect(banner.textContent).toContain('matched')
    expect(banner.textContent).toContain('任务完成')
    expect(banner.textContent).toContain('4.2s')
    expect(screen.getByTestId('browser-watches').textContent).toContain('URL 匹配 /done/')

    fireEvent.click(screen.getByRole('button', { name: '关闭监听触发提示' }))
    await waitFor(() => expect(screen.queryByTestId('browser-watch-trigger')).toBeNull())
    expect(screen.getByTestId('browser-watches')).toBeTruthy()
  })

  it('buffers page console output at 200 entries, filters to error/warn, and clears', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    getListener()?.(pageConsoleEvent(1, 'error'))
    getListener()?.(pageConsoleEvent(2, 'warn'))
    getListener()?.(pageConsoleEvent(3, 'log'))
    getListener()?.({ type: 'console', sessionId: 'welcome', entry: { timestamp: 1, level: 'error', message: 'boom from page', tabId: 't1' } })
    let consoleBox = await screen.findByTestId('browser-console')
    expect(consoleBox.textContent).toContain('page-1')
    expect(consoleBox.textContent).toContain('page-2')
    expect(consoleBox.textContent).not.toContain('page-3')
    expect(consoleBox.textContent).toContain('1 警告')
    expect(consoleBox.textContent).toContain('boom from page')

    for (let index = 10; index < 260; index += 1) getListener()?.(pageConsoleEvent(index, 'error'))
    await waitFor(() => expect(screen.getByTestId('browser-console').textContent).toContain('最近 200 条'))
    consoleBox = screen.getByTestId('browser-console')
    expect(consoleBox.querySelectorAll('li')).toHaveLength(50)
    expect(consoleBox.textContent).toContain('page-259')

    fireEvent.click(screen.getByRole('button', { name: '清空页面输出' }))
    await waitFor(() => expect(screen.queryByTestId('browser-console')).toBeNull())
  })

  it('surfaces certificate errors with the tool-side handling note and dismisses them', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    getListener()?.({ type: 'certificate-error', sessionId: 'welcome', url: 'https://self-signed.example', reason: 'ERR_CERT_AUTHORITY_INVALID' })
    const banner = await screen.findByTestId('browser-certificate-error')
    expect(banner.textContent).toContain('ERR_CERT_AUTHORITY_INVALID')
    expect(banner.textContent).toContain('https://self-signed.example')
    expect(banner.textContent).toContain('拒绝加载')

    fireEvent.click(screen.getByRole('button', { name: '关闭证书错误提示' }))
    await waitFor(() => expect(screen.queryByTestId('browser-certificate-error')).toBeNull())
  })

  it('surfaces JS dialog calls with a repeat count', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    getListener()?.({ type: 'js-dialog', sessionId: 'welcome', kind: 'alert', message: '操作完成', url: 'https://page.example/app' })
    const banner = await screen.findByTestId('browser-js-dialog')
    expect(banner.textContent).toContain('alert()')
    expect(banner.textContent).toContain('操作完成')
    expect(banner.textContent).toContain('不会代答')

    getListener()?.({ type: 'js-dialog', sessionId: 'welcome', kind: 'alert', message: '操作完成', url: 'https://page.example/app' })
    await waitFor(() => expect(screen.getByTestId('browser-js-dialog').textContent).toContain('×2'))

    getListener()?.({ type: 'js-dialog', sessionId: 'welcome', kind: 'confirm', message: '确认删除？' })
    await waitFor(() => expect(screen.getByTestId('browser-js-dialog').textContent).toContain('confirm()'))
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框提示' }))
    await waitFor(() => expect(screen.queryByTestId('browser-js-dialog')).toBeNull())
  })

  it('keeps projecting navigation failures and timeouts through the error alert', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    renderPanel(host)
    await screen.findByRole('tab', { name: '新标签页' })
    getListener()?.({ type: 'error', sessionId: 'welcome', message: 'ERR_TIMED_OUT https://slow.example' })
    expect((await screen.findByRole('alert')).textContent).toContain('ERR_TIMED_OUT')
    getListener()?.({ type: 'error', sessionId: 'welcome', message: '导航超时：did-fail-load (-7)' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('导航超时'))
  })

  it('resets page notices when switching to another session browser space', async () => {
    const host = createMockHost()
    const getListener = interceptPanelListener(host)
    const { rerender } = render(<BrowserPanel host={host} sessionId="welcome" />)
    await screen.findByLabelText('浏览器地址')
    getListener()?.({ type: 'certificate-error', sessionId: 'welcome', url: 'https://self-signed.example', reason: 'ERR_CERT_AUTHORITY_INVALID' })
    getListener()?.(pageConsoleEvent(1, 'error'))
    await screen.findByTestId('browser-certificate-error')

    rerender(<BrowserPanel host={host} sessionId="layout" />)
    await waitFor(() => {
      expect(screen.queryByTestId('browser-certificate-error')).toBeNull()
      expect(screen.queryByTestId('browser-console')).toBeNull()
      expect(screen.queryByTestId('browser-page-status')).toBeNull()
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { BrowserSessionHost, BrowserTabsHost, browserPartitionForSession, normalizeBrowserURL, routeBrowserView, withBrowserTabsHost, type BrowserViewLike } from './browser-host.js'

class FakeWebContents {
  url = 'about:blank'
  pageText = ''
  viewport = { width: 0, height: 0 }
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  loadURL = vi.fn(async (url: string) => {
    this.url = url
    this.emit('did-start-loading')
    this.emit('did-navigate', {}, url)
    this.emit('page-title-updated', {}, `Title for ${url}`)
    this.emit('did-stop-loading')
  })
  reload = vi.fn(() => { void this.loadURL(this.url) })
  executeJavaScript = vi.fn(async (code: string) => code.includes('__pipiBrowserDOM.dispatch')
    ? { ok: true, url: this.url, text: this.pageText, viewport: { ...this.viewport }, elements: this.viewport.width > 0 ? [{ index: 0, role: 'link', name: '热门视频' }] : [] }
    : code.includes('querySelector') ? { ok: true } : this.pageText)
  capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('png-bytes') }))
  close = vi.fn()
  session = { clearStorageData: vi.fn(async () => undefined), clearCache: vi.fn(async () => undefined) }
  on(event: string, listener: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }
  emit(event: string, ...args: any[]) { this.listeners.get(event)?.forEach(listener => listener(...args)) }
}

function browserHarness() {
  const contents = new FakeWebContents()
  const view: BrowserViewLike = {
    webContents: contents,
    // WebContentsView is clipped by its parent View. Moving the whole surface
    // outside the parent leaves Chromium with an effective 0x0 viewport.
    setBounds: vi.fn(bounds => {
      contents.viewport = bounds.x < 0 || bounds.y < 0
        ? { width: 0, height: 0 }
        : { width: bounds.width, height: bounds.height }
    }),
    setVisible: vi.fn()
  }
  const createView = vi.fn(() => view)
  const attach = vi.fn()
  const host = new BrowserTabsHost(createView)
  host.attachToWindow(attach)
  return { host, contents, view, createView, attach }
}

describe('BrowserTabsHost', () => {
  it('keeps the off-screen native host alive for background sessions while presenting one view', () => {
    const calls: string[] = []
    const view = browserHarness().view
    const main = { contentView: { addChildView: () => calls.push('main:add'), removeChildView: () => calls.push('main:remove') } }
    const hidden = {
      contentView: { addChildView: () => calls.push('hidden:add'), removeChildView: () => calls.push('hidden:remove') },
      showInactive: () => calls.push('hidden:showInactive'),
      hide: () => calls.push('hidden:hide')
    }

    routeBrowserView(view, false, main, hidden)
    expect(calls).toEqual(['main:remove', 'hidden:remove', 'hidden:add', 'hidden:showInactive'])
    calls.length = 0
    routeBrowserView(view, true, main, hidden)
    // The off-screen host may contain other sessions that are still browsing;
    // presenting one view must not hide/throttle every background space.
    expect(calls).toEqual(['main:remove', 'hidden:remove', 'main:add'])
  })

  it('reuses one WebContentsView while virtual tabs retain selection and history', async () => {
    const { host, contents, createView, attach } = browserHarness()
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    expect(createView).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(createView.mock.calls[0][0].webPreferences.partition).toBe('persist:pipiui-browser')

    const first = (await host.getActiveTab())!
    await host.loadURL('one.example')
    await host.loadURL('two.example')
    expect((await host.getActiveTab())).toMatchObject({ url: 'https://two.example', canGoBack: true })
    await host.goBack()
    expect((await host.getActiveTab())).toMatchObject({ url: 'https://one.example', canGoForward: true })

    const second = await host.newTab()
    expect(second.partition).toBe('persist:pipiui-browser')
    expect(createView).toHaveBeenCalledTimes(1)
    await host.switchTab(first.id)
    expect((await host.getActiveTab())?.url).toBe('https://one.example')
    expect(createView).toHaveBeenCalledTimes(1)
    expect(contents.loadURL).toHaveBeenCalled()
  })

  it('keeps at least one fresh tab and routes browser commands/events through the host bridge', async () => {
    const { createView, attach } = browserHarness()
    const host = new BrowserSessionHost(createView)
    host.attachToWindow(attach)
    const backendEvents = new Set<(event: HostEvent) => void>()
    const backend: HostBackend = {
      handle: async method => method === 'capabilities' ? { computerUse: false, terminal: true, revealInFinder: true } : undefined,
      subscribe: listener => { backendEvents.add(listener); return () => backendEvents.delete(listener) }
    }
    const bridge = withBrowserTabsHost(backend, host)
    const received: HostEvent[] = []
    const unsubscribe = bridge.subscribe(event => received.push(event))

    expect(await bridge.handle('capabilities', [])).toMatchObject({ browser: true })
    const first = (await bridge.handle('browserGetActiveTab', ['session-1'])) as { id: string }
    await bridge.handle('browserLoadURL', ['session-1', 'first.example', first.id])
    await bridge.handle('browserCloseTab', ['session-1', first.id])
    const tabs = await bridge.handle('browserListTabs', ['session-1']) as { tabs: Array<{ url: string }> }
    expect(tabs.tabs).toHaveLength(1)
    expect(tabs.tabs[0].url).toBe('')
    expect(received.some(event => event.channel === 'browser')).toBe(true)
    unsubscribe()
  })

  it('normalizes common address-bar input without losing explicit schemes', () => {
    expect(normalizeBrowserURL('example.com')).toBe('https://example.com')
    expect(normalizeBrowserURL('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeBrowserURL('about:blank')).toBe('about:blank')
  })

  it('snapshots rendered body text only for the active page represented by the physical view', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    const first = (await host.getActiveTab())!
    await host.loadURL('bilibili.com', first.id)
    contents.pageText = '热门\n科技\n知识'

    await expect(host.snapshot()).resolves.toMatchObject({
      tabId: first.id,
      url: 'https://bilibili.com',
      text: '热门\n科技\n知识'
    })
    expect(contents.executeJavaScript).toHaveBeenCalledWith('document.body?.innerText ?? ""')

    const second = await host.newTab({ url: 'second.example' })
    await expect(host.snapshot(first.id)).resolves.not.toHaveProperty('text')
    expect((await host.snapshot()).tabId).toBe(second.id)
  })

  it('executes the Pi browser action surface against the active physical page', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    contents.pageText = 'Bilibili 热门科技视频'
    await expect(host.toolAction({ action: 'navigate', url: 'bilibili.com' })).resolves.toMatchObject({ ok: true, text: 'Bilibili 热门科技视频' })
    await host.toolAction({ action: 'click', selector: '#video-card' })
    await host.toolAction({ action: 'input', selector: 'input.search', text: 'AI 科技' })
    await host.toolAction({ action: 'type', selector: 'input.search', text: ' 2026' })
    await host.toolAction({ action: 'scroll', direction: 'down', amount: 0.8 })
    await host.toolAction({ action: 'back' })
    await host.toolAction({ action: 'forward' })
    await host.toolAction({ action: 'reload' })
    await expect(host.toolAction({ action: 'screenshot' })).resolves.toMatchObject({ ok: true, mimeType: 'image/png', base64: Buffer.from('png-bytes').toString('base64') })
    expect(contents.executeJavaScript.mock.calls.some(([code]) => String(code).includes('querySelector'))).toBe(true)
  })

  it('reveals and embeds the physical browser for a Pi action from another tool tab', async () => {
    const { host, contents, view, createView, attach } = browserHarness()
    contents.pageText = '无需人工打开面板'
    const events: string[] = []
    host.subscribe(event => {
      events.push(event.type)
      if (event.type === 'reveal') {
        void host.setViewBounds({ x: 400, y: 80, width: 700, height: 600, visible: true })
        // BrowserPanel follows its layout-effect update with RAF/ResizeObserver.
        queueMicrotask(() => void host.setViewBounds({ x: 400, y: 80, width: 700, height: 600, visible: true }))
      }
      if (event.type === 'tabs' && event.snapshot.tabs.some(tab => tab.url === 'https://bilibili.com')) {
        // BrowserPanel rerenders from the pushed target before show() owns it.
        void host.setViewBounds({ x: 400, y: 80, width: 700, height: 600, visible: true })
      }
    })
    const observation = await host.toolAction({ action: 'navigate', url: 'bilibili.com' })
    expect(observation).toMatchObject({ ok: true, url: 'https://bilibili.com', text: '无需人工打开面板' })
    expect((observation.viewport as { width: number; height: number }).width).toBeGreaterThan(0)
    expect(observation.elements).toEqual([expect.objectContaining({ name: '热门视频' })])
    expect(createView).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenLastCalledWith(view, true)
    expect(attach).not.toHaveBeenCalledWith(view, false)
    expect(events[0]).toBe('reveal')
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
    expect(contents.loadURL).toHaveBeenCalledWith('https://bilibili.com')
    expect(contents.loadURL).not.toHaveBeenCalledWith('about:blank')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    const screenshot = await host.toolAction({ action: 'screenshot' })
    expect(Buffer.from(String(screenshot.base64), 'base64').byteLength).toBeGreaterThan(0)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(createView).toHaveBeenCalledTimes(1)
  })
})

describe('BrowserSessionHost', () => {
  function sessionsHarness() {
    const created: Array<{ partition?: string; contents: FakeWebContents; view: BrowserViewLike }> = []
    const createView = vi.fn((options: { webPreferences: { partition?: string } }) => {
      const contents = new FakeWebContents()
      const view: BrowserViewLike = {
        webContents: contents,
        setBounds: vi.fn(bounds => { contents.viewport = { width: bounds.width, height: bounds.height } }),
        setVisible: vi.fn()
      }
      created.push({ partition: options.webPreferences.partition, contents, view })
      return view
    })
    const host = new BrowserSessionHost(createView)
    host.attachToWindow(vi.fn())
    return { host, created, createView }
  }

  it('owns isolated tabs, physical views, and persistent storage partitions per authenticated session', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'a.example' })
    await host.toolAction('session-b', { action: 'navigate', url: 'b.example' })

    expect((await host.listTabs('session-a')).tabs[0].url).toBe('https://a.example')
    expect((await host.listTabs('session-b')).tabs[0].url).toBe('https://b.example')
    expect(created).toHaveLength(2)
    expect(created[0].contents).not.toBe(created[1].contents)
    expect(created.map(item => item.partition)).toEqual([
      browserPartitionForSession('session-a'),
      browserPartitionForSession('session-b')
    ])
    expect(created[0].partition).not.toBe(created[1].partition)
  })

  it('reveals only selected-session tool actions while background sessions keep working off-screen', async () => {
    const { host } = sessionsHarness()
    const reveals: string[] = []
    host.subscribe(event => {
      if (event.type !== 'reveal') return
      reveals.push(event.sessionId)
      void host.setViewBounds(event.sessionId, { x: 10, y: 20, width: 500, height: 400, visible: true })
    })
    await host.selectSession('session-a')

    await expect(host.toolAction('session-b', { action: 'navigate', url: 'background.example' })).resolves.toMatchObject({ ok: true })
    expect(reveals).toEqual([])
    await expect(host.toolAction('session-a', { action: 'navigate', url: 'foreground.example' })).resolves.toMatchObject({ ok: true })
    expect(reveals).toEqual(['session-a'])
  })

  it('serializes actions inside one session without blocking a different session', async () => {
    const { host, created } = sessionsHarness()
    const firstA = host.toolAction('session-a', { action: 'navigate', url: 'first-a.example' })
    await vi.waitUntil(() => created.length === 1)
    let releaseA!: () => void
    created[0].contents.loadURL.mockImplementationOnce(async url => {
      created[0].contents.url = url
      await new Promise<void>(resolve => { releaseA = resolve })
      created[0].contents.emit('did-navigate', {}, url)
      created[0].contents.emit('did-stop-loading')
    })
    // Restart with the controlled first navigation now that the per-session space exists.
    await firstA
    const blockedA = host.toolAction('session-a', { action: 'navigate', url: 'blocked-a.example' })
    await vi.waitUntil(() => created[0].contents.loadURL.mock.calls.some(([url]) => url === 'https://blocked-a.example'))
    const queuedA = host.toolAction('session-a', { action: 'navigate', url: 'queued-a.example' })
    const independentB = host.toolAction('session-b', { action: 'navigate', url: 'independent-b.example' })
    await expect(independentB).resolves.toMatchObject({ ok: true, url: 'https://independent-b.example' })
    expect(created[0].contents.loadURL.mock.calls.some(([url]) => url === 'https://queued-a.example')).toBe(false)
    releaseA()
    await Promise.all([blockedA, queuedA])
    expect(created[0].contents.loadURL.mock.calls.some(([url]) => url === 'https://queued-a.example')).toBe(true)
  })

  it('destroys only the deleted session view and clears its storage ownership', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'a.example' })
    await host.toolAction('session-b', { action: 'navigate', url: 'b.example' })
    await host.disposeSession('session-a')

    expect(created[0].contents.close).toHaveBeenCalledTimes(1)
    expect(created[0].contents.session.clearStorageData).toHaveBeenCalledTimes(1)
    expect(created[0].contents.session.clearCache).toHaveBeenCalledTimes(1)
    expect(created[1].contents.close).not.toHaveBeenCalled()
    expect((await host.listTabs('session-b')).tabs[0].url).toBe('https://b.example')
  })

  it('ties successful host deleteSession lifecycle to browser-space disposal', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-delete', { action: 'navigate', url: 'delete.example' })
    const backend: HostBackend = {
      handle: vi.fn(async () => undefined),
      subscribe: () => () => undefined
    }
    const bridge = withBrowserTabsHost(backend, host)

    await bridge.handle('deleteSession', ['session-delete'])

    expect(backend.handle).toHaveBeenCalledWith('deleteSession', ['session-delete'])
    expect(created[0].contents.close).toHaveBeenCalledTimes(1)
    expect(created[0].contents.session.clearStorageData).toHaveBeenCalledTimes(1)
  })
})

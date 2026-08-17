import { describe, expect, it, vi } from 'vitest'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { BrowserSessionHost, BrowserTabsHost, browserPartitionForSession, installBrowserNativeTrace, mountBrowserShellView, normalizeBrowserURL, routeBrowserView, withBrowserTabsHost, type BrowserViewLike } from './browser-host.js'

class FakeWebContents {
  url = 'about:blank'
  pageText = ''
  viewport = { width: 0, height: 0 }
  loadURLRejects?: string
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  loadURL = vi.fn(async (url: string) => {
    if (this.loadURLRejects) throw new Error(this.loadURLRejects)
    this.url = url
    this.emit('did-start-loading')
    this.emit('did-navigate', {}, url)
    this.emit('page-title-updated', {}, `Title for ${url}`)
    this.emit('did-stop-loading')
  })
  reload = vi.fn(() => { void this.loadURL(this.url) })
  stop = vi.fn()
  executeJavaScript = vi.fn(async (code: string) => code.includes('__pipiBrowserDOM.dispatch')
    ? { ok: true, url: this.url, text: this.pageText, viewport: { ...this.viewport }, elements: this.viewport.width > 0 ? [{ index: 0, role: 'link', name: '热门视频' }] : [] }
    : code.includes('document.documentElement.outerHTML') ? { title: `Title for ${this.url}`, url: this.url, content: this.pageText }
    : code.includes('querySelector') ? { ok: true } : this.pageText)
  capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('png-bytes') }))
  close = vi.fn()
  isDestroyed = vi.fn(() => false)
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
  let nativeBounds = { x: 0, y: 0, width: 0, height: 0 }
  let nativeVisible = true
  const view: BrowserViewLike = {
    webContents: contents,
    // WebContentsView is clipped by its parent View. Moving the whole surface
    // outside the parent leaves Chromium with an effective 0x0 viewport.
    setBounds: vi.fn(bounds => {
      nativeBounds = { ...bounds }
      contents.viewport = bounds.x < 0 || bounds.y < 0
        ? { width: 0, height: 0 }
        : { width: bounds.width, height: bounds.height }
    }),
    getBounds: () => ({ ...nativeBounds }),
    setVisible: vi.fn(visible => { nativeVisible = visible }),
    getVisible: () => nativeVisible
  }
  const createView = vi.fn(() => view)
  const attach = vi.fn()
  const host = new BrowserTabsHost(createView)
  host.attachToWindow(attach)
  return { host, contents, view, createView, attach }
}

describe('BrowserTabsHost', () => {
  it('records native bounds and visibility readback after presentation', async () => {
    const entries: Array<Record<string, unknown>> = []
    installBrowserNativeTrace(entry => entries.push(entry))
    try {
      const { host } = browserHarness()
      await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
      expect(entries).toContainEqual(expect.objectContaining({
        stage: 'bounds:visible',
        bounds: { x: 10, y: 20, width: 300, height: 400 },
        visible: true,
        requested: { x: 10, y: 20, width: 300, height: 400, visible: true }
      }))
    } finally {
      installBrowserNativeTrace(undefined)
    }
  })

  it('mounts the renderer shell before browser children and tracks BaseWindow content size', () => {
    const calls: string[] = []
    let size = { width: 1280, height: 800 }
    let resize: (() => void) | undefined
    const shell = browserHarness().view
    const browser = browserHarness().view
    const window = {
      contentView: {
        addChildView: (view: BrowserViewLike) => calls.push(view === shell ? 'shell:add' : 'browser:add'),
        removeChildView: () => undefined
      },
      getContentBounds: () => size,
      on: (_event: 'resize', listener: () => void) => { resize = listener },
      off: (_event: 'resize', listener: () => void) => { if (resize === listener) resize = undefined }
    }

    const unmount = mountBrowserShellView(window, shell)
    routeBrowserView(browser, true, window)
    expect(calls).toEqual(['shell:add', 'browser:add'])
    expect(shell.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1280, height: 800 })

    size = { width: 900, height: 600 }
    resize?.()
    expect(shell.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 900, height: 600 })
    unmount()
    expect(resize).toBeUndefined()
  })

  it('pins hidden and visible states to one main-window native owner', () => {
    const calls: string[] = []
    const view = browserHarness().view
    const main = { contentView: { addChildView: () => calls.push('main:add'), removeChildView: () => calls.push('main:remove') } }
    const hidden = {
      contentView: { addChildView: () => calls.push('hidden:add'), removeChildView: () => calls.push('hidden:remove') },
      setOpacity: (opacity: number) => calls.push(`hidden:opacity:${opacity}`),
      setIgnoreMouseEvents: (ignore: boolean) => calls.push(`hidden:ignoreMouse:${ignore}`),
      showInactive: () => calls.push('hidden:showInactive'),
      hide: () => calls.push('hidden:hide')
    }

    routeBrowserView(view, false, main, hidden)
    expect(calls).toEqual(['hidden:remove', 'main:remove', 'main:add'])
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    calls.length = 0
    routeBrowserView(view, true, main, hidden)
    // Visibility changes never mutate native ownership or re-add the view.
    expect(calls).toEqual([])
    calls.length = 0
    routeBrowserView(view, false, main, hidden)
    expect(calls).toEqual([])
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    calls.length = 0
    routeBrowserView(view, true, main, hidden)
    expect(calls).toEqual([])
    expect(calls).not.toContain('hidden:add')
  })

  it('never attempts hidden-host ownership even when that host rejects children', () => {
    const calls: string[] = []
    const view = { ...browserHarness().view, setVisible: vi.fn() }
    const main = { contentView: { addChildView: () => calls.push('main:add'), removeChildView: () => calls.push('main:remove') } }
    const hidden = {
      contentView: {
        addChildView: () => { throw new Error('reparent failed') },
        removeChildView: () => calls.push('hidden:remove')
      }
    }
    routeBrowserView(view, false, main, hidden)
    expect(calls).toEqual(['hidden:remove', 'main:remove', 'main:add'])
    expect(view.setVisible).toHaveBeenCalledWith(false)
    calls.length = 0
    routeBrowserView(view, true, main, hidden)
    expect(calls).toEqual([])
  })

  it('detaches a retired view from both native hosts', () => {
    const calls: string[] = []
    const view = browserHarness().view
    const main = { contentView: { addChildView: () => calls.push('main:add'), removeChildView: () => calls.push('main:remove') } }
    const hidden = { contentView: { addChildView: () => calls.push('hidden:add'), removeChildView: () => calls.push('hidden:remove') } }

    routeBrowserView(view, true, main, hidden)
    calls.length = 0
    routeBrowserView(view, 'detach', main, hidden)

    expect(calls).toEqual(['main:remove', 'hidden:remove'])
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
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

  it('recreates the native view when webContents disappears between navigations', async () => {
    const views: Array<BrowserViewLike & { webContents?: FakeWebContents }> = []
    const createView = vi.fn(() => {
      const contents = new FakeWebContents()
      const view: BrowserViewLike & { webContents?: FakeWebContents } = {
        webContents: contents,
        setBounds: vi.fn(),
        setVisible: vi.fn()
      }
      views.push(view)
      return view
    })
    const host = new BrowserTabsHost(createView)
    host.attachToWindow(vi.fn())
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    expect(createView).toHaveBeenCalledTimes(1)
    views[0].webContents = undefined
    await expect(host.loadURL('two.example')).resolves.toMatchObject({ url: 'https://two.example' })
    expect(createView).toHaveBeenCalledTimes(2)
    expect((await host.getActiveTab())?.url).toBe('https://two.example')
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
    // eval/content bypass the structured DOM controller and run against the live page.
    await expect(host.toolAction({ action: 'eval', js: 'document.title' })).resolves.toMatchObject({ ok: true, result: 'Bilibili 热门科技视频' })
    await expect(host.toolAction({ action: 'content', mode: 'text' })).resolves.toMatchObject({ ok: true, content: 'Bilibili 热门科技视频', truncated: false })
    await expect(host.toolAction({ action: 'eval' })).resolves.toMatchObject({ ok: false })
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
    expect(attach).toHaveBeenCalledWith(view, true)
    expect(attach).toHaveBeenLastCalledWith(view, true)
    expect(attach).not.toHaveBeenCalledWith(view, false)
    expect(events[0]).toBe('reveal')
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
    expect(contents.loadURL).toHaveBeenCalledWith('https://bilibili.com')
    expect(contents.loadURL).not.toHaveBeenCalledWith('about:blank')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    const screenshot = await host.toolAction({ action: 'screenshot' })
    expect(Buffer.from(String(screenshot.base64), 'base64').byteLength).toBeGreaterThan(0)
    expect(attach).toHaveBeenLastCalledWith(view, true)
    expect(createView).toHaveBeenCalledTimes(1)
  })
})

describe('BrowserSessionHost', () => {
  function sessionsHarness(attach: (view: BrowserViewLike, placement: boolean | 'detach') => void = vi.fn()) {
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
    host.attachToWindow(attach)
    return { host, created, createView, attach }
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

  it('switches visible sessions while every native view remains owned by main', async () => {
    const mainChildren = new Set<BrowserViewLike>()
    const hiddenChildren = new Set<BrowserViewLike>()
    const main = {
      contentView: {
        addChildView: (view: BrowserViewLike) => mainChildren.add(view),
        removeChildView: (view: BrowserViewLike) => mainChildren.delete(view)
      }
    }
    const hidden = {
      contentView: {
        addChildView: (view: BrowserViewLike) => hiddenChildren.add(view),
        removeChildView: (view: BrowserViewLike) => hiddenChildren.delete(view)
      }
    }
    const { host, created } = sessionsHarness((view, placement) => routeBrowserView(view, placement, main, hidden))
    await host.toolAction('session-a', { action: 'navigate', url: 'a.example' })
    await host.toolAction('session-b', { action: 'navigate', url: 'b.example' })
    expect(mainChildren).toEqual(new Set(created.map(item => item.view)))
    expect(hiddenChildren).toEqual(new Set())
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(false)
    expect(created[1].view.setVisible).toHaveBeenLastCalledWith(false)

    const visibleBounds = { x: 10, y: 20, width: 500, height: 400, visible: true }
    await host.setViewBounds('session-a', visibleBounds)
    await host.setViewBounds('session-b', visibleBounds)
    expect(mainChildren).toEqual(new Set(created.map(item => item.view)))
    expect(hiddenChildren).toEqual(new Set())
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(false)
    expect(created[1].view.setVisible).toHaveBeenLastCalledWith(true)

    await host.disposeSession('session-a')
    expect(mainChildren).toEqual(new Set([created[1].view]))
    expect(hiddenChildren).toEqual(new Set())
    expect(created[0].contents.close).toHaveBeenCalledTimes(1)
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

  it('applies visible bounds while the same-session navigation is still unresolved', async () => {
    const { host, created } = sessionsHarness()
    await host.loadURL('session-a', 'first.example')
    let releaseNavigation!: () => void
    created[0].contents.loadURL.mockImplementationOnce(async url => {
      created[0].contents.url = url
      await new Promise<void>(resolve => { releaseNavigation = resolve })
      created[0].contents.emit('did-navigate', {}, url)
      created[0].contents.emit('did-stop-loading')
    })
    const slowNavigation = host.loadURL('session-a', 'still-slow.example')
    await vi.waitUntil(() => created[0].contents.loadURL.mock.calls.some(([url]) => url === 'https://still-slow.example'))

    const visibleBounds = { x: 10, y: 20, width: 500, height: 400, visible: true }
    await expect(host.setViewBounds('session-a', visibleBounds)).resolves.toBeUndefined()
    expect(created[0].view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 500, height: 400 })
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(true)
    expect(releaseNavigation).toBeTypeOf('function')

    releaseNavigation()
    await slowNavigation
  })

  it('destroys only the deleted session view and clears its storage ownership', async () => {
    const attached = new Set<BrowserViewLike>()
    const attach = vi.fn((view: BrowserViewLike, placement: boolean | 'detach') => {
      if (placement === 'detach') attached.delete(view)
      else attached.add(view)
    })
    const { host, created } = sessionsHarness(attach)
    await host.toolAction('session-a', { action: 'navigate', url: 'a.example' })
    await host.toolAction('session-b', { action: 'navigate', url: 'b.example' })
    expect(attached).toEqual(new Set(created.map(item => item.view)))
    await host.disposeSession('session-a')

    expect(attach).toHaveBeenCalledWith(created[0].view, 'detach')
    expect(attached).toEqual(new Set([created[1].view]))
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(false)
    expect(created[0].contents.stop).toHaveBeenCalledTimes(1)
    expect(created[0].contents.close).toHaveBeenCalledTimes(1)
    expect(created[0].contents.session.clearStorageData).toHaveBeenCalledTimes(1)
    expect(created[0].contents.session.clearCache).toHaveBeenCalledTimes(1)
    const detachIndex = attach.mock.calls.findIndex(([view, placement]) => view === created[0].view && placement === 'detach')
    expect(attach.mock.invocationCallOrder[detachIndex]).toBeLessThan(created[0].contents.session.clearStorageData.mock.invocationCallOrder[0])
    expect(created[0].contents.session.clearStorageData.mock.invocationCallOrder[0]).toBeLessThan(created[0].contents.close.mock.invocationCallOrder[0])
    expect(created[1].contents.close).not.toHaveBeenCalled()
    expect((await host.listTabs('session-b')).tabs[0].url).toBe('https://b.example')
  })

  it('does not re-present a session disposed while its bounds transition yields', async () => {
    const placements = new Map<BrowserViewLike, boolean>()
    const { host, created, createView } = sessionsHarness((view, placement) => {
      if (placement === 'detach') placements.delete(view)
      else placements.set(view, placement)
    })
    await host.toolAction('session-a', { action: 'navigate', url: 'a.example' })
    await host.toolAction('session-b', { action: 'navigate', url: 'b.example' })
    const visibleBounds = { x: 10, y: 20, width: 500, height: 400, visible: true }
    await host.setViewBounds('session-b', visibleBounds)
    expect(placements.get(created[1].view)).toBe(true)

    const presentingA = host.setViewBounds('session-a', visibleBounds)
    const disposingA = host.disposeSession('session-a')
    await Promise.all([presentingA, disposingA])

    expect(createView).toHaveBeenCalledTimes(2)
    expect(created[0].view.setBounds).not.toHaveBeenCalledWith({ x: 10, y: 20, width: 500, height: 400 })
    expect(placements.has(created[0].view)).toBe(false)
    expect(created[0].contents.close).toHaveBeenCalledTimes(1)

    await host.setViewBounds('session-c', visibleBounds)
    expect(createView).toHaveBeenCalledTimes(3)
    expect(placements.get(created[1].view)).toBe(false)
    expect(placements.get(created[2].view)).toBe(true)
    expect([...placements.values()].filter(Boolean)).toHaveLength(1)
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

describe('BrowserTabsHost crash and load failure recovery', () => {
  it('retires a failed view before retry and ignores its late events', async () => {
    const views: Array<{ contents: FakeWebContents; view: BrowserViewLike }> = []
    const attached = new Set<BrowserViewLike>()
    const attach = vi.fn((view: BrowserViewLike, placement: boolean | 'detach') => {
      if (placement === 'detach') attached.delete(view)
      else attached.add(view)
    })
    const createView = vi.fn(() => {
      const contents = new FakeWebContents()
      if (views.length === 0) {
        contents.loadURL.mockImplementationOnce(async url => {
          contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', url, true)
          throw new Error(`ERR_FAILED (-2) loading ${url}`)
        })
      }
      const view: BrowserViewLike = { webContents: contents, setBounds: vi.fn(), setVisible: vi.fn() }
      views.push({ contents, view })
      return view
    })
    const host = new BrowserTabsHost(createView)
    host.attachToWindow(attach)
    const errors: string[] = []
    host.subscribe(event => { if (event.type === 'error') errors.push(event.message) })
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await expect(host.loadURL('dead.example')).resolves.toMatchObject({ url: 'https://dead.example' })
    expect(createView).toHaveBeenCalledTimes(2)
    expect(views[0].contents.loadURL).toHaveBeenCalledTimes(1)
    expect(views[1].contents.loadURL).toHaveBeenCalledTimes(1)
    expect(views[0].view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    expect(views[0].view.setVisible).toHaveBeenLastCalledWith(false)
    expect(views[0].contents.stop).toHaveBeenCalledTimes(1)
    expect(views[0].contents.close).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledWith(views[0].view, 'detach')
    expect(attached).toEqual(new Set([views[1].view]))
    views[0].contents.emit('did-navigate', {}, 'https://late.example')
    views[0].contents.emit('render-process-gone')
    expect((await host.getActiveTab())?.url).toBe('https://dead.example')
    expect(views[0].contents.close).toHaveBeenCalledTimes(1)
    expect(attached).toEqual(new Set([views[1].view]))
    expect(errors.some(message => message.includes('ERR_FAILED'))).toBe(true)
  })

  it('rebuilds a fresh view after render-process-gone on the next visible show', async () => {
    const views: Array<{ contents: FakeWebContents; view: BrowserViewLike }> = []
    const attached = new Set<BrowserViewLike>()
    const attach = vi.fn((view: BrowserViewLike, placement: boolean | 'detach') => {
      if (placement === 'detach') attached.delete(view)
      else attached.add(view)
    })
    const createView = vi.fn(() => {
      const contents = new FakeWebContents()
      const view: BrowserViewLike = { webContents: contents, setBounds: vi.fn(), setVisible: vi.fn() }
      views.push({ contents, view })
      return view
    })
    const host = new BrowserTabsHost(createView)
    host.attachToWindow(attach)
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    expect(createView).toHaveBeenCalledTimes(1)
    views[0].contents.emit('render-process-gone')
    expect(views[0].contents.stop).toHaveBeenCalledTimes(1)
    expect(views[0].contents.close).toHaveBeenCalledTimes(1)
    expect(attached).toEqual(new Set())
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    expect(createView).toHaveBeenCalledTimes(2)
    expect(attached).toEqual(new Set([views[1].view]))
    views[0].contents.emit('render-process-gone')
    expect(views[0].contents.close).toHaveBeenCalledTimes(1)
    expect(attached).toEqual(new Set([views[1].view]))
  })

  it('keeps hidden tool DOM on the main-owned view without painting it', async () => {
    const { host, contents, view, attach } = browserHarness()
    const events: string[] = []
    host.subscribe(event => { if (event.type === 'reveal') events.push('reveal') })
    await host.loadURL('example.com')
    expect(events).toEqual(['reveal'])
    expect(contents.loadURL).toHaveBeenCalledWith('https://example.com')
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1280, height: 800 })
    expect(attach).toHaveBeenCalledWith(view, false)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    await expect(host.toolAction({ action: 'observe' })).resolves.toMatchObject({ ok: true, viewport: { width: 1280, height: 800 } })
    await expect(host.toolAction({ action: 'screenshot' })).resolves.toMatchObject({ ok: true })
    expect(contents.capturePage).toHaveBeenLastCalledWith(undefined, { stayHidden: true })
    const loads = contents.loadURL.mock.calls.length
    await host.setViewBounds({ x: 10, y: 20, width: 400, height: 300, visible: true })
    expect(attach).toHaveBeenCalledWith(view, true)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 400, height: 300 })
    expect(contents.loadURL.mock.calls.length).toBe(loads)
  })

  it('does not remove or re-add the main-owned view during navigation', async () => {
    const { host, contents, view, attach } = browserHarness()
    const visibleBounds = { x: 10, y: 20, width: 300, height: 400, visible: true }
    await host.setViewBounds(visibleBounds)
    expect(attach).toHaveBeenCalledTimes(1)
    await host.loadURL('one.example')
    expect(contents.loadURL).toHaveBeenCalledWith('https://one.example')
    expect(attach).toHaveBeenCalledTimes(1)
    const boundsCalls = vi.mocked(view.setBounds).mock.calls.length
    const visibleCalls = vi.mocked(view.setVisible!).mock.calls.length
    contents.emit('did-navigate', {}, 'https://one.example/after-commit')
    contents.emit('did-stop-loading')
    expect(attach).toHaveBeenCalledTimes(1)
    expect(view.setBounds).toHaveBeenCalledTimes(boundsCalls)
    expect(view.setVisible).toHaveBeenCalledTimes(visibleCalls)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 300, height: 400 })
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('emits did-fail-load errors only for main-frame non-aborted failures', async () => {
    const { host, contents } = browserHarness()
    const errors: string[] = []
    host.subscribe(event => { if (event.type === 'error') errors.push(event.message) })
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('fail.example')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://fail.example', true)
    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'https://iframe.example', false)
    expect(errors).toEqual([])
    contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'https://fail.example', true)
    expect(errors.some(message => message.includes('ERR_FAILED') && message.includes('https://fail.example'))).toBe(true)
    expect(contents.close).not.toHaveBeenCalled()
  })
})

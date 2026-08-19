import { describe, expect, it, vi } from 'vitest'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { BrowserSessionHost, BrowserTabsHost, BROWSER_HOST_TOOL_ACTIONS, browserDeviceEmulationFor, browserPartitionForSession, installBrowserNativeTrace, mountBrowserShellView, normalizeBrowserToolTarget, normalizeBrowserURL, parseBrowserSnapshotTarget, routeBrowserView, shouldOpenBrowserDevTools, withBrowserTabsHost, type BrowserViewLike } from './browser-host.js'
import { BROWSER_DEBUG_MAX_OUTPUT, BROWSER_SCRIPT_MAX_INPUT, remapScriptStack, safeSerialize, TabConsoleBuffer, truncateEnvelope } from './browser-debug.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROWSER_TOOL_DECLARED_ACTIONS } from '../../../../resources/runtime/extensions/pipiui-electron-webview.ts'

const webviewSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/runtime/extensions/pipiui-electron-webview.ts'), 'utf8')

class FakeWebContents {
  url = 'about:blank'
  pageText = ''
  viewport = { width: 0, height: 0 }
  zoomFactor = 1
  userAgent = 'DesktopUA'
  emulation?: { viewSize: { width: number; height: number }; screenPosition?: string }
  scroll = { x: 0, y: 0 }
  snapshotSeq = 0
  loadURLRejects?: string
  deferCommit = false
  waitReady = true
  scriptResult: Record<string, unknown> | undefined
  openDevTools = vi.fn()
  isDevToolsOpened = vi.fn(() => false)
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  loadURL = vi.fn(async (url: string) => {
    if (this.loadURLRejects) throw new Error(this.loadURLRejects)
    this.url = url
    this.emit('did-start-loading')
    if (!this.deferCommit) this.commitNavigation(url)
  })
  commitNavigation(url = this.url) {
    this.emit('did-navigate', {}, url)
    this.emit('page-title-updated', {}, `Title for ${url}`)
    this.emit('did-stop-loading')
  }
  reload = vi.fn(() => { void this.loadURL(this.url) })
  getURL = vi.fn(() => this.url)
  stop = vi.fn()
  executeJavaScript = vi.fn(async (code: string) => {
    if (code.includes('window.scrollX')) return { ...this.scroll }
    if (code.startsWith('window.scrollTo(')) {
      const [x, y] = code.slice('window.scrollTo('.length, -1).split(',').map(Number)
      this.scroll = { x, y }
      return undefined
    }
    if (code.includes('pipiui-browser-script')) return this.scriptResult ?? { ok: true, resultJson: JSON.stringify(this.pageText), steps: [] }
    if (code.includes('"action":"wait_check"')) return { ok: true, ready: this.waitReady }
    if (code.includes('__pipiBrowserDOM.dispatch')) {
      const snapshotID = `snap-${++this.snapshotSeq}`
      return { ok: true, url: this.url, text: this.pageText, snapshotID, viewport: { ...this.viewport }, elements: this.viewport.width > 0 ? [{ index: 0, token: `tok-${this.snapshotSeq}`, role: 'link', name: '热门视频' }] : [] }
    }
    return code.includes('document.documentElement.outerHTML') ? { title: `Title for ${this.url}`, url: this.url, content: this.pageText }
      : code.includes('querySelector') ? { ok: true } : this.pageText
  })
  capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from(`png-${this.pageText}-${this.viewport.width}x${this.viewport.height}`) }))
  close = vi.fn()
  isDestroyed = vi.fn(() => false)
  setZoomFactor = vi.fn((factor: number) => { this.zoomFactor = factor })
  getZoomFactor = vi.fn(() => this.zoomFactor)
  setUserAgent = vi.fn((userAgent: string) => { this.userAgent = userAgent })
  getUserAgent = vi.fn(() => this.userAgent)
  getOSProcessId = vi.fn(() => 1)
  enableDeviceEmulation = vi.fn((params: { viewSize: { width: number; height: number }; screenPosition?: string }) => {
    this.emulation = params
    this.viewport = { ...params.viewSize }
  })
  disableDeviceEmulation = vi.fn(() => { this.emulation = undefined })
  session = { clearStorageData: vi.fn(async () => undefined), clearCache: vi.fn(async () => undefined) }
  on(event: string, listener: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }
  off(event: string, listener: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? []
    this.listeners.set(event, listeners.filter(item => item !== listener))
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
      if (contents.emulation) return
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
        requested: expect.objectContaining({ x: 10, y: 20, width: 300, height: 400, visible: true, mode: 'desktop' })
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
    const attach = vi.fn()
    const host = new BrowserTabsHost(createView)
    host.attachToWindow(attach)
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    expect(createView).toHaveBeenCalledTimes(1)
    views[0].webContents = undefined
    await expect(host.loadURL('two.example')).resolves.toMatchObject({ url: 'https://two.example' })
    expect(createView).toHaveBeenCalledTimes(2)
    expect(attach).toHaveBeenCalledWith(views[0], 'detach', 'desktop', expect.any(Object))
    expect((await host.getActiveTab())?.url).toBe('https://two.example')
  })

  it('removes a destroyed WebContentsView from the native parent before adding its replacement', async () => {
    const mainChildren = new Set<BrowserViewLike>()
    const main = {
      contentView: {
        addChildView: (view: BrowserViewLike) => {
          if (!view.webContents || view.webContents.isDestroyed?.()) {
            throw new Error('addChildView of destroyed WebContentsView crashes natively')
          }
          for (const child of mainChildren) {
            if (!child.webContents || child.webContents.isDestroyed?.()) {
              throw new Error('addChildView walked a destroyed sibling WebContentsView')
            }
          }
          mainChildren.add(view)
        },
        removeChildView: (view: BrowserViewLike) => { mainChildren.delete(view) }
      }
    }
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
    host.attachToWindow((view, placement) => routeBrowserView(view, placement, main))
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    expect([...mainChildren]).toEqual([views[0]])

    views[0].webContents!.isDestroyed = vi.fn(() => true)
    views[0].webContents = undefined
    await expect(host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })).resolves.toBeDefined()
    expect(createView).toHaveBeenCalledTimes(2)
    expect(mainChildren.has(views[0])).toBe(false)
    expect([...mainChildren]).toEqual([views[1]])
  })

  it('detaches immediately when Chromium fires destroyed so a later addChildView cannot walk the dead sibling', async () => {
    const mainChildren = new Set<BrowserViewLike>()
    const main = {
      contentView: {
        addChildView: (view: BrowserViewLike) => {
          for (const child of mainChildren) {
            if (!child.webContents || child.webContents.isDestroyed?.()) {
              throw new Error('addChildView walked a destroyed sibling WebContentsView')
            }
          }
          mainChildren.add(view)
        },
        removeChildView: (view: BrowserViewLike) => { mainChildren.delete(view) }
      }
    }
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
    host.attachToWindow((view, placement) => routeBrowserView(view, placement, main))
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    views[0].webContents!.isDestroyed = vi.fn(() => true)
    views[0].webContents!.emit('destroyed')
    expect(mainChildren.has(views[0])).toBe(false)
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    expect(createView).toHaveBeenCalledTimes(2)
    expect([...mainChildren]).toEqual([views[1]])
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
    await expect(host.toolAction({ action: 'screenshot' })).resolves.toMatchObject({ ok: true, mimeType: 'image/png', viewport: 'desktop', width: 800, height: 600 })
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
    expect(attach).toHaveBeenCalledWith(view, true, 'desktop', expect.any(Object))
    expect(attach).toHaveBeenLastCalledWith(view, true, 'desktop', expect.any(Object))
    expect(attach).not.toHaveBeenCalledWith(view, false, 'desktop', expect.any(Object))
    expect(events[0]).toBe('reveal')
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
    expect(contents.loadURL).toHaveBeenCalledWith('https://bilibili.com')
    expect(contents.loadURL).not.toHaveBeenCalledWith('about:blank')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    const screenshot = await host.toolAction({ action: 'screenshot' })
    expect(Buffer.from(String(screenshot.base64), 'base64').byteLength).toBeGreaterThan(0)
    expect(attach).toHaveBeenLastCalledWith(view, true, 'desktop', expect.any(Object))
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
        setBounds: vi.fn(bounds => {
          if (!contents.emulation) contents.viewport = { width: bounds.width, height: bounds.height }
        }),
        setVisible: vi.fn()
      }
      created.push({ partition: options.webPreferences.partition, contents, view })
      return view
    })
    const host = new BrowserSessionHost(createView)
    host.attachToWindow((_sessionId, view, placement) => attach(view, placement))
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

  it('does not loadURL again when switching to another session and back', async () => {
    const { host, created } = sessionsHarness()
    const visibleBounds = { x: 10, y: 20, width: 500, height: 400, visible: true }
    await host.loadURL('session-a', 'a.example')
    await host.setViewBounds('session-a', visibleBounds)
    const loadsA = created[0].contents.loadURL.mock.calls.length
    expect(loadsA).toBeGreaterThan(0)

    await host.loadURL('session-b', 'b.example')
    await host.setViewBounds('session-b', visibleBounds)
    expect(created[0].contents.loadURL.mock.calls.length).toBe(loadsA)
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(false)

    await host.setViewBounds('session-a', visibleBounds)
    expect(created[0].contents.loadURL.mock.calls.length).toBe(loadsA)
    expect(created[0].view.setVisible).toHaveBeenLastCalledWith(true)
    expect(created[1].view.setVisible).toHaveBeenLastCalledWith(false)
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
    expect(attach).toHaveBeenCalledWith(views[0].view, 'detach', 'desktop', expect.any(Object))
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
    expect(attach).toHaveBeenCalledWith(view, false, 'desktop', expect.any(Object))
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    await expect(host.toolAction({ action: 'observe' })).resolves.toMatchObject({ ok: true, viewport: { width: 1280, height: 800 } })
    await expect(host.toolAction({ action: 'screenshot' })).resolves.toMatchObject({ ok: true })
    expect(contents.capturePage).toHaveBeenLastCalledWith(undefined, { stayHidden: true })
    const loads = contents.loadURL.mock.calls.length
    await host.setViewBounds({ x: 10, y: 20, width: 400, height: 300, visible: true })
    expect(attach).toHaveBeenCalledWith(view, true, 'desktop', expect.any(Object))
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 400, height: 300 })
    expect(contents.loadURL.mock.calls.length).toBe(loads)
  })

  it('does not loadURL again after hide then show of the same tab', async () => {
    const { host, contents, view } = browserHarness()
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('stay.example')
    const loads = contents.loadURL.mock.calls.length
    expect(loads).toBe(1)

    await host.setViewBounds({ x: 0, y: 0, width: 0, height: 0, visible: false })
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1280, height: 800 })
    expect(contents.loadURL.mock.calls.length).toBe(loads)

    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    expect(contents.loadURL.mock.calls.length).toBe(loads)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 300, height: 400 })
  })

  it('still loads when switching tabs or navigating explicitly', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 10, y: 20, width: 300, height: 400, visible: true })
    await host.loadURL('one.example')
    const afterFirst = contents.loadURL.mock.calls.length
    const first = (await host.getActiveTab())!
    await host.newTab()
    expect(contents.loadURL.mock.calls.length).toBeGreaterThan(afterFirst)
    const afterNew = contents.loadURL.mock.calls.length
    await host.switchTab(first.id)
    expect(contents.loadURL.mock.calls.length).toBeGreaterThan(afterNew)
    expect(contents.loadURL).toHaveBeenLastCalledWith('https://one.example')
    const afterSwitch = contents.loadURL.mock.calls.length
    await host.loadURL('two.example')
    expect(contents.loadURL.mock.calls.length).toBeGreaterThan(afterSwitch)
    expect(contents.loadURL).toHaveBeenLastCalledWith('https://two.example')
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

function asBounds(value: Record<string, unknown>) {
  return value as import('@pipi/host-api').BrowserViewBounds
}
function asRequest(value: Record<string, unknown>) {
  return value as import('@pipi/host-api').BrowserToolRequest
}

function multiViewHarness() {
  const created: Array<{ partition?: string; contents: FakeWebContents; view: BrowserViewLike }> = []
  const createView = vi.fn((options: { webPreferences: { partition?: string } }) => {
    const contents = new FakeWebContents()
    let nativeBounds = { x: 0, y: 0, width: 0, height: 0 }
    let nativeVisible = false
    const view: BrowserViewLike = {
      webContents: contents,
      setBounds: vi.fn(bounds => {
        nativeBounds = { ...bounds }
        if (!contents.emulation) contents.viewport = { width: bounds.width, height: bounds.height }
      }),
      getBounds: () => ({ ...nativeBounds }),
      setVisible: vi.fn(visible => { nativeVisible = visible }),
      getVisible: () => nativeVisible
    }
    created.push({ partition: options.webPreferences.partition, contents, view })
    return view
  })
  const attach = vi.fn()
  const host = new BrowserTabsHost(createView)
  host.attachToWindow(attach)
  return { host, created, createView, attach }
}

describe('BrowserTabsHost dual viewport',
  () => {
    it('opens a real mobile child view without changing the desktop slot', async () => {
      const { host, created } = multiViewHarness()
      const attach = vi.fn((_view: BrowserViewLike, placement: unknown, kind?: string) => kind === 'mobile' && placement === true
        ? { x: 0, y: 0, width: 393, height: 720 }
        : undefined)
      host.attachToWindow(attach)
      await host.setViewBounds(asBounds({
        x: 500, y: 80, width: 700, height: 640, visible: true, mode: 'desktop',
        mobileOverlay: { visible: false, deviceId: 'iphone-14-pro', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 }
      }))
      const desktop = created[0].view.setBounds as ReturnType<typeof vi.fn>
      const desktopBounds = desktop.mock.calls.at(-1)?.[0]

      await host.setViewBounds(asBounds({
        x: 500, y: 80, width: 700, height: 640, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, deviceId: 'iphone-14-pro', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 }
      }))

      expect(created).toHaveLength(2)
      expect(desktop.mock.calls.at(-1)?.[0]).toEqual(desktopBounds)
      expect(attach).toHaveBeenCalledWith(created[1].view, true, 'mobile', expect.objectContaining({ deviceId: 'iphone-14-pro' }))
      expect(created[0].contents.setZoomFactor).toHaveBeenLastCalledWith(1)
      expect(created[0].contents.enableDeviceEmulation).not.toHaveBeenCalled()
      expect(created[1].view.getBounds?.()).toEqual({ x: 0, y: 0, width: 393, height: 720 })
      expect(created[1].contents.enableDeviceEmulation).toHaveBeenCalledWith(expect.objectContaining({
        screenPosition: 'mobile',
        viewSize: { width: 393, height: 852 },
        deviceScaleFactor: 3
      }))
    })

    it('resizes and closes only the mobile child view', async () => {
      const { host, created } = multiViewHarness()
      const attach = vi.fn((_view: BrowserViewLike, placement: unknown, kind?: string) => kind === 'mobile' && placement === true
        ? { x: 0, y: 0, width: 390, height: 700 }
        : undefined)
      host.attachToWindow(attach)
      const events: any[] = []
      host.subscribe(event => events.push(event))
      await host.setViewBounds(asBounds({
        x: 500, y: 80, width: 700, height: 640, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
      }))
      const desktop = created[0].view.setBounds as ReturnType<typeof vi.fn>
      const desktopCalls = desktop.mock.calls.length

      host.mobileWindowResized({ width: 430, height: 760 })
      expect(desktop).toHaveBeenCalledTimes(desktopCalls)
      expect(created[1].view.getBounds?.()).toEqual({ x: 0, y: 0, width: 430, height: 760 })

      host.mobileWindowClosed()
      expect(attach).toHaveBeenCalledWith(created[1].view, false, 'mobile', expect.any(Object))
      expect(events).toContainEqual(expect.objectContaining({ type: 'mobile-window', open: false }))
      expect(desktop).toHaveBeenCalledTimes(desktopCalls)
    })

    it('fills the desktop surface at zoom 1 without device emulation', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 900, y: 80, width: 368, height: 640, visible: true, mode: 'desktop' }))
      expect(createViewCalls(created)).toBe(1)
      expect(created[0].view.setBounds).toHaveBeenCalledWith({ x: 900, y: 80, width: 368, height: 640 })
      expect(created[0].contents.setZoomFactor).toHaveBeenCalledWith(1)
      expect(created[0].contents.enableDeviceEmulation).not.toHaveBeenCalled()
      await host.loadURL('example.com')
      expect(created[0].contents.enableDeviceEmulation).not.toHaveBeenCalled()
      expect(created[0].contents.setZoomFactor).toHaveBeenLastCalledWith(1)
      await expect(host.toolAction({ action: 'observe' })).resolves.toMatchObject({
        ok: true,
        viewport: { width: 368, height: 640 },
        viewportTarget: 'desktop'
      })
    })

    it('does not enableDeviceEmulation after the pane is detached from the window', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 900, y: 80, width: 368, height: 640, visible: true, mode: 'desktop' }))
      created[0].contents.enableDeviceEmulation.mockClear()
      await host.setViewBounds(asBounds({ x: 900, y: 80, width: 368, height: 640, visible: false, mode: 'desktop' }))
      expect(created[0].contents.enableDeviceEmulation).not.toHaveBeenCalled()
    })

    it('does not enableDeviceEmulation on first present before the renderer has a widget', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 900, y: 80, width: 368, height: 640, visible: true, mode: 'desktop' }))
      expect(created[0].contents.enableDeviceEmulation).not.toHaveBeenCalled()
    })

    it('keeps desktop as the default target and addresses the real mobile page independently', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 900, y: 80, width: 368, height: 640, visible: true, mode: 'desktop',
        slots: { mobile: { x: 920, y: 120, width: 200, height: 400 } },
        mobileOverlay: { visible: true, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: 'MobileUA' }
      }))
      expect(created).toHaveLength(2)
      await host.loadURL('example.com')
      await expect(host.toolAction({ action: 'observe' })).resolves.toMatchObject({
        ok: true,
        viewport: { width: 368, height: 640 },
        viewportTarget: 'desktop'
      })
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))).resolves.toMatchObject({
        ok: true,
        viewport: { width: 390, height: 844 },
        viewportTarget: 'mobile'
      })
      expect(created[1].contents.enableDeviceEmulation).toHaveBeenCalledWith(expect.objectContaining({
        screenPosition: 'mobile',
        viewSize: { width: 390, height: 844 },
        deviceScaleFactor: 2
      }))
      expect(created[0].contents.userAgent).toBe('DesktopUA')
      expect(created[1].contents.userAgent).toBe('MobileUA')
      expect(created[1].contents.emulation).toBeDefined()
    })

    it('loads desktop and mobile pages in the same partition and on the same tab URL', async () => {
      const { host, created, createView } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', slots: {
        desktop: { x: 10, y: 20, width: 700, height: 500 },
        mobile: { x: 440, y: 40, width: 250, height: 460 }
      }, mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('example.com')
      expect(createView).toHaveBeenCalledTimes(2)
      expect(created[0].partition).toBe('persist:pipiui-browser')
      expect(created[1].partition).toBe(created[0].partition)
      expect(created.map(item => item.contents.url)).toEqual(['https://example.com', 'https://example.com'])
      expect(created.every(item => item.contents.loadURL.mock.calls.length === 1)).toBe(true)
      expect(created.every(item => vi.mocked(item.view.setVisible!).mock.lastCall?.[0] === true)).toBe(true)
      expect(created[0].contents.emulation).toBeUndefined()
      expect(created[1].contents.emulation).toBeDefined()
    })

    it('synchronizes tab navigation across the two real pages', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('one.example')
      await host.loadURL('two.example')
      expect(created.map(item => item.contents.url)).toEqual(['https://two.example', 'https://two.example'])
      await host.goBack()
      expect(created.map(item => item.contents.url)).toEqual(['https://one.example', 'https://one.example'])
      created[0].contents.emit('did-navigate', {}, 'https://clicked.example')
      await vi.waitFor(() => expect(created[1].contents.url).toBe('https://clicked.example'))
      expect((await host.getActiveTab())?.url).toBe('https://clicked.example')
    })

    it('keeps both responsive pages on campaign detail after their shared persistence refresh seam', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('state.example')
      expect(created).toHaveLength(2)
      const persisted = { campaign: 'campaign-list' }
      for (const page of created) page.contents.pageText = persisted.campaign
      const desktopExecute = created[0].contents.executeJavaScript.getMockImplementation()!
      created[0].contents.executeJavaScript.mockImplementation(async code => {
        if (code.includes('"action":"click"')) {
          persisted.campaign = 'campaign-detail'
          created[0].contents.pageText = persisted.campaign
        }
        return desktopExecute(code)
      })

      const desktop = await host.toolAction(asRequest({ action: 'observe', target: 'desktop' }))
      await host.toolAction(asRequest({ action: 'click', target: 'desktop', snapshot_id: String(desktop.snapshotID), element_index: 0 }))
      // chatrpgv4 refreshes canonical backend state on visibility/focus and
      // during its polling seam; both real pages then materialize that state.
      for (const page of created) page.contents.pageText = persisted.campaign
      const both = await host.toolAction(asRequest({ action: 'observe', target: 'both' }))

      expect(new Set(created.map(item => item.contents.url))).toEqual(new Set(['https://state.example']))
      expect(both.desktop).toMatchObject({ text: 'campaign-detail', viewportTarget: 'desktop', viewport: { width: 700, height: 500 } })
      expect(both.mobile).toMatchObject({ text: 'campaign-detail', viewportTarget: 'mobile', viewport: { width: 390, height: 844 } })
      expect(created.every(item => item.contents.loadURL.mock.calls.some(([url]) => url === 'https://state.example'))).toBe(true)
    })

    it('keeps desktop bounds, zoom, visibility, URL, and scroll unchanged by mobile tools', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 40, y: 60, width: 720, height: 540, visible: true, mode: 'desktop', mobileOverlay: { visible: false, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, userAgent: 'MobileUA', deviceScaleFactor: 2 } }))
      await host.loadURL('restore.example')
      const desktop = created[0]
      desktop.contents.scroll = { x: 12, y: 34 }
      const tabBefore = await host.getActiveTab()
      const desktopBounds = desktop.view.getBounds?.()
      const desktopBoundsCalls = vi.mocked(desktop.view.setBounds).mock.calls.length

      await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile', viewport: { width: 390, height: 844 } })
      expect(created).toHaveLength(2)
      expect(desktop.view.getBounds?.()).toEqual(desktopBounds)
      expect(vi.mocked(desktop.view.setBounds)).toHaveBeenCalledTimes(desktopBoundsCalls)
      expect(desktop.view.getVisible?.()).toBe(true)
      expect(desktop.contents.zoomFactor).toBe(1)
      expect(desktop.contents.userAgent).toBe('DesktopUA')
      expect(desktop.contents.emulation).toBeUndefined()
      expect(desktop.contents.scroll).toEqual({ x: 12, y: 34 })
      expect(await host.getActiveTab()).toEqual(tabBefore)
      expect(desktop.contents.url).toBe('https://restore.example')
    })

    it('routes mobile mutations to the real mobile page and converges through shared persistence refresh', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 20, y: 30, width: 680, height: 520, visible: true, mode: 'desktop', mobileOverlay: { visible: false, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } }))
      await host.loadURL('mutate.example')
      const mobile = await host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))
      expect(created).toHaveLength(2)
      const persisted = { campaign: 'campaign-list' }
      for (const page of created) page.contents.pageText = persisted.campaign
      const mobileExecute = created[1].contents.executeJavaScript.getMockImplementation()!
      created[1].contents.executeJavaScript.mockImplementation(async code => {
        if (code.includes('"action":"click"')) {
          persisted.campaign = 'campaign-detail-from-mobile'
          created[1].contents.pageText = persisted.campaign
        }
        return mobileExecute(code)
      })

      await expect(host.toolAction(asRequest({ action: 'click', target: 'mobile', snapshot_id: String(mobile.snapshotID), element_index: 0 })))
        .resolves.toMatchObject({ ok: true, text: 'campaign-detail-from-mobile', viewportTarget: 'mobile' })
      expect(created[0].contents.pageText).toBe('campaign-list')
      created[0].contents.pageText = persisted.campaign
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }))).resolves.toMatchObject({
        ok: true,
        text: 'campaign-detail-from-mobile',
        viewportTarget: 'desktop',
        viewport: { width: 680, height: 520 }
      })
      expect(created).toHaveLength(2)
    })

    it('keeps the real mobile page available after its native window closes', async () => {
      const { host, created, createView } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('stay.example')
      const loads = created.map(item => item.contents.loadURL.mock.calls.length)
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 368, height: 640, visible: true, mode: 'desktop',
        mobileOverlay: { visible: false, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
      }))
      expect(createView).toHaveBeenCalledTimes(2)
      expect(created[0].view.setVisible).toHaveBeenLastCalledWith(true)
      expect(created[1].view.setVisible).toHaveBeenLastCalledWith(false)
      expect(created.map(item => item.contents.loadURL.mock.calls.length)).toEqual(loads)
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))).resolves.toMatchObject({
        ok: true,
        viewport: { width: 390, height: 844 },
        viewportTarget: 'mobile'
      })
      expect(created.map(item => item.contents.url)).toEqual(['https://stay.example', 'https://stay.example'])
    })

    it('reloads only the visible desktop page after the mobile child window closes', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, applyDeviceEmulation: true }
      }))
      await host.loadURL('refresh.example')
      created[0].contents.pageText = 'Pi Keeper desktop'
      created[1].contents.pageText = 'Pi Keeper mobile campaign detail'
      host.mobileWindowClosed()
      const desktopBounds = created[0].view.getBounds?.()
      const desktopReloads = created[0].contents.reload.mock.calls.length
      const hiddenMobileReloads = created[1].contents.reload.mock.calls.length

      await host.reload()

      expect(created[0].contents.reload.mock.calls.length).toBe(desktopReloads + 1)
      expect(created[1].contents.reload.mock.calls.length).toBe(hiddenMobileReloads)
      expect(created[0].view.getVisible?.()).toBe(true)
      expect(created[0].view.getBounds?.()).toEqual(desktopBounds)
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }))).resolves.toMatchObject({
        ok: true,
        text: 'Pi Keeper desktop',
        viewportTarget: 'desktop',
        viewport: { width: 700, height: 500 }
      })
    })

    it('does not change the desktop slot on mobile child-window resize updates', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        slots: { mobile: { x: 40, y: 40, width: 200, height: 400 } },
        mobileOverlay: { visible: true, applyDeviceEmulation: true }
      }))
      const desktopBounds = created[0].view.getBounds?.()
      for (const width of [210, 220, 230]) {
        await host.setViewBounds(asBounds({
          x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
          slots: { mobile: { x: 50, y: 50, width, height: 420 } },
          mobileOverlay: { visible: true, applyDeviceEmulation: false }
        }))
      }
      expect(created).toHaveLength(2)
      expect(created[0].view.getBounds?.()).toEqual(desktopBounds)
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        slots: { mobile: { x: 50, y: 50, width: 240, height: 420 } },
        mobileOverlay: { visible: true, applyDeviceEmulation: true }
      }))
      expect(created[0].view.getBounds?.()).toEqual(desktopBounds)
    })

    it('uses full device emulation only on the mobile page', async () => {
      const { host, created } = multiViewHarness()
      host.attachToWindow((_view, placement, kind) => kind === 'mobile' && placement === true
        ? { x: 0, y: 0, width: 195, height: 422 }
        : undefined)
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 }
      }))
      await host.loadURL('scale.example')
      expect(created[1].contents.enableDeviceEmulation).toHaveBeenCalledWith(expect.objectContaining({
        viewSize: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        scale: 0.5
      }))
      expect(created[0].contents.zoomFactor).toBe(1)
      expect(created[0].contents.emulation).toBeUndefined()
      expect(created[1].contents.zoomFactor).toBe(1)
    })

    it('reloads only the mobile page when the device preset changes', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        slots: { mobile: { x: 440, y: 40, width: 250, height: 460 } },
        mobileOverlay: { visible: true, applyDeviceEmulation: true, userAgent: 'PhoneA', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
      }))
      await host.loadURL('device.example')
      const desktopReloads = created[0].contents.reload.mock.calls.length
      const mobileReloads = created[1].contents.reload.mock.calls.length
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        slots: { mobile: { x: 440, y: 40, width: 250, height: 460 } },
        mobileOverlay: { visible: true, applyDeviceEmulation: true, userAgent: 'PhoneB', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 }
      }))
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))).resolves.toMatchObject({ viewport: { width: 412, height: 915 } })
      expect(created[1].contents.setUserAgent).toHaveBeenCalledWith('PhoneB')
      expect(created[0].contents.reload.mock.calls.length).toBe(desktopReloads)
      expect(created[1].contents.reload.mock.calls.length).toBe(mobileReloads + 1)
      expect(created[0].contents.url).toBe('https://device.example')
      expect(created[1].contents.url).toBe('https://device.example')
      expect(created).toHaveLength(2)
    })

    it('captures a hidden mobile page without showing or changing the desktop page', async () => {
      const { host, created, attach } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, applyDeviceEmulation: true }
      }))
      await host.loadURL('stack.example')
      expect(attach).toHaveBeenCalledWith(created[1].view, true, 'mobile', expect.any(Object))
      expect(attach.mock.calls.some(call => call[1] === 'raise')).toBe(false)
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        mobileOverlay: { visible: false, applyDeviceEmulation: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
      }))
      await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))).resolves.toMatchObject({
        ok: true,
        viewportTarget: 'mobile',
        viewport: { width: 390, height: 844 }
      })
      const desktopBounds = created[0].view.getBounds?.()
      const desktopVisibilityCallsBeforeCapture = vi.mocked(created[0].view.setVisible!).mock.calls.length
      const mobileVisibilityCallsBeforeCapture = vi.mocked(created[1].view.setVisible!).mock.calls.length
      created[1].contents.capturePage.mockImplementation(async (_rect?: import('@pipi/host-api').BrowserViewBounds, options?: { stayHidden?: boolean }) => ({
        toPNG: () => options?.stayHidden === false
          && vi.mocked(created[1].view.setVisible!).mock.calls.at(-1)?.[0] === true
          ? Buffer.from('mobile-png')
          : undefined as unknown as Buffer
      }))
      await expect(host.toolAction(asRequest({ action: 'screenshot', target: 'both' }))).resolves.toMatchObject({ ok: true })
      expect(created[1].contents.capturePage).toHaveBeenLastCalledWith(undefined, { stayHidden: false })
      expect(vi.mocked(created[1].view.setVisible!).mock.calls.slice(mobileVisibilityCallsBeforeCapture)).toEqual([[true], [false]])
      expect(vi.mocked(created[0].view.setVisible!)).toHaveBeenCalledTimes(desktopVisibilityCallsBeforeCapture)
      expect(created[0].view.setVisible).toHaveBeenLastCalledWith(true)
      expect(created[0].view.getBounds?.()).toEqual(desktopBounds)
      expect(created).toHaveLength(2)
    })

    it('scopes snapshots to one viewport and rejects mixed or both interactive use', async () => {
      const { host } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('form.example')
      const desktop = await host.toolAction(asRequest({ action: 'observe', target: 'desktop' }))
      const mobile = await host.toolAction(asRequest({ action: 'observe', target: 'mobile' }))
      expect(desktop.snapshotID).toMatch(/^desktop:/)
      expect(mobile.snapshotID).toMatch(/^mobile:/)
      const desktopToken = (desktop.elements as Array<{ token?: string }>)[0]?.token
      const mobileToken = (mobile.elements as Array<{ token?: string }>)[0]?.token
      expect(desktopToken).toMatch(/^desktop:/)
      expect(mobileToken).toMatch(/^mobile:/)
      await expect(host.toolAction(asRequest({
        action: 'click',
        snapshot_id: String(mobile.snapshotID),
        element_index: 0
      }))).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile' })
      await expect(host.toolAction(asRequest({
        action: 'click',
        target: 'desktop',
        snapshot_id: String(mobile.snapshotID),
        element_index: 0
      }))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('belongs to mobile') })
      await expect(host.toolAction(asRequest({
        action: 'click',
        snapshot_id: String(desktop.snapshotID),
        element_token: String(mobileToken)
      }))).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/belongs to desktop|cannot be used on mobile/) })
      await expect(host.toolAction(asRequest({
        action: 'click',
        target: 'mobile',
        snapshot_id: String(desktop.snapshotID),
        element_index: 0
      }))).resolves.toMatchObject({ ok: false, error: expect.stringContaining('belongs to desktop') })
      await expect(host.toolAction(asRequest({ action: 'click', target: 'both', snapshot_id: String(desktop.snapshotID), element_index: 0 })))
        .resolves.toMatchObject({ ok: false, error: expect.stringContaining('both') })
      await expect(host.toolAction(asRequest({ action: 'eval', target: 'both', js: '1' })))
        .resolves.toMatchObject({ ok: false, error: expect.stringContaining('specify target=desktop or target=mobile') })
    })

    it('detaches and closes both real pages when the window owner is rebound', async () => {
      const oldChildren = new Set<BrowserViewLike>()
      const newChildren = new Set<BrowserViewLike>()
      const oldWindow = {
        contentView: {
          addChildView: (view: BrowserViewLike) => { oldChildren.add(view) },
          removeChildView: (view: BrowserViewLike) => { oldChildren.delete(view) }
        }
      }
      const newWindow = {
        contentView: {
          addChildView: (view: BrowserViewLike) => { newChildren.add(view) },
          removeChildView: (view: BrowserViewLike) => { newChildren.delete(view) }
        }
      }
      const created: Array<{ contents: FakeWebContents; view: BrowserViewLike }> = []
      const createView = vi.fn(() => {
        const contents = new FakeWebContents()
        const view: BrowserViewLike = {
          webContents: contents,
          setBounds: vi.fn(),
          setVisible: vi.fn()
        }
        created.push({ contents, view })
        return view
      })
      const host = new BrowserTabsHost(createView)
      const oldAttach = vi.fn((view: BrowserViewLike, placement: any, kind: string) => {
        routeBrowserView(view, placement, oldWindow)
      })
      host.attachToWindow(oldAttach)
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      await host.loadURL('keep.example')
      expect(created).toHaveLength(2)
      expect(oldChildren.size).toBe(2)
      expect(created[0].contents.close).not.toHaveBeenCalled()
      expect(created[1].contents.close).not.toHaveBeenCalled()

      host.attachToWindow((view, placement, kind) => {
        routeBrowserView(view, placement, newWindow)
      })
      expect(created[0].contents.close).toHaveBeenCalledTimes(1)
      expect(created[1].contents.close).toHaveBeenCalledTimes(1)
      expect(created[0].contents.stop).toHaveBeenCalled()
      expect(created[1].contents.stop).toHaveBeenCalled()
      expect(oldChildren.size).toBe(0)
      expect(newChildren.size).toBe(0)

      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop', mobileOverlay: { visible: true, applyDeviceEmulation: true } }))
      expect(createView).toHaveBeenCalledTimes(4)
      expect(oldChildren.size).toBe(0)
      expect(newChildren.size).toBe(2)
      expect(created[0].contents.close).toHaveBeenCalledTimes(1)
      expect(created[1].contents.close).toHaveBeenCalledTimes(1)
    })

    it('returns two labeled screenshots for target=both and keeps single-target shape', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({ x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop' }))
      await host.loadURL('shot.example')
      expect(created).toHaveLength(1)
      created[0].contents.pageText = 'desktop-state'
      const single = await host.toolAction({ action: 'screenshot' })
      expect(single).toMatchObject({ ok: true, mimeType: 'image/png', viewport: 'desktop' })
      expect(single.images).toBeUndefined()
      expect(String(single.base64).length).toBeGreaterThan(0)
      const both = await host.toolAction(asRequest({ action: 'screenshot', target: 'both' }))
      expect(created).toHaveLength(2)
      created[1].contents.pageText = 'mobile-state'
      const refreshedBoth = await host.toolAction(asRequest({ action: 'screenshot', target: 'both' }))
      expect(both.ok).toBe(true)
      expect(refreshedBoth.base64).toBeUndefined()
      const images = Array.isArray(refreshedBoth.images) ? refreshedBoth.images as Array<{ viewport?: string; base64?: string; mimeType?: string; width?: number; height?: number }> : []
      expect(images).toEqual([
        expect.objectContaining({ viewport: 'desktop', mimeType: 'image/png', width: 700, height: 500 }),
        expect.objectContaining({ viewport: 'mobile', mimeType: 'image/png', width: 390, height: 844 })
      ])
      expect(images[0]?.base64).not.toBe(images[1]?.base64)
      expect(Buffer.from(String(images[0]?.base64), 'base64').toString()).toContain('desktop-state')
      expect(Buffer.from(String(images[1]?.base64), 'base64').toString()).toContain('mobile-state')
      expect(created[0].view.getBounds?.()).toEqual({ x: 10, y: 20, width: 700, height: 500 })
      expect(created[0].contents.url).toBe('https://shot.example')
    })

    it('treats omitted target as active and accepts a legacy request object', async () => {
      const { host } = multiViewHarness()
      await host.setViewBounds({ x: 10, y: 20, width: 368, height: 640, visible: true })
      await expect(host.toolAction({ action: 'observe' })).resolves.toMatchObject({ ok: true, viewportTarget: 'desktop', viewport: { width: 368, height: 640 } })
      expect(normalizeBrowserToolTarget(undefined)).toBe('active')
      expect(parseBrowserSnapshotTarget('legacy-id')).toEqual({ id: 'legacy-id' })
      expect(browserDeviceEmulationFor('desktop', { width: 368, height: 640 })).toMatchObject({ viewSize: { width: 368, height: 640 }, scale: 1 })
      const mobile = browserDeviceEmulationFor('mobile', { width: 200, height: 400 }, { width: 390, height: 844, deviceScaleFactor: 2 })
      expect(mobile.viewSize).toEqual({ width: 390, height: 844 })
      expect(mobile.scale).toBeCloseTo(Math.min(200 / 390, 400 / 844))
    })
  })

function createViewCalls(created: Array<unknown>): number {
  return created.length
}

describe('browser debug actions', () => {
  it('keeps HELP/schema advertised actions aligned with the host dispatcher', async () => {
    const advertised = BROWSER_TOOL_DECLARED_ACTIONS.filter(action => action !== 'help')
    expect([...advertised].sort()).toEqual([...BROWSER_HOST_TOOL_ACTIONS].sort())
    const descriptionMatch = webviewSource.match(/actions: ([^.]+)\./)
    expect(descriptionMatch?.[1].split(/,\s*/).map(item => item.trim()).filter(item => item && item !== 'help').sort()).toEqual([...BROWSER_HOST_TOOL_ACTIONS].sort())
    expect(webviewSource).toMatch(/script \{js\}/)
    expect(webviewSource).toMatch(/timeout is seconds \(default 5, max 25\)/)
    expect(webviewSource).toContain('console {clear?, since_seq?')
    expect(webviewSource).toMatch(/maximum: 25/)
    expect(webviewSource).toContain('case "script"')
    const { host } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await expect(host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.05 })).resolves.not.toMatchObject({ error: expect.stringContaining('unknown browser action') })
    await expect(host.toolAction({ action: 'console' })).resolves.toMatchObject({ ok: true })
    await expect(host.toolAction({ action: 'script', js: 'return 1' })).resolves.toMatchObject({ ok: true, schemaVersion: 1 })
  })

  it('returns structured script success, errors with remapped stack/steps, and stale tokens', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    contents.scriptResult = { ok: true, resultJson: JSON.stringify({ n: 2 }), steps: [{ label: 'ready', t: 1 }], lastStep: 'ready' }
    await expect(host.toolAction({ action: 'script', js: 'step("ready"); return { n: 2 }', requestID: 'req-1' } as any)).resolves.toMatchObject({
      ok: true, requestId: 'req-1', action: 'script', lastStep: 'ready'
    })
    contents.scriptResult = {
      ok: false,
      code: 'script_error',
      error: 'boom',
      stack: 'Error: boom\n    at __pipiUser (pipiui-browser-script-req-2.js:20:5)',
      sourceURL: 'pipiui-browser-script-req-2.js',
      headerLines: 16,
      steps: [{ label: 'before', t: 1 }],
      lastStep: 'before',
    }
    const failed = await host.toolAction({ action: 'script', js: 'step("before"); throw new Error("boom")', requestID: 'req-2' } as any)
    expect(failed).toMatchObject({ ok: false, code: 'script_error', lastStep: 'before', line: 4, partialSideEffects: true })
    contents.scriptResult = { ok: false, code: 'stale_snapshot', error: 'The requested element is no longer connected; observe again.', steps: [] }
    await expect(host.toolAction({ action: 'script', js: 'return el("missing")' })).resolves.toMatchObject({ ok: false, code: 'stale_snapshot' })
  })

  it('rejects oversized script input and marks oversized results truncated', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await expect(host.toolAction({ action: 'script', js: 'x'.repeat(BROWSER_SCRIPT_MAX_INPUT + 1) })).resolves.toMatchObject({ ok: false, code: 'invalid_input' })
    contents.scriptResult = { ok: true, resultJson: `"${'y'.repeat(30_000)}"`, truncated: true }
    await expect(host.toolAction({ action: 'script', js: 'return "big"' })).resolves.toMatchObject({ ok: true, truncated: true })
  })

  it('waits until wait_check is ready and times out with a structured code', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    contents.waitReady = true
    await expect(host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.2 })).resolves.toMatchObject({ ok: true, ready: true })
    contents.waitReady = false
    await expect(host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.05 })).resolves.toMatchObject({ ok: false, code: 'timeout' })
  })

  it('isolates console buffers per virtual tab and supports cursor/clear/caps', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('one.example')
    const first = (await host.getActiveTab())!
    contents.emit('console-message', { level: 'error', message: 'a1', lineNumber: 1, sourceId: 'a.js' })
    const second = await host.newTab({ url: 'two.example' })
    contents.emit('console-message', { level: 'warn', message: 'b1', lineNumber: 2, sourceId: 'b.js' })
    const onSecond = await host.toolAction({ action: 'console' })
    expect(onSecond.logs).toEqual(expect.arrayContaining([expect.stringContaining('b1')]))
    expect(String(onSecond.logs)).not.toContain('a1')
    await host.switchTab(first.id)
    const onFirst = await host.toolAction({ action: 'console', since_seq: 0 } as any)
    expect(String(onFirst.logs)).toContain('a1')
    expect(String(onFirst.logs)).not.toContain('b1')
    const cleared = await host.toolAction({ action: 'console', clear: true })
    expect(cleared.ok).toBe(true)
    await expect(host.toolAction({ action: 'console' })).resolves.toMatchObject({ logs: [] })
    expect(contents.listeners.get('console-message')).toHaveLength(1)
    expect(second.id).not.toBe(first.id)
  })

  it('keeps late console-message on the committed document owner until the next main-frame commit', async () => {
    const { host, contents, attach } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('one.example')
    const first = (await host.getActiveTab())!
    contents.emit('console-message', { level: 'error', message: 'old-page', lineNumber: 1, sourceId: 'a.js' })
    contents.deferCommit = true
    const second = await host.newTab({ url: 'two.example' })
    contents.emit('console-message', { level: 'warn', message: 'late-old', lineNumber: 2, sourceId: 'a.js' })
    const onSecondBeforeCommit = await host.toolAction({ action: 'console' })
    expect(String(onSecondBeforeCommit.logs ?? [])).not.toContain('late-old')
    expect(String(onSecondBeforeCommit.logs ?? [])).not.toContain('old-page')
    contents.deferCommit = false
    contents.commitNavigation('https://two.example')
    contents.emit('console-message', { level: 'info', message: 'new-page', lineNumber: 3, sourceId: 'b.js' })
    const onSecond = await host.toolAction({ action: 'console' })
    expect(String(onSecond.logs)).toContain('new-page')
    expect(String(onSecond.logs)).not.toContain('late-old')
    await host.switchTab(first.id)
    const onFirst = await host.toolAction({ action: 'console' })
    expect(String(onFirst.logs)).toContain('old-page')
    expect(String(onFirst.logs)).toContain('late-old')
    expect(String(onFirst.logs)).not.toContain('new-page')
    await host.dispose()
    host.attachToWindow(attach)
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('three.example')
    const afterDispose = await host.toolAction({ action: 'console' })
    expect(afterDispose.logs ?? []).toEqual([])
    expect(second.id).not.toBe(first.id)
  })

  it('does not attribute an in-flight script to a later navigation or recreated view', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('one.example')
    let release!: (value: unknown) => void
    contents.executeJavaScript.mockImplementationOnce(async (code: string) => {
      if (!code.includes('pipiui-browser-script')) return { ok: true, ready: true }
      return await new Promise(resolve => { release = resolve })
    })
    const pending = host.toolAction({ action: 'script', js: 'return 1' })
    await vi.waitUntil(() => release !== undefined)
    await host.loadURL('two.example')
    release({ ok: true, resultJson: '1' })
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'navigation_interrupted' })

    let release2!: (value: unknown) => void
    contents.executeJavaScript.mockImplementationOnce(async (code: string) => {
      if (!code.includes('pipiui-browser-script')) return { ok: true }
      return await new Promise(resolve => { release2 = resolve })
    })
    const pending2 = host.toolAction({ action: 'script', js: 'return 2' })
    await vi.waitUntil(() => release2 !== undefined)
    contents.emit('render-process-gone')
    release2({ ok: true, resultJson: '2' })
    await expect(pending2).resolves.toMatchObject({ ok: false, code: 'view_recreated' })
  })

  it('opens detached DevTools only when PIPIUI_BROWSER_DEVTOOLS=1', async () => {
    expect(shouldOpenBrowserDevTools({} as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldOpenBrowserDevTools({ PIPIUI_BROWSER_DEVTOOLS: '1' } as NodeJS.ProcessEnv)).toBe(true)
    const previous = process.env.PIPIUI_BROWSER_DEVTOOLS
    process.env.PIPIUI_BROWSER_DEVTOOLS = '1'
    try {
      const { host, contents } = browserHarness()
      await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
      await host.loadURL('devtools.example')
      expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
      expect(contents.openDevTools).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) delete process.env.PIPIUI_BROWSER_DEVTOOLS
      else process.env.PIPIUI_BROWSER_DEVTOOLS = previous
    }
  })

  it('serializes script/wait/console on the existing per-session lane', async () => {
    const created: FakeWebContents[] = []
    const createView = vi.fn(() => {
      const contents = new FakeWebContents()
      created.push(contents)
      return { webContents: contents, setBounds: vi.fn(), setVisible: vi.fn() }
    })
    const host = new BrowserSessionHost(createView)
    host.attachToWindow(vi.fn())
    await host.toolAction('s', { action: 'console' })
    let release!: (value: unknown) => void
    created[0].executeJavaScript.mockImplementation(async (code: string) => {
      if (String(code).includes('pipiui-browser-script')) {
        return await new Promise(resolve => { release = resolve })
      }
      return { ok: true, url: created[0].url, text: '', viewport: { width: 0, height: 0 }, elements: [] }
    })
    const blocked = host.toolAction('s', { action: 'script', js: 'return 1' })
    await vi.waitUntil(() => release !== undefined)
    let consoleStarted = false
    const queued = host.toolAction('s', { action: 'console' }).then(result => {
      consoleStarted = true
      return result
    })
    const other = host.toolAction('other', { action: 'console' })
    await expect(other).resolves.toMatchObject({ ok: true })
    expect(consoleStarted).toBe(false)
    release({ ok: true, resultJson: '1' })
    await expect(blocked).resolves.toMatchObject({ ok: true })
    await expect(queued).resolves.toMatchObject({ ok: true })
    expect(consoleStarted).toBe(true)
  })
})

describe('browser-debug helpers', () => {
  it('safe-serializes cycles, bigint, errors, and unsupported values', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const packed = safeSerialize({ cycle, big: BigInt(2), err: new Error('x'), fn: function named() {}, und: undefined })
    expect(packed.ok).toBe(true)
    if (packed.ok) {
      const parsed = JSON.parse(packed.json)
      expect(parsed.cycle.self).toEqual({ __t: 'circular' })
      expect(parsed.big).toEqual({ __t: 'bigint', v: '2' })
      expect(parsed.err.__t).toBe('error')
      expect(parsed.fn.__t).toBe('function')
      expect(parsed.und).toEqual({ __t: 'undefined' })
    }
  })

  it('remaps script stacks onto user lines and keeps the original when parsing fails', () => {
    const mapped = remapScriptStack('Error: x\n    at pipiui-browser-script-a.js:20:3', 'pipiui-browser-script-a.js', 16)
    expect(mapped).toMatchObject({ line: 4, column: 3 })
    expect(mapped.stack).toContain('pipiui-browser-script-a.js:4:3')
    expect(remapScriptStack('nope', 'missing.js', 4).stack).toBe('nope')
  })

  it('caps per-tab console rings', () => {
    const buf = new TabConsoleBuffer()
    for (let i = 0; i < 520; i++) buf.push({ timestamp: i, level: 'log', message: `m${i}`, tabId: 't' })
    const queried = buf.query('t', { limit: 200 })
    expect(queried.entries).toHaveLength(200)
    expect(queried.entries[0].seq).toBeGreaterThan(320)
  })

  it('hard-caps oversized nested result envelopes', () => {
    const packed = truncateEnvelope({
      schemaVersion: 1,
      ok: true,
      requestId: 'req-nested',
      action: 'script',
      tabId: 'browser-tab-1',
      url: 'https://example.test/page',
      elapsedMs: 12,
      result: { layer: { blob: 'n'.repeat(30_000), kids: [{ blob: 'k'.repeat(8_000) }] } },
    })
    const text = JSON.stringify(packed.value)
    expect(text.length).toBeLessThanOrEqual(BROWSER_DEBUG_MAX_OUTPUT)
    expect(packed.truncated).toBe(true)
    expect(packed.value).toMatchObject({
      schemaVersion: 1,
      ok: true,
      requestId: 'req-nested',
      action: 'script',
      tabId: 'browser-tab-1',
      url: 'https://example.test/page',
      elapsedMs: 12,
      truncated: true,
    })
  })

  it('hard-caps oversized console entries, logs, consoleTail, and steps', () => {
    const fat = 'x'.repeat(2_000)
    const packed = truncateEnvelope({
      schemaVersion: 1,
      ok: false,
      requestId: 'req-console',
      action: 'console',
      tabId: 'browser-tab-2',
      url: 'https://example.test/console',
      elapsedMs: 4,
      code: 'timeout',
      error: 'browser wait timed out',
      entries: Array.from({ length: 80 }, (_, i) => ({ seq: i, message: fat, level: 'error' })),
      logs: Array.from({ length: 80 }, () => fat),
      consoleTail: Array.from({ length: 40 }, (_, i) => ({ seq: i, message: fat })),
      steps: Array.from({ length: 80 }, (_, i) => ({ label: fat, t: i })),
    })
    const text = JSON.stringify(packed.value)
    expect(text.length).toBeLessThanOrEqual(BROWSER_DEBUG_MAX_OUTPUT)
    expect(packed.truncated).toBe(true)
    expect(packed.value).toMatchObject({
      schemaVersion: 1,
      ok: false,
      requestId: 'req-console',
      action: 'console',
      tabId: 'browser-tab-2',
      url: 'https://example.test/console',
      elapsedMs: 4,
      code: 'timeout',
      error: 'browser wait timed out',
      truncated: true,
    })
  })
})

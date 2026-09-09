import { describe, expect, it, vi } from 'vitest'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { BrowserSessionHost, BrowserTabsHost, BROWSER_HOST_TOOL_ACTIONS, BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS, browserDeviceEmulationFor, browserPartitionForSession, installBrowserNativeTrace, mountBrowserShellView, normalizeBrowserToolTarget, normalizeBrowserURL, parseBrowserSnapshotTarget, routeBrowserView, shouldOpenBrowserDevTools, withBrowserTabsHost, type BrowserViewLike } from './browser-host.js'
import { advanceQueueTail, awaitLoadURL, BROWSER_PAGE_EVALUATE_TIMEOUT_MS } from './browser/navigation-settle.js'
import { BROWSER_DEBUG_MAX_OUTPUT, BROWSER_SCRIPT_MAX_INPUT, remapScriptStack, safeSerialize, TabConsoleBuffer, truncateEnvelope } from './browser-debug.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
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
  hangLoadURL = false
  waitReady = true
  scriptResult: Record<string, unknown> | undefined
  pageRuntime: { evaluate(code: string): unknown } | null = null
  openDevTools = vi.fn()
  isDevToolsOpened = vi.fn(() => false)
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>()
  loadURL = vi.fn(async (url: string) => {
    if (this.loadURLRejects) throw new Error(this.loadURLRejects)
    this.url = url
    this.emit('did-start-loading')
    if (this.hangLoadURL) return new Promise(() => {})
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
    if (this.pageRuntime && code.includes('__pipiBrowserDOM')) return this.pageRuntime.evaluate(code)
    if (code.includes('"action":"sanitize"')) {
      const marker = '__pipiBrowserDOM.dispatch('
      const index = code.lastIndexOf(marker)
      if (index >= 0) {
        const raw = code.slice(index + marker.length).trim()
        const json = raw.endsWith(')') ? raw.slice(0, -1) : raw
        try {
          const parsed = JSON.parse(json) as { action?: string; value?: unknown }
          if (parsed?.action === 'sanitize') return parsed.value
        } catch { /* fall through */ }
      }
    }
    if (this.pageRuntime) {
      try { return this.pageRuntime.evaluate(code) } catch { /* host-only helpers keep mock fallbacks */ }
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

describe('awaitLoadURL', () => {
  it('resolves loaded when the promise settles before the bound', async () => {
    await expect(awaitLoadURL(Promise.resolve('ok'), 50)).resolves.toBe('loaded')
  })

  it('resolves timedOut when the promise never settles', async () => {
    vi.useFakeTimers()
    try {
      const pending = awaitLoadURL(new Promise(() => {}), BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      await expect(pending).resolves.toBe('timedOut')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects when load fails before the bound', async () => {
    await expect(awaitLoadURL(Promise.reject(new Error('ERR_FAILED')), 50)).rejects.toThrow('ERR_FAILED')
  })
})

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
    const listeners = new Map<string, () => void>()
    const shell = browserHarness().view
    const browser = browserHarness().view
    const window = {
      contentView: {
        addChildView: (view: BrowserViewLike) => calls.push(view === shell ? 'shell:add' : 'browser:add'),
        removeChildView: () => undefined
      },
      getContentBounds: () => size,
      on: (event: string, listener: () => void) => { listeners.set(event, listener) },
      off: (event: string, listener: () => void) => { if (listeners.get(event) === listener) listeners.delete(event) }
    }

    const unmount = mountBrowserShellView(window, shell)
    routeBrowserView(browser, true, window)
    expect(calls).toEqual(['shell:add', 'browser:add'])
    expect(shell.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1280, height: 800 })
    expect([...listeners.keys()]).toEqual(expect.arrayContaining(['resize', 'show', 'maximize', 'enter-full-screen']))

    size = { width: 900, height: 600 }
    listeners.get('resize')?.()
    expect(shell.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 900, height: 600 })
    size = { width: 1100, height: 700 }
    listeners.get('show')?.()
    expect(shell.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1100, height: 700 })
    unmount()
    expect(listeners.size).toBe(0)
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
    // eval/content run against the live page; output is sanitized before return.
    await expect(host.toolAction({ action: 'eval', js: 'document.title' })).resolves.toMatchObject({ ok: true, result: 'Bilibili 热门科技视频' })
    await expect(host.toolAction({ action: 'content', mode: 'text' })).resolves.toMatchObject({ ok: true, content: 'Bilibili 热门科技视频', truncated: false })
    await expect(host.toolAction({ action: 'eval' })).resolves.toMatchObject({ ok: false })
  })

  it('waits for the reload navigation lifecycle to settle before returning the tab', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('settle.example')
    contents.deferCommit = true
    let settled = false
    const reloading = host.reload().then(tab => { settled = true; return tab })
    await Promise.resolve()
    // The reload navigation has started but not committed: the caller must not
    // be handed a tab that claims the old document state is final.
    expect(settled).toBe(false)
    contents.commitNavigation()
    const tab = await reloading
    expect(settled).toBe(true)
    expect(tab.isLoading).toBe(false)
    expect(tab.url).toBe('https://settle.example')
  })

  it('bounds the reload settle wait when the commit never lands', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('hung.example')
    contents.deferCommit = true
    vi.useFakeTimers()
    try {
      const reloading = host.reload()
      await vi.advanceTimersByTimeAsync(10_000)
      const tab = await reloading
      // A hung commit resolves the settle wait at the bound and still returns
      // the tab (loading state keeps flowing through events).
      expect(tab.isLoading).toBe(true)
      expect(contents.reload).toHaveBeenCalledTimes(1)
      contents.commitNavigation()
      contents.deferCommit = false
      await expect(host.reload()).resolves.toMatchObject({ isLoading: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a hung loadURL so navigate returns within the settle ceiling', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('ok.example')
    contents.hangLoadURL = true
    contents.pageText = 'partial document'
    vi.useFakeTimers()
    try {
      const navigating = host.toolAction({ action: 'navigate', url: 'hung.example' }, { reveal: false })
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      await expect(navigating).resolves.toMatchObject({ ok: true })
      // Guard expires at the same bound, so a later observe is not stuck in browser_navigating.
      await expect(host.toolAction({ action: 'observe' }, { reveal: false })).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows a late loadURL rejection after the settle bound without unhandled rejection', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('ok.example')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    vi.useFakeTimers()
    try {
      contents.loadURL.mockImplementationOnce(async url => {
        contents.url = url
        contents.emit('did-start-loading')
        await new Promise<void>(resolve => setTimeout(resolve, BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS * 2))
        throw new Error('late fail')
      })
      const navigating = host.toolAction({ action: 'navigate', url: 'late-fail.example' }, { reveal: false })
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      await expect(navigating).resolves.toMatchObject({ ok: true })
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      vi.useRealTimers()
    }
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
  function sessionsHarness(
    attach: (view: BrowserViewLike, placement: boolean | 'detach') => void = vi.fn(),
    boundsScale: () => number = () => 1
  ) {
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
    host.attachToWindow((_sessionId, view, placement) => attach(view, placement), boundsScale)
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

  it('unblocks the session action queue when loadURL never settles', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    created[0].contents.hangLoadURL = true
    vi.useFakeTimers()
    try {
      const hung = host.toolAction('session-a', { action: 'navigate', url: 'hung.example' })
      let consoleDone = false
      const queuedConsole = host.toolAction('session-a', { action: 'console' }).then(result => {
        consoleDone = true
        return result
      })
      await Promise.resolve()
      expect(consoleDone).toBe(false)
      await vi.advanceTimersByTimeAsync(BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS)
      await expect(hung).resolves.toMatchObject({ ok: true })
      await expect(queuedConsole).resolves.toMatchObject({ ok: true })
      expect(consoleDone).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // executeJavaScript has no deadline of its own. A renderer blocked by a dialog, a long
  // synchronous script, or a torn-down target never settles it — the same failure the
  // loadURL bound above was written for, on the other half of the host.
  it('bounds a hung page evaluate so the action returns instead of hanging forever', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    // Only the content evaluate hangs: the redaction pass that runs on the error path is
    // bounded by the same helper, and letting it hang too would just re-prove that bound.
    created[0].contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const hung = host.toolAction('session-a', { action: 'content' })
      await vi.advanceTimersByTimeAsync(BROWSER_PAGE_EVALUATE_TIMEOUT_MS)
      const result = await hung
      expect(result.ok).toBe(false)
      expect(String(result.error)).toContain('did not answer')
      // Best effort recovery: the pending load is stopped so a navigation-blocked
      // renderer is released rather than left to fail every later action too.
      expect(created[0].contents.stop).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('unblocks the session action queue when a page evaluate never settles', async () => {
    const { host, created } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    const realExecute = created[0].contents.executeJavaScript.getMockImplementation()!
    created[0].contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const hung = host.toolAction('session-a', { action: 'content' })
      let queuedDone = false
      const queued = host.toolAction('session-a', { action: 'console' }).then(result => {
        queuedDone = true
        return result
      })
      await Promise.resolve()
      expect(queuedDone).toBe(false)
      await vi.advanceTimersByTimeAsync(BROWSER_PAGE_EVALUATE_TIMEOUT_MS)
      await expect(hung).resolves.toMatchObject({ ok: false })
      await expect(queued).resolves.toMatchObject({ ok: true })
      expect(queuedDone).toBe(true)
      created[0].contents.executeJavaScript.mockImplementation(realExecute)
    } finally {
      vi.useRealTimers()
    }
  })

  // The agent sends browser_cancel on its own request timeout; answering `unknown_action`
  // turned every client timeout into a spurious error in the log.
  // One unanswered evaluate can be a navigation commit that stop() clears. Two on the same
  // surface means the renderer is not coming back — stop(), reload and navigate all have to
  // reach the same wedged renderer — so the surface itself is replaced.
  it('discards a twice-unresponsive page and serves the next action from a fresh one', async () => {
    const { host, created, createView } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    const wedged = created[0]
    const viewsBefore = createView.mock.calls.length
    vi.useFakeTimers()
    try {
      // Strike one: stop() the pending load, keep the surface.
      wedged.contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => {}))
      const first = host.toolAction('session-a', { action: 'content' })
      await vi.advanceTimersByTimeAsync(BROWSER_PAGE_EVALUATE_TIMEOUT_MS)
      const firstResult = await first
      expect(firstResult.ok).toBe(false)
      expect(String(firstResult.error)).toContain('did not answer')
      expect(wedged.contents.stop).toHaveBeenCalled()
      expect(createView.mock.calls.length).toBe(viewsBefore)
      expect(wedged.contents.close).not.toHaveBeenCalled()

      // Strike two on the same surface: retire it.
      wedged.contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => {}))
      const second = host.toolAction('session-a', { action: 'content' })
      await vi.advanceTimersByTimeAsync(BROWSER_PAGE_EVALUATE_TIMEOUT_MS)
      const secondResult = await second
      expect(secondResult.ok).toBe(false)
      expect(String(secondResult.error)).toContain('discarded')
      expect(wedged.contents.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }

    // The next action builds a fresh surface through the ordinary ensurePane path.
    const recovered = await host.toolAction('session-a', { action: 'content' })
    expect(recovered.ok).toBe(true)
    expect(createView.mock.calls.length).toBeGreaterThan(viewsBefore)
    expect(created.length).toBeGreaterThan(1)
  })

  it('a page exception is not a strike: only silence retires a surface', async () => {
    const { host, created, createView } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    const viewsBefore = createView.mock.calls.length
    // Two page exceptions in a row prove the renderer is alive and must not retire it.
    created[0].contents.executeJavaScript.mockImplementationOnce(async () => { throw new Error('boom') })
    await host.toolAction('session-a', { action: 'eval', js: '1' })
    created[0].contents.executeJavaScript.mockImplementationOnce(async () => { throw new Error('boom') })
    await host.toolAction('session-a', { action: 'eval', js: '1' })
    expect(createView.mock.calls.length).toBe(viewsBefore)
    expect(created[0].contents.close).not.toHaveBeenCalled()
  })

  it('answers browser_cancel as a known action', async () => {
    const { host } = sessionsHarness()
    await host.toolAction('session-a', { action: 'navigate', url: 'ok.example' })
    const result = await host.toolAction('session-a', { action: 'browser_cancel', requestID: 'req-1' } as never)
    expect(result.ok).toBe(true)
    expect(result.code).not.toBe('unknown_action')
  })

  it('advanceQueueTail releases the queue at its ceiling and swallows a late settle', async () => {
    vi.useFakeTimers()
    try {
      let released = false
      void advanceQueueTail(new Promise(() => {}), 1_000).then(() => { released = true })
      await vi.advanceTimersByTimeAsync(999)
      expect(released).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(released).toBe(true)
      // A rejection landing after the ceiling must not surface as an unhandled rejection.
      let late!: (reason: unknown) => void
      const lateWork = new Promise((_resolve, reject) => { late = reject })
      let secondReleased = false
      void advanceQueueTail(lateWork, 10).then(() => { secondReleased = true })
      await vi.advanceTimersByTimeAsync(10)
      expect(secondReleased).toBe(true)
      late(new Error('too late'))
      await vi.advanceTimersByTimeAsync(1)
    } finally {
      vi.useRealTimers()
    }
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

  it('converts zoomed shell CSS bounds into native window coordinates', async () => {
    const { host, created } = sessionsHarness(vi.fn(), () => 1.2)

    await host.setViewBounds('session-a', { x: 400, y: 80, width: 500, height: 300, visible: true })

    expect(created[0].view.setBounds).toHaveBeenLastCalledWith({ x: 480, y: 96, width: 600, height: 360 })
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
      await host.setZoomFactor(1.2)
      expect(created[0].contents.setZoomFactor).toHaveBeenLastCalledWith(1.2)
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

    it('keeps document ownership per viewport when one pane load fails mid-flight', async () => {
      const { host, created } = multiViewHarness()
      await host.setViewBounds(asBounds({
        x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
        mobileOverlay: { visible: true, applyDeviceEmulation: true }
      }))
      const desktop = created[0].contents
      const mobile = created[1].contents
      // Desktop commit is deferred while the mobile load fails immediately: the
      // failing pane must only clear its own pending ownership, never the
      // desktop pane's, or the later desktop commit loses its console owner.
      desktop.deferCommit = true
      mobile.loadURLRejects = 'ERR_FAILED'
      await expect(host.loadURL('flaky.example')).rejects.toThrow('ERR_FAILED')
      desktop.commitNavigation('https://flaky.example')
      desktop.emit('console-message', { level: 'error', message: 'desktop-owner', lineNumber: 1, sourceId: 'a.js' })
      const consoleResult = await host.toolAction({ action: 'console' })
      expect(consoleResult).toMatchObject({ ok: true })
      expect(String(consoleResult.logs)).toContain('desktop-owner')
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
    // The tool description must list every action the tool actually handles —
    // host-dispatched DOM actions plus the extension-layer watch actions — so a
    // reader of the description never misses an available action.
    const watchActions = ['watch', 'unwatch', 'watches']
    const describedActions = descriptionMatch?.[1].split(/,\s*/).map(item => item.trim()).filter(Boolean) ?? []
    expect([...describedActions].sort()).toEqual([...BROWSER_TOOL_DECLARED_ACTIONS, ...watchActions].sort())
    expect([...describedActions.filter(item => item !== 'help' && !watchActions.includes(item))].sort()).toEqual([...BROWSER_HOST_TOOL_ACTIONS].sort())
    // The parameter schema descriptions list the same full action set (single + batch).
    const schemaActionDescriptions = [...webviewSource.matchAll(/description: "navigate \| observe \| wait \| ([^"]+)"/g)].map(match => `navigate | observe | wait | ${match[1]}`)
    expect(schemaActionDescriptions.length).toBeGreaterThanOrEqual(2)
    for (const schemaDescription of schemaActionDescriptions) {
      expect(schemaDescription.split(/ \| /).sort()).toEqual([...BROWSER_TOOL_DECLARED_ACTIONS, ...watchActions].sort())
    }
    expect(webviewSource).toMatch(/script \{js\}/)
    expect(webviewSource).toMatch(/region\?,role\?,name\?,cursor\?/)
    expect(webviewSource).toContain('region: Type.Optional')
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

  it('caps the idle quiet window below a short wait timeout so sub-second waits succeed', async () => {
    const { host, contents, runtime } = await liveBrowser()
    // A resource that just finished keeps the page "not quiet" under the default
    // idle window (>= 400ms), which a 0.3s timeout could never out-wait without
    // capping the quiet window inside the wait budget.
    const recentActivity = Date.now() - 50
    ;(runtime.window.performance as unknown as { getEntriesByType: (type: string) => unknown[] }).getEntriesByType = (type: string) =>
      type === 'resource' ? [{ responseEnd: recentActivity }] : []
    const result = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.3 })
    expect(result).toMatchObject({ ok: true, mode: 'idle', ready: true })
    const waitCheckSource = contents.executeJavaScript.mock.calls
      .map(([code]) => String(code))
      .find(code => code.includes('"action":"wait_check"'))
    expect(waitCheckSource).toBeTruthy()
    const payloadStart = waitCheckSource!.lastIndexOf('dispatch(') + 'dispatch('.length
    const payload = JSON.parse(waitCheckSource!.slice(payloadStart).replace(/\)\s*$/, '')) as { idle_ms?: number }
    expect(payload.idle_ms).toBeLessThanOrEqual(240)
  })

  it('retries the post-ready observation once and reports a structured failure instead of an empty ok', async () => {
    const { host, runtime } = await liveBrowser()
    const realEvaluate = runtime.evaluate.bind(runtime)
    let observeCalls = 0
    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) {
        observeCalls += 1
        if (observeCalls === 1) return { ok: false, error: 'browser page is unavailable' }
      }
      return realEvaluate(code)
    }
    const recovered = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 1 })
    expect(recovered).toMatchObject({ ok: true, ready: true })
    expect(String(recovered.snapshotID)).toBeTruthy()
    expect(String(recovered.url)).toBeTruthy()

    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) return { ok: false, error: 'browser page is unavailable' }
      return realEvaluate(code)
    }
    const failed = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 1 })
    expect(failed).toMatchObject({ ok: false, code: 'observe_failed', error: 'browser page is unavailable', waitReady: true })
  })

  it('skips the post-ready observation retry when the wait budget is already exhausted', async () => {
    const { host, runtime } = await liveBrowser()
    const realEvaluate = runtime.evaluate.bind(runtime)
    let observeCalls = 0
    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) {
        observeCalls += 1
        // The first observe consumes the whole public timeout budget.
        vi.setSystemTime(Date.now() + 5_000)
        return { ok: false, error: 'observe raced a navigation commit' }
      }
      return realEvaluate(code)
    }
    vi.useFakeTimers()
    try {
      const failed = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 1 }, { reveal: false })
      expect(failed).toMatchObject({ ok: false, code: 'observe_failed', error: 'observe raced a navigation commit' })
      // No retry past the deadline: exactly one observe call was issued.
      expect(observeCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the post-ready retry when the backoff sleep consumes the remaining budget', async () => {
    const { host, runtime } = await liveBrowser()
    const realEvaluate = runtime.evaluate.bind(runtime)
    let observeCalls = 0
    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) {
        observeCalls += 1
        // Leaves 50ms of budget: enough to start the backoff sleep, not enough
        // for a retry after it.
        vi.setSystemTime(Date.now() + 950)
        return { ok: false, error: 'observe raced a navigation commit' }
      }
      return realEvaluate(code)
    }
    vi.useFakeTimers()
    try {
      const pending = host.toolAction({ action: 'wait', mode: 'idle', timeout: 1 }, { reveal: false })
      // Fires the 50ms backoff sleep and advances the clock past the deadline.
      await vi.advanceTimersByTimeAsync(80)
      const failed = await pending
      expect(failed).toMatchObject({ ok: false, code: 'observe_failed', error: 'observe raced a navigation commit' })
      expect(observeCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a slow retry observation by the remaining wait budget', async () => {
    const { host, runtime } = await liveBrowser()
    const realEvaluate = runtime.evaluate.bind(runtime)
    let observeCalls = 0
    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) {
        observeCalls += 1
        if (observeCalls === 1) {
          vi.setSystemTime(Date.now() + 800) // leaves 200ms
          return { ok: false, error: 'observe raced a navigation commit' }
        }
        // The retry hangs: slower than the remaining public budget.
        return new Promise(() => {})
      }
      return realEvaluate(code)
    }
    vi.useFakeTimers()
    try {
      const pending = host.toolAction({ action: 'wait', mode: 'idle', timeout: 1 }, { reveal: false })
      await vi.advanceTimersByTimeAsync(80) // backoff sleep → retry starts with 120ms left
      await vi.advanceTimersByTimeAsync(120) // retry deadline fires
      const failed = await pending
      expect(failed).toMatchObject({ ok: false, code: 'observe_failed' })
      expect(String(failed.error)).toContain('exceeded the remaining 120ms wait budget')
      expect(failed.elapsedMs).toBeLessThanOrEqual(1000)
      expect(observeCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a hung wait_check by the public wait deadline instead of the bridge timeout', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    const realExecute = contents.executeJavaScript
    // A navigation/render commit can leave the wait_check evaluation pending far
    // past a short public timeout; the wait must still settle as a structured result.
    contents.executeJavaScript = vi.fn(async (code: string) => {
      if (code.includes('"action":"wait_check"')) return new Promise(() => {})
      return realExecute(code)
    })
    vi.useFakeTimers()
    try {
      const pending = host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.1 }, { reveal: false })
      await vi.advanceTimersByTimeAsync(100)
      const failed = await pending
      expect(failed).toMatchObject({ ok: false, code: 'timeout', error: 'browser wait timed out' })
      expect(failed.elapsedMs).toBeLessThanOrEqual(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('neutralizes a late wait_check success that resolves after the deadline', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    const realExecute = contents.executeJavaScript.getMockImplementation()!
    let waitCheckEvaluates = 0
    contents.executeJavaScript.mockImplementation(async (code: string) => {
      if (code.includes('"action":"wait_check"')) {
        waitCheckEvaluates += 1
        // The underlying evaluate cannot be cancelled: it lands far past the
        // public deadline claiming ready — a late lie that must change nothing.
        await new Promise(resolve => setTimeout(resolve, 300))
        return { ok: true, ready: true }
      }
      return realExecute(code)
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const startedAt = Date.now()
      const failed = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.05 }, { reveal: false })
      expect(failed).toMatchObject({ ok: false, code: 'timeout', error: 'browser wait timed out' })
      expect(Date.now() - startedAt).toBeLessThan(250)
      await new Promise(resolve => setTimeout(resolve, 350))
      // Exactly one dispatched evaluate, no follow-up dispatch from the late result.
      expect(waitCheckEvaluates).toBe(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('neutralizes a late wait_check rejection after the deadline without unhandled rejection', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    const realExecute = contents.executeJavaScript.getMockImplementation()!
    contents.executeJavaScript.mockImplementation(async (code: string) => {
      if (code.includes('"action":"wait_check"')) {
        await new Promise(resolve => setTimeout(resolve, 300))
        throw new Error('late renderer failure')
      }
      return realExecute(code)
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const failed = await host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.05 }, { reveal: false })
      expect(failed).toMatchObject({ ok: false, code: 'timeout', error: 'browser wait timed out' })
      await new Promise(resolve => setTimeout(resolve, 350))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('fails fast with a structured browser_navigating error while a main-frame commit is in flight', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('nav.example')
    contents.deferCommit = true
    await host.loadURL('nav.example/next')
    const before = contents.executeJavaScript.mock.calls.length
    await expect(host.toolAction({ action: 'observe' }, { reveal: false })).resolves.toMatchObject({
      ok: false,
      code: 'browser_navigating',
      retryable: true,
      viewportTarget: 'desktop',
    })
    // Fast fail means no page dispatch happened at all.
    expect(contents.executeJavaScript.mock.calls.length).toBe(before)
    // The host-side console buffer stays readable mid-navigation.
    await expect(host.toolAction({ action: 'console' }, { reveal: false })).resolves.toMatchObject({ ok: true })
    contents.commitNavigation()
    await expect(host.toolAction({ action: 'observe' }, { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'desktop' })
  })

  it('fails fast only against the pane whose sibling sync is still committing', async () => {
    const { host, created } = multiViewHarness()
    await host.setViewBounds(asBounds({
      x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
      mobileOverlay: { visible: true, applyDeviceEmulation: true }
    }))
    await host.loadURL('sync.example')
    // Organic desktop navigation triggers the fire-and-forget sibling sync; the
    // mobile pane's commit is held back while the desktop document is settled.
    created[1].contents.deferCommit = true
    created[0].contents.emit('did-navigate', {}, 'https://clicked.example')
    // Per-pane guard: only the mobile pane is mid-commit, so only mobile-targeted
    // actions fail fast; the committed desktop page stays actionable.
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }), { reveal: false })).resolves.toMatchObject({
      ok: true, viewportTarget: 'desktop'
    })
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }), { reveal: false })).resolves.toMatchObject({
      ok: false, code: 'browser_navigating'
    })
    created[1].contents.commitNavigation('https://clicked.example')
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }), { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile' })
  })

  it('keeps the navigation guard per pane across the dual viewport matrix', async () => {
    const { host, created } = multiViewHarness()
    await host.setViewBounds(asBounds({
      x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
      mobileOverlay: { visible: true, applyDeviceEmulation: true }
    }))
    await host.loadURL('matrix.example')
    const desktop = created[0].contents
    const mobile = created[1].contents
    // Desktop-only navigation window: organic mobile navigation triggers the
    // sibling sync onto the desktop pane.
    desktop.deferCommit = true
    mobile.emit('did-navigate', {}, 'https://clicked.example')
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }), { reveal: false })).resolves.toMatchObject({ ok: false, code: 'browser_navigating' })
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }), { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile' })
    desktop.commitNavigation('https://clicked.example')

    // Desktop mid organic load (no pane.pending — the guard's loading clause):
    // the sibling pane loading and stopping first zeroes the shared tab-level
    // isLoading flag; the desktop pane's own window must survive that.
    desktop.emit('did-start-loading')
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }), { reveal: false })).resolves.toMatchObject({ ok: false, code: 'browser_navigating' })
    // Actions against the settled sibling pane stay allowed while desktop loads.
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }), { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile' })
    mobile.emit('did-start-loading')
    mobile.emit('did-stop-loading')
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }), { reveal: false })).resolves.toMatchObject({ ok: false, code: 'browser_navigating' })
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'mobile' }), { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'mobile' })
    desktop.emit('did-navigate', {}, 'https://organic.example')
    desktop.emit('did-stop-loading')
    await expect(host.toolAction(asRequest({ action: 'observe', target: 'desktop' }), { reveal: false })).resolves.toMatchObject({ ok: true, viewportTarget: 'desktop' })
  })

  it('bounds a hung first post-ready observation by the remaining wait budget', async () => {
    const { host, runtime } = await liveBrowser()
    const realEvaluate = runtime.evaluate.bind(runtime)
    let observeCalls = 0
    runtime.evaluate = (code: string) => {
      if (code.includes('"action":"observe"')) {
        observeCalls += 1
        // The first post-ready observation hangs: the renderer never answers.
        return new Promise(() => {})
      }
      return realEvaluate(code)
    }
    vi.useFakeTimers()
    try {
      const pending = host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.2 }, { reveal: false })
      await vi.advanceTimersByTimeAsync(200)
      const failed = await pending
      expect(failed).toMatchObject({ ok: false, code: 'observe_failed', waitReady: true })
      expect(String(failed.error)).toContain('exceeded the remaining 200ms wait budget')
      expect(failed.elapsedMs).toBeLessThanOrEqual(200)
      // No retry: the budget is gone.
      expect(observeCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('observes a readiness transition inside a 0.1s budget instead of sleeping past it', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    contents.waitReady = false
    vi.useFakeTimers()
    try {
      const pending = host.toolAction({ action: 'wait', mode: 'idle', timeout: 0.1 }, { reveal: false })
      // The first adaptive poll fires well before the old fixed 80ms sleep would.
      await vi.advanceTimersByTimeAsync(30)
      contents.waitReady = true
      await vi.advanceTimersByTimeAsync(30)
      const result = await pending
      expect(result).toMatchObject({ ok: true, ready: true })
      expect(result.elapsedMs).toBeLessThanOrEqual(100)
      const waitChecks = contents.executeJavaScript.mock.calls
        .map(([code]) => String(code))
        .filter(code => code.includes('"action":"wait_check"'))
      expect(waitChecks.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
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

type PageSpec = {
  tag: string
  attrs?: Record<string, string>
  text?: string
  value?: string
  onClick?: (el: MiniElement, win: MiniWindow) => void
  children?: Array<PageSpec | string>
}

class MiniEvent {
  type: string
  bubbles: boolean
  cancelable: boolean
  composed: boolean
  defaultPrevented = false
  target: MiniNode | null = null
  data?: string
  inputType?: string
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type
    this.bubbles = init.bubbles === true
    this.cancelable = init.cancelable === true
    this.composed = init.composed === true
    this.data = typeof init.data === 'string' ? init.data : undefined
    this.inputType = typeof init.inputType === 'string' ? init.inputType : undefined
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true }
  composedPath() { return this.target ? [this.target] : [] }
}
class MiniInputEvent extends MiniEvent {}

class MiniNode {
  nodeType: number
  parentNode: MiniNode | null = null
  childNodes: MiniNode[] = []
  ownerDocument: MiniDocument | null = null
  textContentValue = ''
  constructor(nodeType: number) { this.nodeType = nodeType }
  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null
  }
  get textContent(): string {
    if (this.nodeType === 3) return this.textContentValue
    return this.childNodes.map(child => child.textContent).join('')
  }
  set textContent(value: string) {
    this.childNodes = []
    this.textContentValue = String(value ?? '')
    if (this.nodeType === 1 && this.textContentValue) {
      const text = new MiniNode(3)
      text.textContentValue = this.textContentValue
      text.ownerDocument = this.ownerDocument
      text.parentNode = this
      this.childNodes = [text]
    }
  }
}

class MiniElement extends MiniNode {
  localName: string
  attrs = new Map<string, string>()
  _value = ''
  checked = false
  disabled = false
  open = false
  isContentEditable = false
  shadowRoot: MiniElement | null = null
  contentDocument: MiniDocument | null = null
  _listeners = new Map<string, Array<(event: MiniEvent) => void>>()
  _onClick?: (el: MiniElement, win: MiniWindow) => void
  style: Record<string, string> = {}
  _rect = { x: 0, y: 0, left: 0, top: 0, width: 120, height: 20, right: 120, bottom: 20 }
  constructor(tag: string) {
    super(1)
    this.localName = tag
  }
  get id() { return this.getAttribute('id') || '' }
  get className() { return this.getAttribute('class') || '' }
  get htmlFor() { return this.getAttribute('for') || '' }
  get children(): MiniElement[] { return this.childNodes.filter((node): node is MiniElement => node instanceof MiniElement) }
  get isConnected(): boolean {
    let current: MiniNode | null = this
    while (current) {
      if (current.nodeType === 9) return true
      current = current.parentNode
    }
    return false
  }
  get labels(): MiniElement[] {
    const doc = this.ownerDocument
    if (!doc || !this.id) return []
    return walkElements(doc.documentElement).filter(el => el.localName === 'label' && el.htmlFor === this.id)
  }
  get form(): MiniElement | null {
    let current: MiniElement | null = this
    while (current) {
      if (current.localName === 'form') return current
      current = current.parentElement
    }
    return null
  }
  get value() { return this._value }
  set value(next: string) { this._value = String(next ?? '') }
  get innerText() { return this.textContent }
  get outerHTML() { return serializeOuterHTML(this) }
  get selectedOptions() {
    const selected = this.children.filter(child => child.localName === 'option' && (child.hasAttribute('selected') || child === this.children.find(item => item.localName === 'option')))
    return selected.length ? [selected[0]] : []
  }
  get options() { return this.children.filter(child => child.localName === 'option') }
  getAttribute(name: string) { return this.attrs.has(name) ? this.attrs.get(name)! : null }
  setAttribute(name: string, value: string) {
    const previous = this.attrs.get(name)
    this.attrs.set(name, String(value))
    if (name === 'value') this._value = String(value)
    if (name === 'open') this.open = true
    notifyMutation(this, { type: 'attributes', target: this, attributeName: name, addedNodes: [], removedNodes: [] })
    void previous
  }
  hasAttribute(name: string) { return this.attrs.has(name) }
  removeAttribute(name: string) {
    this.attrs.delete(name)
    notifyMutation(this, { type: 'attributes', target: this, attributeName: name, addedNodes: [], removedNodes: [] })
  }
  appendChild<T extends MiniNode>(child: T): T {
    child.parentNode = this
    child.ownerDocument = this.ownerDocument
    this.childNodes.push(child)
    notifyMutation(this, { type: 'childList', target: this, addedNodes: [child], removedNodes: [] })
    return child
  }
  removeChild<T extends MiniNode>(child: T): T {
    this.childNodes = this.childNodes.filter(node => node !== child)
    child.parentNode = null
    notifyMutation(this, { type: 'childList', target: this, addedNodes: [], removedNodes: [child] })
    return child
  }
  remove() { this.parentNode instanceof MiniElement && this.parentNode.removeChild(this) }
  replaceWith(next: MiniElement) {
    const parent = this.parentElement
    if (!parent) return
    const index = parent.childNodes.indexOf(this)
    parent.removeChild(this)
    next.ownerDocument = parent.ownerDocument
    next.parentNode = parent
    parent.childNodes.splice(index, 0, next)
    notifyMutation(parent, { type: 'childList', target: parent, addedNodes: [next], removedNodes: [] })
  }
  getRootNode() { return this.ownerDocument || this }
  getBoundingClientRect() { return { ...this._rect } }
  closest(selector: string) {
    let current: MiniElement | null = this
    while (current) {
      if (matchesSelector(current, selector)) return current
      current = current.parentElement
    }
    return null
  }
  matches(selector: string) { return matchesSelector(this, selector) }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector: string) { return walkElements(this).filter(el => el !== this && matchesSelector(el, selector)) }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this }
  click() {
    const event = new MiniEvent('click', { bubbles: true, cancelable: true, composed: true })
    this.dispatchEvent(event)
    if (!event.defaultPrevented) this._onClick?.(this, this.ownerDocument!.defaultView)
  }
  addEventListener(type: string, listener: (event: MiniEvent) => void) {
    const list = this._listeners.get(type) ?? []
    list.push(listener)
    this._listeners.set(type, list)
  }
  removeEventListener(type: string, listener: (event: MiniEvent) => void) {
    this._listeners.set(type, (this._listeners.get(type) ?? []).filter(item => item !== listener))
  }
  dispatchEvent(event: MiniEvent) {
    event.target = this
    let current: MiniElement | null = this
    while (current) {
      for (const listener of current._listeners.get(event.type) ?? []) listener(event)
      current = event.bubbles ? current.parentElement : null
    }
    return !event.defaultPrevented
  }
}

class MiniInput extends MiniElement {}
class MiniTextArea extends MiniElement {}
Object.defineProperty(MiniInput.prototype, 'value', {
  get(this: MiniInput) { return this._value },
  set(this: MiniInput, value: string) { this._value = String(value ?? '') },
})
Object.defineProperty(MiniTextArea.prototype, 'value', {
  get(this: MiniTextArea) { return this._value },
  set(this: MiniTextArea, value: string) { this._value = String(value ?? '') },
})

class MiniDocument extends MiniNode {
  documentElement!: MiniElement
  body!: MiniElement
  defaultView!: MiniWindow
  readyState = 'complete'
  title = ''
  URL = 'https://shop.example/'
  activeElement: MiniElement | null = null
  images: MiniElement[] = []
  scrollingElement: MiniElement
  constructor() {
    super(9)
    this.ownerDocument = this
    this.scrollingElement = new MiniElement('html')
    Object.assign(this.scrollingElement, { scrollTop: 0, scrollHeight: 800, clientHeight: 800, scrollWidth: 1280, clientWidth: 1280 })
  }
  createElement(tag: string) {
    const el = tag === 'input' ? new MiniInput(tag) : tag === 'textarea' ? new MiniTextArea(tag) : new MiniElement(tag)
    el.ownerDocument = this
    return el
  }
  createTextNode(text: string) {
    const node = new MiniNode(3)
    node.textContentValue = text
    node.ownerDocument = this
    return node
  }
  getElementById(id: string) { return walkElements(this.documentElement).find(el => el.id === id) || null }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector: string) { return walkElements(this.documentElement).filter(el => matchesSelector(el, selector)) }
  addEventListener(type: string, listener: (event: MiniEvent) => void) {
    this.documentElement.addEventListener(type, listener)
  }
  removeEventListener(type: string, listener: (event: MiniEvent) => void) {
    this.documentElement.removeEventListener(type, listener)
  }
  elementFromPoint(x: number, y: number) {
    return (this.defaultView.elementFromPoint as (x: number, y: number) => MiniElement | null)(x, y)
  }
}

class MiniMutationObserver {
  callback: (records: Array<Record<string, unknown>>) => void
  target: MiniElement | MiniDocument | null = null
  options: { subtree?: boolean; childList?: boolean; attributes?: boolean } | null = null
  constructor(callback: (records: Array<Record<string, unknown>>) => void) { this.callback = callback }
  observe(target: MiniElement | MiniDocument, options: { subtree?: boolean; childList?: boolean; attributes?: boolean }) {
    this.target = target
    this.options = options
    const win = (target as MiniDocument).defaultView || (target as MiniElement).ownerDocument?.defaultView
    win?._observers.push(this)
  }
  disconnect() {
    const win = (this.target as MiniDocument)?.defaultView || (this.target as MiniElement)?.ownerDocument?.defaultView
    if (win) win._observers = win._observers.filter(item => item !== this)
  }
  takeRecords() { return [] }
  _emit(record: Record<string, unknown>) { this.callback([record]) }
}

type MiniWindow = {
  document: MiniDocument
  location: { href: string }
  innerWidth: number
  innerHeight: number
  _observers: MiniMutationObserver[]
  [key: string]: unknown
}

function walkElements(root: MiniElement | null): MiniElement[] {
  if (!root) return []
  const out: MiniElement[] = [root]
  for (const child of root.children) out.push(...walkElements(child))
  return out
}

function matchesOne(el: MiniElement, selector: string): boolean {
  const sel = selector.trim()
  if (!sel) return false
  if (sel === ':disabled') return el.disabled || el.hasAttribute('disabled')
  if (sel === ':checked') return el.checked || el.hasAttribute('checked')
  if (sel === ':focus') return el.ownerDocument?.activeElement === el
  if (sel === ':invalid') return false
  let rest = sel
  const tag = rest.match(/^[a-zA-Z][\w-]*/)
  if (tag) {
    if (el.localName !== tag[0].toLowerCase()) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    if (rest.startsWith('.')) {
      const item = rest.match(/^\.([\w-]+)/)
      if (!item || !el.className.split(/\s+/).includes(item[1])) return false
      rest = rest.slice(item[0].length)
      continue
    }
    if (rest.startsWith('#')) {
      const item = rest.match(/^#([\w-]+)/)
      if (!item || el.id !== item[1]) return false
      rest = rest.slice(item[0].length)
      continue
    }
    if (rest.startsWith('[')) {
      const item = rest.match(/^\[([^\]]+)\]/)
      if (!item) return false
      const eq = item[1].match(/^([\w-]+)(?:\s*=\s*['"]?([^'"\]]*)['"]?)?$/)
      if (!eq) return false
      if (eq[2] === undefined) {
        if (!el.hasAttribute(eq[1])) return false
      } else if (el.getAttribute(eq[1]) !== eq[2]) return false
      rest = rest.slice(item[0].length)
      continue
    }
    if (rest.startsWith(':')) {
      const item = rest.match(/^(:[\w-]+)/)
      if (!item || !matchesOne(el, item[1])) return false
      rest = rest.slice(item[0].length)
      continue
    }
    return false
  }
  return true
}

function matchesSelector(el: MiniElement, selector: string): boolean {
  return selector.split(',').some(part => matchesOne(el, part.trim()))
}

function serializeOuterHTML(el: MiniElement): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const attrs = [...el.attrs.entries()].map(([key, value]) => ` ${key}="${escape(value)}"`).join('')
  const voidTags = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])
  if (voidTags.has(el.localName)) return `<${el.localName}${attrs}>`
  const inner = el.childNodes.map(child => {
    if (child.nodeType === 3) return escape(child.textContent)
    return child instanceof MiniElement ? serializeOuterHTML(child) : ''
  }).join('')
  return `<${el.localName}${attrs}>${inner}</${el.localName}>`
}

function containsNode(ancestor: MiniNode, node: MiniNode | null): boolean {
  let current = node
  while (current) {
    if (current === ancestor) return true
    current = current.parentNode
  }
  return false
}

function notifyMutation(target: MiniElement, record: Record<string, unknown>) {
  const win = target.ownerDocument?.defaultView
  if (!win) return
  for (const observer of win._observers) {
    if (!observer.options || !observer.target) continue
    const root = observer.target as MiniNode
    if (!observer.options.subtree && observer.target !== target) continue
    if (observer.options.subtree && !containsNode(root, target)) continue
    if (record.type === 'childList' && !observer.options.childList) continue
    if (record.type === 'attributes' && !observer.options.attributes) continue
    observer._emit(record)
  }
}

function layoutTree(root: MiniElement, startY = 8) {
  let y = startY
  for (const el of walkElements(root)) {
    el._rect = { x: 8, y, left: 8, top: y, width: 200, height: 20, right: 208, bottom: y + 20 }
    y += 24
  }
}

function mountSpec(parent: MiniElement, spec: PageSpec | string): MiniElement | MiniNode {
  if (typeof spec === 'string') return parent.appendChild(parent.ownerDocument!.createTextNode(spec))
  const el = parent.ownerDocument!.createElement(spec.tag)
  for (const [key, value] of Object.entries(spec.attrs || {})) el.setAttribute(key, value)
  if (spec.value !== undefined) el.value = spec.value
  if (spec.onClick) el._onClick = spec.onClick
  if (spec.text) el.appendChild(parent.ownerDocument!.createTextNode(spec.text))
  for (const child of spec.children || []) mountSpec(el, child)
  parent.appendChild(el)
  return el
}

function createPageRuntime(options: { url?: string; title?: string; tree?: PageSpec[] } = {}) {
  const document = new MiniDocument()
  const html = document.createElement('html')
  const body = document.createElement('body')
  html.appendChild(body)
  html.parentNode = document
  document.childNodes = [html]
  document.documentElement = html
  document.body = body
  document.title = options.title || 'Shop'
  document.URL = options.url || 'https://shop.example/'
  const location = { href: document.URL }
  const win = {
    document,
    location,
    innerWidth: 1280,
    innerHeight: 800,
    _observers: [] as MiniMutationObserver[],
    Node: Object.assign(MiniNode, { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 }),
    Element: MiniElement,
    HTMLInputElement: MiniInput,
    HTMLTextAreaElement: MiniTextArea,
    MutationObserver: MiniMutationObserver,
    InputEvent: MiniInputEvent,
    Event: MiniEvent,
    performance: { now: () => Date.now(), getEntriesByType: () => [] },
    crypto: { randomUUID },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    getComputedStyle: (el: MiniElement) => ({
      display: el.hasAttribute('hidden') ? 'none' : 'block',
      visibility: 'visible',
      opacity: '1',
      overflowX: el.style.overflowX || 'visible',
      overflowY: el.style.overflowY || 'visible',
    }),
    elementFromPoint: (x: number, y: number) => walkElements(document.body).reverse().find(el => {
      const rect = el.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }) || null,
  } as MiniWindow
  document.defaultView = win
  document.scrollingElement = html
  Object.assign(html, { scrollTop: 0, scrollHeight: 800, clientHeight: 800, scrollWidth: 1280, clientWidth: 1280, scrollBy() {} })
  for (const spec of options.tree || []) mountSpec(body, spec)
  layoutTree(html)
  const context = vm.createContext(win)
  context.globalThis = context
  context.window = context
  return {
    window: win,
    document,
    evaluate(code: string) {
      return vm.runInContext(code, context, { timeout: 8000 })
    },
    setURL(url: string) {
      location.href = url
      document.URL = url
    },
    remount(tree: PageSpec[]) {
      body.childNodes = []
      for (const spec of tree) mountSpec(body, spec)
      layoutTree(html)
    },
    replace(predicate: (el: MiniElement) => boolean, spec: PageSpec) {
      const found = walkElements(body).find(predicate)
      if (!found) throw new Error('replace target missing')
      const next = document.createElement(spec.tag) as MiniElement
      for (const [key, value] of Object.entries(spec.attrs || {})) next.setAttribute(key, value)
      if (spec.text) next.appendChild(document.createTextNode(spec.text))
      if (spec.onClick) next._onClick = spec.onClick
      found.replaceWith(next)
      layoutTree(html)
      return next
    },
  }
}

function shopTree(extra: PageSpec[] = []): PageSpec[] {
  return [
    { tag: 'header', children: [{ tag: 'a', attrs: { href: '/' }, text: 'Home' }] },
    { tag: 'nav', children: [{ tag: 'a', attrs: { href: '/about' }, text: 'About' }, { tag: 'a', attrs: { href: '/blog' }, text: 'Blog' }] },
    {
      tag: 'main',
      children: [
        { tag: 'h1', text: 'Catalog' },
        { tag: 'form', attrs: { 'aria-label': 'Search' }, children: [
          { tag: 'input', attrs: { type: 'search', 'aria-label': 'Query' } },
          { tag: 'button', text: 'Go' },
        ] },
        { tag: 'button', text: 'Checkout' },
        ...extra,
      ],
    },
    { tag: 'footer', children: [{ tag: 'a', attrs: { href: '/legal' }, text: 'Legal' }] },
  ]
}

async function liveBrowser(tree: PageSpec[] = shopTree(), url = 'https://shop.example/') {
  const runtime = createPageRuntime({ url, title: 'Shop', tree })
  const harness = browserHarness()
  harness.contents.pageRuntime = runtime
  harness.contents.url = url
  harness.contents.viewport = { width: 1280, height: 800 }
  await harness.host.setViewBounds({ x: 0, y: 0, width: 1280, height: 800, visible: true })
  await harness.host.loadURL(url.replace(/^https?:\/\//, ''))
  harness.contents.url = url
  runtime.setURL(url)
  return { ...harness, runtime }
}

describe('browser regional observe and stable refs', () => {
  it('forwards region/role/name/cursor on observe', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.toolAction(asRequest({ action: 'observe', region: 'main', role: 'button', name: 'Go', cursor: '8' }))
    const injected = String(contents.executeJavaScript.mock.calls.find(([code]) => String(code).includes('__pipiBrowserDOM.dispatch'))?.[0] || '')
    expect(injected).toContain('"region":"main"')
    expect(injected).toContain('"role":"button"')
    expect(injected).toContain('"name":"Go"')
    expect(injected).toContain('"cursor":"8"')
  })

  it('returns region summaries by default', async () => {
    const { host } = await liveBrowser()
    const observed = await host.toolAction({ action: 'observe' })
    expect(observed.ok).toBe(true)
    const regions = observed.regions as Array<{ id: string; name: string; count: number; preview: unknown[] }>
    expect(regions.map(region => region.id)).toEqual(expect.arrayContaining(['banner', 'navigation', 'main', 'form', 'contentinfo']))
    const main = regions.find(region => region.id === 'main')
    expect(main?.count).toBeGreaterThan(0)
    expect(main?.preview?.length).toBeGreaterThan(0)
    expect(main?.preview?.length).toBeLessThanOrEqual(3)
    expect(Array.isArray(observed.elements)).toBe(true)
    expect(webviewSource).toContain('Default returns region summaries')
  })

  it('expands a region and filters by role/name', async () => {
    const { host } = await liveBrowser()
    const expanded = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const elements = expanded.elements as Array<{ role: string; name: string; token: string }>
    expect(elements.some(item => item.name === 'Checkout')).toBe(true)
    expect((expanded.regions as Array<{ expanded?: boolean; id: string }>).some(region => region.id === 'main' && region.expanded)).toBe(true)
    const buttons = await host.toolAction(asRequest({ action: 'observe', role: 'button', name: 'Go' }))
    const filtered = buttons.elements as Array<{ role: string; name: string }>
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(item => item.role === 'button' && item.name.toLowerCase().includes('go'))).toBe(true)
  })

  it('pages regions with cursor and keeps the 20k budget', async () => {
    const manyNavs: PageSpec[] = Array.from({ length: 12 }, (_, index) => ({
      tag: 'nav',
      attrs: { 'aria-label': `Section ${index}` },
      children: [{ tag: 'a', attrs: { href: `/${index}` }, text: `Link ${index}` }],
    }))
    const { host } = await liveBrowser(manyNavs)
    const first = await host.toolAction({ action: 'observe' })
    const firstRegions = first.regions as unknown[]
    expect(firstRegions.length).toBeLessThanOrEqual(8)
    expect(first.nextCursor).toBeDefined()
    const second = await host.toolAction(asRequest({ action: 'observe', cursor: String(first.nextCursor) }))
    expect((second.regions as unknown[]).length).toBeGreaterThan(0)
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(20_000)
  })

  it('relocates a unique same-page remount and marks relocated', async () => {
    const { host, runtime } = await liveBrowser()
    const expanded = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const checkout = (expanded.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Checkout')
    expect(checkout?.token).toBeTruthy()
    runtime.replace(el => el.localName === 'button' && el.textContent === 'Checkout', { tag: 'button', text: 'Checkout' })
    const clicked = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: checkout!.token,
    })
    expect(clicked).toMatchObject({ ok: true, relocated: true })
  })

  it('does not relocate a unique remount that sits outside the viewport', async () => {
    const { host, runtime } = await liveBrowser()
    const expanded = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const checkout = (expanded.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Checkout')
    const next = runtime.replace(el => el.localName === 'button' && el.textContent === 'Checkout', { tag: 'button', text: 'Checkout' })
    next._rect = { x: 8, y: 4000, left: 8, top: 4000, width: 200, height: 20, right: 208, bottom: 4020 }
    const failed = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: checkout!.token,
    })
    expect(failed).toMatchObject({ ok: false, code: 'stale_browser_snapshot' })
    expect(String(failed.error)).toMatch(/could not be relocated|URL changed|multiple candidates/i)
  })

  it('refuses to relocate when multiple same-name controls remain', async () => {
    const { host, runtime } = await liveBrowser([
      ...shopTree(),
      { tag: 'main', children: [{ tag: 'button', text: 'Save' }, { tag: 'button', text: 'Save' }] },
    ])
    const expanded = await host.toolAction(asRequest({ action: 'observe', role: 'button', name: 'Save' }))
    const first = (expanded.elements as Array<{ name: string; token: string }>)[0]
    const save = walkElements(runtime.document.body).find(el => el.localName === 'button' && el.textContent === 'Save')
    save?.remove()
    const failed = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: first.token,
    })
    expect(failed).toMatchObject({ ok: false, code: 'stale_browser_snapshot' })
    expect(String(failed.error)).toMatch(/multiple candidates|could not be relocated/i)
  })

  it('does not relocate after the document URL changes', async () => {
    const { host, runtime } = await liveBrowser()
    const expanded = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const checkout = (expanded.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Checkout')
    runtime.setURL('https://shop.example/cart')
    const failed = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: checkout!.token,
    })
    expect(failed).toMatchObject({ ok: false, code: 'stale_browser_snapshot' })
    expect(String(failed.error)).toMatch(/URL changed/i)
  })

  it('attaches a compressed mutation summary after a click', async () => {
    const { host } = await liveBrowser(shopTree([
      {
        tag: 'button',
        text: 'Open dialog',
        onClick(_el, win) {
          const dialog = win.document.createElement('dialog')
          dialog.setAttribute('role', 'dialog')
          dialog.setAttribute('open', '')
          dialog.appendChild(win.document.createTextNode('Confirm purchase'))
          win.document.body.appendChild(dialog)
        },
      },
    ]))
    const expanded = await host.toolAction(asRequest({ action: 'observe', role: 'button', name: 'open dialog' }))
    const button = (expanded.elements as Array<{ name: string; token: string }>)[0]
    const clicked = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: button.token,
    })
    expect(clicked.ok).toBe(true)
    expect(clicked.mutation).toEqual(expect.objectContaining({
      added: expect.any(Number),
      removed: expect.any(Number),
      attributes: expect.any(Number),
      urlChanged: false,
    }))
    expect((clicked.mutation as { added: number }).added).toBeGreaterThan(0)
    expect((clicked.mutation as { dialogs: string[] }).dialogs.join(' ')).toMatch(/Confirm purchase|dialog/i)
  })

  it('reports mutation magnitudes instead of exact counts when over budget', async () => {
    const { host } = await liveBrowser(shopTree([
      {
        tag: 'button',
        text: 'Burst',
        onClick(_el, win) {
          for (let index = 0; index < 100; index += 1) {
            const node = win.document.createElement('div')
            node.appendChild(win.document.createTextNode(`row-${index}`))
            win.document.body.appendChild(node)
          }
        },
      },
    ]))
    const expanded = await host.toolAction(asRequest({ action: 'observe', role: 'button', name: 'burst' }))
    const button = (expanded.elements as Array<{ name: string; token: string }>)[0]
    const clicked = await host.toolAction({
      action: 'click',
      snapshot_id: String(expanded.snapshotID),
      element_token: button.token,
    })
    expect(clicked.ok).toBe(true)
    const mutation = clicked.mutation as { added: unknown; removed: unknown; attributes: unknown; dialogs: unknown; truncated?: boolean; samples?: unknown }
    expect(mutation.truncated).toBe(true)
    expect(mutation.added).toBe('many')
    expect(['none', 'few', 'some', 'many']).toContain(mutation.removed)
    expect(['none', 'few', 'some', 'many']).toContain(mutation.attributes)
    expect(mutation.samples).toBeUndefined()
    expect(JSON.stringify(mutation)).not.toMatch(/"added":\s*100/)
  })

  it('redacts secrets in the regional observe envelope', async () => {
    const secret = 's3cret-token-zz'
    const { host } = await liveBrowser([
      {
        tag: 'main',
        children: [
          { tag: 'input', attrs: { type: 'password', 'aria-label': 'Password' }, value: secret },
          { tag: 'button', text: secret },
        ],
      },
    ])
    const observed = await host.toolAction({ action: 'observe' })
    expect(JSON.stringify(observed)).not.toContain(secret)
    expect(JSON.stringify(observed)).toContain('[redacted]')
    const expanded = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    expect(JSON.stringify(expanded)).not.toContain(secret)
  })

  it('keeps target=both regional observations viewport-scoped', async () => {
    const { host, created } = multiViewHarness()
    const desktopRuntime = createPageRuntime({ url: 'https://shop.example/', title: 'Shop', tree: shopTree() })
    const mobileRuntime = createPageRuntime({ url: 'https://shop.example/', title: 'Shop', tree: shopTree() })
    await host.setViewBounds(asBounds({
      x: 10, y: 20, width: 700, height: 500, visible: true, mode: 'desktop',
      mobileOverlay: { visible: true, applyDeviceEmulation: true },
    }))
    created[0].contents.pageRuntime = desktopRuntime
    created[1].contents.pageRuntime = mobileRuntime
    await host.loadURL('shop.example')
    desktopRuntime.setURL('https://shop.example/')
    mobileRuntime.setURL('https://shop.example/')
    const both = await host.toolAction(asRequest({ action: 'observe', target: 'both' }))
    expect(both).toMatchObject({ ok: true, target: 'both' })
    expect(both.desktop).toMatchObject({ viewportTarget: 'desktop' })
    expect(both.mobile).toMatchObject({ viewportTarget: 'mobile' })
    expect(String((both.desktop as { snapshotID: string }).snapshotID)).toMatch(/^desktop:/)
    expect(String((both.mobile as { snapshotID: string }).snapshotID)).toMatch(/^mobile:/)
    const desktopPreview = ((both.desktop as { regions: Array<{ preview: Array<{ token: string }> }> }).regions[0]?.preview || [])[0]
    const mobilePreview = ((both.mobile as { regions: Array<{ preview: Array<{ token: string }> }> }).regions[0]?.preview || [])[0]
    expect(desktopPreview?.token).toMatch(/^desktop:/)
    expect(mobilePreview?.token).toMatch(/^mobile:/)
  })
})

describe('browser selector-targeted scroll', () => {
  function scrollContainerTree(): PageSpec[] {
    return [
      {
        tag: 'main',
        children: [
          {
            tag: 'div',
            attrs: { id: 'scroll-container' },
            children: [
              { tag: 'p', attrs: { id: 'inner-row' }, text: 'row one' },
              { tag: 'p', text: 'row two' },
            ],
          },
          { tag: 'button', text: 'Checkout' },
        ],
      },
    ]
  }

  function makeScrollable(el: MiniElement, scrollHeight: number, clientHeight: number) {
    const scrollBy = vi.fn()
    el.style.overflowY = 'auto'
    Object.assign(el, { scrollTop: 0, scrollHeight, clientHeight, scrollWidth: 1280, clientWidth: 1280, scrollBy })
    return scrollBy
  }

  function guardPageScroll(runtime: { document: MiniDocument }) {
    const page = runtime.document.scrollingElement
    const scrollBy = vi.fn()
    Object.assign(page, { scrollBy })
    return { page, scrollBy }
  }

  it('scrolls the unique selector-matched container and leaves the page unscrolled', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const container = walkElements(runtime.document.body).find(el => el.id === 'scroll-container')!
    const containerScrollBy = makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', selector: '#scroll-container', direction: 'down', amount: 0.8 }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', direction: 'down', target: 'element' })
    expect(containerScrollBy).toHaveBeenCalledTimes(1)
    expect(containerScrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 0, top: 320 }))
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('climbs from a selector-matched child to the scrollable ancestor', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const container = walkElements(runtime.document.body).find(el => el.id === 'scroll-container')!
    const containerScrollBy = makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', selector: '#inner-row', direction: 'up', amount: 1 }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', target: 'ancestor' })
    expect(containerScrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: -400 }))
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('scrolls a visible aria-disabled container instead of rejecting it as disabled', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          {
            tag: 'div',
            attrs: { id: 'disabled-scroll', 'aria-disabled': 'true' },
            children: [{ tag: 'p', text: 'row one' }, { tag: 'p', text: 'row two' }],
          },
        ],
      },
    ])
    const container = walkElements(runtime.document.body).find(el => el.id === 'disabled-scroll')!
    const containerScrollBy = makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', selector: '#disabled-scroll', direction: 'down', amount: 0.8 }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', target: 'element' })
    expect(containerScrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 0, top: 320 }))
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('fails a zero-match scroll selector instead of scrolling the page', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', selector: '#missing' }))

    expect(result).toMatchObject({ ok: false, code: 'browser_locator_not_found' })
    expect(String(result.error)).toMatch(/0 elements/)
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('fails an ambiguous scroll selector instead of picking silently', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          { tag: 'div', attrs: { 'class': 'scroller' }, text: 'one' },
          { tag: 'div', attrs: { 'class': 'scroller' }, text: 'two' },
        ],
      },
    ])
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', selector: '.scroller' }))

    expect(result).toMatchObject({ ok: false, code: 'browser_locator_ambiguous' })
    expect(String(result.error)).toMatch(/matched 2 elements/)
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('keeps selector-less page scroll unchanged', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', direction: 'down', amount: 0.5 }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', target: 'page' })
    expect(pageScrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 400 }))
  })

  it('keeps snapshot-targeted scroll working', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const observed = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const checkout = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Checkout')
    expect(checkout?.token).toBeTruthy()

    const result = await host.toolAction(asRequest({
      action: 'scroll',
      snapshot_id: String(observed.snapshotID),
      element_token: checkout!.token,
    }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', target: 'page' })
    expect(pageScrollBy).toHaveBeenCalled()
  })

  it('scrolls a unique locator-matched container without converting the locator to CSS', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          {
            tag: 'div',
            attrs: { id: 'scroll-container', role: 'region', 'aria-label': 'Feed' },
            children: [
              { tag: 'p', attrs: { id: 'inner-row' }, text: 'row one' },
              { tag: 'p', text: 'row two' },
            ],
          },
          { tag: 'button', text: 'Checkout' },
        ],
      },
    ])
    const container = walkElements(runtime.document.body).find(el => el.id === 'scroll-container')!
    const containerScrollBy = makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({
      action: 'scroll',
      locator: { role: 'region', name: 'Feed' },
      direction: 'down',
      amount: 0.8,
    }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', direction: 'down', target: 'element' })
    expect(containerScrollBy).toHaveBeenCalledTimes(1)
    expect(containerScrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 0, top: 320 }))
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('climbs from a locator-matched child to the scrollable ancestor', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          {
            tag: 'div',
            attrs: { id: 'scroll-container', role: 'region', 'aria-label': 'Feed' },
            children: [{ tag: 'p', attrs: { id: 'inner-row' }, text: 'row one' }],
          },
        ],
      },
    ])
    const container = walkElements(runtime.document.body).find(el => el.id === 'scroll-container')!
    const containerScrollBy = makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({
      action: 'scroll',
      locator: { css: '#inner-row' },
      direction: 'up',
      amount: 1,
    }))

    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ kind: 'scroll', target: 'ancestor' })
    expect(containerScrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: -400 }))
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('fails a zero-match scroll locator instead of scrolling the page', async () => {
    const { host, runtime } = await liveBrowser(scrollContainerTree())
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({
      action: 'scroll',
      locator: { role: 'region', name: 'NoSuch' },
    }))

    expect(result).toMatchObject({ ok: false, code: 'browser_locator_not_found' })
    expect(String(result.error)).toMatch(/0 elements/)
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('fails an ambiguous scroll locator instead of scrolling the page', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          { tag: 'div', attrs: { role: 'region', 'aria-label': 'One' }, text: 'one' },
          { tag: 'div', attrs: { role: 'region', 'aria-label': 'Two' }, text: 'two' },
        ],
      },
    ])
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({ action: 'scroll', locator: { role: 'region' } }))

    expect(result).toMatchObject({ ok: false, code: 'browser_locator_ambiguous' })
    expect(String(result.error)).toMatch(/name|nth/i)
    expect(pageScrollBy).not.toHaveBeenCalled()
  })

  it('fails a hidden scroll locator instead of scrolling the page', async () => {
    const { host, runtime } = await liveBrowser([
      {
        tag: 'main',
        children: [
          {
            tag: 'div',
            attrs: { id: 'hidden-scroll', hidden: '', role: 'region', 'aria-label': 'HiddenFeed' },
            children: [{ tag: 'p', text: 'row' }],
          },
        ],
      },
    ])
    const container = walkElements(runtime.document.body).find(el => el.id === 'hidden-scroll')!
    makeScrollable(container, 2400, 400)
    const { scrollBy: pageScrollBy } = guardPageScroll(runtime)

    const result = await host.toolAction(asRequest({
      action: 'scroll',
      locator: { role: 'region', name: 'HiddenFeed' },
    }))

    expect(result).toMatchObject({ ok: false, code: 'browser_target_not_actionable' })
    expect(String(result.error)).toMatch(/hidden/i)
    expect(pageScrollBy).not.toHaveBeenCalled()
  })
})

describe('browser semantic locators', () => {
  it('forwards locator through the host dispatcher', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Go' } }))
    const injected = String(contents.executeJavaScript.mock.calls.find(([code]) => String(code).includes('__pipiBrowserDOM.dispatch'))?.[0] || '')
    expect(injected).toContain('"locator"')
    expect(injected).toContain('"role":"button"')
    expect(injected).toContain('"name":"Go"')
    expect(webviewSource).toContain('locator: Type.Optional')
    expect(webviewSource).toMatch(/\{role, name\?\}/)
  })

  it('clicks, inputs, and selects by locator without a snapshot', async () => {
    const { host, runtime } = await liveBrowser(shopTree([
      {
        tag: 'select',
        attrs: { 'aria-label': 'Color' },
        children: [
          { tag: 'option', attrs: { value: 'red' }, text: 'Red' },
          { tag: 'option', attrs: { value: 'blue' }, text: 'Blue' },
        ],
      },
    ]))
    const clicked = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Checkout' } }))
    expect(clicked.ok).toBe(true)
    const typed = await host.toolAction(asRequest({ action: 'input', locator: { label: 'Query' }, text: 'hello' }))
    expect(typed.ok).toBe(true)
    const query = walkElements(runtime.document.body).find(el => el.getAttribute('aria-label') === 'Query')
    expect(query?.value).toBe('hello')
    const selected = await host.toolAction(asRequest({ action: 'select', locator: { label: 'Color' }, option: 'blue' }))
    expect(selected.ok).toBe(true)
    const color = walkElements(runtime.document.body).find(el => el.localName === 'select')
    expect(color?.value).toBe('blue')
    const byText = await host.toolAction(asRequest({ action: 'click', locator: { text: 'Go' } }))
    expect(byText.ok).toBe(true)
    const byCss = await host.toolAction(asRequest({ action: 'click', locator: { css: 'button', nth: 1 } }))
    expect(byCss.ok).toBe(true)
  })

  it('errors on zero match and lists role/tag/name candidates', async () => {
    const { host } = await liveBrowser()
    const failed = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'NoSuch' } }))
    expect(failed).toMatchObject({ ok: false, code: 'browser_locator_not_found' })
    expect(String(failed.error)).toMatch(/matched 0 elements/i)
    const candidates = failed.candidates as Array<{ role: string; tag: string; name: string }>
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.length).toBeLessThanOrEqual(5)
    expect(candidates[0]).toEqual(expect.objectContaining({
      role: expect.any(String),
      tag: expect.any(String),
      name: expect.any(String),
    }))
    expect(candidates.some(item => /checkout|go/i.test(item.name))).toBe(true)
  })

  it('errors on multiple matches and requires name or nth', async () => {
    const { host } = await liveBrowser()
    const failed = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button' } }))
    expect(failed).toMatchObject({ ok: false, code: 'browser_locator_ambiguous' })
    expect(String(failed.error)).toMatch(/name|nth/i)
    const candidates = failed.candidates as Array<{ role: string; tag: string; name: string }>
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates.every(item => item.role === 'button')).toBe(true)
    const disambiguated = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Go' } }))
    expect(disambiguated.ok).toBe(true)
  })

  it('rejects locator combined with token or index', async () => {
    const { host } = await liveBrowser()
    const withToken = await host.toolAction(asRequest({
      action: 'click',
      locator: { role: 'button', name: 'Checkout' },
      element_token: 'tok-x',
    }))
    expect(withToken).toMatchObject({ ok: false, code: 'invalid_browser_target' })
    expect(String(withToken.error)).toMatch(/exactly one of element_index, element_token, or locator/i)
    const withIndex = await host.toolAction(asRequest({
      action: 'click',
      locator: { role: 'button', name: 'Checkout' },
      snapshot_id: 'snap-x',
      element_index: 0,
    }))
    expect(withIndex).toMatchObject({ ok: false, code: 'invalid_browser_target' })
  })

  it('runs locator targets through visibility and obscuring checks', async () => {
    const { host, runtime } = await liveBrowser([
      { tag: 'button', attrs: { hidden: '' }, text: 'Ghost' },
      { tag: 'button', text: 'Pay' },
      { tag: 'div', attrs: { id: 'veil' }, text: 'cover' },
    ])
    const hidden = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Ghost' } }))
    expect(hidden).toMatchObject({ ok: false, code: 'browser_target_not_actionable' })
    expect(String(hidden.error)).toMatch(/hidden|disabled|not interactive/i)
    const pay = walkElements(runtime.document.body).find(el => el.textContent === 'Pay')
    const veil = walkElements(runtime.document.body).find(el => el.id === 'veil')
    const rect = { x: 8, y: 40, left: 8, top: 40, width: 200, height: 20, right: 208, bottom: 60 }
    if (pay) pay._rect = rect
    if (veil) veil._rect = rect
    const obscured = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Pay' } }))
    expect(obscured).toMatchObject({ ok: false, code: 'browser_target_obscured' })
  })

  it('rejects off-screen locator targets before acting', async () => {
    const { host, runtime } = await liveBrowser([
      { tag: 'button', text: 'Offscreen' },
      { tag: 'input', attrs: { 'aria-label': 'Note' } },
    ])
    const button = walkElements(runtime.document.body).find(el => el.localName === 'button')
    const note = walkElements(runtime.document.body).find(el => el.getAttribute('aria-label') === 'Note')
    expect(button && note).toBeTruthy()
    const offscreen = { x: 8, y: 2400, left: 8, top: 2400, width: 200, height: 20, right: 208, bottom: 2420 }
    button!._rect = offscreen
    const failed = await host.toolAction(asRequest({ action: 'click', locator: { role: 'button', name: 'Offscreen' } }))
    expect(failed).toMatchObject({ ok: false, code: 'browser_target_not_actionable' })
    expect(String(failed.error)).toMatch(/off-screen|hidden|not interactive/i)
    note!._rect = offscreen
    const typed = await host.toolAction(asRequest({ action: 'input', locator: { label: 'Note' }, text: 'nope' }))
    expect(typed).toMatchObject({ ok: false, code: 'browser_target_not_actionable' })
  })

  it('clicks a zero-width in-viewport option via locator hit-test fallback', async () => {
    let selected = ''
    const { host, runtime } = await liveBrowser([
      {
        tag: 'div',
        attrs: { role: 'listbox', 'aria-label': 'Name' },
        children: [
          { tag: 'div', attrs: { role: 'option' }, text: 'jack', onClick: () => { selected = 'jack' } },
        ],
      },
    ])
    const listbox = walkElements(runtime.document.body).find(el => el.getAttribute('role') === 'listbox')
    const option = walkElements(runtime.document.body).find(el => el.getAttribute('role') === 'option')
    expect(listbox && option).toBeTruthy()
    const box = { x: 304, y: 716, left: 304, top: 716, width: 200, height: 22, right: 504, bottom: 738 }
    listbox!._rect = box
    option!._rect = { ...box, width: 0, right: 304 }
    const clicked = await host.toolAction(asRequest({ action: 'click', locator: { role: 'option', name: 'jack' } }))
    expect(clicked.ok).toBe(true)
    expect(selected).toBe('jack')
  })
})

function checkoutFormTree(): PageSpec[] {
  return [{
    tag: 'form',
    attrs: { 'aria-label': 'Checkout' },
    children: [
      { tag: 'label', attrs: { for: 'name' }, text: 'Full name' },
      { tag: 'input', attrs: { id: 'name', type: 'text', 'aria-label': 'Full name' } },
      { tag: 'label', attrs: { for: 'email' }, text: 'Email' },
      { tag: 'input', attrs: { id: 'email', type: 'email', 'aria-label': 'Email' } },
      { tag: 'label', attrs: { for: 'city' }, text: 'City' },
      { tag: 'input', attrs: { id: 'city', type: 'text', class: 'city', 'aria-label': 'City' } },
      { tag: 'label', attrs: { for: 'pw' }, text: 'Password' },
      { tag: 'input', attrs: { id: 'pw', type: 'password', 'aria-label': 'Password' } },
      { tag: 'button', text: 'Pay' },
    ],
  }]
}

function formControls(runtime: ReturnType<typeof createPageRuntime>) {
  const byId = (id: string) => walkElements(runtime.document.body).find(el => el.id === id)
  return {
    name: byId('name')!,
    email: byId('email')!,
    city: byId('city')!,
    password: byId('pw')!,
  }
}

describe('browser fill_form batch API', () => {
  it('fills every token field and returns a mutation summary', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const elements = observed.elements as Array<{ name: string; token: string }>
    const name = elements.find(item => item.name === 'Full name')
    const email = elements.find(item => item.name === 'Email')
    expect(name?.token && email?.token).toBeTruthy()
    const filled = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [
        { element_token: name!.token, value: 'Ada Lovelace' },
        { element_token: email!.token, value: 'ada@example.com' },
      ],
    }))
    expect(filled).toMatchObject({
      ok: true,
      filled: 2,
      failed: 0,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: true },
      ],
    })
    expect(filled.mutation).toEqual(expect.objectContaining({
      added: expect.anything(),
      removed: expect.anything(),
      attributes: expect.anything(),
      urlChanged: false,
    }))
    const controls = formControls(runtime)
    expect(controls.name.value).toBe('Ada Lovelace')
    expect(controls.email.value).toBe('ada@example.com')
  })

  it('continues after a missing token and reports per-field failure', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const email = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Email')
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [
        { element_token: 'missing-token', value: 'skip' },
        { element_token: email!.token, value: 'ok@example.com' },
      ],
    }))
    expect(result).toMatchObject({
      ok: true,
      filled: 1,
      failed: 1,
      results: [
        { index: 0, ok: false, error: 'stale_browser_snapshot' },
        { index: 1, ok: true },
      ],
    })
    const controls = formControls(runtime)
    expect(controls.email.value).toBe('ok@example.com')
    expect(controls.name.value).toBe('')
  })

  it('refuses sensitive fields with user_handoff_required and keeps filling others', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const elements = observed.elements as Array<{ name: string; token: string }>
    const name = elements.find(item => item.name === 'Full name')
    const password = elements.find(item => item.name === 'Password')
    const city = elements.find(item => item.name === 'City')
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [
        { element_token: name!.token, value: 'Ada' },
        { element_token: password!.token, value: 's3cret-should-not-write' },
        { element_token: city!.token, value: 'London' },
      ],
    }))
    expect(result).toMatchObject({
      ok: true,
      filled: 2,
      failed: 1,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: false, error: 'user_handoff_required' },
        { index: 2, ok: true },
      ],
    })
    const controls = formControls(runtime)
    expect(controls.name.value).toBe('Ada')
    expect(controls.password.value).toBe('')
    expect(controls.city.value).toBe('London')
    expect(JSON.stringify(result)).not.toContain('s3cret-should-not-write')
  })

  it('accepts a mix of snapshot tokens and live locators', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const name = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Full name')
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [
        { element_token: name!.token, value: 'Ada Lovelace' },
        { locator: { role: 'textbox', name: 'Email' }, value: 'ada@example.com' },
        { locator: { css: 'input.city' }, value: 'London' },
      ],
    }))
    expect(result).toMatchObject({
      ok: true,
      filled: 3,
      failed: 0,
      results: [
        { index: 0, ok: true },
        { index: 1, ok: true },
        { index: 2, ok: true },
      ],
    })
    const controls = formControls(runtime)
    expect(controls.name.value).toBe('Ada Lovelace')
    expect(controls.email.value).toBe('ada@example.com')
    expect(controls.city.value).toBe('London')
  })

  it('attaches one mutation summary for the whole batch', async () => {
    const { host } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const email = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Email')
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [{ element_token: email!.token, value: 'batch@example.com' }],
    }))
    expect(result.ok).toBe(true)
    expect(result.filled).toBe(1)
    expect(result.mutation).toEqual(expect.objectContaining({
      added: expect.anything(),
      removed: expect.anything(),
      attributes: expect.anything(),
      urlChanged: false,
    }))
    expect(result.action).toEqual(expect.objectContaining({ kind: 'fill_form', filled: 1, failed: 0 }))
    expect(webviewSource).toContain('fill_form {fields, snapshot_id?}')
  })

  it('keeps locator candidates and disambiguation text on a failed field', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      fields: [
        { locator: { role: 'textbox', name: 'NoSuch' }, value: 'skip' },
        { locator: { label: 'Email' }, value: 'ok@example.com' },
      ],
    }))
    expect(result).toMatchObject({
      ok: true,
      filled: 1,
      failed: 1,
      results: [
        { index: 0, ok: false, error: 'browser_locator_not_found' },
        { index: 1, ok: true },
      ],
    })
    const failed = (result.results as Array<{ candidates?: unknown; message?: string }>)[0]
    expect(Array.isArray(failed.candidates)).toBe(true)
    expect(String(failed.message || '')).toMatch(/matched 0 elements/i)
    expect(formControls(runtime).email.value).toBe('ok@example.com')
  })

  it('invalidates the snapshot when every field fails after dispatching events', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const observed = await host.toolAction(asRequest({ action: 'observe', role: 'textbox' }))
    const name = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Full name')
    const email = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Email')
    expect(name?.token && email?.token).toBeTruthy()
    const cancel = (event: { preventDefault(): void }) => event.preventDefault()
    formControls(runtime).name.addEventListener('beforeinput', cancel)
    formControls(runtime).email.addEventListener('beforeinput', cancel)
    const result = await host.toolAction(asRequest({
      action: 'fill_form',
      snapshot_id: String(observed.snapshotID),
      fields: [
        { element_token: name!.token, value: 'Ada' },
        { element_token: email!.token, value: 'ada@example.com' },
      ],
    }))
    expect(result).toMatchObject({ ok: true, filled: 0, failed: 2 })
    const retry = await host.toolAction(asRequest({
      action: 'input',
      snapshot_id: String(observed.snapshotID),
      element_token: name!.token,
      text: 'Ada',
    }))
    expect(retry).toMatchObject({ ok: false, code: 'stale_browser_snapshot' })
  })
})

describe('browser bypass redaction', () => {
  const secret = 's3cret-token-zz'

  function secretTree(extra: PageSpec[] = []): PageSpec[] {
    return [{
      tag: 'main',
      children: [
        { tag: 'input', attrs: { id: 'pw', type: 'password', 'aria-label': 'Password', value: secret }, value: secret },
        { tag: 'button', attrs: { id: 'go' }, text: secret },
        ...extra,
      ],
    }]
  }

  it('redacts sensitive values from selector, eval, content, and script output', async () => {
    const { host, contents } = await liveBrowser(secretTree())
    const evaluated = await host.toolAction({ action: 'eval', js: 'document.querySelector("#pw").value' })
    expect(evaluated).toMatchObject({ ok: true, result: '[redacted]' })
    expect(JSON.stringify(evaluated)).not.toContain(secret)

    const textDump = await host.toolAction({ action: 'content', mode: 'text' })
    expect(textDump.ok).toBe(true)
    expect(String(textDump.content)).toContain('[redacted]')
    expect(JSON.stringify(textDump)).not.toContain(secret)

    const htmlDump = await host.toolAction({ action: 'content', mode: 'html' })
    expect(htmlDump.ok).toBe(true)
    expect(String(htmlDump.content)).toContain('[redacted]')
    expect(JSON.stringify(htmlDump)).not.toContain(secret)

    const observed = await host.toolAction(asRequest({ action: 'observe', region: 'main' }))
    const password = (observed.elements as Array<{ name: string; token: string }>).find(item => item.name === 'Password')
    expect(password?.token).toBeTruthy()
    const token = parseBrowserSnapshotTarget(password!.token).id
    const scripted = await host.toolAction({
      action: 'script',
      js: `const node = el(${JSON.stringify(token)}); const value = node.value; step(value); return value;`,
    })
    expect(scripted.ok).toBe(true)
    expect(scripted.result).toBe('[redacted]')
    expect(JSON.stringify(scripted)).not.toContain(secret)
    expect(JSON.stringify(scripted.steps)).toContain('[redacted]')

    const selected = await host.toolAction({ action: 'click', selector: '#go' })
    expect(selected.ok).toBe(true)
    expect(JSON.stringify(selected)).not.toContain(secret)
    expect(JSON.stringify(selected)).toContain('[redacted]')
    expect(contents.executeJavaScript.mock.calls.some(([code]) => String(code).includes('"action":"sanitize"'))).toBe(true)
    expect(webviewSource).toMatch(/sanitized with the same redaction as observe/)
    expect(webviewSource).not.toMatch(/bypasses structured redaction/)
  })

  it('cleans sensitive URL parameters in bypass output', async () => {
    const href = 'https://shop.example/login?token=leak-token-99&q=ok'
    const { host } = await liveBrowser([
      { tag: 'main', children: [{ tag: 'a', attrs: { href }, text: 'Login' }, { tag: 'p', text: href }] },
    ], href)
    const cleaned = /token=(?:%5Bredacted%5D|\[redacted\])/
    const evaluated = await host.toolAction({ action: 'eval', js: 'location.href' })
    expect(evaluated.ok).toBe(true)
    expect(String(evaluated.result)).toMatch(cleaned)
    expect(JSON.stringify(evaluated)).not.toContain('leak-token-99')

    const dumped = await host.toolAction({ action: 'content', mode: 'html' })
    expect(dumped.ok).toBe(true)
    expect(String(dumped.content)).toMatch(cleaned)
    expect(JSON.stringify(dumped)).not.toContain('leak-token-99')

    const scripted = await host.toolAction({ action: 'script', js: 'return { href: location.href }' })
    expect(scripted.ok).toBe(true)
    expect(JSON.stringify(scripted.result)).toMatch(cleaned)
    expect(JSON.stringify(scripted)).not.toContain('leak-token-99')
  })

  it('fails closed when redaction capacity is exceeded', async () => {
    const oversized = `cap-${'Z'.repeat(5000)}`
    const { host } = await liveBrowser([{
      tag: 'main',
      children: [
        { tag: 'input', attrs: { id: 'pw', type: 'password', 'aria-label': 'Password', value: oversized }, value: oversized },
        { tag: 'button', attrs: { id: 'go' }, text: 'Go' },
      ],
    }])
    const expected = {
      ok: false,
      code: 'browser_redaction_capacity_exceeded',
      redacted: true,
    }
    await expect(host.toolAction({ action: 'eval', js: 'document.querySelector("#pw").value' })).resolves.toMatchObject(expected)
    await expect(host.toolAction({ action: 'content', mode: 'html' })).resolves.toMatchObject(expected)
    await expect(host.toolAction({ action: 'script', js: 'return document.querySelector("#pw").value' })).resolves.toMatchObject(expected)
    await expect(host.toolAction({ action: 'click', selector: '#go' })).resolves.toMatchObject(expected)
    const evaluated = await host.toolAction({ action: 'eval', js: 'document.querySelector("#pw").value' })
    expect(JSON.stringify(evaluated)).not.toContain(oversized.slice(0, 80))
  })

  it('refuses selector writes into sensitive fields', async () => {
    const { host, runtime } = await liveBrowser(checkoutFormTree())
    const result = await host.toolAction({ action: 'input', selector: '#pw', text: 's3cret-should-not-write' })
    expect(result).toMatchObject({ ok: false, code: 'user_handoff_required' })
    expect(formControls(runtime).password.value).toBe('')
    expect(JSON.stringify(result)).not.toContain('s3cret-should-not-write')
  })

  it('does not treat readonly combobox autocomplete traps as sensitive fields', async () => {
    const { host, runtime } = await liveBrowser([{
      tag: 'form',
      attrs: { 'aria-label': 'Profile' },
      children: [
        { tag: 'label', attrs: { for: 'city' }, text: 'City' },
        {
          tag: 'input',
          attrs: {
            id: 'city',
            readonly: '',
            autocomplete: 'new-password',
            role: 'combobox',
            'aria-label': 'City',
          },
        },
        { tag: 'label', attrs: { for: 'province' }, text: 'Province' },
        {
          tag: 'input',
          attrs: {
            id: 'province',
            readonly: '',
            autocomplete: 'new-password',
            'aria-haspopup': 'listbox',
            'aria-label': 'Province',
          },
        },
        { tag: 'label', attrs: { for: 'pw' }, text: 'Password' },
        { tag: 'input', attrs: { id: 'pw', type: 'password', 'aria-label': 'Password' } },
      ],
    }])
    const city = await host.toolAction({ action: 'click', selector: '#city' })
    expect(city).toMatchObject({ ok: true })
    expect(city).not.toMatchObject({ code: 'user_handoff_required' })
    const province = await host.toolAction({ action: 'click', selector: '#province' })
    expect(province).toMatchObject({ ok: true })
    expect(province).not.toMatchObject({ code: 'user_handoff_required' })
    const password = await host.toolAction({ action: 'input', selector: '#pw', text: 's3cret-should-not-write' })
    expect(password).toMatchObject({ ok: false, code: 'user_handoff_required' })
    expect(walkElements(runtime.document.body).find(el => el.id === 'pw')?.value).toBe('')
    expect(JSON.stringify(password)).not.toContain('s3cret-should-not-write')
  })

  it('sanitizes selector execution errors', async () => {
    const { host, contents } = await liveBrowser()
    const inner = contents.executeJavaScript.getMockImplementation()!
    contents.executeJavaScript.mockImplementation(async (code: string) => {
      if (String(code).includes('api.isSensitive') && String(code).includes('document.querySelector(')) {
        throw new Error('selector boom')
      }
      return inner(code)
    })
    const failed = await host.toolAction({ action: 'click', selector: '#go' })
    expect(failed.ok).toBe(false)
    expect(String(failed.error)).toMatch(/selector boom/)
    expect(contents.executeJavaScript.mock.calls.some(([code]) => String(code).includes('"action":"sanitize"'))).toBe(true)
  })

  it('redacts secrets that would straddle the content truncation boundary', async () => {
    const secret = 'BOUNDARY-SECRET-TOKEN-ZZ'
    const beforeValue = '<html><body><main><p></p><input id="pw" type="password" aria-label="Password" value="'
    const pad = 'p'.repeat(Math.max(0, 100_000 - 8 - beforeValue.length))
    const { host } = await liveBrowser([{
      tag: 'main',
      children: [
        { tag: 'p', text: pad },
        { tag: 'input', attrs: { id: 'pw', type: 'password', 'aria-label': 'Password', value: secret }, value: secret },
      ],
    }])
    const dumped = await host.toolAction({ action: 'content', mode: 'html' })
    expect(dumped.ok).toBe(true)
    expect(JSON.stringify(dumped)).not.toContain(secret)
    expect(JSON.stringify(dumped)).not.toContain(secret.slice(0, 12))
  })
})

describe('BrowserSessionHost WatcherRegistry hooks', () => {
  function watchHarness(onWatchTrigger?: (watch: { watchId: string }, reason: string, summary: { url: string; title: string }) => void) {
    const created: Array<{ contents: FakeWebContents; view: BrowserViewLike }> = []
    const createView = vi.fn(() => {
      const contents = new FakeWebContents()
      const view: BrowserViewLike = {
        webContents: contents,
        setBounds: vi.fn(),
        setVisible: vi.fn(),
      }
      created.push({ contents, view })
      return view
    })
    const host = new BrowserSessionHost(createView, { onWatchTrigger })
    host.attachToWindow(vi.fn())
    return { host, created }
  }

  it('fires disposed and unregisters watches when the session is disposed', async () => {
    const triggers: Array<{ reason: string; url: string }> = []
    const { host } = watchHarness((_watch, reason, summary) => {
      triggers.push({ reason, url: summary.url })
    })
    await host.toolAction('sess', { action: 'navigate', url: 'example.com' })
    const registered = host.registerWatch({
      sessionKey: 'sess',
      condition: { type: 'selector', selector: '.ready' },
      timeoutMs: 60_000,
    })
    expect(registered.ok).toBe(true)
    await host.disposeSession('sess')
    expect(triggers).toEqual([expect.objectContaining({ reason: 'disposed', url: 'https://example.com' })])
    expect(host.listWatches()).toEqual([])
    host.watchers.dispose()
  })

  it('notifies disposed even when the session never created a BrowserTabsHost', async () => {
    const triggers: string[] = []
    const { host } = watchHarness((_watch, reason) => { triggers.push(reason) })
    const registered = host.registerWatch({
      sessionKey: 'never-opened',
      condition: { type: 'timer' },
      timeoutMs: 60_000,
    })
    expect(registered.ok).toBe(true)
    expect(host.listWatches('never-opened')).toHaveLength(1)
    await host.disposeSession('never-opened')
    expect(triggers).toEqual(['disposed'])
    expect(host.listWatches()).toEqual([])
    host.watchers.dispose()
  })

  it('fires disposed when the WebView is destroyed', async () => {
    const triggers: string[] = []
    const { host, created } = watchHarness((_watch, reason) => { triggers.push(reason) })
    await host.toolAction('sess', { action: 'navigate', url: 'example.com' })
    host.registerWatch({
      sessionKey: 'sess',
      condition: { type: 'idle' },
      timeoutMs: 60_000,
    })
    created[0].contents.emit('destroyed')
    expect(triggers).toEqual(['disposed'])
    expect(host.listWatches()).toEqual([])
    host.watchers.dispose()
  })

  it('matches selector through the wait_check executeJavaScript channel', async () => {
    const triggers: string[] = []
    const { host, created } = watchHarness((_watch, reason) => { triggers.push(reason) })
    await host.toolAction('sess', { action: 'navigate', url: 'example.com' })
    created[0].contents.waitReady = true
    host.registerWatch({
      sessionKey: 'sess',
      condition: { type: 'selector', selector: '.ready' },
      timeoutMs: 60_000,
    })
    await host.watchers.tick()
    expect(triggers).toEqual(['matched'])
    expect(created[0].contents.executeJavaScript.mock.calls.some(([code]) => String(code).includes('"action":"wait_check"'))).toBe(true)
    host.watchers.dispose()
  })
})

/** Extracts the live per-commit nonce the host baked into the newest dialog hook install. */
function extractDialogNonce(contents: FakeWebContents): string {
  const sources = contents.executeJavaScript.mock.calls.map(([code]) => String(code)).filter(code => code.includes('__pipiuiDialogHook'))
  const match = sources.at(-1)?.match(/__pipiui_js_dialog__ ([0-9a-f]+)/)
  if (!match) throw new Error('dialog hook nonce not found in installed hook source')
  return match[1]!
}

/** Harness with the app-level certificate-error source Electron really emits from. */
function certificateErrorAppHarness() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>()
  const app = {
    on(event: string, listener: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    off(event: string, listener: (...args: any[]) => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== listener))
    },
    emit(event: string, ...args: any[]) {
      listeners.get(event)?.forEach(listener => listener(...args))
    },
    listenerCount(event: string) {
      return listeners.get(event)?.length ?? 0
    }
  }
  const contents = new FakeWebContents()
  const view: BrowserViewLike = {
    webContents: contents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    getVisible: () => false
  }
  const host = new BrowserTabsHost(vi.fn(() => view), undefined, app)
  host.attachToWindow(vi.fn())
  return { host, contents, app }
}

describe('BrowserTabsHost page visibility notices', () => {
  it('emits console events for error/warn page output but not info', async () => {
    const { host, contents } = browserHarness()
    const events: Array<{ type: string; entry?: { level: string; message: string } }> = []
    host.subscribe(event => events.push(event))
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('console.example')
    contents.emit('console-message', { level: 3, message: 'boom', lineNumber: 1, sourceId: 'a.js' })
    contents.emit('console-message', { level: 2, message: 'careful', lineNumber: 2, sourceId: 'b.js' })
    contents.emit('console-message', { level: 1, message: 'quiet', lineNumber: 3, sourceId: 'c.js' })
    const consoleEvents = events.filter(event => event.type === 'console')
    expect(consoleEvents).toHaveLength(2)
    expect(consoleEvents[0]!.entry).toMatchObject({ level: 'error', message: 'boom', tabId: expect.any(String) })
    expect(consoleEvents[1]!.entry).toMatchObject({ level: 'warn', message: 'careful' })
  })

  it('re-emits the nonce-carrying dialog marker as a js-dialog event instead of buffering it', async () => {
    const { host, contents } = browserHarness()
    const events: Array<{ type: string; kind?: string; message?: string }> = []
    host.subscribe(event => events.push(event))
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('dialog.example')
    contents.emit('console-message', { level: 3, message: `__pipiui_js_dialog__ ${extractDialogNonce(contents)} confirm 确认删除？` })
    expect(events).toContainEqual(expect.objectContaining({ type: 'js-dialog', kind: 'confirm', message: '确认删除？' }))
    expect(events.filter(event => event.type === 'console')).toEqual([])
  })

  it('drops forged dialog markers: static text, guessed nonces, and stale nonces never emit js-dialog events', async () => {
    const { host, contents } = browserHarness()
    const events: Array<{ type: string; kind?: string }> = []
    host.subscribe(event => events.push(event))
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('forged.example')
    const staleNonce = extractDialogNonce(contents)
    // A fresh commit rotates the nonce; the page cannot guess the new value.
    contents.commitNavigation('https://forged.example/next')
    const freshNonce = extractDialogNonce(contents)
    expect(freshNonce).not.toBe(staleNonce)
    contents.emit('console-message', { level: 3, message: '__pipiui_js_dialog__ alert static forgery' })
    contents.emit('console-message', { level: 3, message: `__pipiui_js_dialog__ ${staleNonce} prompt stale forgery` })
    contents.emit('console-message', { level: 3, message: '__pipiui_js_dialog__ 00000000000000000000000000000000 alert guessed nonce' })
    expect(events.filter(event => event.type === 'js-dialog')).toEqual([])
    // Forged lines degrade to ordinary console output, not dialog notices.
    expect(events.some(event => event.type === 'console')).toBe(true)
    // A real hook report carrying the live nonce still lands.
    contents.emit('console-message', { level: 3, message: `__pipiui_js_dialog__ ${freshNonce} alert 真实弹窗` })
    expect(events.filter(event => event.type === 'js-dialog')).toEqual([
      expect.objectContaining({ type: 'js-dialog', kind: 'alert', message: '真实弹窗' })
    ])
  })

  it('installs the dialog reporter script after every document commit', async () => {
    const { host, contents } = browserHarness()
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('hook.example')
    const installs = contents.executeJavaScript.mock.calls.filter(([code]) => String(code).includes('__pipiuiDialogHook'))
    expect(installs.length).toBeGreaterThanOrEqual(1)
  })

  it('routes app-level certificate-error events to the owning pane with consecutive dedupe and commit reset', async () => {
    const { host, contents, app } = certificateErrorAppHarness()
    const events: Array<{ type: string; url?: string; reason?: string }> = []
    host.subscribe(event => events.push(event))
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('cert.example')
    const preventDefault = vi.fn()
    // Electron emits certificate-error from `app` with the failing webContents.
    app.emit('certificate-error', { preventDefault }, contents, 'https://self-signed.example', 'ERR_CERT_AUTHORITY_INVALID', {}, vi.fn())
    app.emit('certificate-error', { preventDefault: vi.fn() }, contents, 'https://self-signed.example', 'ERR_CERT_AUTHORITY_INVALID', {}, vi.fn())
    expect(events.filter(event => event.type === 'certificate-error')).toEqual([
      { type: 'certificate-error', url: 'https://self-signed.example', reason: 'ERR_CERT_AUTHORITY_INVALID' }
    ])
    // Observability only: never preventDefault, so the default reject stays in force.
    expect(preventDefault).not.toHaveBeenCalled()
    // The listener must live on `app`; a webContents-level hook never fires in Electron.
    expect(contents.listeners.get('certificate-error')).toBeUndefined()
    contents.commitNavigation('https://ok.example')
    app.emit('certificate-error', { preventDefault: vi.fn() }, contents, 'https://self-signed.example', 'ERR_CERT_AUTHORITY_INVALID', {}, vi.fn())
    expect(events.filter(event => event.type === 'certificate-error')).toHaveLength(2)
    // webContents from another window or session never reach this pane's notices.
    app.emit('certificate-error', { preventDefault: vi.fn() }, new FakeWebContents(), 'https://other.example', 'ERR_CERT_DATE_INVALID', {}, vi.fn())
    expect(events.filter(event => event.type === 'certificate-error')).toHaveLength(2)
  })

  it('unregisters the app-level certificate-error listener on dispose', async () => {
    const { host, contents, app } = certificateErrorAppHarness()
    const events: Array<{ type: string }> = []
    host.subscribe(event => events.push(event))
    await host.setViewBounds({ x: 0, y: 0, width: 800, height: 600, visible: true })
    await host.loadURL('cert.example')
    expect(app.listenerCount('certificate-error')).toBe(1)
    await host.dispose()
    expect(app.listenerCount('certificate-error')).toBe(0)
    app.emit('certificate-error', { preventDefault: vi.fn() }, contents, 'https://self-signed.example', 'ERR_CERT_AUTHORITY_INVALID', {}, vi.fn())
    expect(events.filter(event => event.type === 'certificate-error')).toEqual([])
  })
})

describe('BrowserSessionHost watch visibility events', () => {
  it('emits watch list events on register/unwatch and a trigger event with the reason', async () => {
    let fakeNow = 1000
    const bridgeTrigger = vi.fn()
    const host = new BrowserSessionHost(createViewForSessionHarness(), { now: () => fakeNow, watchIntervalMs: 50, onWatchTrigger: bridgeTrigger })
    const events: Array<{ type: string; sessionId?: string; watches?: unknown[]; trigger?: { reason: string } }> = []
    host.subscribe(event => events.push(event))

    const registered = host.registerWatch({ sessionKey: 's1', condition: { type: 'url_matches', pattern: 'done' }, timeoutMs: 5000 })
    expect(registered.ok).toBe(true)
    expect(host.listWatches('s1')).toHaveLength(1)
    expect(events.filter(event => event.type === 'watch')).toHaveLength(1)
    expect(events[0]!.watches?.[0]).toMatchObject({ condition: { type: 'url_matches', pattern: 'done' } })

    host.unwatch((registered as { watch: { watchId: string } }).watch.watchId)
    expect(events.filter(event => event.type === 'watch')).toHaveLength(2)
    expect(events[1]!.watches).toEqual([])

    const timer = host.registerWatch({ sessionKey: 's1', condition: { type: 'timer' }, timeoutMs: 100 })
    expect(timer.ok).toBe(true)
    fakeNow = 5000
    await host.watchers.tick()
    const fired = events.filter(event => event.type === 'watch' && event.trigger)
    expect(fired).toHaveLength(1)
    expect(fired[0]!.sessionId).toBe('s1')
    expect(fired[0]!.trigger).toMatchObject({ reason: 'timeout' })
    expect(fired[0]!.watches).toEqual([])
    expect(bridgeTrigger).toHaveBeenCalledTimes(1)
    host.watchers.dispose()
  })

  it('re-emits the active watch list as a hydration snapshot on every selectSession', async () => {
    const host = new BrowserSessionHost(createViewForSessionHarness(), { now: () => 1000, watchIntervalMs: 50 })
    const events: Array<{ type: string; sessionId?: string; watches?: unknown[] }> = []
    host.subscribe(event => events.push(event))

    // No dedicated list RPC exists on the host contract; the panel hydrates
    // purely from this snapshot event (mounted before or after the select).
    await host.selectSession('s1')
    expect(events).toEqual([{ type: 'watch', sessionId: 's1', watches: [] }])

    const registered = host.registerWatch({ sessionKey: 's1', condition: { type: 'timer' }, timeoutMs: 5000 })
    expect(registered.ok).toBe(true)
    const watchId = (registered as { watch: { watchId: string } }).watch.watchId

    await host.selectSession('s1')
    const snapshots = events.filter(event => event.type === 'watch')
    expect(snapshots.at(-1)!.watches).toEqual([
      expect.objectContaining({ watchId, condition: { type: 'timer' }, timeoutAt: 6000 })
    ])

    // Session switching scopes the snapshot: the other space sees an empty strip.
    await host.selectSession('s2')
    expect(events.at(-1)).toEqual({ type: 'watch', sessionId: 's2', watches: [] })
    host.watchers.dispose()
  })
})

function createViewForSessionHarness() {
  const contents = new FakeWebContents()
  const view: BrowserViewLike = {
    webContents: contents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    getVisible: () => false
  }
  return vi.fn(() => view)
}

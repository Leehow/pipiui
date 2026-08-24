import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostBridge } from '../../../../packages/pi-backend/src/bridge.ts'
import {
  BrowserWatchCallbackRegistry,
  handleBrowserWatchEvent,
  postBrowserWatchTrigger,
} from '../../../../packages/pi-backend/src/browser-watch-bridge.ts'
import { startBrowserWatchCallbackServer } from '../../../../resources/runtime/pi-ext/subagent/browser-watch-callback.ts'
import {
  BROWSER_WATCH_CUSTOM_TYPE,
  BROWSER_WATCH_STORE_DIRNAME,
  deliverBrowserWatchFollowUp,
  registerBrowserWatchDelivery,
  resetBrowserWatchDeliveryForTests,
} from '../../../../resources/runtime/pi-ext/subagent/browser-watch-delivery.ts'
import { BrowserSessionHost, type BrowserViewLike } from './browser-host.js'

const COMPLETION_STORE_DIRNAME = 'subagent-delivery-obligations'

type SentMessage = {
  customType: string
  content: string
  display: boolean
  details: Record<string, unknown>
}

class FakeWebContents {
  url = 'about:blank'
  waitReady = false
  deferCommit = false
  openDevTools = vi.fn()
  isDevToolsOpened = vi.fn(() => false)
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  loadURL = vi.fn(async (url: string) => {
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
    if (code.includes('"action":"wait_check"')) return { ok: true, ready: this.waitReady }
    if (code.includes('__pipiBrowserDOM.dispatch')) {
      return { ok: true, url: this.url, text: '', snapshotID: 'snap-1', viewport: { width: 800, height: 600 }, elements: [] }
    }
    return { title: `Title for ${this.url}`, url: this.url, content: '' }
  })
  capturePage = vi.fn(async () => ({ toPNG: () => Buffer.from('png') }))
  close = vi.fn()
  isDestroyed = vi.fn(() => false)
  setZoomFactor = vi.fn()
  getZoomFactor = vi.fn(() => 1)
  setUserAgent = vi.fn()
  getUserAgent = vi.fn(() => 'DesktopUA')
  getOSProcessId = vi.fn(() => 1)
  enableDeviceEmulation = vi.fn()
  disableDeviceEmulation = vi.fn()
  session = { clearStorageData: vi.fn(async () => undefined), clearCache: vi.fn(async () => undefined) }
  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }
  off(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter(item => item !== listener))
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach(listener => listener(...args))
  }
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(path)
    }
  }
  walk(root)
  return out
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function rpc(port: number, capability: string, event: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      sessionCapability: capability,
      action: 'browser_watch',
      event,
    }),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function createHarness(sessionId = 'sess-e2e') {
  const root = mkdtempSync(join(tmpdir(), 'pipiui-bw-e2e-'))
  const watchStore = join(root, BROWSER_WATCH_STORE_DIRNAME)
  const completionStore = join(root, COMPLETION_STORE_DIRNAME)
  mkdirSync(completionStore, { recursive: true })
  writeFileSync(join(completionStore, 'SENTINEL'), 'untouched')

  const clock = { now: 1_000 }
  const created: FakeWebContents[] = []
  const host = new BrowserSessionHost(() => {
    const contents = new FakeWebContents()
    created.push(contents)
    const view: BrowserViewLike = {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
    }
    return view
  }, { now: () => clock.now, watchIntervalMs: 50 })
  host.attachToWindow(vi.fn())

  resetBrowserWatchDeliveryForTests()
  const messages: SentMessage[] = []
  const delivered: Array<Record<string, unknown>> = []
  registerBrowserWatchDelivery({
    pi: {
      sendMessage(message) {
        messages.push(message as SentMessage)
      },
    },
    sessionKey: () => sessionId,
    storeDirectory: watchStore,
  })

  const callbacks = new BrowserWatchCallbackRegistry()
  const bridge = new HostBridge({
    onAgentEvent: () => undefined,
    onBrowserWatch: (event, sid) => handleBrowserWatchEvent(event, sid, host, callbacks),
  })
  const port = await bridge.listen()
  const capability = bridge.register(sessionId)

  host.setWatchTrigger((watch, reason, pageSummary) => {
    const target = callbacks.get(watch.sessionKey)
    if (!target) return
    void postBrowserWatchTrigger(target, {
      watchId: watch.watchId,
      reason,
      waitedMs: clock.now - watch.createdAt,
      url: pageSummary.url,
      title: pageSummary.title,
    })
  })

  const server = await startBrowserWatchCallbackServer({
    secret: capability,
    deliver: input => {
      delivered.push(input)
      return deliverBrowserWatchFollowUp(input)
    },
  })
  const subscribed = await rpc(port, capability, {
    op: 'subscribe',
    callbackPort: server.port,
    callbackSecret: capability,
  })
  if (subscribed.body.ok !== true) throw new Error(`subscribe failed: ${JSON.stringify(subscribed.body)}`)

  return {
    sessionId,
    clock,
    host,
    created,
    bridge,
    port,
    capability,
    server,
    messages,
    delivered,
    watchStore,
    completionStore,
    root,
    async register(event: Record<string, unknown>) {
      return rpc(port, capability, { op: 'register', ...event })
    },
    async unwatch(watchId: string) {
      return rpc(port, capability, { op: 'unwatch', watchId })
    },
    async list() {
      return rpc(port, capability, { op: 'list' })
    },
    async waitForWake(count = 1) {
      await waitUntil(() => messages.length >= count, `${count} browser-watch wake(s)`)
    },
    waitCheckCalls() {
      return created.flatMap(contents =>
        contents.executeJavaScript.mock.calls.filter(([code]) => String(code).includes('"action":"wait_check"')),
      )
    },
    async close() {
      host.watchers.dispose()
      await host.disposeSession(sessionId).catch(() => undefined)
      await server.close()
      await bridge.close()
      resetBrowserWatchDeliveryForTests()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

describe('browser watch end-to-end', () => {
  const harnesses: Array<Awaited<ReturnType<typeof createHarness>>> = []

  afterEach(async () => {
    while (harnesses.length) {
      const item = harnesses.pop()
      if (item) await item.close()
    }
    resetBrowserWatchDeliveryForTests()
  })

  async function harness() {
    const item = await createHarness()
    harnesses.push(item)
    return item
  }

  it('trigger: selector match delivers [browser-watch] and unregisters', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/ready' })
    h.created[0].waitReady = true

    const registered = await h.register({ selector: '.ready', timeoutSecs: 30, intervalMs: 50 })
    expect(registered.status).toBe(200)
    expect(registered.body.ok).toBe(true)
    const watchId = String(registered.body.watchId)
    expect(watchId).toMatch(/^bw-/)

    await h.host.watchers.tick()
    await h.waitForWake()

    expect(h.delivered).toEqual([expect.objectContaining({
      watchId,
      reason: 'matched',
      url: 'https://example.com/ready',
    })])
    expect(h.messages).toHaveLength(1)
    expect(h.messages[0].customType).toBe(BROWSER_WATCH_CUSTOM_TYPE)
    expect(h.messages[0].content).toMatch(new RegExp(`^\\[browser-watch\\] watchId=${watchId} reason=matched`))
    expect(h.messages[0].content).toContain('url=https://example.com/ready')
    expect(h.messages[0].details.watchId).toBe(watchId)
    expect(h.messages[0].details.reason).toBe('matched')
    expect((await h.list()).body.watches).toEqual([])
    expect(h.host.listWatches()).toEqual([])
    expect(listFiles(h.completionStore).map(path => path.slice(h.completionStore.length))).toEqual(['/SENTINEL'])
    expect(listFiles(h.watchStore).some(path => path.endsWith('.json'))).toBe(true)
  })

  it('timeout: never-matching watch wakes with last known URL', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/pending' })
    h.created[0].waitReady = false

    const registered = await h.register({ selector: '.never', timeoutSecs: 2, intervalMs: 50 })
    const watchId = String(registered.body.watchId)
    await h.host.watchers.tick()
    expect(h.delivered).toEqual([])

    h.clock.now = 3_500
    await h.host.watchers.tick()
    await h.waitForWake()

    expect(h.delivered).toEqual([expect.objectContaining({
      watchId,
      reason: 'timeout',
      url: 'https://example.com/pending',
    })])
    expect(h.messages[0].content).toMatch(new RegExp(`^\\[browser-watch\\] watchId=${watchId} reason=timeout`))
    expect(h.messages[0].content).toContain('url=https://example.com/pending')
    expect(h.host.listWatches()).toEqual([])
    expect(listFiles(h.completionStore).map(path => path.slice(h.completionStore.length))).toEqual(['/SENTINEL'])
  })

  it('navigation: ticks skip while navigating then match after DOM rebuild', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/start' })
    h.created[0].waitReady = false

    const registered = await h.register({ selector: '.after-nav', timeoutSecs: 30, intervalMs: 50 })
    const watchId = String(registered.body.watchId)
    await h.host.watchers.tick()
    const checksBeforeNav = h.waitCheckCalls().length
    expect(h.delivered).toEqual([])

    h.created[0].deferCommit = true
    h.created[0].waitReady = true
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/rebuilt' })
    expect(h.host.watchers.list(h.sessionId)).toHaveLength(1)

    h.clock.now += 100
    await h.host.watchers.tick()
    expect(h.waitCheckCalls().length).toBe(checksBeforeNav)
    expect(h.delivered).toEqual([])
    expect(h.host.listWatches()).toHaveLength(1)

    h.created[0].deferCommit = false
    h.created[0].commitNavigation(h.created[0].url)
    h.clock.now += 100
    await h.host.watchers.tick()
    await h.waitForWake()

    expect(h.waitCheckCalls().length).toBeGreaterThan(checksBeforeNav)
    expect(h.delivered).toEqual([expect.objectContaining({
      watchId,
      reason: 'matched',
      url: 'https://example.com/rebuilt',
    })])
    expect(h.messages[0].content).toContain(`watchId=${watchId}`)
    expect(h.messages[0].content).toContain('reason=matched')
    expect(h.messages[0].content).toContain('url=https://example.com/rebuilt')
    expect(h.host.listWatches()).toEqual([])
    expect(listFiles(h.completionStore).map(path => path.slice(h.completionStore.length))).toEqual(['/SENTINEL'])
  })

  it('dispose: session dispose and WebView destroy wake disposed and unregister', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/live' })

    const first = await h.register({ selector: '.keep', timeoutSecs: 30, intervalMs: 50 })
    const firstId = String(first.body.watchId)
    await h.host.disposeSession(h.sessionId)
    await h.waitForWake(1)
    expect(h.delivered).toEqual([expect.objectContaining({
      watchId: firstId,
      reason: 'disposed',
      url: 'https://example.com/live',
    })])
    expect(h.messages[0].content).toMatch(new RegExp(`watchId=${firstId} reason=disposed`))
    expect(h.messages[0].content).toContain('url=https://example.com/live')
    expect(h.host.listWatches()).toEqual([])

    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/again' })
    const second = await h.register({ selector: '.again', timeoutSecs: 30, intervalMs: 50 })
    const secondId = String(second.body.watchId)
    const contents = h.created[h.created.length - 1]
    contents.emit('destroyed')
    await h.waitForWake(2)
    expect(h.delivered[1]).toEqual(expect.objectContaining({
      watchId: secondId,
      reason: 'disposed',
    }))
    expect(h.messages[1].content).toContain(`watchId=${secondId}`)
    expect(h.messages[1].content).toContain('reason=disposed')
    expect(h.host.listWatches()).toEqual([])
    expect(listFiles(h.completionStore).map(path => path.slice(h.completionStore.length))).toEqual(['/SENTINEL'])
  })

  it('cancel: unwatch prevents any later wake', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/cancel' })
    h.created[0].waitReady = false

    const registered = await h.register({ selector: '.later', timeoutSecs: 2, intervalMs: 50 })
    const watchId = String(registered.body.watchId)
    const cancelled = await h.unwatch(watchId)
    expect(cancelled.body).toEqual({ ok: true })
    expect(h.host.listWatches()).toEqual([])

    h.created[0].waitReady = true
    h.clock.now = 10_000
    await h.host.watchers.tick()
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(h.delivered).toEqual([])
    expect(h.messages).toEqual([])
    expect(listFiles(h.watchStore)).toEqual([])
    expect(listFiles(h.completionStore).map(path => path.slice(h.completionStore.length))).toEqual(['/SENTINEL'])
  })

  it('regression: no path writes the [subagent-done] durable directory or envelope', async () => {
    const h = await harness()
    await h.host.toolAction(h.sessionId, { action: 'navigate', url: 'example.com/iso' })
    h.created[0].waitReady = true
    await h.register({ selector: '.iso', timeoutSecs: 30, intervalMs: 50 })
    await h.host.watchers.tick()
    await h.waitForWake()

    expect(h.messages[0].customType).toBe(BROWSER_WATCH_CUSTOM_TYPE)
    expect(h.messages[0].customType).not.toContain('subagent-complete')
    expect(h.messages[0].content.startsWith('[browser-watch]')).toBe(true)
    expect(h.messages[0].content.includes('[subagent-done]')).toBe(false)
    expect(listFiles(h.completionStore)).toEqual([join(h.completionStore, 'SENTINEL')])
    expect(listFiles(h.watchStore).some(path => path.endsWith('.json'))).toBe(true)
  })
})

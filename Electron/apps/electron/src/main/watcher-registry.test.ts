import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WATCHER_MAX_WATCHES_PER_SESSION,
  WatcherRegistry,
  type WatchPageSummary,
  type WatchRecord,
  type WatchTriggerReason,
  type WatcherPageAccess,
  type WatchWaitCheckRequest,
} from './watcher-registry.js'

type Trigger = { watch: WatchRecord; reason: WatchTriggerReason; pageSummary: WatchPageSummary }

function mockPage(overrides: Partial<WatcherPageAccess> = {}): WatcherPageAccess {
  return {
    sessionAlive: () => true,
    hasView: () => true,
    isNavigating: () => false,
    getPageSummary: () => ({ url: 'https://example.com/done', title: 'Done' }),
    getURL: () => 'https://example.com/done',
    waitCheck: vi.fn(async (_session: string, _request: WatchWaitCheckRequest) => ({ ready: false })),
    evaluate: async () => false,
    ...overrides,
  }
}

function registry(page: WatcherPageAccess, triggers: Trigger[], now: { value: number }) {
  const handle = new WatcherRegistry({
    page,
    now: () => now.value,
    intervalMs: 2_000,
    watchId: () => 'watch-1',
    onTrigger: (watch, reason, pageSummary) => { triggers.push({ watch, reason, pageSummary }) },
  })
  return handle
}

describe('WatcherRegistry', () => {
  const registries: WatcherRegistry[] = []
  afterEach(() => {
    for (const item of registries) item.dispose()
    registries.length = 0
  })

  function tracked(page: WatcherPageAccess, triggers: Trigger[], now: { value: number }) {
    const handle = registry(page, triggers, now)
    registries.push(handle)
    return handle
  }

  it('matches a selector via waitCheck and unregisters the one-shot watch', async () => {
    const page = mockPage({
      waitCheck: vi.fn(async () => ({ ready: true })),
    })
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const handle = tracked(page, triggers, now)
    const registered = handle.register({
      sessionKey: 'sess-a',
      condition: { type: 'selector', selector: '.ready' },
      timeoutMs: 10_000,
    })
    expect(registered.ok).toBe(true)
    expect(handle.list('sess-a')).toHaveLength(1)
    await handle.tick()
    expect(page.waitCheck).toHaveBeenCalledWith('sess-a', expect.objectContaining({ mode: 'selector', selector: '.ready' }))
    expect(triggers).toEqual([expect.objectContaining({
      reason: 'matched',
      pageSummary: { url: 'https://example.com/done', title: 'Done' },
    })])
    expect(handle.list()).toEqual([])
  })

  it('treats only strict true as an expression match', async () => {
    const evaluate = vi.fn(async () => 1 as unknown)
    const page = mockPage({ evaluate })
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const handle = tracked(page, triggers, now)
    handle.register({ sessionKey: 'sess-a', condition: { type: 'expression', expression: '1' }, timeoutMs: 10_000 })
    await handle.tick()
    expect(triggers).toEqual([])
    evaluate.mockResolvedValue(true)
    now.value = 3_000
    await handle.tick()
    expect(triggers.map(item => item.reason)).toEqual(['matched'])
  })

  it('matches url_matches against the live URL', async () => {
    const page = mockPage({ getURL: () => 'https://news.example.com/story/1' })
    const triggers: Trigger[] = []
    const handle = tracked(page, triggers, { value: 1_000 })
    handle.register({
      sessionKey: 'sess-a',
      condition: { type: 'url_matches', pattern: 'news\\.example\\.com/story/' },
      timeoutMs: 10_000,
    })
    await handle.tick()
    expect(triggers.map(item => item.reason)).toEqual(['matched'])
  })

  it('fires timeout when the condition never matches', async () => {
    const page = mockPage()
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const handle = tracked(page, triggers, now)
    handle.register({ sessionKey: 'sess-a', condition: { type: 'idle' }, timeoutMs: 5_000 })
    await handle.tick()
    expect(triggers).toEqual([])
    now.value = 6_000
    await handle.tick()
    expect(triggers.map(item => item.reason)).toEqual(['timeout'])
    expect(handle.list()).toEqual([])
  })

  it('treats timer watches as an alarm that only fires timeout', async () => {
    const waitCheck = vi.fn(async () => ({ ready: true }))
    const page = mockPage({ waitCheck })
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const handle = tracked(page, triggers, now)
    handle.register({ sessionKey: 'sess-a', condition: { type: 'timer' }, timeoutMs: 4_000 })
    await handle.tick()
    expect(waitCheck).not.toHaveBeenCalled()
    expect(triggers).toEqual([])
    now.value = 5_000
    await handle.tick()
    expect(triggers.map(item => item.reason)).toEqual(['timeout'])
  })

  it('skips a tick while the page is navigating and does not reset the selector', async () => {
    let navigating = true
    let ready = false
    const waitCheck = vi.fn(async () => ({ ready }))
    const page = mockPage({
      isNavigating: () => navigating,
      waitCheck,
    })
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const handle = tracked(page, triggers, now)
    handle.register({ sessionKey: 'sess-a', condition: { type: 'selector', selector: '#ok' }, timeoutMs: 30_000 })
    await handle.tick()
    expect(waitCheck).not.toHaveBeenCalled()
    navigating = false
    ready = true
    now.value = 3_000
    await handle.tick()
    expect(waitCheck).toHaveBeenCalledTimes(1)
    expect(triggers.map(item => item.reason)).toEqual(['matched'])
  })

  it('skips a watch whose previous check is still in flight', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const waitCheck = vi.fn(async () => {
      calls += 1
      await pending
      return { ready: false }
    })
    const page = mockPage({ waitCheck })
    const now = { value: 1_000 }
    const handle = tracked(page, [], now)
    handle.register({ sessionKey: 'sess-a', condition: { type: 'selector', selector: '.x' }, timeoutMs: 60_000 })
    const first = handle.tick()
    await Promise.resolve()
    now.value = 5_000
    await handle.tick()
    expect(calls).toBe(1)
    release()
    await first
  })

  it('unwatch is silent when the id is missing and does not fire', async () => {
    const triggers: Trigger[] = []
    const handle = tracked(mockPage(), triggers, { value: 1_000 })
    expect(handle.unwatch('missing')).toEqual({ ok: true })
    const registered = handle.register({
      sessionKey: 'sess-a',
      condition: { type: 'selector', selector: '.x' },
      timeoutMs: 10_000,
    })
    expect(registered.ok).toBe(true)
    if (!registered.ok) return
    expect(handle.unwatch(registered.watch.watchId)).toEqual({ ok: true })
    expect(handle.unwatch(registered.watch.watchId)).toEqual({ ok: true })
    await handle.tick()
    expect(triggers).toEqual([])
  })

  it('notifyDisposed fires disposed for every session watch and unregisters them', () => {
    const triggers: Trigger[] = []
    const handle = tracked(mockPage(), triggers, { value: 1_000 })
    handle.register({ sessionKey: 'sess-a', condition: { type: 'selector', selector: '.a' }, timeoutMs: 10_000, watchId: 'a' })
    handle.register({ sessionKey: 'sess-b', condition: { type: 'selector', selector: '.b' }, timeoutMs: 10_000, watchId: 'b' })
    handle.notifyDisposed('sess-a')
    expect(triggers.map(item => ({ id: item.watch.watchId, reason: item.reason }))).toEqual([
      { id: 'a', reason: 'disposed' },
    ])
    expect(handle.list().map(item => item.watchId)).toEqual(['b'])
  })

  it('notifyNavigatingLost uses the reserved reason without touching other sessions', () => {
    const triggers: Trigger[] = []
    const handle = tracked(mockPage(), triggers, { value: 1_000 })
    handle.register({ sessionKey: 'sess-a', condition: { type: 'timer' }, timeoutMs: 10_000, watchId: 'a' })
    handle.notifyNavigatingLost('sess-a')
    expect(triggers.map(item => item.reason)).toEqual(['navigating-lost'])
    expect(handle.list()).toEqual([])
  })

  it('rejects invalid conditions', () => {
    const handle = tracked(mockPage(), [], { value: 1_000 })
    expect(handle.register({ sessionKey: '', condition: { type: 'timer' }, timeoutMs: 1 }).ok).toBe(false)
    expect(handle.register({ sessionKey: 's', condition: { type: 'timer' } }).ok).toBe(false)
    expect(handle.register({ sessionKey: 's', condition: { type: 'selector', selector: '' } }).ok).toBe(false)
    expect(handle.register({ sessionKey: 's', condition: { type: 'url_matches', pattern: '(' } }).ok).toBe(false)
    expect(handle.register({ sessionKey: 's', condition: { type: 'expression', expression: '  ' } }).ok).toBe(false)
  })

  it('caps active watches per session with a structured error and frees the slot on unwatch', () => {
    const handle = tracked(mockPage(), [], { value: 1_000 })
    for (let i = 0; i < WATCHER_MAX_WATCHES_PER_SESSION; i++) {
      expect(handle.register({ sessionKey: 'sess-a', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: `a-${i}` }).ok).toBe(true)
    }
    const exceeded = handle.register({ sessionKey: 'sess-a', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: 'a-extra' })
    expect(exceeded).toEqual({
      ok: false,
      error: expect.stringContaining(`watch limit reached for this session (${WATCHER_MAX_WATCHES_PER_SESSION} active watches)`),
      code: 'browser_watch_limit_exceeded',
      limit: WATCHER_MAX_WATCHES_PER_SESSION,
    })
    // The ceiling is per session: another session is unaffected.
    expect(handle.register({ sessionKey: 'sess-b', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: 'b-0' }).ok).toBe(true)
    // Unwatching frees the slot for the same session.
    handle.unwatch('a-0')
    expect(handle.register({ sessionKey: 'sess-a', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: 'a-after' }).ok).toBe(true)
    expect(handle.list('sess-a')).toHaveLength(WATCHER_MAX_WATCHES_PER_SESSION)
    // A fired watch also frees its slot.
    const fired = handle.register({ sessionKey: 'sess-c', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: 'c-0' })
    expect(fired.ok).toBe(true)
    handle.notifyDisposed('sess-c')
    expect(handle.register({ sessionKey: 'sess-c', condition: { type: 'timer' }, timeoutMs: 60_000, watchId: 'c-1' }).ok).toBe(true)
  })

  it('clears checking after a hung evaluate so a later tick can fire timeout', async () => {
    const evaluate = vi.fn(() => new Promise<boolean>(() => undefined))
    const page = mockPage({ evaluate })
    const triggers: Trigger[] = []
    const now = { value: 1_000 }
    const hung = new WatcherRegistry({
      page,
      now: () => now.value,
      intervalMs: 2_000,
      checkTimeoutMs: 20,
      onTrigger: (watch, reason, pageSummary) => { triggers.push({ watch, reason, pageSummary }) },
    })
    registries.push(hung)
    hung.register({
      sessionKey: 'sess-a',
      condition: { type: 'expression', expression: 'true' },
      timeoutMs: 5_000,
    })
    await hung.tick()
    expect(triggers).toEqual([])
    expect(hung.list()[0]?.status).toBe('active')
    now.value = 7_000
    await hung.tick()
    expect(triggers.map(item => item.reason)).toEqual(['timeout'])
  })

  it('discards a match when URL or navigation epoch changes during evaluate', async () => {
    let url = 'https://a.example/'
    let epoch = 1
    let release!: (value: boolean) => void
    const page = mockPage({
      getURL: () => url,
      getNavigationEpoch: () => epoch,
      evaluate: () => new Promise<boolean>(resolve => { release = resolve }),
    })
    const triggers: Trigger[] = []
    const handle = tracked(page, triggers, { value: 1_000 })
    handle.register({
      sessionKey: 'sess-a',
      condition: { type: 'expression', expression: 'true' },
      timeoutMs: 10_000,
    })
    const pending = handle.tick()
    url = 'https://b.example/'
    epoch = 2
    release(true)
    await pending
    expect(triggers).toEqual([])
    expect(handle.list()).toHaveLength(1)
  })
})

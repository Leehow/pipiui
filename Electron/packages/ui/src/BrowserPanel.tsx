import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, PipiHostAPI } from '@pipi/host-api'
import { BROWSER_MOBILE_DEVICES, browserMobileDeviceById } from '@pipi/host-api'
import type { BrowserConsoleEntry, BrowserSurfaceHostAPI, BrowserWatchCondition, BrowserWatchInfo, BrowserWatchTrigger } from '@pipi/host-api/browser'
import { DismissibleError } from './DismissibleError'
import './browser-panel.css'

const emptyTabs: BrowserTabsSnapshot = { tabs: [] }
type SessionChrome = { tabs: BrowserTabsSnapshot; address: string; deviceId: string; zoomFactor: number }

const BROWSER_ZOOM_MIN = 0.25
const BROWSER_ZOOM_MAX = 5
const BROWSER_ZOOM_STEP = 0.1
/** Bounded page-output buffer: newest entries survive, old ones drop. */
const BROWSER_CONSOLE_BUFFER_LIMIT = 200
/** DOM stays bounded even at the buffer cap; the header keeps the true count. */
const BROWSER_CONSOLE_RENDER_LIMIT = 50

function clampZoom(factor: number): number {
  const next = Number.isFinite(factor) ? factor : 1
  return Math.min(BROWSER_ZOOM_MAX, Math.max(BROWSER_ZOOM_MIN, Math.round(next * 100) / 100))
}

function readRect(node: HTMLElement | null): { x: number; y: number; width: number; height: number } | undefined {
  const rect = node?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function displayTitle(tab: BrowserTab): string {
  if (tab.title.trim()) return tab.title
  if (!tab.url || tab.url === 'about:blank') return '新标签页'
  try { return new URL(tab.url).hostname || tab.url } catch { return tab.url }
}

function activeTab(snapshot: BrowserTabsSnapshot): BrowserTab | undefined {
  return snapshot.tabs.find(tab => tab.id === snapshot.activeTabId) ?? snapshot.tabs[0]
}

function watchConditionLabel(condition: BrowserWatchCondition): string {
  switch (condition.type) {
    case 'url_matches': return `URL 匹配 /${condition.pattern}/`
    case 'selector': return `选择器 ${condition.selector}`
    case 'expression': return `表达式 ${condition.expression}`
    case 'idle': return condition.idleMs == null ? '页面空闲' : `页面空闲 ${condition.idleMs}ms`
    case 'timer': return '定时器'
  }
}

function formatWatchRemaining(timeoutAt: number | null | undefined, now: number): string {
  if (timeoutAt == null || !Number.isFinite(timeoutAt)) return '无超时'
  const seconds = Math.max(0, Math.ceil((timeoutAt - now) / 1000))
  if (seconds >= 90) return `剩 ${Math.round(seconds / 60)} 分钟`
  return `剩 ${seconds}s`
}

export function BrowserPanel({ host, sessionId, occluded = false, headerSlot, workspaceFullscreen = false, onToggleWorkspaceFullscreen }: {
  host: PipiHostAPI
  sessionId?: string
  occluded?: boolean
  headerSlot?: HTMLElement | null
  workspaceFullscreen?: boolean
  onToggleWorkspaceFullscreen?: () => void
}) {
  // Surface lens over the root browser API: the same object, typed for the
  // wider event union this subpath owns (method bivariance makes the root
  // host structurally compatible; the cast only widens the view).
  const browser = host.browser as BrowserSurfaceHostAPI | undefined
  const [tabs, setTabs] = useState<BrowserTabsSnapshot>(emptyTabs)
  const [address, setAddress] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [deviceId, setDeviceId] = useState('responsive')
  const [zoomFactor, setZoomFactor] = useState(1)
  const zoomFactorRef = useRef(1)
  const [error, setError] = useState<string>()
  const [consoleEntries, setConsoleEntries] = useState<BrowserConsoleEntry[]>([])
  const [certificateError, setCertificateError] = useState<{ url: string; reason: string }>()
  const [jsDialog, setJsDialog] = useState<{ kind: string; message: string; url?: string; count: number }>()
  const [watches, setWatches] = useState<BrowserWatchInfo[]>([])
  const [lastWatchTrigger, setLastWatchTrigger] = useState<BrowserWatchTrigger>()
  const [watchNow, setWatchNow] = useState(() => Date.now())
  const [surface, setSurface] = useState<HTMLDivElement | null>(null)
  const sessionKey = sessionId ?? ''
  const mobileOpenRef = useRef(mobileOpen)
  const deviceIdRef = useRef(deviceId)
  mobileOpenRef.current = mobileOpen
  deviceIdRef.current = deviceId
  const chromeBySession = useRef(new Map<string, SessionChrome>())
  const [chromeKey, setChromeKey] = useState(sessionKey)
  if (sessionKey !== chromeKey) {
    if (chromeKey) chromeBySession.current.set(chromeKey, { tabs, address, deviceId, zoomFactor })
    // Page-level notices are live-only (not worth caching across switches).
    setConsoleEntries([])
    setCertificateError(undefined)
    setJsDialog(undefined)
    setWatches([])
    setLastWatchTrigger(undefined)
    const cached = sessionKey ? chromeBySession.current.get(sessionKey) : undefined
    if (cached) {
      setTabs(cached.tabs)
      setAddress(cached.address)
      setDeviceId(cached.deviceId)
      setZoomFactor(cached.zoomFactor)
      zoomFactorRef.current = cached.zoomFactor
      deviceIdRef.current = cached.deviceId
    } else {
      setDeviceId('responsive')
      setZoomFactor(1)
      zoomFactorRef.current = 1
      deviceIdRef.current = 'responsive'
    }
    setMobileOpen(false)
    mobileOpenRef.current = false
    setChromeKey(sessionKey)
  }
  const active = activeTab(tabs)

  const sync = useCallback(async () => {
    if (!browser || !sessionKey) return
    setTabs(await browser.listTabs(sessionKey))
  }, [browser, sessionKey])

  // Watch hydration rides selectSession: main re-emits the active watch list
  // as a `watch` event on every (re)select, so the panel never needs a
  // dedicated list RPC and a panel opened after the first select still hydrates.
  // That emission is synchronous on the main side, so the event subscription
  // must already be live when this runs (see the effect below: subscribe first,
  // then announce).
  const announceSession = useCallback(() => {
    if (!browser || !sessionKey) return
    void browser.selectSession(sessionKey).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [browser, sessionKey])

  const setBounds = useCallback((visible: boolean, nextMobileOpen = mobileOpenRef.current, nextDeviceId = deviceIdRef.current): boolean => {
    if (!browser || !sessionKey) return false
    const container = readRect(surface)
    if (visible && !container) return false
    const device = browserMobileDeviceById(nextDeviceId)
    const mobileOverlay = {
      visible: visible && nextMobileOpen,
      applyDeviceEmulation: true,
      deviceId: device.id,
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.deviceScaleFactor,
      userAgent: device.userAgent
    }
    const bounds: BrowserViewBounds = visible
      ? { ...container!, visible: true, mode: 'desktop', mobileOverlay }
      : { x: 0, y: 0, width: 0, height: 0, visible: false, mode: 'desktop', mobileOverlay }
    void browser.setViewBounds(sessionKey, bounds).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    return true
  }, [browser, sessionKey, surface])

  useEffect(() => {
    if (!browser || !sessionKey) return
    let alive = true
    // Subscribe BEFORE announcing: main emits the watch hydration snapshot
    // synchronously inside selectSession, so a listener registered after the
    // announce would drop the initial/session-switch snapshot. An empty
    // snapshot still arrives as a `watch` event and clears stale chips.
    const unsubscribe = browser.subscribe(event => {
      if (event.sessionId !== sessionKey || !alive) return
      if (event.type === 'tabs') setTabs(event.snapshot)
      if (event.type === 'error') setError(event.message)
      if (event.type === 'reveal') setBounds(!occluded)
      if (event.type === 'console' && (event.entry.level === 'error' || event.entry.level === 'warn')) {
        setConsoleEntries(previous => {
          // Bounded ring: cap total memory no matter how chatty the page is.
          const overflow = previous.length - BROWSER_CONSOLE_BUFFER_LIMIT + 1
          const kept = overflow > 0 ? previous.slice(overflow) : previous.slice()
          kept.push(event.entry)
          return kept
        })
      }
      if (event.type === 'certificate-error') setCertificateError({ url: event.url, reason: event.reason })
      if (event.type === 'js-dialog') setJsDialog(previous => previous && previous.kind === event.kind && previous.message === event.message
        ? { ...previous, count: previous.count + 1 }
        : { kind: event.kind, message: event.message, url: event.url, count: 1 })
      if (event.type === 'watch') {
        setWatches(event.watches)
        if (event.trigger) setLastWatchTrigger(event.trigger)
      }
      if (event.type === 'mobile-window' && !event.open) {
        mobileOpenRef.current = false
        setMobileOpen(false)
      }
    })
    void sync().catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    announceSession()
    return () => { alive = false; unsubscribe() }
  }, [browser, sync, announceSession, sessionKey, setBounds, occluded])

  // Countdown freshness for the watch strip; only ticks while watches exist.
  useEffect(() => {
    if (watches.length === 0) return
    const timer = window.setInterval(() => setWatchNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [watches.length])

  useEffect(() => { setAddress(active?.url ?? '') }, [active?.id, active?.url])

  useLayoutEffect(() => {
    if (!browser || !sessionKey || !surface) return
    const update = () => setBounds(!occluded)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(surface)
    window.addEventListener('resize', update)
    const frame = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(update) : undefined
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [browser, occluded, setBounds, sessionKey, surface, mobileOpen, deviceId])

  useEffect(() => {
    if (!browser || !sessionKey) return
    return () => {
      void browser.setViewBounds(sessionKey, {
        x: 0, y: 0, width: 0, height: 0, visible: false, mode: 'desktop',
        mobileOverlay: { visible: false, applyDeviceEmulation: true, deviceId: deviceIdRef.current }
      }).catch(() => undefined)
    }
  }, [browser, sessionKey])

  const run = (operation: () => Promise<unknown>) => {
    setError(undefined)
    void operation().then(sync).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  const toggleMobileWindow = () => {
    const next = !mobileOpenRef.current
    mobileOpenRef.current = next
    setMobileOpen(next)
    setBounds(!occluded, next)
  }
  const selectDevice = (next: string) => {
    deviceIdRef.current = next
    setDeviceId(next)
    setBounds(!occluded, mobileOpenRef.current, next)
  }
  const applyZoom = (next: number) => {
    const factor = clampZoom(next)
    zoomFactorRef.current = factor
    setZoomFactor(factor)
    if (!sessionKey || !browser) return
    void browser.setZoomFactor(sessionKey, factor, active?.id).then(applied => {
      zoomFactorRef.current = applied
      setZoomFactor(applied)
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  const adjustZoom = (delta: number) => applyZoom(zoomFactorRef.current + delta)

  if (!browser) return <section className="browser-panel browser-unavailable" data-testid="browser-unavailable"><b>Browser 不可用</b><p>当前连接未提供桌面浏览器能力。</p></section>

  return <section className="browser-panel" data-testid="browser-panel">
    {headerSlot && !occluded && createPortal(<nav className="browser-tabs" aria-label="浏览器标签页" role="tablist">
      {tabs.tabs.map(tab => {
        const title = displayTitle(tab)
        const selected = tab.id === active?.id
        return <div className={`browser-tab ${selected ? 'selected' : ''}`} key={tab.id}>
          <button role="tab" aria-selected={selected} aria-controls={`browser-tab-${tab.id}`} title={title} onClick={() => run(() => browser.switchTab(sessionKey, tab.id))}><span aria-hidden="true">◉</span><span>{title}</span></button>
          <button className="browser-tab-close" aria-label={`关闭标签页 ${title}`} title={`关闭 ${title}`} onClick={() => run(() => browser.closeTab(sessionKey, tab.id))}>×</button>
        </div>
      })}
      <button className="browser-new-tab" aria-label="新建标签页" title="新建标签页" onClick={() => run(() => browser.newTab(sessionKey))}>＋</button>
    </nav>, headerSlot)}

    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); if (address.trim()) run(() => browser.loadURL(sessionKey, address, active?.id)) }}>
      <button type="button" aria-label="后退" title="后退" disabled={!active?.canGoBack} onClick={() => active && run(() => browser.goBack(sessionKey, active.id))}>‹</button>
      <button type="button" aria-label="前进" title="前进" disabled={!active?.canGoForward} onClick={() => active && run(() => browser.goForward(sessionKey, active.id))}>›</button>
      <button type="button" aria-label="刷新" title="刷新" disabled={!active} onClick={() => active && run(() => browser.reload(sessionKey, active.id))}>↻</button>
      <button type="button" data-testid="browser-mobile-window-toggle" aria-label={mobileOpen ? '关闭手机预览窗口' : '打开手机预览窗口'} aria-pressed={mobileOpen} title={mobileOpen ? '关闭手机预览窗口' : '打开独立手机预览窗口'} className={mobileOpen ? 'selected' : undefined} onClick={toggleMobileWindow}><MobileModeIcon /></button>
      {mobileOpen && <select className="browser-device-select" data-testid="browser-device-select" aria-label="手机设备" value={deviceId} onChange={event => selectDevice(event.target.value)}>
        {BROWSER_MOBILE_DEVICES.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
      </select>}
      <input aria-label="浏览器地址" value={address} placeholder="输入网址或搜索内容" onChange={event => setAddress(event.target.value)} />
      <button type="button" data-testid="browser-zoom-out" aria-label="缩小" title="缩小" disabled={!active || zoomFactor <= BROWSER_ZOOM_MIN} onClick={() => adjustZoom(-BROWSER_ZOOM_STEP)}>−</button>
      <button type="button" data-testid="browser-zoom-in" aria-label="放大" title="放大" disabled={!active || zoomFactor >= BROWSER_ZOOM_MAX} onClick={() => adjustZoom(BROWSER_ZOOM_STEP)}>＋</button>
      {onToggleWorkspaceFullscreen && <button type="button" data-testid="browser-workspace-fullscreen" aria-label={workspaceFullscreen ? '退出浏览器全屏' : '浏览器全屏'} aria-pressed={workspaceFullscreen} title={workspaceFullscreen ? '退出浏览器全屏' : '浏览器全屏'} className={workspaceFullscreen ? 'selected' : undefined} onClick={onToggleWorkspaceFullscreen}><FullscreenIcon exit={workspaceFullscreen} /></button>}
      {active?.isLoading && <span className="browser-loading" role="status" aria-label="正在加载" title="正在加载" />}
    </form>

    <div id={active ? `browser-tab-${active.id}` : undefined} className="browser-webcontents-surface" ref={setSurface} role="tabpanel" aria-label={active ? `浏览器内容：${displayTitle(active)}` : '浏览器内容'}>
      {(!active?.url || active.url === 'about:blank') && !active?.isLoading ? <div className="browser-surface-fallback" aria-hidden="true">桌面宿主将在此显示网页内容</div> : null}
    </div>
    {(certificateError || jsDialog || watches.length > 0 || lastWatchTrigger || consoleEntries.length > 0) && <div className="browser-page-status" data-testid="browser-page-status" role="region" aria-label="页面状态与输出">
      {certificateError && <div className="browser-banner browser-certificate-banner" role="status" data-testid="browser-certificate-error">
        <span className="browser-banner-title">证书错误：{certificateError.reason || '未指明原因'}{certificateError.url ? ` ${certificateError.url}` : ''}</span>
        <span className="browser-banner-note">工具侧已按默认策略拒绝加载该页（未放行证书）</span>
        <button type="button" aria-label="关闭证书错误提示" title="关闭" onClick={() => setCertificateError(undefined)}>×</button>
      </div>}
      {jsDialog && <div className="browser-banner browser-dialog-banner" role="status" data-testid="browser-js-dialog">
        <span className="browser-banner-title">页面调用了 {jsDialog.kind}()：{jsDialog.message || '（无文案）'}{jsDialog.count > 1 ? ` ×${jsDialog.count}` : ''}</span>
        <span className="browser-banner-note">原生对话框可能已弹出；agent 工具不会代答，需人工处理</span>
        <button type="button" aria-label="关闭对话框提示" title="关闭" onClick={() => setJsDialog(undefined)}>×</button>
      </div>}
      {watches.length > 0 && <div className="browser-watch-strip" data-testid="browser-watches" aria-label={`页面监听 ${watches.length} 项`}>
        <span className="browser-watch-title">监听中 {watches.length}</span>
        {watches.map(watch => <span className="browser-watch-chip" key={watch.watchId} title={watchConditionLabel(watch.condition)}>{watchConditionLabel(watch.condition)} · {formatWatchRemaining(watch.timeoutAt, watchNow)}</span>)}
      </div>}
      {lastWatchTrigger && <div className="browser-banner browser-watch-trigger" role="status" data-testid="browser-watch-trigger">
        <span className="browser-banner-title">监听触发（{lastWatchTrigger.reason}）：{(lastWatchTrigger.title || lastWatchTrigger.url || lastWatchTrigger.watchId)}，等待 {(lastWatchTrigger.waitedMs / 1000).toFixed(1)}s</span>
        <button type="button" aria-label="关闭监听触发提示" title="关闭" onClick={() => setLastWatchTrigger(undefined)}>×</button>
      </div>}
      {consoleEntries.length > 0 && <div className="browser-console" data-testid="browser-console" aria-label="页面输出">
        <div className="browser-console-header">
          <span>页面输出 · {consoleEntries.filter(entry => entry.level === 'error').length} 错误 / {consoleEntries.filter(entry => entry.level === 'warn').length} 警告（最近 {consoleEntries.length} 条）</span>
          <button type="button" aria-label="清空页面输出" onClick={() => setConsoleEntries([])}>清空</button>
        </div>
        <ul className="browser-console-list">
          {consoleEntries.slice(-BROWSER_CONSOLE_RENDER_LIMIT).map((entry, index) => <li
            key={`${entry.timestamp}-${index}`}
            className={entry.level === 'error' ? 'browser-console-entry error' : 'browser-console-entry warn'}
            data-level={entry.level}
            title={entry.url ? `${entry.url}${entry.line != null ? `:${entry.line}` : ''}` : undefined}
          >{entry.message}</li>)}
        </ul>
      </div>}
    </div>}
    {error && <DismissibleError className="browser-error" message={error} onDismiss={() => setError(undefined)} />}
  </section>
}

function MobileModeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="1.5" width="8" height="13" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="12.2" r="0.7" fill="currentColor" /></svg>
}

function FullscreenIcon({ exit }: { exit: boolean }) {
  return exit
    ? <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M6 3v3H3M10 3v3h3M3 10h3v3M10 10h3v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
}

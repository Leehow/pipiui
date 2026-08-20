import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, PipiHostAPI } from '@pipi/host-api'
import { BROWSER_MOBILE_DEVICES, browserMobileDeviceById } from '@pipi/host-api'
import { DismissibleError } from './DismissibleError'
import './browser-panel.css'

const emptyTabs: BrowserTabsSnapshot = { tabs: [] }
type SessionChrome = { tabs: BrowserTabsSnapshot; address: string; deviceId: string; zoomFactor: number }

const BROWSER_ZOOM_MIN = 0.25
const BROWSER_ZOOM_MAX = 5
const BROWSER_ZOOM_STEP = 0.1

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

export function BrowserPanel({ host, sessionId, occluded = false, headerSlot, workspaceFullscreen = false, onToggleWorkspaceFullscreen }: {
  host: PipiHostAPI
  sessionId?: string
  occluded?: boolean
  headerSlot?: HTMLElement | null
  workspaceFullscreen?: boolean
  onToggleWorkspaceFullscreen?: () => void
}) {
  const browser = host.browser
  const [tabs, setTabs] = useState<BrowserTabsSnapshot>(emptyTabs)
  const [address, setAddress] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [deviceId, setDeviceId] = useState('responsive')
  const [zoomFactor, setZoomFactor] = useState(1)
  const zoomFactorRef = useRef(1)
  const [error, setError] = useState<string>()
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
    void sync().catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    const unsubscribe = browser.subscribe(event => {
      if (event.sessionId !== sessionKey || !alive) return
      if (event.type === 'tabs') setTabs(event.snapshot)
      if (event.type === 'error') setError(event.message)
      if (event.type === 'reveal') setBounds(!occluded)
      if (event.type === 'mobile-window' && !event.open) {
        mobileOpenRef.current = false
        setMobileOpen(false)
      }
    })
    return () => { alive = false; unsubscribe() }
  }, [browser, sync, sessionKey, setBounds, occluded])

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

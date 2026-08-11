import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, PipiHostAPI } from '@pipi/host-api'
import { DismissibleError } from './DismissibleError'
import './browser-panel.css'

const emptyTabs: BrowserTabsSnapshot = { tabs: [] }

function displayTitle(tab: BrowserTab): string {
  if (tab.title.trim()) return tab.title
  if (!tab.url || tab.url === 'about:blank') return '新标签页'
  try { return new URL(tab.url).hostname || tab.url } catch { return tab.url }
}

function activeTab(snapshot: BrowserTabsSnapshot): BrowserTab | undefined {
  return snapshot.tabs.find(tab => tab.id === snapshot.activeTabId) ?? snapshot.tabs[0]
}

export function BrowserPanel({ host, sessionId }: { host: PipiHostAPI; sessionId?: string }) {
  const browser = host.browser
  const [tabs, setTabs] = useState<BrowserTabsSnapshot>(emptyTabs)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const sessionKey = sessionId ?? ''
  const active = activeTab(tabs)

  const sync = useCallback(async () => {
    if (!browser || !sessionKey) return
    const snapshot = await browser.listTabs(sessionKey)
    setTabs(snapshot)
  }, [browser, sessionKey])

  useEffect(() => {
    if (!browser || !sessionKey) return
    let alive = true
    setTabs(emptyTabs)
    setAddress('')
    void sync().catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    const unsubscribe = browser.subscribe(event => {
      // Only this session's tab events belong to this panel; drop the rest.
      if (event.type === 'tabs' && event.sessionId === sessionKey && alive) setTabs(event.snapshot)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [browser, sync, sessionKey])

  useEffect(() => { setAddress(active?.url ?? '') }, [active?.id, active?.url])

  const setBounds = useCallback((visible: boolean) => {
    if (!browser || !sessionKey) return
    const rect = surfaceRef.current?.getBoundingClientRect()
    const bounds: BrowserViewBounds = visible && rect
      ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: true }
      : { x: 0, y: 0, width: 0, height: 0, visible: false }
    void browser.setViewBounds(sessionKey, bounds).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [browser, sessionKey])

  useLayoutEffect(() => {
    if (!browser || !sessionKey) return
    const update = () => setBounds(true)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    if (surfaceRef.current) observer?.observe(surfaceRef.current)
    window.addEventListener('resize', update)
    const frame = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(update) : undefined
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      observer?.disconnect()
      // Hides (rather than destroys) the sole main-process WebContentsView.
      void browser.setViewBounds(sessionKey, { x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => undefined)
    }
  }, [browser, setBounds, sessionKey])

  const run = (operation: () => Promise<unknown>) => {
    setError(undefined)
    void operation().then(sync).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  if (!browser) return <section className="browser-panel browser-unavailable" data-testid="browser-unavailable"><b>Browser 不可用</b><p>当前连接未提供桌面浏览器能力。</p></section>

  return <section className="browser-panel" data-testid="browser-panel">
    <nav className="browser-tabs" aria-label="浏览器标签页" role="tablist">
      {tabs.tabs.map(tab => {
        const title = displayTitle(tab)
        const selected = tab.id === active?.id
        return <div className={`browser-tab ${selected ? 'selected' : ''}`} key={tab.id}>
          <button role="tab" aria-selected={selected} aria-controls={`browser-tab-${tab.id}`} title={title} onClick={() => run(() => browser.switchTab(sessionKey, tab.id))}>
            <span aria-hidden="true">◉</span><span>{title}</span>
          </button>
          <button className="browser-tab-close" aria-label={`关闭标签页 ${title}`} title={`关闭 ${title}`} onClick={() => run(() => browser.closeTab(sessionKey, tab.id))}>×</button>
        </div>
      })}
      <button className="browser-new-tab" aria-label="新建标签页" title="新建标签页" onClick={() => run(() => browser.newTab(sessionKey))}>＋</button>
    </nav>

    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); if (address.trim()) run(() => browser.loadURL(sessionKey, address, active?.id)) }}>
      <button type="button" aria-label="后退" title="后退" disabled={!active?.canGoBack} onClick={() => active && run(() => browser.goBack(sessionKey, active.id))}>‹</button>
      <button type="button" aria-label="前进" title="前进" disabled={!active?.canGoForward} onClick={() => active && run(() => browser.goForward(sessionKey, active.id))}>›</button>
      <button type="button" aria-label="刷新" title="刷新" disabled={!active} onClick={() => active && run(() => browser.reload(sessionKey, active.id))}>↻</button>
      <input aria-label="浏览器地址" value={address} placeholder="输入网址或搜索内容" onChange={event => setAddress(event.target.value)} />
      {active?.isLoading && <span className="browser-loading" role="status" aria-label="正在加载" title="正在加载" />}
    </form>

    <div id={active ? `browser-tab-${active.id}` : undefined} className="browser-webcontents-surface" ref={surfaceRef} role="tabpanel" aria-label={active ? `浏览器内容：${displayTitle(active)}` : '浏览器内容'}>
      <div className="browser-surface-fallback" aria-hidden="true">桌面宿主将在此显示网页内容</div>
    </div>
    {error && <DismissibleError className="browser-error" message={error} onDismiss={() => setError(undefined)} />}
  </section>
}

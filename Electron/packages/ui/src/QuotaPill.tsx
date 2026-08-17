import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { PipiHostAPI, QuotaSnapshot, QuotaWindow } from '@pipi/host-api'
import './quota-pill.css'

export interface QuotaPillProps {
  host: PipiHostAPI
  /** Selected session so the host resolves that session's model provider. */
  sessionId?: string
  /** Current model provider; changing it refetches after an in-session model switch. */
  provider?: string
  /** Extra dependency to force a refetch (e.g. after model/auth changes). */
  refreshKey?: unknown
  /**
   * Called when the user clicks the Qwen Token Plan login capsule. Mirrors the
   * Swift InputBar entry: with no quota data for a Token Plan provider, show a
   * login capsule that opens the embedded browser at the bailian plan page.
   */
  onOpenBrowserLogin?: () => void
}

/** Bailian Token Plan page (Swift `bailianTokenPlanURL` parity). */
export const QWEN_TOKEN_PLAN_LOGIN_URL = 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal'

/** Windows safe to present as real account usage; incomplete host data stays hidden. */
export function visibleQuotaWindows(snapshot: QuotaSnapshot): QuotaWindow[] {
  return snapshot.windows.filter(window =>
    Number.isFinite(window.usedPercent) &&
    typeof window.label === 'string' &&
    window.label.trim().length > 0
  )
}

/**
 * True when a host snapshot belongs to the composer's current model provider.
 * Needed because the UI updates the chip immediately while `getQuotaSnapshot`
 * still reads the session's pre-switch model until `setModel` lands.
 */
export function quotaSnapshotMatchesProvider(snapshot: QuotaSnapshot, modelProvider?: string): boolean {
  if (!modelProvider) return true
  const model = modelProvider.toLowerCase()
  if (model.includes('relay')) return false
  const kind = snapshot.provider.toLowerCase()
  if (kind === 'qwentokenplan') return model.includes('qwen-token-plan')
  if (kind === 'opencodengo') return model.includes('opencode-go')
  if (kind === 'codex') return model.includes('openai') || model.includes('codex')
  if (kind === 'cursor') return model.includes('cursor')
  if (kind === 'claude') return model.includes('anthropic') || model.includes('claude')
  if (kind === 'glm') return ['zai', 'zhipu', 'bigmodel', 'glm'].some(token => model.includes(token))
  if (kind === 'grok') return model === 'xai' || model.includes('grok')
  if (kind === 'moonshot') return model.includes('moonshot')
  return model.includes(kind)
}

/** Per-provider localStorage key, mirroring Swift `LayoutPersistence.quotaWindowKey`. */
function quotaWindowKey(provider: string): string {
  return `pipiui.quotaWindow.${provider}`
}

function persistedWindowId(provider: string): string | null {
  try {
    return localStorage.getItem(quotaWindowKey(provider))
  } catch {
    // Quota is best-effort; storage unavailability never errors the UI.
    return null
  }
}

function persistWindowId(provider: string, id: string): void {
  try {
    localStorage.setItem(quotaWindowKey(provider), id)
  } catch {
    // Quota is best-effort; storage unavailability never errors the UI.
  }
}

/** Theme tokens live on `.pipiui-shell`. Body has none, so a body portal paints transparent. */
export function quotaMenuPortalRoot(): Element {
  return document.querySelector('.pipiui-shell') ?? document.body
}

/**
 * Mirrors Swift `QuotaSnapshot.capsule`: the user's persisted window when it
 * still exists in the snapshot, else the highest-usage window.
 */
function capsuleWindow(windows: QuotaWindow[], selectedId: string | null): QuotaWindow | undefined {
  if (selectedId) {
    const selected = windows.find(window => window.id === selectedId)
    if (selected) return selected
  }
  return windows.reduce((best, window) => (window.usedPercent > best.usedPercent ? window : best))
}

/**
 * Minimal Swift-style quota capsule rendered to the right of the context pill:
 * `周 14%` / `5h xx%` / `月 xx%` for the selected session's own provider window.
 * Clicking the pill opens a popover listing every window the provider reports
 * (5h / 周 / 月 / 额 …); picking one updates the capsule immediately and is
 * persisted per provider (localStorage equivalent of Swift LayoutPersistence).
 * The popover stays open after a pick and closes on outside click or re-click
 * (Swift popover parity).
 */
export function QuotaPill({ host, sessionId, provider, refreshKey, onOpenBrowserLogin }: QuotaPillProps) {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>()
  const scopeRef = useRef({ sessionId, provider })
  // Same render-time reset as Composer drafts: a session / model switch must
  // not paint the previous provider's capsule, popover, or in-session pick.
  // refreshKey / poll ticks still reuse the last good snapshot.
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.provider !== provider) {
    scopeRef.current = { sessionId, provider }
    setSnapshot(null)
    setLoaded(false)
    setSelectedId(null)
    setOpen(false)
  }

  useEffect(() => {
    if (typeof host.getQuotaSnapshot !== 'function') return
    let cancelled = false
    setLoaded(false)
    const load = async () => {
      try {
        const snap = await host.getQuotaSnapshot!(sessionId)
        if (cancelled) return
        // A snapshot for the previous model is not "last good" — drop it and
        // wait for the post-setModel refetch instead of painting the wrong pill.
        if (snap && !quotaSnapshotMatchesProvider(snap, provider)) return
        setSnapshot(snap)
      } catch {
        // Quota is best-effort: keep the last good snapshot, never error UI.
      }
      if (!cancelled) setLoaded(true)
    }
    void load()
    return () => { cancelled = true }
  }, [host, sessionId, provider, refreshKey, refreshTick])

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(undefined)
      return
    }
    const update = () => {
      const el = pillRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        left: 'auto',
        right: `${Math.max(8, window.innerWidth - rect.right)}px`,
        bottom: `${Math.max(8, window.innerHeight - rect.top + 8)}px`,
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open])

  const activeSnapshot = snapshot && quotaSnapshotMatchesProvider(snapshot, provider) ? snapshot : null
  const showLogin = loaded && !activeSnapshot && Boolean(onOpenBrowserLogin) && Boolean(provider?.includes('qwen-token-plan'))

  useEffect(() => {
    // While the login capsule is up, the user may complete the bailian login in
    // the built-in browser at any moment; poll so the quota capsule appears
    // shortly after login without needing a model switch round-trip.
    if (!showLogin) return
    const timer = window.setInterval(() => setRefreshTick(tick => tick + 1), 5000)
    return () => window.clearInterval(timer)
  }, [showLogin])

  if (!activeSnapshot || visibleQuotaWindows(activeSnapshot).length === 0) {
    // Swift parity (InputBar): a Token Plan session without quota data is not
    // logged in — offer a capsule that opens the embedded browser login page.
    // Wait for the fetch so a slow load never flashes the login entry.
    if (!showLogin) return null
    return (
      <button
        type="button"
        className="quota-pill"
        data-testid="quota-login-pill"
        title="登录阿里云百炼以查看 Token Plan 额度"
        onClick={onOpenBrowserLogin}
      >
        Token Plan 登录
      </button>
    )
  }
  const windows = visibleQuotaWindows(activeSnapshot)
  const providerName = activeSnapshot.provider

  // In-session pick wins over the persisted one (which wins over highest-usage).
  const effectiveSelectedId = selectedId ?? persistedWindowId(providerName)
  const capsule = capsuleWindow(windows, effectiveSelectedId)
  if (!capsule) return null
  const currentId = effectiveSelectedId !== null && windows.some(window => window.id === effectiveSelectedId)
    ? effectiveSelectedId
    : capsule.id

  const selectWindow = (id: string) => {
    setSelectedId(id)
    persistWindowId(providerName, id)
    // Swift parity: the popover stays open so the user can compare windows.
  }

  return (
    <div className="quick-menu-anchor" data-testid="quota-pill-anchor">
      <button
        ref={pillRef}
        type="button"
        className="quota-pill"
        data-testid="quota-pill"
        aria-label={`额度（当前：${capsule.label} ${Math.round(capsule.usedPercent)}%）`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        {capsule.label} {Math.round(capsule.usedPercent)}%
      </button>
      {open && createPortal(
        <>
          <div className="quick-menu-backdrop" data-testid="quota-menu-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="quick-menu quota-menu" role="menu" aria-label="额度窗口" data-testid="quota-menu" style={menuStyle}>
            {activeSnapshot.accountLabel && activeSnapshot.accountLabel.trim().length > 0 && (
              <div className="quick-menu-provider">{activeSnapshot.accountLabel}</div>
            )}
            {windows.map(window => {
              const current = window.id === currentId
              return (
                <button
                  key={window.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className={`quick-menu-row ${current ? 'current' : ''}`}
                  data-testid={`quota-row-${window.id}`}
                  onClick={() => selectWindow(window.id)}
                >
                  <span className="quick-menu-name">{window.title || window.label}</span>
                  <span className="quota-menu-percent">{Math.round(window.usedPercent)}%</span>
                  {current && <span className="quick-menu-check">✓</span>}
                </button>
              )
            })}
          </div>
        </>,
        quotaMenuPortalRoot()
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
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
}

/** Windows safe to present as real account usage; incomplete host data stays hidden. */
export function visibleQuotaWindows(snapshot: QuotaSnapshot): QuotaWindow[] {
  return snapshot.windows.filter(window =>
    Number.isFinite(window.usedPercent) &&
    typeof window.label === 'string' &&
    window.label.trim().length > 0
  )
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
export function QuotaPill({ host, sessionId, provider, refreshKey }: QuotaPillProps) {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof host.getQuotaSnapshot !== 'function') return
    let cancelled = false
    const load = async () => {
      try {
        const snap = await host.getQuotaSnapshot!(sessionId)
        if (!cancelled) setSnapshot(snap)
      } catch {
        // Quota is best-effort: keep the last good snapshot, never error UI.
      }
    }
    void load()
    return () => { cancelled = true }
  }, [host, sessionId, provider, refreshKey])

  if (!snapshot) return null
  const windows = visibleQuotaWindows(snapshot)
  if (windows.length === 0) return null
  const providerName = snapshot.provider

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
      {open && (
        <>
          <div className="quick-menu-backdrop" data-testid="quota-menu-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="quick-menu quota-menu" role="menu" aria-label="额度窗口" data-testid="quota-menu">
            {snapshot.accountLabel && snapshot.accountLabel.trim().length > 0 && (
              <div className="quick-menu-provider">{snapshot.accountLabel}</div>
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
        </>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus, PipiHostAPI } from '@pipi/host-api'
import './git-branch.css'

/** Swift GitRepo.toolbarTitle uses the same cap, so both toolbars truncate alike. */
const MAX_TITLE_CHARS = 24

export function displayBranchName(status: GitStatus): string {
  if (status.isDetached) return status.shortSHA ? `detached @ ${status.shortSHA}` : 'detached'
  return status.currentBranch?.trim() || 'unknown'
}

/** Toolbar label; a dirty work tree appends `*`. */
export function toolbarTitle(status: GitStatus): string {
  const name = displayBranchName(status)
  return (name.length <= MAX_TITLE_CHARS ? name : name.slice(0, MAX_TITLE_CHARS)) + (status.isDirty ? '*' : '')
}

export function branchHelpText(status: GitStatus): string {
  let text = `Git 分支：${displayBranchName(status)}`
  if (status.isDirty) text += `*（staged=${status.staged} unstaged=${status.unstaged} untracked=${status.untracked}）`
  if (status.upstream) text += ` · upstream ${status.upstream} +${status.ahead} -${status.behind}`
  return text
}

/** Current branch first (it carries the checkmark), then the rest case-insensitively sorted. */
export function orderedBranches(status: GitStatus): string[] {
  const current = status.currentBranch
  const rest = status.localBranches.filter(branch => branch !== current).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return current && status.localBranches.includes(current) ? [current, ...rest] : rest
}

/**
 * Chat-header git control: branch name, local-branch checkout and an optional
 * GitHub link — the Electron counterpart of Swift `GitBranchMenu`. It renders
 * nothing until a host confirms the project is a work tree.
 */
export function GitBranchMenu({ host, projectId, available }: { host: PipiHostAPI; projectId?: string; available: boolean }) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped per probe so a slow response for an earlier project cannot land late.
  const epoch = useRef(0)

  const refresh = useCallback(() => {
    if (!available || !projectId || !host.gitStatus) { setStatus(null); return }
    const current = ++epoch.current
    void host.gitStatus(projectId)
      .then(next => { if (current === epoch.current) { setStatus(next); setError(null) } })
      .catch(() => { if (current === epoch.current) setStatus(null) })
  }, [host, projectId, available])

  useEffect(() => { refresh() }, [refresh])
  // Mirrors the Swift store: re-probe when the window regains focus, never poll.
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!status?.isRepo) return null

  const checkout = async (branch: string) => {
    if (!projectId || !host.gitCheckout) return
    if (branch === status.currentBranch) { setOpen(false); return }
    setBusy(true)
    setError(null)
    try {
      const next = await host.gitCheckout(projectId, branch)
      epoch.current += 1
      setStatus(next)
      setOpen(false)
    } catch (err) {
      setError(`切换分支失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return <div className="git-branch">
    <button className="git-branch-button" data-testid="git-branch-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} title={error ?? branchHelpText(status)} onClick={() => setOpen(value => !value)}>
      <span className="git-branch-icon" aria-hidden="true">⑂</span>
      <span className="git-branch-name">{busy ? '切换中…' : toolbarTitle(status)}</span>
      <span className="git-branch-chevron" aria-hidden="true">▾</span>
    </button>
    {open && <>
      <div className="git-menu-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="git-menu" role="menu" data-testid="git-branch-menu">
        {error && <div className="git-menu-error" data-testid="git-branch-error">{error}</div>}
        {orderedBranches(status).map(branch => <button key={branch} role="menuitem" className={`git-menu-row ${branch === status.currentBranch ? 'current' : ''}`} disabled={busy} onClick={() => void checkout(branch)}>
          <span className="git-menu-check" aria-hidden="true">{branch === status.currentBranch ? '✓' : ''}</span>
          <span className="git-menu-name">{branch}</span>
        </button>)}
        {status.githubURL && host.openExternal && <>
          <div className="git-menu-divider" />
          <button role="menuitem" className="git-menu-row" onClick={() => { setOpen(false); void host.openExternal?.(status.githubURL!) }}>
            <span className="git-menu-check" aria-hidden="true" />
            <span className="git-menu-name">在 GitHub 打开</span>
          </button>
        </>}
      </div>
    </>}
  </div>
}

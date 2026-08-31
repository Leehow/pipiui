import type * as ReactModule from 'react'
import type { ExtensionGitStatus, HeaderActionProps } from '@pipiui/extension-api'
import gitBranchCss from './git-branch.css?raw'

const GIT_BRANCH_STYLE_ID = 'pipiui-git-branch-style'
if (typeof document !== 'undefined' && !document.getElementById(GIT_BRANCH_STYLE_ID)) {
  const style = document.createElement('style')
  style.id = GIT_BRANCH_STYLE_ID
  style.textContent = gitBranchCss
  document.head.append(style)
}

const MAX_TITLE_CHARS = 24
export const GIT_FOCUS_REFRESH_MS = 800

export function displayBranchName(status: ExtensionGitStatus): string {
  if (status.isDetached) return status.shortSHA ? `detached @ ${status.shortSHA}` : 'detached'
  return status.currentBranch?.trim() || 'unknown'
}

export function toolbarTitle(status: ExtensionGitStatus): string {
  const name = displayBranchName(status)
  return (name.length <= MAX_TITLE_CHARS ? name : name.slice(0, MAX_TITLE_CHARS)) + (status.isDirty ? '*' : '')
}

export function branchHelpText(status: ExtensionGitStatus): string {
  let text = `Git 分支：${displayBranchName(status)}`
  if (status.isDirty) text += `*（staged=${status.staged} unstaged=${status.unstaged} untracked=${status.untracked}）`
  if (status.upstream) text += ` · upstream ${status.upstream} +${status.ahead} -${status.behind}`
  return text
}

export function orderedBranches(status: ExtensionGitStatus): string[] {
  const current = status.currentBranch
  const rest = status.localBranches.filter(branch => branch !== current).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return current && status.localBranches.includes(current) ? [current, ...rest] : rest
}

/**
 * Controlled entry factory. The loader injects its own React module so hooks use
 * the exact renderer React instance; the built file contains no bare imports.
 */
export function createHeaderAction(React: typeof ReactModule) {
  const { useCallback, useEffect, useRef, useState } = React

  return function GitBranchHeaderAction({ workspaceId, git, openExternal }: HeaderActionProps) {
    const [status, setStatus] = useState<ExtensionGitStatus | null>(null)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const epoch = useRef(0)

    const refresh = useCallback(() => {
      if (!workspaceId || !git) { setStatus(null); return }
      const current = ++epoch.current
      void git.status()
        .then(next => { if (current === epoch.current) { setStatus(next); setError(null) } })
        .catch(() => { if (current === epoch.current) setStatus(null) })
    }, [workspaceId, git])

    useEffect(() => { refresh() }, [refresh])
    useEffect(() => {
      let timer = 0
      const onFocus = () => { window.clearTimeout(timer); timer = window.setTimeout(refresh, GIT_FOCUS_REFRESH_MS) }
      const onBlur = () => window.clearTimeout(timer)
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      return () => { window.clearTimeout(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
    }, [refresh])
    useEffect(() => {
      if (!open) return
      const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [open])

    if (!status?.isRepo) return null

    const checkout = async (branch: string) => {
      if (!git) return
      if (branch === status.currentBranch) { setOpen(false); return }
      setBusy(true)
      setError(null)
      try {
        const next = await git.checkout(branch)
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
          {status.githubURL && openExternal && <>
            <div className="git-menu-divider" />
            <button role="menuitem" className="git-menu-row" onClick={() => { setOpen(false); void openExternal(status.githubURL!) }}>
              <span className="git-menu-check" aria-hidden="true" />
              <span className="git-menu-name">在 GitHub 打开</span>
            </button>
          </>}
        </div>
      </>}
    </div>
  }
}

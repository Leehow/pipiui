import { useEffect, useState } from 'react'
import type { PipiHostAPI, SessionWorkspace } from '@pipi/host-api'

const MAX_TITLE_CHARS = 24

export function shouldShowDualBranch(sessionBranch?: string | null, mainBranch?: string | null): boolean {
  const session = sessionBranch?.trim() ?? ''
  const main = mainBranch?.trim() ?? ''
  return Boolean(session && main && session !== main)
}

export function shouldShowUnmergedBadge(aheadOfMain?: number | null): boolean {
  return aheadOfMain != null && aheadOfMain > 0
}

function truncateBranch(name: string): string {
  return name.length <= MAX_TITLE_CHARS ? name : name.slice(0, MAX_TITLE_CHARS)
}

/**
 * Header companion to the git-capability main-tree control beside it: shows only the
 * session branch (and only when it differs from the main tree) — repeating the main
 * branch in the pair duplicates the adjacent git-branch button.
 */
export function SessionBranchPair({ sessionBranch, mainBranch }: { sessionBranch?: string | null; mainBranch?: string | null }) {
  if (!shouldShowDualBranch(sessionBranch, mainBranch)) return null
  const session = sessionBranch!.trim()
  const main = mainBranch!.trim()
  const title = `会话分支：${session} · 主树：${main}`
  return (
    <span className="session-branch-pair" data-testid="session-branch-pair" title={title} aria-label={title}>
      <span className="session-branch-icon" aria-hidden="true">⑂</span>
      <span className="session-branch-name" data-testid="session-branch-name">{truncateBranch(session)}</span>
    </span>
  )
}

/** Fetches the project-root GitStatus and renders the dual-branch pair when it differs. */
export function SessionBranchHeader({
  host,
  projectId,
  workspace,
  gitAvailable,
}: {
  host: PipiHostAPI
  projectId?: string
  workspace?: Pick<SessionWorkspace, 'branch'>
  gitAvailable: boolean
}) {
  const [mainBranch, setMainBranch] = useState<string | undefined>()
  const sessionBranch = workspace?.branch
  useEffect(() => {
    if (!gitAvailable || !projectId || !host.gitStatus || !sessionBranch) {
      setMainBranch(undefined)
      return
    }
    let cancelled = false
    void host.gitStatus(projectId)
      .then(status => {
        if (!cancelled) setMainBranch(status.isRepo ? status.currentBranch : undefined)
      })
      .catch(() => { if (!cancelled) setMainBranch(undefined) })
    return () => { cancelled = true }
  }, [gitAvailable, projectId, host, sessionBranch])
  return <SessionBranchPair sessionBranch={sessionBranch} mainBranch={mainBranch} />
}

function UnmergedGlyph() {
  return (
    <svg className="sb-unmerged-icon" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.4v5.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.7 3.6 6 1.3l2.3 2.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="9.2" r="1.55" fill="currentColor" />
    </svg>
  )
}

export function UnmergedAheadBadge({ aheadOfMain }: { aheadOfMain?: number | null }) {
  if (!shouldShowUnmergedBadge(aheadOfMain)) return null
  const title = `领先 ${aheadOfMain} 个提交`
  return (
    <span className="sb-unmerged-badge" data-testid="session-unmerged-badge" title={title} aria-label={`未 merge，${title}`}>
      <UnmergedGlyph />
    </span>
  )
}

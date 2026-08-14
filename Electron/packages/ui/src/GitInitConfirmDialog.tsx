import { useState } from 'react'

/**
 * Add-project-time guard for non-git folders. Writable PipiUI workers are
 * isolated in git worktrees and merged back by the runtime, so a folder
 * outside a git work tree cannot host parallel writable work at all — the
 * dispatch refuses a shared-cwd fallback instead of risking concurrent writes.
 * This dialog states that trade-off before the folder joins the sidebar and
 * offers the one-click remedy (`git init`) next to "add anyway".
 */
export function GitInitConfirmDialog({ path, canInit, onInit, onAddAnyway, onCancel }: {
  path: string
  /** Hosts without `gitInitDirectory` only offer the add-anyway path. */
  canInit: boolean
  onInit: () => Promise<void>
  onAddAnyway: () => void
  onCancel: () => void
}) {
  const [initing, setIniting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runInit = async () => {
    setIniting(true)
    setError(null)
    try {
      await onInit()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIniting(false)
    }
  }
  return (
    <div className="model-modal-backdrop" data-testid="git-init-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !initing) onCancel() }}>
      <section className="model-modal git-init-modal" role="dialog" aria-modal="true" aria-label="该文件夹不是 Git 仓库" data-testid="git-init-modal">
        <header>
          <h2>该文件夹不是 Git 仓库</h2>
          <p>PipiUI 的并行可写工人（subagent）在独立的 Git 工作区里改文件，再由运行时自动合并回来；没有 Git 就没有这条隔离与合并通道。</p>
        </header>
        <div className="model-modal-body">
          <p className="git-init-path" title={path}>{path}</p>
          <ul className="git-init-facts">
            <li>初始化 Git 后：并行可写工人可用，改动可审查、可回退。</li>
            <li>直接添加：主会话仍可读写文件，但派发可写工人会立即失败，Agent 只能串行直接改文件。</li>
          </ul>
          {error && <div className="git-init-error" role="alert" data-testid="git-init-error">初始化失败：{error}</div>}
        </div>
        <footer className="git-init-actions">
          <button type="button" className="git-init-cancel" data-testid="git-init-cancel" disabled={initing} onClick={onCancel}>取消</button>
          <button type="button" className="git-init-anyway" disabled={initing} onClick={onAddAnyway}>直接添加（不用并行工人）</button>
          {canInit && <button type="button" className="git-init-primary" disabled={initing} data-testid="git-init-confirm" onClick={() => void runInit()}>{initing ? '正在初始化…' : '初始化 Git 并添加'}</button>}
        </footer>
      </section>
    </div>
  )
}

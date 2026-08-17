import { useState } from 'react'
import './empty-setup-guide.css'

export const GIT_MISSING_DISMISSED_KEY = 'pipiui:git-missing-dismissed'

export type SetupGuideStep = 'checking' | 'models' | 'project' | 'session'

export function currentSetupStep(input: {
  modelsLoading: boolean
  hasModels: boolean
  hasProjects: boolean
}): SetupGuideStep {
  if (input.modelsLoading) return 'checking'
  if (!input.hasModels) return 'models'
  if (!input.hasProjects) return 'project'
  return 'session'
}

const STEPS: { id: Exclude<SetupGuideStep, 'checking'>; title: string; action: string }[] = [
  { id: 'models', title: '添加 API Key', action: '添加 API Key' },
  { id: 'project', title: '添加项目文件夹', action: '添加项目' },
  { id: 'session', title: '新建会话', action: '新建会话' },
]

export function EmptySetupGuide({
  modelsLoading,
  hasModels,
  hasProjects,
  gitInstalled,
  onAddApiKey,
  onAddProject,
  onNewSession,
}: {
  modelsLoading: boolean
  hasModels: boolean
  hasProjects: boolean
  gitInstalled: boolean | 'unknown'
  onAddApiKey: () => void
  onAddProject: () => void
  onNewSession: () => void
}) {
  const step = currentSetupStep({ modelsLoading, hasModels, hasProjects })
  const [gitDismissed, setGitDismissed] = useState(() => localStorage.getItem(GIT_MISSING_DISMISSED_KEY) === '1')
  const showGitTip = gitInstalled === false && !gitDismissed
  const run = (id: Exclude<SetupGuideStep, 'checking'>) => {
    if (id === 'models') onAddApiKey()
    else if (id === 'project') onAddProject()
    else onNewSession()
  }

  return (
    <div className="empty-setup" data-testid="empty-setup">
      {showGitTip && (
        <div className="empty-setup-git" data-testid="empty-setup-git" role="status">
          <p>安装 Git 才能获得最佳体验。并行子任务和项目版本管理都依赖它。macOS 可在终端运行 <code>xcode-select --install</code>。</p>
          <button type="button" aria-label="关闭 Git 提示" title="关闭 Git 提示" onClick={() => {
            localStorage.setItem(GIT_MISSING_DISMISSED_KEY, '1')
            setGitDismissed(true)
          }}>×</button>
        </div>
      )}
      <h1>开始使用 PipiUI</h1>
      <p className="empty-setup-lead">先配好模型，再打开一个项目就能聊。</p>
      {step === 'checking' ? (
        <p className="empty-setup-checking" data-testid="empty-setup-checking">正在检查模型…</p>
      ) : (
        <ol className="empty-setup-steps">
          {STEPS.map((item, index) => {
            const currentIndex = STEPS.findIndex(entry => entry.id === step)
            const done = index < currentIndex
            const current = item.id === step
            return (
              <li key={item.id} className={current ? 'is-current' : done ? 'is-done' : 'is-upcoming'} data-testid={`empty-setup-step-${item.id}`}>
                <span className="empty-setup-index" aria-hidden="true">{done ? '✓' : index + 1}</span>
                <span className="empty-setup-title">{item.title}</span>
                {current && <button type="button" className="empty-setup-action" data-testid="empty-setup-action" onClick={() => run(item.id)}>{item.action}</button>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

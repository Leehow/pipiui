// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Model, PipiHostAPI } from '@pipi/host-api'
import { ModelVisibilityModal } from './ModelVisibilityModal'

afterEach(() => {
  cleanup()
})

function hostStub(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return {
    protocolVersion: 2,
    listProjects: async () => [],
    listSessions: async () => [],
    newSession: async () => ({ id: 's', projectId: 'p', name: 'n', updatedAt: 1 }),
    resumeSession: async () => ({ id: 's', projectId: 'p', name: 'n', updatedAt: 1 }),
    renameSession: async () => ({ id: 's', projectId: 'p', name: 'n', updatedAt: 1 }),
    deleteSession: async () => undefined,
    moveSession: async () => ({ id: 's', projectId: 'p', name: 'n', updatedAt: 1 }),
    getSessionHistory: async () => [],
    getSessionLease: async () => ({ writable: true }),
    forceTakeoverSessionLease: async () => ({ writable: true }),
    sendPrompt: async () => undefined,
    listQueue: async () => [],
    enqueueMessage: async () => ({ id: 'q' } as never),
    updateQueuedMessage: async () => ({ id: 'q' } as never),
    removeQueuedMessage: async () => ({ id: 'q' } as never),
    promoteQueuedMessage: async () => ({ id: 'q' } as never),
    steerQueuedMessage: async () => ({ id: 'q' } as never),
    cutInQueuedMessage: async () => ({ id: 'q' } as never),
    retryQueuedMessage: async () => ({ id: 'q' } as never),
    stop: async () => undefined,
    queueFollowUp: async () => undefined,
    subscribeStream: () => () => undefined,
    listModels: async () => [],
    getModelState: async () => ({ model: { provider: 'x', id: 'y', name: 'z' }, thinkingLevel: 'off', availableThinkingLevels: [] }),
    setModel: async () => ({ model: { provider: 'x', id: 'y', name: 'z' }, thinkingLevel: 'off', availableThinkingLevels: [] }),
    setThinkingLevel: async () => ({ model: { provider: 'x', id: 'y', name: 'z' }, thinkingLevel: 'off', availableThinkingLevels: [] }),
    getHiddenModelIds: async () => [],
    setHiddenModelIds: async () => [],
    authProviders: async () => [],
    beginProviderLogin: async () => ({ loginId: 'l' }),
    continueProviderLogin: async () => ({ type: 'done' } as never),
    cancelProviderLogin: async () => undefined,
    removeProviderCredentials: async () => ({ model: { provider: 'x', id: 'y', name: 'z' }, thinkingLevel: 'off', availableThinkingLevels: [] }),
    getSessionStats: async () => ({ sessionId: 's' }),
    subscribeSessionStats: () => () => undefined,
    listAgents: async () => [],
    getAgentLogs: async () => [],
    subscribeAgents: () => () => undefined,
    subscribeAgentLog: () => () => undefined,
    abortAgent: async () => undefined,
    resolveAgent: async () => undefined,
    checkAgent: async () => ({ agentId: 'a', runId: 'r', name: 'n', role: 'general-purpose', title: '', task: '', state: 'idle', depth: 0 }),
    getWorktreeStatus: async () => ({ agentId: 'a', branch: '', path: '', lifecycle: 'none' } as never),
    mergeWorktree: async () => ({ agentId: 'a', branch: '', path: '', lifecycle: 'none' } as never),
    discardWorktree: async () => ({ agentId: 'a', branch: '', path: '', lifecycle: 'none' } as never),
    capabilities: async () => ({}),
    gitStatus: async () => ({ isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 }),
    gitCheckout: async () => ({ isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 }),
    probeDirectoryGit: async () => ({ isRepo: false }),
    gitInitDirectory: async () => ({ isRepo: true }),
    probeGitBinary: async () => ({ found: true }),
    revealProject: async () => undefined,
    getVisionEnabled: async () => false,
    setVisionEnabled: async () => false,
    getVisionModel: async () => null,
    setVisionModel: async () => null,
    openExternal: async () => undefined,
    ...overrides,
  } as PipiHostAPI
}

const visibility = {
  models: [] as Model[],
  quickModels: [] as Model[],
  visibleModels: [] as Model[],
  hiddenIds: new Set<string>(),
  loading: false,
  error: null as string | null,
  refresh: async () => undefined,
  toggle: async () => undefined,
  toggleProvider: async () => undefined,
  removedProviders: [] as string[],
  restoreProvider: async () => undefined,
  dismissError: () => undefined,
}

const vision = {
  enabled: false,
  model: null,
  available: true,
  loading: false,
  saving: false,
  error: null,
  refresh: async () => undefined,
  setEnabled: async () => undefined,
  setModel: async () => undefined,
  dismissError: () => undefined,
}

const scan = {
  enabled: true,
  available: true,
  loading: false,
  saving: false,
  error: null,
  refresh: async () => undefined,
  setEnabled: async () => undefined,
  dismissError: () => undefined,
}

const updates = {
  available: false,
  loading: false,
  snapshot: null,
  error: null,
  refresh: async () => undefined,
}

describe('general settings moved into extensions', () => {
  it('does not render Firecrawl key controls anywhere in the modal', async () => {
    render(
      <ModelVisibilityModal
        host={hostStub()}
        visibility={visibility as never}
        vision={vision as never}
        scan={scan as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    fireEvent.click(screen.getByTestId('model-tab-models'))
    expect(screen.queryByTestId('firecrawl-pdf-pane')).toBeNull()
    expect(screen.queryByText('Firecrawl OCR Key（选填）')).toBeNull()
    expect(screen.queryByTestId('firecrawl-pdf-key-input')).toBeNull()
  })

  it('has no 通用 tab left: the scan toggle moved under the external-session-scan builtin in 扩展', () => {
    render(
      <ModelVisibilityModal
        host={hostStub()}
        visibility={visibility as never}
        vision={vision as never}
        scan={scan as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    expect(screen.queryByTestId('model-tab-general')).toBeNull()
    expect(screen.getByTestId('model-tab-models')).toBeTruthy()
    expect(screen.getByTestId('model-tab-extensions')).toBeTruthy()
    expect(screen.getByTestId('model-tab-updates')).toBeTruthy()
    expect(screen.queryByTestId('scan-external-pane')).toBeNull()
    expect(screen.queryByTestId('vision-picker')).toBeNull()
    expect(screen.queryByTestId('web-search-keys-pane')).toBeNull()
  })
})

describe('settings modal has no secret vault entry', () => {
  it('does not render a secrets tab, pane, or vault management copy', () => {
    render(
      <ModelVisibilityModal
        host={hostStub()}
        visibility={visibility as never}
        vision={vision as never}
        scan={scan as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    expect(screen.queryByTestId('model-tab-general')).toBeNull()
    expect(screen.getByTestId('model-tab-models')).toBeTruthy()
    expect(screen.getByTestId('model-tab-extensions')).toBeTruthy()
    expect(screen.getByTestId('model-tab-updates')).toBeTruthy()
    expect(screen.queryByTestId('model-tab-secrets')).toBeNull()
    expect(screen.queryByTestId('secret-vault-pane')).toBeNull()
    expect(screen.queryByTestId('secret-vault-form')).toBeNull()
    expect(screen.queryByText('密钥库')).toBeNull()
    expect(screen.queryByText('密钥管理')).toBeNull()
    expect(screen.queryByText('添加密钥')).toBeNull()
    expect(screen.queryByText('重试检测')).toBeNull()
    expect(screen.queryByText('保存并挂载')).toBeNull()
  })
})

describe('removed providers are recoverable', () => {
  it('lists them behind a collapsed section and restores one on click', async () => {
    const restored: string[] = []
    const withRemoved = {
      ...visibility,
      removedProviders: ['deepseek', 'opencode'],
      restoreProvider: async (provider: string) => { restored.push(provider) },
    }
    render(
      <ModelVisibilityModal
        host={hostStub()}
        visibility={withRemoved as never}
        vision={vision as never}
        scan={scan as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    // Removing a provider must never be a one-way door: the count is visible
    // even while the section is collapsed.
    expect(screen.getByTestId('removed-providers-count').textContent).toBe('2')
    expect(screen.queryByTestId('restore-provider-deepseek')).toBeNull()
    fireEvent.click(screen.getByText('已移除的供应商'))
    fireEvent.click(screen.getByTestId('restore-provider-deepseek'))
    await waitFor(() => expect(restored).toEqual(['deepseek']))
  })

  it('renders no removed section when nothing was removed', () => {
    render(
      <ModelVisibilityModal
        host={hostStub()}
        visibility={{ ...visibility, removedProviders: [], restoreProvider: async () => undefined } as never}
        vision={vision as never}
        scan={scan as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    expect(screen.queryByTestId('removed-providers')).toBeNull()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    getPaddleOcrStatus: async () => ({ hasKey: false }),
    setPaddleOcrAccessToken: async () => ({ hasKey: true }),
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

describe('general settings no longer host Firecrawl OCR', () => {
  it('does not render Firecrawl key controls on the general tab', async () => {
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
    fireEvent.click(screen.getByTestId('model-tab-general'))
    expect(screen.queryByTestId('firecrawl-pdf-pane')).toBeNull()
    expect(screen.queryByText('Firecrawl OCR Key（选填）')).toBeNull()
    expect(screen.queryByTestId('firecrawl-pdf-key-input')).toBeNull()
  })

  it('renders the external-session scan switch on by default and persists the toggle', async () => {
    const setScanExternalSessions = vi.fn(async (enabled: boolean) => enabled)
    const scanToggle = {
      ...scan,
      setEnabled: setScanExternalSessions,
    }
    render(
      <ModelVisibilityModal
        host={hostStub({ setScanExternalSessions })}
        visibility={visibility as never}
        vision={vision as never}
        scan={scanToggle as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    fireEvent.click(screen.getByTestId('model-tab-general'))
    const toggle = screen.getByTestId('scan-external-sessions-switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('自动扫描其他 coding agent 聊天记录')).toBeTruthy()
    expect(screen.getByText('关闭后侧栏不再显示 Codex / Claude / Cursor 等外部会话。')).toBeTruthy()
    fireEvent.click(toggle)
    expect(setScanExternalSessions).toHaveBeenCalledWith(false)
  })
})

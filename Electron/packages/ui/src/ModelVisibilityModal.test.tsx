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
    getFirecrawlPdfStatus: async () => ({ hasKey: false }),
    setFirecrawlPdfApiKey: async () => ({ hasKey: true }),
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

const updates = {
  available: false,
  loading: false,
  snapshot: null,
  error: null,
  refresh: async () => undefined,
}

describe('Firecrawl PDF OCR settings', () => {
  it('saves and clears through hasKey-only APIs and opens the official key page', async () => {
    const getFirecrawlPdfStatus = vi.fn(async () => ({ hasKey: false }))
    const setFirecrawlPdfApiKey = vi.fn(async (_projectId: string, key: string | null) => ({ hasKey: Boolean(key) }))
    const openExternal = vi.fn(async () => undefined)
    const host = hostStub({ getFirecrawlPdfStatus, setFirecrawlPdfApiKey, openExternal })
    render(
      <ModelVisibilityModal
        host={host}
        visibility={visibility as never}
        vision={vision as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    fireEvent.click(screen.getByTestId('model-tab-general'))
    expect(await screen.findByTestId('firecrawl-pdf-pane')).toBeTruthy()
    expect(screen.getByTestId('firecrawl-pdf-status').textContent).toContain('尚未配置')
    fireEvent.change(screen.getByTestId('firecrawl-pdf-key-input'), { target: { value: 'fc-secret-should-not-echo' } })
    fireEvent.click(screen.getByTestId('firecrawl-pdf-save'))
    await waitFor(() => expect(setFirecrawlPdfApiKey).toHaveBeenCalledWith('project-1', 'fc-secret-should-not-echo'))
    expect(screen.queryByText('fc-secret-should-not-echo')).toBeNull()
    expect(screen.getByTestId('firecrawl-pdf-status').textContent).toContain('已配置')
    fireEvent.click(screen.getByTestId('firecrawl-pdf-clear'))
    await waitFor(() => expect(setFirecrawlPdfApiKey).toHaveBeenCalledWith('project-1', null))
    fireEvent.click(screen.getByTestId('firecrawl-pdf-apply'))
    expect(openExternal).toHaveBeenCalledWith('https://www.firecrawl.dev/app/api-keys')
    expect(screen.getByTestId('firecrawl-pdf-pane').textContent).toContain('Firecrawl OCR Key（选填）')
    expect(screen.getByTestId('firecrawl-pdf-pane').textContent).toContain('不配置仍可本地解析文字型 PDF')
  })

  it('lets the user dismiss a Firecrawl save error', async () => {
    const host = hostStub({
      getFirecrawlPdfStatus: vi.fn(async () => ({ hasKey: false })),
      setFirecrawlPdfApiKey: vi.fn(async () => { throw new Error('保存失败：磁盘只读') }),
    })
    render(
      <ModelVisibilityModal
        host={host}
        visibility={visibility as never}
        vision={vision as never}
        updates={updates as never}
        current={null}
        onRequestUpdate={() => undefined}
        onClose={() => undefined}
        projectId="project-1"
      />,
    )
    fireEvent.click(screen.getByTestId('model-tab-general'))
    fireEvent.change(await screen.findByTestId('firecrawl-pdf-key-input'), { target: { value: 'fc-new' } })
    fireEvent.click(screen.getByTestId('firecrawl-pdf-save'))
    expect(await screen.findByTestId('firecrawl-pdf-error')).toBeTruthy()
    fireEvent.click(screen.getByTestId('firecrawl-pdf-error-close'))
    expect(screen.queryByTestId('firecrawl-pdf-error')).toBeNull()
  })
})

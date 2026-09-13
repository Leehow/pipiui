// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Model, SubagentDebugInfo } from '@pipi/host-api'
import { createMockHost } from './App'
import { SubagentModelModal } from './SubagentModelModal'
import type { ModelVisibilityController } from './useModelVisibility'

afterEach(cleanup)

const gpt: Model = { provider: 'openai', id: 'gpt-5', name: 'GPT-5', reasoning: true }

function visibility(): ModelVisibilityController {
  return {
    models: [gpt],
    hiddenIds: new Set(),
    loading: false,
    error: null,
    visibleModels: [gpt],
    quickModels: [gpt],
    quickProviders: ['openai'],
    quickGroups: [],
    refresh: async () => undefined,
    catalogEpoch: 0,
    removedProviders: [],
    restoreProvider: async () => undefined,
    setHidden: async () => undefined,
    setProviderHidden: async () => undefined,
    dismissError: () => undefined,
  }
}

function liveDebug(sessionId: string, toolName = 'read'): SubagentDebugInfo {
  return {
    available: true,
    source: 'live',
    sessionId,
    capturedAt: 1234,
    bossTools: [{ name: toolName, description: `${toolName} description` }],
    toolCatalog: [{ name: toolName, description: `${toolName} description` }],
    skills: [],
    subagents: [],
  }
}

describe('SubagentModelModal Debug mode', () => {
  it('shows complete Boss/Subagent tools and expands skill_load into callable Skills', async () => {
    const host = createMockHost()
    const debug = vi.spyOn(host, 'getSubagentDebugInfo')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} sessionId="session-1" />)
    await screen.findByTestId('subagent-agent-explore')

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))
    const view = await screen.findByTestId('subagent-debug-view')
    expect(screen.getByRole('dialog', { name: 'Subagent Debug' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭 Subagent Debug' })).toBeTruthy()
    expect(debug).toHaveBeenCalledWith('session-1')

    expect(screen.getByText('演示 Debug（非当前 Boss）')).toBeTruthy()
    expect(screen.getByText(/当前是浏览器演示数据，不代表正在运行的 Boss/)).toBeTruthy()
    const boss = within(screen.getByTestId('debug-role-boss'))
    expect(boss.getByText('Boss（演示数据）')).toBeTruthy()
    expect(boss.getByText('工具').parentElement?.textContent).toContain('64')
    expect(boss.getByText('grep')).toBeTruthy()
    expect(boss.getByText('edit')).toBeTruthy()
    expect(boss.getByText('读取文本文件或图片，并按需返回指定范围。')).toBeTruthy()

    const skillLoad = boss.getByTestId('subagent-debug-skill-load') as HTMLDetailsElement
    expect(skillLoad.open).toBe(false)
    fireEvent.click(within(skillLoad).getByText('skill_load'))
    await waitFor(() => expect(skillLoad.open).toBe(true))
    expect(within(skillLoad).getByText('tdd')).toBeTruthy()
    expect(within(skillLoad).getByText('按测试驱动开发流程先建立失败用例，再实现并重构。')).toBeTruthy()

    const explore = within(screen.getByTestId('debug-role-explore'))
    expect(explore.getByText('grep')).toBeTruthy()
    expect(explore.getByText('skill_load')).toBeTruthy()
    expect(within(screen.getByTestId('debug-role-general-purpose')).getByText('edit')).toBeTruthy()
    expect(view.textContent).not.toContain('SECRET_PROMPT')

    fireEvent.click(screen.getByRole('button', { name: '模型设置' }))
    expect(screen.queryByTestId('subagent-debug-view')).toBeNull()
    expect(screen.getByTestId('subagent-agent-explore')).toBeTruthy()
  })

  it('falls back to a truthful legacy worker tool set when an older catalog omits metadata', async () => {
    const host = createMockHost()
    host.listAgentDefinitions = vi.fn(async () => [{ name: 'legacy-worker', description: 'Legacy custom worker' }])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} sessionId="session-1" />)
    await screen.findByTestId('subagent-agent-legacy-worker')

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))
    const legacy = within(await screen.findByTestId('debug-role-legacy-worker'))
    expect(legacy.getByText('grep')).toBeTruthy()
    expect(legacy.getByText('edit')).toBeTruthy()
    expect(legacy.getByText('skill_load')).toBeTruthy()
  })

  it('opens live Debug even when the model-settings API rejects', async () => {
    const host = createMockHost()
    host.getSubagentModels = vi.fn(async () => { throw new Error('model catalog offline') })
    host.listAgentDefinitions = vi.fn(async () => [{ name: 'catalog-survivor', description: 'Loaded independently of model settings' }])
    host.getSubagentDebugInfo = vi.fn(async () => liveDebug('session-live', 'live-only-tool'))
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} sessionId="session-live" />)
    await screen.findByText(/model catalog offline/)

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))

    expect(await screen.findByTestId('subagent-debug-view')).toBeTruthy()
    expect(screen.getByText('live-only-tool')).toBeTruthy()
    expect(screen.getByTestId('debug-role-catalog-survivor')).toBeTruthy()
    expect(host.getSubagentDebugInfo).toHaveBeenCalledWith('session-live')
  })

  it('explains when the live Debug snapshot exceeds the bounded file limit', async () => {
    const host = createMockHost()
    host.getSubagentDebugInfo = vi.fn(async (): Promise<SubagentDebugInfo> => ({
      available: false,
      reason: 'snapshot-too-large',
      bossTools: [],
      toolCatalog: [],
      skills: [],
      subagents: [],
    }))
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} sessionId="session-large" />)

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))

    expect(await screen.findByText(/超过 1 MiB/)).toBeTruthy()
    expect(screen.queryByText(/重新进入一次会话/)).toBeNull()
  })

  it('shows the no-session state without inventing a session id', async () => {
    const host = createMockHost()
    host.getSubagentDebugInfo = vi.fn(async (): Promise<SubagentDebugInfo> => ({
      available: false,
      reason: 'no-session',
      bossTools: [],
      toolCatalog: [],
      skills: [],
      subagents: [],
    }))
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))

    expect(await screen.findByText(/当前没有打开的会话/)).toBeTruthy()
    expect(host.getSubagentDebugInfo).toHaveBeenCalledWith(undefined)
  })

  it('surfaces a rejected Debug read and refreshes to a live snapshot', async () => {
    const host = createMockHost()
    host.getSubagentDebugInfo = vi.fn()
      .mockRejectedValueOnce(new Error('snapshot transport rejected'))
      .mockResolvedValueOnce(liveDebug('session-refresh', 'after-refresh-tool'))
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} sessionId="session-refresh" />)

    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))
    expect(await screen.findByText(/snapshot transport rejected/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新 Debug 信息' }))

    expect(await screen.findByText('after-refresh-tool')).toBeTruthy()
    expect(host.getSubagentDebugInfo).toHaveBeenCalledTimes(2)
  })

  it('discards a delayed snapshot after switching sessions', async () => {
    const host = createMockHost()
    let resolveFirst!: (value: SubagentDebugInfo) => void
    const first = new Promise<SubagentDebugInfo>(resolve => { resolveFirst = resolve })
    host.getSubagentDebugInfo = vi.fn((sessionId?: string) => (
      sessionId === 'session-a' ? first : Promise.resolve(liveDebug('session-b', 'session-b-tool'))
    ))
    const props = { host, current: gpt, visibility: visibility(), onClose: () => undefined }
    const rendered = render(<SubagentModelModal {...props} sessionId="session-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Debug' }))
    await waitFor(() => expect(host.getSubagentDebugInfo).toHaveBeenCalledWith('session-a'))

    rendered.rerender(<SubagentModelModal {...props} sessionId="session-b" />)
    expect(await screen.findByText('session-b-tool')).toBeTruthy()
    resolveFirst(liveDebug('session-a', 'stale-session-a-tool'))
    await Promise.resolve()

    expect(screen.queryByText('stale-session-a-tool')).toBeNull()
    expect(screen.getByText('session-b-tool')).toBeTruthy()
    expect(host.getSubagentDebugInfo).toHaveBeenCalledWith('session-b')
  })
})

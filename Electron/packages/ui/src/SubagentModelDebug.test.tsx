// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '@pipi/host-api'
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
    setHidden: async () => undefined,
    setProviderHidden: async () => undefined,
    dismissError: () => undefined,
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
})

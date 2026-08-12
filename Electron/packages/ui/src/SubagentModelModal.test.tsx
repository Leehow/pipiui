// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Model, PipiHostAPI, SubagentModelSetting } from '@pipi/host-api'
import { createMockHost } from './App'
import { SubagentModelModal } from './SubagentModelModal'
import type { ModelVisibilityController } from './useModelVisibility'

afterEach(cleanup)

const gpt: Model = { provider: 'openai', id: 'gpt-5', name: 'GPT-5', reasoning: true }
const claude: Model = { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true }
const hidden: Model = { provider: 'deepseek', id: 'deepseek-v3', name: 'DeepSeek V3', reasoning: false }

function visibility(overrides: Partial<ModelVisibilityController> = {}): ModelVisibilityController {
  return {
    models: [gpt, claude, hidden],
    hiddenIds: new Set(['deepseek/deepseek-v3']),
    loading: false,
    error: null,
    // Deliberately keep the full catalog in visibleModels and the composer's
    // current-model exception in quickModels. The Subagent picker must enforce
    // checked state from hiddenIds instead of trusting either broad array.
    visibleModels: [gpt, claude, hidden],
    quickModels: [gpt, claude, hidden],
    quickProviders: ['openai', 'anthropic'],
    quickGroups: [],
    refresh: async () => undefined,
    setHidden: async () => undefined,
    setProviderHidden: async () => undefined,
    dismissError: () => undefined,
    ...overrides
  }
}

describe('SubagentModelModal', () => {
  it('persists the provider-qualified model selected for a nested Computer Worker', async () => {
    const xaiGrok: Model = { provider: 'xai', id: 'grok-4.5', name: 'Grok 4.5', reasoning: true }
    const copilotGrok: Model = { provider: 'github-copilot', id: 'grok-4.5', name: 'Grok 4.5', reasoning: true }
    const host = createMockHost()
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility({
      models: [xaiGrok, copilotGrok],
      visibleModels: [xaiGrok, copilotGrok],
      quickModels: [xaiGrok, copilotGrok],
      quickProviders: ['xai', 'github-copilot'],
      hiddenIds: new Set(),
    })} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-operator')
    fireEvent.click(screen.getByRole('button', { name: 'operator 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-operator-0-xai-grok-4.5'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      operator: [{ model: 'xai/grok-4.5', thinking: 'off' }],
    }))
  })

  it('shows a non-binding visual-model hint only for screenshot-reading roles without changing defaults', async () => {
    const host = createMockHost()
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    const operator = await screen.findByTestId('subagent-agent-operator')
    const verifier = screen.getByTestId('subagent-agent-computer-verifier')
    const leader = screen.getByTestId('subagent-agent-computer-use-leader')
    const terminal = screen.getByTestId('subagent-agent-computer-terminal')
    expect(within(operator).getByText(/需要查看截图，建议选择支持图像输入的模型/)).toBeTruthy()
    expect(within(verifier).getByText(/需要查看截图，建议选择支持图像输入的模型/)).toBeTruthy()
    expect(within(leader).queryByText(/需要查看截图/)).toBeNull()
    expect(within(terminal).queryByText(/需要查看截图/)).toBeNull()
    for (const role of ['operator', 'computer-verifier', 'computer-use-leader', 'computer-terminal']) {
      expect(screen.getByRole('button', { name: `${role} 0 模型` }).textContent).toContain('跟随主 Agent')
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('leaves loading, filters to model-management enabled models, and persists independent role chains', async () => {
    const host = createMockHost()
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-explore')
    expect(screen.queryByText('正在加载 Subagent 模型设置…')).toBeNull()
	expect(screen.getAllByTestId(/^subagent-agent-/)).toHaveLength(10)
	expect(screen.getByRole('heading', { name: 'Computer Use Agent' })).toBeTruthy()
	expect(screen.getByTestId('subagent-agent-computer-use-leader')).toBeTruthy()
	expect(screen.getByTestId('subagent-agent-operator')).toBeTruthy()
	expect(screen.getByTestId('subagent-agent-computer-verifier')).toBeTruthy()
	expect(screen.getByTestId('subagent-agent-computer-terminal')).toBeTruthy()

	fireEvent.click(screen.getByRole('button', { name: 'computer-use-leader 0 模型' }))
	fireEvent.click(screen.getByTestId('subagent-model-option-computer-use-leader-0-openai-gpt-5'))
	await waitFor(() => expect(screen.getByRole('button', { name: 'computer-use-leader 0 模型' }).textContent).toContain('GPT-5'))
	fireEvent.click(screen.getByRole('button', { name: 'computer-verifier 0 模型' }))
	fireEvent.click(screen.getByTestId('subagent-model-option-computer-verifier-0-anthropic-claude-sonnet-4'))
	await waitFor(() => expect(screen.getByRole('button', { name: 'computer-verifier 0 模型' }).textContent).toContain('Claude'))
	fireEvent.click(screen.getByRole('button', { name: 'computer-terminal 0 模型' }))
	fireEvent.click(screen.getByTestId('subagent-model-option-computer-terminal-0-openai-gpt-5'))
	await waitFor(() => expect(screen.getByRole('button', { name: 'computer-terminal 0 模型' }).textContent).toContain('GPT-5'))

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    expect(screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5')).toBeTruthy()
    expect(screen.queryByTestId('subagent-model-option-explore-0-deepseek-deepseek-v3')).toBeNull()
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'explore 0 模型' }).textContent).toContain('GPT-5'))
    fireEvent.change(screen.getByLabelText('explore 0 思考强度'), { target: { value: 'high' } })

    fireEvent.click(screen.getByRole('button', { name: 'plan 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-plan-0-anthropic-claude-sonnet-4'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'plan 0 模型' }).textContent).toContain('Claude'))
    fireEvent.click(within(screen.getByTestId('subagent-agent-plan')).getByRole('button', { name: /添加备用模型/ }))
    await waitFor(() => expect(screen.getAllByTestId(/^subagent-chain-plan-/)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'plan 1 模型' }))
    expect(screen.queryByTestId('subagent-model-option-plan-1-deepseek-deepseek-v3')).toBeNull()
    expect(screen.getByTestId('subagent-model-option-plan-1-openai-gpt-5')).toBeTruthy()

    await waitFor(async () => {
      expect(await host.getSubagentModels?.()).toMatchObject({
		'computer-use-leader': [{ model: 'openai/gpt-5', thinking: 'off' }],
		'computer-verifier': [{ model: 'anthropic/claude-sonnet-4', thinking: 'off' }],
		'computer-terminal': [{ model: 'openai/gpt-5', thinking: 'off' }],
        explore: [{ model: 'openai/gpt-5', thinking: 'high' }],
        plan: [{ model: 'anthropic/claude-sonnet-4', thinking: 'off' }, { model: 'openai/gpt-5', thinking: 'off' }]
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    const selected = screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5')
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(within(selected).getByLabelText('已选中')).toBeTruthy()
  })

  it('keeps loading until both persisted settings and roles arrive', async () => {
    let resolve!: (value: Record<string, SubagentModelSetting[]>) => void
    const host = createMockHost()
    host.getSubagentModels = vi.fn(() => new Promise<Record<string, SubagentModelSetting[]>>(result => { resolve = result }))
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={() => undefined} />)
    expect(screen.getByText('正在加载 Subagent 模型设置…')).toBeTruthy()
    resolve({})
    await screen.findByTestId('subagent-agent-explore')
  })

  it('shows a truthful, closeable unsupported/error state instead of loading forever', async () => {
    const onClose = vi.fn()
    const host = createMockHost()
    host.getSubagentModels = vi.fn(async (): Promise<Record<string, never[]>> => { throw new Error('unknown method: getSubagentModels') })
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={onClose} />)
    expect((await screen.findByRole('alert')).textContent).toContain('unknown method: getSubagentModels')
    expect(screen.queryByText('正在加载 Subagent 模型设置…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭 Subagent 模型' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports model-visibility load failures without exposing an unfiltered catalog', async () => {
    const host = createMockHost()
    render(<SubagentModelModal host={host} current={null} visibility={visibility({ error: 'disk read failed' })} onClose={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toContain('disk read failed')
    expect(screen.queryByTestId('subagent-agent-explore')).toBeNull()
  })
})

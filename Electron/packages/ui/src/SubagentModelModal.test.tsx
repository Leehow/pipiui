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
  it('keeps Hermes review separate, follows main by default, filters hidden models, and clears an explicit model', async () => {
    const host = createMockHost()
    const save = vi.spyOn(host, 'setMemoryReviewModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)

    const row = await screen.findByTestId('memory-review-model-row')
    const picker = within(row).getByRole('button', { name: 'memory-review 0 模型' })
    expect(picker.textContent).toContain('跟随主 Agent')
    expect(within(row).queryByText(/思考强度/)).toBeNull()
    expect(within(row).queryByText(/添加备用模型/)).toBeNull()

    fireEvent.click(picker)
    expect(screen.queryByTestId('subagent-model-option-memory-review-0-deepseek-deepseek-v3')).toBeNull()
    fireEvent.click(screen.getByTestId('subagent-model-option-memory-review-0-anthropic-claude-sonnet-4'))
    await waitFor(() => expect(picker.textContent).toContain('anthropic/claude-sonnet-4'))
    expect(save).toHaveBeenLastCalledWith('anthropic/claude-sonnet-4')
    expect(await host.getMemoryReviewModel?.()).toBe('anthropic/claude-sonnet-4')

    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('option', { name: /跟随主 Agent/ }))
    await waitFor(() => expect(picker.textContent).toContain('跟随主 Agent'))
    expect(save).toHaveBeenLastCalledWith(null)
    expect(await host.getMemoryReviewModel?.()).toBeNull()
  })

  it('keeps existing subagent settings available when an older host lacks Hermes review methods', async () => {
    const host = createMockHost()
    host.getMemoryReviewModel = undefined
    host.setMemoryReviewModel = undefined
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    expect(await screen.findByTestId('subagent-agent-explore')).toBeTruthy()
    expect(screen.queryByTestId('memory-review-model-row')).toBeNull()
  })

  it('persists the provider-qualified model selected for the Computer Use Agent', async () => {
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
    await screen.findByTestId('subagent-agent-computer-use')
    fireEvent.click(screen.getByRole('button', { name: 'computer-use 0 模型' }))
    expect(screen.getByTestId('subagent-model-option-computer-use-0-xai-grok-4.5').textContent).toContain('xai/grok-4.5')
    expect(screen.getByTestId('subagent-model-option-computer-use-0-github-copilot-grok-4.5').textContent).toContain('github-copilot/grok-4.5')
    fireEvent.click(screen.getByTestId('subagent-model-option-computer-use-0-xai-grok-4.5'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'computer-use 0 模型' }).textContent).toContain('xai/grok-4.5'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      'computer-use': [{ model: 'xai/grok-4.5' }],
    }))
  })

  it('does not present an ambiguous historical bare id as either provider', async () => {
    const xaiGrok: Model = { provider: 'xai', id: 'grok-4.5', name: 'Grok 4.5', reasoning: true }
    const copilotGrok: Model = { provider: 'github-copilot', id: 'grok-4.5', name: 'Grok 4.5', reasoning: true }
    const host = createMockHost()
    await host.setSubagentModel?.('explore', [{ model: 'grok-4.5', thinking: 'high' }])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility({
      models: [xaiGrok, copilotGrok], visibleModels: [xaiGrok, copilotGrok], quickModels: [xaiGrok, copilotGrok],
      quickProviders: ['xai', 'github-copilot'], hiddenIds: new Set(),
    })} onClose={() => undefined} />)

    const explore = await screen.findByTestId('subagent-agent-explore')
    expect(within(explore).getByRole('button', { name: 'explore 0 模型' }).textContent).toContain('需重新选择 provider（grok-4.5）')
    expect(within(explore).getByRole('alert').textContent).toContain('重新选择完整 provider/model')
    fireEvent.click(within(explore).getByRole('button', { name: 'explore 0 模型' }))
    expect(screen.getByTestId('subagent-model-option-explore-0-xai-grok-4.5').getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('subagent-model-option-explore-0-github-copilot-grok-4.5').getAttribute('aria-selected')).toBe('false')
  })

  it('shows a non-binding visual-model hint only for screenshot-reading roles without changing defaults', async () => {
    const host = createMockHost()
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    const computerUse = await screen.findByTestId('subagent-agent-computer-use')
    expect(within(computerUse).getByText(/需要查看截图，建议选择支持图像输入的模型/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'computer-use 0 模型' }).textContent).toContain('跟随主 Agent')
    expect(save).not.toHaveBeenCalled()
  })

  it('leaves loading, filters to model-management enabled models, and persists independent role chains', async () => {
    const host = createMockHost()
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-explore')
    expect(screen.queryByText('正在加载 Subagent 模型设置…')).toBeNull()
	expect(screen.getAllByTestId(/^subagent-agent-/)).toHaveLength(5)
	expect(screen.getByRole('heading', { name: 'Computer Use Agent' })).toBeTruthy()
	expect(screen.getByTestId('subagent-agent-computer-use')).toBeTruthy()
	const generalHeading = screen.getByRole('heading', { name: '通用 Subagents' })
	const computerHeading = screen.getByRole('heading', { name: 'Computer Use Agent' })
	expect(generalHeading.compareDocumentPosition(computerHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
	const computerHierarchy = screen.getByTestId('computer-use-model-hierarchy')
	expect(within(computerHierarchy).getByTestId('subagent-agent-computer-use')).toBeTruthy()
	expect(within(computerHierarchy).queryByText('Leader 调度')).toBeNull()

	fireEvent.click(screen.getByRole('button', { name: 'computer-use 0 模型' }))
	fireEvent.click(screen.getByTestId('subagent-model-option-computer-use-0-openai-gpt-5'))
	await waitFor(() => expect(screen.getByRole('button', { name: 'computer-use 0 模型' }).textContent).toContain('GPT-5'))

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    expect(screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5')).toBeTruthy()
    expect(screen.queryByTestId('subagent-model-option-explore-0-deepseek-deepseek-v3')).toBeNull()
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'explore 0 模型' }).textContent).toContain('GPT-5'))
    fireEvent.change(screen.getByLabelText('explore 0 思考强度'), { target: { value: 'high' } })

    fireEvent.click(screen.getByRole('button', { name: 'reviewer 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-reviewer-0-anthropic-claude-sonnet-4'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('Claude'))
    fireEvent.click(within(screen.getByTestId('subagent-agent-reviewer')).getByRole('button', { name: /添加备用模型/ }))
    await waitFor(() => expect(screen.getAllByTestId(/^subagent-chain-reviewer-/)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'reviewer 1 模型' }))
    expect(screen.queryByTestId('subagent-model-option-reviewer-1-deepseek-deepseek-v3')).toBeNull()
    expect(screen.getByTestId('subagent-model-option-reviewer-1-openai-gpt-5')).toBeTruthy()

    await waitFor(async () => {
      expect(await host.getSubagentModels?.()).toMatchObject({
        'computer-use': [{ model: 'openai/gpt-5' }],
        explore: [{ model: 'openai/gpt-5', thinking: 'high' }],
        reviewer: [{ model: 'anthropic/claude-sonnet-4' }, { model: 'openai/gpt-5' }]
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

  it('derives mapped choices and preserves only compatible overrides across explicit model changes', async () => {
    const mapped = {
      provider: 'mapped', id: 'mapped-reasoner', name: 'Mapped Reasoner', reasoning: true,
      thinkingConfigurable: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
    } as Model
    const compatible = {
      provider: 'mapped', id: 'compatible-reasoner', name: 'Compatible Reasoner', reasoning: true,
      thinkingConfigurable: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
    } as Model
    const lowOnly = {
      provider: 'mapped', id: 'low-only-reasoner', name: 'Low Only Reasoner', reasoning: true,
      thinkingConfigurable: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: null }
    } as Model
    const fixed = {
      provider: 'fixed', id: 'fixed-reasoner', name: 'Fixed Reasoner', reasoning: true,
      thinkingConfigurable: false
    } as Model
    const host = createMockHost()
    await host.setSubagentModel?.('explore', [{ model: 'mapped/mapped-reasoner', thinking: 'high' }])
    render(<SubagentModelModal host={host} current={mapped} visibility={visibility({
      models: [mapped, compatible, lowOnly, fixed], visibleModels: [mapped, compatible, lowOnly, fixed], quickModels: [mapped, compatible, lowOnly, fixed],
      quickProviders: ['mapped', 'fixed'], hiddenIds: new Set(),
    })} onClose={() => undefined} />)

    const select = await screen.findByLabelText('explore 0 思考强度') as HTMLSelectElement
    expect([...select.options].map(option => option.value)).toEqual(['', 'low', 'medium', 'high'])
    expect(select.options[0].textContent).toContain('模型默认')

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-mapped-compatible-reasoner'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'mapped/compatible-reasoner', thinking: 'high' }]
    }))

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-mapped-low-only-reasoner'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'mapped/low-only-reasoner' }]
    }))
    fireEvent.change(screen.getByLabelText('explore 0 思考强度'), { target: { value: 'low' } })
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'mapped/low-only-reasoner', thinking: 'low' }]
    }))
    fireEvent.change(screen.getByLabelText('explore 0 思考强度'), { target: { value: '' } })
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'mapped/low-only-reasoner' }]
    }))

    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-fixed-fixed-reasoner'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'fixed/fixed-reasoner' }]
    }))
    expect(screen.queryByLabelText('explore 0 思考强度')).toBeNull()
    expect(within(screen.getByTestId('subagent-agent-explore')).getByText('思考强度由模型决定')).toBeTruthy()
  })
})

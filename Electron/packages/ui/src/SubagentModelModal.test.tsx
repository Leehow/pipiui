// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition, Model, PipiHostAPI, SubagentModelSetting } from '@pipi/host-api'
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
    catalogEpoch: 0,
    removedProviders: [],
    restoreProvider: async () => undefined,
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

  it('persists a dedicated Luna Supervisor override and clears it without thinking or fallback controls', async () => {
    const luna: Model = { provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', reasoning: true }
    const host = createMockHost()
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility({
      models: [luna, hidden], visibleModels: [luna, hidden], quickModels: [luna, hidden],
      quickProviders: ['openai-codex', 'deepseek'], hiddenIds: new Set(['deepseek/deepseek-v3']),
    })} onClose={() => undefined} />)

    const row = await screen.findByTestId('supervisor-model-row')
    expect(within(row).getByText('Supervisor 管理 Agent')).toBeTruthy()
    expect(within(row).getByText(/general-purpose.*当前主 Agent.*下一个 Supervisor epoch/)).toBeTruthy()
    expect(within(row).queryByText(/思考强度/)).toBeNull()
    expect(within(row).queryByText(/添加备用模型/)).toBeNull()
    const picker = within(row).getByRole('button', { name: 'supervisor 0 模型' })
    expect(picker.textContent).toContain('使用 general-purpose / 主 Agent 回退')

    fireEvent.click(picker)
    expect(screen.queryByTestId('subagent-model-option-supervisor-0-deepseek-deepseek-v3')).toBeNull()
    fireEvent.click(screen.getByTestId('subagent-model-option-supervisor-0-openai-codex-gpt-5.6-luna'))
    await waitFor(() => expect(picker.textContent).toContain('openai-codex/gpt-5.6-luna'))
    expect(save).toHaveBeenLastCalledWith('supervisor', [{ model: 'openai-codex/gpt-5.6-luna' }])
    expect(await host.getSubagentModels?.()).toMatchObject({
      supervisor: [{ model: 'openai-codex/gpt-5.6-luna' }],
    })

    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('option', { name: /使用 general-purpose \/ 主 Agent 回退/ }))
    await waitFor(() => expect(picker.textContent).toContain('使用 general-purpose / 主 Agent 回退'))
    expect(save).toHaveBeenLastCalledWith('supervisor', [])
    const clearedOverrides = await host.getSubagentModels?.()
    expect(clearedOverrides).toBeDefined()
    expect(clearedOverrides?.supervisor).toBeUndefined()
  })

  it('keeps existing subagent settings available when an older host lacks Hermes review methods', async () => {
    const host = createMockHost()
    host.getMemoryReviewModel = undefined
    host.setMemoryReviewModel = undefined
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    expect(await screen.findByTestId('subagent-agent-explore')).toBeTruthy()
    expect(screen.queryByTestId('memory-review-model-row')).toBeNull()
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

  it('leaves loading, filters to model-management enabled models, and persists independent role chains', async () => {
    const host = createMockHost()
    render(<SubagentModelModal host={host} current={null} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-explore')
    expect(screen.queryByText('正在加载 Subagent 模型设置…')).toBeNull()
	expect(screen.getAllByTestId(/^subagent-agent-/)).toHaveLength(4)
	const generalHeading = screen.getByRole('heading', { name: '通用 Subagents' })
	expect(screen.getByText('PipiUI 内置与用户安装')).toBeTruthy()
	expect(screen.queryByTestId('project-subagent-group')).toBeNull()
	expect(generalHeading.closest('section')?.querySelector('[data-testid="subagent-agent-explore"]')).toBeTruthy()
	expect(screen.queryByTestId('computer-use-model-hierarchy')).toBeNull()

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

function catalogHost(agents: AgentDefinition[], settings: Record<string, SubagentModelSetting[]> = {}) {
  const host = createMockHost()
  const stored: Record<string, SubagentModelSetting[]> = Object.fromEntries(
    Object.entries(settings).map(([name, chain]) => [name, chain.map((entry: SubagentModelSetting) => ({ ...entry }))]),
  )
  host.listAgentDefinitions = vi.fn(async (_projectId?: string) => agents.map(agent => ({ ...agent })))
  host.getSubagentModels = vi.fn(async () => Object.fromEntries(Object.entries(stored).map(([name, chain]) => [name, chain.map((entry: SubagentModelSetting) => ({ ...entry }))])))
  host.setSubagentModel = vi.fn(async (agentName, chain) => {
    if (chain.length) stored[agentName] = chain.map((entry: SubagentModelSetting) => ({ ...entry }))
    else delete stored[agentName]
    return Object.fromEntries(Object.entries(stored).map(([name, saved]) => [name, saved.map((entry: SubagentModelSetting) => ({ ...entry }))]))
  })
  return host
}

describe('SubagentModelModal dynamic catalog', () => {
  it('renders ordinary catalog cards without a computer-use hierarchy and folds project-specific agents', async () => {
    const host = catalogHost([
      { name: 'explore', description: 'Research', origin: 'bundled', source: 'bundled' },
      { name: 'research-helper', description: 'Extra ordinary catalog role', origin: 'bundled', source: 'bundled' },
      {
        name: 'ext-researcher',
        description: 'Extension researcher',
        extensionId: 'ext-research',
        origin: 'project',
        source: 'project',
        available: true,
        availability: 'available',
        permissionSummary: 'mode:read-only, filesystem:read-only',
      },
      { name: 'steward-init', description: 'COC 模组建卡最小包 L0 解析管家', origin: 'project', source: 'project' },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} projectId="proj-1" />)
    await screen.findByTestId('subagent-agent-explore')
    expect(host.listAgentDefinitions).toHaveBeenCalledWith('proj-1')
    expect(screen.queryByTestId('computer-use-model-hierarchy')).toBeNull()
    expect(screen.queryByTestId('subagent-agent-computer-use')).toBeNull()
    expect(screen.getByTestId('subagent-agent-research-helper')).toBeTruthy()
    expect(screen.queryByTestId('subagent-agent-operator')).toBeNull()
    expect(within(screen.getByTestId('subagent-agent-research-helper')).queryByText(/需要查看截图/)).toBeNull()

    const projectGroup = screen.getByTestId('project-subagent-group')
    const toggle = screen.getByTestId('project-subagent-toggle')
    expect(within(projectGroup).getByRole('heading', { name: '项目专用 Subagents' })).toBeTruthy()
    expect(toggle.textContent).toContain('2 个')
    expect(toggle.textContent).toContain('当前项目自带，不是 PipiUI 内置')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('subagent-agent-ext-researcher')).toBeNull()
    expect(screen.queryByTestId('subagent-agent-steward-init')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('subagent-source-ext-researcher').textContent).toContain('扩展 ext-research')
    expect(screen.getByTestId('subagent-permissions-ext-researcher').textContent).toContain('filesystem:read-only')
    expect(screen.getByTestId('subagent-agent-steward-init')).toBeTruthy()
    expect(screen.queryByTestId('subagent-source-steward-init')).toBeNull()
  })

  it('falls back to name/description rows when the host omits catalog metadata', async () => {
    const host = catalogHost([
      { name: 'explore', description: 'Research' },
      { name: 'research-helper', description: 'Extra ordinary catalog role' },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-explore')
    expect(screen.getByTestId('subagent-agent-research-helper')).toBeTruthy()
    expect(screen.queryByTestId('subagent-agent-computer-use')).toBeNull()
    expect(screen.queryByTestId('computer-use-model-hierarchy')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Computer Use Agent' })).toBeNull()
    expect(screen.queryByTestId('subagent-source-explore')).toBeNull()
    expect(within(screen.getByTestId('subagent-agent-research-helper')).queryByText(/需要查看截图/)).toBeNull()
  })

  it('shows requested custom addTools as pending verification, not as applied', async () => {
    const host = catalogHost([
      {
        name: 'explore',
        description: 'Research',
        origin: 'bundled',
        patches: [{
          extensionId: 'ext-ghost',
          origin: 'project',
          operations: ['addTools'],
          addTools: ['ghost_tool'],
          status: 'requested',
        }],
        diagnostics: [{
          severity: 'error',
          code: 'contribution-add-tool-unregistered',
          message: 'Tool `ghost_tool` has no extension owner in Pi\'s effective registry.',
          extensionId: 'ext-ghost',
        }],
      },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-patches-explore')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('请求添加工具 ghost_tool（待运行验证）')
    expect(screen.getByTestId('subagent-patches-explore').textContent).not.toMatch(/(?<!请求)添加工具 ghost_tool/)
    expect(screen.getByTestId('subagent-diagnostics-explore').textContent).toContain('contribution-add-tool-unregistered')
  })

  it('shows accepted patch provenance and rejected operations as diagnostics', async () => {
    const host = catalogHost([
      {
        name: 'explore',
        description: 'Research',
        origin: 'bundled',
        patches: [{
          extensionId: 'ext-research',
          origin: 'project',
          operations: ['appendPrompt', 'addTools'],
          addTools: ['code_search'],
        }],
        diagnostics: [{
          severity: 'error',
          code: 'contribution-reserved-tool',
          message: 'Extension `ext-research` cannot add host-issued or reserved tool `computer` to `explore`.',
          extensionId: 'ext-research',
        }],
        catalogDiagnostics: [{
          severity: 'error',
          code: 'contribution-replace-forbidden',
          message: 'Extension `ext-research` cannot replacePrompt on canonical privileged bundled role `secretary`.',
          extensionId: 'ext-research',
          agentName: 'secretary',
        }],
      },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-patches-explore')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('追加 Prompt')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('code_search')
    expect(screen.getByTestId('subagent-patches-explore').textContent).not.toContain('替换 Prompt')
    expect(screen.getByTestId('subagent-patches-explore').textContent).not.toContain('computer')
    expect(screen.getByTestId('subagent-diagnostics-explore').textContent).toContain('contribution-reserved-tool')
    expect(screen.getByTestId('subagent-catalog-diagnostics').textContent).toContain('contribution-replace-forbidden')
    expect(screen.queryByText(/SECRET_PROMPT|\/tmp\/|systemPrompt/)).toBeNull()
  })

  it('shows patch provenance on catalog rows and hides it for legacy name/description hosts', async () => {
    const host = catalogHost([
      {
        name: 'explore',
        description: 'Research',
        origin: 'bundled',
        patches: [{
          extensionId: 'ext-research',
          origin: 'project',
          operations: ['appendPrompt', 'addTools'],
          addTools: ['code_search'],
        }],
      },
      { name: 'reviewer', description: 'Review' },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-patches-explore')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('ext-research')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('追加 Prompt')
    expect(screen.getByTestId('subagent-patches-explore').textContent).toContain('code_search')
    expect(screen.queryByTestId('subagent-patches-reviewer')).toBeNull()
    expect(screen.queryByText(/SECRET_PROMPT|systemPrompt/i)).toBeNull()
  })

  it('shows dismissable diagnostics for unavailable agents without blocking other roles', async () => {
    const host = catalogHost([
      { name: 'explore', description: 'Research' },
      {
        name: 'broken-ext',
        description: 'Broken contribution',
        extensionId: 'ext-broken',
        available: false,
        availability: 'unavailable',
        diagnostics: [{ severity: 'error', code: 'contribution-path-escape', message: 'prompt file escaped the extension root' }],
        catalogDiagnostics: [{ severity: 'error', code: 'catalog-discovery-failed', message: 'overlay scan failed' }],
      },
    ])
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-broken-ext')
    expect(screen.getByTestId('subagent-status-broken-ext').textContent).toContain('不可用')
    expect(screen.getByTestId('subagent-catalog-diagnostics').textContent).toContain('catalog-discovery-failed')
    expect(screen.getByTestId('subagent-diagnostics-broken-ext').textContent).toContain('contribution-path-escape')
    fireEvent.click(within(screen.getByTestId('subagent-diagnostics-broken-ext')).getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByTestId('subagent-diagnostics-broken-ext')).toBeNull()
    fireEvent.click(within(screen.getByTestId('subagent-catalog-diagnostics')).getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByTestId('subagent-catalog-diagnostics')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'explore 0 模型' }))
    fireEvent.click(screen.getByTestId('subagent-model-option-explore-0-openai-gpt-5'))
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'openai/gpt-5' }],
    }))
  })

  it('hides stale model settings for missing catalog agents without deleting them', async () => {
    const host = catalogHost(
      [{ name: 'explore', description: 'Research' }],
      {
        explore: [{ model: 'openai/gpt-5' }],
        'gone-ext-agent': [{ model: 'xai/grok-4.5' }],
      },
    )
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={visibility()} onClose={() => undefined} />)
    await screen.findByTestId('subagent-agent-explore')
    expect(screen.queryByTestId('subagent-agent-gone-ext-agent')).toBeNull()
    expect(await host.getSubagentModels?.()).toMatchObject({
      explore: [{ model: 'openai/gpt-5' }],
      'gone-ext-agent': [{ model: 'xai/grok-4.5' }],
    })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('SubagentModelModal model chain reorder', () => {
  const grok: Model = { provider: 'xai', id: 'grok-4.5', name: 'Grok 4.5', reasoning: true }
  const initialChain: SubagentModelSetting[] = [
    { model: 'openai/gpt-5', thinking: 'high' },
    { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
    { model: 'xai/grok-4.5' },
  ]
  const reorderVisibility = () => visibility({
    models: [gpt, claude, grok], visibleModels: [gpt, claude, grok], quickModels: [gpt, claude, grok],
    quickProviders: ['openai', 'anthropic', 'xai'], hiddenIds: new Set(),
  })

  it('reorders a whole {model, thinking} entry via the drag handle, saves the exact new order, and recomputes primary/fallback labels', async () => {
    const host = catalogHost([{ name: 'reviewer', description: 'Review' }], { reviewer: initialChain })
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={reorderVisibility()} onClose={() => undefined} />)
    const reviewer = await screen.findByTestId('subagent-agent-reviewer')
    expect(within(reviewer).getByText('主选')).toBeTruthy()
    expect(within(reviewer).getByText('备用 1')).toBeTruthy()
    expect(within(reviewer).getByText('备用 2')).toBeTruthy()
    expect(within(reviewer).getByTestId('subagent-drag-reviewer-0')).toBeTruthy()
    expect((within(reviewer).getByLabelText('reviewer 0 思考强度') as HTMLSelectElement).value).toBe('high')

    // Drag the primary row onto the last row: only the handle starts the drag,
    // the row itself is only a drop target.
    fireEvent.dragStart(within(reviewer).getByTestId('subagent-drag-reviewer-0'))
    expect(within(reviewer).getByTestId('subagent-chain-reviewer-0').className).toContain('dragging')
    fireEvent.dragOver(within(reviewer).getByTestId('subagent-chain-reviewer-2'))
    expect(within(reviewer).getByTestId('subagent-chain-reviewer-2').className).toContain('drag-over')
    fireEvent.drop(within(reviewer).getByTestId('subagent-chain-reviewer-2'))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith('reviewer', [
      { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
      { model: 'xai/grok-4.5' },
      { model: 'openai/gpt-5', thinking: 'high' },
    ])

    // Labels follow the new array order, and each thinking stays bound to its model.
    await waitFor(() => expect(within(reviewer).getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('claude-sonnet-4'))
    expect(within(reviewer).getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('anthropic/claude-sonnet-4')
    expect(within(reviewer).getByRole('button', { name: 'reviewer 1 模型' }).textContent).toContain('xai/grok-4.5')
    expect(within(reviewer).getByRole('button', { name: 'reviewer 2 模型' }).textContent).toContain('openai/gpt-5')
    expect(within(reviewer).getByText('主选')).toBeTruthy()
    expect(within(reviewer).getByText('备用 1')).toBeTruthy()
    expect(within(reviewer).getByText('备用 2')).toBeTruthy()
    expect((within(reviewer).getByLabelText('reviewer 0 思考强度') as HTMLSelectElement).value).toBe('medium')
    expect((within(reviewer).getByLabelText('reviewer 2 思考强度') as HTMLSelectElement).value).toBe('high')
    expect(within(reviewer).queryByTestId('subagent-chain-reviewer-0')?.className).not.toContain('dragging')
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({
      reviewer: [
        { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
        { model: 'xai/grok-4.5' },
        { model: 'openai/gpt-5', thinking: 'high' },
      ],
    }))
  })

  it('moves entries with up/down buttons, recomputes labels, and disables boundary moves', async () => {
    const host = catalogHost([{ name: 'reviewer', description: 'Review' }], { reviewer: initialChain })
    const save = vi.spyOn(host, 'setSubagentModel')
    render(<SubagentModelModal host={host} current={gpt} visibility={reorderVisibility()} onClose={() => undefined} />)
    const reviewer = await screen.findByTestId('subagent-agent-reviewer')

    // Boundary items: primary cannot move up, last fallback cannot move down.
    expect(within(reviewer).getByRole('button', { name: '上移 reviewer 主选' }).hasAttribute('disabled')).toBe(true)
    expect(within(reviewer).getByRole('button', { name: '下移 reviewer 备用 2' }).hasAttribute('disabled')).toBe(true)
    expect(within(reviewer).getByRole('button', { name: '上移 reviewer 备用 1' }).hasAttribute('disabled')).toBe(false)
    expect(within(reviewer).getByRole('button', { name: '下移 reviewer 主选' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(within(reviewer).getByRole('button', { name: '下移 reviewer 主选' }))
    expect(save).toHaveBeenLastCalledWith('reviewer', [
      { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
      { model: 'openai/gpt-5', thinking: 'high' },
      { model: 'xai/grok-4.5' },
    ])
    await waitFor(() => expect(within(reviewer).getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('claude-sonnet-4'))
    expect(within(reviewer).getByRole('button', { name: 'reviewer 1 模型' }).textContent).toContain('openai/gpt-5')
    expect(within(reviewer).getByText('主选')).toBeTruthy()
    expect((within(reviewer).getByLabelText('reviewer 1 思考强度') as HTMLSelectElement).value).toBe('high')

    // Moving the new 备用 1 back up restores the saved order exactly.
    fireEvent.click(within(reviewer).getByRole('button', { name: '上移 reviewer 备用 1' }))
    expect(save).toHaveBeenLastCalledWith('reviewer', initialChain)
    await waitFor(async () => expect(await host.getSubagentModels?.()).toMatchObject({ reviewer: initialChain }))
  })

  it('blocks reordering while a save is in flight and ignores drag events until it resolves', async () => {
    // Own storage mock (not a passthrough spy): the gated promise must only
    // apply the chain when the test releases it.
    let stored: Record<string, SubagentModelSetting[]> = { reviewer: initialChain.map(entry => ({ ...entry })) }
    let release!: () => void
    const host = createMockHost()
    host.listAgentDefinitions = vi.fn(async () => [{ name: 'reviewer', description: 'Review' }])
    host.getSubagentModels = vi.fn(async () => JSON.parse(JSON.stringify(stored)) as Record<string, SubagentModelSetting[]>)
    const save = vi.fn((agentName: string, chain: SubagentModelSetting[]) =>
      new Promise<Record<string, SubagentModelSetting[]>>(resolve => {
        release = () => {
          if (chain.length) stored = { ...stored, [agentName]: chain.map(entry => ({ ...entry })) }
          else {
            const { [agentName]: _drop, ...rest } = stored
            stored = rest
          }
          resolve(JSON.parse(JSON.stringify(stored)) as Record<string, SubagentModelSetting[]>)
        }
      }))
    host.setSubagentModel = save
    render(<SubagentModelModal host={host} current={gpt} visibility={reorderVisibility()} onClose={() => undefined} />)
    const reviewer = await screen.findByTestId('subagent-agent-reviewer')

    fireEvent.click(within(reviewer).getByRole('button', { name: '下移 reviewer 主选' }))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]).toEqual(['reviewer', [
      { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
      { model: 'openai/gpt-5', thinking: 'high' },
      { model: 'xai/grok-4.5' },
    ]])
    expect(within(reviewer).getByRole('button', { name: '下移 reviewer 主选' }).hasAttribute('disabled')).toBe(true)
    expect(within(reviewer).getByRole('button', { name: '上移 reviewer 备用 1' }).hasAttribute('disabled')).toBe(true)
    expect(within(reviewer).getByRole('button', { name: '上移 reviewer 主选' }).hasAttribute('disabled')).toBe(true)
    expect(within(reviewer).getByTestId('subagent-drag-reviewer-0').getAttribute('draggable')).toBe('false')
    fireEvent.dragStart(within(reviewer).getByTestId('subagent-drag-reviewer-0'))
    fireEvent.dragOver(within(reviewer).getByTestId('subagent-chain-reviewer-2'))
    expect(within(reviewer).getByTestId('subagent-chain-reviewer-2').className).not.toContain('drag-over')
    fireEvent.drop(within(reviewer).getByTestId('subagent-chain-reviewer-2'))
    expect(save).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect(within(reviewer).getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('claude-sonnet-4'))
    expect(within(reviewer).getByRole('button', { name: '下移 reviewer 主选' }).hasAttribute('disabled')).toBe(false)
    expect(within(reviewer).getByTestId('subagent-drag-reviewer-0').getAttribute('draggable')).toBe('true')
    expect(JSON.parse(JSON.stringify(stored))).toMatchObject({
      reviewer: [
        { model: 'anthropic/claude-sonnet-4', thinking: 'medium' },
        { model: 'openai/gpt-5', thinking: 'high' },
        { model: 'xai/grok-4.5' },
      ],
    })
  })

  it('offers no drag handle or move buttons for single-entry and follow chains', async () => {
    const host = catalogHost(
      [{ name: 'reviewer', description: 'Review' }],
      { reviewer: [{ model: 'openai/gpt-5', thinking: 'high' }] },
    )
    render(<SubagentModelModal host={host} current={gpt} visibility={reorderVisibility()} onClose={() => undefined} />)
    const reviewer = await screen.findByTestId('subagent-agent-reviewer')
    expect(within(reviewer).queryByTestId('subagent-drag-reviewer-0')).toBeNull()
    expect(within(reviewer).queryByRole('button', { name: '上移 reviewer 主选' })).toBeNull()
    expect(within(reviewer).queryByRole('button', { name: '下移 reviewer 主选' })).toBeNull()
    expect(within(reviewer).getByRole('button', { name: 'reviewer 0 模型' }).textContent).toContain('openai/gpt-5')
  })

  it('pins the thinking control to the content column in narrow reorderable chain rows', () => {
    const css = readFileSync(join(import.meta.dirname, 'subagent-models.css'), 'utf8')
    expect(css).toContain('.subagent-chain-row.reorderable{grid-template-columns:14px 1fr}')
    // Without this pin, grid auto-placement drops the select/note into the 14px handle column.
    expect(css).toContain('.subagent-chain-row.reorderable .subagent-thinking-select,.subagent-chain-row.reorderable .subagent-thinking-note{grid-column:2}')
  })
})

import { useEffect, useState } from 'react'
import { thinkingLevelsForModel } from '@pipi/host-api'
import type { AgentDefinition, Model, PipiHostAPI, SubagentModelSetting, ThinkingLevel } from '@pipi/host-api'
import { modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import type { ModelVisibilityController } from './useModelVisibility'
import './subagent-models.css'

const COMPUTER_USE_AGENT_NAMES = new Set(['computer-use-leader', 'operator', 'computer-verifier', 'computer-terminal'])
const VISUAL_COMPUTER_USE_AGENT_NAMES = new Set(['operator', 'computer-verifier'])
const COMPUTER_USE_WORKER_ORDER = ['operator', 'computer-verifier', 'computer-terminal']

/** Per-role ordered model fallback editor, mirroring Swift Settings > Subagent. */
export function SubagentModelModal({ host, current, visibility, onClose }: { host: PipiHostAPI; current: Model | null; visibility: ModelVisibilityController; onClose: () => void }) {
  const hostMethodsPresent = typeof host.getSubagentModels === 'function' && typeof host.setSubagentModel === 'function' && typeof host.listAgentDefinitions === 'function'
  const memoryMethodsPresent = typeof host.getMemoryReviewModel === 'function' && typeof host.setMemoryReviewModel === 'function'
  const [available, setAvailable] = useState(hostMethodsPresent)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [settings, setSettings] = useState<Record<string, SubagentModelSetting[]>>({})
  const [memoryReviewModel, setMemoryReviewModel] = useState<string | null>(null)
  const [memoryAvailable, setMemoryAvailable] = useState(memoryMethodsPresent)
  const [loading, setLoading] = useState(hostMethodsPresent)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Use the same candidate stream as the composer quick picker, then remove
  // its one intentional exception: a currently selected but unchecked model.
  // Subagent primary and fallback rows must only offer checked models.
  const candidateModels = visibility.quickModels.filter(model => !visibility.hiddenIds.has(modelRef(model)))
  const computerUseLeader = agents.find(agent => agent.name === 'computer-use-leader')
  const computerUseWorkers = COMPUTER_USE_WORKER_ORDER
    .map(name => agents.find(agent => agent.name === name))
    .filter((agent): agent is AgentDefinition => Boolean(agent))
  const generalAgents = agents.filter(agent => !COMPUTER_USE_AGENT_NAMES.has(agent.name))

  useEffect(() => {
    if (!host.getSubagentModels || !host.listAgentDefinitions) return
    let active = true
    void Promise.all([host.getSubagentModels(), host.listAgentDefinitions()]).then(([nextSettings, nextAgents]) => {
      if (!active) return
      setSettings(nextSettings)
      setAgents(nextAgents)
    }).catch((err) => {
      // `apiFrom` cannot know whether an older IPC backend implements these
      // optional methods until it receives its unknown-method response.
      if (!active) return
      setAvailable(false)
      setError(`无法加载 Subagent 模型设置：${err instanceof Error ? err.message : String(err)}`)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [host])

  useEffect(() => {
    if (!host.getMemoryReviewModel || !host.setMemoryReviewModel) return
    let active = true
    void host.getMemoryReviewModel().then(value => {
      if (active) setMemoryReviewModel(value)
    }).catch(() => {
      if (active) setMemoryAvailable(false)
    })
    return () => { active = false }
  }, [host])

  const save = async (agentName: string, chain: SubagentModelSetting[]) => {
    if (!host.setSubagentModel) return
    setSaving(agentName)
    setError(null)
    try {
      const next = await host.setSubagentModel(agentName, chain)
      setSettings(next)
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(null)
    }
  }

  const saveMemoryReview = async (model: string) => {
    if (!host.setMemoryReviewModel) return
    setSaving('memory-review')
    setError(null)
    try {
      setMemoryReviewModel(await host.setMemoryReviewModel(model || null))
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="subagent-modal-backdrop" data-testid="subagent-models-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="subagent-modal" role="dialog" aria-modal="true" aria-label="Subagent 模型" data-testid="subagent-model-modal">
        <header className="subagent-modal-header">
          <div>
            <h2>Subagent 模型</h2>
            <p>默认「跟随主 Agent」= 底栏当前模型；可为每类 subagent 指定模型、思考强度与有序 fallback 链。</p>
          </div>
          <button className="subagent-modal-close" aria-label="关闭 Subagent 模型" onClick={onClose}>×</button>
        </header>
        {!available ? (
          <div className="subagent-modal-state" role="alert">{error ?? '当前连接不支持 Subagent 模型设置。'}</div>
        ) : loading || visibility.loading ? (
          <div className="subagent-modal-state">正在加载 Subagent 模型设置…</div>
        ) : visibility.error ? (
          <div className="subagent-modal-state" role="alert">无法读取模型管理中的已启用模型：{visibility.error}</div>
        ) : (
          <div className="subagent-modal-body">
            <div className="subagent-main-model">
              {current ? <><ProviderLogo provider={current.provider} modelId={current.id} size={14} /> 当前主 Agent（底栏）：{current.name}（{current.provider}/{current.id}）</> : '当前无打开会话；「跟随」将在派出时使用当时底栏选中的模型。'}
            </div>
            {memoryAvailable && <section className="subagent-agent-group" aria-labelledby="system-memory-models-heading">
              <div className="subagent-agent-group-heading"><h3 id="system-memory-models-heading">系统 / 记忆</h3><span>独立后台角色，不参与 Subagent fallback</span></div>
              <article className="subagent-agent-row" data-testid="memory-review-model-row">
                <div className="subagent-agent-heading"><strong>Hermes 记忆复核</strong></div>
                <p>整理会话记忆时使用。默认在复核发生时跟随当时的主 Agent；显式选择只覆盖复核模型。</p>
                <ModelPicker models={candidateModels} selected={candidateModels.find(model => modelRef(model) === memoryReviewModel)} configuredRef={memoryReviewModel ?? ''} follow={!memoryReviewModel} allowFollow disabled={saving === 'memory-review'} onSelect={saveMemoryReview} agentName="memory-review" index={0} />
                {memoryReviewModel && !candidateModels.some(model => modelRef(model) === memoryReviewModel) && <div className="subagent-model-warning" role="alert">历史设置「{memoryReviewModel}」当前不可见，请重新选择已启用的 provider/model。</div>}
              </article>
            </section>}
            <section className="subagent-agent-group" aria-labelledby="general-subagent-models-heading">
              <div className="subagent-agent-group-heading"><h3 id="general-subagent-models-heading">通用 Subagents</h3></div>
              {generalAgents.map(agent => <AgentRow key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={candidateModels} saving={saving === agent.name} onSave={save} />)}
            </section>
            {(computerUseLeader || computerUseWorkers.length > 0) && <section className="subagent-agent-group subagent-computer-use-group" aria-labelledby="computer-use-models-heading" data-testid="computer-use-model-hierarchy">
              <div className="subagent-agent-group-heading"><h3 id="computer-use-models-heading">Computer Use Agents</h3><span>Leader 主管下属专用执行与验证 Agent</span></div>
              <div className="subagent-computer-use-tree">
                {computerUseLeader && <AgentRow hierarchy="leader" agent={computerUseLeader} chain={settings[computerUseLeader.name] ?? []} models={candidateModels} saving={saving === computerUseLeader.name} onSave={save} />}
                {computerUseWorkers.length > 0 && <div className="subagent-computer-use-children" role="group" aria-label="Computer Use Leader 的子 Agent">
                  <div className="subagent-computer-use-branch-label"><span aria-hidden="true">↳</span> Leader 调度</div>
                  {computerUseWorkers.map(agent => <AgentRow hierarchy="worker" key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={candidateModels} saving={saving === agent.name} onSave={save} />)}
                </div>}
              </div>
            </section>}
            {error && <div className="subagent-modal-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭 Subagent 模型错误" onClick={() => setError(null)}>×</button></div>}
          </div>
        )}
      </section>
    </div>
  )
}

function AgentRow({ agent, chain, models, saving, onSave, hierarchy }: {
  agent: AgentDefinition
  chain: SubagentModelSetting[]
  models: Model[]
  saving: boolean
  onSave: (agentName: string, chain: SubagentModelSetting[]) => Promise<void>
  hierarchy?: 'leader' | 'worker'
}) {
  // Persisted selections are provider-qualified. A historical bare id must not
  // masquerade as the first matching provider in the current catalog.
  const findModel = (ref: string) => models.find(candidate => modelRef(candidate) === ref)
  const rows = chain.length ? chain : [{ model: '', thinking: undefined }]
  const changeModel = (index: number, selectedRef: string) => {
    if (index === 0 && selectedRef === '') {
      void onSave(agent.name, [])
      return
    }
    const next = chain.length ? [...chain] : [{ model: '', thinking: undefined }]
    const previousThinking = next[index]?.thinking
    const selected = findModel(selectedRef)
    const allowed = selected ? thinkingLevelsForModel(selected) : []
    next[index] = {
      model: selectedRef,
      ...(previousThinking && allowed.includes(previousThinking as ThinkingLevel)
        ? { thinking: previousThinking }
        : {}),
    }
    void onSave(agent.name, next)
  }
  const changeThinking = (index: number, thinking: string) => {
    const next = [...chain]
    if (!next[index]) return
    const { thinking: _previous, ...entry } = next[index]
    next[index] = thinking ? { ...entry, thinking } : entry
    void onSave(agent.name, next)
  }
  const addFallback = () => {
    const first = models[0]
    if (!first) return
    const firstRef = modelRef(first)
    const primary = chain.length ? chain : [{ model: firstRef }]
    void onSave(agent.name, [...primary, { model: firstRef }])
  }
  const remove = (index: number) => void onSave(agent.name, chain.filter((_, itemIndex) => itemIndex !== index))

  return (
    <article className={`subagent-agent-row${hierarchy ? ` subagent-agent-${hierarchy}` : ''}`} data-testid={`subagent-agent-${agent.name}`}>
      <div className="subagent-agent-heading"><strong>{agent.name}</strong>{hierarchy && <span className="subagent-agent-hierarchy-badge">{hierarchy === 'leader' ? '主管' : '子 Agent'}</span>}{chain.length > 1 && <span>fallback ×{chain.length}</span>}</div>
      <p>{agent.description}</p>
      {VISUAL_COMPUTER_USE_AGENT_NAMES.has(agent.name) && <p className="subagent-visual-model-hint">需要查看截图，建议选择支持图像输入的模型（如 Grok）。这只是建议，不会自动选择或覆盖你的设置。</p>}
      {rows.map((entry, index) => {
        const selected = findModel(entry.model)
        const thinkingLevels = selected ? thinkingLevelsForModel(selected) : []
        const selectedThinking = thinkingLevels.includes(entry.thinking as ThinkingLevel) ? entry.thinking : ''
        return (
          <div className="subagent-chain-row" key={`${index}:${entry.model}`} data-testid={`subagent-chain-${agent.name}-${index}`}>
            {(index > 0 || chain.length > 1) && <div className="subagent-chain-label"><span>{index === 0 ? '主选' : `备用 ${index}`}</span>{chain.length > 1 && <button type="button" aria-label={`移除 ${agent.name} 备用模型 ${index}`} disabled={saving} onClick={() => remove(index)}>删除</button>}</div>}
            <ModelPicker models={models} selected={selected} configuredRef={entry.model} follow={index === 0 && !entry.model} allowFollow={index === 0} disabled={saving} onSelect={modelId => changeModel(index, modelId)} agentName={agent.name} index={index} />
            {entry.model && !selected && <div className="subagent-model-warning" role="alert">历史设置「{entry.model}」无法在当前模型中确认，请重新选择完整 provider/model。</div>}
            {selected && thinkingLevels.length === 0 ? <div className="subagent-thinking-note">{selected.reasoning === false || selected.thinkingConfigurable === false ? '思考强度由模型决定' : '模型未报告可配置思考强度'}</div> : selected ? (
              <label className="subagent-thinking-select">思考强度
                <select aria-label={`${agent.name} ${index} 思考强度`} value={selectedThinking} disabled={saving || !entry.model} onChange={event => changeThinking(index, event.target.value)}>
                  <option value="">模型默认（不覆盖）</option>
                  {thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        )
      })}
      <button type="button" className="subagent-add-fallback" disabled={saving || !models.length} onClick={addFallback}>＋ 添加备用模型</button>
    </article>
  )
}

function ModelPicker({ models, selected, configuredRef, follow, allowFollow, disabled, onSelect, agentName, index }: {
  models: Model[]
  selected?: Model
  configuredRef: string
  follow: boolean
  allowFollow: boolean
  disabled: boolean
  onSelect: (modelId: string) => void
  agentName: string
  index: number
}) {
  const [open, setOpen] = useState(false)
  const pick = (modelId: string) => { setOpen(false); onSelect(modelId) }
  const label = follow ? '跟随主 Agent' : selected ? `${selected.name}（${selected.provider}/${selected.id}）` : configuredRef ? `需重新选择 provider（${configuredRef}）` : '选择模型'
  return (
    <div className="subagent-model-picker">
      <button type="button" className="subagent-model-picker-trigger" aria-label={`${agentName} ${index} 模型`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
        {selected && <ProviderLogo provider={selected.provider} modelId={selected.id} size={14} />}
        <span>{label}</span><b>⌄</b>
      </button>
      {open && <div className="subagent-model-picker-menu" role="listbox" aria-label={`${agentName} 模型候选`}>
        {allowFollow && <button type="button" role="option" aria-selected={follow} className={follow ? 'selected' : ''} onClick={() => pick('')}><span>跟随主 Agent</span>{follow && <b aria-label="已选中">✓</b>}</button>}
        {models.map(model => {
          const ref = modelRef(model)
          const active = selected ? modelRef(selected) === ref && !follow : false
          return <button type="button" role="option" aria-selected={active} className={active ? 'selected' : ''} key={ref} data-testid={`subagent-model-option-${agentName}-${index}-${model.provider}-${model.id}`} onClick={() => pick(ref)}><ProviderLogo provider={model.provider} modelId={model.id} size={14} /><span>{model.name}（{ref}）</span>{active && <b aria-label="已选中">✓</b>}</button>
        })}
      </div>}
    </div>
  )
}

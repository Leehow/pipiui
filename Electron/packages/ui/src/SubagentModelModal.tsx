import { useEffect, useState } from 'react'
import type { AgentDefinition, Model, PipiHostAPI, SubagentModelSetting } from '@pipi/host-api'
import { modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import type { ModelVisibilityController } from './useModelVisibility'
import './subagent-models.css'

const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const
const COMPUTER_USE_AGENT_NAMES = new Set(['computer-use-leader', 'operator', 'computer-verifier', 'computer-terminal'])

/** Per-role ordered model fallback editor, mirroring Swift Settings > Subagent. */
export function SubagentModelModal({ host, current, visibility, onClose }: { host: PipiHostAPI; current: Model | null; visibility: ModelVisibilityController; onClose: () => void }) {
  const hostMethodsPresent = typeof host.getSubagentModels === 'function' && typeof host.setSubagentModel === 'function' && typeof host.listAgentDefinitions === 'function'
  const [available, setAvailable] = useState(hostMethodsPresent)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [settings, setSettings] = useState<Record<string, SubagentModelSetting[]>>({})
  const [loading, setLoading] = useState(hostMethodsPresent)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Use the same candidate stream as the composer quick picker, then remove
  // its one intentional exception: a currently selected but unchecked model.
  // Subagent primary and fallback rows must only offer checked models.
  const candidateModels = visibility.quickModels.filter(model => !visibility.hiddenIds.has(modelRef(model)))
	const computerUseAgents = agents.filter(agent => COMPUTER_USE_AGENT_NAMES.has(agent.name))
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
              {current ? <><ProviderLogo provider={current.provider} modelId={current.id} size={14} /> 当前主 Agent（底栏）：{current.name}（{current.id}）</> : '当前无打开会话；「跟随」将在派出时使用当时底栏选中的模型。'}
            </div>
			{computerUseAgents.length > 0 && <section className="subagent-agent-group" aria-labelledby="computer-use-models-heading">
			  <div className="subagent-agent-group-heading"><h3 id="computer-use-models-heading">Computer Use Agent</h3><span>Leader 与专属执行/验证子 agent 可分别设置</span></div>
			  {computerUseAgents.map(agent => <AgentRow key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={candidateModels} saving={saving === agent.name} onSave={save} />)}
			</section>}
			<section className="subagent-agent-group" aria-labelledby="general-subagent-models-heading">
			  <div className="subagent-agent-group-heading"><h3 id="general-subagent-models-heading">通用 Subagents</h3></div>
			  {generalAgents.map(agent => <AgentRow key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={candidateModels} saving={saving === agent.name} onSave={save} />)}
			</section>
            {error && <div className="subagent-modal-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭 Subagent 模型错误" onClick={() => setError(null)}>×</button></div>}
          </div>
        )}
      </section>
    </div>
  )
}

function AgentRow({ agent, chain, models, saving, onSave }: {
  agent: AgentDefinition
  chain: SubagentModelSetting[]
  models: Model[]
  saving: boolean
  onSave: (agentName: string, chain: SubagentModelSetting[]) => Promise<void>
}) {
  const rows = chain.length ? chain : [{ model: '', thinking: undefined }]
  const changeModel = (index: number, modelId: string) => {
    if (index === 0 && modelId === '') {
      void onSave(agent.name, [])
      return
    }
    const model = models.find(candidate => candidate.id === modelId)
    const next = chain.length ? [...chain] : [{ model: '', thinking: undefined }]
    next[index] = { model: modelId, ...(model?.reasoning ? { thinking: next[index]?.thinking ?? 'off' } : {}) }
    void onSave(agent.name, next)
  }
  const changeThinking = (index: number, thinking: string) => {
    const next = [...chain]
    if (!next[index]) return
    next[index] = { ...next[index], thinking }
    void onSave(agent.name, next)
  }
  const addFallback = () => {
    const first = models[0]
    if (!first) return
    const primary = chain.length ? chain : [{ model: first.id, ...(first.reasoning ? { thinking: 'off' } : {}) }]
    void onSave(agent.name, [...primary, { model: first.id, ...(first.reasoning ? { thinking: 'off' } : {}) }])
  }
  const remove = (index: number) => void onSave(agent.name, chain.filter((_, itemIndex) => itemIndex !== index))

  return (
    <article className="subagent-agent-row" data-testid={`subagent-agent-${agent.name}`}>
      <div className="subagent-agent-heading"><strong>{agent.name}</strong>{chain.length > 1 && <span>fallback ×{chain.length}</span>}</div>
      <p>{agent.description}</p>
      {rows.map((entry, index) => {
        const selected = models.find(model => model.id === entry.model)
        const reasoning = selected?.reasoning
        return (
          <div className="subagent-chain-row" key={`${index}:${entry.model}`} data-testid={`subagent-chain-${agent.name}-${index}`}>
            {(index > 0 || chain.length > 1) && <div className="subagent-chain-label"><span>{index === 0 ? '主选' : `备用 ${index}`}</span>{chain.length > 1 && <button type="button" aria-label={`移除 ${agent.name} 备用模型 ${index}`} disabled={saving} onClick={() => remove(index)}>删除</button>}</div>}
            <ModelPicker models={models} selected={selected} follow={index === 0 && !entry.model} allowFollow={index === 0} disabled={saving} onSelect={modelId => changeModel(index, modelId)} agentName={agent.name} index={index} />
            {reasoning === false ? <div className="subagent-thinking-note">思考强度由模型决定</div> : (
              <label className="subagent-thinking-select">思考强度
                <select aria-label={`${agent.name} ${index} 思考强度`} value={entry.thinking ?? 'off'} disabled={saving || !entry.model} onChange={event => changeThinking(index, event.target.value)}>
                  {THINKING_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
            )}
          </div>
        )
      })}
      <button type="button" className="subagent-add-fallback" disabled={saving || !models.length} onClick={addFallback}>＋ 添加备用模型</button>
    </article>
  )
}

function ModelPicker({ models, selected, follow, allowFollow, disabled, onSelect, agentName, index }: {
  models: Model[]
  selected?: Model
  follow: boolean
  allowFollow: boolean
  disabled: boolean
  onSelect: (modelId: string) => void
  agentName: string
  index: number
}) {
  const [open, setOpen] = useState(false)
  const pick = (modelId: string) => { setOpen(false); onSelect(modelId) }
  const label = follow ? '跟随主 Agent' : selected ? `${selected.name}（${selected.id}）` : '选择模型'
  return (
    <div className="subagent-model-picker">
      <button type="button" className="subagent-model-picker-trigger" aria-label={`${agentName} ${index} 模型`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
        {selected && <ProviderLogo provider={selected.provider} modelId={selected.id} size={14} />}
        <span>{label}</span><b>⌄</b>
      </button>
      {open && <div className="subagent-model-picker-menu" role="listbox" aria-label={`${agentName} 模型候选`}>
        {allowFollow && <button type="button" role="option" aria-selected={follow} className={follow ? 'selected' : ''} onClick={() => pick('')}><span>跟随主 Agent</span>{follow && <b aria-label="已选中">✓</b>}</button>}
        {models.map(model => {
          const active = selected?.id === model.id && !follow
          return <button type="button" role="option" aria-selected={active} className={active ? 'selected' : ''} key={`${model.provider}/${model.id}`} data-testid={`subagent-model-option-${agentName}-${index}-${model.id}`} onClick={() => pick(model.id)}><ProviderLogo provider={model.provider} modelId={model.id} size={14} /><span>{model.name}（{model.id}）</span>{active && <b aria-label="已选中">✓</b>}</button>
        })}
      </div>}
    </div>
  )
}

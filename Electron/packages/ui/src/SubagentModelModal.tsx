import { useEffect, useMemo, useState } from 'react'
import { thinkingLevelsForModel } from '@pipi/host-api'
import type { AgentDefinition, Model, PipiHostAPI, SubagentDebugInfo, SubagentModelSetting, ThinkingLevel } from '@pipi/host-api'
import {
  agentAvailabilityLabel,
  agentSourceLabel,
  collectCatalogDiagnostics,
  diagnosticKey,
  formatDiagnostic,
  formatPatchOperations,
  isAgentUnavailable,
  isBlockingCatalogDiagnostic,
  partitionCatalog,
} from './agent-catalog-ui'
import { DismissibleError } from './DismissibleError'
import { modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import { SubagentDebugView } from './SubagentDebugView'
import type { ModelVisibilityController } from './useModelVisibility'
import './subagent-models.css'

/** Per-role ordered model fallback editor, mirroring Swift Settings > Subagent. */
export function SubagentModelModal({ host, current, visibility, onClose, projectId, sessionId }: {
  host: PipiHostAPI
  current: Model | null
  visibility: ModelVisibilityController
  onClose: () => void
  projectId?: string
  sessionId?: string
}) {
  const hostMethodsPresent = typeof host.getSubagentModels === 'function' && typeof host.setSubagentModel === 'function' && typeof host.listAgentDefinitions === 'function'
  const memoryMethodsPresent = typeof host.getMemoryReviewModel === 'function' && typeof host.setMemoryReviewModel === 'function'
  const debugMethodsPresent = typeof host.getSubagentDebugInfo === 'function'
  const [available, setAvailable] = useState(hostMethodsPresent)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [settings, setSettings] = useState<Record<string, SubagentModelSetting[]>>({})
  const [memoryReviewModel, setMemoryReviewModel] = useState<string | null>(null)
  const [memoryAvailable, setMemoryAvailable] = useState(memoryMethodsPresent)
  const [loading, setLoading] = useState(hostMethodsPresent)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<Set<string>>(() => new Set())
  const [mode, setMode] = useState<'models' | 'debug'>('models')
  const [debugInfo, setDebugInfo] = useState<SubagentDebugInfo | null>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)
  const [debugEpoch, setDebugEpoch] = useState(0)
  // Use the same candidate stream as the composer quick picker, then remove
  // its one intentional exception: a currently selected but unchecked model.
  // Subagent primary and fallback rows must only offer checked models.
  const candidateModels = visibility.quickModels.filter(model => !visibility.hiddenIds.has(modelRef(model)))
  const { general: generalAgents, project: projectAgents } = useMemo(() => partitionCatalog(agents), [agents])
  const catalogDiagnostics = useMemo(() => collectCatalogDiagnostics(agents), [agents])
  const visibleCatalogDiagnostics = catalogDiagnostics.filter(entry => (
    isBlockingCatalogDiagnostic(entry) && !dismissedDiagnostics.has(diagnosticKey(entry))
  ))
  const supervisorModel = settings.supervisor?.[0]?.model ?? ''

  useEffect(() => {
    if (!host.getSubagentModels || !host.listAgentDefinitions) return
    let active = true
    let settled = 0
    let failed = false
    const catalogProjectId = projectId?.trim() || undefined
    const reject = (reason: unknown) => {
      if (!active) return
      failed = true
      // `apiFrom` cannot know whether an older IPC backend implements these
      // optional methods until it receives its unknown-method response.
      setAvailable(false)
      setError(`无法加载 Subagent 模型设置：${reason instanceof Error ? reason.message : String(reason)}`)
    }
    const finish = () => {
      if (!active) return
      settled += 1
      if (settled === 2) {
        setLoading(false)
        if (failed) return
        setAvailable(true)
        setError(null)
      }
    }
    void host.getSubagentModels().then(nextSettings => {
      if (active) setSettings(nextSettings)
    }).catch(reject).finally(finish)
    void host.listAgentDefinitions(catalogProjectId).then(nextAgents => {
      if (!active) return
      setAgents(nextAgents)
      setDismissedDiagnostics(new Set())
    }).catch(reject).finally(finish)
    return () => { active = false }
  }, [host, projectId])

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

  useEffect(() => {
    if (mode !== 'debug') return
    if (!debugMethodsPresent || !host.getSubagentDebugInfo) {
      setDebugInfo({ available: false, reason: 'snapshot-not-ready', bossTools: [], toolCatalog: [], skills: [], subagents: [] })
      setDebugError('当前连接不支持 Subagent Debug 信息。')
      return
    }
    let active = true
    setDebugLoading(true)
    setDebugError(null)
    void host.getSubagentDebugInfo(sessionId).then(info => {
      if (active) setDebugInfo(info)
    }).catch(err => {
      if (!active) return
      setDebugError(`无法加载 Subagent Debug 信息：${err instanceof Error ? err.message : String(err)}`)
    }).finally(() => { if (active) setDebugLoading(false) })
    return () => { active = false }
  }, [debugEpoch, debugMethodsPresent, host, mode, sessionId])

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
      <section className={`subagent-modal${mode === 'debug' ? ' subagent-modal-debug' : ''}`} role="dialog" aria-modal="true" aria-label={mode === 'debug' ? 'Subagent Debug' : 'Subagent 模型'} data-testid="subagent-model-modal">
        <header className="subagent-modal-header">
          <div>
            <h2>{mode === 'debug' ? 'Subagent Debug' : 'Subagent 模型'}</h2>
            <p>{mode === 'debug' ? '查看 Boss 与各个 Subagent 实际可见的工具、Skills 和中文说明。' : '默认「跟随主 Agent」= 底栏当前模型；可为每类 subagent 指定模型、思考强度与有序 fallback 链。'}</p>
          </div>
          <button type="button" className="subagent-debug-toggle" aria-pressed={mode === 'debug'} onClick={() => setMode(value => value === 'debug' ? 'models' : 'debug')}>{mode === 'debug' ? '模型设置' : 'Debug'}</button>
          <button className="subagent-modal-close" aria-label={mode === 'debug' ? '关闭 Subagent Debug' : '关闭 Subagent 模型'} onClick={onClose}>×</button>
        </header>
        {mode === 'debug' ? (
          <div className="subagent-modal-body">
            <SubagentDebugView
              agents={agents}
              info={debugInfo}
              loading={debugLoading}
              error={debugError}
              onDismissError={() => setDebugError(null)}
              onRefresh={() => setDebugEpoch(value => value + 1)}
            />
          </div>
        ) : !available ? (
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
            <section className="subagent-agent-group" aria-labelledby="system-memory-models-heading">
              <div className="subagent-agent-group-heading"><h3 id="system-memory-models-heading">系统 / 记忆</h3><span>独立后台角色，不参与 Subagent fallback</span></div>
              <article className="subagent-agent-row" data-testid="supervisor-model-row">
                <div className="subagent-agent-heading"><strong>Supervisor 管理 Agent</strong></div>
                <p>显式选择只覆盖 Supervisor。默认依次使用 general-purpose 主模型，再使用当前主 Agent（Boss）；新选择从下一个 Supervisor epoch 生效。</p>
                <ModelPicker
                  models={candidateModels}
                  selected={candidateModels.find(model => modelRef(model) === supervisorModel)}
                  configuredRef={supervisorModel}
                  follow={!supervisorModel}
                  allowFollow
                  followLabel="使用 general-purpose / 主 Agent 回退"
                  disabled={saving === 'supervisor'}
                  onSelect={model => { void save('supervisor', model ? [{ model }] : []) }}
                  agentName="supervisor"
                  index={0}
                />
                {supervisorModel && !candidateModels.some(model => modelRef(model) === supervisorModel) && <div className="subagent-model-warning" role="alert">历史设置「{supervisorModel}」当前不可见，请重新选择已启用的 provider/model。</div>}
              </article>
              {memoryAvailable && <article className="subagent-agent-row" data-testid="memory-review-model-row">
                <div className="subagent-agent-heading"><strong>Hermes 记忆复核</strong></div>
                <p>整理会话记忆时使用。默认在复核发生时跟随当时的主 Agent；显式选择只覆盖复核模型。</p>
                <ModelPicker models={candidateModels} selected={candidateModels.find(model => modelRef(model) === memoryReviewModel)} configuredRef={memoryReviewModel ?? ''} follow={!memoryReviewModel} allowFollow disabled={saving === 'memory-review'} onSelect={saveMemoryReview} agentName="memory-review" index={0} />
                {memoryReviewModel && !candidateModels.some(model => modelRef(model) === memoryReviewModel) && <div className="subagent-model-warning" role="alert">历史设置「{memoryReviewModel}」当前不可见，请重新选择已启用的 provider/model。</div>}
              </article>}
            </section>
            {visibleCatalogDiagnostics.length > 0 && <div className="subagent-catalog-diagnostics" data-testid="subagent-catalog-diagnostics">
              {visibleCatalogDiagnostics.map(entry => (
                <DismissibleError
                  key={diagnosticKey(entry)}
                  message={formatDiagnostic(entry)}
                  onDismiss={() => setDismissedDiagnostics(current => new Set(current).add(diagnosticKey(entry)))}
                />
              ))}
            </div>}
            {generalAgents.length > 0 && <section className="subagent-agent-group" aria-labelledby="general-subagent-models-heading">
              <div className="subagent-agent-group-heading"><h3 id="general-subagent-models-heading">通用 Subagents</h3><span>PipiUI 内置与用户安装</span></div>
              {generalAgents.map(agent => <AgentRow key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={candidateModels} saving={saving === agent.name} dismissed={dismissedDiagnostics} onDismiss={setDismissedDiagnostics} onSave={save} />)}
            </section>}
            <ProjectSubagentGroup agents={projectAgents} settings={settings} models={candidateModels} saving={saving} dismissed={dismissedDiagnostics} onDismiss={setDismissedDiagnostics} onSave={save} />
            {error && <div className="subagent-modal-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭 Subagent 模型错误" onClick={() => setError(null)}>×</button></div>}
          </div>
        )}
      </section>
    </div>
  )
}

function ProjectSubagentGroup({
  agents,
  settings,
  models,
  saving,
  dismissed,
  onDismiss,
  onSave,
}: {
  agents: AgentDefinition[]
  settings: Record<string, SubagentModelSetting[]>
  models: Model[]
  saving: string | null
  dismissed: Set<string>
  onDismiss: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
  onSave: (agentName: string, chain: SubagentModelSetting[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  if (agents.length === 0) return null
  return (
    <section className="subagent-agent-group subagent-project-group" aria-labelledby="project-subagent-models-heading" data-testid="project-subagent-group">
      <button
        type="button"
        className="subagent-agent-group-toggle"
        aria-expanded={open}
        aria-controls="project-subagent-models"
        aria-label={open ? '收起项目专用 Subagents' : '展开项目专用 Subagents'}
        data-testid="project-subagent-toggle"
        onClick={() => setOpen(value => !value)}
      >
        <span className="subagent-agent-group-heading">
          <h3 id="project-subagent-models-heading">项目专用 Subagents</h3>
          <span>{agents.length} 个 · 当前项目自带，不是 PipiUI 内置</span>
        </span>
        <b aria-hidden="true">{open ? '⌃' : '⌄'}</b>
      </button>
      {open && <div id="project-subagent-models">
        {agents.map(agent => <AgentRow key={agent.name} agent={agent} chain={settings[agent.name] ?? []} models={models} saving={saving === agent.name} dismissed={dismissed} onDismiss={onDismiss} onSave={onSave} hideProjectSource />)}
      </div>}
    </section>
  )
}

function AgentRow({ agent, chain, models, saving, dismissed, onDismiss, onSave, hideProjectSource }: {
  agent: AgentDefinition
  chain: SubagentModelSetting[]
  models: Model[]
  saving: boolean
  dismissed: Set<string>
  onDismiss: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
  onSave: (agentName: string, chain: SubagentModelSetting[]) => Promise<void>
  hideProjectSource?: boolean
}) {
  // Drag bookkeeping stays per AgentRow: rows of other agents see `dragging`
  // as null and therefore ignore dragover/drop from a foreign chain.
  const [dragging, setDragging] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const sourceLabel = agentSourceLabel(agent, { skipProject: hideProjectSource })
  const availabilityLabel = agentAvailabilityLabel(agent)
  const unavailable = isAgentUnavailable(agent)
  const ownDiagnostics = (agent.diagnostics ?? []).filter(entry => (
    isBlockingCatalogDiagnostic(entry) && !dismissed.has(diagnosticKey(entry))
  ))
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
  // Reorder keeps each { model, thinking } entry intact: the array order is
  // the fallback order, so moving an entry moves its thinking with it.
  const move = (from: number, to: number) => {
    if (saving || from === to) return
    if (from < 0 || to < 0 || from >= chain.length || to >= chain.length) return
    const next = [...chain]
    const [entry] = next.splice(from, 1)
    next.splice(to, 0, entry)
    void onSave(agent.name, next)
  }
  const clearDrag = () => { setDragging(null); setDragOver(null) }
  const reorderable = chain.length > 1

  return (
    <article className={`subagent-agent-row${unavailable ? ' subagent-agent-unavailable' : ''}`} data-testid={`subagent-agent-${agent.name}`}>
      <div className="subagent-agent-heading"><strong>{agent.name}</strong>{sourceLabel && <span data-testid={`subagent-source-${agent.name}`}>{sourceLabel}</span>}{availabilityLabel && <span className="subagent-agent-status" data-testid={`subagent-status-${agent.name}`}>{availabilityLabel}</span>}{chain.length > 1 && <span>fallback ×{chain.length}</span>}</div>
      <p>{agent.description}</p>
      {agent.permissionSummary && <p className="subagent-agent-permissions" data-testid={`subagent-permissions-${agent.name}`}>{agent.permissionSummary}</p>}
      {agent.patches && agent.patches.length > 0 && <p className="subagent-agent-patches" data-testid={`subagent-patches-${agent.name}`}>{agent.patches.map(patch => `${patch.extensionId} · ${formatPatchOperations(patch)}`).join('; ')}</p>}
      {ownDiagnostics.length > 0 && <div className="subagent-agent-diagnostics" data-testid={`subagent-diagnostics-${agent.name}`}>
        {ownDiagnostics.map(entry => (
          <DismissibleError
            key={diagnosticKey(entry)}
            message={formatDiagnostic(entry)}
            onDismiss={() => onDismiss(current => new Set(current).add(diagnosticKey(entry)))}
          />
        ))}
      </div>}
      {rows.map((entry, index) => {
        const selected = findModel(entry.model)
        const thinkingLevels = selected ? thinkingLevelsForModel(selected) : []
        const selectedThinking = thinkingLevels.includes(entry.thinking as ThinkingLevel) ? entry.thinking : ''
        const entryLabel = index === 0 ? '主选' : `备用 ${index}`
        return (
          <div
            className={`subagent-chain-row${reorderable ? ' reorderable' : ''}${dragging === index ? ' dragging' : ''}${dragOver === index && dragging !== null && dragging !== index ? ' drag-over' : ''}`}
            key={`${index}:${entry.model}`}
            data-testid={`subagent-chain-${agent.name}-${index}`}
            onDragOver={event => {
              if (dragging === null || saving) return
              event.preventDefault()
              setDragOver(index)
            }}
            onDrop={event => {
              if (dragging === null || saving) return
              event.preventDefault()
              const from = dragging
              clearDrag()
              if (from !== index) move(from, index)
            }}
          >
            {(index > 0 || chain.length > 1) && <div className="subagent-chain-label"><span>{entryLabel}</span><span className="subagent-chain-actions">{reorderable && <>
              <button type="button" className="subagent-move-btn" aria-label={`上移 ${agent.name} ${entryLabel}`} title={`上移 ${agent.name} ${entryLabel}`} disabled={saving || index === 0} onClick={() => move(index, index - 1)}>↑</button>
              <button type="button" className="subagent-move-btn" aria-label={`下移 ${agent.name} ${entryLabel}`} title={`下移 ${agent.name} ${entryLabel}`} disabled={saving || index === chain.length - 1} onClick={() => move(index, index + 1)}>↓</button>
            </>}{reorderable && <button type="button" aria-label={`移除 ${agent.name} 备用模型 ${index}`} disabled={saving} onClick={() => remove(index)}>删除</button>}</span></div>}
            {reorderable && <span
              className="subagent-drag-handle"
              draggable={!saving}
              title={`拖动调整 ${agent.name} ${entryLabel} 顺序`}
              aria-label={`拖动调整 ${agent.name} ${entryLabel} 顺序`}
              data-testid={`subagent-drag-${agent.name}-${index}`}
              onDragStart={event => {
                if (saving) return
                ;(event.dataTransfer as DataTransfer | null | undefined)?.setData('text/plain', String(index))
                setDragging(index)
              }}
              onDragEnd={clearDrag}
            >⠿</span>}
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

function ModelPicker({ models, selected, configuredRef, follow, allowFollow, followLabel = '跟随主 Agent', disabled, onSelect, agentName, index }: {
  models: Model[]
  selected?: Model
  configuredRef: string
  follow: boolean
  allowFollow: boolean
  followLabel?: string
  disabled: boolean
  onSelect: (modelId: string) => void
  agentName: string
  index: number
}) {
  const [open, setOpen] = useState(false)
  const pick = (modelId: string) => { setOpen(false); onSelect(modelId) }
  const label = follow ? followLabel : selected ? `${selected.name}（${selected.provider}/${selected.id}）` : configuredRef ? `需重新选择 provider（${configuredRef}）` : '选择模型'
  return (
    <div className="subagent-model-picker">
      <button type="button" className="subagent-model-picker-trigger" aria-label={`${agentName} ${index} 模型`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
        {selected && <ProviderLogo provider={selected.provider} modelId={selected.id} size={14} />}
        <span>{label}</span><b>⌄</b>
      </button>
      {open && <div className="subagent-model-picker-menu" role="listbox" aria-label={`${agentName} 模型候选`}>
        {allowFollow && <button type="button" role="option" aria-selected={follow} className={follow ? 'selected' : ''} onClick={() => pick('')}><span>{followLabel}</span>{follow && <b aria-label="已选中">✓</b>}</button>}
        {models.map(model => {
          const ref = modelRef(model)
          const active = selected ? modelRef(selected) === ref && !follow : false
          return <button type="button" role="option" aria-selected={active} className={active ? 'selected' : ''} key={ref} data-testid={`subagent-model-option-${agentName}-${index}-${model.provider}-${model.id}`} onClick={() => pick(ref)}><ProviderLogo provider={model.provider} modelId={model.id} size={14} /><span>{model.name}（{ref}）</span>{active && <b aria-label="已选中">✓</b>}</button>
        })}
      </div>}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Model, ModelState, PipiHostAPI } from '@pipi/host-api'
import type { ModelVisibilityController } from './useModelVisibility'
import { groupByProvider, isModelVisible, modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import { ProviderLoginPanel } from './ProviderLoginPanel'

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

/** Swift Settings > 模型 provider header checkbox: all/none/partial (indeterminate). */
function ProviderTriState({ visibleCount, total, provider, onChange }: {
  visibleCount: number
  total: number
  provider: string
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const checked = visibleCount === total
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = visibleCount > 0 && visibleCount < total
  }, [visibleCount, total])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={`${provider} 全部勾选`}
      data-testid={`provider-check-${provider}`}
      onChange={onChange}
    />
  )
}

/**
 * 通用 tab — persistent vision-model selector. Lists only models that are
 * visible AND vision-capable (`supportsImages !== false`), grouped by
 * provider. Selections round-trip through the host's optional
 * getVisionModel/setVisionModel (pipiui-settings.json + vision.json bridge).
 */
function VisionModelPicker({ host, visibility }: {
  host: PipiHostAPI
  visibility: ModelVisibilityController
}) {
  const [value, setValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const unsupported = typeof host.getVisionModel !== 'function' || typeof host.setVisionModel !== 'function'

  useEffect(() => {
    if (unsupported) { setLoading(false); return }
    host.getVisionModel?.()
      .then(raw => setValue(typeof raw === 'string' ? raw : null))
      .catch(err => setError(`读取视觉模型失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setLoading(false))
  }, [host, unsupported])

  const groups = useMemo(() => {
    const visible = visibility.models.filter(model =>
      isModelVisible(model, visibility.hiddenIds) && model.supportsImages !== false,
    )
    return groupByProvider(visible)
  }, [visibility.models, visibility.hiddenIds])

  const select = async (ref: string | null) => {
    if (!host.setVisionModel) return
    setError(null)
    try {
      const saved = await host.setVisionModel(ref)
      setValue(saved)
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (unsupported) return <div className="model-modal-state" data-testid="vision-unsupported">当前连接不支持</div>
  if (loading) return <div className="model-modal-state" data-testid="vision-loading">正在加载视觉模型…</div>

  return (
    <div className="vision-picker" data-testid="vision-picker">
      {error && (
        <div className="model-modal-error" data-testid="vision-error">
          <span>{error}</span>
          <button className="visibility-error-close" aria-label="关闭错误提示" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <p className="vision-picker-hint">选择用于视觉任务的模型；保存后写入 agent 目录的 vision.json，供视觉插件读取。</p>
      <button
        type="button"
        className={`vision-row vision-none ${value === null ? 'selected' : ''}`}
        data-testid="vision-row-none"
        onClick={() => void select(null)}
      >
        <span className="vision-row-name">无（不加强）</span>
        {value === null && <span className="vision-picker-check">✓</span>}
      </button>
      {groups.length === 0
        ? <div className="model-modal-state" data-testid="vision-empty">暂无可用于视觉的模型</div>
        : groups.map(group => (
          <section key={group.provider} className="vision-group" data-testid={`vision-group-${group.provider}`}>
            <div className="vision-group-header">
              <ProviderLogo provider={group.provider} size={15} />
              <span className="vision-group-name">{group.provider}</span>
            </div>
            {group.models.map(model => {
              const ref = modelRef(model)
              const selected = value === ref
              return (
                <button
                  key={ref}
                  type="button"
                  className={`vision-row ${selected ? 'selected' : ''}`}
                  data-testid={`vision-row-${model.provider}-${model.id}`}
                  onClick={() => void select(ref)}
                >
                  <ProviderLogo provider={model.provider} modelId={model.id} size={14} />
                  <span className="vision-row-name">{model.name}</span>
                  {selected && <span className="vision-picker-check">✓</span>}
                </button>
              )
            })}
          </section>
        ))}
    </div>
  )
}

/**
 * `/model` — settings modal with two tabs: 通用 (vision-model selector) and
 * 模型管理 (provider-collapsible model visibility management mirroring Swift
 * Settings > 模型). Provider headers carry a tri-state checkbox
 * (all/none/partial visible), a per-provider delete action (pi logout with
 * confirmation) and an "添加模型" flow driving pi's native OAuth/api-key login.
 * Visibility state is persisted through the host (hiddenModelIds, atomic);
 * vision selection through getVisionModel/setVisionModel (vision.json bridge).
 * Providers default to COLLAPSED; clicking a provider header expands it.
 */
export function ModelVisibilityModal({ host, visibility, current, onModelState, onClose }: {
  host: PipiHostAPI
  visibility: ModelVisibilityController
  current: Model | null
  onModelState?: (state: ModelState) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'general' | 'models'>('general')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<'manage' | 'add'>('manage')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const groups = useMemo(() => groupByProvider(visibility.models), [visibility.models])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleExpanded = (provider: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const isCurrent = (model: Model) => current?.provider === model.provider && current.id === model.id

  const doDelete = async (provider: string) => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const state = await host.removeProviderCredentials(provider)
      onModelState?.(state)
      setConfirmDelete(null)
      await visibility.refresh()
    } catch (err) {
      setDeleteError(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="model-modal-backdrop" data-testid="model-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="model-modal" role="dialog" aria-modal="true" aria-label="模型管理" data-testid="model-modal">
        <header>
          <h2>{tab === 'general' ? '通用' : view === 'manage' ? '模型管理' : '添加模型'}</h2>
          <p>
            {tab === 'general'
              ? '选择用于视觉任务的模型；当前连接仅需在模型管理中保持勾选即可出现在此处。'
              : view === 'manage'
                ? '左侧勾选控制底栏快捷模型菜单是否显示；当前模型在快捷菜单中保底可见。'
                : '登录 pi 支持的 provider 后，其模型目录会自动出现。'}
          </p>
          <button className="model-modal-close" aria-label="关闭模型管理" onClick={onClose}>×</button>
          {tab === 'models' && (view === 'manage'
            ? <button className="model-modal-add" data-testid="model-add-button" onClick={() => setView('add')}>＋ 添加模型</button>
            : <button className="model-modal-add" data-testid="model-add-back" onClick={() => setView('manage')}>← 返回</button>)}
          <div className="model-modal-tabs" role="tablist" aria-label="设置分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'general'}
              className={`model-modal-tab ${tab === 'general' ? 'active' : ''}`}
              data-testid="model-tab-general"
              onClick={() => setTab('general')}
            >通用</button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'models'}
              className={`model-modal-tab ${tab === 'models' ? 'active' : ''}`}
              data-testid="model-tab-models"
              onClick={() => { setView('manage'); setTab('models') }}
            >模型管理</button>
          </div>
        </header>
        <div className="model-modal-body" data-testid="model-modal-body">
          {tab === 'general'
            ? <VisionModelPicker host={host} visibility={visibility} />
            : view === 'add'
              ? <ProviderLoginPanel host={host} onAdded={() => { setView('manage'); void visibility.refresh() }} />
              : <>
                {visibility.error && (
                  <div className="model-modal-error visibility-error" data-testid="visibility-error">
                    <span>{visibility.error}</span>
                    <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="visibility-error-close" onClick={() => visibility.dismissError()}>×</button>
                  </div>
                )}
                {visibility.loading && visibility.models.length === 0
                  ? <div className="model-modal-state" data-testid="model-modal-loading">正在加载模型…</div>
                  : visibility.models.length === 0
                    ? <div className="model-modal-state" data-testid="model-modal-empty">暂无可用模型</div>
                    : groups.map(group => {
                      const isCollapsed = !expanded.has(group.provider)
                      const visibleCount = group.models.filter(model => !visibility.hiddenIds.has(modelRef(model))).length
                      const total = group.models.length
                      return (
                        <section key={group.provider} className="model-provider" data-testid={`model-provider-${group.provider}`}>
                          <div className="model-provider-header">
                            <ProviderTriState
                              visibleCount={visibleCount}
                              total={total}
                              provider={group.provider}
                              onChange={() => void visibility.setProviderHidden(group.provider, visibleCount > 0)}
                            />
                            <button
                              className="model-provider-toggle"
                              aria-label={isCollapsed ? `展开 ${group.provider}` : `折叠 ${group.provider}`}
                              aria-expanded={!isCollapsed}
                              onClick={() => toggleExpanded(group.provider)}
                            >
                              {isCollapsed ? '▸' : '▾'}
                            </button>
                            <ProviderLogo provider={group.provider} size={15} />
                            <span className="model-provider-name">{group.provider}</span>
                            <span className="model-provider-count" data-testid={`provider-count-${group.provider}`}>{visibleCount}/{total}</span>
                            <button
                              className="model-provider-delete"
                              title="删除该 provider 的 Pi 凭据（pi logout）"
                              aria-label={`删除 ${group.provider} 凭据`}
                              data-testid={`delete-provider-${group.provider}`}
                              onClick={() => setConfirmDelete(group.provider)}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                          {confirmDelete === group.provider && (
                            <div className="model-provider-confirm" data-testid={`delete-confirm-${group.provider}`}>
                              <span>删除将移除 {group.provider} 的 Pi 凭据，其下模型将不可用。</span>
                              <div className="model-provider-confirm-actions">
                                <button className="provider-login-cancel" disabled={deleting} data-testid={`delete-cancel-${group.provider}`} onClick={() => setConfirmDelete(null)}>取消</button>
                                <button className="confirm-delete" disabled={deleting} data-testid={`delete-confirm-btn-${group.provider}`} onClick={() => void doDelete(group.provider)}>{deleting ? '删除中…' : '确认删除'}</button>
                              </div>
                              {deleteError && <div className="model-modal-error" data-testid="delete-error">{deleteError}</div>}
                            </div>
                          )}
                          {!isCollapsed && group.models.map(model => {
                            const visible = !visibility.hiddenIds.has(modelRef(model))
                            const currentModel = isCurrent(model)
                            return (
                              <label key={modelRef(model)} className="model-row" data-testid={`model-row-${model.provider}-${model.id}`}>
                                <input
                                  type="checkbox"
                                  checked={visible}
                                  aria-label={`在快捷菜单显示 ${model.name}`}
                                  onChange={() => void visibility.setHidden(model, visible)}
                                />
                                <ProviderLogo provider={model.provider} modelId={model.id} size={14} />
                                <span className="model-row-name">{model.name}</span>
                                <span className="model-row-id">{model.provider}/{model.id}</span>
                                {currentModel && <span className="model-row-current">当前模型</span>}
                              </label>
                            )
                          })}
                        </section>
                      )
                    })}
              </>}
        </div>
      </section>
    </div>
  )
}

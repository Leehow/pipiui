import { useEffect, useMemo, useRef, useState } from 'react'
import type { Model, ModelState, PipiHostAPI } from '@pipi/host-api'
import type { ModelVisibilityController } from './useModelVisibility'
import { groupByProvider, modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import { ProviderLoginPanel } from './ProviderLoginPanel'
import type { VisionRoutingController } from './useVisionRouting'
import type { ScanExternalSessionsController } from './useScanExternalSessions'
import type { UpdateCenterController } from './useUpdateCenter'
import { UpdateCenter } from './UpdateCenter'
import { ExtensionsPane } from './ExtensionsPane'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import {
  DEFAULT_SETTINGS_TAB,
  HOST_SETTINGS_TAB_IDS,
  registerSettingsSection,
  useSettingsSections,
  type SettingsSectionContext,
} from './ui-registries'
import './computer-use.css'

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

function ModelsSettingsBody({ ctx }: { ctx: SettingsSectionContext }) {
  const { host, visibility, current, onModelState, view, setView } = ctx
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const groups = useMemo(() => groupByProvider(visibility.models), [visibility.models])
  const toggleExpanded = (provider: string) => {
    setExpanded(currentExpanded => {
      const next = new Set(currentExpanded)
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
  if (view === 'add') {
    return <ProviderLoginPanel host={host} onAdded={() => { setView('manage'); void visibility.refresh() }} />
  }
  return <>
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
          const isExpanded = expanded.has(group.provider)
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
                  aria-label={isExpanded ? `折叠 ${group.provider}` : `展开 ${group.provider}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleExpanded(group.provider)}
                >
                  <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                  <ProviderLogo provider={group.provider} size={15} />
                  <span className="model-provider-name">{group.provider}</span>
                  <span className="model-provider-count" data-testid={`provider-count-${group.provider}`}>{visibleCount}/{total}</span>
                </button>
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
              {isExpanded && group.models.map(model => {
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
  </>
}

/**
 * `/model` — settings modal with three tabs: 模型管理 (provider-collapsible
 * model visibility management mirroring Swift Settings > 模型, the default
 * tab), 扩展 (extension packages incl. the host-feature builtin panes, add
 * MCP / Pi extensions via main chat), and 更新中心. Provider headers carry a
 * tri-state checkbox (all/none/partial visible), a per-provider delete action
 * (pi logout with confirmation) and an "添加模型" flow driving pi's native
 * OAuth/api-key login. Visibility state is persisted through the host
 * (hiddenModelIds, atomic); vision routing through getVisionEnabled/
 * setVisionEnabled + getVisionModel/setVisionModel.
 */
export function ModelVisibilityModal({ host, visibility, vision, scan, updates, current, onModelState, onRequestUpdate, onClose, initialView = 'manage', projectId }: {
  host: PipiHostAPI
  visibility: ModelVisibilityController
  vision: VisionRoutingController
  scan: ScanExternalSessionsController
  updates: UpdateCenterController
  current: Model | null
  onModelState?: (state: ModelState) => void
  onRequestUpdate: (prompt: string) => void
  onClose: () => void
  /** First-run onboarding opens straight into the provider login pane. */
  initialView?: 'manage' | 'add'
  projectId?: string
}) {
  const sections = useSettingsSections().filter(section => (
    HOST_SETTINGS_TAB_IDS as readonly string[]
  ).includes(section.id))
  const [tab, setTab] = useState(DEFAULT_SETTINGS_TAB)
  const [extensionsAddOpen, setExtensionsAddOpen] = useState(false)
  const [view, setView] = useState<'manage' | 'add'>(initialView)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ctx: SettingsSectionContext = {
    host, visibility, vision, scan, updates, current, onModelState, onRequestUpdate, projectId,
    view, setView, extensionsAddOpen, setExtensionsAddOpen,
  }
  const active = sections.find(section => section.id === tab)
    ?? sections.find(section => section.id === DEFAULT_SETTINGS_TAB)
    ?? sections[0]
  const title = active ? (typeof active.title === 'function' ? active.title(ctx) : active.title) : ''
  const description = active ? (typeof active.description === 'function' ? active.description(ctx) : active.description) : ''

  return (
    <div className="model-modal-backdrop" data-testid="model-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="model-modal" role="dialog" aria-modal="true" aria-label="设置" data-testid="model-modal">
        <header>
          <h2>{title}</h2>
          <p>{description}</p>
          <button className="model-modal-close" aria-label="关闭设置" onClick={onClose}>×</button>
          <div className="model-modal-header-actions">
            {active?.headerActions?.(ctx)}
          </div>
          <div className="model-modal-tabs" role="tablist" aria-label="设置分类">
            {sections.map(section => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={tab === section.id}
                className={`model-modal-tab${tab === section.id ? ' active' : ''}`}
                data-testid={`model-tab-${section.id}`}
                onClick={() => {
                  section.onActivate?.({ setView, setExtensionsAddOpen })
                  setTab(section.id)
                }}
              >{section.label}</button>
            ))}
          </div>
        </header>
        <div className="model-modal-body" data-testid="model-modal-body">
          {sections.map(section => {
            const isActive = section.id === tab
            if (!isActive && section.id !== 'models') return null
            return <div key={section.id} hidden={!isActive}>{section.render(ctx)}</div>
          })}
        </div>
      </section>
    </div>
  )
}

registerSettingsSection(BUILTIN_EXTENSION_ID, {
  id: 'models',
  label: '模型管理',
  title: ctx => ctx.view === 'manage' ? '模型管理' : '添加模型',
  description: ctx => ctx.view === 'manage'
    ? '左侧勾选控制底栏快捷模型菜单是否显示；当前模型在快捷菜单中保底可见。'
    : '登录 pi 支持的 provider 后，其模型目录会自动出现。',
  onActivate: ({ setView, setExtensionsAddOpen }) => { setView('manage'); setExtensionsAddOpen(false) },
  headerActions: ctx => ctx.view === 'manage'
    ? <>
        <button
          className="model-modal-refresh"
          data-testid="model-refresh-button"
          disabled={ctx.visibility.loading}
          onClick={() => void ctx.visibility.refresh()}
        >
          {ctx.visibility.loading ? '刷新中…' : '⟳ 刷新'}
        </button>
        <button className="model-modal-add" data-testid="model-add-button" onClick={() => ctx.setView('add')}>＋ 添加模型</button>
      </>
    : <button className="model-modal-add" data-testid="model-add-back" onClick={() => ctx.setView('manage')}>← 返回</button>,
  render: ctx => <ModelsSettingsBody ctx={ctx} />,
})

registerSettingsSection(BUILTIN_EXTENSION_ID, {
  id: 'extensions',
  label: '扩展',
  title: 'MCP / 扩展',
  description: '把外部 MCP 或 Pi 扩展加进来。点添加，复制一句话到主界面即可。',
  headerActions: ctx => <button className="model-modal-add" data-testid="extensions-add-button" onClick={() => ctx.setExtensionsAddOpen(true)}>＋ 添加</button>,
  render: ctx => <ExtensionsPane host={ctx.host} projectId={ctx.projectId} addOpen={ctx.extensionsAddOpen} onCloseAdd={() => ctx.setExtensionsAddOpen(false)} vision={ctx.vision} visibility={ctx.visibility} scan={ctx.scan} />,
})

registerSettingsSection(BUILTIN_EXTENSION_ID, {
  id: 'updates',
  label: '更新中心',
  title: '更新中心',
  description: '比较内置 Pi、Cua Driver 和托管运行时组件的本机与最新版本。',
  onActivate: ({ setExtensionsAddOpen }) => setExtensionsAddOpen(false),
  render: ctx => <UpdateCenter updates={ctx.updates} onRequestUpdate={ctx.onRequestUpdate} />,
})

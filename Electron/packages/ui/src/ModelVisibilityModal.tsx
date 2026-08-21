import { useEffect, useMemo, useRef, useState } from 'react'
import type { Model, ModelState, PipiHostAPI } from '@pipi/host-api'
import type { ModelVisibilityController } from './useModelVisibility'
import { groupByProvider, modelRef, usesBuiltInVisionMcp } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import { ProviderLoginPanel } from './ProviderLoginPanel'
import type { VisionRoutingController } from './useVisionRouting'
import type { ScanExternalSessionsController } from './useScanExternalSessions'
import type { UpdateCenterController } from './useUpdateCenter'
import { UpdateCenter } from './UpdateCenter'
import { ExtensionsPane } from './ExtensionsPane'
import { WebSearchKeysPane } from './WebSearchKeysPane'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import {
  DEFAULT_SETTINGS_TAB,
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

/**
 * 通用 tab — 识图路由开关 + 识图模型选择。开关仿 ComputerUsePanel
 * (role="switch" + computer-use-switch CSS)；选择器为原生 <select>
 * (仿 SubagentModelModal 的原生 select 风格)。候选 = 模型管理中已勾选
 * (visible) 且 supportsImages !== false 的模型；已选识图模型即便未勾选
 * 也保底出现在列表中（与 quickGroups 对当前模型的保底逻辑一致）。
 * 持久化走 useVisionRouting (getVisionEnabled/setVisionEnabled +
 * getVisionModel/setVisionModel)。
 */
function ScanExternalSessionsPane({ scan }: { scan: ScanExternalSessionsController }) {
  if (!scan.available) {
    return <div className="model-modal-state" data-testid="scan-external-unsupported">当前连接不支持外部会话扫描设置。</div>
  }
  if (scan.loading) {
    return <div className="model-modal-state" data-testid="scan-external-loading">正在加载外部会话扫描设置…</div>
  }
  return (
    <div className="vision-picker" data-testid="scan-external-pane">
      <div className="computer-use-toggle-row">
        <div>
          <strong>自动扫描其他 coding agent 聊天记录</strong>
          <p>关闭后侧栏不再显示 Codex / Claude / Cursor 等外部会话。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={scan.enabled}
          aria-label="自动扫描其他 coding agent 聊天记录"
          className={`computer-use-switch${scan.enabled ? ' enabled' : ''}`}
          disabled={scan.saving}
          data-testid="scan-external-sessions-switch"
          onClick={() => void scan.setEnabled(!scan.enabled)}
        >
          <span />
        </button>
      </div>
      {scan.error && (
        <div className="model-modal-error" role="alert" data-testid="scan-external-error">
          <span>{scan.error}</span>
          <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="scan-external-error-close" onClick={() => scan.dismissError()}>×</button>
        </div>
      )}
    </div>
  )
}

function VisionRoutingPane({ visibility, vision }: {
  visibility: ModelVisibilityController
  vision: VisionRoutingController
}) {
  const candidates = useMemo(() => {
    const list = visibility.quickModels.filter(model => model.supportsImages !== false)
    const selected = vision.model
    if (selected && !list.some(model => modelRef(model) === selected)) {
      const current = visibility.models.find(model => modelRef(model) === selected)
      if (current) list.push(current)
    }
    return list
  }, [visibility.quickModels, visibility.models, vision.model])
  const groups = useMemo(() => groupByProvider(candidates), [candidates])
  const textOnlyChecked = useMemo(
    () => visibility.visibleModels.filter(model => model.supportsImages === false),
    [visibility.visibleModels]
  )
  const textOnlyGroups = useMemo(() => groupByProvider(textOnlyChecked), [textOnlyChecked])
  const [textOnlyOpen, setTextOnlyOpen] = useState(false)

  if (!vision.available) {
    return <div className="model-modal-state" data-testid="vision-unsupported">当前连接不支持识图设置。</div>
  }
  if (vision.loading) {
    return <div className="model-modal-state" data-testid="vision-loading">正在加载识图设置…</div>
  }
  return (
    <div className="vision-picker" data-testid="vision-picker">
      <div className="computer-use-toggle-row">
        <div>
          <strong>识图模型</strong>
          <p>图片识别</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={vision.enabled}
          aria-label="启用识图模型"
          className={`computer-use-switch${vision.enabled ? ' enabled' : ''}`}
          disabled={vision.saving}
          data-testid="vision-enabled-switch"
          onClick={() => void vision.setEnabled(!vision.enabled)}
        >
          <span />
        </button>
      </div>
      <p className="vision-picker-hint">主线模型不支持图片时，用指定识图模型识别图片后交给文字模型。</p>
      {vision.error && (
        <div className="model-modal-error" role="alert" data-testid="vision-error">
          <span>{vision.error}</span>
          <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="vision-error-close" onClick={() => vision.dismissError()}>×</button>
        </div>
      )}
      <label className="vision-model-select-row" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, color: 'var(--muted)', fontSize: 11 }}>
        <span>识图模型</span>
        <select
          className="vision-model-select"
          aria-label="识图模型"
          data-testid="vision-model-select"
          value={vision.model ?? ''}
          disabled={!vision.enabled || vision.saving}
          onChange={event => void vision.setModel(event.target.value || null)}
          style={{ width: '100%', maxWidth: 'none', padding: '5px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', background: 'var(--surface-input)', fontSize: 11 }}
        >
          <option value="">未选择识图模型</option>
          {groups.map(group => (
            <optgroup key={group.provider} label={group.provider}>
              {group.models.map(model => (
                <option key={modelRef(model)} value={modelRef(model)}>
                  {model.name}（{modelRef(model)}）
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {vision.enabled && vision.model && (
        <p className="vision-picker-hint" data-testid="vision-model-selected">已选：{vision.model}</p>
      )}
      <div className="vision-text-models">
        <button
          type="button"
          className="vision-text-models-toggle"
          aria-expanded={textOnlyOpen}
          aria-label={textOnlyOpen ? '折叠非多模态模型' : '展开非多模态模型'}
          data-testid="non-multimodal-fold"
          onClick={() => setTextOnlyOpen(open => !open)}
        >
          <span aria-hidden="true">{textOnlyOpen ? '▾' : '▸'}</span>
          <span>已勾选的非多模态模型</span>
          <span className="vision-text-models-count">{textOnlyChecked.length}</span>
        </button>
        {textOnlyOpen && (
          <div className="vision-text-models-list" data-testid="non-multimodal-list">
            {textOnlyChecked.length === 0
              ? <p className="vision-picker-hint">已勾选的模型都支持图片。</p>
              : textOnlyGroups.map(group => (
                <div key={group.provider} className="vision-group">
                  <div className="vision-group-header">
                    <ProviderLogo provider={group.provider} size={14} />
                    <span className="vision-group-name">{group.provider}</span>
                  </div>
                  {group.models.map(model => (
                    <div key={modelRef(model)} className="vision-text-model-row">
                      <span className="vision-row-name">{model.name}</span>
                      {usesBuiltInVisionMcp(model.provider) && (
                        <span
                          className="vision-text-model-badge"
                          title="自带视觉 MCP，不走通用识图模型"
                          data-testid={`vision-mcp-badge-${model.provider}-${model.id}`}
                        >内置识图 MCP</span>
                      )}
                      <span className="model-row-id">{modelRef(model)}</span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
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
 * `/model` — settings modal with four tabs: 通用 (vision-routing switch +
 * selector, default off), 模型管理 (provider-collapsible model visibility
 * management mirroring Swift Settings > 模型, the default tab), 扩展 (MCP /
 * Pi plugins, add-via-main-chat), and 更新中心. Provider headers carry a
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
  const sections = useSettingsSections()
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
  id: 'general',
  label: '通用',
  title: '通用',
  description: '识图路由、外部会话扫描与 Web 搜索密钥',
  onActivate: ({ setExtensionsAddOpen }) => setExtensionsAddOpen(false),
  render: ctx => <>
    <ScanExternalSessionsPane scan={ctx.scan} />
    <VisionRoutingPane visibility={ctx.visibility} vision={ctx.vision} />
    <WebSearchKeysPane host={ctx.host} projectId={ctx.projectId} />
  </>,
})

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
  render: ctx => <ExtensionsPane host={ctx.host} projectId={ctx.projectId} addOpen={ctx.extensionsAddOpen} onCloseAdd={() => ctx.setExtensionsAddOpen(false)} />,
})

registerSettingsSection(BUILTIN_EXTENSION_ID, {
  id: 'updates',
  label: '更新中心',
  title: '更新中心',
  description: '比较内置 Pi、Cua Driver 和托管运行时组件的本机与最新版本。',
  onActivate: ({ setExtensionsAddOpen }) => setExtensionsAddOpen(false),
  render: ctx => <UpdateCenter updates={ctx.updates} onRequestUpdate={ctx.onRequestUpdate} />,
})

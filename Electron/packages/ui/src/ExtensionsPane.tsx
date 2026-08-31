import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentCatalogDiagnostic, AgentDefinition, ExtensionCategory, ExtensionDescriptor, PipiHostAPI, ProductProfileDescriptor, ProjectProductActivation, UserMcpServer } from '@pipi/host-api'
import {
  agentAvailabilityLabel,
  agentSourceLabel,
  collectCatalogDiagnostics,
  contributedAgentsFor,
  diagnosticKey,
  diagnosticsForExtension,
  formatDiagnostic,
  formatPatchOperations,
  isBlockingCatalogDiagnostic,
  isRequestedPatch,
  patchesForExtension,
  redactDiagnosticMessage,
} from './agent-catalog-ui'
import { DismissibleError } from './DismissibleError'
import { MCP_ADD_PROMPT, PI_EXTENSION_ADD_PROMPT } from './extension-add-copy'
import {
  blocksEnableForL2,
  capabilityLabel,
  EXTENSION_SOURCE_LABEL,
  EXTENSION_STATE_LABEL,
  grantNeedsConfirmation,
  L2_CAPABILITY_HINT,
} from './extension-capabilities'
import { ExtensionAuthCard } from './ExtensionAuthCard'
import { EXTERNAL_SESSION_SCAN_EXTENSION_ID, HOST_FEATURE_SETTINGS_EXTENSION_IDS, VISION_ROUTING_EXTENSION_ID, WEB_SEARCH_KEYS_EXTENSION_ID } from './host-feature-extensions'
import { ScanExternalSessionsPane } from './ScanExternalSessionsPane'
import { SchemaSettingsForm } from './schema-settings-form'
import type { ModelVisibilityController } from './useModelVisibility'
import type { ScanExternalSessionsController } from './useScanExternalSessions'
import type { VisionRoutingController } from './useVisionRouting'
import { VisionRoutingPane } from './VisionRoutingPane'
import { WebSearchKeysPane } from './WebSearchKeysPane'
import { useOptionalProductWorkbenchRuntime } from './workbench/workbench-runtime'

const LAST_SESSION_STORAGE_KEY = 'pipiui:eui:last-session:v1'
type DisplayExtensionCategory = ExtensionCategory | 'other'

const EXTENSION_CATEGORY_ORDER: readonly DisplayExtensionCategory[] = [
  'foundation',
  'workflow',
  'coding',
  'knowledge',
  'automation',
  'integration',
  'developer',
  'other',
]

const EXTENSION_CATEGORY_LABEL: Record<DisplayExtensionCategory, string> = {
  foundation: '基础能力',
  workflow: '工作流与效率',
  coding: 'Coding 开发',
  knowledge: '文档与知识',
  automation: '自动化与设备',
  integration: '模型与外部服务',
  developer: '开发者',
  other: '其它扩展',
}

const EXTENSION_CATEGORY_DESCRIPTION: Record<DisplayExtensionCategory, string> = {
  foundation: 'PipiUI 启动、会话与基本交互所需的核心能力',
  workflow: '任务、计划、协作与日常效率工具',
  coding: '代码理解、检索、终端与开发工作流',
  knowledge: '文档、记忆、知识整理与内容处理',
  automation: '浏览器、电脑控制与设备自动化',
  integration: '模型接入、MCP 与外部服务连接',
  developer: '创建、调试和维护 PipiUI 扩展',
  other: '尚未归入专门类别的扩展',
}

type ExtensionStatusFilter = 'all' | 'enabled' | 'disabled'

const EXTENSION_STATUS_FILTERS: readonly { id: ExtensionStatusFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'enabled', label: '已启用' },
  { id: 'disabled', label: '未启用' },
]

function extensionCategory(ext: ExtensionDescriptor): DisplayExtensionCategory {
  return ext.category ?? 'other'
}

function profileExtensionIds(profile: ProductProfileDescriptor | undefined): string[] {
  return [...new Set([
    ...(profile?.requiredExtensionIds ?? []),
    ...(profile?.recommendedExtensionIds ?? []),
  ])]
}

function profileDisplayName(profile: ProductProfileDescriptor): string {
  return profile.id === 'coding' ? 'Coding' : profile.name
}

function hostFromWindow(): PipiHostAPI | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { pipiHost?: PipiHostAPI }).pipiHost
}

function lastProjectId(): string | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return undefined
    const projectId = (value as { projectId?: unknown }).projectId
    return typeof projectId === 'string' && projectId ? projectId : undefined
  } catch {
    return undefined
  }
}

async function loadUserMcpServers(host: PipiHostAPI | undefined, preferredProjectId?: string): Promise<UserMcpServer[]> {
  if (!host?.listUserMcpServers) return []
  let projectId = preferredProjectId || lastProjectId()
  if (!projectId) {
    const projects = await host.listProjects()
    projectId = projects[0]?.id
  }
  if (!projectId) return []
  return await host.listUserMcpServers(projectId)
}

type CopiedKey = 'mcp' | 'pi' | null

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyRow({ label, text, copied, onCopy }: {
  label: string
  text: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="extensions-copy-row" data-testid={`extensions-copy-${label}`}>
      <pre className="extensions-copy-text">{text}</pre>
      <button type="button" className="extensions-copy-btn" data-testid={`extensions-copy-btn-${label}`} onClick={() => void onCopy()}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

export function ExtensionsAddDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState<CopiedKey>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const copy = async (key: CopiedKey, text: string) => {
    if (!await copyText(text)) return
    setCopied(key)
  }

  return (
    <div
      className="extensions-add-backdrop"
      data-testid="extensions-add-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <section className="extensions-add-dialog" role="dialog" aria-modal="true" aria-labelledby="extensions-add-title" data-testid="extensions-add-dialog">
        <header>
          <h3 id="extensions-add-title">添加 MCP 或 Pi 扩展</h3>
          <button type="button" className="model-modal-close" aria-label="关闭添加说明" onClick={onClose}>×</button>
        </header>
        <div className="extensions-add-body">
          <p>不用在这里填命令、URL 或密钥。</p>
          <p>PipiUI 已经接好了 Pi 的 MCP 能力。要加某家的 MCP，或某个 Pi 插件，回到主界面直接说就行——可以说厂商和名字，也可以贴官网、npm 包名或配置链接。</p>
          <ul className="extensions-add-examples">
            <li>请把 Context7 的 MCP 加到 PipiUI</li>
            <li>请把 Notion 家的这个 MCP 加进来，链接我贴下面</li>
            <li>请把这个 Pi 扩展加到 PipiUI：https://pi.dev/packages/xxx</li>
          </ul>
          <p>复制下面一句，改成你要的名字或链接，贴到主界面发送。PipiUI 会去查该怎么装，并写到本机配置里。</p>
          <CopyRow label="mcp" text={MCP_ADD_PROMPT} copied={copied === 'mcp'} onCopy={() => copy('mcp', MCP_ADD_PROMPT)} />
          <CopyRow label="pi" text={PI_EXTENSION_ADD_PROMPT} copied={copied === 'pi'} onCopy={() => copy('pi', PI_EXTENSION_ADD_PROMPT)} />
          {copied && <p className="extensions-add-copied" data-testid="extensions-add-copied">已复制。关掉设置，贴到主界面发送即可。</p>}
        </div>
      </section>
    </div>
  )
}

function requestedCapabilities(ext: ExtensionDescriptor): readonly string[] {
  return ext.capabilities ?? []
}

function readableError(ext: ExtensionDescriptor): string | undefined {
  if (ext.state !== 'error') return undefined
  const reason = ext.errorReason ?? ext.error
  return reason && reason.trim() ? reason : '加载失败'
}

function ConfirmDialog({
  testId,
  title,
  children,
  confirmLabel,
  confirmTestId,
  cancelTestId,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: {
  testId: string
  title: string
  children: ReactNode
  confirmLabel: string
  confirmTestId: string
  cancelTestId: string
  onConfirm: () => void
  onCancel: () => void
  confirmDisabled?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="extensions-add-backdrop"
      data-testid={`${testId}-backdrop`}
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}
    >
      <section className="extensions-add-dialog" role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}>
        <header>
          <h3 id={`${testId}-title`}>{title}</h3>
          <button type="button" className="model-modal-close" aria-label="关闭" onClick={onCancel}>×</button>
        </header>
        <div className="extensions-add-body">
          {children}
          <div className="extensions-dialog-actions">
            <button type="button" className="model-modal-refresh" data-testid={cancelTestId} onClick={onCancel}>取消</button>
            <button type="button" className="model-modal-add" data-testid={confirmTestId} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function ExtensionContributionSummary({
  ext,
  agents,
  catalogDiagnostics,
  dismissed,
  onDismiss,
}: {
  ext: ExtensionDescriptor
  agents: AgentDefinition[]
  catalogDiagnostics: AgentCatalogDiagnostic[]
  dismissed: Set<string>
  onDismiss: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
}) {
  const contributed = contributedAgentsFor(agents, ext.id)
  const patches = patchesForExtension(agents, ext.id)
  const acceptedPatches = patches.filter(({ patch }) => !isRequestedPatch(patch))
  const requestedPatches = patches.filter(({ patch }) => isRequestedPatch(patch))
  const related = diagnosticsForExtension(ext.id, agents, catalogDiagnostics).filter(entry => (
    isBlockingCatalogDiagnostic(entry) && !dismissed.has(diagnosticKey(entry))
  ))
  if (contributed.length === 0 && acceptedPatches.length === 0 && requestedPatches.length === 0 && related.length === 0) return null
  return (
    <div className="extensions-pkg-contrib" data-testid={`extensions-pkg-contrib-${ext.id}`}>
      {contributed.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">贡献的 Agent</div>
          <ul className="extensions-pkg-agents" data-testid={`extensions-pkg-agents-${ext.id}`}>
            {contributed.map(agent => {
              const sourceLabel = agentSourceLabel(agent)
              const availabilityLabel = agentAvailabilityLabel(agent)
              return (
                <li key={agent.name} data-testid={`extensions-pkg-agent-${ext.id}-${agent.name}`}>
                  <strong>{agent.name}</strong>
                  <span className="extensions-pkg-agent-meta">
                    {sourceLabel}{availabilityLabel ? ` · ${availabilityLabel}` : ''}{agent.permissionSummary ? ` · ${agent.permissionSummary}` : ''}
                  </span>
                  {agent.description && <span className="extensions-pkg-agent-desc">{agent.description}</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {acceptedPatches.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">应用的补丁</div>
          <ul className="extensions-pkg-patches" data-testid={`extensions-pkg-patches-${ext.id}`}>
            {acceptedPatches.map(({ agentName, patch }, index) => (
              <li key={`${agentName}-${patch.operations.join('-')}-${index}`} data-testid={`extensions-pkg-patch-${ext.id}-${agentName}`}>
                <strong>{agentName}</strong>
                <span className="extensions-pkg-agent-meta">{formatPatchOperations(patch)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {requestedPatches.length > 0 && (
        <>
          <div className="extensions-pkg-contrib-heading">请求的补丁</div>
          <ul className="extensions-pkg-requested" data-testid={`extensions-pkg-requested-${ext.id}`}>
            {requestedPatches.map(({ agentName, patch }, index) => (
              <li key={`${agentName}-${patch.operations.join('-')}-requested-${index}`} data-testid={`extensions-pkg-requested-${ext.id}-${agentName}`}>
                <strong>{agentName}</strong>
                <span className="extensions-pkg-agent-meta">{formatPatchOperations(patch)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {related.length > 0 && (
        <div className="extensions-pkg-contrib-diagnostics" data-testid={`extensions-pkg-contrib-diag-${ext.id}`}>
          <div className="extensions-pkg-contrib-heading">贡献诊断</div>
          {related.map(entry => (
            <DismissibleError
              key={diagnosticKey(entry)}
              message={formatDiagnostic(entry)}
              onDismiss={() => onDismiss(current => new Set(current).add(diagnosticKey(entry)))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExtensionPackageRow({
  ext,
  host,
  projectId,
  busy,
  agents,
  catalogDiagnostics,
  dismissedDiagnostics,
  onDismissDiagnostics,
  onToggle,
  onUninstall,
  packActive,
  membership,
  vision,
  visibility,
  scan,
}: {
  ext: ExtensionDescriptor
  host: PipiHostAPI
  projectId?: string
  busy: boolean
  agents: AgentDefinition[]
  catalogDiagnostics: AgentCatalogDiagnostic[]
  dismissedDiagnostics: Set<string>
  onDismissDiagnostics: (next: Set<string> | ((current: Set<string>) => Set<string>)) => void
  onToggle: (ext: ExtensionDescriptor) => void
  onUninstall: (ext: ExtensionDescriptor) => void
  packActive: boolean
  membership: 'required' | 'optional'
  vision?: VisionRoutingController
  visibility?: ModelVisibilityController
  scan?: ScanExternalSessionsController
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const enabled = ext.state === 'enabled'
  const caps = requestedCapabilities(ext)
  const settingsSchema = ext.contributions?.settings?.schema
  const declaresAuth = Boolean(ext.contributions?.auth?.provider?.id)
  const declaresSettings = Boolean(ext.contributions?.settingsSections?.length || settingsSchema)
  const hostOwnedSettings = HOST_FEATURE_SETTINGS_EXTENSION_IDS.has(ext.id)
  const canEditSettings = enabled && declaresSettings && !declaresAuth && !hostOwnedSettings && Boolean(host.getExtensionSettings && host.updateExtensionSettings)
  const canShowAuth = enabled && declaresAuth
  const l2Blocked = blocksEnableForL2(ext.source, caps)
  const errorText = readableError(ext)
  const canToggle = packActive && membership !== 'required' && !busy && ext.state !== 'error' && !(l2Blocked && !enabled)
  const sourceLabel = EXTENSION_SOURCE_LABEL[ext.source] ?? ext.source
  const stateLabel = EXTENSION_STATE_LABEL[ext.state] ?? ext.state
  const category = extensionCategory(ext)

  return (
    <div className="extensions-pkg-row" data-testid={`extensions-pkg-${ext.id}`}>
      <div className="extensions-pkg-top">
        <div className="extensions-pkg-identity">
          <div className="extensions-pkg-title-line">
            <strong>{ext.name ?? ext.id}</strong>
            <span className="extensions-pkg-category">{EXTENSION_CATEGORY_LABEL[category]}</span>
            <span className={`extensions-membership-pill ${membership}`}>{membership === 'required' ? '包必需' : '可选'}</span>
          </div>
          <div className="extensions-pkg-meta" data-testid={`extensions-pkg-meta-${ext.id}`}>
            <span>{ext.version ?? '—'}</span>
            <span>{sourceLabel}</span>
            <span className={`extensions-state-pill state-${ext.state}`}>{stateLabel}</span>
          </div>
        </div>
        <div className="extensions-pkg-actions">
          <button
            type="button"
            role="switch"
            className={`computer-use-switch${enabled ? ' enabled' : ''}`}
            aria-checked={enabled}
            aria-label={enabled ? `禁用 ${ext.name ?? ext.id}` : `启用 ${ext.name ?? ext.id}`}
            disabled={!canToggle}
            data-testid={`extensions-pkg-toggle-${ext.id}`}
            onClick={() => onToggle(ext)}
          >
            <span />
          </button>
          {ext.source !== 'builtin' && (
            <button
              type="button"
              className="model-modal-refresh"
              disabled={busy}
              data-testid={`extensions-pkg-uninstall-${ext.id}`}
              onClick={() => onUninstall(ext)}
            >
              卸载
            </button>
          )}
        </div>
      </div>
      {ext.description && (
        <p className="extensions-pkg-desc" data-testid={`extensions-pkg-desc-${ext.id}`}>{ext.description}</p>
      )}
      {canShowAuth && <ExtensionAuthCard host={host} extensionId={ext.id} />}
      {enabled && ext.id === VISION_ROUTING_EXTENSION_ID && visibility && vision && (
        <VisionRoutingPane visibility={visibility} vision={vision} />
      )}
      {enabled && ext.id === WEB_SEARCH_KEYS_EXTENSION_ID && (
        <WebSearchKeysPane host={host} projectId={projectId} />
      )}
      {enabled && ext.id === EXTERNAL_SESSION_SCAN_EXTENSION_ID && scan && (
        <ScanExternalSessionsPane scan={scan} />
      )}
      {canEditSettings && (
        <div className="extensions-pkg-settings" data-testid={`extensions-pkg-settings-${ext.id}`}>
          <button
            type="button"
            className="model-modal-refresh"
            data-testid={`extensions-pkg-settings-toggle-${ext.id}`}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
          >
            {settingsOpen ? '收起设置' : '设置'}
          </button>
          {settingsOpen && (
            <SchemaSettingsForm host={host} extensionId={ext.id} projectId={projectId} schema={settingsSchema} />
          )}
        </div>
      )}
      {caps.length > 0 && (
        <div className="extensions-badges" data-testid={`extensions-pkg-caps-${ext.id}`}>
          {caps.map(capability => (
            <span
              key={capability}
              className={`extensions-badge${blocksEnableForL2(ext.source, [capability]) ? ' l2' : ''}`}
              title={capabilityLabel(capability)}
            >
              {capability}
            </span>
          ))}
        </div>
      )}
      {l2Blocked && (
        <p className="vision-picker-hint" data-testid={`extensions-pkg-l2-${ext.id}`}>{L2_CAPABILITY_HINT}</p>
      )}
      {errorText && (
        <p className="model-modal-error" role="alert" data-testid={`extensions-pkg-error-${ext.id}`}>{errorText}</p>
      )}
      <ExtensionContributionSummary
        ext={ext}
        agents={agents}
        catalogDiagnostics={catalogDiagnostics}
        dismissed={dismissedDiagnostics}
        onDismiss={onDismissDiagnostics}
      />
    </div>
  )
}

function SkillsHub({ items }: { items: ExtensionDescriptor[] }) {
  const loader = items.find(item => item.id === 'skill-loader-extension')
  const loaderEnabled = loader?.state === 'enabled'
  return (
    <section className="extensions-skills-hub" data-testid="extensions-skills-hub">
      <div className="extensions-hub-hero">
        <span className="extensions-overview-eyebrow">按需加载的专业知识</span>
        <h3>Skills</h3>
        <p>Skill 是 Agent 在需要时加载的说明、流程和资源。它们随扩展包进入项目，不会把所有领域知识一次塞进上下文。</p>
      </div>
      <div className="extensions-hub-grid">
        <article className="extensions-hub-card">
          <span className="extensions-support-kicker">运行状态</span>
          <div className="extensions-hub-card-title">
            <h4>Skill Loader</h4>
            <span className={`extensions-state-pill state-${loaderEnabled ? 'enabled' : 'disabled'}`}>{loaderEnabled ? '已启用' : '未启用'}</span>
          </div>
          <p>由 <code>skill-loader-extension</code> 提供 Skill 搜索与按需加载。每个扩展包可以带自己的 Skill 根目录。</p>
        </article>
        <article className="extensions-hub-card extensions-hub-card-accent" data-testid="extensions-skill-create">
          <span className="extensions-support-kicker">内置创建工具</span>
          <h4>创建 PipiUI 扩展</h4>
          <p><code>create-pipiui-extension</code> Skill 可以生成扩展、Profile 和 Product Pack 骨架。</p>
          <div className="extensions-skill-prompt">在主会话里直接说：创建一个包含左栏、工具和结果卡片的扩展。</div>
        </article>
        <article className="extensions-hub-card">
          <span className="extensions-support-kicker">组织方式</span>
          <h4>Skill 跟随扩展包</h4>
          <p>启用 Coding、COC 或 ET 扩展包时，对应领域的 Skills 一起可用；关闭扩展包后不会污染其它项目。</p>
        </article>
      </div>
    </section>
  )
}

function McpHub({ servers }: { servers: UserMcpServer[] }) {
  return (
    <section className="extensions-mcp-hub" data-testid="extensions-mcp-hub">
      <div className="extensions-hub-hero">
        <span className="extensions-overview-eyebrow">外部能力</span>
        <h3>MCP 连接</h3>
        <p>PipiUI 内置 MCP 宿主；第三方服务作为当前项目的连接显示在这里。</p>
      </div>
      <div className="extensions-mcp-builtin" data-testid="extensions-builtin">
        <div data-testid="extensions-item-pi-mcp">
          <strong>pi-mcp-extension</strong>
          <span>连接外部 MCP · 1 项</span>
        </div>
        <span className="extensions-state-pill state-enabled">已内置</span>
      </div>
      <div className="extensions-user-connections" data-testid="extensions-user">
        <div className="extensions-user-connections-heading">
          <strong>项目连接</strong>
          <span>{servers.length} 项</span>
        </div>
        {servers.length === 0
          ? <p className="extensions-user-empty" data-testid="extensions-user-empty">还没有额外添加的 MCP 或 Pi 扩展。使用右上角“添加扩展”即可开始。</p>
          : (
            <div className="extensions-user-list" data-testid="extensions-user-list">
              {servers.map(server => (
                <div className="extensions-user-row" key={server.name} data-testid={`extensions-item-mcp-${server.name}`}>
                  <strong>{server.name}</strong>
                  <span>{server.transport} · {server.summary}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </section>
  )
}

function ExtensionPackagesSection({ host, projectId, servers, vision, visibility, scan }: {
  host: PipiHostAPI
  projectId?: string
  servers: UserMcpServer[]
  vision?: VisionRoutingController
  visibility?: ModelVisibilityController
  scan?: ScanExternalSessionsController
}) {
  const productWorkbench = useOptionalProductWorkbenchRuntime()
  const [items, setItems] = useState<ExtensionDescriptor[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [profiles, setProfiles] = useState<ProductProfileDescriptor[]>([])
  const [activation, setActivation] = useState<ProjectProductActivation | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [selectedView, setSelectedView] = useState<'packs' | 'skills' | 'mcp'>('packs')
  const [packsOpen, setPacksOpen] = useState(true)
  const [createPackOpen, setCreatePackOpen] = useState(false)
  const [createPackName, setCreatePackName] = useState('')
  const [memberTarget, setMemberTarget] = useState<ProductProfileDescriptor | null>(null)
  const [memberSelection, setMemberSelection] = useState<Set<string>>(() => new Set())
  const [profileBusy, setProfileBusy] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState<'export' | 'import' | null>(null)
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [grantTarget, setGrantTarget] = useState<ExtensionDescriptor | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDescriptor | null>(null)
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<Set<string>>(() => new Set())
  const [loadDiagnostics, setLoadDiagnostics] = useState<AgentCatalogDiagnostic[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ExtensionStatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<DisplayExtensionCategory | 'all'>('all')
  const resolvedProjectId = projectId || lastProjectId()
  const catalogDiagnostics = useMemo(() => collectCatalogDiagnostics(agents), [agents])
  const supportsProfiles = Boolean(resolvedProjectId && host.listProductProfiles && host.getProductProfile && host.setProductProfile)
  const packs = useMemo(() => {
    const available = profiles.filter(profile => profile.id !== 'base')
    if (available.length > 0 || supportsProfiles) return available
    return items.length > 0 ? [{
      id: 'installed-extensions',
      name: '当前扩展',
      description: '当前连接提供的全部扩展。',
      state: 'available' as const,
      source: 'builtin' as const,
      requiredExtensionIds: [],
      recommendedExtensionIds: items.map(item => item.id),
    }] : []
  }, [items, profiles, supportsProfiles])
  const selectedProfile = packs.find(profile => profile.id === selectedProfileId) ?? packs[0]
  const packExtensionIds = useMemo(() => new Set(profileExtensionIds(selectedProfile)), [selectedProfile])
  const requiredExtensionIds = useMemo(() => new Set(selectedProfile?.requiredExtensionIds ?? []), [selectedProfile])
  const packItems = useMemo(() => items.filter(item => packExtensionIds.has(item.id)), [items, packExtensionIds])
  const packActive = Boolean(selectedProfile && (selectedProfile.id === 'installed-extensions' || activation?.profile === selectedProfile.id))
  const categories = useMemo(() => {
    const grouped = new Map<DisplayExtensionCategory, ExtensionDescriptor[]>()
    for (const item of packItems) {
      const category = extensionCategory(item)
      const bucket = grouped.get(category) ?? []
      bucket.push(item)
      grouped.set(category, bucket)
    }
    return EXTENSION_CATEGORY_ORDER
      .map(category => ({ category, items: (grouped.get(category) ?? []).sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id)) }))
      .filter(group => group.items.length > 0)
  }, [packItems])
  const enabledCount = packItems.filter(item => item.state === 'enabled').length
  const filteredCategories = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return categories
      .filter(group => categoryFilter === 'all' || group.category === categoryFilter)
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          const statusMatches = statusFilter === 'all'
            || (statusFilter === 'enabled' ? item.state === 'enabled' : item.state !== 'enabled')
          if (!statusMatches) return false
          if (!needle) return true
          return [item.name, item.id, item.description, EXTENSION_CATEGORY_LABEL[group.category]]
            .some(value => value?.toLocaleLowerCase().includes(needle))
        }),
      }))
      .filter(group => group.items.length > 0)
  }, [categories, categoryFilter, query, statusFilter])
  const filteredCount = filteredCategories.reduce((total, group) => total + group.items.length, 0)
  const visibleCatalogDiagnostics = [...loadDiagnostics, ...catalogDiagnostics].filter(entry => {
    if (!isBlockingCatalogDiagnostic(entry)) return false
    if (dismissedDiagnostics.has(diagnosticKey(entry))) return false
    return !packItems.some(ext => diagnosticsForExtension(ext.id, agents, [entry]).length > 0)
  })

  const refresh = useCallback(async () => {
    const nextLoad: AgentCatalogDiagnostic[] = []
    if (!host.listExtensions) {
      setItems([])
      setAgents([])
      setLoadDiagnostics([])
      return
    }
    try {
      const listed = await (resolvedProjectId ? host.listExtensions(resolvedProjectId) : host.listExtensions())
      setItems(listed)
    } catch (error) {
      setItems([])
      nextLoad.push({
        severity: 'error',
        code: 'extensions-load-failed',
        message: redactDiagnosticMessage(`无法加载扩展列表：${error instanceof Error ? error.message : String(error)}`),
      })
    }
    if (!host.listAgentDefinitions) {
      setAgents([])
    } else {
      try {
        setAgents(await host.listAgentDefinitions(resolvedProjectId || undefined))
        setDismissedDiagnostics(new Set())
      } catch (error) {
        setAgents([])
        nextLoad.push({
          severity: 'error',
          code: 'agent-catalog-load-failed',
          message: redactDiagnosticMessage(`无法加载 Agent 目录：${error instanceof Error ? error.message : String(error)}`),
        })
      }
    }
    if (host.listProductProfiles) {
      const acceptProfiles = (nextProfiles: ProductProfileDescriptor[], nextActivation: ProjectProductActivation | null) => {
        const available = nextProfiles.filter(profile => profile.state === 'available')
        setProfiles(available)
        setActivation(nextActivation)
        setSelectedProfileId(current => {
          if (current && available.some(profile => profile.id === current && profile.id !== 'base')) return current
          const active = nextActivation
            ? available.find(profile => profile.id === nextActivation.profile && profile.id !== 'base')
            : undefined
          return active?.id ?? available.find(profile => profile.id === 'coding')?.id
            ?? available.find(profile => profile.id !== 'base')?.id
            ?? null
        })
        const active = nextActivation
          ? available.find(profile => profile.id === nextActivation.profile)
          : undefined
        if (active && nextActivation) productWorkbench?.activateProductWorkbenchProfile(active, nextActivation)
      }
      try {
        const nextProfiles = await host.listProductProfiles(resolvedProjectId || undefined)
        const nextActivation = resolvedProjectId && host.getProductProfile
          ? await host.getProductProfile(resolvedProjectId)
          : null
        acceptProfiles(nextProfiles, nextActivation)
      } catch (error) {
        try {
          acceptProfiles(await host.listProductProfiles(), null)
        } catch (fallbackError) {
          setProfiles([])
          setActivation(null)
          nextLoad.push({
            severity: 'error',
            code: 'extension-packs-load-failed',
            message: redactDiagnosticMessage(`无法加载扩展包：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`),
          })
        }
      }
    }
    setLoadDiagnostics(nextLoad)
  }, [host, productWorkbench, resolvedProjectId])

  useEffect(() => { void refresh() }, [refresh])

  const choosePack = (profile: ProductProfileDescriptor) => {
    setSelectedProfileId(profile.id)
    setSelectedView('packs')
    setCategoryFilter('all')
    setQuery('')
  }

  const setPackActive = async (profile: ProductProfileDescriptor, enabled: boolean) => {
    if (!resolvedProjectId || !host.setProductProfile || profile.id === 'installed-extensions') return
    setProfileBusy(profile.id)
    setProfileError(null)
    try {
      const targetId = enabled ? profile.id : 'base'
      const next = await host.setProductProfile(resolvedProjectId, targetId)
      setActivation(next)
      const target = profiles.find(candidate => candidate.id === targetId)
      if (target) productWorkbench?.activateProductWorkbenchProfile(target, next)
      await refresh()
    } catch (error) {
      setProfileError(`扩展包切换失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const openMemberEditor = (profile: ProductProfileDescriptor) => {
    setMemberTarget(profile)
    setMemberSelection(new Set(profile.recommendedExtensionIds ?? []))
  }

  const createPack = async () => {
    if (!resolvedProjectId || !host.createProductProfile) return
    setProfileBusy('create-pack')
    setProfileError(null)
    try {
      const created = await host.createProductProfile(resolvedProjectId, createPackName)
      setCreatePackOpen(false)
      setCreatePackName('')
      setSelectedProfileId(created.id)
      setSelectedView('packs')
      openMemberEditor(created)
      await refresh()
    } catch (error) {
      setProfileError(`创建扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const savePackMembers = async () => {
    if (!resolvedProjectId || !memberTarget || !host.updateProductProfileExtensions) return
    setProfileBusy(`members:${memberTarget.id}`)
    setProfileError(null)
    try {
      await host.updateProductProfileExtensions(resolvedProjectId, memberTarget.id, [...memberSelection])
      setMemberTarget(null)
      await refresh()
    } catch (error) {
      setProfileError(`保存扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setProfileBusy(null)
    }
  }

  const exportPack = async (profile: ProductProfileDescriptor) => {
    if (!resolvedProjectId || !host.saveProductPackArchive || !host.exportProductPackArchive) return
    setArchiveBusy('export')
    setProfileError(null)
    setArchiveNotice(null)
    try {
      const destination = await host.saveProductPackArchive(`${profile.id}.pipiui-pack.zip`)
      if (!destination) return
      const result = await host.exportProductPackArchive(resolvedProjectId, profile.id, destination)
      const filename = result.archivePath.split(/[\\/]/).pop() ?? result.archivePath
      setArchiveNotice(`已导出 ${profileDisplayName(profile)} 扩展包：${filename}`)
    } catch (error) {
      setProfileError(`导出扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setArchiveBusy(null)
    }
  }

  const importPack = async () => {
    if (!resolvedProjectId || !host.pickProductPackArchive || !host.installProductPackArchive) return
    setArchiveBusy('import')
    setProfileError(null)
    setArchiveNotice(null)
    try {
      const source = await host.pickProductPackArchive()
      if (!source) return
      const next = await host.installProductPackArchive(resolvedProjectId, source)
      setActivation(next)
      setSelectedProfileId(next.profile)
      setSelectedView('packs')
      await refresh()
      setArchiveNotice('扩展包已加载并应用到当前项目。新会话会使用这个扩展包。')
    } catch (error) {
      setProfileError(`加载扩展包失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setArchiveBusy(null)
    }
  }

  const applyEnable = async (ext: ExtensionDescriptor, enabled: boolean) => {
    if (!host.setExtensionEnabled) return
    setBusyId(ext.id)
    try {
      if (resolvedProjectId) await host.setExtensionEnabled(ext.id, enabled, 'project', resolvedProjectId)
      else await host.setExtensionEnabled(ext.id, enabled, 'project')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const onToggle = async (ext: ExtensionDescriptor) => {
    if (ext.state === 'enabled') {
      await applyEnable(ext, false)
      return
    }
    const requested = requestedCapabilities(ext)
    if (blocksEnableForL2(ext.source, requested)) return
    let granted = ext.grantedCapabilities
    if (granted === undefined && host.getCapabilityGrant) {
      try {
        granted = (await host.getCapabilityGrant(ext.id)).capabilities
      } catch {
        granted = []
      }
    }
    if (grantNeedsConfirmation(requested, granted ?? [])) {
      setGrantTarget(ext)
      return
    }
    await applyEnable(ext, true)
  }

  const confirmGrant = async () => {
    const ext = grantTarget
    if (!ext) return
    const requested = requestedCapabilities(ext)
    setGrantTarget(null)
    setBusyId(ext.id)
    try {
      await host.confirmCapabilityGrant?.(ext.id, requested)
      if (resolvedProjectId) await host.setExtensionEnabled?.(ext.id, true, 'project', resolvedProjectId)
      else await host.setExtensionEnabled?.(ext.id, true, 'project')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const confirmUninstall = async () => {
    const ext = uninstallTarget
    if (!ext) return
    setUninstallTarget(null)
    setBusyId(ext.id)
    try {
      await host.uninstallExtension?.(ext.id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="extensions-library" data-testid="extensions-packages">
      <div className="extensions-library-shell">
        <aside className="extensions-pack-sidebar">
          <button
            type="button"
            className="extensions-pack-dropdown"
            aria-expanded={packsOpen}
            data-testid="extensions-pack-dropdown"
            onClick={() => setPacksOpen(open => !open)}
          >
            <span>扩展包</span>
            <span aria-hidden="true">{packsOpen ? '▾' : '▸'}</span>
          </button>
          {packsOpen && (
            <div className="extensions-pack-list" data-testid="extensions-pack-list">
              {packs.map(profile => {
                const active = activation?.profile === profile.id || profile.id === 'installed-extensions'
                const selected = selectedView === 'packs' && selectedProfile?.id === profile.id
                return (
                  <div key={profile.id} className={`extensions-pack-item${selected ? ' selected' : ''}`} data-testid={`extensions-pack-${profile.id}`}>
                    <button type="button" className="extensions-pack-select" onClick={() => choosePack(profile)}>
                      <strong>{profileDisplayName(profile)}</strong>
                      <span>{profile.customizable ? '自定义' : '内置'} · {profileExtensionIds(profile).length} 个扩展</span>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      className={`computer-use-switch extensions-pack-switch${active ? ' enabled' : ''}`}
                      aria-checked={active}
                      aria-label={active ? `关闭 ${profileDisplayName(profile)} 扩展包` : `启用 ${profileDisplayName(profile)} 扩展包`}
                      disabled={profileBusy !== null || profile.id === 'installed-extensions' || !host.setProductProfile || !activation}
                      data-testid={`extensions-pack-toggle-${profile.id}`}
                      onClick={() => void setPackActive(profile, !active)}
                    ><span /></button>
                  </div>
                )
              })}
              {host.createProductProfile && resolvedProjectId && (
                <button type="button" className="extensions-pack-create" disabled={!activation || profileBusy !== null} title={!activation ? '先选择一个有效项目' : undefined} data-testid="extensions-pack-create" onClick={() => setCreatePackOpen(true)}>＋ 新建扩展包</button>
              )}
              {host.pickProductPackArchive && host.installProductPackArchive && resolvedProjectId && (
                <button type="button" className="extensions-pack-import" disabled={archiveBusy !== null || profileBusy !== null} data-testid="extensions-pack-import" onClick={() => void importPack()}>{archiveBusy === 'import' ? '正在加载…' : '加载 ZIP'}</button>
              )}
            </div>
          )}
          <div className="extensions-pack-sidebar-divider" />
          <div className="extensions-pack-sidebar-heading">能力</div>
          <button
            type="button"
            className={`extensions-capability-nav${selectedView === 'skills' ? ' active' : ''}`}
            data-testid="extensions-nav-skills"
            onClick={() => setSelectedView('skills')}
          >
            <strong>Skills</strong>
            <span>按需知识与创建工具</span>
          </button>
          <button
            type="button"
            className={`extensions-capability-nav${selectedView === 'mcp' ? ' active' : ''}`}
            data-testid="extensions-nav-mcp"
            onClick={() => setSelectedView('mcp')}
          >
            <strong>MCP 连接</strong>
            <span>{servers.length} 个项目连接</span>
          </button>
        </aside>
        <div className="extensions-library-content">
          {profileError && <DismissibleError message={profileError} onDismiss={() => setProfileError(null)} />}
          {archiveNotice && <div className="extensions-archive-notice" data-testid="extensions-archive-notice"><span>{archiveNotice}</span><button type="button" aria-label="关闭扩展包提示" onClick={() => setArchiveNotice(null)}>×</button></div>}
          {visibleCatalogDiagnostics.length > 0 && (
            <div className="extensions-catalog-diagnostics" data-testid="extensions-catalog-diagnostics">
              {visibleCatalogDiagnostics.map(entry => (
                <DismissibleError
                  key={diagnosticKey(entry)}
                  message={formatDiagnostic(entry)}
                  onDismiss={() => setDismissedDiagnostics(current => new Set(current).add(diagnosticKey(entry)))}
                />
              ))}
            </div>
          )}
          {selectedView === 'skills' ? <SkillsHub items={items} /> : selectedView === 'mcp' ? <McpHub servers={servers} /> : selectedProfile ? (
            <>
              <div className="extensions-pack-detail">
                <div className="extensions-pack-detail-copy">
                  <span className="extensions-overview-eyebrow">{selectedProfile.customizable ? '项目自定义扩展包' : '产品扩展包'}</span>
                  <h3>{profileDisplayName(selectedProfile)} 扩展包</h3>
                  <p>{selectedProfile.description ?? '组合当前产品所需的界面、工具和运行时扩展。'}</p>
                  <div className="extensions-pack-detail-actions">
                    {host.saveProductPackArchive && host.exportProductPackArchive && (
                      <button type="button" className="model-modal-refresh" disabled={archiveBusy !== null || profileBusy !== null} data-testid="extensions-pack-export" onClick={() => void exportPack(selectedProfile)}>{archiveBusy === 'export' ? '正在导出…' : '导出 ZIP'}</button>
                    )}
                    {selectedProfile.customizable && host.updateProductProfileExtensions && (
                      <button
                        type="button"
                        className="model-modal-refresh"
                        disabled={packActive || profileBusy !== null}
                        title={packActive ? '先关闭扩展包，再修改包内扩展' : '选择这个扩展包包含的扩展'}
                        data-testid="extensions-pack-edit-members"
                        onClick={() => openMemberEditor(selectedProfile)}
                      >管理包内扩展</button>
                    )}
                    {!packActive && <span className="extensions-pack-inactive-note">{activation ? '启用后可在下方调整个别扩展' : '选择项目后可以启用和编辑扩展包'}</span>}
                  </div>
                </div>
                <div className="extensions-pack-master">
                  <span>{packActive ? '整包已启用' : '整包未启用'}</span>
                  <button
                    type="button"
                    role="switch"
                    className={`computer-use-switch extensions-pack-master-switch${packActive ? ' enabled' : ''}`}
                    aria-checked={packActive}
                    aria-label={packActive ? `关闭 ${profileDisplayName(selectedProfile)} 扩展包` : `启用 ${profileDisplayName(selectedProfile)} 扩展包`}
                    disabled={profileBusy !== null || selectedProfile.id === 'installed-extensions' || !host.setProductProfile || !activation}
                    data-testid="extensions-pack-master-toggle"
                    onClick={() => void setPackActive(selectedProfile, !packActive)}
                  ><span /></button>
                </div>
                <dl className="extensions-overview-stats" aria-label="扩展包概览">
                  <div data-testid="extensions-stat-total"><dt>包内扩展</dt><dd>{packItems.length}</dd></div>
                  <div data-testid="extensions-stat-enabled"><dt>当前运行</dt><dd>{enabledCount}</dd></div>
                  <div data-testid="extensions-stat-categories"><dt>分类</dt><dd>{categories.length}</dd></div>
                  <div data-testid="extensions-stat-connections"><dt>必需扩展</dt><dd>{requiredExtensionIds.size}</dd></div>
                </dl>
              </div>
              <div className="extensions-library-toolbar">
                <label className="extensions-search">
                  <input
                    type="search"
                    value={query}
                    aria-label="搜索扩展"
                    placeholder="搜索包内扩展"
                    data-testid="extensions-search"
                    onChange={event => setQuery(event.target.value)}
                  />
                </label>
                <div className="extensions-status-filters" role="group" aria-label="扩展状态">
                  {EXTENSION_STATUS_FILTERS.map(filter => (
                    <button
                      key={filter.id}
                      type="button"
                      className={statusFilter === filter.id ? 'active' : ''}
                      aria-pressed={statusFilter === filter.id}
                      data-testid={`extensions-status-filter-${filter.id}`}
                      onClick={() => setStatusFilter(filter.id)}
                    >{filter.label}</button>
                  ))}
                </div>
              </div>
              <div className="extensions-category-filters" role="group" aria-label="扩展分类">
                <button
                  type="button"
                  className={categoryFilter === 'all' ? 'active' : ''}
                  aria-pressed={categoryFilter === 'all'}
                  data-testid="extensions-category-filter-all"
                  onClick={() => setCategoryFilter('all')}
                >全部 <span>{packItems.length}</span></button>
                {categories.map(group => (
                  <button
                    key={group.category}
                    type="button"
                    className={categoryFilter === group.category ? 'active' : ''}
                    aria-pressed={categoryFilter === group.category}
                    data-testid={`extensions-category-filter-${group.category}`}
                    onClick={() => setCategoryFilter(group.category)}
                  >{EXTENSION_CATEGORY_LABEL[group.category]} <span>{group.items.length}</span></button>
                ))}
              </div>
              <div className="extensions-results-summary" aria-live="polite">
                <strong>{categoryFilter === 'all' ? '包内扩展' : EXTENSION_CATEGORY_LABEL[categoryFilter]}</strong>
                <span>显示 {filteredCount} / {packItems.length} 项</span>
              </div>
              {packItems.length === 0
                ? <div className="extensions-filter-empty" data-testid="extensions-packages-empty">这个扩展包还没有可选扩展。{selectedProfile.customizable ? '点击“管理包内扩展”添加。' : ''}</div>
                : filteredCount === 0
                  ? <div className="extensions-filter-empty" data-testid="extensions-filter-empty">没有符合当前分类或筛选条件的扩展。</div>
                  : (
                    <div className="extensions-categories" data-testid="extensions-packages-list">
                      {filteredCategories.map(group => (
                        <section key={group.category} className="extensions-category" data-testid={`extensions-category-${group.category}`}>
                          <header className="extensions-category-header">
                            <div>
                              <h4>{EXTENSION_CATEGORY_LABEL[group.category]}</h4>
                              <p>{EXTENSION_CATEGORY_DESCRIPTION[group.category]}</p>
                            </div>
                            <span>{group.items.length} 项</span>
                          </header>
                          <div className="extensions-category-items">
                            {group.items.map(ext => (
                              <ExtensionPackageRow
                                key={ext.id}
                                ext={ext}
                                host={host}
                                projectId={resolvedProjectId}
                                busy={busyId === ext.id}
                                agents={agents}
                                catalogDiagnostics={catalogDiagnostics}
                                dismissedDiagnostics={dismissedDiagnostics}
                                onDismissDiagnostics={setDismissedDiagnostics}
                                onToggle={ext => { void onToggle(ext) }}
                                onUninstall={setUninstallTarget}
                                packActive={packActive}
                                membership={requiredExtensionIds.has(ext.id) ? 'required' : 'optional'}
                                vision={vision}
                                visibility={visibility}
                                scan={scan}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
            </>
          ) : (
            <div className="extensions-filter-empty" data-testid="extensions-packs-empty">还没有可用扩展包。点击左侧“新建扩展包”创建一个。</div>
          )}
        </div>
      </div>
      {createPackOpen && (
        <ConfirmDialog
          testId="extensions-pack-create-dialog"
          title="新建扩展包"
          confirmLabel={profileBusy === 'create-pack' ? '创建中…' : '创建并选择扩展'}
          confirmTestId="extensions-pack-create-confirm"
          cancelTestId="extensions-pack-create-cancel"
          confirmDisabled={!createPackName.trim() || profileBusy !== null}
          onConfirm={() => { void createPack() }}
          onCancel={() => { setCreatePackOpen(false); setCreatePackName('') }}
        >
          <p>给扩展包起一个容易识别的名字。它只保存在当前项目里，默认使用基础工作台。</p>
          <label className="extensions-pack-name-field">
            <span>扩展包名称</span>
            <input autoFocus value={createPackName} maxLength={80} data-testid="extensions-pack-name" onChange={event => setCreatePackName(event.target.value)} />
          </label>
        </ConfirmDialog>
      )}
      {memberTarget && (
        <ConfirmDialog
          testId="extensions-pack-members-dialog"
          title={`管理 ${profileDisplayName(memberTarget)} 的扩展`}
          confirmLabel={profileBusy === `members:${memberTarget.id}` ? '保存中…' : '保存扩展包'}
          confirmTestId="extensions-pack-members-confirm"
          cancelTestId="extensions-pack-members-cancel"
          confirmDisabled={profileBusy !== null}
          onConfirm={() => { void savePackMembers() }}
          onCancel={() => setMemberTarget(null)}
        >
          <p>勾选要放进这个扩展包的扩展。Skill Loader 是基础能力，会始终保留。</p>
          <div className="extensions-pack-member-list" data-testid="extensions-pack-member-list">
            {items.filter(item => !(memberTarget.requiredExtensionIds ?? []).includes(item.id)).map(item => (
              <label key={item.id} className="extensions-pack-member-row">
                <input
                  type="checkbox"
                  checked={memberSelection.has(item.id)}
                  onChange={event => setMemberSelection(current => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(item.id)
                    else next.delete(item.id)
                    return next
                  })}
                />
                <span><strong>{item.name ?? item.id}</strong><small>{EXTENSION_CATEGORY_LABEL[extensionCategory(item)]} · {item.id}</small></span>
              </label>
            ))}
          </div>
        </ConfirmDialog>
      )}
      {grantTarget && (
        <ConfirmDialog
          testId="extensions-grant-dialog"
          title={`授权 ${grantTarget.name ?? grantTarget.id}`}
          confirmLabel="确认并启用"
          confirmTestId="extensions-grant-confirm"
          cancelTestId="extensions-grant-cancel"
          onConfirm={() => { void confirmGrant() }}
          onCancel={() => setGrantTarget(null)}
        >
          <p>此扩展请求以下能力。确认后才会启用。</p>
          <ul className="extensions-grant-list" data-testid="extensions-grant-list">
            {requestedCapabilities(grantTarget).map(capability => (
              <li key={capability}>
                <code>{capability}</code>
                <span>{capabilityLabel(capability)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
      {uninstallTarget && (
        <ConfirmDialog
          testId="extensions-uninstall-dialog"
          title={`卸载 ${uninstallTarget.name ?? uninstallTarget.id}`}
          confirmLabel="确认卸载"
          confirmTestId="extensions-uninstall-confirm"
          cancelTestId="extensions-uninstall-cancel"
          onConfirm={() => { void confirmUninstall() }}
          onCancel={() => setUninstallTarget(null)}
        >
          <p>卸载后将删除该扩展包，其界面贡献会立即消失。内置扩展不能卸载。</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

export function ExtensionsPane({
  addOpen,
  onCloseAdd,
  host,
  projectId,
  vision,
  visibility,
  scan,
}: {
  addOpen: boolean
  onCloseAdd: () => void
  host?: PipiHostAPI
  projectId?: string
  vision?: VisionRoutingController
  visibility?: ModelVisibilityController
  scan?: ScanExternalSessionsController
}) {
  const [servers, setServers] = useState<UserMcpServer[]>([])
  const resolvedHost = host ?? hostFromWindow()

  useEffect(() => {
    let cancelled = false
    void loadUserMcpServers(resolvedHost, projectId).then(rows => {
      if (!cancelled) setServers(rows)
    }).catch(() => {
      if (!cancelled) setServers([])
    })
    return () => { cancelled = true }
  }, [resolvedHost, projectId])

  return (
    <div className="extensions-pane" data-testid="extensions-pane">
      {resolvedHost?.listExtensions
        ? <ExtensionPackagesSection host={resolvedHost} projectId={projectId} servers={servers} vision={vision} visibility={visibility} scan={scan} />
        : <McpHub servers={servers} />}
      {addOpen && <ExtensionsAddDialog onClose={onCloseAdd} />}
    </div>
  )
}

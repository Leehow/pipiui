import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentCatalogDiagnostic, AgentDefinition, ExtensionDescriptor, PipiHostAPI, UserMcpServer } from '@pipi/host-api'
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

const LAST_SESSION_STORAGE_KEY = 'pipiui:eui:last-session:v1'

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
}: {
  testId: string
  title: string
  children: ReactNode
  confirmLabel: string
  confirmTestId: string
  cancelTestId: string
  onConfirm: () => void
  onCancel: () => void
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
            <button type="button" className="model-modal-add" data-testid={confirmTestId} onClick={onConfirm}>{confirmLabel}</button>
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
  const canToggle = !busy && ext.state !== 'error' && !(l2Blocked && !enabled)
  const sourceLabel = EXTENSION_SOURCE_LABEL[ext.source] ?? ext.source
  const stateLabel = EXTENSION_STATE_LABEL[ext.state] ?? ext.state

  return (
    <div className="extensions-pkg-row" data-testid={`extensions-pkg-${ext.id}`}>
      <div className="extensions-pkg-top">
        <div className="update-center-name">
          <strong>{ext.name ?? ext.id}</strong>
          <span data-testid={`extensions-pkg-meta-${ext.id}`}>{ext.version ?? '—'} · {sourceLabel} · {stateLabel}</span>
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

function ExtensionPackagesSection({ host, projectId, vision, visibility, scan }: {
  host: PipiHostAPI
  projectId?: string
  vision?: VisionRoutingController
  visibility?: ModelVisibilityController
  scan?: ScanExternalSessionsController
}) {
  const [items, setItems] = useState<ExtensionDescriptor[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [grantTarget, setGrantTarget] = useState<ExtensionDescriptor | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionDescriptor | null>(null)
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<Set<string>>(() => new Set())
  const [loadDiagnostics, setLoadDiagnostics] = useState<AgentCatalogDiagnostic[]>([])
  const resolvedProjectId = projectId || lastProjectId()
  const catalogDiagnostics = useMemo(() => collectCatalogDiagnostics(agents), [agents])
  const visibleCatalogDiagnostics = [...loadDiagnostics, ...catalogDiagnostics].filter(entry => {
    if (!isBlockingCatalogDiagnostic(entry)) return false
    if (dismissedDiagnostics.has(diagnosticKey(entry))) return false
    return !items.some(ext => diagnosticsForExtension(ext.id, agents, [entry]).length > 0)
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
      setLoadDiagnostics(nextLoad)
      return
    }
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
    setLoadDiagnostics(nextLoad)
  }, [host, resolvedProjectId])

  useEffect(() => { void refresh() }, [refresh])

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
    <section className="update-center-group" data-testid="extensions-packages">
      <header className="update-center-group-header">
        <div>
          <h3>扩展包</h3>
          <p>启用、禁用或卸载已扫描到的扩展。启用作用于当前项目。</p>
        </div>
        {items.length > 0 && <span>{items.length} 项</span>}
      </header>
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
      {items.length === 0
        ? <div className="model-modal-state" data-testid="extensions-packages-empty">还没有扫描到扩展包。</div>
        : (
          <div className="update-center-group-items" data-testid="extensions-packages-list">
            {items.map(ext => (
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
                vision={vision}
                visibility={visibility}
                scan={scan}
              />
            ))}
          </div>
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
      {resolvedHost?.listExtensions && <ExtensionPackagesSection host={resolvedHost} projectId={projectId} vision={vision} visibility={visibility} scan={scan} />}
      <section className="update-center-group" data-testid="extensions-builtin">
        <header className="update-center-group-header">
          <div>
            <h3>已内置</h3>
            <p>PipiUI 会话会加载 Pi 的 MCP 扩展，用来连接外部 MCP 服务。</p>
          </div>
          <span>1 项</span>
        </header>
        <div className="update-center-group-items">
          <div className="update-center-row" data-testid="extensions-item-pi-mcp">
            <div className="update-center-name">
              <strong>pi-mcp-extension</strong>
              <span>连接外部 MCP</span>
            </div>
            <span className="update-center-status upToDate">已内置</span>
          </div>
        </div>
      </section>
      <section className="update-center-group" data-testid="extensions-user">
        <header className="update-center-group-header">
          <div>
            <h3>你添加的</h3>
            <p>外部 MCP 服务和第三方 Pi 扩展。点右上角添加，复制一句话到主界面即可。</p>
          </div>
          {servers.length > 0 && <span>{servers.length} 项</span>}
        </header>
        {servers.length === 0
          ? <div className="model-modal-state" data-testid="extensions-user-empty">还没有额外添加的 MCP 或 Pi 扩展。</div>
          : (
            <div className="update-center-group-items" data-testid="extensions-user-list">
              {servers.map(server => (
                <div className="update-center-row" key={server.name} data-testid={`extensions-item-mcp-${server.name}`}>
                  <div className="update-center-name">
                    <strong>{server.name}</strong>
                    <span>{server.transport} · {server.summary}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
      {addOpen && <ExtensionsAddDialog onClose={onCloseAdd} />}
    </div>
  )
}

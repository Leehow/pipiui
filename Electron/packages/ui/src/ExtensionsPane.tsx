import { useEffect, useState } from 'react'
import type { PipiHostAPI, UserMcpServer } from '@pipi/host-api'
import { MCP_ADD_PROMPT, PI_EXTENSION_ADD_PROMPT } from './extension-add-copy'

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

async function loadUserMcpServers(host: PipiHostAPI | undefined): Promise<UserMcpServer[]> {
  if (!host?.listUserMcpServers) return []
  let projectId = lastProjectId()
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

const PADDLEOCR_APPLY_URL = 'https://aistudio.baidu.com/account/accessToken'

function PaddleOcrBuiltinRow({ host, projectId }: { host?: PipiHostAPI; projectId?: string }) {
  const [draft, setDraft] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedHost = host ?? hostFromWindow()
  const available = Boolean(resolvedHost?.getPaddleOcrStatus && resolvedHost?.setPaddleOcrAccessToken)

  const refresh = async () => {
    if (!resolvedHost?.getPaddleOcrStatus || !projectId) {
      setHasKey(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const status = await resolvedHost.getPaddleOcrStatus(projectId)
      setHasKey(Boolean(status?.hasKey))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [projectId, resolvedHost])

  const save = async (next: string | null) => {
    if (!resolvedHost?.setPaddleOcrAccessToken || !projectId) return
    setSaving(true)
    try {
      const status = await resolvedHost.setPaddleOcrAccessToken(projectId, next)
      setHasKey(Boolean(status?.hasKey))
      setDraft('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="update-center-row" data-testid="extensions-item-paddleocr" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div className="update-center-name">
          <strong>PaddleOCR-VL-1.6</strong>
          <span>扫描 PDF / 图片页 OCR（uvx paddleocr-mcp）</span>
        </div>
        <span className="update-center-status upToDate" data-testid="paddleocr-builtin-status">已内置</span>
      </div>
      {!available ? (
        <p className="vision-picker-hint" data-testid="paddleocr-unsupported">当前连接不支持 PaddleOCR Token 设置。</p>
      ) : (
        <>
          {loading ? <p className="vision-picker-hint" data-testid="paddleocr-loading">正在读取配置…</p> : (
            <p className="vision-picker-hint" data-testid="paddleocr-status">{hasKey ? '已配置 Token' : '尚未配置 Token'}</p>
          )}
          {error && (
            <div className="model-modal-error" role="alert" data-testid="paddleocr-error">
              <span>{error}</span>
              <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="paddleocr-error-close" onClick={() => setError(null)}>×</button>
            </div>
          )}
          <label className="vision-model-select-row" style={{ display: 'flex', flexDirection: 'column', gap: 5, color: 'var(--muted)', fontSize: 11 }}>
            <span>AI Studio Access Token</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasKey ? '输入新 Token 以替换' : '粘贴 Access Token'}
              value={draft}
              disabled={!projectId || saving}
              data-testid="paddleocr-token-input"
              onChange={event => setDraft(event.target.value)}
              style={{ width: '100%', padding: '5px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', background: 'var(--surface-input)', fontSize: 11 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="model-modal-add" disabled={!projectId || saving || !draft.trim()} data-testid="paddleocr-save" onClick={() => void save(draft)}>保存</button>
            <button type="button" className="model-modal-refresh" disabled={!projectId || saving || !hasKey} data-testid="paddleocr-clear" onClick={() => void save(null)}>清除</button>
            <button type="button" className="model-modal-refresh" data-testid="paddleocr-apply" onClick={() => void resolvedHost?.openExternal?.(PADDLEOCR_APPLY_URL)}>申请 Key</button>
          </div>
        </>
      )}
    </div>
  )
}

export function ExtensionsPane({ addOpen, onCloseAdd, host, projectId }: { addOpen: boolean; onCloseAdd: () => void; host?: PipiHostAPI; projectId?: string }) {
  const [servers, setServers] = useState<UserMcpServer[]>([])

  useEffect(() => {
    let cancelled = false
    void loadUserMcpServers(host ?? hostFromWindow()).then(rows => {
      if (!cancelled) setServers(rows)
    }).catch(() => {
      if (!cancelled) setServers([])
    })
    return () => { cancelled = true }
  }, [host])

  return (
    <div className="extensions-pane" data-testid="extensions-pane">
      <section className="update-center-group" data-testid="extensions-builtin">
        <header className="update-center-group-header">
          <div>
            <h3>已内置</h3>
            <p>PipiUI 会话会加载 Pi 的 MCP 扩展，用来连接外部 MCP 服务。</p>
          </div>
          <span>2 项</span>
        </header>
        <div className="update-center-group-items">
          <div className="update-center-row" data-testid="extensions-item-pi-mcp">
            <div className="update-center-name">
              <strong>pi-mcp-extension</strong>
              <span>连接外部 MCP</span>
            </div>
            <span className="update-center-status upToDate">已内置</span>
          </div>
          <PaddleOcrBuiltinRow host={host} projectId={projectId ?? lastProjectId()} />
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

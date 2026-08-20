import { useEffect, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'

function hostFromWindow(): PipiHostAPI | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { pipiHost?: PipiHostAPI }).pipiHost
}

type ProviderDef = {
  id: string           // provider id (matches web-search.json field without ApiKey suffix)
  name: string         // display name
  keyField: string     // e.g. "exaApiKey"
  note: string         // short description
}

const PROVIDERS: ProviderDef[] = [
  { id: 'exa', name: 'Exa', keyField: 'exaApiKey', note: '可选（无密钥走公开 MCP，有限免费额度）' },
  { id: 'openai', name: 'OpenAI', keyField: 'openaiApiKey', note: '需凭证（或用 Pi 模型注册）' },
  { id: 'brave', name: 'Brave', keyField: 'braveApiKey', note: '需密钥' },
  { id: 'parallel', name: 'Parallel', keyField: 'parallelApiKey', note: '需密钥' },
  { id: 'tinyfish', name: 'TinyFish', keyField: 'tinyfishApiKey', note: '需密钥' },
  { id: 'search1api', name: 'Search1API', keyField: 'search1apiApiKey', note: '需密钥' },
  { id: 'searchinfinity', name: 'SearchInfinity', keyField: 'searchinfinityApiKey', note: '需密钥' },
  { id: 'querit', name: 'Querit', keyField: 'queritApiKey', note: '需密钥' },
  { id: 'tavily', name: 'Tavily', keyField: 'tavilyApiKey', note: '需密钥' },
  { id: 'firecrawl', name: 'Firecrawl', keyField: 'firecrawlApiKey', note: '需实例 URL（firecrawlBaseUrl），密钥可选' },
  { id: 'jina', name: 'Jina', keyField: 'jinaApiKey', note: '需密钥' },
  { id: 'serpdive', name: 'SerpDive', keyField: 'serpdiveApiKey', note: '需密钥（默认 krill 免费层）' },
  { id: 'kagi', name: 'Kagi', keyField: 'kagiApiKey', note: '需密钥' },
  { id: 'bocha', name: 'Bocha', keyField: 'bochaApiKey', note: '需密钥' },
  { id: 'ollama', name: 'Ollama', keyField: 'ollamaApiKey', note: '需密钥（ollama.com，非本地）' },
  { id: 'perplexity', name: 'Perplexity', keyField: 'perplexityApiKey', note: '需密钥' },
  { id: 'gemini', name: 'Gemini', keyField: 'geminiApiKey', note: '多路径（API Key / Cloudflare 网关 / 浏览器 Cookie）' },
  { id: 'anysearch', name: 'AnySearch', keyField: 'anysearchApiKey', note: '可选（仅显式选用）' },
  { id: 'xai', name: 'xAI', keyField: 'xaiApiKey', note: '需凭证' },
  { id: 'brightdata', name: 'Bright Data', keyField: 'brightdataApiKey', note: '需密钥（仅显式选用）' },
  { id: 'serpbase', name: 'SerpBase', keyField: 'serpbaseApiKey', note: '需密钥（仅显式选用）' },
]

const HINT_TEXT = '填写服务 API Key 后，Pi 会优先用该服务联网搜索；已填写密钥的服务会被排在搜索路由最前面优先使用。部分服务不填也能用：Exa 默认走公开 MCP（有限免费额度）。SerpDive 仍需密钥，但默认 krill 模型为厂商免费层。当免费额度用尽或限流（例如 Exa MCP 返回 429）时，Pi 会按搜索路由自动切换到下一个已配置的服务；而需要密钥的服务（Brave、Tavily、Kagi 等）若不填，则不会被选用。xAI 等需在配置里显式选用，不会悄悄进入自动路由。'

export function WebSearchKeysPane({ host, projectId }: { host?: PipiHostAPI; projectId?: string }) {
  const resolvedHost = host ?? hostFromWindow()
  const available = Boolean(resolvedHost?.getWebSearchKeys && resolvedHost?.setWebSearchKeys)

  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!resolvedHost?.getWebSearchKeys || !projectId) {
      setSavedKeys({})
      setDrafts({})
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const keys = await resolvedHost.getWebSearchKeys(projectId)
      setSavedKeys(keys)
      setDrafts({})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [projectId, resolvedHost])

  const hasKey = (keyField: string): boolean => {
    return Boolean(savedKeys[keyField])
  }

  const draftValue = (keyField: string): string => {
    if (Object.prototype.hasOwnProperty.call(drafts, keyField)) return drafts[keyField]
    return ''
  }

  const setDraft = (keyField: string, value: string) => {
    setDrafts(prev => ({ ...prev, [keyField]: value }))
  }

  const hasChanges = PROVIDERS.some(p => {
    const d = draftValue(p.keyField)
    // Changed if draft is non-empty (new value), or if draft is explicitly empty string + previously had a key (clear)
    if (d) return true
    if (Object.prototype.hasOwnProperty.call(drafts, p.keyField) && d === '' && hasKey(p.keyField)) return true
    return false
  })

  const saveAll = async () => {
    if (!resolvedHost?.setWebSearchKeys || !projectId) return
    setSaving(true)
    try {
      const toSave: Record<string, string> = {}
      for (const p of PROVIDERS) {
        if (Object.prototype.hasOwnProperty.call(drafts, p.keyField)) {
          toSave[p.keyField] = drafts[p.keyField].trim()
        }
      }
      const result = await resolvedHost.setWebSearchKeys(projectId, toSave)
      setSavedKeys(Object.fromEntries(result.map(f => [f, true])))
      setDrafts({})
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const resetAll = () => {
    setDrafts({})
    setError(null)
  }

  return (
    <div className="vision-picker" data-testid="web-search-keys-pane">
      <div className="web-search-keys-header">
        <strong>Web 搜索密钥 / Web Search Keys</strong>
        <p className="vision-picker-hint" style={{ marginTop: 4, marginBottom: 0 }}>{HINT_TEXT}</p>
      </div>

      {!available ? (
        <p className="vision-picker-hint" data-testid="web-search-keys-unsupported" style={{ marginTop: 10 }}>当前连接不支持 Web 搜索密钥设置。</p>
      ) : loading ? (
        <p className="vision-picker-hint" data-testid="web-search-keys-loading" style={{ marginTop: 10 }}>正在读取配置…</p>
      ) : (
        <>
          {error && (
            <div className="model-modal-error" role="alert" data-testid="web-search-keys-error" style={{ marginTop: 10 }}>
              <span>{error}</span>
              <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="web-search-keys-error-close" onClick={() => setError(null)}>×</button>
            </div>
          )}

          <div className="web-search-keys-list" data-testid="web-search-keys-list">
            {PROVIDERS.map(p => {
              const keySet = hasKey(p.keyField)
              const draft = draftValue(p.keyField)
              const showDraft = Object.prototype.hasOwnProperty.call(drafts, p.keyField)
              return (
                <label key={p.id} className="web-search-key-row" data-testid={`web-search-key-row-${p.id}`}>
                  <div className="web-search-key-info">
                    <span className="web-search-key-name">{p.name}</span>
                    <span className="web-search-key-note" title={p.note}>{p.note}</span>
                  </div>
                  <div className="web-search-key-input-wrap">
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={keySet && !showDraft ? '已配置（输入新密钥以替换）' : `输入 ${p.name} API Key`}
                      value={draft}
                      disabled={!projectId || saving}
                      data-testid={`web-search-key-input-${p.id}`}
                      onChange={event => setDraft(p.keyField, event.target.value)}
                      className="web-search-key-input"
                    />
                    <span
                      className={`web-search-key-status${keySet ? ' set' : ''}`}
                      data-testid={`web-search-key-status-${p.id}`}
                    >
                      {showDraft ? '未保存' : keySet ? '已配置' : '未配置'}
                    </span>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="web-search-keys-actions" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="model-modal-add"
              disabled={!projectId || saving || !hasChanges}
              data-testid="web-search-keys-save"
              onClick={() => void saveAll()}
            >
              {saving ? '保存中…' : '保存修改'}
            </button>
            <button
              type="button"
              className="model-modal-refresh"
              disabled={!projectId || saving || !hasChanges}
              data-testid="web-search-keys-reset"
              onClick={resetAll}
            >
              还原
            </button>
          </div>
        </>
      )}
    </div>
  )
}

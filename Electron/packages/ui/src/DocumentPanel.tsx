import { useCallback, useEffect, useState } from 'react'
import type { DocumentContent, PipiHostAPI } from '@pipi/host-api'
import { TranscriptMarkdown } from './AssistantTranscriptContent'
import './document-panel.css'

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : '无法读取这个 Markdown 文档'
}

export function DocumentPanel({ host, documentPath }: { host: PipiHostAPI; documentPath?: string | null }) {
  const [document, setDocument] = useState<DocumentContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadGeneration, setReloadGeneration] = useState(0)

  const load = useCallback(() => setReloadGeneration(value => value + 1), [])

  useEffect(() => {
    setDocument(null)
    setError(null)
    if (!documentPath) {
      setLoading(false)
      return
    }
    if (!host.readDocument) {
      setLoading(false)
      setError('当前连接不支持读取 Markdown 文档')
      return
    }
    let cancelled = false
    setLoading(true)
    void host.readDocument(documentPath)
      .then(value => {
        if (cancelled) return
        if (!value || typeof value.content !== 'string' || value.kind !== 'markdown') throw new Error('宿主返回了无效的 Markdown 文档')
        setDocument(value)
        setError(null)
      })
      .catch(nextError => { if (!cancelled) setError(errorMessage(nextError)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [host, documentPath, reloadGeneration])

  return <section className="document-panel" aria-label="文档面板">
    {!documentPath ? <div className="document-empty" data-testid="document-empty">
      <span className="document-empty-icon" aria-hidden="true">▤</span>
      <b>没有打开的文档</b>
      <p>点击主聊天或 subagent 消息下方的 Markdown 文档卡片，即可在这里阅读。</p>
    </div> : <>
      <header className="document-panel-header">
        <span className="document-header-icon" aria-hidden="true">MD</span>
        <span className="document-header-copy"><b>{document?.name ?? documentPath.split('/').at(-1)}</b><small>{documentPath}</small></span>
        <button className="document-reload" aria-label="重新加载文档" title="重新加载文档" onClick={load}>↻</button>
      </header>
      <div className="document-reader">
        {loading ? <div className="document-loading" role="status">正在读取文档…</div>
          : error ? <div className="document-error" role="alert"><span>{error}</span><span className="document-error-actions"><button onClick={load}>重试</button><button aria-label="关闭文档错误" onClick={() => setError(null)}>×</button></span></div>
            : document ? <article className="document-markdown" aria-label={`文档内容 ${document.name}`}><TranscriptMarkdown content={document.content} /></article>
              : null}
      </div>
    </>}
  </section>
}

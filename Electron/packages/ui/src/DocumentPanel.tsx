import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import FileViewer, { type ViewerState } from '@file-viewer/react'
import officePreset from '@file-viewer/preset-office'
import { documentKindForName, type BinaryDocumentContent, type DocumentContent, type DocumentKind, type PipiHostAPI } from '@pipi/host-api'
import { TranscriptMarkdown } from './AssistantTranscriptContent'
import './document-panel.css'

function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
  if (code === 'document_not_found') return '文件已不存在'
  return error instanceof Error && error.message.trim() ? error.message : '无法读取这个文档'
}

const DOCUMENT_ICON: Record<DocumentKind, string> = { markdown: 'MD', plain: 'TXT', pdf: 'PDF', word: 'DOC', spreadsheet: 'XLS', presentation: 'PPT' }
const OFFICE_VIEWER_OPTIONS = {
  preset: officePreset,
  rendererMode: 'replace' as const,
  locale: 'zh-CN' as const,
  ui: { density: 'compact' as const },
  toolbar: { download: false, print: false, exportHtml: false, theme: false, position: 'top' as const }
}

function validDocument(value: DocumentContent | null | undefined): value is DocumentContent {
  if (!value || !documentKindForName(value.path) || !value.name) return false
  return value.kind === 'markdown' || value.kind === 'plain'
    ? typeof value.content === 'string'
    : value.bytes instanceof Uint8Array
}

function isBinaryDocument(document: DocumentContent): document is BinaryDocumentContent {
  return document.kind !== 'markdown' && document.kind !== 'plain'
}

function binaryBuffer(document: BinaryDocumentContent): ArrayBuffer {
  const bytes = document.bytes
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export const DocumentPanel = memo(function DocumentPanel({ host, documentPath }: { host: PipiHostAPI; documentPath?: string | null }) {
  const [document, setDocument] = useState<DocumentContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadGeneration, setReloadGeneration] = useState(0)

  const load = useCallback(() => setReloadGeneration(value => value + 1), [])
  const openExternally = useCallback(() => {
    if (!documentPath || !host.openDocumentExternally) return
    setError(null)
    void host.openDocumentExternally(documentPath).catch(nextError => setError(errorMessage(nextError)))
  }, [host, documentPath])
  const onViewerStateChange = useCallback((state: ViewerState) => {
    if (state.error) setError(errorMessage(state.error))
  }, [])

  useEffect(() => {
    setDocument(null)
    setError(null)
    if (!documentPath) {
      setLoading(false)
      return
    }
    if (!host.readDocument) {
      setLoading(false)
      setError('当前连接不支持读取文档')
      return
    }
    let cancelled = false
    setLoading(true)
    void host.readDocument(documentPath)
      .then(value => {
        if (cancelled) return
        if (!validDocument(value)) throw new Error('宿主返回了无效的文档内容')
        setDocument(value)
        setError(null)
      })
      .catch(nextError => { if (!cancelled) setError(errorMessage(nextError)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [host, documentPath, reloadGeneration])

  useEffect(() => {
    if (!documentPath || !host.watchDocument) return
    void host.watchDocument(documentPath).catch(error => console.warn('[document-watch]', error))
    return () => { void host.unwatchDocument?.().catch(() => undefined) }
  }, [host, documentPath])

  useEffect(() => {
    if (!documentPath || !host.subscribeDocuments) return
    return host.subscribeDocuments(event => {
      if (event.type === 'documentChanged' && event.path === documentPath) load()
    })
  }, [host, documentPath, load])

  const previewBuffer = useMemo(
    () => (document && isBinaryDocument(document) ? binaryBuffer(document) : null),
    [document],
  )

  return <section className="document-panel" aria-label="文档面板">
    {!documentPath ? <div className="document-empty" data-testid="document-empty">
      <span className="document-empty-icon" aria-hidden="true">▤</span>
      <b>没有打开的文档</b>
      <p>点击主聊天或 subagent 消息下方的文档卡片，或把文件拖进右侧面板，即可预览 Markdown、TXT、PDF 或 Office 文档。</p>
    </div> : <>
      <header className="document-panel-header">
        <span className="document-header-icon" aria-hidden="true">{DOCUMENT_ICON[document?.kind ?? documentKindForName(documentPath) ?? 'plain']}</span>
        <span className="document-header-copy"><b>{document?.name ?? documentPath.split('/').at(-1)}</b><small>{documentPath}</small></span>
        {host.openDocumentExternally ? <button className="document-external-open" aria-label="用默认应用打开文档" title="用默认应用打开" onClick={openExternally}>↗</button> : null}
        <button className="document-reload" aria-label="重新加载文档" title="重新加载文档" onClick={load}>↻</button>
      </header>
      <div className="document-reader">
        {loading ? <div className="document-loading" role="status">正在读取文档…</div>
          : error ? <div className="document-error" role="alert"><span>{error}</span><span className="document-error-actions"><button onClick={load}>重试</button><button aria-label="关闭文档错误" onClick={() => setError(null)}>×</button></span></div>
            : document?.kind === 'markdown' ? <article className="document-markdown" aria-label={`文档内容 ${document.name}`}><TranscriptMarkdown content={document.content} /></article>
              : document?.kind === 'plain' ? <pre className="document-plain-text" aria-label={`文档内容 ${document.name}`}>{document.content}</pre>
                : document && isBinaryDocument(document) && previewBuffer ? <div className="document-office-preview" aria-label={`文档内容 ${document.name}`}>
                  <FileViewer
                    className="document-file-viewer"
                    key={`${document.path}:${document.updatedAt ?? document.size ?? 0}`}
                    buffer={previewBuffer}
                    name={document.name}
                    type={document.name.split('.').at(-1)}
                    size={document.size}
                    options={OFFICE_VIEWER_OPTIONS}
                    onStateChange={onViewerStateChange}
                  />
                </div> : null}
      </div>
    </>}
  </section>
})

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { documentKindForName, type DocumentContent, type DocumentKind, type PipiHostAPI } from '@pipi/host-api'
import type { DocumentRendererActions, DocumentRendererDescriptor } from '@pipiui/extension-api'
import { DocumentSurface, isOfficeKind } from './DocumentSurface'
// T4 删除点：subscribeOfficeViewerErrors 是临时 built-in Office 兼容渲染器的内部接线（见 builtin-office-compat.tsx 头注记）。
import { subscribeOfficeViewerErrors } from './builtin-office-compat'
import './document-panel.css'

function errorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined
  if (code === 'document_not_found') return '文件已不存在'
  return error instanceof Error && error.message.trim() ? error.message : '无法读取这个文档'
}

const DOCUMENT_ICON: Record<DocumentKind, string> = { markdown: 'MD', plain: 'TXT', pdf: 'PDF', word: 'DOC', spreadsheet: 'XLS', presentation: 'PPT' }

function validDocument(value: DocumentContent | null | undefined): value is DocumentContent {
  if (!value || !documentKindForName(value.path) || !value.name) return false
  return value.kind === 'markdown' || value.kind === 'plain'
    ? typeof value.content === 'string'
    : value.bytes instanceof Uint8Array
}

/** File extension with a leading dot, lowercase — the registry match key, never a path. */
function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

/** Process-wide opaque ids so two mounted surfaces never share a documentId. */
let nextOpaqueDocumentId = 0

type DocumentRequest = {
  host: PipiHostAPI
  documentPath: string
  reloadGeneration: number
}

function sameDocumentRequest(a: DocumentRequest | null | undefined, b: DocumentRequest | null | undefined): boolean {
  return !!a && !!b && a.host === b.host && a.documentPath === b.documentPath && a.reloadGeneration === b.reloadGeneration
}

/**
 * Core document panel: owns the tab chrome and the whole host document lifecycle
 * (read / watch / reload / external open / size and validity checks / anydoc
 * fallback derivation). Body rendering — registry renderers and builtin views —
 * is delegated to the reusable DocumentSurface.
 */
export const DocumentPanel = memo(function DocumentPanel({ host, documentPath }: { host: PipiHostAPI; documentPath?: string | null }) {
  const [resolved, setResolved] = useState<{
    request: DocumentRequest
    document: DocumentContent | null
    error: string | null
  } | null>(null)
  const [reloadGeneration, setReloadGeneration] = useState(0)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [fallbackMarkdown, setFallbackMarkdown] = useState<string | null>(null)
  const [fallbackPending, setFallbackPending] = useState(false)
  const [genericFallback, setGenericFallback] = useState(false)
  const [revision, setRevision] = useState(0)
  const fallbackAttemptedRef = useRef(false)
  /** Session-scoped opaque document ids — never the filesystem path (contract v1). */
  const documentIdsRef = useRef(new Map<string, string>())

  const currentRequest: DocumentRequest | null = documentPath
    ? { host, documentPath, reloadGeneration }
    : null
  const resolvedMatches = sameDocumentRequest(resolved?.request, currentRequest)
  const document = resolvedMatches ? resolved!.document : null
  const error = resolvedMatches ? resolved!.error : null
  const loading = Boolean(currentRequest) && !resolvedMatches

  const load = useCallback(() => setReloadGeneration(value => value + 1), [])
  const onViewerError = useCallback((nextError: unknown) => setViewerError(errorMessage(nextError)), [])
  const onDismissError = useCallback(() => {
    setResolved(previous => previous ? { ...previous, error: null } : previous)
  }, [])
  const onDismissViewerError = useCallback(() => setViewerError(null), [])

  // Restricted, host-mediated renderer actions (contract v1). No paths, no host API.
  const actions = useMemo<DocumentRendererActions>(() => ({
    reload: async () => { setReloadGeneration(value => value + 1) },
    openExternally: async () => {
      if (!documentPath || !host.openDocumentExternally) return
      setResolved(previous => previous ? { ...previous, error: null } : previous)
      try {
        await host.openDocumentExternally(documentPath)
      } catch (nextError) {
        setResolved(previous => {
          if (!previous || previous.request.host !== host || previous.request.documentPath !== documentPath) return previous
          return { ...previous, error: errorMessage(nextError) }
        })
      }
    },
    useGenericFallback: async () => { setGenericFallback(true) },
  }), [host, documentPath])

  const documentId = useMemo(() => {
    if (!documentPath) return ''
    const existing = documentIdsRef.current.get(documentPath)
    if (existing) return existing
    const id = `doc-${(nextOpaqueDocumentId += 1)}`
    documentIdsRef.current.set(documentPath, id)
    return id
  }, [documentPath])

  const descriptor = useMemo<DocumentRendererDescriptor | undefined>(() => {
    if (!document || !documentPath) return undefined
    return {
      documentId,
      name: document.name,
      extension: extensionOf(document.name),
      documentKind: document.kind,
      size: document.size ?? 0,
      revision,
    }
  }, [document, documentId, documentPath, revision])

  useEffect(() => {
    setViewerError(null)
    setFallbackMarkdown(null)
    setFallbackPending(false)
    setGenericFallback(false)
    fallbackAttemptedRef.current = false
    if (!documentPath) {
      setResolved(null)
      return
    }
    const request: DocumentRequest = { host, documentPath, reloadGeneration }
    if (!host.readDocument) {
      setResolved({ request, document: null, error: '当前连接不支持读取文档' })
      return
    }
    let cancelled = false
    void host.readDocument(documentPath)
      .then(value => {
        if (cancelled) return
        if (!validDocument(value)) throw new Error('宿主返回了无效的文档内容')
        setResolved({ request, document: value, error: null })
        setRevision(count => count + 1)
      })
      .catch(nextError => { if (!cancelled) setResolved({ request, document: null, error: errorMessage(nextError) }) })
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

  // Office FileViewer errors arrive through the builtin compat module's sink.
  // T4 删除点：随 builtin-office-compat 一起删除。
  useEffect(() => subscribeOfficeViewerErrors(event => {
    if (!documentId || event.documentId !== documentId) return
    onViewerError(event.error)
  }), [documentId, onViewerError])

  // When the Office viewer fails (missing runtime asset, engine error, …), keep the
  // user reading the document: convert it locally with the bundled anydoc engine
  // and show markdown instead of a bare error. PDF/markdown/plain stay unchanged.
  // T4 删除点：office 回退策略随 Office 扩展接管后删除（anydoc 引擎本身留在宿主）。
  useEffect(() => {
    if (!viewerError || !document || !isOfficeKind(document) || !documentPath) return
    if (!host.convertDocumentToMarkdown || fallbackAttemptedRef.current) return
    fallbackAttemptedRef.current = true
    let cancelled = false
    setFallbackPending(true)
    void host.convertDocumentToMarkdown(documentPath)
      .then(markdown => { if (!cancelled) setFallbackMarkdown(typeof markdown === 'string' && markdown.trim() ? markdown : '') })
      .catch(() => { if (!cancelled) setFallbackMarkdown('') })
      .finally(() => { if (!cancelled) setFallbackPending(false) })
    return () => { cancelled = true }
  }, [viewerError, document, host, documentPath])

  return <section className="document-panel" aria-label="文档面板">
    {!documentPath ? <div className="document-empty" data-testid="document-empty">
      <span className="document-empty-icon" aria-hidden="true">▤</span>
      <b>没有打开的文档</b>
      <p>点击主聊天或 subagent 消息下方的文档卡片，或把文件拖进右侧面板，即可预览 Markdown、TXT、PDF 或 Office 文档。</p>
    </div> : <>
      <header className="document-panel-header">
        <span className="document-header-icon" aria-hidden="true">{DOCUMENT_ICON[document?.kind ?? documentKindForName(documentPath) ?? 'plain']}</span>
        <span className="document-header-copy"><b>{document?.name ?? documentPath.split('/').at(-1)}</b><small>{documentPath}</small></span>
        {host.openDocumentExternally ? <button className="document-external-open" aria-label="用默认应用打开文档" title="用默认应用打开" onClick={() => void actions.openExternally()}>↗</button> : null}
        <button className="document-reload" aria-label="重新加载文档" title="重新加载文档" onClick={load}>↻</button>
      </header>
      <DocumentSurface
        document={document}
        descriptor={descriptor}
        actions={actions}
        loading={loading}
        error={error}
        onRetry={load}
        onDismissError={onDismissError}
        viewerError={viewerError}
        onViewerError={onViewerError}
        onDismissViewerError={onDismissViewerError}
        fallbackMarkdown={fallbackMarkdown}
        fallbackPending={fallbackPending}
        genericFallback={genericFallback}
      />
    </>}
  </section>
})

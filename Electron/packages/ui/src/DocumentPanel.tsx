import { useEffect, useState } from 'react'
import type { DocumentContent, DocumentSummary, PipiHostAPI } from '@pipi/host-api'
import './document-panel.css'

/** Local fallback keeps the document page useful for hosts that predate the optional document API. */
export const mockDocumentContents: DocumentContent[] = [
  {
    id: 'pipiui-readme',
    name: 'README.md',
    path: '/Users/demo/code/pipiui/README.md',
    kind: 'markdown',
    size: 2840,
    updatedAt: Date.now() - 8 * 60_000,
    content: '# PipiUI Electron\n\n右侧面板把会话工具、文档与终端放在同一个工作区。\n\n## 文档预览\n\n选择文件后，可以在这里阅读 Markdown 与纯文本内容。'
  },
  {
    id: 'document-checklist',
    name: 'document-panel-checklist.txt',
    path: '/Users/demo/code/pipiui/docs/document-panel-checklist.txt',
    kind: 'plain',
    size: 512,
    updatedAt: Date.now() - 32 * 60_000,
    content: 'Document panel checklist\n\n- List previewable files\n- Keep the selected file visible\n- Render text without opening another app\n- Preserve an empty state when no files are available'
  },
  {
    id: 'design-tokens',
    name: 'design-tokens.md',
    path: '/Users/demo/code/pipiui/docs/design-tokens.md',
    kind: 'markdown',
    size: 1160,
    updatedAt: Date.now() - 3 * 3_600_000,
    content: '# Design tokens\n\nUse the shared `--surface`, `--border`, `--text`, and `--accent` tokens so this panel follows the system light and dark themes.'
  }
]

function mockSummaries(): DocumentSummary[] {
  return mockDocumentContents.map(({ content: _content, ...document }) => ({ ...document }))
}

function fallbackContent(document: DocumentSummary): DocumentContent {
  const matchingMock = mockDocumentContents.find(item => item.id === document.id)
  return matchingMock
    ? { ...matchingMock }
    : {
        ...document,
        content: `${document.name}\n\n当前宿主尚未提供该文件的内容；已保留文件列表与预览区域。`
      }
}

function normalizeDocuments(value: unknown): DocumentSummary[] | null {
  if (!Array.isArray(value)) return null
  const documents = value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.path !== 'string') return []
    return [{
      id: record.id,
      name: record.name,
      path: record.path,
      kind: record.kind === 'markdown' ? 'markdown' : 'plain',
      ...(typeof record.size === 'number' && Number.isFinite(record.size) ? { size: record.size } : {}),
      ...(typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? { updatedAt: record.updatedAt } : {})
    } satisfies DocumentSummary]
  })
  return value.length > 0 && documents.length === 0 ? null : documents
}

function normalizeContent(value: unknown, fallback: DocumentSummary): DocumentContent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string') return null
  return {
    ...fallback,
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
    ...(record.kind === 'markdown' || record.kind === 'plain' ? { kind: record.kind } : {}),
    ...(typeof record.size === 'number' && Number.isFinite(record.size) ? { size: record.size } : {}),
    ...(typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? { updatedAt: record.updatedAt } : {}),
    content: record.content
  }
}

function formatSize(size?: number): string | null {
  if (size === undefined) return null
  if (size < 1024) return `${size} B`
  return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
}

function shortPath(path: string): string {
  const pieces = path.split('/').filter(Boolean)
  return pieces.slice(-2).join('/') || path
}

function EmptyDocumentState() {
  return <div className="document-empty" data-testid="document-empty">
    <span className="document-empty-icon" aria-hidden="true">▤</span>
    <b>没有可预览的文档</b>
    <p>当前项目还没有可显示的 Markdown 或文本文件。</p>
  </div>
}

export function DocumentPanel({ host, projectId }: { host: PipiHostAPI; projectId?: string }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DocumentContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadGeneration, setReloadGeneration] = useState(0)
  const [listExpanded, setListExpanded] = useState(true)
  const [previewExpanded, setPreviewExpanded] = useState(true)
  const selectedDocument = documents.find(document => document.id === selectedId) ?? null

  useEffect(() => {
    let cancelled = false
    const applyDocuments = (next: DocumentSummary[]) => {
      if (cancelled) return
      setDocuments(next)
      setSelectedId(previous => next.some(document => document.id === previous) ? previous : next[0]?.id ?? null)
      setLoading(false)
    }
    setLoading(true)
    void (async () => {
      if (!host.listDocuments) {
        applyDocuments(mockSummaries())
        return
      }
      try {
        const next = normalizeDocuments(await host.listDocuments(projectId))
        applyDocuments(next ?? mockSummaries())
      } catch {
        applyDocuments(mockSummaries())
      }
    })()
    return () => { cancelled = true }
  }, [host, projectId, reloadGeneration])

  useEffect(() => {
    if (!selectedDocument) {
      setPreview(null)
      return
    }
    let cancelled = false
    const fallback = fallbackContent(selectedDocument)
    setPreview(null)
    if (!host.readDocument) {
      setPreview(fallback)
      return
    }
    void host.readDocument(selectedDocument.id)
      .then(value => normalizeContent(value, selectedDocument) ?? fallback)
      .catch(() => fallback)
      .then(value => { if (!cancelled) setPreview(value) })
    return () => { cancelled = true }
  }, [host, selectedDocument])

  return <section className="document-panel" aria-label="文档面板">
    <header className="document-panel-header">
      <div>
        <b>文档</b>
        <span>{loading ? '正在同步…' : `${documents.length} 个文件`}</span>
      </div>
      <button className="document-refresh" aria-label="刷新文档列表" title="刷新文档列表" onClick={() => setReloadGeneration(value => value + 1)}>↻</button>
    </header>

    {loading && documents.length === 0 ? <div className="document-loading" role="status">正在读取文档…</div>
      : documents.length === 0 ? <EmptyDocumentState />
        : <div className="document-scroll">
          <section className="document-card">
            <button className="document-card-heading" aria-expanded={listExpanded} onClick={() => setListExpanded(value => !value)}>
              <span><b>文件列表</b><small>{documents.length} 个</small></span>
              <span aria-hidden="true">{listExpanded ? '⌃' : '⌄'}</span>
            </button>
            {listExpanded && <div className="document-list" role="list" aria-label="文档列表">
              {documents.map(document => <button
                key={document.id}
                className={`document-row ${document.id === selectedId ? 'selected' : ''}`}
                aria-label={`预览 ${document.name}`}
                aria-pressed={document.id === selectedId}
                title={document.path}
                onClick={() => setSelectedId(document.id)}
              >
                <span className="document-kind" aria-hidden="true">{document.kind === 'markdown' ? 'MD' : 'TXT'}</span>
                <span className="document-row-copy"><b>{document.name}</b><small>{shortPath(document.path)}</small></span>
                <small className="document-size">{formatSize(document.size)}</small>
              </button>)}
            </div>}
          </section>

          {selectedDocument && <section className="document-card document-preview-card">
            <button className="document-card-heading" aria-expanded={previewExpanded} onClick={() => setPreviewExpanded(value => !value)}>
              <span className="document-preview-heading-copy"><b>{selectedDocument.name}</b><small>{selectedDocument.path}</small></span>
              <span aria-hidden="true">{previewExpanded ? '⌃' : '⌄'}</span>
            </button>
            {previewExpanded && <div className="document-preview-body">
              {preview?.id === selectedDocument.id
                ? <pre className="document-preview-text" aria-label={`文档内容 ${selectedDocument.name}`}>{preview.content}</pre>
                : <div className="document-preview-loading" role="status">正在读取内容…</div>}
            </div>}
          </section>}
        </div>}
  </section>
}

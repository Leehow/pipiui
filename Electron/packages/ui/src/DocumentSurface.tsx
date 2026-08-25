import { Component, useMemo, type ReactNode } from 'react'
import FileViewer, { type ViewerState } from '@file-viewer/react'
import officePreset from '@file-viewer/preset-office'
import type { BinaryDocumentContent, DocumentContent, DocumentKind } from '@pipi/host-api'
import type { DocumentRendererActions, DocumentRendererDescriptor, DocumentRendererProps } from '@pipiui/extension-api'
import { TranscriptMarkdown } from './AssistantTranscriptContent'
import { matchDocumentRenderers, useDocumentRenderers } from './ui-registries'
// T4 删除点：下一行 side-effect import 注册临时 built-in Office 兼容渲染器（见该文件头注记）。
import './builtin-office-compat'

// T4 删除点：OFFICE_DOCUMENT_KINDS 是 core 内最后的 Office 格式策略。T4 由 Office
// 扩展接管 word/spreadsheet/presentation 后，本常量与 isOfficeKind、以及本文件里
// office 回退分支一并删除；pdf/markdown/plain 的 builtin 分支保留。
export const OFFICE_DOCUMENT_KINDS: readonly DocumentKind[] = ['word', 'spreadsheet', 'presentation']

/** Office kinds the bundled anydoc engine can convert to readable markdown (PDF is out of scope). */
export function isOfficeKind(document: DocumentContent): boolean {
  return OFFICE_DOCUMENT_KINDS.includes(document.kind)
}

/** Builtin binary viewer config (pdf now; office no-match fallback until T4). */
const BUILTIN_VIEWER_OPTIONS = {
  preset: officePreset,
  rendererMode: 'replace' as const,
  locale: 'zh-CN' as const,
  ui: { density: 'compact' as const },
  toolbar: { download: false, print: false, exportHtml: false, theme: false, position: 'top' as const },
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

/** Host-derived text for registry renderers: text kinds expose their content, binaries nothing. */
function textOf(document: DocumentContent): string | undefined {
  return document.kind === 'markdown' || document.kind === 'plain' ? document.content : undefined
}

export type DocumentSurfaceProps = {
  document: DocumentContent | null
  /** Host-prepared, path-free descriptor; present exactly when `document` is. */
  descriptor?: DocumentRendererDescriptor
  /** Restricted host-mediated actions handed to registry renderers. */
  actions?: DocumentRendererActions
  loading: boolean
  error: string | null
  onRetry: () => void
  onDismissError: () => void
  /** Office viewer error message (host-owned state); suppresses the viewer until dismissed. */
  viewerError: string | null
  onViewerError: (error: unknown) => void
  onDismissViewerError: () => void
  /** Host-converted anydoc markdown for the office fallback view. */
  fallbackMarkdown: string | null
  fallbackPending: boolean
  /** A registry renderer asked the host shell for the generic builtin view. */
  genericFallback: boolean,
}

/** A registry renderer that throws must not take the document surface down. */
class RendererErrorBoundary extends Component<{ fallbackRender: () => ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('[document-renderer]', error) }
  render() { return this.state.failed ? this.props.fallbackRender() : this.props.children }
}

/** Calls contribution.render inside the error boundary, so a sync throw is caught. */
function RegisteredRenderer({
  contribution,
  rendererProps,
}: {
  contribution: { render: (props: DocumentRendererProps) => ReactNode }
  rendererProps: DocumentRendererProps
}) {
  return contribution.render(rendererProps)
}

/**
 * Reusable document rendering surface: registry renderer first (deterministic
 * precedence), builtin views (markdown / plain / pdf / office no-match) after.
 * Host-owned concerns (path, read/watch/reload, size, anydoc) stay upstream.
 */
export function DocumentSurface({
  document, descriptor, actions, loading, error, onRetry, onDismissError,
  viewerError, onViewerError, onDismissViewerError, fallbackMarkdown, fallbackPending, genericFallback,
}: DocumentSurfaceProps) {
  useDocumentRenderers() // re-render when renderer registrations change
  const builtinBuffer = useMemo(() => {
    if (!document || !isBinaryDocument(document)) return null
    return binaryBuffer(document)
  }, [document])
  const matched = document && descriptor
    ? matchDocumentRenderers({ documentKind: descriptor.documentKind, extension: descriptor.extension })[0]
    : undefined

  const builtinView = (): ReactNode => {
    if (!document) return null
    if (document.kind === 'markdown') {
      return <article className="document-markdown" aria-label={`文档内容 ${document.name}`}><TranscriptMarkdown content={document.content} /></article>
    }
    if (document.kind === 'plain') {
      return <pre className="document-plain-text" aria-label={`文档内容 ${document.name}`}>{document.content}</pre>
    }
    if (!isBinaryDocument(document) || !builtinBuffer) return null
    return <div className="document-office-preview" aria-label={`文档内容 ${document.name}`}>
      <FileViewer
        className="document-file-viewer"
        key={`${document.path}:${document.updatedAt ?? document.size ?? 0}`}
        buffer={builtinBuffer}
        name={document.name}
        type={document.name.split('.').at(-1)}
        size={document.size}
        options={BUILTIN_VIEWER_OPTIONS}
        onStateChange={(state: ViewerState) => { if (state.error) onViewerError(state.error) }}
      />
    </div>
  }

  const viewerErrorAlert = viewerError !== null
    ? <div className="document-error" role="alert"><span>{viewerError}</span><span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissViewerError}>×</button></span></div>
    : null

  const rendererProps: DocumentRendererProps | null = document && descriptor && actions
    ? { document: descriptor, bytes: isBinaryDocument(document) ? document.bytes : undefined, text: textOf(document), actions }
    : null

  return <div className="document-reader">
    {loading ? <div className="document-loading" role="status">正在读取文档…</div>
      : error ? <div className="document-error" role="alert"><span>{error}</span><span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissError}>×</button></span></div>
        // T4 删除点：office viewer 失败 → anydoc 回退分支（isOfficeKind + fallbackMarkdown）。
        : document && viewerError && isOfficeKind(document)
          ? (fallbackMarkdown
            ? <div className="document-fallback" data-testid="document-fallback">
              <div className="document-fallback-bar" role="status">原始版式预览失败，已显示本地转换的文本。<span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissViewerError}>×</button></span></div>
              <article className="document-markdown" aria-label={`文档内容 ${document.name}`}><TranscriptMarkdown content={fallbackMarkdown} /></article>
            </div>
            : fallbackPending ? <div className="document-loading" role="status">正在转换文档为可读文本…</div>
              : viewerErrorAlert)
          : viewerError
            ? viewerErrorAlert
            : matched && rendererProps && !genericFallback
              ? <RendererErrorBoundary
                key={`${matched.extId}:${matched.contribution.id}:${descriptor!.documentId}:${descriptor!.revision}`}
                fallbackRender={builtinView}
              ><RegisteredRenderer contribution={matched.contribution} rendererProps={rendererProps} /></RendererErrorBoundary>
              : builtinView()}
  </div>
}

import { Component, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_FILE_VIEWER_PDF_CMAP_PATH,
  DEFAULT_FILE_VIEWER_PDF_STANDARD_FONT_PATH,
  DEFAULT_FILE_VIEWER_PDF_WASM_PATH,
  DEFAULT_FILE_VIEWER_PDF_WORKER_PATH,
} from '@file-viewer/core'
import FileViewer, { type FileViewerHandle, type ViewerState } from '@file-viewer/react'
import { pdfRenderer } from '@file-viewer/renderer-pdf'
import type { BinaryDocumentContent, DocumentContent } from '@pipi/host-api'
import type { DocumentRendererActions, DocumentRendererDescriptor, DocumentRendererProps } from '@pipiui/extension-api'
import { TranscriptMarkdown } from './AssistantTranscriptContent'
import { matchDocumentRenderers, useDocumentRenderers } from './ui-registries'

/** Matches `fileViewerAssetOptions.copyAssets.baseDir` in vite.browser.config.ts. */
const CORE_PDF_ASSET_DIR = 'file-viewer/'

/**
 * Instance-level PDF asset base. Do not call `resolveFileViewerRuntimeAssetBaseUrl`
 * here: that helper returns the process default when Office holds a global lease
 * (`@file-viewer/core` assets.js). `document.baseURI` is the same document fallback
 * the helper uses, combined with the Vite copyAssets directory — never a worktree path.
 */
export function corePdfAssetBaseUrl(
  documentRef: { baseURI?: string; URL?: string } | null | undefined = typeof document === 'undefined' ? undefined : document,
): string | undefined {
  if (!documentRef) return undefined
  try {
    const documentBaseUrl = documentRef.baseURI || documentRef.URL || 'file:///'
    return new URL(CORE_PDF_ASSET_DIR, documentBaseUrl).href
  } catch {
    return undefined
  }
}

type PdfZoomState = NonNullable<ViewerState['zoom']>

/** Builtin PDF-only viewer config. Office preset/format policy lives in office-extension. */
const PDF_VIEWER_OPTIONS = {
  preset: {
    id: 'file-viewer-preset-pdf',
    label: 'PDF',
    renderers: [pdfRenderer],
  },
  rendererMode: 'replace' as const,
  locale: 'zh-CN' as const,
  ui: { density: 'compact' as const },
  // 极简预览：内置工具栏（搜索行 + 缩放组）和 PDF 专属工具条（页码/旋转/侧栏）
  // 都不渲染，缩放由文档区右下角的悬浮 pill 提供（见 .pdf-zoom-pill）。
  toolbar: false as const,
  pdf: { toolbar: false },
}

function pdfAssetUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).href
}

function pdfViewerOptions() {
  const assetBaseUrl = corePdfAssetBaseUrl()
  if (!assetBaseUrl) return PDF_VIEWER_OPTIONS
  // FileViewer still prefers the process default when workerUrl/cMapUrl are omitted,
  // so instance isolation requires the explicit PDF asset URLs, not only assetBaseUrl.
  return {
    ...PDF_VIEWER_OPTIONS,
    pdf: {
      toolbar: false,
      assetBaseUrl,
      workerUrl: pdfAssetUrl(assetBaseUrl, DEFAULT_FILE_VIEWER_PDF_WORKER_PATH),
      cMapUrl: pdfAssetUrl(assetBaseUrl, DEFAULT_FILE_VIEWER_PDF_CMAP_PATH),
      wasmUrl: pdfAssetUrl(assetBaseUrl, DEFAULT_FILE_VIEWER_PDF_WASM_PATH),
      standardFontDataUrl: pdfAssetUrl(assetBaseUrl, DEFAULT_FILE_VIEWER_PDF_STANDARD_FONT_PATH),
      cjkFontFallbackPath: pdfAssetUrl(assetBaseUrl, 'vendor/pdf/fonts/'),
    },
  }
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
  /** Builtin PDF viewer error (host-owned). Office errors stay inside the extension. */
  viewerError: string | null
  onViewerError: (error: unknown) => void
  onDismissViewerError: () => void
  /** Host-converted anydoc markdown after a renderer asked for generic fallback. */
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
 * precedence), builtin views (markdown / plain / pdf) after.
 * Host-owned concerns (path, read/watch/reload, size, anydoc) stay upstream.
 */
export function DocumentSurface({
  document, descriptor, actions, loading, error, onRetry, onDismissError,
  viewerError, onViewerError, onDismissViewerError, fallbackMarkdown, fallbackPending, genericFallback,
}: DocumentSurfaceProps) {
  useDocumentRenderers() // re-render when renderer registrations change
  const pdfViewerRef = useRef<FileViewerHandle | null>(null)
  // key 关联缩放状态和文档实例：换文档后旧缩放不显示，等新 viewer 上报。
  const [pdfZoom, setPdfZoom] = useState<{ key: string; zoom: PdfZoomState } | null>(null)
  const viewerKey = document ? `${document.path}:${document.updatedAt ?? document.size ?? 0}` : ''
  // @file-viewer/react 把 options/onStateChange 放进 viewerOptions 的 memo 依赖，身份一变就
  // controller.update() 重载文档；而 pdf.js 首次加载已把 buffer 转移进 worker（detach）。所以
  // 这两个 prop 必须身份稳定，否则每次状态上报 → 重渲染 → 用 detached buffer 重载 →
  // "Cannot perform Construct on a detached ArrayBuffer"。zoom 状态本身仍走 setState。
  const pdfOptions = useMemo(() => pdfViewerOptions(), [])
  const noteZoom = useCallback((state: ViewerState) => {
    setPdfZoom((prev) => {
      const next = state.zoom
      if (!next || !(next.scale > 0)) return null
      if (prev && prev.key === viewerKey
        && prev.zoom.label === next.label
        && prev.zoom.canZoomIn === next.canZoomIn
        && prev.zoom.canZoomOut === next.canZoomOut) return prev
      return { key: viewerKey, zoom: next }
    })
    if (state.error) onViewerError(state.error)
  }, [viewerKey, onViewerError])
  const builtinBuffer = useMemo(() => {
    if (!document || !isBinaryDocument(document) || document.kind !== 'pdf') return null
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
    if (document.kind === 'pdf' && isBinaryDocument(document) && builtinBuffer) {
      return <div className="document-pdf-preview" aria-label={`文档内容 ${document.name}`}>
        <FileViewer
          ref={pdfViewerRef}
          className="document-file-viewer"
          key={viewerKey}
          buffer={builtinBuffer}
          name={document.name}
          type="pdf"
          size={document.size}
          options={pdfOptions}
          onStateChange={noteZoom}
        />
        {pdfZoom?.key === viewerKey && (
          <div className="pdf-zoom-pill" role="group" aria-label="缩放">
            <button type="button" aria-label="缩小" disabled={!pdfZoom.zoom.canZoomOut} onClick={() => { void pdfViewerRef.current?.zoomOut() }}>−</button>
            <button type="button" className="pdf-zoom-value" aria-label="重置缩放" title="重置缩放" onClick={() => { void pdfViewerRef.current?.resetZoom() }}>{pdfZoom.zoom.label}</button>
            <button type="button" aria-label="放大" disabled={!pdfZoom.zoom.canZoomIn} onClick={() => { void pdfViewerRef.current?.zoomIn() }}>+</button>
          </div>
        )}
      </div>
    }
    return <div className="document-empty" role="status">没有可用的预览器</div>
  }

  const viewerErrorAlert = viewerError !== null
    ? <div className="document-error" role="alert"><span>{viewerError}</span><span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissViewerError}>×</button></span></div>
    : null

  const rendererProps: DocumentRendererProps | null = document && descriptor && actions
    ? { document: descriptor, bytes: isBinaryDocument(document) ? document.bytes : undefined, text: textOf(document), actions }
    : null

  const genericFallbackView = (): ReactNode => {
    if (!document) return null
    if (fallbackMarkdown) {
      return <div className="document-fallback" data-testid="document-fallback">
        <div className="document-fallback-bar" role="status">原始版式预览失败，已显示本地转换的文本。<span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissViewerError}>×</button></span></div>
        <article className="document-markdown" aria-label={`文档内容 ${document.name}`}><TranscriptMarkdown content={fallbackMarkdown} /></article>
      </div>
    }
    if (fallbackPending) return <div className="document-loading" role="status">正在转换文档为可读文本…</div>
    return <div className="document-error" role="alert"><span>无法将文档转换为可读文本</span><span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissViewerError}>×</button></span></div>
  }

  return <div className="document-reader">
    {loading ? <div className="document-loading" role="status">正在读取文档…</div>
      : error ? <div className="document-error" role="alert"><span>{error}</span><span className="document-error-actions"><button onClick={onRetry}>重试</button><button aria-label="关闭文档错误" onClick={onDismissError}>×</button></span></div>
        : document && genericFallback
          ? (isBinaryDocument(document) ? genericFallbackView() : builtinView())
          : viewerError
            ? viewerErrorAlert
            : matched && rendererProps
              ? <RendererErrorBoundary
                key={`${matched.extId}:${matched.contribution.id}:${descriptor!.documentId}:${descriptor!.revision}`}
                fallbackRender={builtinView}
              ><RegisteredRenderer contribution={matched.contribution} rendererProps={rendererProps} /></RendererErrorBoundary>
              : builtinView()}
  </div>
}

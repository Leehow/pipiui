import { Component, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import FileViewer, { type ViewerState } from '@file-viewer/react'
import officePreset from '@file-viewer/preset-office'
import {
  getDefaultFileViewerAssetBaseUrl,
  resetDefaultFileViewerAssetBaseUrl,
  setDefaultFileViewerAssetBaseUrl,
} from '@file-viewer/core'
import type { DocumentRendererProps } from '@pipiui/extension-api'
import { fileViewerType, officePreviewTier } from './office-format-policy'
import { OFFICE_RENDERER_CSS } from './office-styles'

const OFFICE_VIEWER_OPTIONS = {
  preset: officePreset,
  rendererMode: 'replace' as const,
  locale: 'zh-CN' as const,
  ui: { density: 'compact' as const },
  toolbar: { download: false, print: false, exportHtml: false, theme: false, position: 'top' as const },
}

/** Lease node for CSS + reversible FileViewer default-asset-base. Survives HMR. */
export const OFFICE_STYLE_ID = 'pipiui-office-extension-style'

function officeAssetBaseUrl(): string | undefined {
  try {
    return new URL(/* @vite-ignore */ './file-viewer/', import.meta.url).href
  } catch {
    return undefined
  }
}

function currentAssetBase(): string {
  return getDefaultFileViewerAssetBaseUrl() ?? ''
}

function restoreAssetBase(previous: string): void {
  if (previous) setDefaultFileViewerAssetBaseUrl(previous)
  else resetDefaultFileViewerAssetBaseUrl()
}

/**
 * FileViewer 2.2 has no instance-level general asset-base (`FileViewerOptions`
 * has none; only `pdf.assetBaseUrl` and per-format worker URLs). Office must
 * use the process default setter, so the lease saves/restores that value.
 * Restore only if the global still equals the value this lease installed.
 */
export function acquireOfficeSideEffects(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(OFFICE_STYLE_ID) as HTMLStyleElement | null
  if (existing) {
    existing.dataset.refcount = String(Number(existing.dataset.refcount || '0') + 1)
    return
  }
  const style = document.createElement('style')
  style.id = OFFICE_STYLE_ID
  style.textContent = OFFICE_RENDERER_CSS
  style.dataset.refcount = '0'
  const previous = currentAssetBase()
  style.dataset.prevAssetBase = previous
  const requested = officeAssetBaseUrl() ?? ''
  style.dataset.installedAssetBase = requested
  try {
    document.head.appendChild(style)
    if (requested) setDefaultFileViewerAssetBaseUrl(requested)
    style.dataset.installedAssetBase = currentAssetBase()
    style.dataset.refcount = '1'
  } catch (error) {
    try {
      const current = currentAssetBase()
      if (current === requested || current === (style.dataset.installedAssetBase ?? '')) restoreAssetBase(previous)
    } catch { /* rollback best-effort */ }
    try { style.remove() } catch { /* rollback best-effort */ }
    throw error
  }
}

export function releaseOfficeSideEffects(): void {
  if (typeof document === 'undefined') return
  const style = document.getElementById(OFFICE_STYLE_ID)
  if (!style) return
  const next = Math.max(0, Number(style.dataset.refcount || '1') - 1)
  if (next > 0) {
    style.dataset.refcount = String(next)
    return
  }
  const previous = style.dataset.prevAssetBase ?? ''
  const installed = style.dataset.installedAssetBase ?? ''
  try {
    if (currentAssetBase() === installed) restoreAssetBase(previous)
  } finally {
    style.remove()
  }
}

class OfficeViewerErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

function bytesBuffer(bytes: Uint8Array | undefined): ArrayBuffer | null {
  if (!bytes) return null
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/** Controlled document renderer. Path-free props only. */
export default function OfficeRenderer(props: DocumentRendererProps) {
  useEffect(() => {
    acquireOfficeSideEffects()
    return () => releaseOfficeSideEffects()
  }, [])

  const fallbackOnce = useRef(false)
  const lastKey = useRef(`${props.document.documentId}:${props.document.revision}`)
  const key = `${props.document.documentId}:${props.document.revision}`
  if (lastKey.current !== key) {
    lastKey.current = key
    fallbackOnce.current = false
  }

  const buffer = useMemo(() => bytesBuffer(props.bytes), [props.bytes])
  const tier = officePreviewTier(props.document.extension)
  const viewerType = fileViewerType(props.document.extension)

  const requestFallback = useCallback(() => {
    if (fallbackOnce.current) return
    fallbackOnce.current = true
    void props.actions.useGenericFallback()
  }, [props.actions])

  if (!buffer) return null

  return (
    <div
      className="document-office-preview"
      data-testid="office-renderer"
      data-preview-tier={tier}
      data-extension={props.document.extension}
      data-kind={props.document.documentKind}
      aria-label={`文档内容 ${props.document.name}`}
    >
      <OfficeViewerErrorBoundary
        key={key}
        onError={requestFallback}
      >
        <FileViewer
          className="document-file-viewer"
          key={key}
          buffer={buffer}
          name={props.document.name}
          type={viewerType}
          size={props.document.size}
          options={OFFICE_VIEWER_OPTIONS}
          onStateChange={(state: ViewerState) => { if (state.error) requestFallback() }}
        />
      </OfficeViewerErrorBoundary>
    </div>
  )
}

export { OfficeRenderer }

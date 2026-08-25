// T4 删除点（office-extension-refactor-v1）：
// 本模块是 T3 的临时 built-in Office 兼容渲染器。在 Office 扩展（T4）提供自己的
// documentRenderer 之前，让 word/spreadsheet/presentation 文档与真实扩展走同一
// `documentRenderers` registry 与同一优先级规则。T4 删除时：
//   1. 删除本文件；
//   2. 删除 DocumentSurface.tsx 顶部的 `import './builtin-office-compat'`；
//   3. 删除 DocumentPanel.tsx 里的 subscribeOfficeViewerErrors 订阅与 office 回退
//      分支，以及 DocumentSurface.tsx 的 OFFICE_DOCUMENT_KINDS（见各自注记）。
import { useMemo } from 'react'
import FileViewer, { type ViewerState } from '@file-viewer/react'
import officePreset from '@file-viewer/preset-office'
import type { DocumentRendererProps } from '@pipiui/extension-api'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import { registerDocumentRenderer } from './ui-registries'

const OFFICE_VIEWER_OPTIONS = {
  preset: officePreset,
  rendererMode: 'replace' as const,
  locale: 'zh-CN' as const,
  ui: { density: 'compact' as const },
  toolbar: { download: false, print: false, exportHtml: false, theme: false, position: 'top' as const },
}

export const BUILTIN_OFFICE_COMPAT_ID = 'builtin-office-compat'
/** Lowest finite priority: any real extension, including priority -101, ranks above this temp compat. */
export const BUILTIN_OFFICE_COMPAT_PRIORITY = -Number.MAX_VALUE

const DISPOSE_KEY = '__pipiuiBuiltinOfficeCompatDispose__'

type CompatGlobal = typeof globalThis & { [DISPOSE_KEY]?: () => void }

/**
 * Office FileViewer 错误经此 sink 交回宿主面板：宿主拥有唯一的 anydoc 回退引擎与
 * viewer 错误状态。这是 core→core 的内部接线，不是 renderer props 的一部分；
 * T4 随本文件一起删除。
 */
export type OfficeViewerErrorEvent = { documentId: string; error: unknown }

const viewerErrorListeners = new Set<(event: OfficeViewerErrorEvent) => void>()

export function subscribeOfficeViewerErrors(listener: (event: OfficeViewerErrorEvent) => void): () => void {
  viewerErrorListeners.add(listener)
  return () => { viewerErrorListeners.delete(listener) }
}

function emitOfficeViewerError(documentId: string, error: unknown): void {
  if (!documentId) return
  const event: OfficeViewerErrorEvent = { documentId, error }
  for (const listener of [...viewerErrorListeners]) listener(event)
}

/** Registry-contracted builtin Office renderer. Receives host-prepared props only. */
function BuiltinOfficeCompatRenderer(props: DocumentRendererProps) {
  const buffer = useMemo(() => {
    if (!props.bytes) return null
    const copy = new Uint8Array(props.bytes.byteLength)
    copy.set(props.bytes)
    return copy.buffer
  }, [props.bytes])
  if (!buffer) return null
  return <FileViewer
    className="document-file-viewer"
    key={`${props.document.documentId}:${props.document.revision}`}
    buffer={buffer}
    name={props.document.name}
    type={props.document.extension.replace(/^\./, '')}
    size={props.document.size}
    options={OFFICE_VIEWER_OPTIONS}
    onStateChange={(state: ViewerState) => { if (state.error) emitOfficeViewerError(props.document.documentId, state.error) }}
  />
}

/** Idempotent / HMR-safe registration. Repeat calls replace the single compat entry. */
export function ensureBuiltinOfficeCompat(): void {
  const globalState = globalThis as CompatGlobal
  globalState[DISPOSE_KEY]?.()
  globalState[DISPOSE_KEY] = registerDocumentRenderer(BUILTIN_EXTENSION_ID, {
    id: BUILTIN_OFFICE_COMPAT_ID,
    kinds: ['word', 'spreadsheet', 'presentation'],
    priority: BUILTIN_OFFICE_COMPAT_PRIORITY,
    render: props => <BuiltinOfficeCompatRenderer {...props} />,
  })
}

ensureBuiltinOfficeCompat()

import { createElement, type ReactElement } from 'react'
import type { DocumentRendererProps } from '@pipiui/extension-api'

/** Controlled document renderer probe: echoes the host-prepared props it receives. */
export default function ProbeDocumentRenderer(props: DocumentRendererProps): ReactElement {
  const pipi = typeof window === 'undefined' ? undefined : window.pipiHost
  return createElement('div', {
    'data-testid': 'ext-controlled-document-renderer',
    'data-document-id': props.document.documentId,
    'data-name': props.document.name,
    'data-kind': props.document.documentKind,
    'data-extension': props.document.extension,
    'data-size': String(props.document.size),
    'data-revision': String(props.document.revision),
    'data-bytes': String(props.bytes?.length ?? -1),
    'data-text': props.text ?? '',
    'data-pipi-host': pipi === undefined ? 'undefined' : 'present',
    'data-actions': Object.keys(props.actions ?? {}).sort().join(','),
  }, props.document.name)
}

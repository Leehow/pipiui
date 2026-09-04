// @vitest-environment jsdom
import {
  resetDefaultFileViewerAssetBaseUrl,
  resolveFileViewerPdfAssetUrls,
  setDefaultFileViewerAssetBaseUrl,
} from '@file-viewer/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import type { DocumentRendererProps } from '@pipiui/extension-api'
import OfficeRenderer from '../../pipiui-office-extension/app/src/office-renderer'
import { DocumentPanel } from './DocumentPanel'
import { corePdfAssetBaseUrl } from './DocumentSurface'
import { disposeDocumentRenderers, registerDocumentRenderer } from './ui-registries'

vi.mock('@file-viewer/preset-office', () => ({ default: { id: 'office' } }))
vi.mock('@file-viewer/react', async () => {
  const React = await import('react')
  type MockZoomState = { label: string; scale: number; canZoomIn: boolean; canZoomOut: boolean }
  type ViewerStateSink = (state: { error?: unknown; zoom?: MockZoomState | null }) => void
  type MockHandle = {
    zoomIn: ReturnType<typeof vi.fn>
    zoomOut: ReturnType<typeof vi.fn>
    resetZoom: ReturnType<typeof vi.fn>
  }
  const sinksByName = new Map<string, Set<ViewerStateSink>>()
  const optionsByName = new Map<string, Record<string, unknown>>()
  const handlesByName = new Map<string, MockHandle>()
  const MockViewer = React.forwardRef(function MockViewer({ buffer, name, type, className, onStateChange, options }: {
    buffer: ArrayBuffer
    name: string
    type: string
    className?: string
    onStateChange?: ViewerStateSink
    options?: { toolbar?: unknown; pdf?: { assetBaseUrl?: string; workerUrl?: string; toolbar?: boolean } }
  }, ref: React.Ref<MockHandle>) {
    React.useEffect(() => {
      if (!onStateChange) return
      let sinks = sinksByName.get(name)
      if (!sinks) {
        sinks = new Set()
        sinksByName.set(name, sinks)
      }
      sinks.add(onStateChange)
      return () => { sinks!.delete(onStateChange) }
    }, [name, onStateChange])
    React.useImperativeHandle(ref, () => {
      const handle: MockHandle = {
        zoomIn: vi.fn(async () => null),
        zoomOut: vi.fn(async () => null),
        resetZoom: vi.fn(async () => null),
      }
      handlesByName.set(name, handle)
      return handle
    }, [name])
    optionsByName.set(name, options ?? {})
    const assetBase = options?.pdf?.assetBaseUrl ?? ''
    const workerUrl = options?.pdf?.workerUrl ?? ''
    return <div className={className} data-testid="office-viewer" data-name={name} data-type={type} data-size={buffer.byteLength} data-pdf-asset-base={assetBase} data-pdf-worker={workerUrl} />
  })
  return {
    default: MockViewer,
    __emitViewerState: (state: { error?: unknown }) => {
      for (const sinks of sinksByName.values()) for (const sink of sinks) sink(state)
    },
    __emitViewerStateFor: (name: string, state: { error?: unknown; zoom?: MockZoomState | null }) => {
      for (const sink of sinksByName.get(name) ?? []) sink(state)
    },
    __optionsFor: (name: string) => optionsByName.get(name),
    __handleFor: (name: string) => handlesByName.get(name),
  }
})
vi.mock('@file-viewer/renderer-pdf', () => ({ pdfRenderer: { id: 'pdf' } }))

const TEST_EXT = 'document-surface-test'
let lastProps: DocumentRendererProps | null = null

function probeRenderer(id: string, options: { throwInRender?: boolean } = {}) {
  return function ProbeRenderer(props: DocumentRendererProps) {
    lastProps = props
    if (options.throwInRender) throw new Error('probe renderer exploded')
    return <div data-testid={`probe-${id}`}
      data-document-id={props.document.documentId}
      data-name={props.document.name}
      data-kind={props.document.documentKind}
      data-extension={props.document.extension}
      data-size={String(props.document.size)}
      data-revision={String(props.document.revision)}
      data-bytes={String(props.bytes?.length ?? -1)}
      data-text={props.text ?? ''}
      data-actions={Object.keys(props.actions ?? {}).sort().join(',')}>
      <button onClick={() => void props.actions.reload()}>probe reload</button>
      <button onClick={() => void props.actions.useGenericFallback()}>probe fallback</button>
    </div>
  }
}

function documentHost(readDocument: NonNullable<PipiHostAPI['readDocument']>): PipiHostAPI {
  return { protocolVersion: 2, readDocument } as unknown as PipiHostAPI
}

afterEach(() => {
  cleanup()
  disposeDocumentRenderers(TEST_EXT)
  lastProps = null
  resetDefaultFileViewerAssetBaseUrl()
  document.getElementById('pipiui-office-extension-style')?.remove()
})

describe('DocumentSurface registry renderers', () => {
  it('renders a registry renderer with host-prepared props and no filesystem path', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'pdf-probe', kinds: ['pdf'], priority: 50, render: props => {
      const Probe = probeRenderer('pdf')
      return <Probe {...props} />
    } })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/report.pdf" />)
    const probe = await screen.findByTestId('probe-pdf')
    expect(probe.getAttribute('data-document-id')).toMatch(/^doc-\d+$/)
    expect(probe.getAttribute('data-name')).toBe('report.pdf')
    expect(probe.getAttribute('data-kind')).toBe('pdf')
    expect(probe.getAttribute('data-extension')).toBe('.pdf')
    expect(probe.getAttribute('data-size')).toBe('4')
    expect(probe.getAttribute('data-revision')).toBe('1')
    expect(probe.getAttribute('data-bytes')).toBe('4')
    expect(probe.getAttribute('data-text')).toBe('')
    expect(probe.getAttribute('data-actions')).toBe('openExternally,reload,useGenericFallback')
    expect(JSON.stringify(lastProps)).not.toContain('/work/report.pdf')
    expect(screen.queryByTestId('office-viewer')).toBeNull()
  })

  it('orders competing renderers by priority descending', async () => {
    const Low = probeRenderer('low')
    const High = probeRenderer('high')
    registerDocumentRenderer(TEST_EXT, { id: 'office-low', kinds: ['word'], priority: 1, render: props => <Low {...props} /> })
    registerDocumentRenderer(TEST_EXT, { id: 'office-high', kinds: ['word'], priority: 20, render: props => <High {...props} /> })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/form.docx" />)
    const probe = await screen.findByTestId('probe-high')
    expect(probe.getAttribute('data-kind')).toBe('word')
    expect(screen.queryByTestId('probe-low')).toBeNull()
    expect(screen.queryByTestId('office-viewer')).toBeNull()
  })

  it('keeps builtin rendering when no renderer matches', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'notes.md', path, kind: 'markdown' as const, size: 7, content: '# Builtin stays' }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.md" />)
    expect(await screen.findByRole('heading', { name: 'Builtin stays' })).toBeTruthy()
    expect(screen.getByLabelText('文档内容 notes.md').tagName).toBe('ARTICLE')
  })

  it('falls back to builtin rendering when a renderer throws', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'throws', kinds: ['plain'], render: props => {
      const Probe = probeRenderer('throws', { throwInRender: true })
      return <Probe {...props} />
    } })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'notes.txt', path, kind: 'plain' as const, content: 'builtin line' }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.txt" />)
    const text = await screen.findByLabelText('文档内容 notes.txt')
    expect(text.tagName).toBe('PRE')
    expect(text.textContent).toBe('builtin line')
  })

  it('falls back to builtin rendering when contribution.render throws synchronously', async () => {
    registerDocumentRenderer(TEST_EXT, {
      id: 'sync-throw',
      kinds: ['plain'],
      render: () => { throw new Error('sync contribution throw') },
    })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'notes.txt', path, kind: 'plain' as const, content: 'sync fallback line' }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.txt" />)
    const text = await screen.findByLabelText('文档内容 notes.txt')
    expect(text.tagName).toBe('PRE')
    expect(text.textContent).toBe('sync fallback line')
  })

  it('swaps to the generic view on useGenericFallback and retries the renderer after reload', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'generic', kinds: ['plain'], render: props => {
      const Probe = probeRenderer('generic')
      return <Probe {...props} />
    } })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'notes.txt', path, kind: 'plain' as const, content: 'generic body' }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.txt" />)
    expect(await screen.findByTestId('probe-generic')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByLabelText('文档内容 notes.txt')).toBeTruthy()
    expect(screen.queryByTestId('probe-generic')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新加载文档' }))
    const probe = await screen.findByTestId('probe-generic')
    await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
    expect(probe.getAttribute('data-revision')).toBe('2')
  })

  it('reloads through renderer actions and bumps the revision and text', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'md', kinds: ['markdown'], render: props => {
      const Probe = probeRenderer('md')
      return <Probe {...props} />
    } })
    let generation = 0
    const readDocument = vi.fn(async (path: string) => {
      generation += 1
      return { id: path, name: 'notes.md', path, kind: 'markdown' as const, content: `# gen ${generation}` }
    })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.md" />)
    const probe = await screen.findByTestId('probe-md')
    expect(probe.getAttribute('data-text')).toBe('# gen 1')
    fireEvent.click(screen.getByRole('button', { name: 'probe reload' }))
    await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('probe-md').getAttribute('data-revision')).toBe('2'))
    expect(screen.getByTestId('probe-md').getAttribute('data-text')).toBe('# gen 2')
  })

  it('watches the document and reloads the renderer on a matching documentChanged event', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'md', kinds: ['markdown'], render: props => {
      const Probe = probeRenderer('md')
      return <Probe {...props} />
    } })
    let generation = 0
    const readDocument = vi.fn(async (path: string) => {
      generation += 1
      return { id: path, name: 'notes.md', path, kind: 'markdown' as const, content: `# gen ${generation}` }
    })
    const listeners = new Set<(event: { type: 'documentChanged'; path: string }) => void>()
    const host = {
      ...documentHost(readDocument),
      watchDocument: vi.fn(async () => undefined),
      unwatchDocument: vi.fn(async () => undefined),
      subscribeDocuments: (listener: (event: { type: 'documentChanged'; path: string }) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/work/notes.md" />)
    await screen.findByTestId('probe-md')
    await waitFor(() => expect(host.watchDocument).toHaveBeenCalledWith('/work/notes.md'))
    for (const listener of [...listeners]) listener({ type: 'documentChanged', path: '/work/notes.md' })
    await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('probe-md').getAttribute('data-revision')).toBe('2'))
  })

  it('surfaces a closable oversize error from the host read', async () => {
    const readDocument = vi.fn(async () => {
      throw Object.assign(new Error('文档超过 32MB 大小限制'), { code: 'document_too_large' })
    })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/big.xlsx" />)
    expect((await screen.findByRole('alert')).textContent).toContain('文档超过 32MB 大小限制')
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the current renderer across a parent rerender of the same request', async () => {
    const snapshots: Array<{ name: string; documentId: string; bytes: number }> = []
    registerDocumentRenderer(TEST_EXT, {
      id: 'stable-rerender',
      kinds: ['pdf'],
      priority: 50,
      render: props => {
        snapshots.push({ name: props.document.name, documentId: props.document.documentId, bytes: props.bytes?.length ?? -1 })
        const Probe = probeRenderer('stable')
        return <Probe {...props} />
      },
    })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    const host = documentHost(readDocument)
    const { rerender } = render(<DocumentPanel host={host} documentPath="/work/report.pdf" />)
    const probe = await screen.findByTestId('probe-stable')
    const documentId = probe.getAttribute('data-document-id')
    rerender(<DocumentPanel host={host} documentPath="/work/report.pdf" />)
    expect(screen.getByTestId('probe-stable')).toBe(probe)
    expect(screen.getByTestId('probe-stable').getAttribute('data-document-id')).toBe(documentId)
    expect(readDocument).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(snapshots.every(item => item.name === 'report.pdf' && item.documentId === documentId && item.bytes === 4)).toBe(true)
  })

  it('does not mix stale document bytes with a new path', async () => {
    const snapshots: Array<{ name: string; documentId: string; bytes: number; revision: number }> = []
    registerDocumentRenderer(TEST_EXT, {
      id: 'atomic-path',
      kinds: ['pdf'],
      priority: 50,
      render: props => {
        snapshots.push({
          name: props.document.name,
          documentId: props.document.documentId,
          bytes: props.bytes?.length ?? -1,
          revision: props.document.revision,
        })
        const Probe = probeRenderer('atomic')
        return <Probe {...props} />
      },
    })
    let releaseSecond: ((value: { id: string; name: string; path: string; kind: 'pdf'; size: number; bytes: Uint8Array }) => void) | undefined
    const readDocument = vi.fn(async (path: string) => {
      if (path.endsWith('one.pdf')) {
        return { id: path, name: 'one.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }
      }
      return new Promise<{ id: string; name: string; path: string; kind: 'pdf'; size: number; bytes: Uint8Array }>(resolve => {
        releaseSecond = resolve
      })
    })
    const host = documentHost(readDocument)
    const { rerender } = render(<DocumentPanel host={host} documentPath="/work/one.pdf" />)
    const first = await screen.findByTestId('probe-atomic')
    const firstId = first.getAttribute('data-document-id')!
    expect(first.getAttribute('data-bytes')).toBe('4')

    rerender(<DocumentPanel host={host} documentPath="/work/two.pdf" />)
    expect(screen.getByRole('status').textContent).toContain('正在读取文档')
    expect(screen.queryByTestId('probe-atomic')).toBeNull()

    releaseSecond?.({ id: '/work/two.pdf', name: 'two.pdf', path: '/work/two.pdf', kind: 'pdf', size: 8, bytes: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) })
    const second = await screen.findByTestId('probe-atomic')
    const secondId = second.getAttribute('data-document-id')!
    expect(secondId).not.toBe(firstId)
    expect(second.getAttribute('data-name')).toBe('two.pdf')
    expect(second.getAttribute('data-bytes')).toBe('8')
    expect(JSON.stringify(lastProps)).not.toContain('/work/one.pdf')
    expect(JSON.stringify(lastProps)).not.toContain('/work/two.pdf')

    for (const snap of snapshots) {
      if (snap.documentId === firstId) {
        expect(snap.name).toBe('one.pdf')
        expect(snap.bytes).toBe(4)
      }
      if (snap.documentId === secondId) {
        expect(snap.name).toBe('two.pdf')
        expect(snap.bytes).toBe(8)
      }
    }
  })

  it('shows loading on reload and never hands a renderer mixed generation content', async () => {
    const snapshots: Array<{ revision: number; text: string }> = []
    registerDocumentRenderer(TEST_EXT, {
      id: 'reload-atomic',
      kinds: ['markdown'],
      render: props => {
        snapshots.push({ revision: props.document.revision, text: props.text ?? '' })
        const Probe = probeRenderer('reload-atomic')
        return <Probe {...props} />
      },
    })
    let generation = 0
    let release: (() => void) | undefined
    const readDocument = vi.fn(async (path: string) => {
      generation += 1
      const doc = { id: path, name: 'notes.md', path, kind: 'markdown' as const, content: `# gen ${generation}` }
      if (generation === 1) return doc
      return new Promise<typeof doc>(resolve => { release = () => resolve(doc) })
    })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.md" />)
    await screen.findByTestId('probe-reload-atomic')
    fireEvent.click(screen.getByRole('button', { name: 'probe reload' }))
    expect(screen.getByRole('status').textContent).toContain('正在读取文档')
    expect(screen.queryByTestId('probe-reload-atomic')).toBeNull()
    release?.()
    await waitFor(() => expect(screen.getByTestId('probe-reload-atomic').getAttribute('data-revision')).toBe('2'))
    expect(screen.getByTestId('probe-reload-atomic').getAttribute('data-text')).toBe('# gen 2')
    for (const snap of snapshots) {
      if (snap.revision === 1) expect(snap.text).toBe('# gen 1')
      if (snap.revision === 2) expect(snap.text).toBe('# gen 2')
    }
  })
})

describe('generic anydoc fallback (host-owned, path-free renderer)', () => {
  it('converts through the host when a renderer asks for generic fallback and never leaks the path', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], priority: 50, render: props => {
      const Probe = probeRenderer('word')
      return <Probe {...props} />
    } })
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    const convertDocumentToMarkdown = vi.fn(async () => '# 通用回退')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    const probe = await screen.findByTestId('probe-word')
    expect(JSON.stringify(lastProps)).not.toContain('/tmp/form.docx')
    expect(probe.getAttribute('data-actions')).toBe('openExternally,reload,useGenericFallback')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByRole('heading', { name: '通用回退' })).toBeTruthy()
    expect(screen.getByTestId('document-fallback')).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith('/tmp/form.docx')
    expect(convertDocumentToMarkdown).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(lastProps)).not.toContain('/tmp/form.docx')
  })

  it('isolates generic fallback to the requesting surface', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], priority: 50, render: props => {
      const Probe = probeRenderer(props.document.name)
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readA = vi.fn(async (path: string) => ({ id: path, name: 'alpha.docx', path, kind: 'word' as const, size: bytes.byteLength, bytes }))
    const readB = vi.fn(async (path: string) => ({ id: path, name: 'beta.docx', path, kind: 'word' as const, size: bytes.byteLength, bytes }))
    const convertA = vi.fn(async () => '# alpha fallback')
    const convertB = vi.fn(async () => '# beta fallback')
    render(<>
      <DocumentPanel host={{ ...documentHost(readA), convertDocumentToMarkdown: convertA } as unknown as PipiHostAPI} documentPath="/tmp/alpha.docx" />
      <DocumentPanel host={{ ...documentHost(readB), convertDocumentToMarkdown: convertB } as unknown as PipiHostAPI} documentPath="/tmp/beta.docx" />
    </>)
    await waitFor(() => expect(screen.getAllByTestId(/probe-/)).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: 'probe fallback' })[0]!)
    expect(await screen.findByRole('heading', { name: 'alpha fallback' })).toBeTruthy()
    expect(convertA).toHaveBeenCalledTimes(1)
    expect(convertB).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'beta fallback' })).toBeNull()
    expect(screen.getByTestId('probe-beta.docx')).toBeTruthy()
  })

  it('does not apply a stale anydoc conversion after the document path switches', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], priority: 50, render: props => {
      const Probe = probeRenderer(props.document.name)
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    let releaseOld: ((value: string) => void) | undefined
    const convertOld = vi.fn(() => new Promise<string>(resolve => { releaseOld = resolve }))
    const convertNew = vi.fn(async () => '# new fallback')
    const readOld = vi.fn(async (path: string) => ({ id: path, name: 'old.docx', path, kind: 'word' as const, size: bytes.byteLength, bytes }))
    const readNew = vi.fn(async (path: string) => ({ id: path, name: 'new.docx', path, kind: 'word' as const, size: bytes.byteLength, bytes }))
    const { rerender } = render(
      <DocumentPanel host={{ ...documentHost(readOld), convertDocumentToMarkdown: convertOld } as unknown as PipiHostAPI} documentPath="/tmp/old.docx" />,
    )
    await screen.findByTestId('probe-old.docx')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    await waitFor(() => expect(convertOld).toHaveBeenCalledTimes(1))
    rerender(
      <DocumentPanel host={{ ...documentHost(readNew), convertDocumentToMarkdown: convertNew } as unknown as PipiHostAPI} documentPath="/tmp/new.docx" />,
    )
    await screen.findByTestId('probe-new.docx')
    releaseOld?.('# stale old markdown')
    await waitFor(() => expect(screen.getByTestId('probe-new.docx')).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'stale old markdown' })).toBeNull()
    expect(screen.queryByTestId('document-fallback')).toBeNull()
    expect(convertNew).not.toHaveBeenCalled()
  })
})

describe('core PDF asset base vs Office global lease', () => {
  it('keeps PDF instance assetBaseUrl stable while an Office renderer holds the global lease', async () => {
    const readPdf = vi.fn(async (path: string) => ({
      id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]),
    }))
    const officeProps: DocumentRendererProps = {
      document: {
        documentId: 'office-1',
        name: 'form.docx',
        extension: '.docx',
        documentKind: 'word',
        size: 4,
        revision: 1,
      },
      bytes: new Uint8Array([1, 2, 3, 4]),
      actions: {
        reload: async () => undefined,
        openExternally: async () => undefined,
        useGenericFallback: async () => undefined,
      },
    }
    const tree = <>
      <DocumentPanel host={documentHost(readPdf)} documentPath="/work/report.pdf" />
      <OfficeRenderer {...officeProps} />
    </>
    const view = render(tree)
    await screen.findByTestId('office-renderer')
    const pdfNode = await waitFor(() => {
      const node = document.querySelector('[data-type="pdf"]')
      if (!(node instanceof HTMLElement)) throw new Error('pdf viewer missing')
      return node
    })
    const expected = corePdfAssetBaseUrl()
    expect(pdfNode.getAttribute('data-pdf-asset-base')).toBe(expected)
    expect(pdfNode.getAttribute('data-pdf-worker')).toContain('file-viewer')
    expect(expected).toMatch(/file-viewer\/?$/)
    setDefaultFileViewerAssetBaseUrl('https://office-lease.test/file-viewer/')
    view.rerender(tree)
    const pdfAfter = document.querySelector('[data-type="pdf"]')
    expect(pdfAfter).toBeTruthy()
    expect(pdfAfter!.getAttribute('data-pdf-asset-base')).toBe(expected)
    expect(pdfAfter!.getAttribute('data-pdf-asset-base')).not.toContain('office-lease.test')
    expect(pdfAfter!.getAttribute('data-pdf-worker')).toContain('vendor/pdf')
    expect(pdfAfter!.getAttribute('data-pdf-worker')).not.toContain('office-lease.test')
    expect(resolveFileViewerPdfAssetUrls().workerUrl).toContain('office-lease.test')
  })
})

describe('builtin PDF minimal floating zoom', () => {
  const ZOOM_SHOWN = { label: '67%', scale: 0.67, canZoomIn: true, canZoomOut: true }

  async function renderBuiltinPdf(name = 'paper.pdf') {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name, path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath={`/work/${name}`} />)
    await screen.findByTestId('office-viewer')
    return name
  }

  type ViewerModule = {
    __emitViewerStateFor: (name: string, state: { error?: unknown; zoom?: typeof ZOOM_SHOWN | null }) => void
    __optionsFor: (name: string) => { toolbar?: unknown; pdf?: { toolbar?: boolean } } | undefined
    __handleFor: (name: string) => { zoomIn: ReturnType<typeof vi.fn>; zoomOut: ReturnType<typeof vi.fn>; resetZoom: ReturnType<typeof vi.fn> } | undefined
  }

  it('hides both built-in toolbars (generic + pdf-specific)', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as ViewerModule
    const name = await renderBuiltinPdf()
    const options = viewerModule.__optionsFor(name)
    expect(options?.toolbar).toBe(false)
    expect(options?.pdf?.toolbar).toBe(false)
  })

  it('shows the floating pill only after the viewer reports zoom state', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as ViewerModule
    const name = await renderBuiltinPdf()
    expect(screen.queryByRole('group', { name: '缩放' })).toBeNull()
    act(() => { viewerModule.__emitViewerStateFor(name, { zoom: ZOOM_SHOWN }) })
    expect(screen.getByRole('group', { name: '缩放' }).textContent).toContain('67%')
  })

  it('drops the pill when the document switches before the next viewer reports', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as ViewerModule
    const readDocument = vi.fn(async (path: string) => path.endsWith('.md')
      ? { id: path, name: 'notes.md', path, kind: 'markdown' as const, size: 7, content: '# notes' }
      : { id: path, name: 'paper.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) })
    const host = documentHost(readDocument)
    const view = render(<DocumentPanel host={host} documentPath="/work/paper.pdf" />)
    await screen.findByTestId('office-viewer')
    act(() => { viewerModule.__emitViewerStateFor('paper.pdf', { zoom: ZOOM_SHOWN }) })
    expect(screen.getByRole('group', { name: '缩放' })).toBeTruthy()
    view.rerender(<DocumentPanel host={host} documentPath="/work/notes.md" />)
    await screen.findByRole('heading', { name: 'notes' })
    expect(screen.queryByRole('group', { name: '缩放' })).toBeNull()
  })

  it('wires the pill buttons to the viewer zoom API', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as ViewerModule
    const name = await renderBuiltinPdf()
    act(() => { viewerModule.__emitViewerStateFor(name, { zoom: ZOOM_SHOWN }) })
    const handle = viewerModule.__handleFor(name)
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '重置缩放' }))
    expect(handle?.zoomOut).toHaveBeenCalledTimes(1)
    expect(handle?.zoomIn).toHaveBeenCalledTimes(1)
    expect(handle?.resetZoom).toHaveBeenCalledTimes(1)
  })
})

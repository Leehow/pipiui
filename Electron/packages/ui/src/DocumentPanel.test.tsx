// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentContent, PipiHostAPI } from '@pipi/host-api'
import type { DocumentRendererProps } from '@pipiui/extension-api'
import { DocumentPanel } from './DocumentPanel'
import { disposeDocumentRenderers, registerDocumentRenderer } from './ui-registries'

vi.mock('@file-viewer/react', async () => {
  const React = await import('react')
  type ViewerStateSink = (state: { error?: unknown }) => void
  const sinks = new Set<ViewerStateSink>()
  // 回归观测：记录每次渲染收到的 options/onStateChange 身份。@file-viewer/react 把二者放
  // 进 viewerOptions memo 依赖，身份漂移会触发 controller.update() 用已 detach 的 buffer 重载。
  const seenViewerOptions: unknown[] = []
  const seenStateHandlers: unknown[] = []
  const MockViewer = ({ buffer, name, type, className, onStateChange, options }: { buffer: ArrayBuffer; name: string; type: string; className?: string; onStateChange?: ViewerStateSink; options?: unknown }) => {
    const [generations, setGenerations] = React.useState(0)
    seenViewerOptions.push(options)
    seenStateHandlers.push(onStateChange)
    React.useEffect(() => { setGenerations(count => count + 1) }, [buffer])
    React.useEffect(() => {
      if (!onStateChange) return
      sinks.add(onStateChange)
      return () => { sinks.delete(onStateChange) }
    }, [onStateChange])
    return <div className={className} data-testid="office-viewer" data-name={name} data-type={type} data-size={buffer.byteLength} data-generations={String(generations)} />
  }
  return {
    default: MockViewer,
    // Tests simulate FileViewer failures by broadcasting a ViewerState.
    __emitViewerState: (state: { error?: unknown }) => { for (const sink of [...sinks]) sink(state) },
    __seenViewerOptions: seenViewerOptions,
    __seenStateHandlers: seenStateHandlers,
  }
})
vi.mock('@file-viewer/renderer-pdf', () => ({ pdfRenderer: { id: 'pdf' } }))

const TEST_EXT = 'document-panel-office-removed'

afterEach(() => {
  cleanup()
  disposeDocumentRenderers(TEST_EXT)
})

function officeProbe(id: string) {
  return function Probe(props: DocumentRendererProps) {
    return <div data-testid={`probe-${id}`}
      data-name={props.document.name}
      data-kind={props.document.documentKind}
      data-extension={props.document.extension}
      data-actions={Object.keys(props.actions ?? {}).sort().join(',')}>
      <button onClick={() => void props.actions.useGenericFallback()}>probe fallback</button>
    </div>
  }
}

function documentHost(readDocument: NonNullable<PipiHostAPI['readDocument']> = vi.fn(async (path: string) => ({ id: path, name: 'README.md', path, kind: 'markdown' as const, size: 42, content: '# Project README\n\n**Rendered** from the host.' }))): PipiHostAPI {
  return { protocolVersion: 2, readDocument } as unknown as PipiHostAPI
}

describe('DocumentPanel', () => {
  it('stays empty until a transcript card explicitly opens a document', () => {
    const host = documentHost()
    render(<DocumentPanel host={host} />)
    expect(screen.getByTestId('document-empty').textContent).toContain('拖进右侧面板')
    expect(host.readDocument).not.toHaveBeenCalled()
    expect(screen.queryByText(/文件列表|个文件|正在同步/)).toBeNull()
  })

  it('renders TXT natively as readable plain text', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'notes.txt', path, kind: 'plain' as const, content: 'line one\nline two' }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/notes.txt" />)
    const text = await screen.findByLabelText('文档内容 notes.txt')
    expect(text.tagName).toBe('PRE')
    expect(text.textContent).toBe('line one\nline two')
  })

  it('routes PDF bytes to the builtin file viewer', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/report.pdf" />)
    const viewer = await screen.findByTestId('office-viewer')
    expect(viewer.className).toContain('document-file-viewer')
    expect(viewer.getAttribute('data-name')).toBe('report.pdf')
    expect(viewer.getAttribute('data-type')).toBe('pdf')
    expect(viewer.getAttribute('data-size')).toBe('4')
  })

  it('starts host anydoc conversion when a renderer asks for generic fallback', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], render: props => {
      const Probe = officeProbe('word')
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    const convertDocumentToMarkdown = vi.fn(async () => '# 转换后的标题\n\n本地转换的正文内容。')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    await screen.findByTestId('probe-word')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByRole('heading', { name: '转换后的标题' })).toBeTruthy()
    expect(screen.getByTestId('document-fallback')).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith('/tmp/form.docx')
    expect(screen.getByText('本地转换的正文内容。')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a closable PDF viewer error and never calls anydoc', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as { __emitViewerState: (state: { error?: unknown }) => void }
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    const convertDocumentToMarkdown = vi.fn(async () => '# should never render')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/report.pdf" />)
    await screen.findByTestId('office-viewer')
    viewerModule.__emitViewerState({ error: new Error('wasm load failed') })
    expect((await screen.findByRole('alert')).textContent).toContain('wasm load failed')
    expect(convertDocumentToMarkdown).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    await screen.findByTestId('office-viewer')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('replaces the PDF toolbar row with a floating zoom pill', () => {
    const css = readFileSync(join(import.meta.dirname, 'document-panel.css'), 'utf8')
    expect(css).not.toContain('::part(toolbar)')
    expect(css).not.toContain('::part(input)')
    expect(css).toMatch(/\.document-pdf-preview\{[^}]*position:relative/)
    expect(css).toMatch(/\.pdf-zoom-pill\{[^}]*position:absolute/)
    expect(css).not.toContain('document-office-preview')
  })

  it('can fall back to the OS default app and surfaces a closable shell error', async () => {
    const openDocumentExternally = vi.fn().mockRejectedValue(new Error('No application can open this document'))
    const host = { ...documentHost(), openDocumentExternally } as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/work/README.md" />)
    await screen.findByRole('heading', { name: 'Project README' })
    fireEvent.click(screen.getByRole('button', { name: '用默认应用打开文档' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No application can open this document')
    expect(openDocumentExternally).toHaveBeenCalledWith('/work/README.md')
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads the requested path and renders Markdown instead of raw preformatted text', async () => {
    const host = documentHost()
    render(<DocumentPanel host={host} documentPath="/work/README.md" />)
    expect(await screen.findByRole('heading', { name: 'Project README' })).toBeTruthy()
    expect(screen.getByText('Rendered')).toBeTruthy()
    expect(screen.getByLabelText('文档内容 README.md').tagName).toBe('ARTICLE')
    expect(host.readDocument).toHaveBeenCalledWith('/work/README.md')
    expect(document.querySelector('.document-preview-text')).toBeNull()
  })

  it('shows a closable persistent error and retries successfully', async () => {
    const readDocument = vi.fn()
      .mockRejectedValueOnce(new Error('文件不存在'))
      .mockResolvedValueOnce({ id: '/work/missing.md', name: 'missing.md', path: '/work/missing.md', kind: 'markdown', content: '# Recovered' })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/missing.md" />)
    expect((await screen.findByRole('alert')).textContent).toContain('文件不存在')
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新加载文档' }))
    expect(await screen.findByRole('heading', { name: 'Recovered' })).toBeTruthy()
    await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
  })

  it('reloads when the host announces a matching documentChanged event', async () => {
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
      }
    } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/work/notes.md" />)
    await screen.findByRole('heading', { name: 'gen 1' })
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
    for (const listener of [...listeners]) listener({ type: 'documentChanged', path: '/work/notes.md' })
    await waitFor(() => expect(readDocument.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(host.watchDocument).toHaveBeenCalledWith('/work/notes.md')
  })

  it('maps a missing-file host error to 文件已不存在', async () => {
    const error = Object.assign(new Error('Document does not exist: /gone.md'), { code: 'document_not_found' })
    const readDocument = vi.fn(async () => { throw error })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/gone.md" />)
    expect((await screen.findByRole('alert')).textContent).toContain('文件已不存在')
  })

  it('does not reload a PDF preview when the parent re-renders with the same document', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes }))
    const host = documentHost(readDocument)
    function Harness({ tick }: { tick: number }) {
      return <>
        <span data-testid="parent-tick">{tick}</span>
        <DocumentPanel host={host} documentPath="/tmp/report.pdf" />
      </>
    }
    const { rerender } = render(<Harness tick={1} />)
    const viewer = await screen.findByTestId('office-viewer')
    await waitFor(() => expect(viewer.getAttribute('data-generations')).toBe('1'))
    expect(readDocument).toHaveBeenCalledTimes(1)
    rerender(<Harness tick={2} />)
    expect(screen.getByTestId('parent-tick').textContent).toBe('2')
    expect(screen.getByTestId('office-viewer')).toBe(viewer)
    expect(screen.getByTestId('office-viewer').getAttribute('data-generations')).toBe('1')
    expect(readDocument).toHaveBeenCalledTimes(1)
  })

  it('keeps viewer options and state-handler identity stable across zoom state reports', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/report.pdf" />)
    await screen.findByTestId('office-viewer')
    const viewerModule = await import('@file-viewer/react') as unknown as {
      __emitViewerState: (state: { zoom?: { scale: number; label: string; canZoomIn: boolean; canZoomOut: boolean }; error?: unknown }) => void
      __seenViewerOptions: unknown[]
      __seenStateHandlers: unknown[]
    }
    const optionsBefore = viewerModule.__seenViewerOptions.length
    const handlersBefore = viewerModule.__seenStateHandlers.length
    // 首次缩放状态上报 → setState → 重渲染。回归：重渲染不得更换 options/onStateChange 身份，
    // 否则 viewer 会 controller.update() 用已被 pdf.js detach 的同一 buffer 重载文档并崩溃。
    viewerModule.__emitViewerState({ zoom: { scale: 1, label: '100%', canZoomIn: true, canZoomOut: true } })
    expect(await screen.findByRole('group', { name: '缩放' })).toBeTruthy()
    viewerModule.__emitViewerState({ zoom: { scale: 1.25, label: '125%', canZoomIn: true, canZoomOut: true } })
    expect(await screen.findByText('125%')).toBeTruthy()
    const optionsSeen = viewerModule.__seenViewerOptions.slice(optionsBefore)
    const handlersSeen = viewerModule.__seenStateHandlers.slice(handlersBefore)
    expect(optionsSeen.length).toBeGreaterThan(1)
    expect(new Set(optionsSeen).size).toBe(1)
    expect(new Set(handlersSeen).size).toBe(1)
  })
})

describe('DocumentPanel generic fallback (T1 anydoc contract, T4 host-owned)', () => {
  it('converts spreadsheet and presentation binaries through host anydoc after useGenericFallback', async () => {
    registerDocumentRenderer(TEST_EXT, {
      id: 'office-probe',
      kinds: ['spreadsheet', 'presentation'],
      render: props => {
        const Probe = officeProbe(props.document.documentKind)
        return <Probe {...props} />
      },
    })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) =>
      path.endsWith('.pptx')
        ? { id: path, name: 'deck.pptx', path, kind: 'presentation' as const, size: bytes.byteLength, updatedAt: 1, bytes }
        : { id: path, name: '台账.xlsx', path, kind: 'spreadsheet' as const, size: bytes.byteLength, updatedAt: 1, bytes })
    const convertDocumentToMarkdown = vi.fn(async (path: string) => path.endsWith('.pptx') ? '# 幻灯回退' : '# 表格回退')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    const { rerender } = render(<DocumentPanel host={host} documentPath="/tmp/台账.xlsx" />)
    await screen.findByTestId('probe-spreadsheet')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByRole('heading', { name: '表格回退' })).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith('/tmp/台账.xlsx')

    rerender(<DocumentPanel host={host} documentPath="/tmp/deck.pptx" />)
    await screen.findByTestId('probe-presentation')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByRole('heading', { name: '幻灯回退' })).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith('/tmp/deck.pptx')
  })

  it('keeps a closable generic error when the anydoc conversion itself fails', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], render: props => {
      const Probe = officeProbe('word')
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    const convertDocumentToMarkdown = vi.fn(async () => { throw new Error('anydoc engine missing') })
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    await screen.findByTestId('probe-word')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('无法将文档转换为可读文本')
    expect(screen.queryByTestId('document-fallback')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    await screen.findByTestId('probe-word')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a closable generic error when the conversion yields empty markdown', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], render: props => {
      const Probe = officeProbe('word')
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    const convertDocumentToMarkdown = vi.fn(async () => '')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    await screen.findByTestId('probe-word')
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('无法将文档转换为可读文本')
    expect(convertDocumentToMarkdown).toHaveBeenCalledTimes(1)
  })

  it('never routes PDF viewer failures to the anydoc fallback', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as { __emitViewerState: (state: { error?: unknown }) => void }
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, updatedAt: 1, bytes: new Uint8Array([1, 2, 3, 4]) }))
    const convertDocumentToMarkdown = vi.fn(async () => '# should never render')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/report.pdf" />)
    await screen.findByTestId('office-viewer')
    viewerModule.__emitViewerState({ error: new Error('pdf engine failed') })
    expect((await screen.findByRole('alert')).textContent).toContain('pdf engine failed')
    expect(convertDocumentToMarkdown).not.toHaveBeenCalled()
  })

  it('shows a deterministic error when the host returns invalid office content', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'broken.docx', path, kind: 'word' as const, size: 4, content: 'no bytes here' }) as unknown as DocumentContent)
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/broken.docx" />)
    expect((await screen.findByRole('alert')).textContent).toContain('宿主返回了无效的文档内容')
  })

  it('shows a deterministic error for unsupported document types', async () => {
    const readDocument = vi.fn(async () => { throw Object.assign(new Error('unsupported document type'), { code: 'document_unsupported_type' }) })
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/template.dot" />)
    expect((await screen.findByRole('alert')).textContent).toContain('unsupported document type')
    expect(screen.queryByTestId('office-viewer')).toBeNull()
  })

  it('preserves Chinese and space-containing names through generic fallback without leaking the path to the renderer', async () => {
    let seen: DocumentRendererProps | null = null
    registerDocumentRenderer(TEST_EXT, { id: 'sheet-probe', kinds: ['spreadsheet'], render: props => {
      seen = props
      const Probe = officeProbe('sheet')
      return <Probe {...props} />
    } })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const path = '/工作 目录/2026 报告 表格.xlsx'
    const readDocument = vi.fn(async () => ({ id: path, name: '2026 报告 表格.xlsx', path, kind: 'spreadsheet' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    const convertDocumentToMarkdown = vi.fn(async () => '# 空格路径回退成功')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath={path} />)
    await screen.findByTestId('probe-sheet')
    expect(JSON.stringify(seen)).not.toContain(path)
    fireEvent.click(screen.getByRole('button', { name: 'probe fallback' }))
    expect(await screen.findByRole('heading', { name: '空格路径回退成功' })).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith(path)
    expect(JSON.stringify(seen)).not.toContain(path)
  })

  it('reloads binary bytes only for a matching documentChanged event', async () => {
    registerDocumentRenderer(TEST_EXT, { id: 'word-probe', kinds: ['word'], render: props => (
      <div data-testid="probe-word" data-size={String(props.bytes?.length ?? -1)} data-revision={String(props.document.revision)} />
    ) })
    const listeners = new Set<(event: { type: 'documentChanged'; path: string }) => void>()
    let generation = 0
    const readDocument = vi.fn(async (path: string) => {
      generation += 1
      const bytes = generation === 1 ? new Uint8Array([1, 2, 3, 4]) : new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      return { id: path, name: 'form.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: generation, bytes }
    })
    const host = {
      ...documentHost(readDocument),
      watchDocument: vi.fn(async () => undefined),
      unwatchDocument: vi.fn(async () => undefined),
      subscribeDocuments: (listener: (event: { type: 'documentChanged'; path: string }) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    const first = await screen.findByTestId('probe-word')
    await waitFor(() => expect(first.getAttribute('data-size')).toBe('4'))
    for (const listener of [...listeners]) listener({ type: 'documentChanged', path: '/tmp/form.docx' })
    await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('probe-word').getAttribute('data-size')).toBe('8'))
    for (const listener of [...listeners]) listener({ type: 'documentChanged', path: '/tmp/other.docx' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readDocument).toHaveBeenCalledTimes(2)
  })
})

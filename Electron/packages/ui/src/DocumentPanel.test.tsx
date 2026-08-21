// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import { DocumentPanel } from './DocumentPanel'

vi.mock('@file-viewer/react', async () => {
  const React = await import('react')
  type ViewerStateSink = (state: { error?: unknown }) => void
  const sinks = new Set<ViewerStateSink>()
  const MockViewer = ({ buffer, name, type, className, onStateChange }: { buffer: ArrayBuffer; name: string; type: string; className?: string; onStateChange?: ViewerStateSink }) => {
    const [generations, setGenerations] = React.useState(0)
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
    __emitViewerState: (state: { error?: unknown }) => { for (const sink of [...sinks]) sink(state) }
  }
})
vi.mock('@file-viewer/preset-office', () => ({ default: { id: 'office' } }))

afterEach(cleanup)

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

  it('routes PDF and Office bytes to the mature file viewer', async () => {
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'report.pdf', path, kind: 'pdf' as const, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/work/report.pdf" />)
    const viewer = await screen.findByTestId('office-viewer')
    expect(viewer.className).toContain('document-file-viewer')
    expect(viewer.getAttribute('data-name')).toBe('report.pdf')
    expect(viewer.getAttribute('data-type')).toBe('pdf')
    expect(viewer.getAttribute('data-size')).toBe('4')
  })

  it('renders a .docx word document in the FileViewer without throwing', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x05, 0x06])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: '托班幼儿基本情况调查表.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/托班幼儿基本情况调查表.docx" />)
    const viewer = await screen.findByTestId('office-viewer')
    expect(viewer.getAttribute('data-name')).toBe('托班幼儿基本情况调查表.docx')
    expect(viewer.getAttribute('data-type')).toBe('docx')
    expect(viewer.getAttribute('data-size')).toBe(String(bytes.byteLength))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to locally converted markdown when the office viewer fails', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as { __emitViewerState: (state: { error?: unknown }) => void }
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.docx', path, kind: 'word' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    const convertDocumentToMarkdown = vi.fn(async () => '# 转换后的标题\n\n本地转换的正文内容。')
    const host = { ...documentHost(readDocument), convertDocumentToMarkdown } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} documentPath="/tmp/form.docx" />)
    await screen.findByTestId('office-viewer')
    viewerModule.__emitViewerState({ error: new Error('renderer engine failed') })
    expect(await screen.findByRole('heading', { name: '转换后的标题' })).toBeTruthy()
    expect(screen.getByTestId('document-fallback')).toBeTruthy()
    expect(convertDocumentToMarkdown).toHaveBeenCalledWith('/tmp/form.docx')
    expect(screen.getByText('本地转换的正文内容。')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a closable viewer error when no markdown conversion is available', async () => {
    const viewerModule = await import('@file-viewer/react') as unknown as { __emitViewerState: (state: { error?: unknown }) => void }
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'slides.pptx', path, kind: 'presentation' as const, size: bytes.byteLength, updatedAt: 1, bytes }))
    render(<DocumentPanel host={documentHost(readDocument)} documentPath="/tmp/slides.pptx" />)
    await screen.findByTestId('office-viewer')
    viewerModule.__emitViewerState({ error: new Error('wasm load failed') })
    expect((await screen.findByRole('alert')).textContent).toContain('wasm load failed')
    fireEvent.click(screen.getByRole('button', { name: '关闭文档错误' }))
    await screen.findByTestId('office-viewer')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the office search toolbar inside the tools pane instead of the window width', () => {
    const css = readFileSync(join(import.meta.dirname, 'document-panel.css'), 'utf8')
    expect(css).toMatch(/\.document-file-viewer::part\(toolbar\)\{[^}]*max-width:100%/)
    expect(css).toMatch(/\.document-file-viewer::part\(toolbar\)\{[^}]*flex-wrap:wrap/)
    expect(css).toMatch(/\.document-file-viewer::part\(input\)\{[^}]*max-width:100%/)
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

  it('does not reload an Office preview when the parent re-renders with the same document', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const readDocument = vi.fn(async (path: string) => ({ id: path, name: 'form.doc', path, kind: 'word' as const, size: 4, bytes }))
    const host = documentHost(readDocument)
    function Harness({ tick }: { tick: number }) {
      return <>
        <span data-testid="parent-tick">{tick}</span>
        <DocumentPanel host={host} documentPath="/tmp/form.doc" />
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
})

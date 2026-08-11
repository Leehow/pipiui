// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentContent, DocumentSummary, PipiHostAPI } from '@pipi/host-api'
import { DocumentPanel } from './DocumentPanel'

afterEach(cleanup)

const files: DocumentSummary[] = [
  { id: 'readme', name: 'README.md', path: '/work/README.md', kind: 'markdown', size: 120 },
  { id: 'notes', name: 'notes.txt', path: '/work/docs/notes.txt', kind: 'plain', size: 42 }
]
const contents: Record<string, DocumentContent> = {
  readme: { ...files[0], content: '# Project README\n\nPreviewed from the host.' },
  notes: { ...files[1], content: 'Plain text preview\nSecond line' }
}

function documentHost(items: DocumentSummary[] = files): PipiHostAPI {
  return {
    protocolVersion: 2,
    listDocuments: vi.fn(async () => items),
    readDocument: vi.fn(async id => {
      const document = contents[id]
      if (!document) throw new Error(`Unknown document: ${id}`)
      return document
    })
  } as unknown as PipiHostAPI
}

describe('DocumentPanel', () => {
  it('renders host document list with a default selection', async () => {
    const host = documentHost()
    render(<DocumentPanel host={host} />)

    expect(await screen.findByRole('button', { name: '预览 README.md' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '预览 notes.txt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '预览 README.md' }).getAttribute('aria-pressed')).toBe('true')
    expect(host.listDocuments).toHaveBeenCalledTimes(1)
  })

  it('loads and changes the selected text preview', async () => {
    const host = documentHost()
    render(<DocumentPanel host={host} />)

    expect((await screen.findByLabelText('文档内容 README.md')).textContent).toContain('Previewed from the host.')
    fireEvent.click(screen.getByRole('button', { name: '预览 notes.txt' }))
    expect((await screen.findByLabelText('文档内容 notes.txt')).textContent).toContain('Plain text preview')
    await waitFor(() => expect(host.readDocument).toHaveBeenLastCalledWith('notes'))
  })

  it('shows an empty state when the host reports no documents', async () => {
    render(<DocumentPanel host={documentHost([])} />)

    expect((await screen.findByTestId('document-empty')).textContent).toContain('没有可预览的文档')
    expect(screen.queryByLabelText('文档列表')).toBeNull()
  })

  it('uses bundled mock documents when an older host omits the optional APIs', async () => {
    const host = { protocolVersion: 2 } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} />)

    expect(await screen.findByRole('button', { name: '预览 README.md' })).toBeTruthy()
    expect((await screen.findByLabelText('文档内容 README.md')).textContent).toContain('右侧面板把会话工具、文档与终端放在同一个工作区。')
  })

  it('falls back to a safe text preview when the host cannot read a listed document', async () => {
    const unavailable: DocumentSummary = { id: 'unavailable', name: 'unavailable.md', path: '/work/unavailable.md', kind: 'markdown', size: 7 }
    const readDocument = vi.fn(async () => { throw new Error('host content unavailable') })
    const host = { protocolVersion: 2, listDocuments: vi.fn(async () => [unavailable]), readDocument } as unknown as PipiHostAPI
    render(<DocumentPanel host={host} />)

    expect((await screen.findByLabelText('文档内容 unavailable.md')).textContent).toContain('当前宿主尚未提供该文件的内容')
    expect(readDocument).toHaveBeenCalledWith('unavailable')
  })
})

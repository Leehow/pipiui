// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import { DocumentPanel } from './DocumentPanel'

afterEach(cleanup)

function documentHost(readDocument = vi.fn(async (path: string) => ({ id: path, name: 'README.md', path, kind: 'markdown' as const, size: 42, content: '# Project README\n\n**Rendered** from the host.' }))): PipiHostAPI {
  return { protocolVersion: 2, readDocument } as unknown as PipiHostAPI
}

describe('DocumentPanel', () => {
  it('stays empty until a transcript card explicitly opens a document', () => {
    const host = documentHost()
    render(<DocumentPanel host={host} />)
    expect(screen.getByTestId('document-empty').textContent).toContain('点击主聊天或 subagent 消息下方的 Markdown 文档卡片')
    expect(host.readDocument).not.toHaveBeenCalled()
    expect(screen.queryByText(/文件列表|个文件|正在同步/)).toBeNull()
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
})

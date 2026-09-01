// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InputFileAttachment, InputFileStageRequest, Model, PipiHostAPI, StreamEvent } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'
import { DEFAULT_COMPOSER_INPUT_FILES_PROMPT } from './InputFileAttachments'

beforeEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
  Reflect.deleteProperty(window, 'pipiPathForFile')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
  Reflect.deleteProperty(window, 'pipiPathForFile')
})

const grok: Model = {
  provider: 'grok-build',
  id: 'grok-4.6',
  name: 'Grok 4.6',
  reasoning: true,
  supportsImages: true,
  capabilities: { inputFiles: true },
}

function pdfFile(name = 'notes.pdf', size = 32): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

function fileListOf(...files: File[]): FileList {
  return Object.assign(files, {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
}

function fileDataTransfer(...files: File[]) {
  return {
    types: ['Files'],
    files: fileListOf(...files),
    items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    dropEffect: 'none',
    effectAllowed: 'all',
  }
}

function dropOnComposer(...files: File[]) {
  const footer = document.querySelector('footer.composer') as HTMLElement
  const dataTransfer = fileDataTransfer(...files)
  fireEvent.dragOver(footer, { dataTransfer })
  fireEvent.drop(footer, { dataTransfer })
}

function pasteOnComposer(...files: File[]) {
  fireEvent.paste(screen.getByLabelText('消息输入框'), {
    clipboardData: {
      files: fileListOf(...files),
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  })
}

function makeImageFile(name = 'shot.png', type = 'image/png', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type })
}

function hostWithInputFiles(options: {
  listed?: Record<string, InputFileAttachment[]>
  stage?: (sessionId: string, file: InputFileStageRequest) => Promise<InputFileAttachment>
} = {}): PipiHostAPI {
  const base = createMockHost()
  const listed: Record<string, InputFileAttachment[]> = options.listed ?? {}
  const grokState = { model: grok, thinkingLevel: 'off' as const, availableThinkingLevels: ['off' as const] }
  return {
    ...base,
    listModels: async () => [...await base.listModels(), grok],
    getModelState: async () => grokState,
    setModel: async (_sessionId, provider, id) => {
      if (provider === grok.provider && id === grok.id) return grokState
      return base.setModel(_sessionId, provider, id)
    },
    listInputFiles: vi.fn(async (sessionId: string) => listed[sessionId] ?? []),
    stageInputFile: vi.fn(async (sessionId: string, file: InputFileStageRequest) => {
      if (options.stage) return options.stage(sessionId, file)
      const staged: InputFileAttachment = {
        id: file.id ?? `att-${file.name}`,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType ?? 'application/pdf',
        status: 'ready',
        fileId: `file-${file.name}`,
      }
      listed[sessionId] = [...(listed[sessionId] ?? []).filter(item => item.id !== staged.id), staged]
      return staged
    }),
    removeInputFile: vi.fn(async (sessionId: string, attachmentId: string) => {
      listed[sessionId] = (listed[sessionId] ?? []).filter(item => item.id !== attachmentId)
      return listed[sessionId] ?? []
    }),
    retryInputFile: vi.fn(async (sessionId: string, attachmentId: string, file?: InputFileStageRequest) => {
      const staged: InputFileAttachment = {
        id: attachmentId,
        name: file?.name ?? 'notes.pdf',
        size: file?.size ?? 32,
        mimeType: file?.mimeType ?? 'application/pdf',
        status: 'ready',
      }
      listed[sessionId] = [...(listed[sessionId] ?? []).filter(item => item.id !== attachmentId), staged]
      return staged
    }),
    cancelInputFile: vi.fn(async (sessionId: string, attachmentId: string) => {
      const cancelled: InputFileAttachment = {
        id: attachmentId,
        name: 'notes.pdf',
        size: 32,
        mimeType: 'application/pdf',
        status: 'cancelled',
      }
      listed[sessionId] = [...(listed[sessionId] ?? []).filter(item => item.id !== attachmentId), cancelled]
      return cancelled
    }),
  }
}

describe('composer input files', () => {
  it('does not show the file picker on models that do not declare inputFiles', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByTestId('composer-attach-file')).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it('does not show an add-file button; dropping a file stages it after switching to a model with live inputFiles', async () => {
    const host = hostWithInputFiles()
    host.getModelState = createMockHost().getModelState
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByRole('button', { name: '添加文件' })).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId(`quick-row-${grok.provider}-${grok.id}`))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain(grok.name))
    expect(screen.queryByRole('button', { name: '添加文件' })).toBeNull()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    dropOnComposer(pdfFile('/abs/notes.pdf'))
    const chip = await screen.findByTestId('composer-input-file-0')
    expect(chip.textContent).toContain('notes.pdf')
    expect(chip.textContent).toContain('就绪')
    expect(chip.textContent).not.toContain('file-notes.pdf')
    expect(chip.textContent).not.toContain('/abs/')
    expect(host.stageInputFile).toHaveBeenCalledWith('welcome', expect.objectContaining({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      dataBase64: expect.any(String),
    }))
  })

  it('keeps pending chips and blocks send after switching to an unsupported model', async () => {
    const host = hostWithInputFiles()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    dropOnComposer(pdfFile('notes.pdf'))
    await screen.findByTestId('composer-input-file-0')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-anthropic-claude-sonnet-4'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('Claude Sonnet 4'))
    expect(screen.getByTestId('composer-input-file-0')).toBeTruthy()
    expect(screen.getByTestId('composer-input-files-unsupported').textContent).toContain('不支持文件附件')
    expect(screen.queryByRole('button', { name: /重试上传/ })).toBeNull()
    expect(screen.queryByTestId('composer-attach-file')).toBeNull()
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '带附件发送' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect((await screen.findByTestId('composer-error')).textContent).toContain('不支持文件附件')
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByTestId('composer-input-file-0')).toBeTruthy()
  })

  it('blocks send while an unsent file is uploading, failed, or cancelled', async () => {
    let resolveStage: ((value: InputFileAttachment) => void) | undefined
    const host = hostWithInputFiles({
      stage: () => new Promise(resolve => { resolveStage = resolve }),
    })
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    dropOnComposer(pdfFile('notes.pdf'))
    await screen.findByTestId('composer-input-file-0')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '先发' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect(await screen.findByText(/仍在上传/)).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消上传 notes.pdf' }))
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('已取消'))
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect(await screen.findByText(/已取消的文件/)).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
    resolveStage?.({ id: 'late', name: 'notes.pdf', size: 32, mimeType: 'application/pdf', status: 'ready' })
  })

  it('sends a stable default prompt when only ready attachments are present', async () => {
    const host = hostWithInputFiles()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    pasteOnComposer(pdfFile('notes.pdf'))
    await screen.findByTestId('composer-input-file-0')
    expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', DEFAULT_COMPOSER_INPUT_FILES_PROMPT, undefined, expect.anything()))
    expect(DEFAULT_COMPOSER_INPUT_FILES_PROMPT.trim()).not.toBe('')
    expect(sendPrompt).not.toHaveBeenCalledWith('welcome', '')
  })

  it('sends the original prompt without rewriting paths and keeps ready files until settle marks them sent', async () => {
    const listed: Record<string, InputFileAttachment[]> = {}
    const host = hostWithInputFiles({ listed })
    const listeners = new Set<(event: StreamEvent) => void>()
    const originalSubscribe = host.subscribeStream.bind(host)
    host.subscribeStream = (sessionId, listener) => {
      listeners.add(listener)
      const unsubscribe = originalSubscribe(sessionId, listener)
      return () => { listeners.delete(listener); unsubscribe() }
    }
    const sendPrompt = vi.fn(async (sessionId: string, prompt: string) => {
      for (const listener of listeners) listener({ type: 'status', sessionId, status: 'started' })
      expect(prompt).toBe('分析这份文件')
    })
    host.sendPrompt = sendPrompt
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    dropOnComposer(pdfFile('notes.pdf'))
    await screen.findByTestId('composer-input-file-0')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '分析这份文件' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '分析这份文件', undefined, expect.anything()))
    expect(screen.getByTestId('composer-input-file-0')).toBeTruthy()
    const stored = JSON.stringify(localStorage)
    expect(stored).not.toContain('file-notes.pdf')
    expect(stored).not.toMatch(/dataBase64/)
    listed.welcome = [{ id: listed.welcome?.[0]?.id ?? 'att-notes.pdf', name: 'notes.pdf', size: 32, mimeType: 'application/pdf', status: 'ready', sent: true, fileId: 'file-notes.pdf' }]
    for (const listener of listeners) listener({ type: 'status', sessionId: 'welcome', status: 'settled' })
    await waitFor(() => expect(screen.queryByTestId('composer-input-files')).toBeNull())
  })

  it('restores only the selected session metadata and does not leak another session cache', async () => {
    const host = hostWithInputFiles({
      listed: {
        welcome: [{ id: 'w1', name: 'welcome.pdf', size: 10, mimeType: 'application/pdf', status: 'ready' }],
        layout: [{ id: 'l1', name: 'layout.pdf', size: 10, mimeType: 'application/pdf', status: 'ready' }],
      },
    })
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('welcome.pdf')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf'))
    expect(host.listInputFiles).toHaveBeenCalledWith('layout')
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('welcome.pdf'))
  })

  it('keeps existing image paste and document-chip composer behavior', async () => {
    const host = hostWithInputFiles()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => makeImageFile('pasted.png') }] },
    })
    expect(await screen.findByTestId('composer-thumb-0')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '添加文件' })).toBeNull()
    expect(screen.queryByTestId('composer-input-files')).toBeNull()
    expect(host.stageInputFile).not.toHaveBeenCalled()
    fireEvent.change(textarea, { target: { value: '看图' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '看图', [
      expect.objectContaining({ name: 'pasted.png', mimeType: 'image/png' }),
    ], expect.anything()))
    await waitFor(() => expect(screen.queryByTestId('composer-thumbs')).toBeNull())
  })
})

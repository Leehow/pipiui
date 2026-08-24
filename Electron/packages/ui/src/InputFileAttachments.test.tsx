// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InputFileAttachment, InputFileStageRequest, Model, PipiHostAPI } from '@pipi/host-api'
import {
  blockingInputFileReason,
  composerInputFileGate,
  fileToBase64,
  formatInputFileSize,
  InputFileAttachments,
  MAX_COMPOSER_INPUT_FILE_BYTES,
  mergeComposerInputFiles,
  modelHasInputFiles,
  publicComposerInputFile,
  retryWithoutCacheMessage,
  safeDisplayFileName,
  stageRequestFromFile,
  unsentComposerInputFiles,
  unsupportedInputFilesMessage,
  validateComposerInputFile,
} from './InputFileAttachments'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const grok: Model = {
  provider: 'grok-build',
  id: 'grok-4.6',
  name: 'Grok 4.6',
  reasoning: true,
  capabilities: { inputFiles: true },
}

const claude: Model = {
  provider: 'anthropic',
  id: 'claude-sonnet-4',
  name: 'Claude Sonnet 4',
  reasoning: true,
}

function pdfFile(name = 'notes.pdf', size = 2048): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

function fileListOf(...files: File[]): FileList {
  return Object.assign(files, {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
}

function pickFiles(input: HTMLInputElement, ...files: File[]) {
  fireEvent.change(input, { target: { files: fileListOf(...files) } })
}

function attachment(partial: Partial<InputFileAttachment> & Pick<InputFileAttachment, 'id' | 'name'>): InputFileAttachment {
  return {
    size: 1024,
    mimeType: 'application/pdf',
    status: 'ready',
    ...partial,
  }
}

function hostStub(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  return {
    stageInputFile: vi.fn(async (_sessionId: string, file: InputFileStageRequest) => attachment({
      id: file.id ?? 'staged-1',
      name: file.name,
      size: file.size,
      mimeType: file.mimeType ?? 'application/octet-stream',
      status: 'ready',
      fileId: 'file-secret-xyz',
    })),
    listInputFiles: vi.fn(async () => []),
    removeInputFile: vi.fn(async () => []),
    retryInputFile: vi.fn(async (_sessionId: string, id: string, file?: InputFileStageRequest) => attachment({
      id,
      name: file?.name ?? 'notes.pdf',
      size: file?.size ?? 1024,
      status: 'ready',
    })),
    cancelInputFile: vi.fn(async (_sessionId: string, id: string) => attachment({
      id,
      name: 'notes.pdf',
      status: 'cancelled',
    })),
    ...overrides,
  } as PipiHostAPI
}

describe('composer input-file helpers', () => {
  it('gates only on live capabilities.inputFiles === true and never on provider id', () => {
    expect(modelHasInputFiles(undefined)).toBe(false)
    expect(modelHasInputFiles(claude)).toBe(false)
    expect(modelHasInputFiles({ ...grok, capabilities: { inputFiles: false } })).toBe(false)
    expect(modelHasInputFiles({ ...grok, capabilities: { inputFiles: { upload: true } } })).toBe(false)
    expect(modelHasInputFiles({ provider: 'anthropic', id: 'x', name: 'X', capabilities: { inputFiles: true } })).toBe(true)
    expect(modelHasInputFiles(grok)).toBe(true)
  })

  it('strips paths, formats size, and keeps only safe public metadata', () => {
    expect(safeDisplayFileName('/Users/haoli/secret/report.pdf')).toBe('report.pdf')
    expect(formatInputFileSize(1536)).toContain('KB')
    expect(unsupportedInputFilesMessage('Claude Sonnet 4')).toContain('不支持文件附件')
    expect(publicComposerInputFile(attachment({
      id: 'att-1',
      name: '/abs/notes.pdf',
      fileId: 'file-secret-xyz',
      sent: true,
      error: 'boom',
    }))).toEqual({
      id: 'att-1',
      name: 'notes.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      status: 'ready',
      error: 'boom',
    })
    expect(unsentComposerInputFiles([
      attachment({ id: 'a', name: 'a.pdf', sent: true }),
      attachment({ id: 'b', name: 'b.pdf' }),
    ]).map(item => item.id)).toEqual(['b'])
  })

  it('rejects oversized and disallowed types before staging', () => {
    expect(validateComposerInputFile({ name: 'huge.pdf', size: MAX_COMPOSER_INPUT_FILE_BYTES + 1, mimeType: 'application/pdf' })).toMatch(/最大 48 MB/)
    expect(validateComposerInputFile({ name: 'payload.exe', size: 10, mimeType: 'application/x-msdownload' })).toMatch(/不支持的文件类型/)
    expect(validateComposerInputFile({ name: 'notes.pdf', size: 12, mimeType: 'application/pdf' })).toBeNull()
  })

  it('stages basename + size + mime + bytes and never a path or provider file id', async () => {
    const request = await stageRequestFromFile(pdfFile('/tmp/notes.pdf', 8), 'local-1')
    expect(request).toEqual({
      id: 'local-1',
      name: 'notes.pdf',
      size: 8,
      mimeType: 'application/pdf',
      dataBase64: await fileToBase64(pdfFile('notes.pdf', 8)),
    })
    expect(JSON.stringify(request)).not.toContain('/tmp/')
    expect(request).not.toHaveProperty('fileId')
  })

  it('blocks send while uploading, failed, cancelled, or pending under an unsupported model', () => {
    const uploading = [{ id: '1', name: 'a.pdf', size: 1, mimeType: 'application/pdf', status: 'uploading' as const }]
    expect(blockingInputFileReason(uploading, grok)).toMatch(/仍在上传/)
    expect(composerInputFileGate([{ ...uploading[0], status: 'failed' }], grok).blockingReason).toMatch(/上传失败/)
    expect(composerInputFileGate([{ ...uploading[0], status: 'cancelled' }], grok).blockingReason).toMatch(/已取消/)
    expect(composerInputFileGate([{ ...uploading[0], status: 'ready' }], claude).blockingReason).toMatch(/不支持文件附件/)
    expect(composerInputFileGate([{ ...uploading[0], status: 'ready' }], grok)).toEqual({
      hasUnsent: true,
      hasReady: true,
      blockingReason: null,
    })
  })

  it('merges a stale list without wiping optimistic chips or resurrecting tombstones', () => {
    const optimistic = { id: 'local-1', name: 'notes.pdf', size: 8, mimeType: 'application/pdf', status: 'ready' as const }
    const cancelled = { id: 'c1', name: 'old.pdf', size: 4, mimeType: 'application/pdf', status: 'cancelled' as const }
    expect(mergeComposerInputFiles([], [optimistic, cancelled])).toEqual([optimistic, cancelled])
    expect(mergeComposerInputFiles(
      [attachment({ id: 'c1', name: 'old.pdf', status: 'ready' })],
      [cancelled],
    )).toEqual([cancelled])
    expect(mergeComposerInputFiles(
      [attachment({ id: 'gone', name: 'removed.pdf' }), attachment({ id: 'keep', name: 'keep.pdf' })],
      [],
      new Set(['gone']),
    ).map(item => item.id)).toEqual(['keep'])
    expect(mergeComposerInputFiles(
      [attachment({ id: 'sent', name: 'sent.pdf', sent: true })],
      [{ id: 'sent', name: 'sent.pdf', size: 1, mimeType: 'application/pdf', status: 'ready' }],
    )).toEqual([])
  })
})

describe('InputFileAttachments', () => {
  it('hides the picker unless the live model declares inputFiles === true', () => {
    const host = hostStub()
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={claude} onEnsureSession={async () => 'welcome'} />)
    expect(screen.queryByTestId('composer-attach-file')).toBeNull()
    expect(screen.queryByTestId('composer-input-file-picker')).toBeNull()
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    expect(screen.getByRole('button', { name: '添加文件' })).toBeTruthy()
    expect(screen.getByTestId('composer-input-file-picker')).toBeTruthy()
  })

  it('stages selected bytes with safe metadata and shows basename/size/status only', async () => {
    const host = hostStub()
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, pdfFile('/Users/haoli/secret/notes.pdf', 16))
    const chip = await screen.findByTestId('composer-input-file-0')
    expect(chip.textContent).toContain('notes.pdf')
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('就绪'))
    expect(chip.textContent).not.toContain('file-secret-xyz')
    expect(chip.textContent).not.toContain('/Users/')
    expect(chip.textContent).not.toMatch(/%/)
    await waitFor(() => expect(host.stageInputFile).toHaveBeenCalledTimes(1))
    const request = vi.mocked(host.stageInputFile!).mock.calls[0][1]
    expect(request.name).toBe('notes.pdf')
    expect(request.size).toBe(16)
    expect(request.mimeType).toBe('application/pdf')
    expect(request.dataBase64).toEqual(expect.any(String))
    expect(request.dataBase64.length).toBeGreaterThan(0)
    expect(JSON.stringify(request)).not.toContain('/Users/')
    expect(request).not.toHaveProperty('fileId')
  })

  it('uploads multiple selected files and resets the input so the same file can be chosen again', async () => {
    const host = hostStub()
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    const input = screen.getByTestId('composer-input-file-picker') as HTMLInputElement
    const same = pdfFile('notes.pdf', 8)
    pickFiles(input, pdfFile('a.pdf', 8), pdfFile('b.pdf', 12))
    await screen.findByTestId('composer-input-file-1')
    expect(host.stageInputFile).toHaveBeenCalledTimes(2)
    expect(input.value).toBe('')
    pickFiles(input, same)
    await waitFor(() => expect(host.stageInputFile).toHaveBeenCalledTimes(3))
    expect(vi.mocked(host.stageInputFile!).mock.calls[2][1]).toEqual(expect.objectContaining({ name: 'notes.pdf', size: 8 }))
    expect(input.value).toBe('')
    pickFiles(input, same)
    await waitFor(() => expect(host.stageInputFile).toHaveBeenCalledTimes(4))
    expect(vi.mocked(host.stageInputFile!).mock.calls[3][0]).toBe('welcome')
  })

  it('shows client-side type and size errors without creating a chip', async () => {
    const host = hostStub()
    const onNotice = vi.fn()
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} onNotice={onNotice} />)
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, new File([new Uint8Array(12)], 'payload.exe', { type: 'application/x-msdownload' }))
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('不支持的文件类型')))
    expect(screen.queryByTestId('composer-input-files')).toBeNull()
    expect(host.stageInputFile).not.toHaveBeenCalled()
  })

  it('cancels an in-flight upload and retries from the cached File bytes', async () => {
    let resolveStage: ((value: InputFileAttachment) => void) | undefined
    const host = hostStub({
      stageInputFile: vi.fn(() => new Promise<InputFileAttachment>(resolve => { resolveStage = resolve })),
    })
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, pdfFile('notes.pdf', 20))
    const chip = await screen.findByTestId('composer-input-file-0')
    expect(chip.textContent).toContain('上传中')
    fireEvent.click(screen.getByRole('button', { name: '取消上传 notes.pdf' }))
    await waitFor(() => expect(host.cancelInputFile).toHaveBeenCalledWith('welcome', expect.any(String)))
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('已取消'))
    resolveStage?.(attachment({ id: 'ignored', name: 'notes.pdf', status: 'ready', fileId: 'file-late' }))
    fireEvent.click(screen.getByRole('button', { name: '重试上传 notes.pdf' }))
    await waitFor(() => expect(host.retryInputFile).toHaveBeenCalledWith('welcome', expect.any(String), expect.objectContaining({
      name: 'notes.pdf',
      size: 20,
      dataBase64: expect.any(String),
    })))
  })

  it('asks the user to reselect when retry has no cached bytes', async () => {
    const host = hostStub({
      listInputFiles: vi.fn(async () => [attachment({ id: 'lost', name: 'notes.pdf', status: 'failed' })]),
    })
    const onNotice = vi.fn()
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} onNotice={onNotice} />)
    await screen.findByTestId('composer-input-file-0')
    fireEvent.click(screen.getByRole('button', { name: '重试上传 notes.pdf' }))
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(retryWithoutCacheMessage()))
    expect(host.retryInputFile).not.toHaveBeenCalled()
  })

  it('removes any status through the host API and keeps chips when the model loses inputFiles', async () => {
    const host = hostStub({
      listInputFiles: vi.fn(async () => [attachment({ id: 'keep', name: 'notes.pdf', fileId: 'file-keep' })]),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    await screen.findByTestId('composer-input-file-0')
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={claude} onEnsureSession={async () => 'welcome'} />)
    expect(screen.getByTestId('composer-input-file-0')).toBeTruthy()
    expect(screen.getByTestId('composer-input-files-unsupported').textContent).toContain('不支持文件附件')
    expect(screen.queryByTestId('composer-attach-file')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试上传 notes.pdf' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '移除文件 notes.pdf' }))
    await waitFor(() => expect(host.removeInputFile).toHaveBeenCalledWith('welcome', 'keep'))
    await waitFor(() => expect(screen.queryByTestId('composer-input-files')).toBeNull())
  })

  it('does not apply a late stage result after switching sessions', async () => {
    let resolveStage: ((value: InputFileAttachment) => void) | undefined
    const listed = new Map<string, InputFileAttachment[]>([
      ['welcome', []],
      ['layout', [attachment({ id: 'l1', name: 'layout.pdf' })]],
    ])
    const host = hostStub({
      listInputFiles: vi.fn(async (sessionId: string) => listed.get(sessionId) ?? []),
      stageInputFile: vi.fn((_sessionId: string, file: InputFileStageRequest) => new Promise<InputFileAttachment>(resolve => {
        resolveStage = resolve
        void file
      })),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, pdfFile('/Users/haoli/secret/notes.pdf', 20))
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('上传中')
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} onEnsureSession={async () => 'layout'} />)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf'))
    await waitFor(() => expect(resolveStage).toBeDefined())
    resolveStage?.(attachment({ id: 'stale', name: 'notes.pdf', status: 'ready', fileId: 'file-stale' }))
    await waitFor(() => expect(host.stageInputFile).toHaveBeenCalledWith('welcome', expect.objectContaining({ name: 'notes.pdf' })))
    await waitFor(() => {
      expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf')
      expect(screen.queryByText('notes.pdf')).toBeNull()
    })
    expect(screen.getByTestId('composer-input-files').textContent).not.toContain('file-stale')
    expect(screen.getByTestId('composer-input-files').textContent).not.toContain('/Users/')
  })

  it('does not let a late remove remaining list overwrite the new session chips', async () => {
    let resolveRemove: ((value: InputFileAttachment[]) => void) | undefined
    const listed = new Map<string, InputFileAttachment[]>([
      ['welcome', [attachment({ id: 'w1', name: 'welcome.pdf' })]],
      ['layout', [attachment({ id: 'l1', name: 'layout.pdf' })]],
    ])
    const host = hostStub({
      listInputFiles: vi.fn(async (sessionId: string) => listed.get(sessionId) ?? []),
      removeInputFile: vi.fn(() => new Promise<InputFileAttachment[]>(resolve => { resolveRemove = resolve })),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    await screen.findByTestId('composer-input-file-0')
    fireEvent.click(screen.getByRole('button', { name: '移除文件 welcome.pdf' }))
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} onEnsureSession={async () => 'layout'} />)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf'))
    resolveRemove?.([attachment({ id: 'leftover', name: 'stale-remaining.pdf' })])
    await waitFor(() => expect(host.removeInputFile).toHaveBeenCalledWith('welcome', 'w1'))
    await waitFor(() => {
      expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf')
      expect(screen.queryByText('stale-remaining.pdf')).toBeNull()
    })
  })

  it('keeps an optimistic chip when the in-flight session list resolves empty', async () => {
    let resolveList: ((value: InputFileAttachment[]) => void) | undefined
    const host = hostStub({
      listInputFiles: vi.fn(() => new Promise<InputFileAttachment[]>(resolve => { resolveList = resolve })),
    })
    render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, pdfFile('notes.pdf', 16))
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('notes.pdf')
    await waitFor(() => expect(host.stageInputFile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(resolveList).toBeDefined())
    resolveList?.([])
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('就绪'))
    expect(screen.getByTestId('composer-input-file-0').textContent).toContain('notes.pdf')
  })

  it('does not resurrect a removed chip when a later list still includes it', async () => {
    const pending: Array<(value: InputFileAttachment[]) => void> = []
    const host = hostStub({
      listInputFiles: vi.fn(() => new Promise<InputFileAttachment[]>(resolve => { pending.push(resolve) })),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} refreshKey={0} onEnsureSession={async () => 'welcome'} />)
    await waitFor(() => expect(pending.length).toBe(1))
    pending[0]([attachment({ id: 'keep', name: 'keep.pdf' })])
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('keep.pdf')
    fireEvent.click(screen.getByRole('button', { name: '移除文件 keep.pdf' }))
    await waitFor(() => expect(screen.queryByTestId('composer-input-files')).toBeNull())
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={grok} refreshKey={1} onEnsureSession={async () => 'welcome'} />)
    await waitFor(() => expect(pending.length).toBe(2))
    pending[1]([attachment({ id: 'keep', name: 'keep.pdf' })])
    await waitFor(() => expect(host.removeInputFile).toHaveBeenCalledWith('welcome', 'keep'))
    expect(screen.queryByTestId('composer-input-files')).toBeNull()
    expect(screen.queryByText('keep.pdf')).toBeNull()
  })

  it('restores the chip after a failed remove so a later list can show it', async () => {
    let rejectRemove: ((error: Error) => void) | undefined
    const pending: Array<(value: InputFileAttachment[]) => void> = []
    const host = hostStub({
      listInputFiles: vi.fn(() => new Promise<InputFileAttachment[]>(resolve => { pending.push(resolve) })),
      removeInputFile: vi.fn(() => new Promise<InputFileAttachment[]>((_resolve, reject) => { rejectRemove = reject })),
    })
    const onNotice = vi.fn()
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} refreshKey={0} onEnsureSession={async () => 'welcome'} onNotice={onNotice} />)
    await waitFor(() => expect(pending.length).toBe(1))
    pending[0]([attachment({ id: 'keep', name: 'keep.pdf' })])
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('keep.pdf')
    fireEvent.click(screen.getByRole('button', { name: '移除文件 keep.pdf' }))
    await waitFor(() => expect(screen.queryByTestId('composer-input-files')).toBeNull())
    await waitFor(() => expect(rejectRemove).toBeDefined())
    rejectRemove?.(new Error('remove failed'))
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('keep.pdf'))
    expect(onNotice).toHaveBeenCalledWith('remove failed')
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={grok} refreshKey={1} onEnsureSession={async () => 'welcome'} onNotice={onNotice} />)
    await waitFor(() => expect(pending.length).toBe(2))
    pending[1]([attachment({ id: 'keep', name: 'keep.pdf' })])
    await waitFor(() => expect(host.removeInputFile).toHaveBeenCalledWith('welcome', 'keep'))
    expect(screen.getByTestId('composer-input-file-0').textContent).toContain('keep.pdf')
  })

  it('does not restore a failed remove onto a different session', async () => {
    let rejectRemove: ((error: Error) => void) | undefined
    const listed = new Map<string, InputFileAttachment[]>([
      ['welcome', [attachment({ id: 'w1', name: 'welcome.pdf' })]],
      ['layout', [attachment({ id: 'l1', name: 'layout.pdf' })]],
    ])
    const host = hostStub({
      listInputFiles: vi.fn(async (sessionId: string) => listed.get(sessionId) ?? []),
      removeInputFile: vi.fn(() => new Promise<InputFileAttachment[]>((_resolve, reject) => { rejectRemove = reject })),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    await screen.findByTestId('composer-input-file-0')
    fireEvent.click(screen.getByRole('button', { name: '移除文件 welcome.pdf' }))
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} onEnsureSession={async () => 'layout'} />)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf'))
    await waitFor(() => expect(rejectRemove).toBeDefined())
    rejectRemove?.(new Error('remove failed'))
    await waitFor(() => expect(host.removeInputFile).toHaveBeenCalledWith('welcome', 'w1'))
    await waitFor(() => {
      expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf')
      expect(screen.queryByText('welcome.pdf')).toBeNull()
    })
  })

  it('hides retry on unsupported models and allows it after switching back', async () => {
    let resolveStage: ((value: InputFileAttachment) => void) | undefined
    const host = hostStub({
      listInputFiles: vi.fn(async () => [attachment({ id: 'lost', name: 'failed.pdf', status: 'failed' })]),
      stageInputFile: vi.fn(() => new Promise<InputFileAttachment>(resolve => { resolveStage = resolve })),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('failed.pdf')
    expect(screen.getByRole('button', { name: '重试上传 failed.pdf' })).toBeTruthy()
    pickFiles(screen.getByTestId('composer-input-file-picker') as HTMLInputElement, pdfFile('notes.pdf', 20))
    await waitFor(() => expect(screen.getByTestId('composer-input-file-1').textContent).toContain('上传中'))
    fireEvent.click(screen.getByRole('button', { name: '取消上传 notes.pdf' }))
    await waitFor(() => expect(screen.getByTestId('composer-input-file-1').textContent).toContain('已取消'))
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={claude} onEnsureSession={async () => 'welcome'} />)
    expect(screen.queryByRole('button', { name: '重试上传 failed.pdf' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重试上传 notes.pdf' })).toBeNull()
    expect(screen.getByRole('button', { name: '移除文件 failed.pdf' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除文件 notes.pdf' })).toBeTruthy()
    expect(host.retryInputFile).not.toHaveBeenCalled()
    rerender(<InputFileAttachments host={host} sessionId="welcome" model={grok} onEnsureSession={async () => 'welcome'} />)
    fireEvent.click(screen.getByRole('button', { name: '重试上传 notes.pdf' }))
    await waitFor(() => expect(host.retryInputFile).toHaveBeenCalledWith('welcome', expect.any(String), expect.objectContaining({
      name: 'notes.pdf',
      size: 20,
      dataBase64: expect.any(String),
    })))
    resolveStage?.(attachment({ id: 'ignored', name: 'notes.pdf', status: 'ready' }))
  })

  it('isolates list/cache by session and drops sent files after a settled refresh', async () => {
    const listed = new Map<string, InputFileAttachment[]>([
      ['welcome', [attachment({ id: 'w1', name: 'welcome.pdf' })]],
      ['layout', [attachment({ id: 'l1', name: 'layout.pdf' })]],
    ])
    const host = hostStub({
      listInputFiles: vi.fn(async (sessionId: string) => listed.get(sessionId) ?? []),
    })
    const { rerender } = render(<InputFileAttachments host={host} sessionId="welcome" model={grok} working={false} refreshKey={0} onEnsureSession={async () => 'welcome'} />)
    expect((await screen.findByTestId('composer-input-file-0')).textContent).toContain('welcome.pdf')
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} working={false} refreshKey={0} onEnsureSession={async () => 'layout'} />)
    await waitFor(() => expect(screen.getByTestId('composer-input-file-0').textContent).toContain('layout.pdf'))
    expect(host.listInputFiles).toHaveBeenCalledWith('layout')
    listed.set('layout', [attachment({ id: 'l1', name: 'layout.pdf', sent: true })])
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} working refreshKey={0} onEnsureSession={async () => 'layout'} />)
    rerender(<InputFileAttachments host={host} sessionId="layout" model={grok} working={false} refreshKey={1} onEnsureSession={async () => 'layout'} />)
    await waitFor(() => expect(screen.queryByTestId('composer-input-files')).toBeNull())
  })
})

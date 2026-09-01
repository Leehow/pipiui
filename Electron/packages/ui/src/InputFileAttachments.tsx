import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { InputFileAttachment, InputFileStageRequest, InputFileStatus, Model, PipiHostAPI } from '@pipi/host-api'

/** Conservative xAI request-body aligned cap. */
export const MAX_COMPOSER_INPUT_FILE_BYTES = 48 * 1024 * 1024

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl',
  '.html', '.htm', '.xml', '.rtf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.c', '.h', '.cpp', '.cc', '.java',
  '.go', '.rs', '.rb', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
])

const ALLOWED_MIME_PREFIXES = [
  'text/',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Stable, localizable prompt used when sending ready attachments with an empty draft. */
export const DEFAULT_COMPOSER_INPUT_FILES_PROMPT = '请分析这些附件。'

export type ComposerInputFile = {
  id: string
  name: string
  size: number
  mimeType: string
  status: InputFileStatus
  error?: string
}

export type InputFileGate = {
  hasUnsent: boolean
  hasReady: boolean
  blockingReason: string | null
}

export const EMPTY_INPUT_FILE_GATE: InputFileGate = { hasUnsent: false, hasReady: false, blockingReason: null }

/** Live model must declare the boolean flag. Do not infer from provider id or object-shaped bags. */
export function modelHasInputFiles(model: Model | { capabilities?: unknown } | null | undefined): boolean {
  const caps = model?.capabilities
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return false
  return (caps as { inputFiles?: unknown }).inputFiles === true
}

export function safeDisplayFileName(raw: string): string {
  const trimmed = raw.trim()
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim() || 'file'
  return base.replace(/[\u0000-\u001f]/g, '').replace(/^\.+/, '') || 'file'
}

export function formatInputFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function inputFileStatusLabel(status: InputFileStatus): string {
  if (status === 'uploading') return '上传中'
  if (status === 'ready') return '就绪'
  if (status === 'failed') return '失败'
  return '已取消'
}

export function unsupportedInputFilesMessage(modelName?: string): string {
  return modelName ? `当前模型 ${modelName} 不支持文件附件` : '当前模型不支持文件附件'
}

export function retryWithoutCacheMessage(): string {
  return '请重新粘贴或拖入该文件后再试'
}

export function extensionOf(name: string): string {
  const base = safeDisplayFileName(name)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

export function isAllowedComposerInputFileType(name: string, mimeType?: string): boolean {
  const ext = extensionOf(name)
  if (ext && ALLOWED_EXTENSIONS.has(ext)) return true
  const mime = (mimeType ?? '').trim().toLowerCase()
  if (!mime) return false
  return ALLOWED_MIME_PREFIXES.some(prefix => mime === prefix || mime.startsWith(`${prefix}.`) || mime.startsWith(prefix))
}

export function validateComposerInputFile(input: { name: string; size: number; mimeType?: string }): string | null {
  const name = safeDisplayFileName(input.name)
  if (!name) return '文件名无效'
  if (!Number.isFinite(input.size) || input.size <= 0) return `空文件不能上传：${name}`
  if (input.size > MAX_COMPOSER_INPUT_FILE_BYTES) {
    return `文件过大（最大 ${Math.floor(MAX_COMPOSER_INPUT_FILE_BYTES / (1024 * 1024))} MB）：${name}`
  }
  if (!isAllowedComposerInputFileType(name, input.mimeType)) {
    return `不支持的文件类型：${name}`
  }
  return null
}

export function unsentComposerInputFiles(files: readonly InputFileAttachment[]): ComposerInputFile[] {
  return files.filter(file => file.sent !== true).map(toComposerInputFile)
}

export function toComposerInputFile(file: InputFileAttachment | ComposerInputFile): ComposerInputFile {
  return {
    id: file.id,
    name: safeDisplayFileName(file.name),
    size: file.size,
    mimeType: file.mimeType,
    status: file.status,
    ...(file.error ? { error: file.error } : {}),
  }
}

export function publicComposerInputFile(file: InputFileAttachment | ComposerInputFile): ComposerInputFile {
  return toComposerInputFile(file)
}

export function blockingInputFileReason(files: readonly ComposerInputFile[], model?: Model | null): string | null {
  if (files.length === 0) return null
  if (!modelHasInputFiles(model)) return unsupportedInputFilesMessage(model?.name)
  if (files.some(file => file.status === 'uploading')) return '文件仍在上传，请等待完成或取消后再发送'
  if (files.some(file => file.status === 'failed')) return '有文件上传失败，请重试或移除后再发送'
  if (files.some(file => file.status === 'cancelled')) return '有已取消的文件，请重试或移除后再发送'
  return null
}

export function composerInputFileGate(files: readonly ComposerInputFile[], model?: Model | null): InputFileGate {
  return {
    hasUnsent: files.length > 0,
    hasReady: files.some(file => file.status === 'ready'),
    blockingReason: blockingInputFileReason(files, model),
  }
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export async function stageRequestFromFile(file: File, id?: string): Promise<InputFileStageRequest> {
  return {
    ...(id ? { id } : {}),
    name: safeDisplayFileName(file.name),
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    dataBase64: await fileToBase64(file),
  }
}

/** Merge a host list with in-scope local chips. Hidden (removed) ids never return. */
export function mergeComposerInputFiles(
  listed: readonly InputFileAttachment[],
  local: readonly ComposerInputFile[],
  hiddenIds?: ReadonlySet<string>,
): ComposerInputFile[] {
  const hidden = hiddenIds ?? new Set<string>()
  const localById = new Map(local.map(item => [item.id, item]))
  const presentIds = new Set(listed.map(item => item.id))
  const chips = unsentComposerInputFiles(listed)
    .filter(item => !hidden.has(item.id))
    .map(item => {
      const existing = localById.get(item.id)
      if (existing?.status === 'cancelled' && item.status !== 'cancelled') return existing
      return item
    })
  return [
    ...chips,
    ...local.filter(item => !hidden.has(item.id) && !presentIds.has(item.id)),
  ]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type InputFileAttachmentsHandle = {
  stageFiles: (files: File[]) => Promise<void>
}

/** Non-image files the Chat-with-Files path accepts. Images stay on the clipboard/drop thumb path. */
export function composerInputFilesFromList(files: ArrayLike<File> | File[]): File[] {
  return Array.from(files).filter(file => {
    if (file.type.startsWith('image/')) return false
    const ext = extensionOf(file.name)
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif') return false
    return isAllowedComposerInputFileType(file.name, file.type)
  })
}

export const InputFileAttachments = forwardRef<InputFileAttachmentsHandle, {
  host: PipiHostAPI
  sessionId: string
  model?: Model | null
  readOnly?: boolean
  working?: boolean
  refreshKey?: number
  onEnsureSession: () => Promise<string | null>
  onGateChange?: (gate: InputFileGate) => void
  onNotice?: (message: string | null) => void
}>(function InputFileAttachments({
  host,
  sessionId,
  model,
  readOnly = false,
  working = false,
  refreshKey = 0,
  onEnsureSession,
  onGateChange,
  onNotice,
}, ref) {
  const [files, setFiles] = useState<ComposerInputFile[]>([])
  const filesRef = useRef(files)
  filesRef.current = files
  const fileCacheRef = useRef(new Map<string, File>())
  const cancelledIdsRef = useRef(new Set<string>())
  const removedIdsRef = useRef(new Set<string>())
  const generationRef = useRef(0)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const wasWorkingRef = useRef(working)
  const onGateChangeRef = useRef(onGateChange)
  onGateChangeRef.current = onGateChange
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice
  const stageSelectedFilesRef = useRef<(selected: File[]) => Promise<void>>(async () => {})
  const canMutate = !readOnly && typeof host.stageInputFile === 'function'

  const bumpScope = () => {
    generationRef.current += 1
    fileCacheRef.current.clear()
    cancelledIdsRef.current.clear()
    removedIdsRef.current.clear()
    return generationRef.current
  }
  const matchesScope = (session: string, generation: number) => (
    generation === generationRef.current && session === sessionIdRef.current
  )

  useEffect(() => {
    onGateChangeRef.current?.(composerInputFileGate(files, model))
  }, [files, model])

  useEffect(() => {
    const generation = bumpScope()
    setFiles([])
    let active = true
    const load = async () => {
      if (!sessionId || !host.listInputFiles) return
      try {
        const listed = await host.listInputFiles(sessionId)
        if (!active || !matchesScope(sessionId, generation)) return
        setFiles(current => mergeComposerInputFiles(listed, current, removedIdsRef.current))
      } catch {
        if (!active || !matchesScope(sessionId, generation)) return
      }
    }
    void load()
    return () => {
      active = false
      bumpScope()
    }
  }, [host, sessionId])

  useEffect(() => {
    if (!sessionId || !host.listInputFiles || refreshKey === 0) return
    let active = true
    const generation = generationRef.current
    const scopedSession = sessionId
    void host.listInputFiles(scopedSession).then(listed => {
      if (!active || !matchesScope(scopedSession, generation)) return
      setFiles(current => mergeComposerInputFiles(listed, current, removedIdsRef.current))
    }).catch(() => undefined)
    return () => { active = false }
  }, [host, sessionId, refreshKey])

  useEffect(() => {
    const settled = wasWorkingRef.current && !working
    wasWorkingRef.current = working
    if (!settled || !sessionId || !host.listInputFiles) return
    let active = true
    const generation = generationRef.current
    const scopedSession = sessionId
    void host.listInputFiles(scopedSession).then(listed => {
      if (!active || !matchesScope(scopedSession, generation)) return
      setFiles(current => mergeComposerInputFiles(listed, current, removedIdsRef.current))
    }).catch(() => undefined)
    return () => { active = false }
  }, [host, sessionId, working])

  useImperativeHandle(ref, () => ({ stageFiles: (selected: File[]) => stageSelectedFilesRef.current(selected) }))

  const stageSelectedFiles = async (selected: File[]) => {
    if (!canMutate || !selected.length) return
    if (!modelHasInputFiles(model)) {
      onNoticeRef.current?.(unsupportedInputFilesMessage(model?.name))
      return
    }
    if (!host.stageInputFile) {
      onNoticeRef.current?.('当前连接不支持文件附件')
      return
    }
    const generation = generationRef.current
    const capturedSession = sessionId
    const stillHere = () => matchesScope(capturedSession, generation)
    const targetSession = capturedSession || await onEnsureSession()
    if (!targetSession) {
      if (stillHere()) onNoticeRef.current?.('没有可用会话')
      return
    }
    if (!stillHere()) return
    let firstError: string | null = null
    for (const file of selected) {
      if (!stillHere()) break
      const problem = validateComposerInputFile({ name: file.name, size: file.size, mimeType: file.type })
      if (problem) {
        firstError ??= problem
        continue
      }
      const localId = crypto.randomUUID()
      const optimistic: ComposerInputFile = {
        id: localId,
        name: safeDisplayFileName(file.name),
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        status: 'uploading',
      }
      fileCacheRef.current.set(localId, file)
      setFiles(current => [...current, optimistic])
      try {
        const staged = await host.stageInputFile(targetSession, await stageRequestFromFile(file, localId))
        if (!stillHere()) continue
        if (cancelledIdsRef.current.has(localId) || cancelledIdsRef.current.has(staged.id)) {
          fileCacheRef.current.delete(localId)
          continue
        }
        if (staged.id !== localId) {
          const cached = fileCacheRef.current.get(localId)
          fileCacheRef.current.delete(localId)
          if (cached) fileCacheRef.current.set(staged.id, cached)
        }
        setFiles(current => current.map(item => item.id === localId || item.id === staged.id ? toComposerInputFile(staged) : item))
      } catch (error) {
        if (!stillHere()) continue
        if (cancelledIdsRef.current.has(localId)) continue
        setFiles(current => current.map(item => item.id === localId ? {
          ...item,
          status: 'failed',
          error: errorMessage(error),
        } : item))
      }
    }
    if (stillHere()) onNoticeRef.current?.(firstError)
  }
  stageSelectedFilesRef.current = stageSelectedFiles

  const removeFile = async (id: string) => {
    if (readOnly) return
    const generation = generationRef.current
    const targetSession = sessionId
    const previous = filesRef.current.find(item => item.id === id)
    const previousCached = fileCacheRef.current.get(id)
    const wasCancelled = cancelledIdsRef.current.has(id)
    cancelledIdsRef.current.add(id)
    removedIdsRef.current.add(id)
    fileCacheRef.current.delete(id)
    setFiles(current => current.filter(item => item.id !== id))
    if (!targetSession || !host.removeInputFile) return
    try {
      const remaining = await host.removeInputFile(targetSession, id)
      if (!matchesScope(targetSession, generation)) return
      setFiles(current => mergeComposerInputFiles(remaining, current.filter(item => item.id !== id), removedIdsRef.current))
    } catch (error) {
      if (!matchesScope(targetSession, generation)) return
      removedIdsRef.current.delete(id)
      if (!wasCancelled) cancelledIdsRef.current.delete(id)
      if (previousCached) fileCacheRef.current.set(id, previousCached)
      if (previous) {
        setFiles(current => current.some(item => item.id === id) ? current : [...current, previous])
      }
      onNoticeRef.current?.(errorMessage(error))
    }
  }

  const cancelFile = async (id: string) => {
    if (readOnly) return
    const generation = generationRef.current
    const targetSession = sessionId
    cancelledIdsRef.current.add(id)
    setFiles(current => current.map(item => item.id === id ? { ...item, status: 'cancelled', error: undefined } : item))
    if (!targetSession || !host.cancelInputFile) return
    try {
      const cancelled = await host.cancelInputFile(targetSession, id)
      if (!matchesScope(targetSession, generation)) return
      setFiles(current => current.map(item => item.id === id ? toComposerInputFile(cancelled) : item))
    } catch (error) {
      if (!matchesScope(targetSession, generation)) return
      setFiles(current => current.map(item => item.id === id ? {
        ...item,
        status: 'cancelled',
        error: errorMessage(error),
      } : item))
    }
  }

  const retryFile = async (id: string) => {
    if (readOnly) return
    if (!modelHasInputFiles(model)) {
      onNoticeRef.current?.(unsupportedInputFilesMessage(model?.name))
      return
    }
    const generation = generationRef.current
    const targetSession = sessionId
    const cached = fileCacheRef.current.get(id)
    if (!cached) {
      onNoticeRef.current?.(retryWithoutCacheMessage())
      return
    }
    if (!targetSession || !host.retryInputFile) {
      onNoticeRef.current?.('当前连接不支持重试文件附件')
      return
    }
    cancelledIdsRef.current.delete(id)
    setFiles(current => current.map(item => item.id === id ? { ...item, status: 'uploading', error: undefined } : item))
    try {
      const staged = await host.retryInputFile(targetSession, id, await stageRequestFromFile(cached, id))
      if (!matchesScope(targetSession, generation)) return
      if (cancelledIdsRef.current.has(id)) return
      setFiles(current => current.map(item => item.id === id || item.id === staged.id ? toComposerInputFile(staged) : item))
    } catch (error) {
      if (!matchesScope(targetSession, generation)) return
      if (cancelledIdsRef.current.has(id)) return
      setFiles(current => current.map(item => item.id === id ? {
        ...item,
        status: 'failed',
        error: errorMessage(error),
      } : item))
    }
  }

  const unsupportedPending = files.length > 0 && !modelHasInputFiles(model)

  return (
    <>
      {files.length > 0 && <div className="composer-input-files" data-testid="composer-input-files">
        {files.map((file, index) => (
          <div key={file.id} className={`composer-input-file composer-input-file-${file.status}`} data-testid={`composer-input-file-${index}`}>
            <span className="composer-input-file-name">{file.name}</span>
            <span className="composer-input-file-meta">{formatInputFileSize(file.size)} · {inputFileStatusLabel(file.status)}</span>
            {file.error && <span className="composer-input-file-error">{file.error}</span>}
            {file.status === 'uploading' && <button type="button" className="composer-input-file-cancel" aria-label={`取消上传 ${file.name}`} disabled={readOnly} onClick={() => void cancelFile(file.id)}>取消</button>}
            {(file.status === 'failed' || file.status === 'cancelled') && modelHasInputFiles(model) && <button type="button" className="composer-input-file-retry" aria-label={`重试上传 ${file.name}`} disabled={readOnly} onClick={() => void retryFile(file.id)}>重试</button>}
            <button type="button" className="composer-input-file-remove" aria-label={`移除文件 ${file.name}`} disabled={readOnly} onClick={() => void removeFile(file.id)}>×</button>
          </div>
        ))}
      </div>}
      {unsupportedPending && (
        <div className="composer-input-files-warning" data-testid="composer-input-files-unsupported" role="status">
          {unsupportedInputFilesMessage(model?.name)}，请移除附件或切换支持的模型后再发送
        </div>
      )}
    </>
  )
})

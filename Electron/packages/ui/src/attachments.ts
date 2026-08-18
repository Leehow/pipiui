import type { PromptAttachment } from '@pipi/host-api'

/** Accepted image MIME types (pi multimodal support; mirrors Swift UTType.image pick). */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
/** Mirrors Swift ImageAttachment.maxBytes (20MB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function isAcceptedImageMime(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType)
}

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Resolve MIME: declared type, or iOS album files with an empty type + image extension. */
export function imageMimeForFile(file: File): string {
  if (isAcceptedImageMime(file.type)) return file.type
  if (file.type) return ''
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXT_MIME[ext] ?? ''
}

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateAttachment(file: File): string | null {
  if (!imageMimeForFile(file)) {
    return `不支持的图片格式：${file.name}`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `图片超过 20MB，无法添加：${file.name}`
  }
  return null
}

/** Transcript / bubble image payload (same shape as tool screenshots and HistoryEntry.images). */
export type ChatImage = { data: string; mimeType: string }

/** Footer note appended after attachment path lines (kept in sync with strip). */
export const ATTACHMENT_DISPLAY_NOTE =
  '(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)'

function isBlankLine(line: string): boolean {
  return line.trim() === ''
}

/**
 * Remove path footnotes added by `prepareImageMessage` for UI display.
 * Finds the footnote block anywhere in the text — not only at the end — because
 * a Vision fallback may append an OCR caption after the note.
 */
export function stripAttachmentPathsForDisplay(text: string): string {
  const lines = text.split('\n')
  while (lines.length && isBlankLine(lines[lines.length - 1])) lines.pop()
  if (!lines.length) return text

  let noteIdx = -1
  for (let index = lines.length - 1; index >= 0; index--) {
    const trimmed = lines[index].trim()
    if (trimmed === ATTACHMENT_DISPLAY_NOTE || trimmed.startsWith('(Images are also embedded multimodally')) {
      noteIdx = index
      break
    }
  }
  if (noteIdx < 0) return text

  let headerIdx = noteIdx - 1
  while (headerIdx >= 0 && isBlankLine(lines[headerIdx])) headerIdx--
  if (headerIdx < 0) return text
  // Multi-file footnotes put `- path` lines immediately above the note.
  if (lines[headerIdx].trim().startsWith('- ')) {
    while (headerIdx >= 0 && lines[headerIdx].trim().startsWith('- ')) headerIdx--
    while (headerIdx >= 0 && isBlankLine(lines[headerIdx])) headerIdx--
  }
  if (headerIdx < 0) return text
  const header = lines[headerIdx].trim()
  const isSingle = header.startsWith('Attached image file: ')
  const isMulti = header === 'Attached image files:'
  if (!isSingle && !isMulti) return text

  if (isSingle) {
    if (!lines.slice(headerIdx + 1, noteIdx).every(isBlankLine)) return text
  } else {
    let index = headerIdx + 1
    let pathCount = 0
    while (index < noteIdx) {
      const trimmed = lines[index].trim()
      if (!trimmed) break
      if (!trimmed.startsWith('- ')) return text
      pathCount++
      index++
    }
    if (pathCount === 0) return text
    if (!lines.slice(index, noteIdx).every(isBlankLine)) return text
  }

  lines.splice(headerIdx, noteIdx - headerIdx + 1)
  const blankBefore = headerIdx - 1
  if (blankBefore >= 0 && blankBefore < lines.length && isBlankLine(lines[blankBefore])) {
    lines.splice(blankBefore, 1)
  }
  if (headerIdx === 0) {
    while (lines.length && isBlankLine(lines[0])) lines.shift()
  }

  let result = lines.join('\n')
  while (result.endsWith('\n') || result.endsWith(' ') || result.endsWith('\t')) result = result.slice(0, -1)
  return result
}

/** Map send-time attachments onto the transcript image shape. Drops empty payloads. */
export function chatImagesFromAttachments(attachments?: PromptAttachment[]): ChatImage[] | undefined {
  if (!attachments?.length) return undefined
  const images: ChatImage[] = []
  for (const attachment of attachments) {
    const data = typeof attachment.dataBase64 === 'string' ? attachment.dataBase64 : ''
    if (!data) continue
    images.push({
      data,
      mimeType: typeof attachment.mimeType === 'string' && attachment.mimeType ? attachment.mimeType : 'image/png',
    })
  }
  return images.length ? images : undefined
}

/** Read a File into the wire shape (base64 + mimeType + name) at the transport edge only. */
export function fileToPromptAttachment(file: File): Promise<PromptAttachment> {
  // Blob.arrayBuffer() resolves on microtasks (jsdom: Promise.resolve), so the
  // optimistic send path settles before the next macrotask instead of waiting on
  // the FileReader's three setImmediate hops — the composer clears, the bubble
  // gets its base64 images, and sendPrompt dispatches before any later echo.
  return file.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer)
    // Chunked so a max-size (20MB) file never blows the call stack.
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return { dataBase64: btoa(binary), mimeType: imageMimeForFile(file) || file.type || 'image/png', name: file.name }
  })
}

/** Extract image files from a clipboard paste event payload. */
export function imageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  const files: File[] = []
  if (!clipboardData) return files
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}


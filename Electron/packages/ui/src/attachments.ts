import type { PromptAttachment } from '@pipi/host-api'

/** Accepted image MIME types (pi multimodal support; mirrors Swift UTType.image pick). */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
/** Mirrors Swift ImageAttachment.maxBytes (20MB). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function isAcceptedImageMime(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType)
}

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateAttachment(file: File): string | null {
  if (!isAcceptedImageMime(file.type)) {
    return `不支持的图片格式：${file.name}`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `图片超过 20MB，无法添加：${file.name}`
  }
  return null
}

/** Read a File into the wire shape (base64 + mimeType + name) at the transport edge only. */
export function fileToPromptAttachment(file: File): Promise<PromptAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片'))
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const comma = dataUrl.indexOf(',')
      resolve({ dataBase64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mimeType: file.type, name: file.name })
    }
    reader.readAsDataURL(file)
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


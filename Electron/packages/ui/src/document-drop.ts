import { documentKindForName, documentsDroppedAnnouncement, documentsOpenedInjection } from '@pipi/host-api'

export { documentsDroppedAnnouncement, documentsOpenedInjection }

export const DEFAULT_COMPOSER_DOCUMENT_PROMPT = '请分析这些文件的内容'

type FileDragEventLike = {
  preventDefault(): void
  stopPropagation(): void
  dataTransfer?: { dropEffect?: string; types?: readonly string[] } | null
}

export function consumeFileDropEvent(event: FileDragEventLike): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

export function ignoreComposerFileDrag(event: FileDragEventLike): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

export function fileDragHasFiles(event: FileDragEventLike): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

export function filterSupportedDocumentPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    const path = raw.trim()
    if (!path || seen.has(path) || !documentKindForName(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

export function supportedDocumentPathsFromFiles(
  files: ArrayLike<File>,
  getPathForFile: (file: File) => string | undefined
): string[] {
  const paths: string[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    if (!file) continue
    try {
      const path = getPathForFile(file)?.trim()
      if (path) paths.push(path)
    } catch {
      /* sandbox / missing path — ignore this entry */
    }
  }
  return filterSupportedDocumentPaths(paths)
}

export function composerDocumentName(path: string): string {
  const trimmed = path.trim()
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

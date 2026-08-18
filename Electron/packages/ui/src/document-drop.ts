import { documentKindForName, documentsDroppedAnnouncement, documentsOpenedInjection } from '@pipi/host-api'

export { documentsDroppedAnnouncement, documentsOpenedInjection }

type FileDragEventLike = {
  preventDefault(): void
  stopPropagation(): void
  dataTransfer?: { dropEffect?: string } | null
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

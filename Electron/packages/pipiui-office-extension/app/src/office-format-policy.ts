/** Office preview tiers owned by the extension, not core. */

export const OFFICE_DOCUMENT_KINDS = ['word', 'spreadsheet', 'presentation'] as const
export type OfficeDocumentKind = (typeof OFFICE_DOCUMENT_KINDS)[number]

export const MODERN_OFFICE_EXTENSIONS = ['.docx', '.xlsx', '.pptx'] as const
export const MACRO_OFFICE_EXTENSIONS = ['.docm', '.xlsm', '.pptm'] as const
export const LEGACY_BEST_EFFORT_EXTENSIONS = [
  '.doc',
  '.rtf',
  '.odt',
  '.epub',
  '.xls',
  '.xlsb',
  '.ods',
  '.ppt',
  '.pps',
  '.ppsx',
  '.ppsm',
  '.pot',
  '.odp',
] as const

export type OfficePreviewTier = 'modern' | 'macro' | 'best-effort'

export const OFFICE_RENDERER_ID = 'office'
export const OFFICE_RENDERER_PRIORITY = 100

export function normalizeOfficeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

const MODERN = new Set<string>(MODERN_OFFICE_EXTENSIONS)
const MACRO = new Set<string>(MACRO_OFFICE_EXTENSIONS)
const BEST_EFFORT = new Set<string>(LEGACY_BEST_EFFORT_EXTENSIONS)

export function isOfficeKind(kind: string | undefined): kind is OfficeDocumentKind {
  return kind === 'word' || kind === 'spreadsheet' || kind === 'presentation'
}

/** Classify a host extension. Unknown office-kind files stay best-effort. */
export function officePreviewTier(extension: string): OfficePreviewTier {
  const ext = normalizeOfficeExtension(extension)
  if (MODERN.has(ext)) return 'modern'
  if (MACRO.has(ext)) return 'macro'
  if (BEST_EFFORT.has(ext)) return 'best-effort'
  return 'best-effort'
}

export function fileViewerType(extension: string): string {
  return normalizeOfficeExtension(extension).replace(/^\./, '')
}

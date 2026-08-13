import { memo, useMemo } from 'react'
import './document-reference-cards.css'

export type DocumentReference = { name: string; path: string }

function normalizeAbsolutePath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

function homePathFromUserProject(basePath?: string): string | undefined {
  if (!basePath?.startsWith('/')) return undefined
  const match = normalizeAbsolutePath(basePath).match(/^\/(Users|home)\/([^/]+)(?:\/|$)/)
  return match?.[2] ? match[0].replace(/\/$/, '') : undefined
}

function stripReferenceDecorations(value: string): string {
  let result = value.trim().replace(/^<|>$/g, '').replace(/\\ /g, ' ')
  if (result.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(result)
      if (url.protocol !== 'file:' || (url.host && url.host !== 'localhost')) return ''
      result = decodeURIComponent(url.pathname)
    } catch { return '' }
  }
  const fragment = result.indexOf('#')
  if (fragment >= 0) result = result.slice(0, fragment)
  const query = result.indexOf('?')
  if (query >= 0) result = result.slice(0, query)
  return result.replace(/[.,;:!?，。；：！？]+$/u, '')
}

/** Pure renderer-side normalization; filesystem reads remain behind host.readDocument. */
export function normalizeDocumentPath(raw: string, basePath?: string, homePath?: string): string | null {
  const value = stripReferenceDecorations(raw)
  if (!value || /^https?:\/\//i.test(value)) return null
  const lower = value.toLowerCase()
  if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return null

  let absolute: string
  if (value.startsWith('/')) absolute = value
  else if (value.startsWith('~/')) {
    // The renderer has no ambient HOME access. Expand only from an explicit
    // homePath or a selected project rooted in the conventional user-home tree;
    // never guess from an arbitrary workspace basename.
    const home = homePath || homePathFromUserProject(basePath)
    if (!home) return null
    absolute = `${home}/${value.slice(2)}`
  } else {
    if (!basePath?.startsWith('/')) return null
    absolute = `${basePath}/${value}`
  }
  const path = normalizeAbsolutePath(absolute)
  if (path === '/') return null
  return path
}

function markdownDestinations(content: string): string[] {
  const result: string[] = []
  const link = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|((?:\\.|[^\s)])+))(?:\s+["'][^"']*["'])?\s*\)/g
  for (const match of content.matchAll(link)) result.push(match[1] ?? match[2] ?? '')
  for (const match of content.matchAll(/`([^`\n]+\.(?:md|markdown))`/gi)) result.push(match[1])
  return result
}

/** Finds Markdown links and clear path-shaped references without probing the filesystem. */
export function findDocumentReferences(content: string, basePath?: string, homePath?: string): DocumentReference[] {
  const candidates = markdownDestinations(content)
  const barePath = /(?:file:\/\/\/|~\/|\/|\.\.?\/)?(?:[^\s<>"'`()\[\]{}|,;，。！？：；]+\/)*[^\s<>"'`()\[\]{}|,;，。！？：；]+\.(?:md|markdown)(?:#[^\s<>"']+)?/gi
  for (const match of content.matchAll(barePath)) candidates.push(match[0])

  const seen = new Set<string>()
  const references: DocumentReference[] = []
  for (const candidate of candidates) {
    const path = normalizeDocumentPath(candidate, basePath, homePath)
    if (!path || seen.has(path)) continue
    seen.add(path)
    references.push({ name: path.split('/').at(-1) ?? path, path })
  }
  return references
}

export const DocumentReferenceCards = memo(function DocumentReferenceCards({ content, basePath, onOpenDocument }: { content: string; basePath?: string; onOpenDocument?: (path: string) => void }) {
  const references = useMemo(() => findDocumentReferences(content, basePath), [content, basePath])
  if (!onOpenDocument || references.length === 0) return null
  return <div className="document-reference-cards" data-testid="document-reference-cards">
    {references.map(reference => <button key={reference.path} className="document-reference-card" title={reference.path} aria-label={`打开文档 ${reference.name}`} onClick={() => onOpenDocument(reference.path)}>
      <span className="document-reference-icon" aria-hidden="true">MD</span>
      <span className="document-reference-copy"><b>{reference.name}</b><small>{reference.path}</small></span>
    </button>)}
  </div>
})

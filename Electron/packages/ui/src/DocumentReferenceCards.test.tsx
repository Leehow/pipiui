// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentReferenceCards, findDocumentReferences, normalizeDocumentPath } from './DocumentReferenceCards'

afterEach(cleanup)

describe('document reference normalization', () => {
  it('normalizes Markdown links and bare absolute, relative, file, and tilde paths and deduplicates them', () => {
    const content = [
      '[guide](docs/guide.md)',
      'duplicate docs/../docs/guide.md',
      'absolute /tmp/result.markdown',
      'file file:///tmp/result.markdown',
      'home ~/notes/today.md',
      'ignore https://example.com/remote.md and image.png'
    ].join('\n')
    expect(findDocumentReferences(content, '/Users/demo/work')).toEqual([
      { name: 'guide.md', path: '/Users/demo/work/docs/guide.md' },
      { name: 'result.markdown', path: '/tmp/result.markdown' },
      { name: 'today.md', path: '/Users/demo/notes/today.md' }
    ])
  })

  it('handles dot segments and requires a base for relative paths', () => {
    expect(normalizeDocumentPath('../README.md', '/Users/demo/work/sub')).toBe('/Users/demo/work/README.md')
    expect(normalizeDocumentPath('README.md')).toBeNull()
    expect(normalizeDocumentPath('/tmp/file.txt', '/work')).toBeNull()
    expect(normalizeDocumentPath('~/private.md', '/workspace/Users-looking-project')).toBeNull()
    expect(normalizeDocumentPath('~/private.md', '/workspace/project', '/Users/explicit')).toBe('/Users/explicit/private.md')
  })
})

describe('DocumentReferenceCards', () => {
  it('opens the normalized absolute path from a compact sibling card', () => {
    const onOpenDocument = vi.fn()
    render(<DocumentReferenceCards content="See [the plan](docs/plan.md)." basePath="/work/project" onOpenDocument={onOpenDocument} />)
    const card = screen.getByRole('button', { name: '打开文档 plan.md' })
    expect(card.textContent).toContain('/work/project/docs/plan.md')
    fireEvent.click(card)
    expect(onOpenDocument).toHaveBeenCalledWith('/work/project/docs/plan.md')
  })
})

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
      '[report](reports/final.pdf)',
      '`notes/readme.txt` and docs/contract.docx',
      'sheets/budget.xlsx slides/demo.ppt',
      'ignore https://example.com/remote.pdf and image.png'
    ].join('\n')
    expect(findDocumentReferences(content, '/Users/demo/work')).toEqual([
      { name: 'guide.md', path: '/Users/demo/work/docs/guide.md', kind: 'markdown' },
      { name: 'final.pdf', path: '/Users/demo/work/reports/final.pdf', kind: 'pdf' },
      { name: 'readme.txt', path: '/Users/demo/work/notes/readme.txt', kind: 'plain' },
      { name: 'result.markdown', path: '/tmp/result.markdown', kind: 'markdown' },
      { name: 'today.md', path: '/Users/demo/notes/today.md', kind: 'markdown' },
      { name: 'contract.docx', path: '/Users/demo/work/docs/contract.docx', kind: 'word' },
      { name: 'budget.xlsx', path: '/Users/demo/work/sheets/budget.xlsx', kind: 'spreadsheet' },
      { name: 'demo.ppt', path: '/Users/demo/work/slides/demo.ppt', kind: 'presentation' }
    ])
  })

  it('handles dot segments and requires a base for relative paths', () => {
    expect(normalizeDocumentPath('../README.md', '/Users/demo/work/sub')).toBe('/Users/demo/work/README.md')
    expect(normalizeDocumentPath('README.md')).toBeNull()
    expect(normalizeDocumentPath('/tmp/file.txt', '/work')).toBe('/tmp/file.txt')
    expect(normalizeDocumentPath('/tmp/file.js', '/work')).toBeNull()
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

  it('labels office references by document type without reading them', () => {
    render(<DocumentReferenceCards content="[deck](slides/demo.pptx)" basePath="/work/project" onOpenDocument={() => undefined} />)
    expect(screen.getByRole('button', { name: '打开文档 demo.pptx' }).textContent).toContain('PPT')
  })
})

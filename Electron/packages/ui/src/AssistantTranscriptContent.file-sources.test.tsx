// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'

afterEach(cleanup)

describe('assistant file sources', () => {
  it('renders HTTPS file sources as links and nameless local files as plain text', () => {
    render(<AssistantTranscriptContent message={{
      content: '已根据附件回答',
      citations: [{ url: 'https://docs.example', title: 'Docs' }],
      fileSources: [
        { name: 'notes.md', url: 'https://files.example/notes.md' },
        { name: 'report.pdf' },
        { name: '/secret/absolute.pdf' },
      ],
    }} />)
    const nav = screen.getByTestId('assistant-file-sources')
    expect(nav.getAttribute('aria-label')).toBe('附件来源')
    expect(nav.textContent).toContain('附件来源')
    const link = screen.getByRole('link', { name: 'notes.md' })
    expect(link.getAttribute('href')).toBe('https://files.example/notes.md')
    expect(screen.getByText('report.pdf').tagName).toBe('SPAN')
    expect(screen.getByText('absolute.pdf').tagName).toBe('SPAN')
    expect(nav.textContent).not.toContain('/secret/')
    expect(screen.getByTestId('assistant-citations').textContent).toContain('Docs')
  })

  it('does not turn non-https file sources into anchors', () => {
    render(<AssistantTranscriptContent message={{
      content: 'plain',
      fileSources: [
        { name: 'local.txt', url: 'http://files.example/local.txt' },
        { name: 'disk.txt', url: 'file:///tmp/disk.txt' },
      ],
    }} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('local.txt').tagName).toBe('SPAN')
    expect(screen.getByText('disk.txt').tagName).toBe('SPAN')
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import { TOOL_OUTPUT_DISPLAY_LIMIT, TruncatedText } from './TruncatedText'
import type { TranscriptTool } from './transcript-model'

afterEach(cleanup)

const tail = 'UNIQUE_TOOL_RESULT_TAIL'
const longResult = `${'A'.repeat(TOOL_OUTPUT_DISPLAY_LIMIT)}${tail}`

function tool(result: string): TranscriptTool {
  return { id: 'read-1', name: 'read', input: '{"path":"README.md"}', result, startedAt: 1, finishedAt: 2, finished: true }
}

function expandIfCollapsed(name: RegExp) {
  const button = screen.getByRole('button', { name })
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
}

function expandToolCard() {
  expandIfCollapsed(/1 个步骤/)
  expandIfCollapsed(/read · README\.md/)
}

describe('TruncatedText', () => {
  it('renders short text unchanged and without a disclosure control', () => {
    const { container } = render(<div className="tool-result"><TruncatedText text="ok" /></div>)
    expect(container.querySelector('.tool-result')?.textContent).toBe('ok')
    expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull()
    expect(screen.queryByText(/已截断/)).toBeNull()
  })

  it('keeps the full tail out of the DOM until the user expands', () => {
    const { container } = render(<div className="tool-result"><TruncatedText text={longResult} /></div>)
    expect(container.textContent).toContain('A'.repeat(32))
    expect(container.textContent).toContain(`已截断显示前 ${TOOL_OUTPUT_DISPLAY_LIMIT} 字符，共 ${longResult.length} 字符`)
    expect(container.textContent).not.toContain(tail)
    expect(screen.getByRole('button', { name: '展开全文' }).getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(container.textContent).toContain(tail)
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(container.textContent).not.toContain(tail)
    expect(screen.getByRole('button', { name: '展开全文' })).toBeTruthy()
  })
})

describe('tool card output truncation', () => {
  it('truncates a giant tool_result by default and lazy-renders the tail after expand', () => {
    const { container } = render(<AssistantTranscriptContent message={{ content: '', tools: [tool(longResult)] }} expandSteps />)
    expandToolCard()
    const output = container.querySelector('.tool-result')!
    expect(output.textContent).toContain(`已截断显示前 ${TOOL_OUTPUT_DISPLAY_LIMIT} 字符，共 ${longResult.length} 字符`)
    expect(output.textContent).not.toContain(tail)
    expect(screen.getByRole('button', { name: '展开全文' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(container.querySelector('.tool-result')?.textContent).toContain(tail)
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })

  it('leaves short tool output unchanged', () => {
    const { container } = render(<AssistantTranscriptContent message={{ content: '', tools: [tool('source')] }} expandSteps />)
    expandToolCard()
    expect(container.querySelector('.tool-result')?.textContent).toBe('source')
    expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull()
  })
})

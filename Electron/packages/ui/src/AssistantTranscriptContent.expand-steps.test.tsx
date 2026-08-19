// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import type { TranscriptActivity, TranscriptTool } from './transcript-model'

afterEach(cleanup)

function tool(id: string, name: string, input: string, finished = true): TranscriptTool {
  return { id, name, input, result: finished ? 'ok' : undefined, startedAt: 1, finishedAt: finished ? 2 : undefined, finished }
}

describe('expandSteps accordion', () => {
  it('opens only the last step group; earlier groups stay folded', () => {
    const activities: TranscriptActivity[] = [
      { type: 'thinking', id: 't1', contentIndex: 0, content: 'first-plan' },
      { type: 'text', id: 'x1', contentIndex: 1, content: '先读 A' },
      { type: 'tool', contentIndex: 2, tool: tool('read-a', 'read', '{"path":"A.tsx"}') },
      { type: 'thinking', id: 't2', contentIndex: 3, content: 'second-plan' },
      { type: 'text', id: 'x2', contentIndex: 4, content: '再读 B' },
      { type: 'tool', contentIndex: 5, tool: tool('read-b', 'read', '{"path":"B.tsx"}') },
    ]
    render(<AssistantTranscriptContent expandSteps message={{ content: '', streaming: true, activities }} />)
    const groups = screen.getAllByRole('button', { name: /个步骤/ })
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.slice(0, -1).every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(groups.at(-1)?.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('first-plan')).toBeNull()
    expect(screen.queryByRole('button', { name: /read · A\.tsx/ })).toBeNull()
    expect(screen.getByRole('button', { name: /read · B\.tsx/ })).toBeTruthy()
  })

  it('folds the last step group too while a later tool is still running', () => {
    const activities: TranscriptActivity[] = [
      { type: 'thinking', id: 't1', contentIndex: 0, content: 'first-plan' },
      { type: 'tool', contentIndex: 1, tool: tool('read-a', 'read', '{"path":"A.tsx"}') },
      { type: 'tool', contentIndex: 2, tool: tool('bash-1', 'bash', '{"command":"ls"}', false) },
    ]
    render(<AssistantTranscriptContent expandSteps message={{ content: '', streaming: true, activities, tools: activities.flatMap(activity => activity.type === 'tool' ? [activity.tool] : []) }} />)
    const steps = screen.getByRole('button', { name: /个步骤/ })
    expect(steps.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^Thinking/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /read · A\.tsx/ })).toBeNull()
    expect(screen.getByTestId('active-tool').querySelector('b')?.textContent).toBe('bash · ls')
  })
})

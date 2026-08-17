// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'

afterEach(cleanup)

describe('thinking token meta', () => {
  it('uses uncapped charCount, not the 600-char preview length', () => {
    const preview = 'p'.repeat(600)
    render(<AssistantTranscriptContent expandSteps message={{
      content: '',
      activities: [{ type: 'thinking', id: 't', contentIndex: 0, content: preview, charCount: 2400 }],
    }} />)
    expect(screen.getByRole('button', { name: /600 tokens/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /150 tokens/ })).toBeNull()
  })

  it('falls back to preview length when charCount is missing', () => {
    render(<AssistantTranscriptContent expandSteps message={{
      content: '',
      activities: [{ type: 'thinking', id: 't', contentIndex: 0, content: 'abcd' }],
    }} />)
    expect(screen.getByRole('button', { name: /1 tokens/ })).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'

afterEach(cleanup)

describe('assistant turn error dismissal', () => {
  it('shows a persistent turn error with an accessible close control', () => {
    render(<AssistantTranscriptContent message={{ content: 'partial work', error: 'WebSocket error' }} />)
    const alert = screen.getByTestId('assistant-turn-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('WebSocket error')
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    expect(screen.getByText('partial work')).toBeTruthy()
  })

  it('hides only the visual error when closed and keeps the rest of the turn', () => {
    render(<AssistantTranscriptContent message={{ content: 'partial work', error: 'WebSocket error' }} />)
    fireEvent.click(screen.getByTestId('assistant-turn-error-close'))
    expect(screen.queryByTestId('assistant-turn-error')).toBeNull()
    expect(screen.getByText('partial work')).toBeTruthy()
  })

  it('shows a later error on the same component after a previous dismiss', () => {
    const view = render(<AssistantTranscriptContent message={{ content: 'partial work', error: 'WebSocket error' }} />)
    fireEvent.click(screen.getByTestId('assistant-turn-error-close'))
    expect(screen.queryByTestId('assistant-turn-error')).toBeNull()
    view.rerender(<AssistantTranscriptContent message={{ content: 'next hop', error: 'provider timeout' }} />)
    expect(screen.getByTestId('assistant-turn-error').textContent).toContain('provider timeout')
    expect(screen.getByText('next hop')).toBeTruthy()
  })
})

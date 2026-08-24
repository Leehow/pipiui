// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HostedCodeInterpreterCard,
  hostedCodeInterpreterStatusLabel,
  isHostedCodeInterpreterRunning,
  parseHostedCodeInterpreterPayload,
} from './HostedCodeInterpreterCard'
import type { TranscriptTool } from './transcript-model'

afterEach(cleanup)

function tool(partial: Partial<TranscriptTool> & Pick<TranscriptTool, 'input'>): TranscriptTool {
  return {
    id: 'ci_1',
    name: 'code_interpreter',
    startedAt: 1,
    ...partial,
  }
}

describe('parseHostedCodeInterpreterPayload', () => {
  it('keeps https files and strips token query keys', () => {
    const payload = parseHostedCodeInterpreterPayload(JSON.stringify({
      phase: 'completed',
      code: 'print("{{secret:API_KEY}}")',
      outputs: [{ type: 'logs', text: 'ok {{secret:API_KEY}}' }],
      files: [
        { filename: 'plot.png', url: 'https://files.example/plot.png?token=SECRET&x=1' },
        { filename: 'bad.csv', url: 'http://files.example/bad.csv' },
      ],
    }))
    expect(payload.code).toBe('print("[API_KEY]")')
    expect(payload.outputs).toEqual([{ type: 'logs', text: 'ok [API_KEY]' }])
    expect(payload.files).toEqual([
      { filename: 'plot.png', url: 'https://files.example/plot.png?x=1' },
      { filename: 'bad.csv' },
    ])
  })
})

describe('hosted code interpreter status', () => {
  it('maps lifecycle phases to running vs terminal labels', () => {
    expect(isHostedCodeInterpreterRunning('queued', false)).toBe(true)
    expect(isHostedCodeInterpreterRunning('in_progress', false)).toBe(true)
    expect(isHostedCodeInterpreterRunning('interpreting', false)).toBe(true)
    expect(isHostedCodeInterpreterRunning('completed', false)).toBe(false)
    expect(isHostedCodeInterpreterRunning('failed', false)).toBe(false)
    expect(hostedCodeInterpreterStatusLabel('queued')).toBe('排队')
    expect(hostedCodeInterpreterStatusLabel('interpreting')).toBe('运行中')
    expect(hostedCodeInterpreterStatusLabel('completed')).toBe('成功')
    expect(hostedCodeInterpreterStatusLabel('failed')).toBe('失败')
  })
})

describe('HostedCodeInterpreterCard', () => {
  it('renders code, logs, and a sanitized file link', () => {
    render(<HostedCodeInterpreterCard tool={tool({
      finished: true,
      input: JSON.stringify({
        phase: 'completed',
        code: 'print(1)',
        outputs: [{ type: 'logs', text: '1' }],
        files: [{ filename: 'out.csv', mimeType: 'text/csv', url: 'https://files.example/out.csv?access_token=abc' }],
      }),
    })} />)
    const card = screen.getByTestId('hosted-code-interpreter-card')
    expect(card.getAttribute('data-phase')).toBe('completed')
    fireEvent.click(screen.getByRole('button', { name: /代码解释器 · print\(1\)/ }))
    expect(card.textContent).toContain('print(1)')
    expect(card.textContent).toContain('1')
    const link = screen.getByRole('link', { name: /out.csv/ })
    expect(link.getAttribute('href')).toBe('https://files.example/out.csv')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(card.textContent).not.toMatch(/token=/)
  })

  it('shows failure separately and does not duplicate logs from tool.result', () => {
    render(<HostedCodeInterpreterCard tool={tool({
      finished: true,
      error: true,
      result: 'boom',
      input: JSON.stringify({
        phase: 'failed',
        code: 'raise SystemExit',
        outputs: [{ type: 'logs', text: 'trace' }],
        error: 'boom',
      }),
    })} />)
    const card = screen.getByTestId('hosted-code-interpreter-card')
    expect(card.getAttribute('data-phase')).toBe('failed')
    expect(card.getAttribute('aria-label')).toBe('代码解释器 失败')
    expect(card.textContent).toContain('trace')
    expect(card.textContent).toContain('boom')
    expect(card.textContent?.split('boom')).toHaveLength(2)
  })

  it('marks queued/interpreting cards as running even after the turn settled', () => {
    render(<HostedCodeInterpreterCard tool={tool({
      input: JSON.stringify({ phase: 'interpreting', code: 'print(1)' }),
    })} />)
    const card = screen.getByTestId('hosted-code-interpreter-card')
    expect(card.getAttribute('data-phase')).toBe('interpreting')
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('button', { name: /运行中/ })).toBeTruthy()
  })
})

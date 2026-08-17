// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import type { ChatMessage, TranscriptTool } from './transcript-model'
import { PLAN_JSON, RESULT_TEXT } from './computer-task-report.test.fixture'

afterEach(cleanup)

function expandIfCollapsed(name: RegExp) {
  const button = screen.getByRole('button', { name })
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
}

function computerTaskTool(result?: string): TranscriptTool {
  return {
    id: 'call-1',
    name: 'computer_task',
    input: JSON.stringify({ goal: 'Visually verify the bottom of Settings in the already-running COC Keeper app twice.' }),
    result,
    startedAt: 1,
    finishedAt: result ? 2 : undefined,
    finished: Boolean(result),
  }
}

function messageWith(tool: TranscriptTool, planText?: string): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    tools: [tool],
    activities: [
      ...(planText ? [{ type: 'text' as const, id: 'plan-text', contentIndex: 0, content: planText }] : []),
      { type: 'tool' as const, contentIndex: 1, tool },
    ],
  }
}

describe('computer_task result card', () => {
  it('renders a structured result card instead of the raw JSON dump', () => {
    const { container } = render(<AssistantTranscriptContent message={messageWith(computerTaskTool(RESULT_TEXT))} expandSteps />)
    const card = screen.getByTestId('computer-result-card')
    expect(card.textContent).toContain('任务受阻')
    expect(card.textContent).toContain('Visually verify the bottom of Settings')
    expect(card.textContent).toContain('执行步骤')
    expect(card.textContent).toContain('成功条件')
    // The raw ledger stays folded inside the technical details.
    const details = card.querySelector('details.computer-raw') as HTMLDetailsElement | null
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(container.querySelector('.tool-result .markdown')).toBeNull()
  })

  it('falls back to the plain tool card when the result does not match the envelope', () => {
    const { container } = render(<AssistantTranscriptContent message={messageWith(computerTaskTool('some other failure'))} expandSteps />)
    expect(screen.queryByTestId('computer-result-card')).toBeNull()
    expandIfCollapsed(/computer_task · Visually verify/)
    expect(container.querySelector('.tool-result')?.textContent).toContain('some other failure')
  })

  it('summarizes the running tool by its goal', () => {
    render(<AssistantTranscriptContent message={messageWith(computerTaskTool())} expandSteps />)
    expect(screen.queryByTestId('computer-result-card')).toBeNull()
    expect(screen.getByRole('button', { name: /computer_task · Visually verify the bottom of Settings/ })).toBeTruthy()
  })
})

describe('computer plan card', () => {
  it('renders a leader plan text segment as a growing plan card', () => {
    const { container } = render(<AssistantTranscriptContent message={messageWith(computerTaskTool(RESULT_TEXT), PLAN_JSON)} expandSteps />)
    const card = screen.getByTestId('computer-plan-card')
    expect(card.textContent).toContain('共 2 步')
    expect(card.textContent).toContain('操作')
    expect(card.textContent).toContain('核验')
    expect(card.textContent).toContain('activate the already-running COC Keeper app')
    // The plan JSON is no longer dumped as raw markdown.
    expect(container.querySelectorAll('.markdown').length).toBeLessThanOrEqual(1)
  })

  it('keeps streaming plans expanded with the goal and partial steps', () => {
    const partial = PLAN_JSON.slice(0, PLAN_JSON.indexOf('"dependsOn"'))
    render(<AssistantTranscriptContent message={{ ...messageWith(computerTaskTool()), activities: [{ type: 'text', id: 'plan-text', contentIndex: 0, content: partial }] }} expandSteps />)
    const card = screen.getByTestId('computer-plan-card')
    expect(card.textContent).toContain('正在生成')
    expect(card.textContent).toContain('已 1 步')
  })
})

describe('computer worker result card', () => {
  it('renders a completed worker verdict instead of the raw JSON dump', () => {
    const verdict = '{"outcome":"completed","summary":"目标应用主窗口已刷新观察并显示所需文本。"}'
    const { container } = render(<AssistantTranscriptContent message={{ content: verdict }} />)
    const card = screen.getByTestId('computer-worker-result-card')
    expect(card.textContent).toContain('完成')
    expect(card.textContent).toContain('目标应用主窗口已刷新观察并显示所需文本。')
    expect(container.querySelector('[data-transcript-segment="text"] .markdown')?.textContent ?? '').not.toContain('{"outcome"')
    const details = card.querySelector('details.computer-raw') as HTMLDetailsElement | null
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
  })

  it('keeps incomplete streaming JSON as plain text until the object closes', () => {
    const { container } = render(<AssistantTranscriptContent message={{ content: '{"outcome":"completed","summary":"目标应用', streaming: true }} />)
    expect(screen.queryByTestId('computer-worker-result-card')).toBeNull()
    expect(container.textContent).toContain('{"outcome"')
  })
})

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import { disposeUiContributions, registerToolRenderer } from './ui-registries'
import type { TranscriptActivity, TranscriptTool } from './transcript-model'

const TEST_EXT = 'test-envelope-dispatch'

afterEach(() => {
  disposeUiContributions(TEST_EXT)
  cleanup()
})

function quotaTool(result?: string): TranscriptTool {
  return {
    id: 'quota-1',
    name: 'quota_probe',
    input: '{}',
    result,
    startedAt: 1,
    finishedAt: result === undefined ? undefined : 2,
    finished: result !== undefined,
  }
}

function renderQuota(result?: string) {
  const tool = quotaTool(result)
  const activities: TranscriptActivity[] = [{ type: 'tool', contentIndex: 0, tool }]
  return render(
    <AssistantTranscriptContent
      expandSteps
      message={{ content: '', activities, tools: [tool] }}
    />,
  )
}

describe('toolRenderer dispatch', () => {
  it('delivers parsed details to the renderer registered for that tool name', () => {
    registerToolRenderer(TEST_EXT, {
      toolName: 'quota_probe',
      render: ({ content, details }) => (
        <div data-testid="quota-renderer">{JSON.stringify(details)}|{content}</div>
      ),
    })
    renderQuota('{ "piui:v1": { "kind": "quota", "used": 1200, "limit": 1500 } }\nok')
    expect(screen.getByTestId('quota-renderer').textContent).toBe(
      '{"kind":"quota","used":1200,"limit":1500}|ok',
    )
    expect(screen.queryByTestId('quota-renderer')).toBeTruthy()
  })

  it('falls back to TranscriptToolCard when the envelope is invalid', () => {
    registerToolRenderer(TEST_EXT, {
      toolName: 'quota_probe',
      render: () => <div data-testid="quota-renderer">should-not-render</div>,
    })
    renderQuota('{ "piui:v1": { "kind": "quota" }')
    expect(screen.queryByTestId('quota-renderer')).toBeNull()
    expect(document.querySelector('[data-activity-card="tool"]')).toBeTruthy()
  })

  it('falls back to TranscriptToolCard when there is no envelope and the renderer returns null', () => {
    registerToolRenderer(TEST_EXT, {
      toolName: 'quota_probe',
      render: ({ details }) => details != null ? <div data-testid="quota-renderer" /> : null,
    })
    renderQuota('plain output')
    expect(screen.queryByTestId('quota-renderer')).toBeNull()
    expect(document.querySelector('[data-activity-card="tool"]')).toBeTruthy()
  })
})

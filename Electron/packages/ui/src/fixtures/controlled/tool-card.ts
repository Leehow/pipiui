import { createElement, type ReactElement } from 'react'

export default function ToolCard(props: { content?: string; details?: unknown }): ReactElement {
  return createElement('div', {
    'data-testid': 'ext-controlled-tool',
  }, `${props.content}:${JSON.stringify(props.details ?? null)}`)
}

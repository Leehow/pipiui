import { createElement, type ReactElement } from 'react'

export default function ProbePanel(props: { api?: { invoke?: unknown } }): ReactElement {
  const pipi = typeof window === 'undefined' ? undefined : window.pipiHost
  return createElement('div', {
    'data-testid': 'ext-controlled-panel',
    'data-pipi-host': pipi === undefined ? 'undefined' : 'present',
    'data-has-invoke': props.api?.invoke ? '1' : '0',
    'data-has-list-projects': props.api && 'listProjects' in props.api ? '1' : '0',
  }, 'panel')
}

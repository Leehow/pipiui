import { createElement, type ReactElement } from 'react'

export default function SettingsSection(props: { id?: string; title?: string }): ReactElement {
  return createElement('div', {
    'data-testid': 'ext-controlled-settings',
  }, props.title ?? props.id)
}

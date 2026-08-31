// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkbenchRegion } from './WorkbenchRegion'
import { disposeWorkbenchContributions, registerWorkbenchContainer, registerWorkbenchView } from './workbench-contributions'
import { createWorkbenchStore } from './workbench-store'

afterEach(() => {
  cleanup()
  disposeWorkbenchContributions('campaign-fixture')
})

describe('WorkbenchRegion', () => {
  it('renders the active Profile container without knowing its product domain', () => {
    registerWorkbenchContainer('campaign-fixture', {
      id: 'campaign.navigator',
      location: 'primarySidebar',
      title: '战役',
    })
    registerWorkbenchView('campaign-fixture', {
      id: 'campaign.scenes',
      container: 'campaign.navigator',
      render: ({ active }) => <div data-testid="campaign-scenes" data-active={String(active)}>战役 → 场景</div>,
    })
    const store = createWorkbenchStore()
    store.apply({
      profileId: 'campaign-fixture',
      containers: [{ id: 'campaign.navigator', location: 'primarySidebar', title: '战役' }],
      views: [{ id: 'campaign.scenes', container: 'campaign.navigator' }],
      layout: { primarySidebar: 'campaign.navigator' },
    })

    const rendered = render(<WorkbenchRegion store={store} location="primarySidebar" />)
    expect(rendered.getByTestId('campaign-scenes').textContent).toBe('战役 → 场景')
    expect(rendered.getByTestId('campaign-scenes').getAttribute('data-active')).toBe('true')
  })
})

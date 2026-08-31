import { describe, expect, it } from 'vitest'

import { createProductWorkbenchRuntime } from './workbench-runtime'

describe('Product Workbench runtime seam', () => {
  it('keeps a base Profile activation local to its own rendered App runtime', () => {
    const coding = createProductWorkbenchRuntime()
    const base = createProductWorkbenchRuntime()

    base.activateProductWorkbenchProfile({
      id: 'base',
      name: '基础版',
      state: 'available',
      layout: {},
    }, { schemaVersion: 2, profile: 'base', overrides: {} })

    expect(coding.store.snapshot()).toMatchObject({
      profileId: 'coding',
      containers: [{ id: 'coding.sessions', location: 'primarySidebar' }],
    })
    expect(coding.activeProductExtensionsSnapshot()).toContain('coding-workbench')
    expect(base.store.snapshot()).toEqual({ profileId: 'base', containers: [], views: [], layout: { activity: [] } })
    expect(base.activeProductExtensionsSnapshot()).toEqual([])
  })
})

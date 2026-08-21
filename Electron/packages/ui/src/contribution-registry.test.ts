import { describe, expect, it, vi } from 'vitest'
import { createContributionRegistry } from './contribution-registry'

describe('contribution registry', () => {
  it('register then dispose leaves no residue and drops listeners', () => {
    const registry = createContributionRegistry<string>()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)

    const dispose = registry.register('ext-a', 'one')
    expect(registry.list()).toEqual(['one'])
    expect(listener).toHaveBeenCalledTimes(1)

    dispose()
    expect(registry.list()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)

    listener.mockClear()
    unsubscribe()
    registry.register('ext-a', 'two')
    expect(listener).not.toHaveBeenCalled()
    expect(registry.list()).toEqual(['two'])
  })

  it('disposeExtension drops every contribution for that extId', () => {
    const registry = createContributionRegistry<string>()
    registry.register('core', 'keep')
    registry.register('ext-a', 'a1')
    registry.register('ext-a', 'a2')
    const before = registry.list()
    expect(before).toEqual(['keep', 'a1', 'a2'])

    registry.disposeExtension('ext-a')
    expect(registry.list()).toEqual(['keep'])

    registry.disposeExtension('ext-a')
    expect(registry.list()).toEqual(['keep'])
  })

  it('disposer is idempotent', () => {
    const registry = createContributionRegistry<string>()
    const dispose = registry.register('ext-a', 'one')
    dispose()
    dispose()
    expect(registry.list()).toEqual([])
  })
})

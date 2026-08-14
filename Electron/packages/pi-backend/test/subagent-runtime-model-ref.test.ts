import { describe, expect, it } from 'vitest'
import { checkedSubagentOverrideModel, isProviderQualifiedModelRef } from '../../../../Sources/PipiUI/PiExt/subagent/model-ref'

describe('subagent runtime provider/model dispatch guard', () => {
  it('round-trips the exact provider-qualified model selected by Electron', () => {
    expect(isProviderQualifiedModelRef('xai/grok-4.5')).toBe(true)
    expect(checkedSubagentOverrideModel('explore', ' xai/grok-4.5 ')).toBe('xai/grok-4.5')
  })

  it('rejects a historical bare id before Pi can resolve it ambiguously', () => {
    expect(isProviderQualifiedModelRef('grok-4.5')).toBe(false)
    expect(() => checkedSubagentOverrideModel('explore', 'grok-4.5')).toThrow(/缺少 provider/)
  })
})

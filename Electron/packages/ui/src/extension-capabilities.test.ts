import { describe, expect, it } from 'vitest'
import {
  blocksEnableForL2,
  capabilityLabel,
  grantNeedsConfirmation,
  L2_CAPABILITY_HINT,
} from './extension-capabilities'

describe('extension capability helpers', () => {
  it('maps D8 capabilities to Chinese labels including bridge.emit', () => {
    expect(capabilityLabel('bridge.emit')).toBe('允许功能半向界面发送事件')
    expect(capabilityLabel('host.main')).toBe(L2_CAPABILITY_HINT)
  })

  it('blocks third-party L2 and allows official builtins', () => {
    expect(blocksEnableForL2('app', ['host.main'])).toBe(true)
    expect(blocksEnableForL2('builtin', ['host.main'])).toBe(false)
    expect(blocksEnableForL2('project', ['bridge.emit'])).toBe(false)
  })

  it('asks for confirmation on first grant and when the set grows, not when already covered', () => {
    expect(grantNeedsConfirmation(['bridge.emit'], [])).toBe(true)
    expect(grantNeedsConfirmation(['bridge.emit', 'notifications'], ['bridge.emit'])).toBe(true)
    expect(grantNeedsConfirmation(['bridge.emit'], ['bridge.emit', 'notifications'])).toBe(false)
    expect(grantNeedsConfirmation([], [])).toBe(false)
  })
})

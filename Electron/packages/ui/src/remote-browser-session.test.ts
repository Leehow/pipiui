import { describe, expect, it } from 'vitest'
import {
  classifyRemoteClose,
  nextReconnectDelayMs,
  parsePairLocation,
  phaseLabel,
  readControlType,
  readStoredRemotePair,
  remoteCloseCopy,
  writeStoredRemotePair,
} from './remote-browser-session'

describe('remote browser session', () => {
  it('stores pair credentials and degrades when storage throws', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const secret = 'ab'.repeat(32)
    const mem = new Map<string, string>()
    writeStoredRemotePair({ pairID: id, secret }, {
      setItem(key, value) { mem.set(key, value) },
    })
    expect(readStoredRemotePair({ getItem(key) { return mem.get(key) ?? null } })).toEqual({ pairID: id, secret })
    expect(readStoredRemotePair({
      getItem() { throw new Error('blocked') },
    })).toBeNull()
    expect(() => writeStoredRemotePair({ pairID: id, secret }, {
      setItem() { throw new Error('blocked') },
    })).not.toThrow()
  })

  it('parses /pair/<id>#secret and rejects a missing fragment', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const secret = 'ab'.repeat(32)
    expect(parsePairLocation(`/pair/${id}`, `#${secret}`)).toEqual({ pairID: id, secret })
    expect(parsePairLocation(`/pair/${id}`, '')).toMatchObject({ error: expect.stringContaining('密钥') })
    expect(parsePairLocation('/', `#${secret}`)).toBeNull()
  })

  it('classifies replaced / expired / host offline / auth closes', () => {
    expect(classifyRemoteClose({ controlType: 'replaced' })).toBe('replaced')
    expect(classifyRemoteClose({ code: 4001, reason: 'replaced' })).toBe('replaced')
    expect(classifyRemoteClose({ reason: 'link expired' })).toBe('expired')
    expect(classifyRemoteClose({ controlType: 'end' })).toBe('host_offline')
    expect(classifyRemoteClose({ reason: 'pairing required' })).toBe('auth')
    expect(remoteCloseCopy('replaced').title).toContain('别处')
    expect(remoteCloseCopy('expired').title).toContain('过期')
    expect(remoteCloseCopy('host_offline').detail).toContain('桌面端')
    expect(remoteCloseCopy('auth').detail).toContain('配对')
    expect(remoteCloseCopy('replaced').reconnect).toBe(false)
    expect(remoteCloseCopy('expired').reconnect).toBe(false)
    expect(remoteCloseCopy('transient').reconnect).toBe(true)
  })

  it('uses full-jitter backoff in range and Chinese phase labels', () => {
    expect(nextReconnectDelayMs(0, () => 0)).toBe(500)
    expect(nextReconnectDelayMs(0, () => 1)).toBe(750)
    expect(nextReconnectDelayMs(1, () => 0)).toBe(500)
    expect(nextReconnectDelayMs(1, () => 1)).toBe(1_500)
    expect(nextReconnectDelayMs(8, () => 1)).toBe(15_000)
    for (let n = 0; n < 6; n++) {
      const delay = nextReconnectDelayMs(n, () => 0.3)
      expect(delay).toBeGreaterThanOrEqual(500)
      expect(delay).toBeLessThanOrEqual(15_000)
    }
    expect(phaseLabel('pairing')).toBe('正在配对…')
    expect(phaseLabel('reconnecting')).toBe('正在重新连接…')
  })

  it('reads relay control frames', () => {
    expect(readControlType(JSON.stringify({ v: 2, type: 'replaced' }))).toBe('replaced')
    expect(readControlType({ data: JSON.stringify({ v: 2, type: 'expired' }) })).toBe('expired')
    expect(readControlType(JSON.stringify({ protocolVersion: 2, type: 'response' }))).toBeUndefined()
  })
})

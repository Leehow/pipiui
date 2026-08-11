import { describe, expect, it, vi } from 'vitest'
import type { HostBackend } from '@pipi/host-api'
import { safeExternalHttpURL, withOpenExternal } from './external-url.js'

describe('safeExternalHttpURL', () => {
  it('accepts and normalizes http(s) URLs', () => {
    expect(safeExternalHttpURL('https://example.com/login')).toBe('https://example.com/login')
    expect(safeExternalHttpURL('http://localhost:8787/callback')).toBe('http://localhost:8787/callback')
  })

  it.each(['file:///tmp/token', 'javascript:alert(1)', 'data:text/plain,secret', 'pipi://login'])('rejects %s', url => {
    expect(() => safeExternalHttpURL(url)).toThrow('only http/https URLs may be opened')
  })

  it.each([undefined, 42, 'not a url'])('rejects malformed input %s', value => {
    expect(() => safeExternalHttpURL(value)).toThrow('invalid URL')
  })
})

describe('withOpenExternal', () => {
  const backend: HostBackend = {
    handle: vi.fn(async () => 'forwarded'),
    subscribe: () => () => undefined
  }

  it('invokes the system opener for a normalized safe URL', async () => {
    const open = vi.fn(async () => undefined)
    await withOpenExternal(backend, open).handle('openExternal', ['https://example.com/login'])
    expect(open).toHaveBeenCalledWith('https://example.com/login')
  })

  it('rejects unsafe schemes before invoking the system opener', async () => {
    const open = vi.fn(async () => undefined)
    await expect(withOpenExternal(backend, open).handle('openExternal', ['file:///tmp/token'])).rejects.toThrow('only http/https')
    expect(open).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from 'vitest'
import { isKnownBrand, providerBrand, providerLogoInfo } from './provider-logo'

describe('provider logos', () => {
  it('uses the official Cursor brand mark instead of a letter glyph', () => {
    expect(providerBrand('cursor')).toBe('cursor')
    expect(isKnownBrand('cursor')).toBe(true)
    const info = providerLogoInfo('cursor')
    expect(info.paths?.length).toBeGreaterThan(0)
    expect(info.paths?.[0]?.d.startsWith('M11.503')).toBe(true)
    expect(info.glyph).toBeUndefined()
  })
})

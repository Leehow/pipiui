import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'
import { qrModules, qrSvg } from './pair-qr'

const PAIR =
  'https://pipi.aichattrpg.com/pair/11111111-1111-4111-8111-111111111111#abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

function modulesToImageData(modules: boolean[][], quiet = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const n = modules.length
  const dim = n + quiet * 2
  const data = new Uint8ClampedArray(dim * dim * 4)
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const r = y - quiet
      const c = x - quiet
      const dark = r >= 0 && c >= 0 && r < n && c < n && modules[r][c]
      const v = dark ? 0 : 255
      const i = (y * dim + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width: dim, height: dim }
}

function isFinder(modules: boolean[][], r0: number, c0: number): boolean {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const on = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      if (modules[r0 + r][c0 + c] !== on) return false
    }
  }
  return true
}

describe('pair-qr', () => {
  it('encodes pairing URL so jsQR recovers the full URL including fragment', () => {
    const modules = qrModules(PAIR)
    const image = modulesToImageData(modules, 4)
    const decoded = jsQR(image.data, image.width, image.height)
    expect(decoded?.data).toBe(PAIR)
  })

  it('has finder patterns and a standard QR size', () => {
    const modules = qrModules(PAIR)
    const n = modules.length
    expect(n).toBeGreaterThanOrEqual(21)
    expect((n - 17) % 4).toBe(0)
    expect(isFinder(modules, 0, 0)).toBe(true)
    expect(isFinder(modules, 0, n - 7)).toBe(true)
    expect(isFinder(modules, n - 7, 0)).toBe(true)
  })

  it('renders an svg wrapping the module matrix', () => {
    const svg = qrSvg(PAIR)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('shape-rendering="crispEdges"')
  })
})

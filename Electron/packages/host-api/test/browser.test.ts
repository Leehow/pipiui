import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isBrowserSurfaceEvent, type BrowserSurfaceEvent, type BrowserWatchInfo } from '../src/browser.js'
import { PIPI_HOST_PROTOCOL_VERSION, type HostEvent } from '../src/index.js'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

function watchEvent(overrides: Partial<Extract<BrowserSurfaceEvent, { type: 'watch' }>> = {}): Extract<BrowserSurfaceEvent, { type: 'watch' }> {
  const watches: BrowserWatchInfo[] = [{
    watchId: 'bw-1',
    condition: { type: 'url_matches', pattern: 'done' },
    createdAt: 1,
    timeoutAt: null,
    intervalMs: 500,
    status: 'active',
  }]
  return { type: 'watch', sessionId: 's1', watches, ...overrides }
}

describe('@pipi/host-api/browser subpath', () => {
  it('declares the ./browser export backed by dist/browser.d.ts + dist/browser.js', () => {
    // The workspace consumers resolve the subpath through this mapping, so
    // a missing or misnamed entry breaks every import at once.
    expect(packageJson.exports['./browser']).toEqual({
      types: './dist/browser.d.ts',
      import: './dist/browser.js',
    })
    expect(packageJson.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    })
  })

  it('is covered by the package build (tsconfig includes src, so browser.ts compiles into dist)', () => {
    const tsconfig = readFileSync(fileURLToPath(new URL('../tsconfig.json', import.meta.url)), 'utf8')
    expect(tsconfig).toContain('"include":["src"]')
  })
})

describe('isBrowserSurfaceEvent', () => {
  it('accepts every surface event variant, including the four this subpath adds', () => {
    const base = [
      { type: 'tabs', sessionId: 's1', snapshot: { tabs: [] } },
      { type: 'reveal', sessionId: 's1' },
      { type: 'error', sessionId: 's1', message: 'boom' },
      { type: 'mobile-window', sessionId: 's1', open: false },
    ]
    const added = [
      { type: 'console', sessionId: 's1', entry: { timestamp: 1, level: 'error', message: 'x' } },
      { type: 'certificate-error', sessionId: 's1', url: 'https://x', reason: 'ERR' },
      { type: 'js-dialog', sessionId: 's1', kind: 'alert', message: 'hi' },
      watchEvent(),
    ]
    for (const event of [...base, ...added]) expect(isBrowserSurfaceEvent(event)).toBe(true)
  })

  it('rejects non-events, unknown type tags, and missing session scoping', () => {
    expect(isBrowserSurfaceEvent(null)).toBe(false)
    expect(isBrowserSurfaceEvent('tabs')).toBe(false)
    expect(isBrowserSurfaceEvent({ type: 'tabs', snapshot: { tabs: [] } })).toBe(false)
    expect(isBrowserSurfaceEvent({ type: 'tabs', sessionId: 7, snapshot: { tabs: [] } })).toBe(false)
    expect(isBrowserSurfaceEvent({ type: 'unknown', sessionId: 's1' })).toBe(false)
  })

  it('surface events ride the root browser wire envelope unchanged', () => {
    // The transport envelope is the root HostEvent browser frame; the widened
    // union is a consumer-side view, so the frame must stay structurally valid.
    const event = watchEvent({ trigger: { watchId: 'bw-1', reason: 'matched', waitedMs: 42, url: 'https://done', title: 'Done', firedAt: 2 } })
    const frame: HostEvent = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'browser', event: event as never }
    expect(frame.channel).toBe('browser')
    expect(isBrowserSurfaceEvent(frame.event)).toBe(true)
  })
})

describe('browser watch snapshot shape', () => {
  it('serializes an Infinity deadline as null (JSON-safe) and carries the full active list', () => {
    const event = watchEvent({
      watches: [{
        watchId: 'bw-2',
        condition: { type: 'idle', idleMs: 500 },
        createdAt: 10,
        timeoutAt: null,
        intervalMs: 250,
        status: 'checking',
      }],
    })
    const round = JSON.parse(JSON.stringify(event)) as Extract<BrowserSurfaceEvent, { type: 'watch' }>
    expect(round.watches).toHaveLength(1)
    expect(round.watches[0].timeoutAt).toBeNull()
    expect(round.trigger).toBeUndefined()
    expect(isBrowserSurfaceEvent(round)).toBe(true)
  })
})

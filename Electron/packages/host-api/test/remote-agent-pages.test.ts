import { describe, it, expect } from 'vitest'
import { collectRemoteAgentPages, remoteAgentPage } from '../src/remote-agent-pages'

describe('remote agent pages', () => {
  it('retains whole multibyte rows across byte-bounded pages', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ agentId: String(i).padStart(3, '0'), runId: 'r', finalResult: '中'.repeat(10_000) }))
    let pages = 0
    const result = await collectRemoteAgentPages(async request => {
      pages += 1
      const page = remoteAgentPage(rows, request)
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThan(1024 * 1024)
      return page
    })
    expect(result).toEqual(rows)
    expect(pages).toBeGreaterThan(1)
  })

  it('accepts old-host arrays but rejects non-advancing cursors', async () => {
    await expect(collectRemoteAgentPages(async () => [1, 2])).resolves.toEqual([1, 2])
    await expect(collectRemoteAgentPages(async () => ({ remotePage: 1, items: [1], nextCursor: 'same' }))).rejects.toThrow('did not advance')
  })
})

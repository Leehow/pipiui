import { describe, expect, it } from 'vitest'
import { createIpcHost, type IpcRendererLike } from '../src/index.js'

describe('listAgentDefinitions catalog contract', () => {
  it('forwards optional projectId and accepts expanded catalog rows', async () => {
    const requests: { method: string; params: unknown[] }[] = []
    const ipc: IpcRendererLike = {
      invoke: async (_channel, request: { protocolVersion: number; id: string; method: string; params: unknown[] }) => {
        requests.push({ method: request.method, params: request.params })
        return {
          protocolVersion: request.protocolVersion,
          id: request.id,
          type: 'response',
          ok: true,
          result: [
            { name: 'explore', description: 'Research agent', origin: 'bundled', source: 'bundled', mode: 'read-only', available: true, availability: 'available' },
            { name: 'secretary', description: 'Closeout secretary', origin: 'bundled', source: 'bundled', canonical: true, canonicalRole: 'secretary', available: true, availability: 'available' },
          ],
        }
      },
      on: () => {},
      removeListener: () => {},
    }
    const host = createIpcHost(ipc)
    const omitted = await host.listAgentDefinitions?.()
    const catalog = await host.listAgentDefinitions?.('proj-1')
    expect(requests.map(({ method, params }) => [method, params])).toEqual([
      ['listAgentDefinitions', []],
      ['listAgentDefinitions', ['proj-1']],
    ])
    expect(omitted?.every(agent => typeof agent.name === 'string' && typeof agent.description === 'string')).toBe(true)
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'explore', description: 'Research agent' }),
      expect.objectContaining({ name: 'secretary', canonicalRole: 'secretary' }),
    ]))
  })
})

import { describe, expect, it } from 'vitest'
import { PIPI_HOST_PROTOCOL_VERSION, type HostBackend, type HostRequest, type HostResponse, type HostWireFrame } from '@pipi/host-api'
import { registerPipiHostIpc, type IpcMainLike, type RendererSender } from './index'

type Handler = (event: { sender: RendererSender }, request: HostRequest) => Promise<HostResponse>

function harness() {
  let emit: (frame: HostWireFrame) => void = () => {}
  let handler: Handler = async () => ({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: '', type: 'response', ok: true, result: undefined })
  const backend: HostBackend = {
    handle: async () => undefined,
    subscribe: (listener) => { emit = listener as (frame: HostWireFrame) => void; return () => {} }
  }
  const ipc: IpcMainLike = { handle: (_channel, listener) => { handler = listener } }
  registerPipiHostIpc(ipc, backend)
  const attach = (sender: RendererSender) => handler({ sender }, {
    protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: '1', type: 'request', method: 'listModels', params: []
  } as unknown as HostRequest)
  const frame = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'output', terminalId: 't', data: 'x' } } as unknown as HostWireFrame
  return { attach, publish: () => emit(frame) }
}

describe('host IPC renderer fan-out', () => {
  it('skips a destroyed renderer and still serves the live one', async () => {
    const { attach, publish } = harness()
    const delivered: string[] = []
    const dead: RendererSender = { send: () => { throw new Error('Object has been destroyed') }, isDestroyed: () => true }
    const live: RendererSender = { send: () => { delivered.push('live') } }
    await attach(dead)
    await attach(live)
    expect(() => publish()).not.toThrow()
    expect(delivered).toEqual(['live'])
  })

  it('survives a renderer that dies between the check and the send', async () => {
    const { attach, publish } = harness()
    const delivered: string[] = []
    // isDestroyed() still reports alive — the window closes inside send(), which
    // is the race a pty timer flush hits on Windows.
    const racing: RendererSender = { send: () => { throw new Error('Object has been destroyed') }, isDestroyed: () => false }
    const live: RendererSender = { send: () => { delivered.push('live') } }
    await attach(racing)
    await attach(live)
    expect(() => publish()).not.toThrow()
    expect(delivered).toEqual(['live'])
    // The thrower is dropped, so a second emit costs nothing.
    publish()
    expect(delivered).toEqual(['live', 'live'])
  })

  it('unsubscribes a renderer on its destroyed event', async () => {
    const { attach, publish } = harness()
    const delivered: string[] = []
    let destroy: (() => void) | undefined
    const sender: RendererSender = {
      send: () => { delivered.push('sent') },
      once: (_event, listener) => { destroy = listener }
    }
    await attach(sender)
    publish()
    expect(delivered).toEqual(['sent'])
    destroy?.()
    publish()
    expect(delivered).toEqual(['sent'])
  })
})

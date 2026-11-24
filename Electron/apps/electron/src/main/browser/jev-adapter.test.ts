import { describe, it, expect, vi } from 'vitest'
import { JevBrowserAdapter } from './jev-adapter.js'

function fixture(attached = false) {
  let current = true
  const debuggerMock = {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true }), detach: vi.fn(() => { attached = false }),
    sendCommand: vi.fn(async () => ({ result: { value: 'observed' } })),
  }
  const contents: any = { debugger: debuggerMock, executeJavaScript: vi.fn(async () => ['private-secret-value']) }
  return { debuggerMock, adapter: new JevBrowserAdapter(contents, () => current), replace: () => { current = false } }
}
describe('Jev adapter for the owned WebContents', () => {
  it('only attaches to the supplied page and detaches its own connection', async () => {
    const f = fixture()
    expect(await f.adapter.command('Runtime.evaluate', { expression: 'document.title' })).toEqual({ result: { value: 'observed' } })
    expect(f.debuggerMock.attach).toHaveBeenCalledTimes(1)
    await expect(f.adapter.command('Target.createTarget', {})).rejects.toThrow('jev-command-denied')
    f.adapter.close()
    expect(f.debuggerMock.detach).toHaveBeenCalledTimes(1)
  })
  it('preserves an existing debugger owner and refuses a replaced tab before input', async () => {
    const f = fixture(true)
    await f.adapter.command('Runtime.evaluate', {})
    f.replace()
    await expect(f.adapter.command('Input.insertText', { text: 'test' })).rejects.toThrow('jev-page-replaced')
    f.adapter.close()
    expect(f.debuggerMock.attach).not.toHaveBeenCalled()
    expect(f.debuggerMock.detach).not.toHaveBeenCalled()
    expect(f.debuggerMock.sendCommand).toHaveBeenCalledTimes(1)
  })
  it('reports destroyed evaluation contexts as stale observations, never retries input', async () => {
    const f = fixture(true)
    f.debuggerMock.sendCommand.mockRejectedValue(new Error('Execution context was destroyed'))
    expect(await f.adapter.command('Runtime.evaluate', {})).toHaveProperty('exceptionDetails')
    await expect(f.adapter.command('Input.insertText', {})).rejects.toThrow('Execution context')
    expect(f.debuggerMock.sendCommand).toHaveBeenCalledTimes(2)
  })
  it('redacts sensitive DOM values while preserving ordinary current values', async () => {
    const f = fixture(true)
    f.debuggerMock.sendCommand.mockResolvedValue({ result: { value: ['private-secret-value'] } } as any)
    expect(await f.adapter.sanitize({ text: 'private-secret-value', current_value: 'Two' })).toEqual({ text: '[redacted]', current_value: 'Two' })
  })
})

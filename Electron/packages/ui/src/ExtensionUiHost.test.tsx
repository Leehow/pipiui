// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtUiEvent, ExtUiResponse } from '@pipi/host-api'
import { ExtensionUiHost } from './ExtensionUiHost'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function fakeHost() {
  const listeners = new Set<(event: ExtUiEvent) => void>()
  const responses: Array<{ sessionId: string; requestId: string; response: ExtUiResponse }> = []
  return {
    subscribeExtUi: (listener: (event: ExtUiEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    extensionUiResponse: vi.fn(async (sessionId: string, requestId: string, response: ExtUiResponse) => {
      responses.push({ sessionId, requestId, response })
    }),
    emit(event: ExtUiEvent) {
      for (const listener of listeners) listener(event)
    },
    responses,
  }
}

describe('ExtensionUiHost', () => {
  it('renders notify as an inline banner', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'n1',
        kind: 'notify',
        payload: { message: 'Command blocked', notifyType: 'warning' },
      })
    })
    expect(screen.getByTestId('extui-notify').textContent).toContain('Command blocked')
    expect(host.responses).toEqual([])
  })

  it('sends confirmed true/false for confirm 确定 and 取消', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?', message: 'All gone.' },
      })
    })
    expect(screen.getByTestId('extui-dialog').textContent).toContain('All gone.')
    fireEvent.click(screen.getByTestId('extui-confirm-yes'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c1', { confirmed: true })
    expect(screen.queryByTestId('extui-dialog')).toBeNull()

    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c2',
        kind: 'confirm',
        payload: { title: 'Again?' },
      })
    })
    fireEvent.click(screen.getByTestId('extui-confirm-no'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c2', { confirmed: false })
  })

  it('submits input text and cancels on close', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'i1',
        kind: 'input',
        payload: { title: 'Name', placeholder: 'type' },
      })
    })
    fireEvent.change(screen.getByTestId('extui-input'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByTestId('extui-input-submit'))
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'i1', { value: 'Ada' })
  })

  it('closes a pending dialog when the session is aborted without sending a late response', () => {
    const host = fakeHost()
    render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?' },
      })
    })
    expect(screen.getByTestId('extui-dialog')).toBeTruthy()
    act(() => {
      host.emit({ type: 'cancel', sessionId: 'session-1', requestId: 'c1', reason: 'aborted' })
    })
    expect(screen.queryByTestId('extui-dialog')).toBeNull()
    expect(host.extensionUiResponse).not.toHaveBeenCalled()
  })

  it('cancels a pending dialog when the selected session changes', () => {
    const host = fakeHost()
    const view = render(<ExtensionUiHost host={host} sessionId="session-1" />)
    act(() => {
      host.emit({
        type: 'request',
        sessionId: 'session-1',
        requestId: 'c1',
        kind: 'confirm',
        payload: { title: 'Clear?' },
      })
    })
    view.rerender(<ExtensionUiHost host={host} sessionId="session-2" />)
    expect(screen.queryByTestId('extui-dialog')).toBeNull()
    expect(host.extensionUiResponse).toHaveBeenCalledWith('session-1', 'c1', { cancelled: true })
  })
})

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ExtUiEvent, ExtUiResponse, PipiHostAPI } from '@pipi/host-api'
import './extension-ui-host.css'

export type ExtensionUiHostApi = Pick<PipiHostAPI, 'subscribeExtUi' | 'extensionUiResponse'>

type NotifyItem = {
  id: string
  sessionId: string
  requestId: string
  message: string
  tone: 'info' | 'warning' | 'error'
}

type DialogItem = {
  sessionId: string
  requestId: string
  kind: 'confirm' | 'select' | 'input' | 'editor'
  title: string
  message: string
  placeholder?: string
  options: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function notifyMessage(kind: string, payload: Record<string, unknown>): string {
  if (kind === 'widget') {
    const lines = payload.widgetLines
    if (Array.isArray(lines)) return lines.filter(item => typeof item === 'string').join('\n')
  }
  return asString(payload.message) || asString(payload.title) || asString(payload.text)
}

function notifyTone(payload: Record<string, unknown>): NotifyItem['tone'] {
  const raw = asString(payload.notifyType)
  return raw === 'warning' || raw === 'error' ? raw : 'info'
}

function toDialog(event: Extract<ExtUiEvent, { type: 'request' }>): DialogItem | undefined {
  if (event.kind !== 'confirm' && event.kind !== 'select' && event.kind !== 'input' && event.kind !== 'editor') {
    return undefined
  }
  const payload = asRecord(event.payload)
  const options = Array.isArray(payload.options) ? payload.options.filter(item => typeof item === 'string') as string[] : []
  return {
    sessionId: event.sessionId,
    requestId: event.requestId,
    kind: event.kind,
    title: asString(payload.title) || (event.kind === 'confirm' ? '确认' : event.kind === 'select' ? '选择' : '输入'),
    message: asString(payload.message),
    placeholder: asString(payload.placeholder) || undefined,
    options,
  }
}

export function ExtensionUiHost({
  host,
  sessionId,
}: {
  host: ExtensionUiHostApi
  sessionId?: string
}) {
  const [notifies, setNotifies] = useState<NotifyItem[]>([])
  const [dialog, setDialog] = useState<DialogItem | null>(null)
  const [inputValue, setInputValue] = useState('')
  const dialogRef = useRef<DialogItem | null>(null)
  const sessionRef = useRef(sessionId)
  const notifyTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const titleId = useId()
  dialogRef.current = dialog

  const reply = useCallback((item: { sessionId: string; requestId: string }, response: ExtUiResponse) => {
    void host.extensionUiResponse?.(item.sessionId, item.requestId, response)?.catch(() => undefined)
  }, [host])

  useEffect(() => {
    const previous = sessionRef.current
    sessionRef.current = sessionId
    const open = dialogRef.current
    if (open && previous && previous !== sessionId) {
      reply(open, { cancelled: true })
      setDialog(null)
    }
  }, [sessionId, reply])

  useEffect(() => () => {
    for (const timer of notifyTimers.current) clearTimeout(timer)
    notifyTimers.current = []
  }, [])

  useEffect(() => {
    if (!host.subscribeExtUi) return
    return host.subscribeExtUi((event: ExtUiEvent) => {
      if (event.type === 'cancel') {
        setDialog(current => (
          current && current.sessionId === event.sessionId && current.requestId === event.requestId ? null : current
        ))
        return
      }
      if (event.type !== 'request') return
      if (event.kind === 'notify' || event.kind === 'widget') {
        const payload = asRecord(event.payload)
        const message = notifyMessage(event.kind, payload)
        if (!message) return
        const item: NotifyItem = {
          id: `${event.sessionId}:${event.requestId}`,
          sessionId: event.sessionId,
          requestId: event.requestId,
          message,
          tone: notifyTone(payload),
        }
        setNotifies(current => [...current.filter(entry => entry.id !== item.id), item])
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          setNotifies(current => current.filter(entry => entry.id !== item.id))
        }, 5000)
        notifyTimers.current.push(timer)
        return
      }
      const next = toDialog(event)
      if (!next) return
      setDialog(current => {
        if (current && (current.sessionId !== next.sessionId || current.requestId !== next.requestId)) {
          reply(current, { cancelled: true })
        }
        return next
      })
      setInputValue(asString(asRecord(event.payload).prefill))
    })
  }, [host, reply])

  useEffect(() => {
    if (!dialog) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      reply(dialog, { cancelled: true })
      setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, reply])

  const dismissDialog = (response: ExtUiResponse) => {
    if (!dialog) return
    reply(dialog, response)
    setDialog(null)
  }

  return (
    <>
      {notifies.length > 0 && (
        <div className="extui-notify-stack" data-testid="extui-notify-stack">
          {notifies.map(item => (
            <div
              key={item.id}
              className={`extui-notify${item.tone !== 'info' ? ` is-${item.tone}` : ''}`}
              role="status"
              data-testid="extui-notify"
            >
              <p className="extui-notify-message">{item.message}</p>
              <button
                type="button"
                className="extui-notify-close"
                aria-label="关闭通知"
                onClick={() => setNotifies(current => current.filter(entry => entry.id !== item.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {dialog && (
        <div
          className="extui-dialog-backdrop"
          data-testid="extui-dialog-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) dismissDialog({ cancelled: true })
          }}
        >
          <section
            className="extui-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="extui-dialog"
            data-kind={dialog.kind}
          >
            <header className="extui-dialog-header">
              <h2 id={titleId}>{dialog.title}</h2>
              <button
                type="button"
                className="extui-dialog-close"
                aria-label="关闭对话框"
                onClick={() => dismissDialog({ cancelled: true })}
              >
                ×
              </button>
            </header>
            <div className="extui-dialog-body">
              {dialog.message ? <p className="extui-dialog-message">{dialog.message}</p> : null}
              {dialog.kind === 'select' && (
                <div className="extui-dialog-options">
                  {dialog.options.map(option => (
                    <button
                      key={option}
                      type="button"
                      className="extui-dialog-option"
                      data-testid="extui-select-option"
                      onClick={() => dismissDialog({ value: option })}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {(dialog.kind === 'input' || dialog.kind === 'editor') && (
                dialog.kind === 'editor' ? (
                  <textarea
                    className="extui-dialog-input"
                    data-testid="extui-input"
                    placeholder={dialog.placeholder}
                    value={inputValue}
                    onChange={event => setInputValue(event.target.value)}
                    rows={6}
                  />
                ) : (
                  <input
                    className="extui-dialog-input"
                    data-testid="extui-input"
                    placeholder={dialog.placeholder}
                    value={inputValue}
                    onChange={event => setInputValue(event.target.value)}
                  />
                )
              )}
              <div className="extui-dialog-actions">
                {dialog.kind === 'confirm' ? (
                  <>
                    <button type="button" data-testid="extui-confirm-no" onClick={() => dismissDialog({ confirmed: false })}>取消</button>
                    <button type="button" className="extui-dialog-primary" data-testid="extui-confirm-yes" onClick={() => dismissDialog({ confirmed: true })}>确定</button>
                  </>
                ) : dialog.kind === 'input' || dialog.kind === 'editor' ? (
                  <>
                    <button type="button" data-testid="extui-input-cancel" onClick={() => dismissDialog({ cancelled: true })}>取消</button>
                    <button type="button" className="extui-dialog-primary" data-testid="extui-input-submit" onClick={() => dismissDialog({ value: inputValue })}>提交</button>
                  </>
                ) : (
                  <button type="button" data-testid="extui-select-cancel" onClick={() => dismissDialog({ cancelled: true })}>取消</button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

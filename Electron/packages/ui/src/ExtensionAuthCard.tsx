import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthLoginEvent, ExtensionAuthStatus, PipiHostAPI } from '@pipi/host-api'
import { DismissibleError } from './DismissibleError'

function formatExpiry(expiresAtMs: number): string {
  const remainingMs = expiresAtMs - Date.now()
  if (!Number.isFinite(remainingMs)) return '有效期未知'
  if (remainingMs <= 0) return '已过期'
  const minutes = Math.floor(remainingMs / 60_000)
  if (minutes < 60) return `剩余 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `剩余 ${hours} 小时`
  return `剩余 ${Math.floor(hours / 24)} 天`
}

function isLoginEvent(value: unknown): value is AuthLoginEvent {
  if (!value || typeof value !== 'object' || typeof (value as { kind?: unknown }).kind !== 'string') return false
  return ['auth_url', 'prompt', 'notice', 'completed', 'failed', 'cancelled'].includes((value as { kind: string }).kind)
}

/** Pick only the host-owned, secret-free fields. Extra keys from a buggy host stay off-screen. */
function safeStatus(value: ExtensionAuthStatus): {
  loggedIn: boolean
  usable: boolean
  expiresAtMs?: number
  error?: string
} {
  return {
    loggedIn: Boolean(value.loggedIn),
    usable: Boolean(value.usable),
    expiresAtMs: typeof value.expiresAtMs === 'number' ? value.expiresAtMs : undefined,
    error: typeof value.error === 'string' && value.error.trim() ? value.error : undefined,
  }
}

type LoginPhase = 'idle' | 'pending' | 'input' | 'auth'

type LoginSession = {
  loginId: string
  phase: LoginPhase
  event?: AuthLoginEvent
  input: string
  browserError?: string
}

/**
 * Host-owned extension login surface. Uses only generic host auth APIs and
 * never renders tokens, keys, or infrastructure fields.
 */
export function ExtensionAuthCard({ host, extensionId }: { host: PipiHostAPI; extensionId: string }) {
  const [status, setStatus] = useState<ReturnType<typeof safeStatus> | null>(null)
  const [session, setSession] = useState<LoginSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(false)
  const loginRequestRef = useRef(0)

  const refreshStatus = useCallback(async () => {
    if (!host.getExtensionAuthStatus) {
      setError('当前连接不支持扩展登录')
      setStatus(null)
      return
    }
    try {
      const next = safeStatus(await host.getExtensionAuthStatus(extensionId))
      if (!mountedRef.current) return
      setStatus(next)
      if (next.error) setError(current => current ?? next.error ?? null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(`无法读取登录状态：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [extensionId, host])

  useEffect(() => {
    mountedRef.current = true
    void refreshStatus()
    const unsubCatalog = host.subscribeModelCatalog?.(() => { void refreshStatus() })
    return () => {
      mountedRef.current = false
      loginRequestRef.current += 1
      unsubCatalog?.()
    }
  }, [host, refreshStatus])

  const advance = useCallback(async (loginId: string, request: number, input?: string) => {
    if (!host.continueProviderLogin) {
      setSession(null)
      setError('当前连接不支持扩展登录')
      return
    }
    try {
      const event = await host.continueProviderLogin(loginId, input)
      if (!mountedRef.current || request !== loginRequestRef.current) return
      if (!isLoginEvent(event)) throw new Error('主进程返回了无效的登录响应')
      if (event.kind === 'prompt') {
        setSession(current => current?.loginId === loginId ? { ...current, phase: 'input', event, input: '' } : current)
      } else if (event.kind === 'auth_url') {
        setSession(current => current?.loginId === loginId ? { ...current, phase: 'auth', event } : current)
        if (host.openExternal) {
          void host.openExternal(event.url).catch(err => {
            if (!mountedRef.current || request !== loginRequestRef.current) return
            setSession(current => current?.loginId === loginId
              ? { ...current, browserError: `未能自动打开浏览器：${err instanceof Error ? err.message : String(err)}` }
              : current)
          })
        }
      } else if (event.kind === 'completed') {
        setSession(null)
        setError(null)
        await refreshStatus()
      } else if (event.kind === 'failed') {
        setSession(null)
        setError(event.error)
      } else if (event.kind === 'cancelled') {
        setSession(null)
      } else {
        void advance(loginId, request)
      }
    } catch (err) {
      if (!mountedRef.current || request !== loginRequestRef.current) return
      setSession(null)
      setError(`登录中断：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [host, refreshStatus])

  const startLogin = useCallback(async () => {
    if (!host.beginExtensionLogin) {
      setError('当前连接不支持扩展登录')
      return
    }
    const request = ++loginRequestRef.current
    setError(null)
    setBusy(true)
    setSession({ loginId: '', phase: 'pending', input: '' })
    try {
      const started = await host.beginExtensionLogin(extensionId)
      if (!mountedRef.current || request !== loginRequestRef.current) return
      if (!started || typeof started.loginId !== 'string' || !started.loginId) {
        throw new Error('主进程返回了无效的登录响应')
      }
      setSession({ loginId: started.loginId, phase: 'pending', input: '' })
      void advance(started.loginId, request)
    } catch (err) {
      if (!mountedRef.current || request !== loginRequestRef.current) return
      setSession(null)
      setError(`开始登录失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current && request === loginRequestRef.current) setBusy(false)
    }
  }, [advance, extensionId, host])

  const continueLogin = useCallback((loginId: string, input?: string) => {
    const request = loginRequestRef.current
    setSession(current => current?.loginId === loginId ? { ...current, input: '' } : current)
    void advance(loginId, request, input)
  }, [advance])

  const cancelLogin = useCallback(async () => {
    const current = session
    loginRequestRef.current += 1
    setSession(null)
    if (!current?.loginId) return
    try {
      await host.cancelProviderLogin?.(current.loginId)
    } catch {
      // Local session already closed.
    }
  }, [host, session])

  const logout = useCallback(async () => {
    if (!host.logoutExtension) {
      setError('当前连接不支持扩展退出')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await host.logoutExtension(extensionId)
      await refreshStatus()
    } catch (err) {
      setError(`退出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [extensionId, host, refreshStatus])

  const loggedIn = Boolean(status?.loggedIn)
  const pending = Boolean(session) && !error
  const statusLabel = pending
    ? '正在登录…'
    : loggedIn
      ? `已登录${typeof status?.expiresAtMs === 'number' ? ` · ${formatExpiry(status.expiresAtMs)}` : ''}`
      : '未登录'

  return (
    <div className="extensions-pkg-auth" data-testid={`extensions-pkg-auth-${extensionId}`}>
      <div className="extensions-pkg-auth-row">
        <span className="extensions-pkg-auth-status" data-testid={`extensions-pkg-auth-status-${extensionId}`}>{statusLabel}</span>
        <div className="extensions-pkg-auth-actions">
          {loggedIn && !pending && (
            <>
              <button
                type="button"
                className="provider-login-btn"
                disabled={busy}
                data-testid={`extensions-pkg-auth-relogin-${extensionId}`}
                onClick={() => { void startLogin() }}
              >
                重新登录
              </button>
              <button
                type="button"
                className="model-modal-refresh"
                disabled={busy}
                data-testid={`extensions-pkg-auth-logout-${extensionId}`}
                onClick={() => { void logout() }}
              >
                退出
              </button>
            </>
          )}
          {!loggedIn && !pending && (
            <button
              type="button"
              className="provider-login-btn"
              disabled={busy}
              data-testid={`extensions-pkg-auth-login-${extensionId}`}
              onClick={() => { void startLogin() }}
            >
              登录
            </button>
          )}
          {pending && (
            <button
              type="button"
              className="provider-login-cancel"
              data-testid={`extensions-pkg-auth-cancel-${extensionId}`}
              onClick={() => { void cancelLogin() }}
            >
              取消
            </button>
          )}
        </div>
      </div>
      {pending && session?.phase === 'pending' && (
        <p className="extensions-pkg-auth-pending" data-testid={`extensions-pkg-auth-pending-${extensionId}`}>正在等待授权…</p>
      )}
      {session?.phase === 'input' && session.event?.kind === 'prompt' && (
        <form
          className="provider-login-form"
          data-testid={`extensions-pkg-auth-prompt-${extensionId}`}
          onSubmit={event => {
            event.preventDefault()
            if (session.input.trim() || session.event?.kind === 'prompt' && session.event.promptType === 'text') {
              continueLogin(session.loginId, session.input)
            }
          }}
        >
          <label>{session.event.message}</label>
          {session.event.promptType === 'select' && session.event.options?.length
            ? (
              <div className="provider-login-options">
                {session.event.options.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    className="provider-login-btn"
                    onClick={() => continueLogin(session.loginId, option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )
            : (
              <input
                type={session.event.promptType === 'secret' ? 'password' : 'text'}
                value={session.input}
                placeholder={session.event.placeholder}
                aria-label={session.event.message}
                data-testid={`extensions-pkg-auth-input-${extensionId}`}
                onChange={event => setSession(current => current ? { ...current, input: event.target.value } : current)}
              />
            )}
        </form>
      )}
      {session?.phase === 'auth' && session.event?.kind === 'auth_url' && (
        <div className="provider-login-auth" data-testid={`extensions-pkg-auth-url-${extensionId}`}>
          {session.event.instructions && <p>{session.event.instructions}</p>}
          {session.event.code && <div className="provider-login-code">设备码：<b>{session.event.code}</b></div>}
          <div className="provider-login-url">{session.event.url}</div>
          {session.browserError && <p className="provider-login-error">{session.browserError}</p>}
          <div className="provider-login-form-actions">
            {host.openExternal && (
              <button
                type="button"
                className="provider-login-submit"
                onClick={() => {
                  const event = session.event
                  if (!event || event.kind !== 'auth_url') return
                  setSession(current => current ? { ...current, browserError: undefined } : current)
                  void host.openExternal?.(event.url).catch(err => setSession(current => current
                    ? { ...current, browserError: `打开浏览器失败：${err instanceof Error ? err.message : String(err)}` }
                    : current))
                }}
              >
                打开浏览器
              </button>
            )}
            <button type="button" className="provider-login-submit" onClick={() => continueLogin(session.loginId)}>
              我已授权，继续
            </button>
          </div>
        </div>
      )}
      {error && (
        <div data-testid={`extensions-pkg-auth-error-${extensionId}`}>
          <DismissibleError
            message={error}
            onDismiss={() => setError(null)}
            onRetry={() => {
              setError(null)
              if (status === null) void refreshStatus()
              else void startLogin()
            }}
          />
        </div>
      )}
    </div>
  )
}

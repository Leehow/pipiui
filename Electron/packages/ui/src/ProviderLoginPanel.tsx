import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthLoginEvent, AuthProviderInfo, AuthType, PipiHostAPI } from '@pipi/host-api'

const PROVIDER_LOAD_TIMEOUT_MS = 8_000

class HostProviderContractError extends Error {}

function hostUpdateError(method: string): HostProviderContractError {
  return new HostProviderContractError(`主进程尚未更新或返回了无效响应（${method}）；请手动退出并重新打开 PipiUI，然后重试。`)
}

function hostMethod(host: PipiHostAPI, name: 'authProviders' | 'beginProviderLogin' | 'continueProviderLogin' | 'cancelProviderLogin'): (...args: unknown[]) => Promise<unknown> {
  const method = (host as unknown as Record<string, unknown>)[name]
  if (typeof method !== 'function') throw hostUpdateError(name)
  return method.bind(host) as (...args: unknown[]) => Promise<unknown>
}

function isProviderInfo(value: unknown): value is AuthProviderInfo {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as AuthProviderInfo).id === 'string'
    && typeof (value as AuthProviderInfo).name === 'string'
    && Array.isArray((value as AuthProviderInfo).authTypes)
    && (value as AuthProviderInfo).authTypes.every(type => type === 'oauth' || type === 'api_key')
    && typeof (value as AuthProviderInfo).authenticated === 'boolean'
}

function parseProviders(value: unknown): AuthProviderInfo[] {
  if (!Array.isArray(value) || !value.every(isProviderInfo)) throw hostUpdateError('authProviders')
  return value
}

function isLoginEvent(value: unknown): value is AuthLoginEvent {
  if (!value || typeof value !== 'object' || typeof (value as { kind?: unknown }).kind !== 'string') return false
  return ['auth_url', 'prompt', 'notice', 'completed', 'failed', 'cancelled'].includes((value as { kind: string }).kind)
}

type LoginSessionState = {
  providerId: string
  authType: AuthType
  loginId: string
  /** 'input' = answering a prompt; 'auth' = waiting on browser/device auth; 'waiting' = in flight. */
  phase: 'waiting' | 'input' | 'auth'
  event?: AuthLoginEvent
  busy: boolean
  input: string
  error?: string
  browserError?: string
}

/**
 * "添加模型/供应商" flow — providers come from pi's real ModelRuntime catalog
 * (`host.authProviders()`), login runs through pi's native login (OAuth device
 * code / browser URL, or api-key prompt). The renderer only ever forwards a
 * single api-key prompt answer; it never persists or logs credential values.
 */
export function ProviderLoginPanel({ host, onAdded }: { host: PipiHostAPI; onAdded: () => void }) {
  const [providers, setProviders] = useState<AuthProviderInfo[] | null>(null)
  const [providersLoading, setProvidersLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [session, setSession] = useState<LoginSessionState | null>(null)
  const mountedRef = useRef(false)
  const providerRequestRef = useRef(0)
  const loginRequestRef = useRef(0)
  const providerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearProviderTimer = useCallback(() => {
    if (providerTimerRef.current !== null) clearTimeout(providerTimerRef.current)
    providerTimerRef.current = null
  }, [])

  const loadProviders = useCallback(() => {
    const request = ++providerRequestRef.current
    clearProviderTimer()
    setProviders(null)
    setProvidersLoading(true)
    setLoadError(null)

    let load: Promise<unknown>
    try {
      load = hostMethod(host, 'authProviders')()
    } catch (err) {
      if (mountedRef.current && request === providerRequestRef.current) {
        setProvidersLoading(false)
        setLoadError(`无法加载 provider 目录：${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    providerTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || request !== providerRequestRef.current) return
      setProvidersLoading(false)
      setLoadError('加载 provider 目录超时。请确认主进程已更新；如仍未恢复，请手动退出并重新打开 PipiUI 后重试。')
    }, PROVIDER_LOAD_TIMEOUT_MS)

    void load.then(
      value => {
        if (!mountedRef.current || request !== providerRequestRef.current) return
        clearProviderTimer()
        try {
          setProviders(parseProviders(value))
          setLoadError(null)
        } catch (err) {
          setLoadError(`无法加载 provider 目录：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setProvidersLoading(false)
        }
      },
      err => {
        if (!mountedRef.current || request !== providerRequestRef.current) return
        clearProviderTimer()
        setProvidersLoading(false)
        setLoadError(`无法加载 provider 目录：${err instanceof Error ? err.message : String(err)}`)
      }
    )
  }, [clearProviderTimer, host])

  useEffect(() => {
    mountedRef.current = true
    loadProviders()
    return () => {
      mountedRef.current = false
      providerRequestRef.current += 1
      loginRequestRef.current += 1
      clearProviderTimer()
    }
  }, [clearProviderTimer, loadProviders])

  const advance = useCallback(async (loginId: string, request: number, input?: string) => {
    try {
      const event = await hostMethod(host, 'continueProviderLogin')(loginId, input)
      if (!mountedRef.current || request !== loginRequestRef.current) return
      if (!isLoginEvent(event)) throw hostUpdateError('continueProviderLogin')
      if (event.kind === 'prompt') {
        setSession(s => s?.loginId === loginId ? { ...s, phase: 'input', event, busy: false, input: '' } : s)
      } else if (event.kind === 'auth_url') {
        setSession(s => s?.loginId === loginId ? { ...s, phase: 'auth', event, busy: false } : s)
        if (host.openExternal) {
          void host.openExternal(event.url).catch(err => {
            if (!mountedRef.current || request !== loginRequestRef.current) return
            setSession(s => s?.loginId === loginId
              ? { ...s, browserError: `未能自动打开浏览器：${err instanceof Error ? err.message : String(err)}` }
              : s)
          })
        }
      } else if (event.kind === 'completed') {
        setSession(null)
        onAdded()
      } else if (event.kind === 'failed') {
        setSession(s => s?.loginId === loginId ? { ...s, phase: 'waiting', busy: false, error: event.error } : s)
      } else if (event.kind === 'cancelled') {
        setSession(null)
      } else {
        // transient notice — keep waiting for the next step
        void advance(loginId, request)
      }
    } catch (err) {
      if (!mountedRef.current || request !== loginRequestRef.current) return
      setSession(s => s?.loginId === loginId ? { ...s, phase: 'waiting', busy: false, error: `登录中断：${err instanceof Error ? err.message : String(err)}` } : s)
    }
  }, [host, onAdded])

  const start = useCallback(async (provider: AuthProviderInfo, authType: AuthType) => {
    const request = ++loginRequestRef.current
    try {
      const started = await hostMethod(host, 'beginProviderLogin')(provider.id, authType)
      if (!mountedRef.current || request !== loginRequestRef.current) return
      if (!started || typeof started !== 'object' || typeof (started as { loginId?: unknown }).loginId !== 'string') throw hostUpdateError('beginProviderLogin')
      const loginId = (started as { loginId: string }).loginId
      setSession({ providerId: provider.id, authType, loginId, phase: 'waiting', busy: true, input: '' })
      void advance(loginId, request)
    } catch (err) {
      if (!mountedRef.current || request !== loginRequestRef.current) return
      setSession({ providerId: provider.id, authType, loginId: '', phase: 'waiting', busy: false, input: '', error: `开始登录失败：${err instanceof Error ? err.message : String(err)}` })
    }
  }, [advance, host])

  const continueLogin = useCallback((loginId: string, input?: string) => {
    const request = loginRequestRef.current
    setSession(s => s?.loginId === loginId ? { ...s, busy: true, input: '' } : s)
    void advance(loginId, request, input)
  }, [advance])

  const cancel = useCallback(async () => {
    const current = session
    loginRequestRef.current += 1
    setSession(null)
    if (!current?.loginId) return
    try {
      await hostMethod(host, 'cancelProviderLogin')(current.loginId)
    } catch {
      // The UI has already closed the local session; a stale host cancel must not block it.
    }
  }, [host, session])

  const activeProvider = providers?.find(provider => provider.id === session?.providerId)
  const retry = () => loadProviders()

  return (
    <div className="provider-add" data-testid="provider-add">
      {session && (
        <section className="provider-login" data-testid="provider-login">
          <div className="provider-login-title">
            <b>{activeProvider?.name ?? session.providerId}</b>
            <span className="provider-login-type">{session.authType === 'oauth' ? 'OAuth 登录' : 'API Key'}</span>
          </div>
          {session.phase === 'input' && session.event?.kind === 'prompt' && (
            <PromptForm
              session={session}
              onInput={value => setSession(s => s ? { ...s, input: value } : s)}
              onSubmit={value => continueLogin(session.loginId, value)}
              onCancel={cancel}
            />
          )}
          {session.phase === 'auth' && session.event?.kind === 'auth_url' && (
            <AuthWait
              url={session.event.url}
              code={session.event.code}
              instructions={session.event.instructions}
              browserError={session.browserError}
              canOpen={Boolean(host.openExternal)}
              onOpen={host.openExternal ? () => {
                const event = session.event
                if (!event || event.kind !== 'auth_url') return
                setSession(s => s ? { ...s, browserError: undefined } : s)
                void host.openExternal?.(event.url).catch(err => setSession(s => s
                  ? { ...s, browserError: `打开浏览器失败：${err instanceof Error ? err.message : String(err)}` }
                  : s))
              } : undefined}
              onContinue={() => continueLogin(session.loginId)}
              onCancel={cancel}
            />
          )}
          {session.phase === 'waiting' && !session.error && <div className="provider-login-waiting" data-testid="provider-login-waiting">正在等待授权…</div>}
          {session.error && <div className="provider-login-error" data-testid="provider-login-error"><span>{session.error}</span><button aria-label="关闭登录错误" data-testid="provider-login-error-close" onClick={() => { loginRequestRef.current += 1; setSession(null) }}>×</button></div>}
        </section>
      )}
      {loadError && <div className="model-modal-error" data-testid="provider-add-error"><span>{loadError}</span><button aria-label="关闭 provider 错误" data-testid="provider-add-error-close" onClick={() => setLoadError(null)}>×</button><button data-testid="provider-add-retry" onClick={retry}>重试</button></div>}
      {providers === null && providersLoading && !loadError && <div className="model-modal-state" data-testid="provider-add-loading">正在加载 provider…</div>}
      {providers === null && !providersLoading && !loadError && <div className="model-modal-state" data-testid="provider-add-unavailable">Provider 目录未加载。<button data-testid="provider-add-retry" onClick={retry}>重试</button></div>}
      {providers && providers.length === 0 && !session && <div className="model-modal-state" data-testid="provider-add-empty">未发现可登录 Provider。<button data-testid="provider-add-retry" onClick={retry}>重试</button></div>}
      {providers && !session && providers.map(provider => (
        <section key={provider.id} className="provider-row" data-testid={`provider-row-${provider.id}`}>
          <div className="provider-row-main">
            <span className="provider-row-name">{provider.name}</span>
            <span className="provider-row-status">{provider.authenticated ? `已登录（${provider.authType}）` : '未登录'}</span>
          </div>
          <div className="provider-row-actions">
            {provider.authTypes.includes('oauth') && (
              <button className="provider-login-btn" data-testid={`login-${provider.id}-oauth`} onClick={() => void start(provider, 'oauth')}>
                {provider.authenticated ? '重新登录' : provider.loginLabel ?? 'OAuth 登录'}
              </button>
            )}
            {provider.authTypes.includes('api_key') && (
              <button className="provider-login-btn" data-testid={`login-${provider.id}-api-key`} onClick={() => void start(provider, 'api_key')}>API Key</button>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

function PromptForm({ session, onInput, onSubmit, onCancel }: {
  session: LoginSessionState
  onInput: (value: string) => void
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const event = session.event as Extract<AuthLoginEvent, { kind: 'prompt' }>
  if (event.promptType === 'select' && event.options?.length) {
    return (
      <div className="provider-login-form" data-testid="provider-login-prompt">
        <p>{event.message}</p>
        <div className="provider-login-options">
          {event.options.map(option => (
            <button key={option.id} className="provider-login-btn" data-testid={`prompt-option-${option.id}`} onClick={() => onSubmit(option.id)}>{option.label}</button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <form className="provider-login-form" data-testid="provider-login-prompt" onSubmit={eventValue => { eventValue.preventDefault(); if (session.input.trim() || event.promptType === 'text') onSubmit(session.input) }}>
      <label>{event.message}</label>
      <input
        type={event.promptType === 'secret' ? 'password' : 'text'}
        value={session.input}
        placeholder={event.placeholder}
        aria-label={event.message}
        data-testid="provider-login-input"
        onChange={eventValue => onInput(eventValue.target.value)}
        autoFocus
      />
      <div className="provider-login-form-actions">
        <button type="button" className="provider-login-cancel" onClick={onCancel}>取消</button>
        <button type="submit" className="provider-login-submit" data-testid="provider-login-submit" disabled={!session.input.trim()}>保存</button>
      </div>
    </form>
  )
}

function AuthWait({ url, code, instructions, browserError, canOpen, onOpen, onContinue, onCancel }: {
  url: string
  code?: string
  instructions?: string
  browserError?: string
  canOpen: boolean
  onOpen?: () => void
  onContinue: () => void
  onCancel: () => void
}) {
  return (
    <div className="provider-login-auth" data-testid="provider-login-auth">
      <p>{instructions ?? '请在浏览器中完成授权后返回。'}</p>
      {code && <div className="provider-login-code" data-testid="provider-login-code">设备码：<b>{code}</b></div>}
      <div className="provider-login-url" data-testid="provider-login-url">{url}</div>
      {browserError && <div className="provider-login-error" data-testid="provider-login-browser-error">{browserError}</div>}
      <div className="provider-login-form-actions">
        {canOpen && onOpen && <button type="button" className="provider-login-submit" data-testid="provider-login-open" onClick={onOpen}>打开浏览器</button>}
        <button type="button" className="provider-login-submit" data-testid="provider-login-continue" onClick={onContinue}>我已授权，继续</button>
        <button type="button" className="provider-login-cancel" data-testid="provider-login-cancel" onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}

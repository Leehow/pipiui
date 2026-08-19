import { useEffect, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'
import './secret-vault.css'

export type SecretVaultHost = Pick<
  PipiHostAPI,
  'listSecretVault' | 'putSecretVault' | 'mountSecretVault' | 'unmountSecretVault' | 'deleteSecretVault'
>

export type SecretVaultView = {
  secrets: Array<{ id: string; name: string; envName: string; createdAt: string }>
  mounts: Array<{ secretId: string; envName: string; name: string }>
}

export function SecretVaultPane({
  host,
  sessionId,
}: {
  host?: SecretVaultHost | null
  sessionId?: string
}) {
  const [view, setView] = useState<SecretVaultView>({ secrets: [], mounts: [] })
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [envName, setEnvName] = useState('')
  const [value, setValue] = useState('')
  const available = Boolean(host?.listSecretVault && host.putSecretVault && sessionId)

  const reload = async () => {
    if (!host?.listSecretVault || !sessionId) return
    const next = await host.listSecretVault(sessionId)
    setView({ secrets: next.secrets, mounts: next.mounts })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await reload()
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { cancelled = true }
  }, [host, sessionId])

  const run = async (work: () => Promise<void>) => {
    try {
      setError(null)
      await work()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="secret-vault-pane" data-testid="secret-vault-pane">
      <p data-testid="secret-vault-help">
        仅当前进程内存，退出 App 后清除。列表只有名称，明文只注入已挂载会话的 Worker 环境。
      </p>
      {!available && <p data-testid="secret-vault-unavailable">当前连接不支持密钥库，或尚未选择会话。</p>}
      {error && (
        <p data-testid="secret-vault-error">
          {error}
          <button type="button" data-testid="secret-vault-error-close" onClick={() => setError(null)}>关闭</button>
        </p>
      )}
      <form
        data-testid="secret-vault-form"
        onSubmit={(event) => {
          event.preventDefault()
          const putSecret = host?.putSecretVault
          if (!putSecret || !sessionId) return
          void run(async () => {
            await putSecret({ name, envName, value, sessionId })
            setValue('')
          })
        }}
      >
        <input data-testid="secret-vault-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" />
        <input data-testid="secret-vault-env" value={envName} onChange={(event) => setEnvName(event.target.value)} placeholder="ENV_NAME" />
        <input data-testid="secret-vault-value" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="密钥" />
        <button type="submit" data-testid="secret-vault-save">保存并挂载</button>
      </form>
      <ul data-testid="secret-vault-list">
        {view.secrets.map((secret) => {
          const mounted = view.mounts.some((mount) => mount.secretId === secret.id)
          return (
            <li key={secret.id} data-testid={`secret-vault-item-${secret.envName}`}>
              {secret.name} · {secret.envName}
              {mounted
                ? <button type="button" data-testid={`secret-vault-unmount-${secret.envName}`} onClick={() => void run(async () => { await host?.unmountSecretVault?.(sessionId!, secret.id) })}>卸载</button>
                : <button type="button" data-testid={`secret-vault-mount-${secret.envName}`} onClick={() => void run(async () => { await host?.mountSecretVault?.(sessionId!, secret.id) })}>挂载</button>}
              <button type="button" data-testid={`secret-vault-delete-${secret.envName}`} onClick={() => void run(async () => { await host?.deleteSecretVault?.(secret.id) })}>删除</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

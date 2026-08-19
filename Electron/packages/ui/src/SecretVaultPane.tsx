import { useEffect, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'
import './secret-vault.css'

export type SecretVaultHost = Pick<
  PipiHostAPI,
  'listSecretVault' | 'putSecretVault' | 'mountSecretVault' | 'unmountSecretVault' | 'deleteSecretVault' | 'diagnoseSecretVault'
>

export type SecretVaultView = {
  secrets: Array<{ id: string; name: string; envName: string; createdAt: string }>
  mounts: Array<{ secretId: string; envName: string; name: string }>
}

export type SecretVaultDiagnosis = {
  available: boolean
  kind: string
  message: string
  installHint?: string
  retryable?: boolean
  platform?: string
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
  const [diagnosis, setDiagnosis] = useState<SecretVaultDiagnosis | null>(null)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const [envName, setEnvName] = useState('')
  const [value, setValue] = useState('')
  const available = Boolean(host?.listSecretVault && host.putSecretVault && sessionId)
  const encryptionReady = diagnosis?.available !== false

  const reload = async () => {
    if (!host?.listSecretVault || !sessionId) return
    const next = await host.listSecretVault(sessionId)
    setView({ secrets: next.secrets, mounts: next.mounts })
  }

  const probe = async () => {
    if (!host?.diagnoseSecretVault) return
    const next = await host.diagnoseSecretVault()
    setDiagnosis(next)
    return next
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await probe()
        if (cancelled) return
        if (next && !next.available) return
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

  const retryDiagnosis = () => {
    void run(async () => {
      const next = await probe()
      if (next && !next.available) return
      await reload()
    })
  }

  const copyHint = async () => {
    const hint = diagnosis?.installHint
    if (!hint) return
    try {
      await navigator.clipboard.writeText(hint)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="secret-vault-pane" data-testid="secret-vault-pane">
      <p data-testid="secret-vault-help">
        全局加密密钥库。明文只写入当前会话已挂载的 Worker 环境，列表只有名称。
      </p>
      {!available && <p data-testid="secret-vault-unavailable">当前连接不支持密钥库，或尚未选择会话。</p>}
      {diagnosis && !diagnosis.available && (
        <div className="secret-vault-diagnosis" data-testid="secret-vault-diagnosis">
          <p data-testid="secret-vault-diagnosis-message">{diagnosis.message}</p>
          {diagnosis.installHint && (
            <div className="secret-vault-install">
              <code data-testid="secret-vault-install-hint">{diagnosis.installHint}</code>
              <button type="button" data-testid="secret-vault-copy-hint" onClick={() => void copyHint()}>
                {copied ? '已复制' : '复制安装命令'}
              </button>
            </div>
          )}
          <div className="secret-vault-diagnosis-actions">
            <button type="button" data-testid="secret-vault-retry" onClick={retryDiagnosis}>重试检测</button>
            <button type="button" data-testid="secret-vault-diagnosis-close" onClick={() => setDiagnosis(null)}>关闭</button>
          </div>
        </div>
      )}
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
          if (!putSecret || !sessionId || !encryptionReady) return
          void run(async () => {
            await putSecret({ name, envName, value, sessionId })
            setValue('')
          })
        }}
      >
        <input data-testid="secret-vault-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" disabled={!encryptionReady} />
        <input data-testid="secret-vault-env" value={envName} onChange={(event) => setEnvName(event.target.value)} placeholder="ENV_NAME" disabled={!encryptionReady} />
        <input data-testid="secret-vault-value" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="密钥" disabled={!encryptionReady} />
        <button type="submit" data-testid="secret-vault-save" disabled={!encryptionReady}>保存并挂载</button>
      </form>
      <ul data-testid="secret-vault-list">
        {view.secrets.map((secret) => {
          const mounted = view.mounts.some((mount) => mount.secretId === secret.id)
          return (
            <li key={secret.id} data-testid={`secret-vault-item-${secret.envName}`}>
              {secret.name} · {secret.envName}
              {mounted
                ? <button type="button" data-testid={`secret-vault-unmount-${secret.envName}`} onClick={() => void run(async () => { await host?.unmountSecretVault?.(sessionId!, secret.id) })}>卸载</button>
                : <button type="button" data-testid={`secret-vault-mount-${secret.envName}`} disabled={!encryptionReady} onClick={() => void run(async () => { await host?.mountSecretVault?.(sessionId!, secret.id) })}>挂载</button>}
              <button type="button" data-testid={`secret-vault-delete-${secret.envName}`} onClick={() => void run(async () => { await host?.deleteSecretVault?.(secret.id) })}>删除</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

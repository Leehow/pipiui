import { useCallback, useEffect, useRef, useState } from 'react'
import { encodePipiuiUpdateEvaluationIntent, type PipiHostAPI, type UpdateCenterItem, type UpdateCenterSnapshot } from '@pipi/host-api'

const STATUS_LABEL: Record<UpdateCenterItem['status'], string> = {
  upToDate: '已是最新', updateAvailable: '有新版本', checkFailed: '检查失败', notCheckable: '无法检查'
}

export function UpdateCenter({ host, onRequestUpdate }: { host: PipiHostAPI; onRequestUpdate: (prompt: string) => void }) {
  const [snapshot, setSnapshot] = useState<UpdateCenterSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestedRef = useRef(false)
  const refresh = useCallback(async () => {
    if (!host.checkForUpdates) return
    setLoading(true); setError(null)
    try { setSnapshot(await host.checkForUpdates()) }
    catch (reason) { setError(`检查更新失败：${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { setLoading(false) }
  }, [host])
  useEffect(() => { void refresh() }, [refresh])
  const requestUpdate = (item: UpdateCenterItem) => {
    if (requestedRef.current) return
    requestedRef.current = true
    if (!item.latestVersion) return
    onRequestUpdate(encodePipiuiUpdateEvaluationIntent({
      id: item.id,
      name: item.name,
      ...(item.packageName === undefined ? {} : { packageName: item.packageName }),
      currentVersion: item.currentVersion,
      latestVersion: item.latestVersion,
    }))
  }
  if (!host.checkForUpdates) return <div className="model-modal-state" data-testid="update-center-unsupported">当前连接不支持更新检查。</div>
  return <div className="update-center" data-testid="update-center">
    <div className="update-center-toolbar"><span>{snapshot ? `上次检查：${new Date(snapshot.checkedAt).toLocaleString()}` : '检查已安装组件的版本'}</span><button type="button" className="model-modal-refresh" disabled={loading} onClick={() => void refresh()}>{loading ? '检查中…' : '⟳ 刷新'}</button></div>
    {error && <div className="model-modal-error visibility-error" role="alert" data-testid="update-center-error"><span>{error}</span><button className="visibility-error-close" aria-label="关闭更新错误" onClick={() => setError(null)}>×</button></div>}
    {loading && !snapshot ? <div className="model-modal-state" data-testid="update-center-loading">正在检查更新…</div> : snapshot?.items.map(item => <div className="update-center-row" key={item.id} data-testid={`update-item-${item.id}`}>
      <div className="update-center-name"><strong>{item.name}</strong>{item.packageName && item.name !== item.packageName && <span>{item.packageName}</span>}</div>
      <div className="update-center-versions"><span>本机 {item.currentVersion}</span><span>最新 {item.latestVersion ?? '—'}</span></div>
      <span className={`update-center-status ${item.status}`} title={item.error}>{STATUS_LABEL[item.status]}</span>
      {item.status === 'updateAvailable' && item.latestVersion && <button type="button" className="update-center-update" onClick={() => requestUpdate(item)}>评估更新</button>}
    </div>)}
    {!loading && snapshot?.items.length === 0 && <div className="model-modal-state">没有可检查的组件。</div>}
  </div>
}

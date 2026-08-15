import { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI, UpdateCenterItem, UpdateCenterSnapshot } from '@pipi/host-api'

const STATUS_LABEL: Record<UpdateCenterItem['status'], string> = {
  upToDate: '已是最新', updateAvailable: '有新版本', checkFailed: '检查失败', notCheckable: '无法检查'
}

export function updateRequestPrompt(item: UpdateCenterItem): string {
  const target = item.name === 'Pi' ? 'Pi' : item.name
  if (item.id === 'pi-hermes-memory' || item.packageName === 'pi-hermes-memory') {
    return `请将 PipiUI 内置 pi-hermes-memory 从 ${item.currentVersion} 更新到 ${item.latestVersion}。

硬门槛：
1. 保留现有 memory-broker、自动召回、角色化记忆策略和 Hermes 复核模型设置；先检查目标 release/源码的内部 API、配置格式及数据库兼容性。
2. 版本 pin、lockfile、运行时 manifest 与 Hermes adapter 必须一起更新；保持精确版本和 fail-soft。若不兼容，保留旧 pin 并报告证据，不做猜测性适配。
3. 禁止用真实用户数据库测试迁移；只可使用临时副本或 fixture。
4. 必须通过 memory-broker 测试/typecheck、角色策略回归、包版本/签名检查，并仅从主 checkout 打包 canonical Electron App；随后真实验证主 Agent 自动召回、显式 memory_query 和 subagent 召回。
5. 不改 Swift，不 push，不 deploy。`
  }
  return `帮我把 ${target} 从 ${item.currentVersion} 更新到 ${item.latestVersion}，并完成必要的测试和 Electron 打包验收。`
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
    onRequestUpdate(updateRequestPrompt(item))
  }
  if (!host.checkForUpdates) return <div className="model-modal-state" data-testid="update-center-unsupported">当前连接不支持更新检查。</div>
  return <div className="update-center" data-testid="update-center">
    <div className="update-center-toolbar"><span>{snapshot ? `上次检查：${new Date(snapshot.checkedAt).toLocaleString()}` : '检查已安装组件的版本'}</span><button type="button" className="model-modal-refresh" disabled={loading} onClick={() => void refresh()}>{loading ? '检查中…' : '⟳ 刷新'}</button></div>
    {error && <div className="model-modal-error visibility-error" role="alert" data-testid="update-center-error"><span>{error}</span><button className="visibility-error-close" aria-label="关闭更新错误" onClick={() => setError(null)}>×</button></div>}
    {loading && !snapshot ? <div className="model-modal-state" data-testid="update-center-loading">正在检查更新…</div> : snapshot?.items.map(item => <div className="update-center-row" key={item.id} data-testid={`update-item-${item.id}`}>
      <div className="update-center-name"><strong>{item.name}</strong>{item.packageName && item.name !== item.packageName && <span>{item.packageName}</span>}</div>
      <div className="update-center-versions"><span>本机 {item.currentVersion}</span><span>最新 {item.latestVersion ?? '—'}</span></div>
      <span className={`update-center-status ${item.status}`} title={item.error}>{STATUS_LABEL[item.status]}</span>
      {item.status === 'updateAvailable' && item.latestVersion && <button type="button" className="update-center-update" onClick={() => requestUpdate(item)}>更新</button>}
    </div>)}
    {!loading && snapshot?.items.length === 0 && <div className="model-modal-state">没有可检查的组件。</div>}
  </div>
}

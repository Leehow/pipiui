import { useRef } from 'react'
import { encodePipiuiUpdateEvaluationIntent, type UpdateCenterItem, type UpdateCenterItemCategory } from '@pipi/host-api'
import type { UpdateCenterController } from './useUpdateCenter'

const STATUS_LABEL: Record<UpdateCenterItem['status'], string> = {
  upToDate: '已是最新', updateAvailable: '有新版本', checkFailed: '检查失败', notCheckable: '无法检查'
}

const CATEGORY_ORDER: UpdateCenterItemCategory[] = ['platform', 'runtime', 'toolchain', 'extension']
const CATEGORY_COPY: Record<UpdateCenterItemCategory, { title: string; description: string }> = {
  platform: { title: '应用平台', description: '桌面容器与系统集成基础' },
  runtime: { title: '核心运行时', description: 'Pi、Computer Use 与内置执行环境' },
  toolchain: { title: '构建工具', description: '影响开发、编译与打包，不直接作为运行时扩展加载' },
  extension: { title: 'Pi 扩展', description: '随 PipiUI 内置并由 Pi 加载的功能扩展' },
}

function groupedItems(items: UpdateCenterItem[]): Array<{ category: UpdateCenterItemCategory; items: UpdateCenterItem[] }> {
  return CATEGORY_ORDER.flatMap(category => {
    const matching = items.filter(item => (item.category ?? 'extension') === category)
    return matching.length ? [{ category, items: matching }] : []
  })
}

export function UpdateCenter({ updates, onRequestUpdate }: { updates: UpdateCenterController; onRequestUpdate: (prompt: string) => void }) {
  const requestedRef = useRef(false)
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
  if (!updates.available) return <div className="model-modal-state" data-testid="update-center-unsupported">当前连接不支持更新检查。</div>
  return <div className="update-center" data-testid="update-center">
    <div className="update-center-toolbar"><span>{updates.snapshot ? `上次检查：${new Date(updates.snapshot.checkedAt).toLocaleString()}` : '检查已安装组件的版本'}</span><button type="button" className="model-modal-refresh" disabled={updates.loading} onClick={() => void updates.refresh()}>{updates.loading ? '检查中…' : '⟳ 刷新'}</button></div>
    {updates.error && <div className="model-modal-error visibility-error" role="alert" data-testid="update-center-error"><span>{updates.error}</span><button className="visibility-error-close" aria-label="关闭更新错误" onClick={() => updates.dismissError()}>×</button></div>}
    {updates.loading && !updates.snapshot ? <div className="model-modal-state" data-testid="update-center-loading">正在检查更新…</div> : updates.snapshot && <div className="update-center-groups">
      {groupedItems(updates.snapshot.items).map(({ category, items }) => <section className="update-center-group" key={category} data-testid={`update-group-${category}`}>
        <header className="update-center-group-header"><div><h3>{CATEGORY_COPY[category].title}</h3><p>{CATEGORY_COPY[category].description}</p></div><span>{items.length} 项</span></header>
        <div className="update-center-group-items">{items.map(item => <div className="update-center-row" key={item.id} data-testid={`update-item-${item.id}`}>
          <div className="update-center-name"><strong>{item.name}</strong>{item.packageName && item.name !== item.packageName && <span>{item.packageName}</span>}</div>
          <div className="update-center-versions"><span><em>本机</em>{item.currentVersion}</span><span><em>最新</em>{item.latestVersion ?? '—'}</span></div>
          <span className={`update-center-status ${item.status}`} title={item.error}>{STATUS_LABEL[item.status]}</span>
          {item.status === 'updateAvailable' && item.latestVersion && <button type="button" className="update-center-update" onClick={() => requestUpdate(item)}>评估更新</button>}
        </div>)}</div>
      </section>)}
    </div>}
    {!updates.loading && updates.snapshot?.items.length === 0 && <div className="model-modal-state">没有可检查的组件。</div>}
  </div>
}

import { useMemo, useState } from 'react'
import { groupByProvider, modelRef, usesBuiltInVisionMcp } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'
import type { ModelVisibilityController } from './useModelVisibility'
import type { VisionRoutingController } from './useVisionRouting'

/**
 * 识图路由开关 + 识图模型选择。开关仿 ComputerUsePanel
 * (role="switch" + computer-use-switch CSS)；选择器为原生 <select>
 * (仿 SubagentModelModal 的原生 select 风格)。候选 = 模型管理中已勾选
 * (visible) 且 supportsImages !== false 的模型；已选识图模型即便未勾选
 * 也保底出现在列表中（与 quickGroups 对当前模型的保底逻辑一致）。
 * 持久化走 useVisionRouting (getVisionEnabled/setVisionEnabled +
 * getVisionModel/setVisionModel)。
 */
export function VisionRoutingPane({ visibility, vision }: {
  visibility: ModelVisibilityController
  vision: VisionRoutingController
}) {
  const candidates = useMemo(() => {
    const list = visibility.quickModels.filter(model => model.supportsImages !== false)
    const selected = vision.model
    if (selected && !list.some(model => modelRef(model) === selected)) {
      const current = visibility.models.find(model => modelRef(model) === selected)
      if (current) list.push(current)
    }
    return list
  }, [visibility.quickModels, visibility.models, vision.model])
  const groups = useMemo(() => groupByProvider(candidates), [candidates])
  const textOnlyChecked = useMemo(
    () => visibility.visibleModels.filter(model => model.supportsImages === false),
    [visibility.visibleModels]
  )
  const textOnlyGroups = useMemo(() => groupByProvider(textOnlyChecked), [textOnlyChecked])
  const [textOnlyOpen, setTextOnlyOpen] = useState(false)

  if (!vision.available) {
    return <div className="model-modal-state" data-testid="vision-unsupported">当前连接不支持识图设置。</div>
  }
  if (vision.loading) {
    return <div className="model-modal-state" data-testid="vision-loading">正在加载识图设置…</div>
  }
  return (
    <div className="vision-picker" data-testid="vision-picker">
      <div className="computer-use-toggle-row">
        <div>
          <strong>识图模型</strong>
          <p>图片识别</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={vision.enabled}
          aria-label="启用识图模型"
          className={`computer-use-switch${vision.enabled ? ' enabled' : ''}`}
          disabled={vision.saving}
          data-testid="vision-enabled-switch"
          onClick={() => void vision.setEnabled(!vision.enabled)}
        >
          <span />
        </button>
      </div>
      <p className="vision-picker-hint">主线模型不支持图片时，用指定识图模型识别图片后交给文字模型。</p>
      {vision.error && (
        <div className="model-modal-error" role="alert" data-testid="vision-error">
          <span>{vision.error}</span>
          <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="vision-error-close" onClick={() => vision.dismissError()}>×</button>
        </div>
      )}
      <label className="vision-model-select-row" style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, color: 'var(--muted)', fontSize: 11 }}>
        <span>识图模型</span>
        <select
          className="vision-model-select"
          aria-label="识图模型"
          data-testid="vision-model-select"
          value={vision.model ?? ''}
          disabled={!vision.enabled || vision.saving}
          onChange={event => void vision.setModel(event.target.value || null)}
          style={{ width: '100%', maxWidth: 'none', padding: '5px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', background: 'var(--surface-input)', fontSize: 11 }}
        >
          <option value="">未选择识图模型</option>
          {groups.map(group => (
            <optgroup key={group.provider} label={group.provider}>
              {group.models.map(model => (
                <option key={modelRef(model)} value={modelRef(model)}>
                  {model.name}（{modelRef(model)}）
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {vision.enabled && vision.model && (
        <p className="vision-picker-hint" data-testid="vision-model-selected">已选：{vision.model}</p>
      )}
      <div className="vision-text-models">
        <button
          type="button"
          className="vision-text-models-toggle"
          aria-expanded={textOnlyOpen}
          aria-label={textOnlyOpen ? '折叠非多模态模型' : '展开非多模态模型'}
          data-testid="non-multimodal-fold"
          onClick={() => setTextOnlyOpen(open => !open)}
        >
          <span aria-hidden="true">{textOnlyOpen ? '▾' : '▸'}</span>
          <span>已勾选的非多模态模型</span>
          <span className="vision-text-models-count">{textOnlyChecked.length}</span>
        </button>
        {textOnlyOpen && (
          <div className="vision-text-models-list" data-testid="non-multimodal-list">
            {textOnlyChecked.length === 0
              ? <p className="vision-picker-hint">已勾选的模型都支持图片。</p>
              : textOnlyGroups.map(group => (
                <div key={group.provider} className="vision-group">
                  <div className="vision-group-header">
                    <ProviderLogo provider={group.provider} size={14} />
                    <span className="vision-group-name">{group.provider}</span>
                  </div>
                  {group.models.map(model => (
                    <div key={modelRef(model)} className="vision-text-model-row">
                      <span className="vision-row-name">{model.name}</span>
                      {usesBuiltInVisionMcp(model.provider) && (
                        <span
                          className="vision-text-model-badge"
                          title="自带视觉 MCP，不走通用识图模型"
                          data-testid={`vision-mcp-badge-${model.provider}-${model.id}`}
                        >内置识图 MCP</span>
                      )}
                      <span className="model-row-id">{modelRef(model)}</span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

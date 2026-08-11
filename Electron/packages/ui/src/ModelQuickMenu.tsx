import type { Model } from '@pipi/host-api'
import type { ProviderModelGroup } from './model-visibility'
import { modelRef } from './model-visibility'
import { ProviderLogo } from './ProviderLogo'

/**
 * Compact quick model menu opened from the composer chip — Swift-style native
 * menu equivalent. Lists ONLY `/model`-checked models (当前模型保底), grouped by
 * provider with low-contrast provider titles, provider logo + display name per
 * row, current model highlighted. No full ids, no search box.
 */
export function ModelQuickMenu({ groups, current, onSelect, onClose }: {
  groups: ProviderModelGroup[]
  current: Model | null
  onSelect: (model: Model) => void
  onClose: () => void
}) {
  const isCurrent = (model: Model) => current?.provider === model.provider && current.id === model.id
  return (
    <>
      <div className="quick-menu-backdrop" data-testid="quick-menu-backdrop" onMouseDown={onClose} />
      <div className="quick-menu" role="menu" aria-label="快捷模型" data-testid="quick-menu">
        {groups.length === 0
          ? <div className="quick-menu-empty" data-testid="quick-menu-empty">暂无可用模型</div>
          : groups.map(group => (
            <div key={group.provider}>
              <div className="quick-menu-provider">{group.provider}</div>
              {group.models.map(model => {
                const currentModel = isCurrent(model)
                return (
                  <button
                    key={modelRef(model)}
                    type="button"
                    role="menuitem"
                    className={`quick-menu-row ${currentModel ? 'current' : ''}`}
                    data-testid={`quick-row-${model.provider}-${model.id}`}
                    onClick={() => onSelect(model)}
                  >
                    <ProviderLogo provider={model.provider} modelId={model.id} size={14} />
                    <span className="quick-menu-name">{model.name}</span>
                    {currentModel && <span className="quick-menu-check">✓</span>}
                  </button>
                )
              })}
            </div>
          ))}
      </div>
    </>
  )
}

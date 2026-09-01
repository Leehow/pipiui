import { useRef, useState, type ReactNode } from 'react'
import { SYSTEM_THEME_VALUE } from './theme-registry'
import { fileToLogoDataUrl, useCustomLogo, writeCustomLogo } from './custom-logo'
import { useAllThemes, useShellTheme } from './useShellTheme'
import './theme-settings.css'

/** 设置-主题页的迷你界面 mock：左侧窄侧栏条 + 用户气泡 + 两行助手文本 +
 *  底部 composer 条。颜色全部来自 [data-theme] 规则供给的 CSS 变量
 *  （app.css 的 light/forest/neon/paper 块 + theme-settings.css 补的 dark 块），
 *  随容器 data-theme 变化，不内联任何颜色。 */
function ThemeMock() {
  return (
    <div className="tsp-mock" aria-hidden="true">
      <div className="tsp-mock-side" />
      <div className="tsp-mock-main">
        <div className="tsp-mock-user" />
        <div className="tsp-mock-line tsp-mock-line-text" />
        <div className="tsp-mock-line tsp-mock-line-muted" />
        <div className="tsp-mock-composer" />
      </div>
    </div>
  )
}

/** 主题预览卡。themeId 为具体主题 id 时写在容器 data-theme/data-scheme 上（变量随卡片
 *  主题解析，scheme 供暗色组件样式命中）；null 表示 system 卡，由内部左右半分各自携带 dark/light。 */
function ThemeCard({ themeId, selected, name, description, scheme, onPick, children }: {
  themeId: string | null
  selected: boolean
  name: string
  description: string
  /** 具体主题卡的明暗（供 data-scheme）；system 卡（themeId=null）不需要。 */
  scheme?: 'dark' | 'light'
  onPick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tsp-card${selected ? ' selected' : ''}`}
      {...(themeId ? { 'data-theme': themeId, 'data-scheme': scheme } : {})}
      data-testid={`theme-card-${themeId ?? SYSTEM_THEME_VALUE}`}
      aria-pressed={selected}
      onClick={onPick}
    >
      <div className="tsp-card-preview">{children}</div>
      <div className="tsp-card-meta">
        <span className="tsp-card-name">{name}</span>
        <span className="tsp-card-desc">{description}</span>
      </div>
    </button>
  )
}

/** 品牌 Logo 设置区：预览（自定义图片或默认 wordmark）+ 选择图片/恢复默认。 */
function BrandLogoSection() {
  const logo = useCustomLogo()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  return (
    <section className="tsp-section" data-testid="theme-logo-section">
      <h3 className="tsp-section-title">品牌 Logo</h3>
      <div className="tsp-logo-row">
        <div className="tsp-logo-preview">
          {logo
            ? <img className="tsp-logo-img" src={logo} alt="自定义 Logo" />
            : <div className="tsp-logo-wordmark">Pip<span>i</span> UI</div>}
        </div>
        <div className="tsp-logo-actions">
          <input
            ref={logoInputRef}
            type="file"
            hidden
            accept="image/*"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="theme-logo-file-picker"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              fileToLogoDataUrl(file)
                .then(dataUrl => { writeCustomLogo(dataUrl); setLogoError(null) })
                .catch(err => setLogoError(err instanceof Error ? err.message : '图片处理失败'))
            }}
          />
          <div className="tsp-logo-buttons">
            <button type="button" className="tsp-btn" data-testid="theme-logo-pick" onClick={() => logoInputRef.current?.click()}>选择图片</button>
            <button
              type="button"
              className="tsp-btn"
              data-testid="theme-logo-reset"
              disabled={!logo}
              onClick={() => { writeCustomLogo(null); setLogoError(null) }}
            >
              恢复默认
            </button>
          </div>
          <p className="tsp-logo-hint">仅替换工作台左上角标志</p>
          {logoError && (
            <p className="tsp-logo-error" role="alert">
              <span className="tsp-logo-error-text">{logoError}</span>
              <button
                type="button"
                className="tsp-logo-error-close"
                aria-label="关闭错误提示"
                data-testid="theme-logo-error-close"
                onClick={() => setLogoError(null)}
              >×</button>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** 设置-主题页：当前主题大卡 / 全部主题网格（含 system 卡）/ 品牌 Logo。 */
export function ThemeSettingsPane() {
  const { theme, selection, setThemeSelection } = useShellTheme()
  const allThemes = useAllThemes()
  const currentDef = allThemes.find(def => def.id === theme) ?? allThemes[0]
  return (
    <div className="tsp-root">
      <section className="tsp-section" data-testid="theme-current-section">
        <h3 className="tsp-section-title">当前主题</h3>
        <div className="tsp-current" data-theme={theme} data-scheme={currentDef.scheme}>
          <div className="tsp-current-preview"><ThemeMock /></div>
          <div className="tsp-current-info">
            <div className="tsp-current-name-row">
              <span className="tsp-current-name">{currentDef.name}</span>
              <span className="tsp-badge">使用中</span>
              {selection === SYSTEM_THEME_VALUE && <span className="tsp-badge tsp-badge-system">跟随系统</span>}
            </div>
            <p className="tsp-current-desc">{currentDef.description}</p>
          </div>
        </div>
      </section>
      <section className="tsp-section" data-testid="theme-grid-section">
        <h3 className="tsp-section-title">全部主题</h3>
        <div className="tsp-grid">
          <ThemeCard
            themeId={null}
            selected={selection === SYSTEM_THEME_VALUE}
            name="跟随系统"
            description="自动跟随系统深浅色设置"
            onPick={() => setThemeSelection(SYSTEM_THEME_VALUE)}
          >
            <div className="tsp-sys-split">
              <div className="tsp-sys-half" data-theme="dark" data-scheme="dark"><ThemeMock /></div>
              <div className="tsp-sys-half" data-theme="light" data-scheme="light"><ThemeMock /></div>
            </div>
          </ThemeCard>
          {allThemes.map(def => (
            <ThemeCard
              key={def.id}
              themeId={def.id}
              selected={selection === def.id}
              name={def.name}
              description={def.description}
              scheme={def.scheme}
              onPick={() => setThemeSelection(def.id)}
            >
              <ThemeMock />
            </ThemeCard>
          ))}
        </div>
      </section>
      <BrandLogoSection />
    </div>
  )
}

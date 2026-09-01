/**
 * 设置 → 扩展 → 核心扩展 的固定成员。
 *
 * 核心扩展是产品始终内置、不属于任何扩展包的能力：
 * - Skills 视图  → built-in-skills（内置技能集）+ skill-loader-extension（Skill Loader）
 * - MCP 连接     → pi-mcp-extension（内置 MCP 宿主）
 * - 基础工具     → pi 自带工具之外的基础工具包（网页检索、浏览器、电脑、记忆）。
 *                  更复杂的工具由扩展包和其他扩展带来。
 * - 主题包       → pipiui-theme-pack（app.ui.themes 贡献）；预览与选用在 设置 → 主题。
 */
export const CORE_SKILLS_EXTENSION_IDS = ['built-in-skills', 'skill-loader-extension'] as const

export const CORE_MCP_EXTENSION_IDS = ['pi-mcp-extension'] as const

/** Frozen core-capability tool packages（与 pi-backend extension-registry 的冻结清单一致）。 */
export const CORE_TOOL_EXTENSION_IDS = [
  'web-access-extension',
  'webview-browser-extension',
  'cua-extension',
  'memory-extension',
] as const

/** 预留给即将实现的主题扩展；在它注册到运行时之前仅用于侧栏占位。 */
export const UPCOMING_THEME_EXTENSION_ID = 'theme-extension'

/**
 * 主题包扩展（app.ui.themes 贡献，无 agent 工具）。归入核心扩展分组；
 * 主题的预览与选用在 设置 → 主题，不在扩展页重复管理。
 */
export const THEME_PACK_EXTENSION_ID = 'pipiui-theme-pack'

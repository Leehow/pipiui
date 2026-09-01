/**
 * 设置 → 扩展 → 核心扩展 的固定成员。
 *
 * 基础版（profiles/base）只强制这两个 Skills 扩展；网页、浏览器、电脑控制、记忆
 * 跟 Coding 扩展包走，不再当作核心「基础工具」。
 * - Skills 视图  → built-in-skills（内置技能集）+ skill-loader-extension（Skill Loader）
 * - MCP 连接     → pi-mcp-extension（内置 MCP 宿主）
 * - 主题包       → pipiui-theme-pack（app.ui.themes 贡献）；预览与选用在 设置 → 主题。
 */
export const CORE_SKILLS_EXTENSION_IDS = ['built-in-skills', 'skill-loader-extension'] as const

export const CORE_MCP_EXTENSION_IDS = ['pi-mcp-extension'] as const

/** 预留给即将实现的主题扩展；在它注册到运行时之前仅用于侧栏占位。 */
export const UPCOMING_THEME_EXTENSION_ID = 'theme-extension'

/**
 * 主题包扩展（app.ui.themes 贡献，无 agent 工具）。归入核心扩展分组；
 * 主题的预览与选用在 设置 → 主题，不在扩展页重复管理。
 */
export const THEME_PACK_EXTENSION_ID = 'pipiui-theme-pack'

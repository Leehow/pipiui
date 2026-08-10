import Foundation

/// Master on/off switches for everything PipiUI ships on top of bare `pi`.
///
/// Distinct from `ToolSkillSettings` (fine-grained tool denylist) and
/// `ComputerUseSettings` (the desktop authorization opt-in). This catalog is the
/// single source of truth for "should this App-owned extension / agent dir /
/// prompt layer be mounted at all". Turning every item off makes a new/restarted
/// session equivalent to bare `pi` wrapped only in PipiUI's RPC/UI shell.
///
/// Persistence mirrors `ToolSkillSettings`: a missing key means ON, and only
/// the *disabled* IDs are stored. Unknown IDs left over from older builds are
/// ignored — they can never affect a known catalog entry.
/// Transactional bridge between the philosophy master feature and pi's package
/// registration. The fallible settings.json mutation runs first; only success
/// commits config/auto-register/master state. A thrown error leaves all three
/// persisted switches unchanged, so UI and actual package loading cannot fork.
enum BuiltInPhilosophyTransition {
    static func apply(
        enabled: Bool,
        defaults: UserDefaults = .standard,
        configURL: URL = PhilosophySettings.configURL,
        settingsURL: URL = PhilosophyPackage.settingsURL
    ) throws {
        if enabled {
            try PhilosophyPackage.register(settingsURL: settingsURL)
            PhilosophyPackage.setAutoRegisterEnabled(true, defaults: defaults)
            PhilosophySettings.setEnabled(true, configURL: configURL)
            // Commit the visible/master state last.
            BuiltInFeatureSettings.setEnabled(true, id: .philosophy, defaults: defaults)
        } else {
            try PhilosophyPackage.unregister(settingsURL: settingsURL)
            PhilosophyPackage.setAutoRegisterEnabled(false, defaults: defaults)
            PhilosophySettings.setEnabled(false, configURL: configURL)
            // Commit the visible/master state last.
            BuiltInFeatureSettings.setEnabled(false, id: .philosophy, defaults: defaults)
        }
    }
}

enum BuiltInFeatureSettings {
    /// UserDefaults key holding the sorted disabled feature IDs.
    static let disabledKey = "pipiui.builtInFeatures.disabled"

    // MARK: - Catalog

    /// Stable feature identifier. Never rename a raw value: it is persisted in
    /// UserDefaults and compared against the disabled set.
    enum FeatureID: String, CaseIterable, Codable, Sendable {
        /// Working philosophy package (prompt + dispatch protocol).
        case philosophy
        /// Patched subagent extension + App-owned agents dir (explore / plan / operator …) + secretary.
        case subagent
        /// Built-in in-conversation browser extension.
        case browser
        /// In-conversation `generate_image` tool.
        case generateImage
        /// Structured git status/diff + prompt snapshot.
        case git
        /// Internal hot-reload command (`pipiui_reload`).
        case reload
        /// Managed pi-web-access tools (not a native model tool).
        case webSearch
        /// Retired custom PDF agent tool ID retained for saved-preference compatibility.
        case pdfExtract
        /// Retained persisted ID; GitHub retrieval now belongs to fetch_content.
        case githubFetch
        /// Local Pi package for arXiv metadata and HTML retrieval; optional PDF fallback is separate.
        case arxivFetch
        /// User-added MCP servers (stdio / HTTP) exposed as local tools.
        case mcp
        /// On-demand skill loader (name index + skill_search / skill_load).
        case skillLoader
        /// Project search boundary + per-turn external path grant.
        case searchScope
        /// OpenAI Codex hosted server-side web_search.
        case codexServerTools
        /// Anthropic hosted server-side web_search.
        case claudeServerTools
        /// PipiUI Computer Use capability (desktop harness). Independent of the
        /// `ComputerUseSettings` authorization opt-in; when this is off the
        /// harness is never mounted even if authorization is on.
        case computerUse
    }

    enum Section: String, CaseIterable, Codable, Sendable {
        case extensionTool = "扩展与工具"
        case constraint = "运行约束与功能"
    }

    struct Entry: Identifiable, Equatable, Sendable {
        let id: FeatureID
        let section: Section
        let title: String
        let summary: String
    }

    /// Display catalog. Order within a section is the UI order.
    static let catalog: [Entry] = [
        .init(id: .subagent,
              section: .extensionTool,
              title: "Subagent / 内置 agents",
              summary: "补丁版 subagent（生命周期上报、深度护栏、agent 树身份）+ App 自有 agent 目录（explore / plan / operator / reviewer / secretary）。关闭后派工回退到 pi 原生 subagent。"),
        .init(id: .browser,
              section: .extensionTool,
              title: "内置浏览器",
              summary: "对话内的 webview 浏览器扩展（网页预览与交互）。"),
        .init(id: .generateImage,
              section: .extensionTool,
              title: "generate_image",
              summary: "对话内生成图片工具（Grok Imagine / Coding Relay 等）。"),
        .init(id: .git,
              section: .extensionTool,
              title: "结构化 Git",
              summary: "git_status / git_diff 结构化输出 + 提示快照。"),
        .init(id: .reload,
              section: .extensionTool,
              title: "内部 reload",
              summary: "pipiui_reload 命令：热重载扩展、skills、提示与上下文。"),
        .init(id: .webSearch,
              section: .extensionTool,
              title: "web_search / fetch_content",
              summary: "pi-web-access 为不带联网能力的模型补充搜索与抓取；默认零配置 Exa，并保留 GitHub clone 与 PDF 提取。"),
        .init(id: .pdfExtract,
              section: .extensionTool,
              title: "PDF agent 读取（已迁移）",
              summary: "PipiUI 已移除自研 PDF agent 工具；联网 PDF 由 pi-web-access 的 fetch_content 提供。拖入 composer 的本地 PDF 入库不受影响。"),
        .init(id: .githubFetch,
              section: .extensionTool,
              title: "GitHub repo / code fetch（已迁移）",
              summary: "保留旧偏好 ID 的兼容项；不再安装独立 GitHub 抓取扩展。GitHub 仓库、blob、tree clone 由 pi-web-access 的 fetch_content 随 web_search 开关提供。"),
        .init(id: .arxivFetch,
              section: .extensionTool,
              title: "arXiv paper fetch",
              summary: "独立本地 Pi package 的 arxiv_fetch：arXiv Atom 元数据、官方 HTML 与 ar5iv 单次降级；PDF 降级取决于「本地 PDF 读取」开关，且不上传 PDF。关闭后 arXiv URL 回退 fetch_content。"),
        .init(id: .mcp,
              section: .extensionTool,
              title: "MCP 服务器",
              summary: "用户自添的 MCP 服务器（搜索类 MCP 如 firecrawl-mcp / brave-mcp / 智谱 MCP）。工具以 mcp_<服务器名>_<工具名> 暴露给 agent；在「工具/mcp」页配置。"),
        .init(id: .codexServerTools,
              section: .extensionTool,
              title: "Codex hosted 搜索",
              summary: "OpenAI Codex Responses 托管的 server-side web_search。"),
        .init(id: .claudeServerTools,
              section: .extensionTool,
              title: "Claude hosted 搜索",
              summary: "Anthropic 托管的 server-side web_search。"),
        .init(id: .computerUse,
              section: .extensionTool,
              title: "Computer Use 能力",
              summary: "PipiUI 桌面控制能力是否可用。关闭后即便「工具」里的授权为开也不挂载；授权与策略仍在「内置」中独立设置。"),
        .init(id: .philosophy,
              section: .constraint,
              title: "工作哲学",
              summary: "常驻工作哲学：判断准则、编排与并发方式。装在 pi 里，终端裸跑也生效；关闭会从 pi 的包列表移除并跳过 fallback 注入。"),
        .init(id: .skillLoader,
              section: .constraint,
              title: "Skills 按需加载",
              summary: "提示只保留 skill 名字，正文走 skill_search / skill_load 按需读取。"),
        .init(id: .searchScope,
              section: .constraint,
              title: "项目搜索边界",
              summary: "把本地文件搜索限制在会话项目根，并按轮授权外部路径访问。"),
    ]

    // MARK: - Snapshot

    /// Immutable view of the enabled/disabled state handed to `AppStore` /
    /// `ChatSession` so spawn assembly never re-reads UserDefaults.
    struct EnabledSet: Equatable, Sendable {
        let disabled: Set<String>

        /// Build directly from a known disabled set (used by tests).
        init(disabled: Set<String> = []) {
            self.disabled = disabled
        }

        init(disabledIDs: [String]) {
            self.disabled = Set(disabledIDs)
        }

        func isEnabled(_ id: FeatureID) -> Bool {
            !disabled.contains(id.rawValue)
        }

        /// True when every catalog feature is off — i.e. bare-pi mode.
        var allDisabled: Bool {
            FeatureID.allCases.allSatisfy { disabled.contains($0.rawValue) }
        }

        /// Disabled IDs restricted to the current catalog. Unknown/stale IDs are
        /// dropped so they can never influence a known feature.
        func sanitized() -> EnabledSet {
            let known = Set(FeatureID.allCases.map(\.rawValue))
            return EnabledSet(disabled: disabled.intersection(known))
        }
    }

    // MARK: - Persistence (missing = enabled)

    static func disabledIDs(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: disabledKey) ?? [])
    }

    static func enabledSet(defaults: UserDefaults = .standard) -> EnabledSet {
        EnabledSet(disabled: disabledIDs(defaults: defaults))
    }

    static func isEnabled(_ id: FeatureID, defaults: UserDefaults = .standard) -> Bool {
        !disabledIDs(defaults: defaults).contains(id.rawValue)
    }

    /// Set a single feature and persist. Storing the disabled set keeps the
    /// "missing = enabled" default intact for first launch and new features.
    static func setEnabled(
        _ enabled: Bool,
        id: FeatureID,
        defaults: UserDefaults = .standard
    ) {
        var ids = disabledIDs(defaults: defaults)
        if enabled {
            ids.remove(id.rawValue)
        } else {
            ids.insert(id.rawValue)
        }
        defaults.set(Array(ids).sorted(), forKey: disabledKey)
    }
}

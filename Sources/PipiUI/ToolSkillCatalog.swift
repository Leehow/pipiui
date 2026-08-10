import Foundation

/// Static inventory of tools PipiUI / pi expose. Skills come from the live session.
enum ToolSkillCatalog {
    struct ToolEntry: Identifiable, Equatable, Hashable {
        let name: String
        let group: String
        let summary: String
        var id: String { "\(group):\(name)" }
    }

    static let builtinTools: [ToolEntry] = [
        .init(name: "read", group: "内置", summary: "读取文件"),
        .init(name: "bash", group: "内置", summary: "执行 shell 命令"),
        .init(name: "edit", group: "内置", summary: "编辑已有文件"),
        .init(name: "write", group: "内置", summary: "写入 / 创建文件"),
        .init(name: "grep", group: "内置", summary: "内容搜索"),
        .init(name: "find", group: "内置", summary: "按名查找文件"),
        .init(name: "ls", group: "内置", summary: "列出目录"),
        .init(name: "subagent", group: "内置", summary: "委派给专用 subagent"),
        .init(name: "subagent_status", group: "内置", summary: "查询 subagent 任务状态"),
        .init(name: "secretary_commit", group: "内置", summary: "秘书验收后按清单安全提交"),
    ]

    static let extensionTools: [ToolEntry] = [
        .init(name: "generate_image", group: "扩展", summary: "对话内生图（Grok Imagine / Coding Relay）"),
        .init(name: "browser_*", group: "扩展", summary: "应用内 WebView 浏览器工具（browser）"),
        .init(name: "computer", group: "扩展", summary: "安全闸门控制的 macOS 屏幕与输入（默认关闭）"),
        .init(name: "git", group: "扩展", summary: "结构化 git status / diff / log / show"),
        .init(name: "web_search", group: "扩展", summary: "pi-web-access 联网搜索（默认零配置 Exa）"),
        .init(name: "fetch_content", group: "扩展", summary: "抓取 URL 正文；支持 GitHub clone、PDF 与网页内容提取"),
        .init(name: "source_check", group: "扩展", summary: "核验搜索结果中的来源与引文"),
        .init(name: "get_search_content", group: "扩展", summary: "读取 web_search / fetch_content 已保存的内容切片"),
    ]

    static var allTools: [ToolEntry] { builtinTools + extensionTools }

    static func skills(from commands: [SlashCommand]) -> [SlashCommand] {
        commands.filter { $0.source == .skill }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

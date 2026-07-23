import Foundation

/// App 自有的 pi 插件集合，安装到 Application Support 后通过 `-e` 加载。
///
/// 设计目标：所有对 pi 行为的扩展都由 App 拥有并在每次启动时重装，
/// 完全独立于 `~/.pi`——pi 升级、重装示例、重置用户配置都不影响我们。
///
/// - 补丁版 subagent 扩展（生命周期上报 + 深度护栏 + agent 树身份），通过 `-e` 加载。
///   注意：pi 对同名工具是**硬失败**（重名 → error 诊断 → `process.exit(1)`），
///   `-e` 并不会覆盖自动发现的官方 subagent。用户 `~/.pi/agent/extensions` 里存在同名扩展时，
///   由 `PiExtensionConflicts` 在 spawn 前检出并提示修复。
/// - App 自有 agent 目录（lead + 反摆烂版 explore/plan/reviewer/general-purpose），
///   通过 `PIPIUI_AGENTS_DIR` 让补丁版 subagent 读取，不碰 `~/.pi/agent/agents`。
/// - 内置浏览器扩展、Boss 协议提示词。
enum PiPlugin {
    /// 安装结果：spawn pi 时需要的路径与环境变量。
    struct Installed {
        var subagentDir: String?   // -e 这个目录（含补丁版 index.ts）
        var webviewExtension: String? // -e 这个文件
        var mediaExtension: String?   // -e 对话内 generate_image
        var reloadExtension: String?  // -e 内部 pipiui_reload 命令
        var agentsDir: String?     // PIPIUI_AGENTS_DIR
        var bossPrompt: String?    // --append-system-prompt（Boss 模式）
    }

    private static var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI")
    }

    /// 每次启动调用：把打包的插件源拷到 Application Support（覆盖旧版）。
    static func installAll() -> Installed {
        var result = Installed()
        let fm = FileManager.default
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)

        // 1. 从 SPM 资源里把整个 PiExt 拷到 Application Support/pi-ext
        if let bundled = Bundle.module.url(forResource: "PiExt", withExtension: nil) {
            let dest = root.appendingPathComponent("pi-ext")
            try? fm.removeItem(at: dest)
            do {
                try fm.copyItem(at: bundled, to: dest)
                result.subagentDir = dest.appendingPathComponent("subagent").path
                result.agentsDir = dest.appendingPathComponent("agents").path
            } catch {
                // 拷贝失败时降级：subagent 面板仍能用（依赖用户自装的），只是没补丁
            }
        }

        // 2. 内置浏览器扩展（字符串生成，无外部依赖）
        result.webviewExtension = WebviewExtension.install(into: root)

        // 3. 对话内生图工具（Grok Imagine / Coding Relay）
        result.mediaExtension = MediaExtension.install(into: root)

        // 4. 热重载扩展/skills/prompts/context（内部命令 pipiui_reload）
        result.reloadExtension = ReloadExtension.install(into: root)

        // 5. Boss 协议提示词
        result.bossPrompt = BossPrompt.install(into: root)

        return result
    }
}

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
/// - 内置浏览器扩展。
///
/// 唯一的例外是工作哲学（`PhilosophyPackage`）：它注册进 `~/.pi/agent/settings.json`，
/// 因为它是这里唯一「离开本 App 仍然成立」的东西——裸 TUI 也该吃到。
enum PiPlugin {
    /// 安装结果：spawn pi 时需要的路径与环境变量。
    struct Installed {
        var subagentDir: String?   // -e 这个目录（含补丁版 index.ts）
        var webviewExtension: String? // -e 这个文件
        var mediaExtension: String?   // -e 对话内 generate_image
        var gitExtension: String?     // -e git_status / git_diff + prompt snapshot
        var reloadExtension: String?  // -e 内部 pipiui_reload 命令
        var webSearchExtension: String? // -e web_search / web_fetch
        var skillLoaderExtension: String? // -e 技能按需加载（名字索引 + skill_search / skill_load）
        var searchScopeExtension: String? // -e 项目内搜索边界 + 当轮外部路径授权
        var codexServerToolsExtension: String? // -e openai-codex hosted web_search
        var claudeServerToolsExtension: String? // -e anthropic hosted web_search
        var computerUseExtension: String? // -e opt-in desktop computer harness
        var agentsDir: String?     // PIPIUI_AGENTS_DIR
    }

    private static var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI")
    }

    /// ChatSession is constructed from an Installed value in AppStore, but keeping this
    /// path app-owned avoids widening that already-large initializer solely for one guard.
    static var searchScopeExtensionPath: String? {
        let path = root.appendingPathComponent("pipiui-search-scope.ts").path
        return FileManager.default.fileExists(atPath: path) ? path : nil
    }

    /// 启动指纹标记：上次完整安装时的插件指纹，未变更则整轮跳过（第二次启动基本零 I/O）。
    private static var markerURL: URL { root.appendingPathComponent(".install-marker") }

    /// 每次启动调用：把打包的插件源拷到 Application Support（覆盖旧版）。
    /// 指纹（可执行文件 mtime+size + 打包 PiExt 目录签名）未变且目标文件齐全时整体跳过。
    /// 首次调用（或任何变更后）仍是同步完整安装，保证 spawn 首个会话前插件已就绪。
    static func installAll() -> Installed {
        let fm = FileManager.default
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        // Cheap, and must run even on the skip path: registration lives in the user's pi
        // settings, which anything outside this App may have changed since last launch.
        PhilosophySettings.ensureDefaultConfig()
        PhilosophySettings.migrateFromBossModeIfNeeded()
        defer { syncPhilosophyRegistration() }
        let fingerprint = currentFingerprint()
        if let saved = try? String(contentsOf: markerURL, encoding: .utf8),
           saved == fingerprint,
           let existing = installedIfComplete() {
            return existing
        }
        let result = performInstall()
        try? fingerprint.write(to: markerURL, atomically: true, encoding: .utf8)
        return result
    }

    /// Keep pi's package list in step with the user's choice. A deliberate "移除" is remembered,
    /// so this never re-adds what the user removed.
    private static func syncPhilosophyRegistration() {
        guard PhilosophyPackage.autoRegisterEnabled() else { return }
        guard PhilosophyPackage.extensionPath != nil else { return }
        try? PhilosophyPackage.register()
    }

    /// 插件内容指纹：扩展/提示词源码编译进二进制，PiExt 是打包资源。
    /// 可执行文件 mtime+size 每次重编译都变，覆盖前者；目录签名覆盖后者。
    private static func currentFingerprint() -> String {
        var parts: [String] = []
        if let exe = Bundle.main.executableURL,
           let attrs = try? FileManager.default.attributesOfItem(atPath: exe.path) {
            let m = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            let s = (attrs[.size] as? Int) ?? 0
            parts.append("exe:\(s):\(m)")
        }
        if let bundled = PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil) {
            parts.append(directorySignature(bundled))
        }
        if let philosophy = PipiResourceBundle.shared.url(forResource: "PiPhilosophy", withExtension: nil) {
            parts.append(directorySignature(philosophy))
        }
        return parts.joined(separator: "|")
    }

    /// 目录签名：相对路径 + size + mtime 拼接（不读文件内容，几十个文件很快）。
    private static func directorySignature(_ dir: URL) -> String {
        let fm = FileManager.default
        guard let e = fm.enumerator(at: dir, includingPropertiesForKeys: nil) else { return "" }
        var sig = ""
        for case let url as URL in e {
            let rel = url.path.replacingOccurrences(of: dir.path, with: "")
            let attrs = try? fm.attributesOfItem(atPath: url.path)
            let m = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            let s = (attrs?[.size] as? Int) ?? 0
            sig += "\(rel)#\(s)#\(m);"
        }
        return sig
    }

    /// 跳过路径：所有目标文件都还在才可信（用户手删/Application Support 被清时回退全量安装）。
    private static func installedIfComplete() -> Installed? {
        let fm = FileManager.default
        var result = Installed()
        if PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil) != nil {
            let dest = root.appendingPathComponent("pi-ext")
            let sub = dest.appendingPathComponent("subagent").path
            let agents = dest.appendingPathComponent("agents").path
            guard fm.fileExists(atPath: sub), fm.fileExists(atPath: agents) else { return nil }
            result.subagentDir = sub
            result.agentsDir = agents
        }
        let files: [(String, WritableKeyPath<Installed, String?>)] = [
            ("pipiui-webview.ts", \.webviewExtension),
            ("pipiui-media.ts", \.mediaExtension),
            ("pipiui-git.ts", \.gitExtension),
            ("pipiui-reload.ts", \.reloadExtension),
            ("pipiui-websearch.ts", \.webSearchExtension),
            ("pipiui-skillloader.ts", \.skillLoaderExtension),
            ("pipiui-search-scope.ts", \.searchScopeExtension),
            ("pipiui-codex-server-tools.ts", \.codexServerToolsExtension),
            ("pipiui-claude-server-tools.ts", \.claudeServerToolsExtension),
            ("pipiui-computer-use.ts", \.computerUseExtension),
        ]
        for (name, keyPath) in files {
            let path = root.appendingPathComponent(name).path
            guard fm.fileExists(atPath: path) else { return nil }
            result[keyPath: keyPath] = path
        }
        guard PhilosophyPackage.extensionPath != nil else { return nil }
        return result
    }

    private static func performInstall() -> Installed {
        var result = Installed()
        let fm = FileManager.default

        // 1. 从 SPM 资源里把整个 PiExt 拷到 Application Support/pi-ext
        let bundledPiExt =
            PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil)
            ?? PipiResourceBundle.shared.resourceURL?.appendingPathComponent("PiExt", isDirectory: true)
        if let bundled = bundledPiExt, fm.fileExists(atPath: bundled.path) {
            let dest = root.appendingPathComponent("pi-ext")
            try? fm.removeItem(at: dest)
            do {
                try fm.copyItem(at: bundled, to: dest)
                let subagent = dest.appendingPathComponent("subagent")
                let agents = dest.appendingPathComponent("agents")
                if fm.fileExists(atPath: subagent.path) {
                    result.subagentDir = subagent.path
                }
                if fm.fileExists(atPath: agents.path) {
                    result.agentsDir = agents.path
                }
            } catch {
                // 拷贝失败时降级：subagent 面板仍能用（依赖用户自装的），只是没补丁
            }
        }
        // If Application Support is stale/incomplete, still point at the bundle agents.
        if result.agentsDir == nil,
           let bundledAgents = bundledPiExt?.appendingPathComponent("agents"),
           fm.fileExists(atPath: bundledAgents.path) {
            result.agentsDir = bundledAgents.path
        }
        if result.subagentDir == nil,
           let bundledSub = bundledPiExt?.appendingPathComponent("subagent"),
           fm.fileExists(atPath: bundledSub.path) {
            result.subagentDir = bundledSub.path
        }

        // 2. 内置浏览器扩展（字符串生成，无外部依赖）
        result.webviewExtension = WebviewExtension.install(into: root)

        // 3. 对话内生图工具（Grok Imagine / Coding Relay）
        result.mediaExtension = MediaExtension.install(into: root)

        // 4. Git 结构化 status/diff + system prompt snapshot
        result.gitExtension = GitExtension.install(into: root)

        // 5. 热重载扩展/skills/prompts/context（内部命令 pipiui_reload）
        result.reloadExtension = ReloadExtension.install(into: root)

        // 5.5 通用网络搜索 + 网页抓取（web_search / web_fetch）
        result.webSearchExtension = WebSearchExtension.install(into: root)

        // 5.6 技能按需加载：提示里只留名字，描述/正文走 skill_search / skill_load
        result.skillLoaderExtension = SkillLoaderExtension.install(into: root)

        // 5.65 项目搜索边界：内建 find/grep/ls + 明确的递归 bash 搜索
        result.searchScopeExtension = SearchScopeExtension.install(into: root)

        // 5.7 官方 openai-codex Responses hosted web_search
        result.codexServerToolsExtension = CodexServerToolsExtension.install(into: root)

        // 5.8 官方 anthropic-messages hosted web_search
        result.claudeServerToolsExtension = ClaudeServerToolsExtension.install(into: root)

        // 5.9 macOS Computer Use（仅安装；独立 opt-in 决定 ChatSession 是否 -e 挂载）
        result.computerUseExtension = ComputerUseExtension.install(into: root)

        // 6. 工作哲学：随包快照落盘（注册进 pi 由 syncPhilosophyRegistration 负责）
        PhilosophyPackage.install()

        // 旧版 Boss 提示词已由哲学包取代，别在用户机器上留 20KB 死文件
        try? fm.removeItem(at: root.appendingPathComponent("boss-prompt.md"))

        return result
    }
}

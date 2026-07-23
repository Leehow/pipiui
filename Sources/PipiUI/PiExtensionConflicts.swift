import Foundation

/// spawn 之前的自检：找出会和 App 自带补丁版 subagent 撞名的用户/项目扩展。
///
/// 背景：pi 对「同名工具」是**硬失败**，不是后注册覆盖——
/// `resource-loader.js` 的 detectExtensionConflicts 把重名工具推成 error 诊断，
/// `main.js` 见到 error 级诊断直接 `process.exit(1)`。
/// 所以 `~/.pi/agent/extensions/subagent` 这类自动发现的官方版存在时，
/// App 用 `-e` 加载补丁版并不会盖过它，而是整个 pi 进程起不来。
struct PiExtensionConflict: Identifiable, Equatable {
    /// pi 实际加载的入口文件（.ts/.js），也是写进 settings.json 的 force-exclude 目标
    var entryPath: String
    /// 人类可读的来源，例如「用户级 ~/.pi/agent/extensions」
    var scopeLabel: String
    /// 该作用域的 settings.json 路径
    var settingsPath: String

    var id: String { entryPath }
}

enum PiExtensionConflicts {
    /// App 自带扩展注册的工具名；撞上它才算冲突
    static let ownedToolName = "subagent"

    private static var fm: FileManager { .default }

    // MARK: - 检测

    /// 扫描用户级和项目级扩展目录，返回会撞名的入口文件。
    /// 项目级只有在 pi 信任该项目时才会真正加载，标签里已注明。
    static func detect(projectDir: URL?) -> [PiExtensionConflict] {
        var result = scan(
            baseDir: fm.homeDirectoryForCurrentUser.appendingPathComponent(".pi/agent"),
            scopeLabel: "用户级 ~/.pi/agent/extensions"
        )
        if let projectDir {
            result += scan(
                baseDir: projectDir.appendingPathComponent(".pi"),
                scopeLabel: "项目级 .pi/extensions（项目被信任时生效）"
            )
        }
        return result
    }

    /// 扫描一个 pi 配置根（`~/.pi/agent` 或项目 `.pi`）。SelfTest 用临时目录直接调它。
    static func scan(baseDir: URL, scopeLabel: String) -> [PiExtensionConflict] {
        let settingsPath = baseDir.appendingPathComponent("settings.json").path
        let overrides = overridePatterns(settingsPath: settingsPath)
        return discoverEntries(in: baseDir.appendingPathComponent("extensions"))
            .filter { !isDisabledByOverrides($0, overrides) && registersOwnedTool($0) }
            .map {
                PiExtensionConflict(entryPath: $0.path, scopeLabel: scopeLabel, settingsPath: settingsPath)
            }
    }

    /// 对齐 pi 的 collectAutoExtensionEntries：
    /// 目录本身是扩展则整目录算一个；否则逐项扫描，`.` 开头和 node_modules 跳过。
    private static func discoverEntries(in dir: URL) -> [URL] {
        guard fm.fileExists(atPath: dir.path) else { return [] }
        if let rootEntries = resolveEntries(dir) { return rootEntries }
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return [] }

        var entries: [URL] = []
        for name in names.sorted() {
            if name.hasPrefix(".") || name == "node_modules" { continue }
            let full = dir.appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: full.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue {
                entries += resolveEntries(full) ?? []
            } else if name.hasSuffix(".ts") || name.hasSuffix(".js") {
                entries.append(full)
            }
        }
        return entries
    }

    /// 对齐 pi 的 resolveExtensionEntries：package.json 的 `pi.extensions` 优先，其次 index.ts / index.js
    private static func resolveEntries(_ dir: URL) -> [URL]? {
        let pkg = dir.appendingPathComponent("package.json")
        if let data = try? Data(contentsOf: pkg),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let pi = json["pi"] as? [String: Any],
           let listed = pi["extensions"] as? [String] {
            let resolved = listed
                .map { URL(fileURLWithPath: $0, relativeTo: dir).standardizedFileURL }
                .filter { fm.fileExists(atPath: $0.path) }
            if !resolved.isEmpty { return resolved }
        }
        for index in ["index.ts", "index.js"] {
            let candidate = dir.appendingPathComponent(index)
            if fm.fileExists(atPath: candidate.path) { return [candidate] }
        }
        return nil
    }

    /// 是否注册了我们占用的工具名。只认扩展 API 里那一处字面量注册，读不到就当不冲突。
    private static func registersOwnedTool(_ entry: URL) -> Bool {
        guard let source = try? String(contentsOf: entry, encoding: .utf8) else { return false }
        return source.contains("name: \"\(ownedToolName)\"") || source.contains("name: '\(ownedToolName)'")
    }

    // MARK: - settings.json 覆盖规则

    /// settings.json 的 `extensions` 数组里，`!`/`+`/`-` 开头的是开关覆盖，其余是额外加载路径
    private static func overridePatterns(settingsPath: String) -> [String] {
        guard let data = fm.contents(atPath: settingsPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entries = json["extensions"] as? [String] else { return [] }
        return entries.filter { $0.hasPrefix("!") || $0.hasPrefix("+") || $0.hasPrefix("-") }
    }

    /// 只判断明确关掉这一条的情况（精确路径），glob 形式的排除交给 pi 自己，宁可多提示一次
    private static func isDisabledByOverrides(_ entry: URL, _ patterns: [String]) -> Bool {
        let forceIncluded = patterns.contains { $0.hasPrefix("+") && $0.dropFirst() == entry.path }
        if forceIncluded { return false }
        return patterns.contains {
            ($0.hasPrefix("-") || $0.hasPrefix("!")) && $0.dropFirst() == entry.path
        }
    }

    // MARK: - 修复

    /// 往对应 settings.json 的 `extensions` 里追加一条 force-exclude（`-<绝对路径>`）。
    /// 不删不改用户文件，pi 自己的 `pi config` 管的也是这个字段，随时可以撤销。
    static func disable(_ conflict: PiExtensionConflict) throws {
        let url = URL(fileURLWithPath: conflict.settingsPath)
        var json: [String: Any] = [:]
        if let data = fm.contents(atPath: conflict.settingsPath),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            json = parsed
        }
        var entries = json["extensions"] as? [String] ?? []
        let pattern = "-\(conflict.entryPath)"
        guard !entries.contains(pattern) else { return }
        entries.append(pattern)
        json["extensions"] = entries

        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // 用户会手编这个文件，别把路径里的斜杠转义成 \/
        let out = try JSONSerialization.data(
            withJSONObject: json, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        )
        try out.write(to: url, options: .atomic)
    }
}

import Foundation

// MARK: - Model

package enum SlashSource: String, Hashable, Codable {
    case builtin
    /// RPC wire value is `"extension"`; Swift case cannot be `extension`.
    case extension_ = "extension"
    case prompt
    case skill
}

package struct SlashCommand: Identifiable, Hashable {
    package let name: String          // without leading '/'
    package let description: String?
    package let source: SlashSource
    package let argumentHint: String? // e.g. "<provider/model>"; nil for server cmds
    package var id: String { "\(source.rawValue):\(name)" }

    package init(name: String, description: String?, source: SlashSource, argumentHint: String?) {
        self.name = name
        self.description = description
        self.source = source
        self.argumentHint = argumentHint
    }
}

// MARK: - get_commands parser

package enum SlashCommandParser {
    /// Parse a full RPC response `J` (or just the response object) into server commands.
    /// On failure / empty / success!=true → `[]` (caller keeps builtins only; no error).
    package static func parseGetCommandsResponse(_ resp: J) -> [SlashCommand] {
        // Accept either full response or a bare `{commands:[...]}` data object.
        let data: J
        if resp["data"].exists {
            if resp["success"].exists && resp["success"].bool != true {
                return []
            }
            data = resp["data"]
        } else {
            data = resp
        }
        return data["commands"].array.compactMap { parseOne($0) }
    }

    private static func parseOne(_ c: J) -> SlashCommand? {
        guard let name = c["name"].string, !name.isEmpty else { return nil }
        guard let source = mapSource(c["source"].string) else { return nil }
        return SlashCommand(
            name: name,
            description: c["description"].string,
            source: source,
            argumentHint: nil
        )
    }

    private static func mapSource(_ raw: String?) -> SlashSource? {
        guard let raw else { return nil }
        switch raw {
        case "extension": return .extension_
        case "prompt": return .prompt
        case "skill": return .skill
        case "builtin": return .builtin
        default: return nil
        }
    }
}

// MARK: - Palette trigger query

package enum SlashPaletteQuery {
    /// Returns the fuzzy query (text after `/`) when the palette should show; otherwise nil.
    package static func paletteQuery(from draft: String) -> String? {
        var s = draft[...]
        while let c = s.first, c.isWhitespace {
            s.removeFirst()
        }
        guard s.first == "/" else { return nil }
        s.removeFirst()
        // Any whitespace means user started typing arguments → hide palette.
        if s.contains(where: { $0.isWhitespace }) {
            return nil
        }
        return String(s)
    }
}

// MARK: - Fuzzy filter

package enum SlashFuzzy {
    /// Higher is better. nil = no match.
    package static func score(query: String, name: String) -> Int? {
        let q = Array(query.lowercased())
        let n = Array(name.lowercased())
        if q.isEmpty { return 0 }
        var qi = 0
        var score = 0
        var prevMatched = -2
        var firstMatchIndex: Int?
        for (ni, ch) in n.enumerated() {
            guard qi < q.count else { break }
            if ch == q[qi] {
                score += 1
                if ni == prevMatched + 1 { score += 3 }
                if firstMatchIndex == nil {
                    firstMatchIndex = ni
                    if ni == 0 { score += 5 }
                    else if isBoundary(nameChars: Array(name), index: ni) { score += 2 }
                }
                prevMatched = ni
                qi += 1
            }
        }
        guard qi == q.count else { return nil }
        return score
    }

    private static func isBoundary(nameChars: [Character], index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = nameChars[index - 1]
        if prev == "-" || prev == "_" || prev == ":" || prev == "/" { return true }
        let cur = nameChars[index]
        if prev.isLowercase && cur.isUppercase { return true }
        return false
    }

    package static func filter(commands: [SlashCommand], query: String) -> [SlashCommand] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return commands }
        let scored: [(SlashCommand, Int)] = commands.compactMap { cmd in
            guard let s = score(query: q, name: cmd.name) else { return nil }
            return (cmd, s)
        }
        return scored
            .sorted { lhs, rhs in
                if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
                return lhs.0.name.localizedCaseInsensitiveCompare(rhs.0.name) == .orderedAscending
            }
            .map(\.0)
    }
}

// MARK: - Builtin commands

package protocol BuiltinCommandHost: AnyObject {
    func flash(_ message: String)
    func runCompact()
    func runSetSessionName(_ name: String)
    func runShowSessionStats()
    func runExportHTML()
    func runCopyLastAssistant()
    func runSetModel(providerSlashId: String)
    var onRequestNewSession: (() -> Void)? { get }
    var onRequestClose: (() -> Void)? { get }
}

package enum BuiltinCommands {
    package static let all: [SlashCommand] = [
        SlashCommand(name: "compact", description: "压缩上下文", source: .builtin, argumentHint: nil),
        SlashCommand(name: "new", description: "新建会话", source: .builtin, argumentHint: nil),
        SlashCommand(name: "name", description: "重命名会话", source: .builtin, argumentHint: "<name>"),
        SlashCommand(name: "session", description: "显示会话统计", source: .builtin, argumentHint: nil),
        SlashCommand(name: "export", description: "导出 HTML", source: .builtin, argumentHint: nil),
        SlashCommand(name: "copy", description: "复制最后一条助手回复", source: .builtin, argumentHint: nil),
        SlashCommand(name: "quit", description: "关闭当前会话", source: .builtin, argumentHint: nil),
        SlashCommand(name: "model", description: "切换模型", source: .builtin, argumentHint: "<provider/model>"),
    ]

    private static let byName: [String: SlashCommand] = {
        Dictionary(uniqueKeysWithValues: all.map { ($0.name, $0) })
    }()

    package static func command(named name: String) -> SlashCommand? {
        byName[name]
    }

    /// Parse a trimmed user send string into `/name args` if it is a slash invocation.
    package static func parseInvocation(_ text: String) -> (name: String, args: String)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else { return nil }
        let rest = trimmed.dropFirst()
        guard !rest.isEmpty else { return nil }
        let tokenEnd = rest.firstIndex(where: { $0.isWhitespace }) ?? rest.endIndex
        let name = String(rest[..<tokenEnd])
        guard !name.isEmpty else { return nil }
        let args = rest[tokenEnd...].trimmingCharacters(in: .whitespacesAndNewlines)
        return (name, args)
    }

    /// Returns false when `name` is not a builtin (caller should send as normal prompt).
    @discardableResult
    package static func execute(name: String, args: String, host: BuiltinCommandHost) -> Bool {
        guard byName[name] != nil else { return false }
        let trimmedArgs = args.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "compact":
            host.runCompact()
        case "new":
            if let action = host.onRequestNewSession {
                action()
            } else {
                host.flash("无法新建会话（未接入 AppStore）")
            }
        case "name":
            if trimmedArgs.isEmpty {
                host.flash("用法：/name <name>")
            } else {
                host.runSetSessionName(trimmedArgs)
            }
        case "session":
            host.runShowSessionStats()
        case "export":
            host.runExportHTML()
        case "copy":
            host.runCopyLastAssistant()
        case "quit":
            if let action = host.onRequestClose {
                action()
            } else {
                host.flash("无法关闭会话（未接入 AppStore）")
            }
        case "model":
            if trimmedArgs.isEmpty {
                host.flash("用法：/model <provider/model>，或用底栏模型菜单")
            } else {
                host.runSetModel(providerSlashId: trimmedArgs)
            }
        default:
            return false
        }
        return true
    }
}

import Foundation

/// Transport for a user-added MCP server.
enum McpTransport: String, Codable, CaseIterable, Sendable {
    case stdio
    case http
}

/// A single user-defined MCP server. Persisted in UserDefaults (canonical store) and
/// mirrored to pi-mcp-extension's standard `~/.pi/agent/mcp.json` config.
///
/// The package accepts static env/header values only. PipiUI keeps `${VAR}` references
/// in UserDefaults, expands them from the process environment and `~/.pi/agent/.env`
/// when it writes the mirror, and restricts that mirror to mode 0600.
struct McpServer: Codable, Equatable, Identifiable, Sendable {
    var name: String
    var enabled: Bool = true
    var transport: McpTransport = .stdio
    var command: String = ""
    var args: [String] = []
    var env: [String: String] = [:]
    var url: String = ""
    var headers: [String: String] = [:]

    var id: String { name }
}

enum McpServerSettings {
    static let defaultsKey = "pipiui.mcpServers"
    static let configFileName = "mcp.json"

    // MARK: - Paths

    static func configFileURL(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi", isDirectory: true)
            .appendingPathComponent("agent", isDirectory: true)
            .appendingPathComponent(configFileName, isDirectory: false)
    }

    // MARK: - Persistence (UserDefaults canonical + JSON mirror)

    static func servers(defaults: UserDefaults = .standard) -> [McpServer] {
        guard let data = defaults.data(forKey: defaultsKey) else { return [] }
        return (try? JSONDecoder().decode([McpServer].self, from: data)) ?? []
    }

    /// Persist the server list and re-write the pi-mcp-extension JSON mirror. A test
    /// suite mirrors only to an explicit URL (never the user's shared file).
    @discardableResult
    static func save(
        _ servers: [McpServer],
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        to explicitURL: URL? = nil,
        variables: [String: String]? = nil
    ) -> String? {
        let cleaned = servers.map { clean($0) }
        if let data = try? JSONEncoder().encode(cleaned) {
            defaults.set(data, forKey: defaultsKey)
        }
        return syncJSONFile(
            servers: cleaned,
            fileManager: fileManager,
            to: explicitURL,
            variables: variables
        )
    }

    /// Trim leading/trailing whitespace on name/command/url so validation and the
    /// extension's config lookup both see the canonical form.
    static func clean(_ server: McpServer) -> McpServer {
        var s = server
        s.name = s.name.trimmingCharacters(in: .whitespacesAndNewlines)
        s.command = s.command.trimmingCharacters(in: .whitespacesAndNewlines)
        s.url = s.url.trimmingCharacters(in: .whitespacesAndNewlines)
        return s
    }

    /// Map PipiUI's canonical model into pi-mcp-extension's `mcp.json` schema.
    /// Enabled servers stay eager to preserve the old bridge's auto-connect behavior;
    /// disabled servers are omitted so they cannot be started accidentally.
    static func jsonPayload(
        servers: [McpServer],
        variables: [String: String]
    ) throws -> [String: Any] {
        var entries: [String: Any] = [:]
        for original in servers {
            let server = clean(original)
            guard server.enabled, !server.name.isEmpty else { continue }

            var entry: [String: Any] = ["lifecycle": "eager"]
            switch server.transport {
            case .stdio:
                entry["transport"] = McpTransport.stdio.rawValue
                entry["command"] = server.command
                if !server.args.isEmpty { entry["args"] = server.args }
                if !server.env.isEmpty {
                    entry["env"] = try interpolateRecord(server.env, variables: variables)
                }
            case .http:
                entry["transport"] = "streamable-http"
                entry["url"] = server.url
                if !server.headers.isEmpty {
                    entry["headers"] = try interpolateRecord(server.headers, variables: variables)
                }
            }
            entries[server.name] = entry
        }
        return [
            "settings": ["toolPrefix": "mcp"],
            "mcpServers": entries,
        ]
    }

    @discardableResult
    static func syncJSONFile(
        servers: [McpServer],
        fileManager: FileManager = .default,
        to explicitURL: URL? = nil,
        variables: [String: String]? = nil
    ) -> String? {
        guard SharedConfigWriteGuard.mayWriteSharedFile(explicitURL: explicitURL) else { return nil }
        let url = explicitURL ?? configFileURL(fileManager: fileManager)
        do {
            let payload = try jsonPayload(
                servers: servers,
                variables: variables ?? runtimeVariables()
            )
            let data = try JSONSerialization.data(
                withJSONObject: payload,
                options: [.prettyPrinted, .sortedKeys]
            )
            try writeJSONSecurely(data, to: url, fileManager: fileManager)
            return nil
        } catch {
            let message = error.localizedDescription
            Log.warn("MCP config was not synced: \(message)", category: .storage)
            return message
        }
    }

    private static func runtimeVariables() -> [String: String] {
        var variables = ProcessInfo.processInfo.environment
        variables.merge(EnvFileStore().all()) { _, dotEnv in dotEnv }
        return variables
    }

    private static func writeJSONSecurely(
        _ data: Data,
        to url: URL,
        fileManager: FileManager
    ) throws {
        let directory = url.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appendingPathComponent(
            ".\(url.lastPathComponent).tmp-\(UUID().uuidString)"
        )
        guard fileManager.createFile(
            atPath: temporary.path,
            contents: data,
            attributes: [.posixPermissions: 0o600]
        ) else {
            throw CocoaError(.fileWriteUnknown)
        }
        defer { try? fileManager.removeItem(at: temporary) }

        if fileManager.fileExists(atPath: url.path) {
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            _ = try fileManager.replaceItemAt(url, withItemAt: temporary)
        } else {
            try fileManager.moveItem(at: temporary, to: url)
        }
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    // MARK: - Validation

    /// Returns nil when the server is valid, otherwise a human-readable message.
    static func validationError(_ server: McpServer) -> String? {
        let name = server.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "服务器名不能为空" }
        switch server.transport {
        case .stdio:
            if server.command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "stdio 服务器需要 command"
            }
        case .http:
            let url = server.url.trimmingCharacters(in: .whitespacesAndNewlines)
            if url.isEmpty { return "http 服务器需要 url" }
            if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
                return "url 必须以 http:// 或 https:// 开头"
            }
        }
        return nil
    }

    // MARK: - `${VAR}` interpolation

    /// Expand `${NAME}` references in a template using `variables`. A referenced but
    /// missing variable is a hard error (never silently left unresolved). Non-`${}`
    /// text is preserved verbatim.
    static func interpolate(_ template: String, variables: [String: String]) throws -> String {
        let pattern = #"\$\{([A-Za-z_][A-Za-z0-9_]*)\}"#
        let regex = try NSRegularExpression(pattern: pattern)
        let ns = template as NSString
        let range = NSRange(location: 0, length: ns.length)
        var result = ""
        var last = 0
        for match in regex.matches(in: template, range: range) {
            let name = ns.substring(with: match.range(at: 1))
            guard let value = variables[name] else {
                throw McpInterpolationError.missingVariable(name)
            }
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            result += value
            last = match.range.location + match.range.length
        }
        result += ns.substring(with: NSRange(location: last, length: ns.length - last))
        return result
    }

    /// Expand every value in a record (env/headers). Throws on the first missing var.
    static func interpolateRecord(
        _ record: [String: String],
        variables: [String: String]
    ) throws -> [String: String] {
        var out: [String: String] = [:]
        for (k, v) in record {
            out[k] = try interpolate(v, variables: variables)
        }
        return out
    }
}

// MARK: - App-side connection test (initialize + tools/list)

enum McpClientError: LocalizedError {
    case timeout(String)
    case protocolError(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .timeout(let m): return "请求超时（\(m)）"
        case .protocolError(let s): return "协议错误：\(s)"
        case .transport(let s): return s
        }
    }
}

/// Result of an App-side "测试连接": the discovered remote tool names, or an error.
struct McpConnectionTestResult: Sendable {
    var toolNames: [String] = []
    var error: String?

    var ok: Bool { error == nil }

    /// Human-readable summary for the settings UI.
    var display: String {
        if let error { return "❌ \(error)" }
        if toolNames.isEmpty { return "连接成功，但未发现任何工具。" }
        return "连接成功，发现工具：\(toolNames.joined(separator: ", "))"
    }
}

/// Shared client-info block for the MCP initialize handshake (mirrors the TS bridge).
private let mcpInitParams: [String: Any] = [
    "protocolVersion": "2024-11-05",
    "capabilities": [:],
    "clientInfo": ["name": "PipiUI", "version": "1.0"],
]

/// Minimal line-delimited JSON-RPC client over a spawned stdio subprocess.
private final class McpStdioSession {
    let writeHandle: FileHandle
    private var buffer = Data()
    private var pending: [Int: (Result<Any?, Error>) -> Void] = [:]
    private var nextId = 1
    private let queue = DispatchQueue(label: "mcp.stdio.session")

    init(writeHandle: FileHandle, readHandle: FileHandle) {
        self.writeHandle = writeHandle
        readHandle.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty else { return }
            self?.append(data)
        }
    }

    private func append(_ data: Data) {
        queue.sync {
            buffer.append(data)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: 0..<nl)
                buffer.removeSubrange(0...(nl + 1))
                guard let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let id = obj["id"] as? Int else { continue }
                if obj["result"] != nil {
                    pending.removeValue(forKey: id)?(.success(obj["result"]))
                } else if let err = obj["error"] as? [String: Any] {
                    let msg = err["message"] as? String ?? String(describing: err)
                    pending.removeValue(forKey: id)?(.failure(McpClientError.protocolError(msg)))
                }
            }
        }
    }

    func request(method: String, params: Any?, timeout: TimeInterval) async throws -> Any? {
        let id: Int = queue.sync {
            let v = nextId; nextId += 1; return v
        }
        var body: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method]
        if let params { body["params"] = params }
        let data = (try JSONSerialization.data(withJSONObject: body)) + Data("\n".utf8)
        try writeHandle.write(contentsOf: data)

        return try await withCheckedThrowingContinuation { cont in
            let handler: (Result<Any?, Error>) -> Void = { cont.resume(with: $0) }
            queue.sync { pending[id] = handler }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
                var h: ((Result<Any?, Error>) -> Void)?
                self?.queue.sync { h = self?.pending.removeValue(forKey: id) }
                if let h { h(.failure(McpClientError.timeout(method))) }
            }
        }
    }

    func close() {
        pending.values.forEach { $0(.failure(McpClientError.transport("连接已关闭"))) }
        pending.removeAll()
        writeHandle.closeFile()
    }
}

/// Parse a (possibly SSE-encoded) MCP HTTP response into its `result` (or nil).
private func mcpParseHttpResponse(_ data: Data) -> Any? {
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       obj["result"] != nil {
        return obj["result"]
    }
    if let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
       let last = arr.last, last["result"] != nil {
        return last["result"]
    }
    let text = String(data: data, encoding: .utf8) ?? ""
    var lastResult: Any?
    for line in text.components(separatedBy: "\n") {
        guard line.hasPrefix("data:") else { continue }
        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard let obj = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
              obj["result"] != nil else { continue }
        lastResult = obj["result"]
    }
    return lastResult
}

private func mcpToolNames(from result: Any?) -> [String] {
    guard let tools = (result as? [String: Any])?["tools"] as? [[String: Any]] else { return [] }
    return tools.compactMap { $0["name"] as? String }
}

extension McpServerSettings {
    /// Run initialize + notifications/initialized + tools/list against a server and
    /// return the discovered tool names, or throw a clear error. Used by the settings
    /// "测试连接" button. `variables` is the env map used for `${VAR}` expansion.
    static func discoverTools(
        _ server: McpServer,
        variables: [String: String]
    ) async throws -> [String] {
        switch server.transport {
        case .stdio: return try await stdioDiscoverTools(server, variables: variables)
        case .http: return try await httpDiscoverTools(server, variables: variables)
        }
    }

    static func testConnection(
        _ server: McpServer,
        variables: [String: String]
    ) async -> McpConnectionTestResult {
        if let err = validationError(server) {
            return McpConnectionTestResult(error: err)
        }
        do {
            let tools = try await discoverTools(server, variables: variables)
            return McpConnectionTestResult(toolNames: tools)
        } catch {
            return McpConnectionTestResult(error: error.localizedDescription)
        }
    }

    private static func stdioDiscoverTools(
        _ server: McpServer,
        variables: [String: String]
    ) async throws -> [String] {
        let command = server.command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { throw McpClientError.transport("stdio 服务器缺少 command") }

        var env = ProcessInfo.processInfo.environment
        do {
            for (k, v) in server.env {
                env[k] = try interpolate(v, variables: variables)
            }
        } catch {
            throw McpClientError.transport(error.localizedDescription)
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        proc.arguments = [command] + server.args
        proc.environment = env
        let stdin = Pipe()
        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardInput = stdin
        proc.standardOutput = stdout
        proc.standardError = stderr
        try proc.run()

        let stderrRead = stderr.fileHandleForReading
        var stderrText = ""
        stderrRead.readabilityHandler = { h in
            let d = h.availableData
            if !d.isEmpty { stderrText = String(data: d, encoding: .utf8) ?? "" }
        }

        let session = McpStdioSession(
            writeHandle: stdin.fileHandleForWriting,
            readHandle: stdout.fileHandleForReading
        )
        defer {
            session.close()
            if proc.isRunning { proc.terminate() }
        }

        do {
            _ = try await session.request(method: "initialize", params: mcpInitParams, timeout: 15)
            _ = try? await session.request(method: "notifications/initialized", params: nil, timeout: 5)
            let list = try await session.request(method: "tools/list", params: nil, timeout: 15)
            return mcpToolNames(from: list)
        } catch {
            let tail = stderrText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty {
                throw McpClientError.transport("\(error.localizedDescription)（stderr: \(tail.prefix(200))）")
            }
            throw error
        }
    }

    private static func httpDiscoverTools(
        _ server: McpServer,
        variables: [String: String]
    ) async throws -> [String] {
        guard let url = URL(string: server.url.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw McpClientError.transport("无效的 url：\(server.url)")
        }
        var headers: [String: String]
        do {
            headers = try interpolateRecord(server.headers, variables: variables)
        } catch {
            throw McpClientError.transport(error.localizedDescription)
        }

        let session = URLSession(configuration: .ephemeral)
        var sessionId: String?

        func post(_ method: String, _ params: Any?) async throws -> Any? {
            var body: [String: Any] = ["jsonrpc": "2.0", "method": method]
            if let params { body["params"] = params }
            if method != "notifications/initialized" {
                body["id"] = Int.random(in: 1..<Int.max)
            }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
            for (k, v) in headers where !v.isEmpty {
                req.setValue(v, forHTTPHeaderField: k)
            }
            if let sid = sessionId { req.setValue(sid, forHTTPHeaderField: "Mcp-Session-Id") }
            req.timeoutInterval = 15
            req.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (data, resp) = try await session.data(for: req)
            if let sid = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Mcp-Session-Id") {
                sessionId = sid
            }
            guard let status = (resp as? HTTPURLResponse)?.statusCode, status == 200 else {
                let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                let snippet = String(data: data, encoding: .utf8)?.prefix(200) ?? ""
                throw McpClientError.transport("HTTP \(code)：\(snippet)")
            }
            return mcpParseHttpResponse(data)
        }

        _ = try await post("initialize", mcpInitParams)
        _ = try? await post("notifications/initialized", nil)
        let list = try await post("tools/list", nil)
        return mcpToolNames(from: list)
    }
}

enum McpInterpolationError: LocalizedError {
    case missingVariable(String)

    var errorDescription: String? {
        switch self {
        case .missingVariable(let name):
            return "配置引用了 ${\(name)}，但环境变量 \(name) 未设置（来自 ~/.pi/agent/.env 或进程环境）"
        }
    }
}
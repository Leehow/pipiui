import Foundation

/// Web search tool configuration: backend selection + per-backend API keys.
///
/// T19 (.env 方案):
/// - Backend 选择仍走 UserDefaults + JSON 热读镜像（不变）。
/// - 各后端 API key 统一写入 `~/.pi/agent/.env`（键名见
///   `ProviderEnvMap.searchEnvVars`），不再做 UserDefaults/JSON 双写。
/// - UI 层约定：输入框永不回显已存值；留空 = 不修改；传 nil/空白 = 删除。
/// The TS extension hot-reads the JSON mirror (backend) and .env (keys) at
/// execution time — no session restart needed.
enum WebSearchSettings {
    static let backendKey = "pipiui.webSearch.backend"
    static let defaultBackend = "browser"

    static let availableBackends = ["browser", "tavily", "brave", "serpapi", "exa", "kimi", "duckduckgo"]

    /// 共享的 .env 存取实例（默认路径 `~/.pi/agent/.env`）。
    static let defaultEnvStore = EnvFileStore()

    // MARK: - Backend selection (unchanged: UserDefaults + JSON mirror)

    static func backend(defaults: UserDefaults = .standard) -> String {
        let raw = defaults.string(forKey: backendKey) ?? ""
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? defaultBackend : trimmed
    }

    static func setBackend(_ value: String, defaults: UserDefaults = .standard, fileManager: FileManager = .default) {
        defaults.set(value, forKey: backendKey)
        syncJSONFile(defaults: defaults, fileManager: fileManager)
    }

    // MARK: - API keys (.env)

    /// 该后端 key 在 .env 中的键名；duckduckgo 等无需 key 的后端返回 nil。
    static func envVar(for backend: String) -> String? {
        ProviderEnvMap.searchEnvVars[backend]
    }

    /// 是否已在 .env 配置该后端的 key（仅用于 placeholder，不回显值）。
    /// Kimi 还可复用 `auth.json` 的 `kimi-coding` 凭据（与配额同源）。
    static func isKeyConfigured(
        for backend: String,
        store: EnvFileStore = defaultEnvStore,
        kimiAuthURL: URL? = nil
    ) -> Bool {
        if backend == "kimi" {
            if store.isConfigured(forKey: "KIMI_API_KEY")
                || store.isConfigured(forKey: "KIMI_CODE_API_KEY")
                || store.isConfigured(forKey: "KIMI_SEARCH_API_KEY")
            {
                return true
            }
            let authURL = kimiAuthURL ?? KimiAuthStore.defaultAuthURL()
            return KimiAuthStore.loadFromPiAuth(authURL: authURL) != nil
        }
        guard let envVar = envVar(for: backend) else { return false }
        return store.isConfigured(forKey: envVar)
    }

    /// 写入/替换该后端的 key；传 nil 或空白字符串 = 从 .env 移除。
    /// 返回 false 表示该后端无对应 .env 键名（未做任何修改）。
    @discardableResult
    static func setApiKey(
        _ key: String?,
        for backend: String,
        store: EnvFileStore = defaultEnvStore
    ) throws -> Bool {
        guard let envVar = envVar(for: backend) else { return false }
        let trimmed = key?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            try store.removeSync(forKey: envVar)
        } else {
            try store.setSync(trimmed, forKey: envVar)
        }
        return true
    }

    // MARK: - Hot-read JSON mirror (backend only)

    static func configFileURL(fileManager: FileManager = .default) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("websearch-config.json")
    }

    /// JSON 镜像内容（T19 起只含 backend；key 一律从 .env 热读）。
    static func jsonPayload(defaults: UserDefaults = .standard) -> [String: Any] {
        ["backend": backend(defaults: defaults)]
    }

    static func syncJSONFile(
        defaults: UserDefaults = .standard,
        fileManager: FileManager = .default,
        to explicitURL: URL? = nil
    ) {
        // Only the live app may write the shared file. A suite mirroring its own (usually
        // unset, therefore default) backend resets the user's real choice, and the failure is
        // invisible: the Settings panel keeps showing Tavily because the selection lives in
        // UserDefaults, while every search silently runs on the default backend. Same guard,
        // same reason as ToolSkillSettings and SubagentModelSettings. An explicit `to:` is a
        // caller-chosen target and always honoured.
        guard SharedConfigWriteGuard.mayWriteSharedFile(explicitURL: explicitURL) else { return }
        let url = explicitURL ?? configFileURL(fileManager: fileManager)
        let dir = url.deletingLastPathComponent()
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: jsonPayload(defaults: defaults), options: [.prettyPrinted, .sortedKeys]) else {
            return
        }
        try? data.write(to: url, options: .atomic)
        try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    // MARK: - Native search detection

    /// Whether the given model has server-side web search
    /// (Grok/xAI, GLM/Zhipu, official openai-codex, official Anthropic Claude).
    /// When true, the web_search tool skips execution to avoid redundancy.
    static func isNativeSearchModel(provider: String, modelId: String = "") -> Bool {
        let p = provider.lowercased()
        let m = modelId.lowercased()
        if p == "xai" || p.contains("grok") || m.contains("grok") { return true }
        if p.contains("zai") || p.contains("zhipu") || p.contains("bigmodel") || m.contains("glm") { return true }
        // Official ChatGPT Codex Responses (`openai-codex` OAuth) — hosted web_search
        // is injected by CodexServerToolsExtension. coding-relay is opt-in via -search/-all.
        if p == "openai-codex" || p.contains("openai-codex") { return true }
        // Official Anthropic Messages API — server tool injected by ClaudeServerToolsExtension.
        if p == "anthropic" || p.contains("anthropic") || p.contains("claude") { return true }
        return false
    }
}

import Foundation

/// Web search tool configuration: Firecrawl keyless search (single backend, no API keys).
///
/// Backend selection still goes through UserDefaults + JSON hot-read mirror for
/// compatibility, but is fixed to "firecrawl". The TS extension always uses
/// Firecrawl keyless search — no key needed, no session restart required.
enum WebSearchSettings {
    static let backendKey = "pipiui.webSearch.backend"
    static let defaultBackend = "firecrawl"

    static let availableBackends = ["firecrawl"]

    // MARK: - Backend selection (fixed to firecrawl)

    static func backend(defaults: UserDefaults = .standard) -> String {
        // Ignore any persisted/user-set value; only "firecrawl" is supported now.
        let _ = defaults.string(forKey: backendKey)
        return defaultBackend
    }

    static func setBackend(_ value: String, defaults: UserDefaults = .standard, fileManager: FileManager = .default) {
        defaults.set(value, forKey: backendKey)
        syncJSONFile(defaults: defaults, fileManager: fileManager)
    }

    // MARK: - API keys (removed — Firecrawl is keyless)

    /// Firecrawl keyless search needs no API key; always nil.
    static func envVar(for backend: String) -> String? {
        nil
    }

    /// Firecrawl keyless search needs no API key; always false.
    static func isKeyConfigured(
        for backend: String,
        store: EnvFileStore
    ) -> Bool {
        false
    }

    /// Firecrawl keyless search needs no API key; reported as not writable.
    @discardableResult
    static func setApiKey(
        _ key: String?,
        for backend: String,
        store: EnvFileStore
    ) throws -> Bool {
        false
    }

    // MARK: - Hot-read JSON mirror (backend only)

    static func configFileURL(fileManager: FileManager = .default) -> URL {
        let dir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
        return dir.appendingPathComponent("websearch-config.json")
    }

    /// JSON 镜像内容（只含 backend；固定 firecrawl）。
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

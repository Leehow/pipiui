import XCTest
@testable import PipiUI

final class WebSearchSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.webSearch.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    func testOnlyFirecrawlBackend() {
        XCTAssertEqual(WebSearchSettings.defaultBackend, "firecrawl")
        XCTAssertEqual(WebSearchSettings.availableBackends, ["firecrawl"])
    }

    func testBackendIsFixedToFirecrawlRegardlessOfPersistedValue() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        // Even a stale persisted backend is ignored — only firecrawl is supported.
        suite.set("tavily", forKey: WebSearchSettings.backendKey)
        XCTAssertEqual(WebSearchSettings.backend(defaults: suite), "firecrawl")
        suite.set("  ", forKey: WebSearchSettings.backendKey)
        XCTAssertEqual(WebSearchSettings.backend(defaults: suite), "firecrawl")
    }

    func testNoApiKeyForFirecrawl() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-env-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = EnvFileStore(fileURL: dir.appendingPathComponent(".env"))

        // Keyless: no env var, never considered configured, setApiKey is a no-op.
        XCTAssertNil(WebSearchSettings.envVar(for: "firecrawl"))
        XCTAssertFalse(WebSearchSettings.isKeyConfigured(for: "firecrawl", store: store))
        XCTAssertFalse(try WebSearchSettings.setApiKey("x", for: "firecrawl", store: store))
        XCTAssertNil(store.value(forKey: "TAVILY_API_KEY"))
    }

    func testSyncJSONFileBackendOnlyFirecrawl() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set("brave", forKey: WebSearchSettings.backendKey)
        let payload = WebSearchSettings.jsonPayload(defaults: suite)
        XCTAssertEqual(payload["backend"] as? String, "firecrawl")
        XCTAssertNil(payload["keys"], "keys no longer exist in the JSON mirror")
    }

    // MARK: - Generated TS contract

    private func generatedSource() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(WebSearchExtension.install(into: dir))
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    /// web_search is Firecrawl keyless: the generated TS must call the Firecrawl
    /// endpoint and must NOT contain any of the removed search backends.
    func testGeneratedTSIsFirecrawlOnly() throws {
        let source = try generatedSource()

        XCTAssertTrue(source.contains("https://api.firecrawl.dev/v2/search"), "must call the Firecrawl endpoint")
        XCTAssertTrue(source.contains(#"JSON.stringify({ query, limit: maxResults })"#), "limit maps max_results")
        XCTAssertTrue(source.contains("data.data?.web"), "must read data.web[]")
        XCTAssertTrue(source.contains(#"snippet: r.description || r.snippet || ""#), "snippet maps description")
        XCTAssertTrue(source.contains("web_search failed (firecrawl)"), "errors must be loud + labelled")

        // No removed backends remain as search implementations.
        for needle in ["searchTavily", "searchBrave", "searchSerpApi", "searchExa", "searchKimi",
                       "searchDuckDuckGo", "searchViaBuiltInBrowser", "tavily", "brave", "serpapi",
                       "duckduckgo", "api.tavily.com", "api.search.brave.com", "serpapi.com",
                       "api.exa.ai", "api.kimi.com/coding/v1/search", "lite.duckduckgo.com"] {
            XCTAssertFalse(source.contains(needle), "removed backend leaked into TS: \(needle)")
        }
    }

    /// The web_search tool's parameter shape (query / max_results / force) must be unchanged.
    func testWebSearchParameterShapeIsUnchanged() throws {
        let source = try generatedSource()
        XCTAssertTrue(source.contains(#"query: Type.String({"#))
        XCTAssertTrue(source.contains("max_results: Type.Optional("))
        XCTAssertTrue(source.contains("force: Type.Optional("))
        XCTAssertTrue(source.contains("hasNativeSearch(model) && !params.force"), "native-skip gate preserved")
    }

    // MARK: - web_fetch generated TS contract

    func testWebFetchHTMLExtractionContract() throws {
        let source = try generatedSource()

        // The small converter must preserve readable article structure while removing chrome.
        for needle in ["function htmlToMarkdown", "function findContainer", "name === \"article\"",
                       "name === \"main\"", "role\\s*=\\s*[\"']main", "NOISE_TAGS",
                       "\"script\", \"style\", \"noscript\", \"svg\", \"nav\", \"header\", \"footer\", \"aside\"",
                       "\"#\".repeat(Number(name[1]))", "name === \"li\"", "name === \"blockquote\"",
                       "name === \"pre\"", "name === \"code\"", "name === \"a\"", "href"] {
            XCTAssertTrue(source.contains(needle), "web_fetch extraction contract missing: \(needle)")
        }
        XCTAssertTrue(source.contains("decodeEntities"), "Chinese and entity text must not be ASCII-stripped")
        XCTAssertTrue(source.contains("const tokens = /<!--[\\s\\S]*?-->|<[^>]*>/g"), "comments must be tokenized away")
    }

    func testWebFetchRSCAndHTTPBoundaryContract() throws {
        let source = try generatedSource()

        for needle in ["function extractRSCText", "self\\.__next_f\\.push", "body.replace(/\\s/g, \"\").length < 80",
                       "MAX_RESPONSE_BYTES = 5 * 1024 * 1024", "function readTextWithLimit",
                       "size > MAX_RESPONSE_BYTES", "new URL(url)",
                       "parsed.protocol !== \"http:\" && parsed.protocol !== \"https:\"",
                       "request timed out (30s)", "HTTP ${res.status}",
                       "text/plain, JSON, and XML are intentionally returned directly", "[truncated]"] {
            XCTAssertTrue(source.contains(needle), "web_fetch boundary/fallback contract missing: \(needle)")
        }
    }

    func testWebFetchParameterCompatibilityIsPreserved() throws {
        let source = try generatedSource()
        XCTAssertTrue(source.contains("name: \"web_fetch\""))
        XCTAssertTrue(source.contains("url: Type.String("))
        XCTAssertTrue(source.contains("max_length: Type.Optional("))
        XCTAssertTrue(source.contains("Math.min(Math.max(Math.round(params.max_length || 20000), 1000), 100000)"))
    }

    /// Generic web_fetch must not carry the specialized GitHub parser, APIs, clone
    /// machinery, or fallback route. It may only teach the caller which tool to use.
    func testWebFetchCoreHasNoGitHubSpecializedRouter() throws {
        let source = try generatedSource()
        for forbidden in ["type GitHubTarget", "parseGitHubCodeURL", "fetchGitHubCode",
                          "fetchGitHubBlob", "fetchGitHubRepoOrTree", "GITHUB_TOTAL_BUDGET_MS",
                          "api.github.com/repos/", "node:child_process", "githubHeaders", "Git LFS pointer"] {
            XCTAssertFalse(source.contains(forbidden), "GitHub implementation leaked into web core: \(forbidden)")
        }
        XCTAssertEqual(source.components(separatedBy: "name: \"web_fetch\"").count - 1, 1)
        XCTAssertTrue(source.contains("async function fetchGenericWebURL"),
                      "generic HTTP/HTML/RSC/text/json/xml fetch remains owned by web_fetch")
        XCTAssertTrue(source.contains("Use github_fetch instead for GitHub repository roots"),
                      "web_fetch must route repo/blob/tree intent to the independent package")
    }

    // MARK: - Native search detection

    func testNativeSearchGrok() {
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "xai"))
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "xai", modelId: "grok-4.5"))
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "grok-relay"))
    }

    func testNativeSearchGLM() {
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "zhipu"))
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "openai", modelId: "glm-4.5"))
    }

    func testNativeSearchOpenAICodex() {
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "openai-codex"))
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "openai-codex", modelId: "gpt-5.4"))
    }

    func testNativeSearchAnthropicClaude() {
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "anthropic"))
        XCTAssertTrue(WebSearchSettings.isNativeSearchModel(provider: "anthropic", modelId: "claude-sonnet-4-6"))
    }

    func testNonNativeSearch() {
        XCTAssertFalse(WebSearchSettings.isNativeSearchModel(provider: "openai", modelId: "gpt-4.1"))
        XCTAssertFalse(WebSearchSettings.isNativeSearchModel(provider: "coding-relay", modelId: "gpt-5.4"))
        XCTAssertFalse(WebSearchSettings.isNativeSearchModel(provider: "kimi-coding", modelId: "kimi-k2"))
    }

    /// Native-search detection is a guess from the provider and model name, so the skip must be
    /// recoverable via `force`.
    func testNativeSearchSkipIsRecoverableSoAWrongGuessIsNotFatal() throws {
        let source = try generatedSource()
        XCTAssertTrue(source.contains("hasNativeSearch(model) && !params.force"),
                      "force must bypass the guess")
        XCTAssertTrue(source.contains("force: Type.Optional("), "the escape has to be callable")
        XCTAssertTrue(source.contains("call web_search again"),
                      "the skip message must tell the caller how to recover")
        XCTAssertFalse(source.contains("Use your built-in search capability directly instead of this tool."))
    }

    /// A test suite must not rewrite the user's shared search config (only the live app may).
    func testOnlyLiveAppDefaultsMayWriteTheSharedSearchConfig() throws {
        let suite = "pipiui.test.websearch-guard.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let shared = WebSearchSettings.configFileURL()
        let before = try? Data(contentsOf: shared)

        WebSearchSettings.setBackend("firecrawl", defaults: defaults)
        WebSearchSettings.syncJSONFile(defaults: defaults)

        XCTAssertEqual(before, try? Data(contentsOf: shared),
                       "a test suite must not rewrite the user's search backend")
        XCTAssertEqual(WebSearchSettings.backend(defaults: defaults), "firecrawl")

        let own = FileManager.default.temporaryDirectory
            .appendingPathComponent("websearch-\(UUID().uuidString).json")
        addTeardownBlock { try? FileManager.default.removeItem(at: own) }
        WebSearchSettings.syncJSONFile(defaults: defaults, to: own)
        XCTAssertTrue(FileManager.default.fileExists(atPath: own.path))
    }
}
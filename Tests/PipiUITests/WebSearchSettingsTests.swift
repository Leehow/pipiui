import XCTest
@testable import PipiUI

final class WebSearchSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.webSearch.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    func testDefaultBackendIsDuckDuckGo() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        XCTAssertEqual(WebSearchSettings.backend(defaults: suite), "duckduckgo")
    }

    func testSetAndGetBackend() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set("tavily", forKey: WebSearchSettings.backendKey)
        XCTAssertEqual(WebSearchSettings.backend(defaults: suite), "tavily")
    }

    func testEmptyBackendFallsBackToDefault() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set("  ", forKey: WebSearchSettings.backendKey)
        XCTAssertEqual(WebSearchSettings.backend(defaults: suite), "duckduckgo")
    }

    func testApiKeyRoundTripViaEnvStore() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-env-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = EnvFileStore(fileURL: dir.appendingPathComponent(".env"))

        XCTAssertFalse(WebSearchSettings.isKeyConfigured(for: "tavily", store: store))
        XCTAssertTrue(try WebSearchSettings.setApiKey("tvly-abc123", for: "tavily", store: store))
        XCTAssertTrue(WebSearchSettings.isKeyConfigured(for: "tavily", store: store))
        XCTAssertEqual(store.value(forKey: "TAVILY_API_KEY"), "tvly-abc123")

        XCTAssertTrue(try WebSearchSettings.setApiKey(nil, for: "tavily", store: store))
        XCTAssertFalse(WebSearchSettings.isKeyConfigured(for: "tavily", store: store))
    }

    func testDuckDuckGoHasNoEnvVar() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-env-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = EnvFileStore(fileURL: dir.appendingPathComponent(".env"))
        XCTAssertNil(WebSearchSettings.envVar(for: "duckduckgo"))
        XCTAssertFalse(try WebSearchSettings.setApiKey("x", for: "duckduckgo", store: store))
    }

    func testKimiBackendIsAvailableAndMapsToKimiAPIKey() {
        XCTAssertTrue(WebSearchSettings.availableBackends.contains("kimi"))
        XCTAssertEqual(WebSearchSettings.envVar(for: "kimi"), "KIMI_API_KEY")
        XCTAssertEqual(ProviderEnvMap.searchEnvVars["kimi"], "KIMI_API_KEY")
    }

    func testKimiKeyConfiguredViaEnvStore() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-kimi-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = EnvFileStore(fileURL: dir.appendingPathComponent(".env"))
        // Missing auth.json + empty env → not configured.
        let missingAuth = dir.appendingPathComponent("missing-auth.json")
        XCTAssertFalse(
            WebSearchSettings.isKeyConfigured(for: "kimi", store: store, kimiAuthURL: missingAuth)
        )
        XCTAssertTrue(try WebSearchSettings.setApiKey("kimi-key-1", for: "kimi", store: store))
        XCTAssertTrue(
            WebSearchSettings.isKeyConfigured(for: "kimi", store: store, kimiAuthURL: missingAuth)
        )
    }

    func testKimiKeyConfiguredViaAuthJSON() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-ws-kimi-auth-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = EnvFileStore(fileURL: dir.appendingPathComponent(".env"))
        let authURL = dir.appendingPathComponent("auth.json")
        let payload: [String: Any] = [
            "kimi-coding": ["type": "api_key", "key": "from-auth-json"],
        ]
        try JSONSerialization.data(withJSONObject: payload).write(to: authURL)
        XCTAssertTrue(
            WebSearchSettings.isKeyConfigured(for: "kimi", store: store, kimiAuthURL: authURL)
        )
    }

    func testSyncJSONFileBackendOnly() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set("brave", forKey: WebSearchSettings.backendKey)
        let payload = WebSearchSettings.jsonPayload(defaults: suite)
        XCTAssertEqual(payload["backend"] as? String, "brave")
        XCTAssertNil(payload["keys"], "T19: keys live in .env, not JSON mirror")
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
        // coding-relay needs an explicit -search/-all suffix; do not treat as always-on native.
        XCTAssertFalse(WebSearchSettings.isNativeSearchModel(provider: "coding-relay", modelId: "gpt-5.4"))
        XCTAssertFalse(WebSearchSettings.isNativeSearchModel(provider: "kimi-coding", modelId: "kimi-k2"))
    }
}

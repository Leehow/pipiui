import XCTest
@testable import PipiUI

final class ModelSettingsTests: XCTestCase {
    private func tempAuthURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-auth-\(UUID().uuidString).json")
    }

    private func sampleModels() -> [ModelInfo] {
        [
            ModelInfo(provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Sonnet", contextWindow: 200_000),
            ModelInfo(provider: "anthropic", modelId: "claude-opus-4-6", name: "Opus", contextWindow: 200_000),
            ModelInfo(provider: "xai", modelId: "grok-4", name: "Grok 4", contextWindow: 128_000),
        ]
    }

    func testVisibilityOptOutFiltersPicker() {
        let suiteName = "pipiui.test.vis.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        defer { suite.removePersistentDomain(forName: suiteName) }

        let all = sampleModels()
        XCTAssertEqual(ModelVisibility.pickerModels(from: all, selectedId: nil, defaults: suite).count, 3)

        ModelVisibility.setHidden(true, modelId: "anthropic/claude-opus-4-6", defaults: suite)
        let filtered = ModelVisibility.pickerModels(from: all, selectedId: nil, defaults: suite)
        XCTAssertEqual(filtered.map(\.id), ["anthropic/claude-sonnet-4-6", "xai/grok-4"])

        // Selected hidden model still appears.
        let withSelected = ModelVisibility.pickerModels(
            from: all,
            selectedId: "anthropic/claude-opus-4-6",
            defaults: suite
        )
        XCTAssertTrue(withSelected.contains(where: { $0.id == "anthropic/claude-opus-4-6" }))

        ModelVisibility.setHidden(false, modelId: "anthropic/claude-opus-4-6", defaults: suite)
        XCTAssertEqual(ModelVisibility.pickerModels(from: all, selectedId: nil, defaults: suite).count, 3)
    }

    func testPickerProvidersFollowVisibility() {
        let suiteName = "pipiui.test.prov.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        defer { suite.removePersistentDomain(forName: suiteName) }

        let all = sampleModels()
        ModelVisibility.setHidden(true, modelId: "xai/grok-4", defaults: suite)
        XCTAssertEqual(
            ModelVisibility.pickerProviders(from: all, selectedId: nil, defaults: suite),
            ["anthropic"]
        )
    }

    func testAuthStoreSetListDelete() throws {
        let url = tempAuthURL()
        defer { try? FileManager.default.removeItem(at: url) }

        try PiAuthStore.setAPIKey(providerId: "openai", key: " sk-test-key ", authURL: url)
        let listed = PiAuthStore.list(authURL: url)
        XCTAssertEqual(listed.map(\.providerId), ["openai"])
        XCTAssertEqual(listed.first?.type, "api_key")

        let data = try Data(contentsOf: url)
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let entry = root?["openai"] as? [String: Any]
        XCTAssertEqual(entry?["type"] as? String, "api_key")
        XCTAssertEqual(entry?["key"] as? String, "sk-test-key")

        XCTAssertTrue(try PiAuthStore.delete(providerId: "openai", authURL: url))
        XCTAssertTrue(PiAuthStore.list(authURL: url).isEmpty)
        XCTAssertFalse(try PiAuthStore.delete(providerId: "openai", authURL: url))
    }

    func testAuthStoreRejectsEmptyKey() {
        let url = tempAuthURL()
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try PiAuthStore.setAPIKey(providerId: "openai", key: "  ", authURL: url))
    }
}

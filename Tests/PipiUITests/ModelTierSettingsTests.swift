import XCTest
@testable import PipiUI

/// Model tiering drives how hard a session leans on Superpowers: strong models get a
/// pointer, weak models get a mandatory SOP plus a one-shot dispatch gate.
final class ModelTierSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.tier.tests.\(UUID().uuidString)"
        return (name, UserDefaults(suiteName: name)!)
    }

    /// Opt-in denylist: an unmarked model must be treated as strong, so a fresh install
    /// changes nothing until the user actually marks something.
    func testUnmarkedModelIsStrong() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        XCTAssertFalse(ModelTierSettings.isWeak("kimi-coding/k3-256k", defaults: suite))
        XCTAssertFalse(ModelTierSettings.isWeak(nil, defaults: suite))
        XCTAssertFalse(ModelTierSettings.isWeak("", defaults: suite))
    }

    func testMarkWeakRoundTrips() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        ModelTierSettings.setWeak(true, modelId: "some-provider/small-model", defaults: suite)
        XCTAssertTrue(ModelTierSettings.isWeak("some-provider/small-model", defaults: suite))
        // Sibling models under the same provider are unaffected — tiering is per model.
        XCTAssertFalse(ModelTierSettings.isWeak("some-provider/big-model", defaults: suite))

        ModelTierSettings.setWeak(false, modelId: "some-provider/small-model", defaults: suite)
        XCTAssertFalse(ModelTierSettings.isWeak("some-provider/small-model", defaults: suite))
    }

    /// The extension hot-reads this file, so its shape is a contract.
    func testSyncJSONFileShape() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("tiers-\(UUID().uuidString).json")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }

        ModelTierSettings.setWeak(true, modelId: "p/b", defaults: suite)
        ModelTierSettings.setWeak(true, modelId: "p/a", defaults: suite)
        XCTAssertTrue(ModelTierSettings.syncJSONFile(defaults: suite, to: url))

        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        let weak = try XCTUnwrap((json as? [String: Any])?["weakModels"] as? [String])
        XCTAssertEqual(weak, ["p/a", "p/b"], "sorted for stable diffs")
    }

    /// Tier text is a pure function of the active model, which is what makes it safe to
    /// append to the system prompt: identical every turn, changing only on a model switch
    /// (which already invalidates the cache on its own).
    func testTierExtensionShipsBothTiersAndNoModelTable() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-tier-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(SkillTierExtension.install(into: dir))
        let source = try String(contentsOfFile: path, encoding: .utf8)

        XCTAssertTrue(source.contains("Superpowers (reference)"))
        XCTAssertTrue(source.contains("Superpowers (mandatory for this model)"))
        // Tiers come from user settings only. A built-in table would go stale and would
        // silently change how a whole session is run.
        for vendor in ["gpt-", "claude-", "gemini", "glm-", "grok", "k3", "qwen", "deepseek"] {
            XCTAssertFalse(source.lowercased().contains(vendor),
                           "no built-in model table allowed (found \(vendor))")
        }
        // The dispatch gate must be capped at one block per session.
        XCTAssertTrue(source.contains("gateFired"))
        XCTAssertTrue(source.contains("if (gateFired || skillWasRead || !isWeak(ctx.model)) return;"))
    }

    /// The boss prompt hands the Superpowers rules to the tier extension; keeping a second
    /// copy there would both cost prefix tokens and let the two drift apart.
    func testBossPromptDefersSuperpowersToTierExtension() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-boss-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let text = try String(contentsOfFile: try XCTUnwrap(BossPrompt.install(into: dir)),
                              encoding: .utf8)
        XCTAssertTrue(text.contains("Superpowers section appended below"))
        XCTAssertFalse(text.contains("dispatching-parallel-agents"),
                       "per-skill routing now lives in the tier extension")
    }
}

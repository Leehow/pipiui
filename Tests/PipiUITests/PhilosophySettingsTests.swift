import XCTest
@testable import PipiUI

/// The Swift half of the philosophy: package registration in pi's own settings, and the
/// config/catalog the Settings panel drives.
final class PhilosophySettingsTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-philosophy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { [dir] in try? FileManager.default.removeItem(at: dir!) }
    }

    private var settingsURL: URL { dir.appendingPathComponent("settings.json") }
    private var configURL: URL { dir.appendingPathComponent("philosophy.json") }

    private func writeSettings(_ json: String) throws {
        try json.write(to: settingsURL, atomically: true, encoding: .utf8)
    }

    private func readSettings() throws -> [String: Any] {
        let data = try Data(contentsOf: settingsURL)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: - Registration

    func testRegisterAddsPackageAndIsIdempotent() throws {
        XCTAssertEqual(PhilosophyPackage.registration(settingsURL: settingsURL), .notRegistered)
        try PhilosophyPackage.register(settingsURL: settingsURL)
        XCTAssertEqual(PhilosophyPackage.registration(settingsURL: settingsURL), .registered)

        try PhilosophyPackage.register(settingsURL: settingsURL)
        let packages = try XCTUnwrap(readSettings()["packages"] as? [String])
        XCTAssertEqual(packages.filter { $0 == PhilosophyPackage.installedURL.path }.count, 1,
                       "re-registering must not duplicate the entry")
    }

    /// This file belongs to the user and pi is its primary owner: only `packages` may change.
    func testRegisterPreservesEveryOtherKey() throws {
        try writeSettings("""
        {
          "defaultModel": "grok-4.5",
          "extensions": ["/tmp/a.ts", "-/tmp/b.ts"],
          "packages": ["npm:pi-provider-qoder"],
          "theme": "light"
        }
        """)
        try PhilosophyPackage.register(settingsURL: settingsURL)
        let settings = try readSettings()
        XCTAssertEqual(settings["defaultModel"] as? String, "grok-4.5")
        XCTAssertEqual(settings["extensions"] as? [String], ["/tmp/a.ts", "-/tmp/b.ts"])
        XCTAssertEqual(settings["theme"] as? String, "light")
        let packages = try XCTUnwrap(settings["packages"] as? [String])
        XCTAssertEqual(packages.first, "npm:pi-provider-qoder", "existing packages keep their order")
        XCTAssertTrue(packages.contains(PhilosophyPackage.installedURL.path))
    }

    func testUnregisterRemovesOnlyOurEntry() throws {
        try writeSettings(#"{"packages": ["npm:keep-me"]}"#)
        try PhilosophyPackage.register(settingsURL: settingsURL)
        try PhilosophyPackage.unregister(settingsURL: settingsURL)
        XCTAssertEqual(try readSettings()["packages"] as? [String], ["npm:keep-me"])
        XCTAssertEqual(PhilosophyPackage.registration(settingsURL: settingsURL), .notRegistered)
    }

    /// A settings file we cannot parse must never be overwritten — the user's config is not
    /// ours to reset, and a bad write here breaks every pi session on the machine.
    func testUnparseableSettingsIsReportedAndNeverOverwritten() throws {
        try writeSettings("{ this is not json")
        guard case .unreadable = PhilosophyPackage.registration(settingsURL: settingsURL) else {
            return XCTFail("expected .unreadable")
        }
        XCTAssertThrowsError(try PhilosophyPackage.register(settingsURL: settingsURL))
        XCTAssertEqual(try String(contentsOf: settingsURL, encoding: .utf8), "{ this is not json")
    }

    /// A `{ "source": ... }` entry is a legal package spelling; missing it would make the App
    /// append a duplicate on every launch.
    func testRegistrationRecognizesObjectFormEntries() throws {
        let escaped = PhilosophyPackage.installedURL.path
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        try writeSettings(#"{"packages": [{"source": "\#(escaped)"}]}"#)
        XCTAssertEqual(PhilosophyPackage.registration(settingsURL: settingsURL), .registered)
    }

    // MARK: - Config

    func testLayerTogglesRoundTripAndUnknownKeysSurvive() throws {
        try #"{"version": 1, "scopes": {"worker": true}, "userDir": "~/mine"}"#
            .write(to: configURL, atomically: true, encoding: .utf8)

        XCTAssertTrue(PhilosophySettings.isLayerEnabled("fanout", configURL: configURL),
                      "a layer with no entry defaults to on")
        PhilosophySettings.setLayerEnabled(false, id: "fanout", configURL: configURL)
        XCTAssertFalse(PhilosophySettings.isLayerEnabled("fanout", configURL: configURL))
        XCTAssertTrue(PhilosophySettings.isLayerEnabled("orchestration", configURL: configURL))

        // `scopes` and `userDir` belong to the package, not to this panel.
        let data = try Data(contentsOf: configURL)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((json["scopes"] as? [String: Any])?["worker"] as? Bool, true)
        XCTAssertEqual(json["userDir"] as? String, "~/mine")
    }

    /// The panel must not claim a layer is active when the composer would drop it for an
    /// unmet dependency.
    func testDependencyIsAppliedToEffectiveState() throws {
        let catalog = try PhilosophyLayerFixture.layers()
        let fanout = try XCTUnwrap(catalog.first { $0.id == "fanout" })
        XCTAssertTrue(PhilosophySettings.isLayerActive(fanout, in: catalog, configURL: configURL))

        PhilosophySettings.setLayerEnabled(false, id: "orchestration", configURL: configURL)
        XCTAssertFalse(PhilosophySettings.isLayerActive(fanout, in: catalog, configURL: configURL),
                       "fanout requires orchestration")

        PhilosophySettings.setEnabled(false, configURL: configURL)
        let foundation = try XCTUnwrap(catalog.first { $0.id == "foundation" })
        XCTAssertFalse(PhilosophySettings.isLayerActive(foundation, in: catalog, configURL: configURL))
    }

    // MARK: - Migration

    /// Deliberately asymmetric: the old single switch maps onto the two delegation layers only.
    /// Being unable to keep the judgement rules without also taking the dispatch protocol was
    /// the defect the split exists to fix, so foundation/method stay on for everyone.
    func testBossModeOffMigratesOnlyTheDelegationLayers() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "philosophy-migrate-\(UUID().uuidString)"))
        defaults.set(false, forKey: "pipiui.bossMode")

        PhilosophySettings.migrateFromBossModeIfNeeded(defaults: defaults, configURL: configURL)

        XCTAssertFalse(PhilosophySettings.isLayerEnabled("orchestration", configURL: configURL))
        XCTAssertFalse(PhilosophySettings.isLayerEnabled("fanout", configURL: configURL))
        XCTAssertTrue(PhilosophySettings.isLayerEnabled("foundation", configURL: configURL))
        XCTAssertTrue(PhilosophySettings.isLayerEnabled("method", configURL: configURL))
    }

    func testMigrationRunsOnceSoALaterOptInIsNotUndone() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "philosophy-once-\(UUID().uuidString)"))
        defaults.set(false, forKey: "pipiui.bossMode")
        PhilosophySettings.migrateFromBossModeIfNeeded(defaults: defaults, configURL: configURL)

        PhilosophySettings.setLayerEnabled(true, id: "orchestration", configURL: configURL)
        PhilosophySettings.migrateFromBossModeIfNeeded(defaults: defaults, configURL: configURL)
        XCTAssertTrue(PhilosophySettings.isLayerEnabled("orchestration", configURL: configURL))
    }

    func testBossModeOnOrUnsetLeavesDefaults() throws {
        for value: Bool? in [true, nil] {
            let defaults = try XCTUnwrap(UserDefaults(suiteName: "philosophy-on-\(UUID().uuidString)"))
            if let value { defaults.set(value, forKey: "pipiui.bossMode") }
            let url = dir.appendingPathComponent("cfg-\(UUID().uuidString).json")
            PhilosophySettings.migrateFromBossModeIfNeeded(defaults: defaults, configURL: url)
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path),
                           "nothing to migrate must not write a config file")
        }
    }

    // MARK: - Catalog parsing

    func testParseLayerReadsFrontmatterAndStripsIt() throws {
        let layer = try XCTUnwrap(PhilosophySettings.parseLayer("""
        ---
        id: mine
        name: 我的哲学
        summary: 一句话
        order: 15
        requires: [foundation, method]
        scope: [main]
        ---
        # Body

        Text.
        """, isUserProvided: true))
        XCTAssertEqual(layer.id, "mine")
        XCTAssertEqual(layer.name, "我的哲学")
        XCTAssertEqual(layer.summary, "一句话")
        XCTAssertEqual(layer.order, 15)
        XCTAssertEqual(layer.requires, ["foundation", "method"])
        XCTAssertTrue(layer.isUserProvided)
        XCTAssertEqual(layer.body, "# Body\n\nText.")
        XCTAssertFalse(layer.body.contains("id: mine"))
    }

    func testParseLayerRejectsBrokenFrontmatter() {
        for broken in [
            "no frontmatter at all",
            "---\nname: x\norder: 1\n---\nbody",          // no id
            "---\nid: x\nname: x\n---\nbody",             // no order
            "---\nid: x\norder: 1\n---\nbody",            // no name
        ] {
            XCTAssertNil(PhilosophySettings.parseLayer(broken, isUserProvided: false), broken)
        }
    }

    func testUserLayerShadowsBundledLayerOfSameID() throws {
        let userDir = dir.appendingPathComponent("user", isDirectory: true)
        try FileManager.default.createDirectory(at: userDir, withIntermediateDirectories: true)
        try """
        ---
        id: foundation
        name: 我的基础哲学
        summary: 覆盖
        order: 10
        scope: [main]
        ---
        Mine.
        """.write(to: userDir.appendingPathComponent("10-foundation.md"),
                  atomically: true, encoding: .utf8)

        let bundled = try XCTUnwrap(PhilosophyPackage.bundledURL)
        let layers = PhilosophySettings.layers(
            layersURL: bundled.appendingPathComponent("layers"), userURL: userDir)
        let foundation = try XCTUnwrap(layers.first { $0.id == "foundation" })
        XCTAssertTrue(foundation.isUserProvided)
        XCTAssertEqual(foundation.body, "Mine.")
        XCTAssertEqual(layers.filter { $0.id == "foundation" }.count, 1)
        XCTAssertEqual(layers.count, 4, "shadowing must not add a fifth layer")
    }
}

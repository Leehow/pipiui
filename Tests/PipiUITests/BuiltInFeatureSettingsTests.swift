import XCTest
@testable import PipiUI

final class BuiltInFeatureSettingsTests: XCTestCase {
    /// Fresh UserDefaults ⇒ every catalog feature is enabled and bare-pi mode
    /// (allDisabled) is false on first launch.
    func testDefaultsAreAllEnabled() {
        let defaults = UserDefaults(suiteName: "pipiui.test.builtin.defaults")!
        defaults.removePersistentDomain(forName: "pipiui.test.builtin.defaults")

        let set = BuiltInFeatureSettings.enabledSet(defaults: defaults)
        for feature in BuiltInFeatureSettings.FeatureID.allCases {
            XCTAssertTrue(set.isEnabled(feature), "\(feature.rawValue) should default on")
        }
        XCTAssertFalse(set.allDisabled)
    }

    func testEnableDisablePersists() {
        let defaults = UserDefaults(suiteName: "pipiui.test.builtin.persist")!
        defaults.removePersistentDomain(forName: "pipiui.test.builtin.persist")

        BuiltInFeatureSettings.setEnabled(false, id: .git, defaults: defaults)
        XCTAssertFalse(BuiltInFeatureSettings.isEnabled(.git, defaults: defaults))
        XCTAssertTrue(BuiltInFeatureSettings.isEnabled(.browser, defaults: defaults))

        BuiltInFeatureSettings.setEnabled(true, id: .git, defaults: defaults)
        XCTAssertTrue(BuiltInFeatureSettings.isEnabled(.git, defaults: defaults))

        // Disabled set is what is stored, so a re-enabled feature is removed.
        let stored = defaults.stringArray(forKey: BuiltInFeatureSettings.disabledKey) ?? []
        XCTAssertFalse(stored.contains(BuiltInFeatureSettings.FeatureID.git.rawValue))
    }

    /// A stale/unknown ID left in UserDefaults by an older build must not flip a
    /// known feature off, and must not break allDisabled.
    func testUnknownDisabledIDIsIgnored() {
        let defaults = UserDefaults(suiteName: "pipiui.test.builtin.unknown")!
        defaults.removePersistentDomain(forName: "pipiui.test.builtin.unknown")
        defaults.set(
            ["some.future.feature", "another.removed.one"],
            forKey: BuiltInFeatureSettings.disabledKey
        )

        let set = BuiltInFeatureSettings.enabledSet(defaults: defaults)
        for feature in BuiltInFeatureSettings.FeatureID.allCases {
            XCTAssertTrue(set.isEnabled(feature), "\(feature.rawValue) unaffected by unknown IDs")
        }
        XCTAssertFalse(set.allDisabled)

        // sanitized() drops IDs not present in the catalog.
        XCTAssertEqual(set.sanitized().disabled, [])
    }

    func testAllDisabledWhenEveryFeatureOff() {
        let allIDs = BuiltInFeatureSettings.FeatureID.allCases.map(\.rawValue)
        let set = BuiltInFeatureSettings.EnabledSet(disabledIDs: allIDs)
        XCTAssertTrue(set.allDisabled)
        // Plus an unknown ID: still all-disabled for the known catalog only.
        let withUnknown = BuiltInFeatureSettings.EnabledSet(
            disabledIDs: allIDs + ["ghost.id"]
        )
        XCTAssertTrue(withUnknown.allDisabled)
    }

    func testAllDisabledFalseIfAnyOn() {
        let set = BuiltInFeatureSettings.EnabledSet(
            disabledIDs: BuiltInFeatureSettings.FeatureID.allCases
                .filter { $0 != .reload }.map(\.rawValue)
        )
        XCTAssertFalse(set.allDisabled)
        XCTAssertTrue(set.isEnabled(.reload))
    }

    func testPhilosophyDisableFailureDoesNotCommitMasterOrConfig() throws {
        let suite = "pipiui.test.builtin.philosophy-disable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: dir)
        }
        let configURL = dir.appendingPathComponent("philosophy.json")
        let settingsURL = dir.appendingPathComponent("settings.json")
        try "{ invalid json".write(to: settingsURL, atomically: true, encoding: .utf8)
        let originalSettings = try Data(contentsOf: settingsURL)
        PhilosophySettings.setEnabled(true, configURL: configURL)
        PhilosophyPackage.setAutoRegisterEnabled(true, defaults: defaults)
        // Missing feature key means enabled.
        XCTAssertTrue(BuiltInFeatureSettings.isEnabled(.philosophy, defaults: defaults))

        XCTAssertThrowsError(try BuiltInPhilosophyTransition.apply(
            enabled: false,
            defaults: defaults,
            configURL: configURL,
            settingsURL: settingsURL
        ))

        XCTAssertTrue(BuiltInFeatureSettings.isEnabled(.philosophy, defaults: defaults))
        XCTAssertTrue(PhilosophySettings.isEnabled(configURL: configURL))
        XCTAssertTrue(PhilosophyPackage.autoRegisterEnabled(defaults: defaults))
        XCTAssertEqual(try Data(contentsOf: settingsURL), originalSettings)
    }

    func testPhilosophyEnableFailureDoesNotCommitMasterOrConfig() throws {
        let suite = "pipiui.test.builtin.philosophy-enable.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: dir)
        }
        let configURL = dir.appendingPathComponent("philosophy.json")
        let settingsURL = dir.appendingPathComponent("settings.json")
        try "{ invalid json".write(to: settingsURL, atomically: true, encoding: .utf8)
        let originalSettings = try Data(contentsOf: settingsURL)
        BuiltInFeatureSettings.setEnabled(false, id: .philosophy, defaults: defaults)
        PhilosophySettings.setEnabled(false, configURL: configURL)
        PhilosophyPackage.setAutoRegisterEnabled(false, defaults: defaults)

        XCTAssertThrowsError(try BuiltInPhilosophyTransition.apply(
            enabled: true,
            defaults: defaults,
            configURL: configURL,
            settingsURL: settingsURL
        ))

        XCTAssertFalse(BuiltInFeatureSettings.isEnabled(.philosophy, defaults: defaults))
        XCTAssertFalse(PhilosophySettings.isEnabled(configURL: configURL))
        XCTAssertFalse(PhilosophyPackage.autoRegisterEnabled(defaults: defaults))
        XCTAssertEqual(try Data(contentsOf: settingsURL), originalSettings)
    }

    func testStartupPhilosophyRegistrationRequiresBothMasterAndAutoRegister() {
        let suite = "pipiui.test.builtin.philosophy-startup.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        // Migration/default state: both keys missing means enabled.
        XCTAssertTrue(PiPlugin.shouldSyncPhilosophyRegistration(
            defaults: defaults,
            extensionAvailable: true
        ))

        // New master off dominates a missing (default-true) legacy auto key.
        BuiltInFeatureSettings.setEnabled(false, id: .philosophy, defaults: defaults)
        XCTAssertFalse(PiPlugin.shouldSyncPhilosophyRegistration(
            defaults: defaults,
            extensionAvailable: true
        ))

        // Even an explicitly stale true auto key must not bypass the master.
        PhilosophyPackage.setAutoRegisterEnabled(true, defaults: defaults)
        XCTAssertFalse(PiPlugin.shouldSyncPhilosophyRegistration(
            defaults: defaults,
            extensionAvailable: true
        ))

        BuiltInFeatureSettings.setEnabled(true, id: .philosophy, defaults: defaults)
        PhilosophyPackage.setAutoRegisterEnabled(false, defaults: defaults)
        XCTAssertFalse(PiPlugin.shouldSyncPhilosophyRegistration(
            defaults: defaults,
            extensionAvailable: true
        ))
        PhilosophyPackage.setAutoRegisterEnabled(true, defaults: defaults)
        XCTAssertFalse(PiPlugin.shouldSyncPhilosophyRegistration(
            defaults: defaults,
            extensionAvailable: false
        ))
    }

    /// The catalog must cover every extension PipiUI ships — guards against a
    /// new extension being added to `PiPlugin.Installed` without a master switch.
    func testCatalogCoversAllDeclaredFeatureIDs() {
        let catalogIDs = Set(BuiltInFeatureSettings.catalog.map(\.id))
        XCTAssertEqual(catalogIDs, Set(BuiltInFeatureSettings.FeatureID.allCases))
    }
}

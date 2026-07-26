import XCTest
@testable import PipiUI

final class ComputerUseSettingsTests: XCTestCase {
    private func suite() -> (String, UserDefaults) {
        let name = "pipiui.test.computer.\(UUID().uuidString)"
        return (name, UserDefaults(suiteName: name)!)
    }

    func testOptInDefaultsOffAndPersists() {
        let (name, defaults) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertFalse(ComputerUseSettings.isEnabled(defaults: defaults))
        ComputerUseSettings.setEnabled(true, defaults: defaults)
        XCTAssertTrue(ComputerUseSettings.isEnabled(defaults: defaults))
        ComputerUseSettings.setEnabled(false, defaults: defaults)
        XCTAssertFalse(ComputerUseSettings.isEnabled(defaults: defaults))
    }

    func testDownscalePreservesAspectAndNeverUpscales() {
        XCTAssertEqual(
            ComputerUseSettings.downscaledSize(
                pixelWidth: 2560,
                pixelHeight: 1600,
                maxLongEdge: 1440
            ),
            ComputerImageSize(width: 1440, height: 900)
        )
        XCTAssertEqual(
            ComputerUseSettings.downscaledSize(
                pixelWidth: 800,
                pixelHeight: 600,
                maxLongEdge: 1440
            ),
            ComputerImageSize(width: 800, height: 600)
        )
    }

    func testResolutionSettingAcceptsOnlyAdvertisedSizes() {
        let (name, defaults) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        ComputerUseSettings.setMaxLongEdge(1080, defaults: defaults)
        XCTAssertEqual(ComputerUseSettings.maxLongEdge(defaults: defaults), 1080)
        ComputerUseSettings.setMaxLongEdge(999, defaults: defaults)
        XCTAssertEqual(
            ComputerUseSettings.maxLongEdge(defaults: defaults),
            ComputerUseSettings.defaultMaxLongEdge
        )
    }

    func testPersistedAllowDenyAreMutuallyExclusive() {
        let (name, defaults) = suite()
        defer { defaults.removePersistentDomain(forName: name) }
        ComputerUseSettings.setPersistedPolicy(
            bundleID: "COM.EXAMPLE.Editor",
            decision: .allow,
            defaults: defaults
        )
        XCTAssertEqual(
            ComputerUseSettings.persistedAllowedBundleIDs(defaults: defaults),
            ["com.example.editor"]
        )
        ComputerUseSettings.setPersistedPolicy(
            bundleID: "com.example.editor",
            decision: .deny,
            defaults: defaults
        )
        XCTAssertTrue(
            ComputerUseSettings.persistedAllowedBundleIDs(defaults: defaults).isEmpty
        )
        XCTAssertEqual(
            ComputerUseSettings.persistedDeniedBundleIDs(defaults: defaults),
            ["com.example.editor"]
        )
    }
}

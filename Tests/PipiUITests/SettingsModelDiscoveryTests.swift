import XCTest
@testable import PipiUI

final class SettingsModelDiscoveryTests: XCTestCase {
    func testModelDiscoveryEnvironmentOverlaysDummyDotEnvAndPreservesHelperPath() {
        let environment = PiAuthHelper.modelDiscoveryEnvironment(
            base: [
                "INHERITED_VALUE": "retained",
                "PATH": "/usr/bin",
            ],
            dotEnv: [
                "KIMI_API_KEY": "dummy-kimi-key",
                "ZAI_CODING_CN_API_KEY": "dummy-zai-key",
            ],
            piExecutablePath: "/custom/bin/pi"
        )

        XCTAssertEqual(environment["INHERITED_VALUE"], "retained")
        XCTAssertEqual(environment["KIMI_API_KEY"], "dummy-kimi-key")
        XCTAssertEqual(environment["ZAI_CODING_CN_API_KEY"], "dummy-zai-key")
        XCTAssertEqual(
            environment["PATH"],
            "/custom/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin"
        )
    }

    func testSettingsReloadPolicyOnlyReloadsWhenBecomingVisible() {
        XCTAssertTrue(SettingsReloadPolicy.shouldReload(from: false, to: true))
        XCTAssertFalse(SettingsReloadPolicy.shouldReload(from: false, to: false))
        XCTAssertFalse(SettingsReloadPolicy.shouldReload(from: true, to: true))
        XCTAssertFalse(SettingsReloadPolicy.shouldReload(from: true, to: false))
    }
}

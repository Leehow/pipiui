import XCTest
@testable import PipiUI

final class JcodeSettingsTests: XCTestCase {
    private let defaults = UserDefaults.standard
    private let key = "pipiui.jcode.enabled"

    override func tearDown() {
        defaults.removeObject(forKey: key)
        super.tearDown()
    }

    func testIsEnabledDefaultsFalse() {
        defaults.removeObject(forKey: key)
        XCTAssertFalse(JcodeSettings.isEnabled)
    }

    func testIsEnabledRoundTrip() {
        JcodeSettings.isEnabled = true
        XCTAssertTrue(defaults.bool(forKey: key))
        XCTAssertTrue(JcodeSettings.isEnabled)

        JcodeSettings.isEnabled = false
        // stored as false = removed-or-false; reads back false
        XCTAssertFalse(JcodeSettings.isEnabled)
    }

    /// Parsing fixture: only providers with status != "not_configured" are returned.
    func testParseConfiguredProvidersFromFixture() {
        let fixture = """
        {"providers":[
          {"id":"claude","status":"not_configured"},
          {"id":"deepseek","status":"available"},
          {"id":"kimi","status":"available"},
          {"id":"cursor","status":"configured"}
        ]}
        """
        let ids = JcodeSettings.parseProviders(from: Data(fixture.utf8))
        XCTAssertEqual(ids.sorted(), ["cursor", "deepseek", "kimi"])
    }

    func testParseMalformedJSONReturnsEmpty() {
        let ids = JcodeSettings.parseProviders(from: Data("not json".utf8))
        XCTAssertEqual(ids, [])
    }
}

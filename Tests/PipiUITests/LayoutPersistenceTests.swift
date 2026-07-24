import XCTest
@testable import PipiUI

final class LayoutPersistenceTests: XCTestCase {
    /// Window-content size round-trips through UserDefaults.
    /// (The per-account Grok quota-period persistence was removed once the capsule
    /// switched to always showing top-level usedPercent — see GrokCreditsTests.)
    func testWindowContentSizeRoundTrip() {
        let suiteName = "pipiui.test.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        defer { suite.removePersistentDomain(forName: suiteName) }

        XCTAssertNil(LayoutPersistence.storedWindowContentSize(defaults: suite))
        LayoutPersistence.saveWindowContentSize(NSSize(width: 1000, height: 700), defaults: suite)
        let restored = LayoutPersistence.storedWindowContentSize(defaults: suite)
        XCTAssertEqual(restored?.width, 1000)
        XCTAssertEqual(restored?.height, 700)
    }
}

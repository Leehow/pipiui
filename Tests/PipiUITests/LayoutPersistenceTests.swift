import XCTest
@testable import PipiUI

final class LayoutPersistenceTests: XCTestCase {
    func testQuotaSelectedPeriodRoundTrip() {
        let suiteName = "pipiui.test.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        defer { suite.removePersistentDomain(forName: suiteName) }
        let aid = "acct-xyz"
        XCTAssertNil(LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid, defaults: suite))
        LayoutPersistence.setGrokQuotaSelectedPeriod(2, accountId: aid, defaults: suite)
        XCTAssertEqual(LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid, defaults: suite), 2)
        // 不同账号隔离
        XCTAssertNil(LayoutPersistence.grokQuotaSelectedPeriod(accountId: "other", defaults: suite))
    }
}

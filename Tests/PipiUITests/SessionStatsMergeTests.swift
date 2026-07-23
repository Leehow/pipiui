import XCTest
@testable import PipiUI

final class SessionStatsMergeTests: XCTestCase {
    private let prior = SessionStatsMerge.Context(
        tokens: 174_000,
        window: 200_000,
        percent: 87
    )

    func testNullTokensAndPercentClearStaleValues() {
        // After compaction pi may return null tokens/percent with a known window.
        let usage = J([
            "tokens": NSNull(),
            "contextWindow": 200_000,
            "percent": NSNull(),
        ] as [String: Any])

        let next = SessionStatsMerge.apply(contextUsage: usage, to: prior)
        XCTAssertNil(next.tokens)
        XCTAssertEqual(next.window, 200_000)
        XCTAssertNil(next.percent, "explicit null percent must clear stale % (not leave 87)")
        XCTAssertEqual(
            TokenFormat.contextStatus(tokens: next.tokens, window: next.window, percent: next.percent),
            "?/200k"
        )
    }

    func testAbsentContextUsageLeavesPrevious() {
        let next = SessionStatsMerge.apply(contextUsage: J(nil), to: prior)
        XCTAssertEqual(next, prior)
    }

    func testNullContextUsageLeavesPrevious() {
        let next = SessionStatsMerge.apply(contextUsage: J(NSNull()), to: prior)
        XCTAssertEqual(next, prior)
    }

    func testNumericUsageSetsAllFields() {
        let usage = J([
            "tokens": 60_000,
            "contextWindow": 200_000,
            "percent": 30.0,
        ] as [String: Any])
        let next = SessionStatsMerge.apply(contextUsage: usage, to: prior)
        XCTAssertEqual(next.tokens, 60_000)
        XCTAssertEqual(next.window, 200_000)
        XCTAssertEqual(next.percent, 30.0)
    }

    func testMissingPercentDerivesFromTokensAndWindow() {
        let usage = J([
            "tokens": 50_000,
            "contextWindow": 200_000,
        ] as [String: Any])
        let next = SessionStatsMerge.apply(contextUsage: usage, to: prior)
        XCTAssertEqual(next.tokens, 50_000)
        XCTAssertEqual(next.window, 200_000)
        XCTAssertEqual(next.percent, 25.0)
    }

    func testMissingPercentWithoutTokensLeavesPreviousPercent() {
        let usage = J([
            "contextWindow": 200_000,
        ] as [String: Any])
        let next = SessionStatsMerge.apply(contextUsage: usage, to: prior)
        XCTAssertEqual(next.tokens, prior.tokens, "tokens key absent → keep previous")
        XCTAssertEqual(next.window, 200_000)
        XCTAssertEqual(next.percent, 87, "cannot derive → keep previous percent")
    }
}

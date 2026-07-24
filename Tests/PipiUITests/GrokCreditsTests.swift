import XCTest
@testable import PipiUI

final class GrokCreditsTests: XCTestCase {
    func testTokenFormatCompact() {
        XCTAssertEqual(TokenFormat.compact(0), "0")
        XCTAssertEqual(TokenFormat.compact(999), "999")
        XCTAssertEqual(TokenFormat.compact(1000), "1k")
        XCTAssertEqual(TokenFormat.compact(1200), "1.2k")
        XCTAssertEqual(TokenFormat.compact(60_000), "60k")
        XCTAssertEqual(TokenFormat.compact(200_000), "200k")
        XCTAssertEqual(TokenFormat.compact(1_500_000), "1.5m")
    }

    func testContextStatusFormatting() {
        XCTAssertEqual(
            TokenFormat.contextStatus(tokens: 60_000, window: 200_000, percent: 30),
            "60k/200k 30%"
        )
        XCTAssertEqual(
            TokenFormat.contextStatus(tokens: nil, window: 200_000, percent: 12),
            "?/200k 12%"
        )
        XCTAssertEqual(
            TokenFormat.contextStatus(tokens: nil, window: nil, percent: 8),
            "8%"
        )
        XCTAssertNil(TokenFormat.contextStatus(tokens: nil, window: nil, percent: nil))
    }

    func testPeriodLabelWeeklyMonthly() {
        let now = Date()
        let weekly = GrokCreditsSnapshot.period(
            resetsAt: now.addingTimeInterval(6 * 86400),
            now: now
        )
        XCTAssertEqual(weekly.label, "周")
        XCTAssertEqual(weekly.help, "周额度")

        let monthly = GrokCreditsSnapshot.period(
            resetsAt: now.addingTimeInterval(30 * 86400),
            now: now
        )
        XCTAssertEqual(monthly.label, "月")
        XCTAssertEqual(monthly.help, "月额度")

        let unknown = GrokCreditsSnapshot.period(
            resetsAt: now.addingTimeInterval(90 * 86400),
            now: now
        )
        XCTAssertEqual(unknown.label, "额")

        // Near end of a weekly window: duration start→end still classifies as 周.
        let start = now.addingTimeInterval(-6 * 86400)
        let end = now.addingTimeInterval(1 * 86400)
        let nearEnd = GrokCreditsSnapshot.period(resetsAt: end, periodStart: start, now: now)
        XCTAssertEqual(nearEnd.label, "周")
    }

    func testPeriodLabelFiveHour() {
        let now = Date()
        // 周期窗口 ~5 小时 → "5小时"
        let fiveHour = GrokCreditsSnapshot.period(
            resetsAt: now.addingTimeInterval(5 * 3600),
            periodStart: now,
            now: now
        )
        XCTAssertEqual(fiveHour.label, "5小时")
        XCTAssertEqual(fiveHour.help, "5小时额度")
    }

    func testPeriodUsageIdentityByTypeRaw() {
        let p = PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil)
        XCTAssertEqual(p.id, 2)
    }

    func testLiveFetchIfAuthPresent() async throws {
        guard let creds = GrokAuthStore.load(), !creds.isExpired else {
            throw XCTSkip("no usable ~/.grok/auth.json")
        }
        do {
            let snap = try await GrokWebBilling.fetch(credentials: creds)
            XCTAssertGreaterThanOrEqual(snap.usedPercent, 0)
            XCTAssertLessThanOrEqual(snap.usedPercent, 100)
            print("LIVE quota=\(snap.usedPercent)% label=\(snap.periodLabel) resets=\(String(describing: snap.resetsAt))")
        } catch {
            throw XCTSkip("live billing unavailable: \(error)")
        }
    }

    func testAuthParsePrefersOIDC() throws {
        let json = """
        {
          "https://accounts.x.ai/sign-in": {
            "key": "legacy-token",
            "expires_at": "2099-01-01T00:00:00Z"
          },
          "https://auth.x.ai::client": {
            "key": "oidc-token",
            "expires_at": "2099-01-01T00:00:00Z",
            "principal_type": "user"
          }
        }
        """
        let creds = try XCTUnwrap(GrokAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accessToken, "oidc-token")
        XCTAssertFalse(creds.isExpired)
        XCTAssertFalse(creds.isTeamPrincipal)
    }

    func testParseBillingFloatPercent() throws {
        // field 1 = message; nested field 1 = float percent 42.5
        // Simplest: raw protobuf with fixed32 percent at path ending in 1.
        // Build: outer message field 1 (len-delim) containing fixed32 field 1 = 25.0f
        var inner = Data()
        // tag for field 1, wire type 5 (fixed32): (1<<3)|5 = 0x0d
        inner.append(0x0d)
        var bits = Float(25.0).bitPattern.littleEndian
        withUnsafeBytes(of: &bits) { inner.append(contentsOf: $0) }

        var outer = Data()
        // field 1, wire type 2: (1<<3)|2 = 0x0a
        outer.append(0x0a)
        outer.append(UInt8(inner.count))
        outer.append(inner)

        // Wrap as gRPC-web data frame
        var frame = Data([0x00])
        let len = UInt32(outer.count).bigEndian
        withUnsafeBytes(of: len) { frame.append(contentsOf: $0) }
        frame.append(outer)

        let parsed = try GrokWebBilling.parseGRPCWebResponse(frame)
        XCTAssertEqual(parsed.usedPercent, 25.0, accuracy: 0.01)
    }
}

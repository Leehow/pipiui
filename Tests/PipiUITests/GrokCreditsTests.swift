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

    func testAccountIdFromPrincipalId() throws {
        let json = """
        {"https://auth.x.ai::client": {"key":"k","principal_id":"pid-9","user_id":"uid-1","principal_type":"user"}}
        """
        let creds = try XCTUnwrap(GrokAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accountId, "pid-9")
    }

    func testAccountIdFallbackToUserId() throws {
        let json = """
        {"https://auth.x.ai::client": {"key":"k","user_id":"uid-7","principal_type":"user"}}
        """
        let creds = try XCTUnwrap(GrokAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accountId, "uid-7")
    }

    func testAccountIdFallbackToScopeUUID() throws {
        let json = """
        {"https://auth.x.ai::abc-def-123": {"key":"k","principal_type":"user"}}
        """
        let creds = try XCTUnwrap(GrokAuthStore.parse(data: Data(json.utf8)))
        XCTAssertEqual(creds.accountId, "abc-def-123")
    }

    func testQuotaDisplayResolvesSelected() {
        let periods = [PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil),
                       PeriodUsage(typeRaw: 1, label: "月", percent: 33, resetDate: nil)]
        let r = GrokQuotaDisplay.resolve(periods: periods, selected: 2, fallbackPercent: 75, fallbackLabel: "额")
        XCTAssertEqual(r.percent, 38)
        XCTAssertEqual(r.label, "周")
    }

    func testQuotaDisplayFallsBackToMaxWhenNoSelection() {
        let periods = [PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil),
                       PeriodUsage(typeRaw: 1, label: "月", percent: 60, resetDate: nil)]
        let r = GrokQuotaDisplay.resolve(periods: periods, selected: nil, fallbackPercent: 75, fallbackLabel: "额")
        XCTAssertEqual(r.percent, 60)
        XCTAssertEqual(r.label, "月")
    }

    func testQuotaDisplayFallsBackWhenPeriodsEmpty() {
        let r = GrokQuotaDisplay.resolve(periods: [], selected: nil, fallbackPercent: 75, fallbackLabel: "额")
        XCTAssertEqual(r.percent, 75)
        XCTAssertEqual(r.label, "额")
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

    func testParsePeriodsFromRepeatedField() {
        // 构造 gRPC-web frame: 5-byte header + protobuf payload
        // payload = field1(message){ field1=f32(75), field7(msg){ field1=varint(2), field2=f32(38) },
        //                              field7(msg){ field1=varint(1), field2=f32(33) } }
        func tag(_ fn: Int, _ wt: Int) -> UInt8 { UInt8((fn << 3) | wt) }
        func varint(_ v: UInt64) -> Data {
            var v = v; var out = Data()
            while v >= 0x80 { out.append(UInt8((v & 0x7f) | 0x80)); v >>= 7 }
            out.append(UInt8(v)); return out
        }
        func f32(_ f: Float) -> Data {
            var f = f; return Data(bytes: &f, count: 4) // little-endian on arm64
        }
        // inner entry1: field1(varint)=2, field2(f32)=38
        var entry1 = Data()
        entry1.append(tag(1, 0)); entry1.append(varint(2))
        entry1.append(tag(2, 5)); entry1.append(f32(38))
        // inner entry2: field1(varint)=1, field2(f32)=33
        var entry2 = Data()
        entry2.append(tag(1, 0)); entry2.append(varint(1))
        entry2.append(tag(2, 5)); entry2.append(f32(33))
        // config = field1(f32)=75, field7(msg)=entry1, field7(msg)=entry2
        var cfg = Data()
        cfg.append(tag(1, 5)); cfg.append(f32(75))
        cfg.append(tag(7, 2)); cfg.append(varint(UInt64(entry1.count))); cfg.append(entry1)
        cfg.append(tag(7, 2)); cfg.append(varint(UInt64(entry2.count))); cfg.append(entry2)
        var payload = Data()
        payload.append(tag(1, 2)); payload.append(varint(UInt64(cfg.count))); payload.append(cfg)
        // gRPC-web frame
        var frame = Data([0x00, 0x00, 0x00, 0x00, 0x00])
        frame.append(payload)
        // Fix length in header (big-endian)
        let plen = UInt32(payload.count).bigEndian
        withUnsafeBytes(of: plen) { frame.replaceSubrange(1..<5, with: $0) }

        let parsed = try! GrokWebBilling.parseGRPCWebResponse(frame)
        XCTAssertEqual(parsed.usedPercent, 75, accuracy: 0.01)
        XCTAssertEqual(parsed.periods.count, 2)
        XCTAssertEqual(parsed.periods[0].typeRaw, 2)
        XCTAssertEqual(parsed.periods[0].percent, 38, accuracy: 0.01)
        XCTAssertEqual(parsed.periods[1].typeRaw, 1)
        XCTAssertEqual(parsed.periods[1].percent, 33, accuracy: 0.01)
    }
}

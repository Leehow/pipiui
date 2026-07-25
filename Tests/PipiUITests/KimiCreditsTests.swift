import XCTest
@testable import PipiUI

final class KimiCreditsTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // Isolate from the real ~/.pi/agent/.env; individual tests re-point this.
        QuotaEnvFallback.envFileValues = { [:] }
    }

    override func tearDown() {
        QuotaEnvFallback.envFileValues = { EnvFileStore().all() }
        super.tearDown()
    }

    // MARK: - .env fallback

    func testAuthFallsBackToDotEnvWhenProcessEnvMissing() {
        QuotaEnvFallback.envFileValues = { ["KIMI_CODE_API_KEY": "dotenv-key"] }
        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: URL(fileURLWithPath: "/tmp/pipiui-missing-auth-\(UUID().uuidString).json"),
            env: [:],
            kimiCodeHome: nil
        )
        XCTAssertEqual(cred, "dotenv-key")
    }

    func testProcessEnvWinsOverDotEnv() {
        QuotaEnvFallback.envFileValues = { ["KIMI_API_KEY": "dotenv-generic"] }
        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: URL(fileURLWithPath: "/tmp/pipiui-missing-auth-\(UUID().uuidString).json"),
            env: ["KIMI_API_KEY": "process-generic"],
            kimiCodeHome: nil
        )
        XCTAssertEqual(cred, "process-generic")
    }

    func testDotEnvDoesNotOverridePiAuth() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-kimi-auth-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let authURL = dir.appendingPathComponent("auth.json")
        let payload: [String: Any] = [
            "kimi-coding": ["type": "api_key", "key": "pi-key"]
        ]
        try JSONSerialization.data(withJSONObject: payload).write(to: authURL)
        QuotaEnvFallback.envFileValues = { ["KIMI_CODE_API_KEY": "dotenv-key"] }
        let cred = KimiAuthStore.resolveCodeBearer(authURL: authURL, env: [:], kimiCodeHome: nil)
        XCTAssertEqual(cred, "pi-key")
    }

    // MARK: - Code API parse

    func testParseCodeAPIUsageWindows() throws {
        let json = """
        {
          "usage": {
            "limit": "2048",
            "used": "214",
            "remaining": "1834",
            "resetTime": "2026-01-09T15:23:13.716839300Z"
          },
          "limits": [{
            "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
            "detail": {
              "limit": "200",
              "used": "139",
              "remaining": "61",
              "resetTime": "2026-01-06T13:33:02.717479433Z"
            }
          }]
        }
        """
        let parsed = try KimiBilling.parseCodeAPIUsage(Data(json.utf8))
        let snap = try XCTUnwrap(KimiBilling.snapshot(
            weekly: parsed.weekly,
            rateLimit: parsed.rateLimit,
            monthly: nil
        ))
        XCTAssertEqual(snap.windows.count, 2)
        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        let five = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        XCTAssertEqual(weekly.label, "周")
        XCTAssertEqual(weekly.usedPercent, 214.0 / 2048.0 * 100, accuracy: 0.05)
        XCTAssertEqual(five.label, "5h")
        XCTAssertEqual(five.usedPercent, 139.0 / 200.0 * 100, accuracy: 0.05)
        XCTAssertNotNil(weekly.resetsAt)
        XCTAssertNotNil(five.resetsAt)
    }

    func testParseCodeAPIRateLimitFromRemainingOnly() throws {
        let json = """
        {
          "usage": {"limit": "100", "remaining": "75", "resetTime": "2026-01-09T15:23:13Z"},
          "limits": [{
            "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
            "detail": {"limit": "20", "remaining": "15", "resetTime": "2026-01-06T13:33:02Z"}
          }]
        }
        """
        let parsed = try KimiBilling.parseCodeAPIUsage(Data(json.utf8))
        let snap = try XCTUnwrap(KimiBilling.snapshot(
            weekly: parsed.weekly,
            rateLimit: parsed.rateLimit,
            monthly: nil
        ))
        let weekly = try XCTUnwrap(snap.windows.first { $0.id == "weekly" })
        let five = try XCTUnwrap(snap.windows.first { $0.id == "fiveHour" })
        XCTAssertEqual(weekly.usedPercent, 25, accuracy: 0.01)
        XCTAssertEqual(five.usedPercent, 25, accuracy: 0.01)
    }

    // MARK: - Subscription monthly

    func testParseSubscriptionMonthly() throws {
        let json = """
        {
          "subscriptionBalance": {
            "feature": "FEATURE_OMNI",
            "type": "SUBSCRIPTION",
            "amountUsedRatio": 0.42,
            "expireTime": "2026-07-23T00:00:00Z"
          },
          "ratelimitCode7d": {
            "ratio": 0.17,
            "enabled": true,
            "resetTime": "2026-07-13T15:28:00Z"
          }
        }
        """
        let monthly = KimiBilling.parseMonthly(from: Data(json.utf8))
        let m = try XCTUnwrap(monthly)
        XCTAssertEqual(m.usedPercent, 42, accuracy: 0.01)
        XCTAssertNotNil(m.resetsAt)

        // code7d must not appear even when present in JSON.
        let weekly = KimiUsageDetail(limit: "100", used: "25", remaining: "75", resetTime: nil)
        let snap = try XCTUnwrap(KimiBilling.snapshot(weekly: weekly, rateLimit: nil, monthly: m))
        XCTAssertEqual(snap.windows.map(\.id).sorted(), ["monthly", "weekly"])
    }

    func testParseWebUsagesFEATURE_CODING() throws {
        let json = """
        {
          "usages": [{
            "scope": "FEATURE_CODING",
            "detail": {"limit": "100", "used": "25", "remaining": "75"},
            "limits": [{
              "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
              "detail": {"limit": "20", "used": "5", "remaining": "15"}
            }]
          }]
        }
        """
        let parsed = try KimiBilling.parseWebUsages(Data(json.utf8))
        let snap = try XCTUnwrap(KimiBilling.snapshot(
            weekly: parsed.weekly,
            rateLimit: parsed.rateLimit,
            monthly: nil
        ))
        XCTAssertEqual(snap.windows.first { $0.id == "weekly" }?.usedPercent ?? -1, 25, accuracy: 0.01)
        XCTAssertEqual(snap.windows.first { $0.id == "fiveHour" }?.usedPercent ?? -1, 25, accuracy: 0.01)
    }

    // MARK: - Auth priority

    func testAuthPrefersPiAuthJSONOverEnv() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-kimi-auth-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let authURL = dir.appendingPathComponent("auth.json")
        let payload: [String: Any] = [
            "kimi-coding": ["type": "api_key", "key": "pi-key-xyz"]
        ]
        try JSONSerialization.data(withJSONObject: payload).write(to: authURL)

        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: authURL,
            env: ["KIMI_CODE_API_KEY": "env-key", "KIMI_API_KEY": "generic-key"],
            kimiCodeHome: nil
        )
        XCTAssertEqual(cred, "pi-key-xyz")
    }

    func testAuthFallsBackToKimiCodeAPIKeyEnv() {
        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: URL(fileURLWithPath: "/tmp/pipiui-missing-auth-\(UUID().uuidString).json"),
            env: ["KIMI_CODE_API_KEY": "env-code-key", "KIMI_API_KEY": "generic"],
            kimiCodeHome: nil
        )
        XCTAssertEqual(cred, "env-code-key")
    }

    func testAuthFallsBackToKimiAPIKeyEnv() {
        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: URL(fileURLWithPath: "/tmp/pipiui-missing-auth-\(UUID().uuidString).json"),
            env: ["KIMI_API_KEY": "generic-kimi"],
            kimiCodeHome: nil
        )
        XCTAssertEqual(cred, "generic-kimi")
    }

    func testAuthReadsFreshCLICredential() throws {
        let home = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-kimi-code-\(UUID().uuidString)", isDirectory: true)
        let credDir = home.appendingPathComponent("credentials", isDirectory: true)
        try FileManager.default.createDirectory(at: credDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        let now = Date()
        let payload: [String: Any] = [
            "access_token": "cli-access",
            "refresh_token": "refresh",
            "expires_at": now.addingTimeInterval(3600).timeIntervalSince1970
        ]
        try JSONSerialization.data(withJSONObject: payload)
            .write(to: credDir.appendingPathComponent("kimi-code.json"))

        let cred = KimiAuthStore.resolveCodeBearer(
            authURL: URL(fileURLWithPath: "/tmp/pipiui-missing-auth-\(UUID().uuidString).json"),
            env: [:],
            kimiCodeHome: home,
            now: now
        )
        XCTAssertEqual(cred, "cli-access")
    }

    func testWebAuthTokenFromEnv() {
        XCTAssertEqual(
            KimiAuthStore.resolveWebAuthToken(env: ["KIMI_AUTH_TOKEN": "jwt.web.token"], desktopLoader: { nil }),
            "jwt.web.token"
        )
    }
}

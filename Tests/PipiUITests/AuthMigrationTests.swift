import XCTest
@testable import PipiUI

final class AuthMigrationTests: XCTestCase {

    private var tmpDir: URL!
    private var authURL: URL!
    private var envURL: URL!
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var envStore: EnvFileStore!

    override func setUpWithError() throws {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AuthMigrationTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        authURL = tmpDir.appendingPathComponent("auth.json")
        envURL = tmpDir.appendingPathComponent(".env")
        suiteName = "AuthMigrationTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
        envStore = EnvFileStore(fileURL: envURL)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: tmpDir)
    }

    // MARK: - Helpers

    private var options: AuthMigration.Options {
        var o = AuthMigration.Options()
        o.authURL = authURL
        o.defaults = defaults
        o.envStore = envStore
        return o
    }

    private func writeAuthJSON(_ dict: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: authURL, options: .atomic)
    }

    private func readJSON(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func seedFullFixture() throws {
        try writeAuthJSON([
            "anthropic": ["type": "api_key", "key": "sk-ant-123"],
            "xai": ["type": "api_key", "key": "xai-abc"],
            "openai": ["type": "oauth", "access": "tok", "refresh": "ref"],
            "mystery": ["type": "api_key", "key": "unknown-provider-key"],
        ])
    }

    // MARK: - Tests

    func testFullMigrationFromAuthJSON() throws {
        try seedFullFixture()
        let result = AuthMigration.migrateIfNeeded(options: options)

        let env = envStore.all()
        XCTAssertEqual(env["ANTHROPIC_API_KEY"], "sk-ant-123")
        XCTAssertEqual(env["XAI_API_KEY"], "xai-abc")
        XCTAssertEqual(Set(result.envWritten), ["ANTHROPIC_API_KEY", "XAI_API_KEY"])

        // auth.json: only oauth + unknown-provider api_key remain.
        let auth = readJSON(authURL)
        XCTAssertNotNil(auth?["openai"])
        XCTAssertEqual((auth?["openai"] as? [String: Any])?["type"] as? String, "oauth")
        XCTAssertEqual((auth?["openai"] as? [String: Any])?["refresh"] as? String, "ref")
        XCTAssertNotNil(auth?["mystery"]) // unmapped provider left untouched
        XCTAssertNil(auth?["anthropic"])
        XCTAssertNil(auth?["xai"])
        XCTAssertEqual(result.providersSkippedUnknown, ["mystery"])

        // Backup contains the original auth.json content.
        let bakURL = authURL.appendingPathExtension("pipiui-bak")
        XCTAssertTrue(FileManager.default.fileExists(atPath: bakURL.path))
        let bak = readJSON(bakURL)
        XCTAssertNotNil(bak?["anthropic"])
        XCTAssertNotNil(bak?["openai"])
        XCTAssertTrue(result.backupCreated)

        XCTAssertTrue(defaults.bool(forKey: AuthMigration.doneKey))
        let notice = defaults.string(forKey: AuthMigration.noticeKey) ?? ""
        XCTAssertTrue(notice.contains("ANTHROPIC_API_KEY"), "notice should summarize writes: \(notice)")
    }

    func testIdempotentSecondRun() throws {
        try seedFullFixture()
        _ = AuthMigration.migrateIfNeeded(options: options)

        let envText1 = try String(contentsOf: envURL, encoding: .utf8)
        let authText1 = try String(contentsOf: authURL, encoding: .utf8)
        let bakURL = authURL.appendingPathExtension("pipiui-bak")
        // Tamper-detect: marker in bak must survive the second run.
        try "MARKER".write(to: bakURL, atomically: true, encoding: .utf8)

        let second = AuthMigration.migrateIfNeeded(options: options)
        XCTAssertTrue(second.skippedAlreadyDone)
        XCTAssertEqual(try String(contentsOf: envURL, encoding: .utf8), envText1)
        XCTAssertEqual(try String(contentsOf: authURL, encoding: .utf8), authText1)
        XCTAssertEqual(try String(contentsOf: bakURL, encoding: .utf8), "MARKER")
    }

    func testExistingEnvValueIsNotOverwritten() throws {
        try writeAuthJSON(["anthropic": ["type": "api_key", "key": "sk-ant-123"]])
        envStore = EnvFileStore(fileURL: envURL)
        try envStore.setSync("user-custom", forKey: "ANTHROPIC_API_KEY")

        let result = AuthMigration.migrateIfNeeded(options: options)

        XCTAssertEqual(envStore.value(forKey: "ANTHROPIC_API_KEY"), "user-custom")
        XCTAssertEqual(result.envPreserved, ["ANTHROPIC_API_KEY"])
        XCTAssertTrue(result.envWritten.isEmpty)
        // Entry still removed from auth.json: value already lives in .env.
        XCTAssertNil(readJSON(authURL)?["anthropic"])
    }

    func testOAuthEntriesNeverTouched() throws {
        try writeAuthJSON([
            "openai": ["type": "oauth", "access": "tok", "expires": 12345],
            "github-copilot": ["type": "oauth", "refresh": "r"],
        ])
        let before = try String(contentsOf: authURL, encoding: .utf8)

        let result = AuthMigration.migrateIfNeeded(options: options)

        XCTAssertEqual(try String(contentsOf: authURL, encoding: .utf8), before)
        XCTAssertTrue(result.providersRemoved.isEmpty)
        XCTAssertFalse(envStore.isConfigured(forKey: "OPENAI_API_KEY"))
    }

    func testNoSourcesStillSetsDoneFlagAndIsHarmless() throws {
        let result = AuthMigration.migrateIfNeeded(options: options)
        XCTAssertFalse(result.backupCreated)
        XCTAssertTrue(result.envWritten.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: envURL.path))
        XCTAssertTrue(defaults.bool(forKey: AuthMigration.doneKey))
        XCTAssertNotNil(defaults.string(forKey: AuthMigration.noticeKey))
    }

    func testMissingAuthKeyFieldStillRemovesEntry() throws {
        try writeAuthJSON(["xai": ["type": "api_key"]]) // no "key" field
        let result = AuthMigration.migrateIfNeeded(options: options)
        XCTAssertEqual(result.providersRemoved, ["xai"])
        XCTAssertNil(readJSON(authURL)?["xai"])
        XCTAssertFalse(envStore.isConfigured(forKey: "XAI_API_KEY"))
    }
}

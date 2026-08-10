import XCTest
@testable import PipiUI

final class McpServerSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.mcp.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    private func tempURL() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("mcp-\(UUID().uuidString).json")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    // MARK: - Interpolation

    func testInterpolateSimpleVar() throws {
        XCTAssertEqual(
            try McpServerSettings.interpolate(
                "${FIRECRAWL_API_KEY}",
                variables: ["FIRECRAWL_API_KEY": "sk-123"]
            ),
            "sk-123"
        )
    }

    func testInterpolateMixedText() throws {
        let out = try McpServerSettings.interpolate(
            "Bearer ${TOKEN} for ${HOST}",
            variables: ["TOKEN": "abc", "HOST": "api.example.com"]
        )
        XCTAssertEqual(out, "Bearer abc for api.example.com")
    }

    func testInterpolateNoVarsPassesThrough() throws {
        XCTAssertEqual(try McpServerSettings.interpolate("plain-value", variables: [:]), "plain-value")
        XCTAssertEqual(try McpServerSettings.interpolate("", variables: [:]), "")
    }

    func testInterpolateMissingVarThrows() {
        XCTAssertThrowsError(try McpServerSettings.interpolate("${MISSING}", variables: [:])) { err in
            guard case McpInterpolationError.missingVariable(let name) = err else {
                return XCTFail("expected missingVariable, got \(err)")
            }
            XCTAssertEqual(name, "MISSING")
        }
    }

    func testInterpolateRecord() throws {
        let out = try McpServerSettings.interpolateRecord(
            ["FIRECRAWL_API_KEY": "${FK}", "Authorization": "Bearer ${FK}"],
            variables: ["FK": "secret"]
        )
        XCTAssertEqual(out["FIRECRAWL_API_KEY"], "secret")
        XCTAssertEqual(out["Authorization"], "Bearer secret")
        XCTAssertFalse(out.values.joined().contains("${"), "no unresolved placeholder should remain")
    }

    // MARK: - Validation

    func testValidationRejectsEmptyName() {
        let server = McpServer(name: "  ", transport: .stdio, command: "npx")
        XCTAssertNotNil(McpServerSettings.validationError(server))
    }

    func testValidationRejectsEmptyCommandForStdio() {
        let server = McpServer(name: "srv", transport: .stdio, command: "  ")
        XCTAssertNotNil(McpServerSettings.validationError(server))
    }

    func testValidationRejectsEmptyOrBadURLForHTTP() {
        let noURL = McpServer(name: "srv", transport: .http, url: "")
        XCTAssertNotNil(McpServerSettings.validationError(noURL))
        let badURL = McpServer(name: "srv", transport: .http, url: "ftp://x")
        XCTAssertNotNil(McpServerSettings.validationError(badURL))
        let good = McpServer(name: "srv", transport: .http, url: "https://mcp.example.com")
        XCTAssertNil(McpServerSettings.validationError(good))
    }

    // MARK: - pi-mcp-extension mapper

    func testJSONPayloadMapsToPiMcpExtensionSchema() throws {
        let servers = [
            McpServer(
                name: "firecrawl",
                enabled: true,
                transport: .stdio,
                command: "npx",
                args: ["-y", "firecrawl-mcp"],
                env: ["FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"]
            ),
            McpServer(
                name: "zhipu",
                enabled: true,
                transport: .http,
                url: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
                headers: ["Authorization": "Bearer ${ZHIPU_API_KEY}"]
            ),
            McpServer(
                name: "disabled",
                enabled: false,
                transport: .stdio,
                command: "should-not-appear"
            ),
        ]

        let payload = try McpServerSettings.jsonPayload(
            servers: servers,
            variables: [
                "FIRECRAWL_API_KEY": "firecrawl-secret",
                "ZHIPU_API_KEY": "zhipu-secret",
            ]
        )
        XCTAssertEqual((payload["settings"] as? [String: Any])?["toolPrefix"] as? String, "mcp")
        XCTAssertNil(payload["servers"])

        let entries = try XCTUnwrap(payload["mcpServers"] as? [String: Any])
        XCTAssertEqual(entries.count, 2, "disabled servers are omitted rather than lazily runnable")

        let firecrawl = try XCTUnwrap(entries["firecrawl"] as? [String: Any])
        XCTAssertEqual(firecrawl["transport"] as? String, "stdio")
        XCTAssertEqual(firecrawl["command"] as? String, "npx")
        XCTAssertEqual(firecrawl["args"] as? [String], ["-y", "firecrawl-mcp"])
        XCTAssertEqual(
            (firecrawl["env"] as? [String: String])?["FIRECRAWL_API_KEY"],
            "firecrawl-secret"
        )
        XCTAssertEqual(firecrawl["lifecycle"] as? String, "eager")
        XCTAssertNil(firecrawl["url"])
        XCTAssertNil(firecrawl["headers"])

        let zhipu = try XCTUnwrap(entries["zhipu"] as? [String: Any])
        XCTAssertEqual(zhipu["transport"] as? String, "streamable-http")
        XCTAssertEqual(
            zhipu["url"] as? String,
            "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"
        )
        XCTAssertEqual(
            (zhipu["headers"] as? [String: String])?["Authorization"],
            "Bearer zhipu-secret"
        )
        XCTAssertEqual(zhipu["lifecycle"] as? String, "eager")
        XCTAssertNil(zhipu["command"])
        XCTAssertNil(entries["disabled"])
    }

    func testSaveWritesPiMcpJSONToExplicitTemporaryURL() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()
        let servers = [
            McpServer(
                name: "brave",
                enabled: true,
                transport: .stdio,
                command: "npx",
                env: ["BRAVE_API_KEY": "${BRAVE_API_KEY}"]
            ),
        ]

        XCTAssertNil(McpServerSettings.save(
            servers,
            defaults: suite,
            to: url,
            variables: ["BRAVE_API_KEY": "brave-secret"]
        ))

        let data = try Data(contentsOf: url)
        let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let server = try XCTUnwrap(
            (payload["mcpServers"] as? [String: Any])?["brave"] as? [String: Any]
        )
        XCTAssertEqual(server["transport"] as? String, "stdio")
        XCTAssertEqual(server["command"] as? String, "npx")
        XCTAssertEqual((server["env"] as? [String: String])?["BRAVE_API_KEY"], "brave-secret")

        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
        XCTAssertEqual(permissions & 0o777, 0o600, "expanded credentials stay in a user-only file")

        XCTAssertEqual(McpServerSettings.servers(defaults: suite), servers)
    }

    func testDisabledToggleRoundTripsAndRemovesServerFromMirror() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()

        var server = McpServer(name: "srv", transport: .http, url: "https://x/mcp")
        XCTAssertNil(McpServerSettings.save([server], defaults: suite, to: url, variables: [:]))
        XCTAssertTrue(McpServerSettings.servers(defaults: suite).first?.enabled == true)

        server.enabled = false
        XCTAssertNil(McpServerSettings.save([server], defaults: suite, to: url, variables: [:]))
        XCTAssertEqual(McpServerSettings.servers(defaults: suite).first?.enabled, false)

        let data = try Data(contentsOf: url)
        let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let entries = try XCTUnwrap(payload["mcpServers"] as? [String: Any])
        XCTAssertNil(entries["srv"])
    }

    func testCleanTrimsWhitespaceOnSave() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()
        let server = McpServer(name: "  srv ", transport: .stdio, command: "  npx ")
        XCTAssertNil(McpServerSettings.save([server], defaults: suite, to: url, variables: [:]))
        let loaded = McpServerSettings.servers(defaults: suite).first
        XCTAssertEqual(loaded?.name, "srv")
        XCTAssertEqual(loaded?.command, "npx")
    }

    func testMissingVariablePreservesExistingMirror() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()
        let original = Data("{\"original\":true}".utf8)
        try original.write(to: url)

        let error = McpServerSettings.save(
            [McpServer(name: "srv", transport: .http, url: "https://x/mcp", headers: ["Authorization": "Bearer ${MISSING}"])],
            defaults: suite,
            to: url,
            variables: [:]
        )

        XCTAssertNotNil(error)
        XCTAssertEqual(try Data(contentsOf: url), original)
    }

    /// A test suite must not rewrite the user's shared MCP config file.
    func testOnlyLiveAppMayWriteSharedMCPServerFile() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let shared = McpServerSettings.configFileURL()
        let before = try? Data(contentsOf: shared)

        XCTAssertNil(McpServerSettings.save(
            [McpServer(name: "srv", transport: .stdio, command: "npx")],
            defaults: suite
        ))

        XCTAssertEqual(
            before,
            try? Data(contentsOf: shared),
            "a test suite must not rewrite the user's MCP server config"
        )
    }
}

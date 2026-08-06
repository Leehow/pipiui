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
        XCTAssertEqual(try McpServerSettings.interpolate("${FIRECRAWL_API_KEY}", variables: ["FIRECRAWL_API_KEY": "sk-123"]), "sk-123")
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

    func testValidationRejectsEmptyOrBadUrlForHttp() {
        let noUrl = McpServer(name: "srv", transport: .http, url: "")
        XCTAssertNotNil(McpServerSettings.validationError(noUrl))
        let badUrl = McpServer(name: "srv", transport: .http, url: "ftp://x")
        XCTAssertNotNil(McpServerSettings.validationError(badUrl))
        let good = McpServer(name: "srv", transport: .http, url: "https://mcp.example.com")
        XCTAssertNil(McpServerSettings.validationError(good))
    }

    // MARK: - JSON schema

    func testJsonPayloadSchemaMatchesBrief() {
        let servers = [
            McpServer(name: "firecrawl", enabled: true, transport: .stdio,
                      command: "npx", args: ["-y", "firecrawl-mcp"],
                      env: ["FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"]),
            McpServer(name: "zhipu", enabled: false, transport: .http,
                      url: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
                      headers: ["Authorization": "Bearer ${ZHIPU_API_KEY}"]),
        ]
        let payload = McpServerSettings.jsonPayload(servers: servers)
        let serversDict = payload["servers"] as? [String: Any]
        XCTAssertNotNil(serversDict)
        XCTAssertEqual(serversDict?.count, 2)

        let fc = serversDict?["firecrawl"] as? [String: Any]
        XCTAssertEqual(fc?["enabled"] as? Bool, true)
        XCTAssertEqual(fc?["transport"] as? String, "stdio")
        XCTAssertEqual(fc?["command"] as? String, "npx")
        XCTAssertEqual(fc?["args"] as? [String], ["-y", "firecrawl-mcp"])
        XCTAssertEqual((fc?["env"] as? [String: String])?["FIRECRAWL_API_KEY"], "${FIRECRAWL_API_KEY}")

        let zp = serversDict?["zhipu"] as? [String: Any]
        XCTAssertEqual(zp?["enabled"] as? Bool, false)
        XCTAssertEqual(zp?["transport"] as? String, "http")
        XCTAssertEqual(zp?["url"] as? String, "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp")
        XCTAssertEqual((zp?["headers"] as? [String: String])?["Authorization"], "Bearer ${ZHIPU_API_KEY}")
    }

    func testSaveWritesRFC822SchemaFile() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()
        let servers = [
            McpServer(name: "brave", enabled: true, transport: .stdio, command: "npx"),
        ]
        McpServerSettings.save(servers, defaults: suite, to: url)

        let data = try Data(contentsOf: url)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let s = (obj?["servers"] as? [String: Any])?["brave"] as? [String: Any]
        XCTAssertEqual(s?["transport"] as? String, "stdio")
        XCTAssertEqual(s?["command"] as? String, "npx")

        // Round-trip through the canonical store.
        let loaded = McpServerSettings.servers(defaults: suite)
        XCTAssertEqual(loaded, servers)
    }

    func testEnabledToggleRoundTrip() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()

        var server = McpServer(name: "srv", transport: .http, url: "https://x/mcp")
        McpServerSettings.save([server], defaults: suite, to: url)
        XCTAssertTrue(McpServerSettings.servers(defaults: suite).first?.enabled == true)

        server.enabled = false
        McpServerSettings.save([server], defaults: suite, to: url)
        XCTAssertEqual(McpServerSettings.servers(defaults: suite).first?.enabled, false)

        let data = try Data(contentsOf: url)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let s = (obj?["servers"] as? [String: Any])?["srv"] as? [String: Any]
        XCTAssertEqual(s?["enabled"] as? Bool, false)
    }

    func testCleanTrimsWhitespaceOnSave() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let url = try tempURL()
        let server = McpServer(name: "  srv ", transport: .stdio, command: "  npx ")
        McpServerSettings.save([server], defaults: suite, to: url)
        let loaded = McpServerSettings.servers(defaults: suite).first
        XCTAssertEqual(loaded?.name, "srv")
        XCTAssertEqual(loaded?.command, "npx")
    }

    /// A test suite must not rewrite the user's shared MCP config file.
    func testOnlyLiveAppMayWriteSharedMCPServerFile() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let shared = McpServerSettings.configFileURL()
        let before = try? Data(contentsOf: shared)

        McpServerSettings.save([McpServer(name: "srv", transport: .stdio, command: "npx")], defaults: suite)

        XCTAssertEqual(before, try? Data(contentsOf: shared),
                       "a test suite must not rewrite the user's MCP server config")
    }

    // MARK: - Generated TS contract

    private func generatedSource() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-mcp-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(McpBridgeExtension.install(into: dir))
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    func testGeneratedTSHasBothTransportsAndNaming() throws {
        let source = try generatedSource()
        XCTAssertTrue(source.contains("child_process"), "stdio transport must use child_process")
        XCTAssertTrue(source.contains("spawn(command"))
        XCTAssertTrue(source.contains("tools/call"), "must forward tools/call")
        XCTAssertTrue(source.contains("tools/list"), "must discover tools")
        XCTAssertTrue(source.contains("notifications/initialized"))
        XCTAssertTrue(source.contains("mcp_${name}_${tool.name}"), "tool naming mcp_<server>_<tool>")
        XCTAssertTrue(source.contains("PIPIUI_MCP_CONFIG_FILE"), "config file env override")
        XCTAssertTrue(source.contains("expandVars"), "env interpolation")
        XCTAssertTrue(source.contains("session_shutdown"), "must kill children on shutdown")
    }

    func testGeneratedTSDoesNotLeakSecrets() throws {
        let source = try generatedSource()
        XCTAssertTrue(source.contains("environment variable ${name} is not set"),
                      "missing var error must name only the variable, not a secret")
        XCTAssertFalse(source.contains("ZHIPU_API_KEY =\""), "no hardcoded secret assignments")
    }
}
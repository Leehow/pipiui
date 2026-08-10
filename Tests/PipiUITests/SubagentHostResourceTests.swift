import Foundation
import XCTest
@testable import PipiUI

final class SubagentHostResourceTests: XCTestCase {
    func testBundledPortableHostContractAndGoldenFixtureRemainSwiftReadable() throws {
        let piExt = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let host = piExt.appendingPathComponent("subagent-host", isDirectory: true)
        let subagent = piExt.appendingPathComponent("subagent", isDirectory: true)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: subagent.appendingPathComponent("host-bridge.ts").path),
            "missing bundled PiExt/subagent/host-bridge.ts"
        )

        for relativePath in [
            "index.ts",
            "contract.ts",
            "env.ts",
            "server.ts",
            "runtime.ts",
            "electron-main.ts",
            "state/index.ts",
            "worktree/index.ts",
            "fixtures/host-capabilities-v1.json",
            "fixtures/agent-events-v1.json",
            "fixtures/plan-events-v1.json",
            "fixtures/jobs-snapshot-v1.json",
            "fixtures/current-bridge-compat-v0.json",
        ] {
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: host.appendingPathComponent(relativePath).path),
                "missing bundled PiExt/subagent-host/\(relativePath)"
            )
        }

        let fixtureURL = host.appendingPathComponent("fixtures/host-capabilities-v1.json")
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any]
        )
        XCTAssertEqual(object["schemaVersion"] as? Int, 1)

        let legacyFixtureURL = host.appendingPathComponent("fixtures/current-bridge-compat-v0.json")
        let legacyFixture = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: legacyFixtureURL)) as? [String: Any]
        )
        let currentAgentUpdate = try XCTUnwrap(legacyFixture["currentAgentUpdate"] as? [String: Any])
        XCTAssertEqual(currentAgentUpdate["runId"] as? String, "run-a")
    }
}

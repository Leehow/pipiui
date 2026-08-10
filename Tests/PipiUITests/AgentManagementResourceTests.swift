import XCTest
@testable import PipiUI

final class AgentManagementResourceTests: XCTestCase {
    func testBundledManagementExtensionAndCreateSkillShipAsResources() throws {
        let piExt = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let management = piExt.appendingPathComponent("subagent/agent-management.ts")
        XCTAssertTrue(FileManager.default.fileExists(atPath: management.path))
        let managementSource = try String(contentsOf: management, encoding: .utf8)
        XCTAssertTrue(managementSource.contains("name: \"subagent_manage\""))
        XCTAssertTrue(managementSource.contains("version: 1"))
        XCTAssertTrue(managementSource.contains("never dispatches or starts an agent"))

        let skillRoot = try XCTUnwrap(BuiltInSkillResources.bundledURL())
        let skill = try String(
            contentsOf: skillRoot.appendingPathComponent("create-subagent/SKILL.md"),
            encoding: .utf8
        )
        XCTAssertTrue(skill.contains("subagent_manage"))
        XCTAssertTrue(skill.contains("action:\"scaffold\""))
        XCTAssertTrue(skill.contains("action:\"install\""))
    }
}

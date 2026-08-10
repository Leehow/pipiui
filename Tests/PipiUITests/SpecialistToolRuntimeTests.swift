import XCTest
@testable import PipiUI

/// The web runtime is now the reviewed managed npm package, so specialist
/// coverage verifies the host routing contract without executing a copied
/// generated TypeScript extension under local mocks.
final class SpecialistToolRuntimeTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testManagedWebAccessOwnsSpecialistWebAndGitHubRoutes() throws {
        let root = repositoryRoot()
        let plugin = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        let policy = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/desktop-tool-policy.mjs"),
            encoding: .utf8
        )

        XCTAssertTrue(plugin.contains("WebAccessPackage.ensureInstalled()"))
        XCTAssertTrue(policy.contains("\"fetch_content\""))
        XCTAssertTrue(policy.contains("\"source_check\""))
        XCTAssertTrue(policy.contains("\"get_search_content\""))
    }
}

import XCTest
@testable import PipiUI

final class ComputerAgentResourceTests: XCTestCase {
    func testBundledPiExtContainsCanonicalM2ComputerAgentResources() throws {
        let piExt = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let required = [
            "subagent/index.ts",
            "agents/computer-use-leader/AGENT.md",
            "agents/operator/AGENT.md",
            "agents/computer-verifier/AGENT.md",
            "agents/computer-terminal/AGENT.md",
            "packages/computer-agent/package.json",
            "packages/computer-agent/src/index.ts",
            "packages/computer-agent/extensions/computer-worker.ts",
            "packages/computer-agent/extensions/computer-terminal.ts",
            "packages/computer-agent/skills/terminal-investigation/SKILL.md",
            "packages/computer-agent/skills/procedure-learning/SKILL.md",
        ]

        for relativePath in required {
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: piExt.appendingPathComponent(relativePath).path),
                "missing bundled PiExt/\(relativePath)"
            )
        }
    }
}

import XCTest
@testable import PipiUI

/// How the runtime must treat an agent is a property of that agent, declared in its own
/// frontmatter next to `tools` and `model`.
///
/// It used to be four unrelated name checks in the dispatcher — a read-only `Set` here,
/// `=== "lead"` there, `=== "plan"` somewhere else. Nothing connected them, so adding an agent
/// silently produced four wrong answers with no error: absent from the read-only set, a
/// report-shaped worker got a persisted session and a `verify` it could never satisfy.
final class AgentTraitsTests: XCTestCase {
    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func source(_ relative: String) throws -> String {
        try String(contentsOf: repositoryRoot().appendingPathComponent(relative), encoding: .utf8)
    }

    private func frontmatter(_ agent: String) throws -> [String: String] {
        let text = try source("Sources/PipiUI/PiExt/agents/\(agent).md")
        let parts = text.components(separatedBy: "---")
        guard parts.count >= 3 else { return [:] }
        var fields: [String: String] = [:]
        for line in parts[1].split(separator: "\n") {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[line.startIndex..<colon].trimmingCharacters(in: .whitespaces)
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            fields[key] = value
        }
        return fields
    }

    func testTraitsAreParsedFromFrontmatterWithConservativeDefaults() throws {
        let s = try source("Sources/PipiUI/PiExt/subagent/agents.ts")
        XCTAssertTrue(s.contains("export interface AgentTraits"))
        XCTAssertTrue(s.contains("export function parseAgentTraits"))
        XCTAssertTrue(s.contains(#"readOnly: flag(frontmatter["read-only"])"#))
        XCTAssertTrue(s.contains("delegates: flag(frontmatter.delegates)"))
        XCTAssertTrue(s.contains(#"blockSkillReads: flag(frontmatter["block-skill-reads"])"#))
        // Read through the same string coercion as every other field: pi parses frontmatter as
        // real YAML, so a value that is not a string must not reach .trim().
        XCTAssertTrue(s.contains(#"reportsInFull: str(frontmatter.deliverable)?.trim().toLowerCase() === "report""#))
        XCTAssertTrue(s.contains("traits: parseAgentTraits(frontmatter)"))
        // An absent or misspelled key must land on the plain-worker answer, which is what an
        // unlisted name already got before the traits existed.
        XCTAssertTrue(s.contains(#"return v === "true" || v === "yes" || v === "1";"#))
    }

    /// The shipped definitions have to reproduce exactly what the name checks used to decide,
    /// or this refactor is a silent behaviour change rather than a move.
    func testShippedAgentsDeclareTheBehaviourTheNameChecksUsedToGive() throws {
        for readOnly in ["explore", "plan", "reviewer"] {
            XCTAssertEqual(try frontmatter(readOnly)["read-only"], "true",
                           "\(readOnly) was in READ_ONLY_AGENTS")
        }
        for report in ["explore", "plan"] {
            XCTAssertEqual(try frontmatter(report)["deliverable"], "report",
                           "\(report) had REPORT_DONE_CAP")
        }
        // reviewer was read-only but never got the report cap; it returns a verdict.
        XCTAssertNil(try frontmatter("reviewer")["deliverable"])
        XCTAssertEqual(try frontmatter("plan")["block-skill-reads"], "true")
        XCTAssertNil(try frontmatter("explore")["block-skill-reads"])
        XCTAssertEqual(try frontmatter("lead")["delegates"], "true")
        for plain in ["general-purpose", "reviewer", "explore", "plan", "secretary"] {
            XCTAssertNil(try frontmatter(plain)["delegates"], "\(plain) must not get orchestration layers")
        }
    }

    /// Traits only ever narrow an agent, so a definition that lies costs itself capability.
    /// The secretary's worktree and delegation ban are the two that *grant*, so they stay
    /// runtime-owned — a project-scoped `secretary.md` must not vote on them.
    func testGrantingPolicyStaysRuntimeOwnedAndNoOtherNameCheckSurvives() throws {
        let s = try source("Sources/PipiUI/PiExt/subagent/index.ts")
        XCTAssertTrue(s.contains(#"if (agentName === "secretary")"#))
        XCTAssertTrue(s.contains("must not be able to hand itself either by editing its own frontmatter"))

        for name in ["explore", "plan", "reviewer", "lead", "general-purpose"] {
            XCTAssertFalse(s.contains("agentName === \"\(name)\""),
                           "\(name) must be decided by its traits, not by its name")
        }
        XCTAssertFalse(s.contains("READ_ONLY_AGENTS"))
        XCTAssertFalse(s.contains("doneCapForAgent"))
    }

    /// The done formatter runs far from the definition, so the trait rides on the result.
    func testDoneCapFollowsTheDeclaredDeliverable() throws {
        let s = try source("Sources/PipiUI/PiExt/subagent/index.ts")
        XCTAssertTrue(s.contains("reportsInFull?: boolean;"))
        XCTAssertTrue(s.contains("reportsInFull: agent.traits.reportsInFull,"))
        XCTAssertTrue(s.contains("return result.reportsInFull ? REPORT_DONE_CAP : VERDICT_DONE_CAP;"))
        XCTAssertTrue(s.contains("doneCapForResult(result, isError)"))
    }
}

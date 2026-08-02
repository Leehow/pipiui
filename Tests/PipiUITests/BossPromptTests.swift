import XCTest
@testable import PipiUI

/// The Boss protocol owns the session's process end to end: it carries its own planning
/// route (no model tiers, no difficulty labels) and treats any installed skill library as
/// opt-in advice it must translate rather than obey.
final class BossPromptTests: XCTestCase {
    private func installedBossPrompt() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-boss-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return try String(contentsOfFile: try XCTUnwrap(BossPrompt.install(into: dir)),
                          encoding: .utf8)
    }

    /// Difficulty tiers were a classification ritual the model paid for on every goal, and
    /// a heavy tier pulled trivial work into recon + planning + review. The judgement stays;
    /// the labels and the mandatory visible triage line are gone.
    func testNoDifficultyTiersOrClassificationRitual() throws {
        let text = try installedBossPrompt()

        XCTAssertTrue(text.contains("## Calibrate the process yourself"))
        XCTAssertTrue(text.contains("There are no difficulty tiers and no classification ritual"))
        XCTAssertTrue(text.contains("Never emit a\ndifficulty label or announce a level"))
        // The anti-ceremony force the tiers used to carry must survive as judgement.
        XCTAssertTrue(text.contains("Process weight must match the work"))
        XCTAssertTrue(text.contains("Add a step only when you can name what it would catch"))
        XCTAssertTrue(text.contains("When the route is unclear, take the cheap one first"))
        // Correctness rules that were embedded in the old level list, not process weight.
        XCTAssertTrue(text.contains("Research / analysis-only requests are terminal"))
        XCTAssertTrue(text.contains("do\n  not invent a code change the user did not request"))
        XCTAssertTrue(text.contains("never completion of a change request"))

        for label in ["[T0", "T0 trivial", "T1 simple", "T2 medium", "T3 complex",
                      "T1/T2", "T0/T1", "T2/T3", "triage line", "Triage first"] {
            XCTAssertFalse(text.contains(label),
                           "difficulty tiering must be gone (found \(label))")
        }
    }

    /// The planning route used to live in a separate model-tier extension that gave weak
    /// models a mandatory route. One route now, owned by this prompt.
    func testSelfContainedPlanningRouteWithoutModelTiers() throws {
        let text = try installedBossPrompt()

        XCTAssertTrue(text.contains("## Planning"))
        XCTAssertTrue(text.contains("the plan is a short numbered list of dispatchable steps"))
        XCTAssertTrue(text.contains("lightweight `plan` subagent"))
        XCTAssertTrue(text.contains("Never present an execution-mode menu"))
        XCTAssertTrue(text.contains("third worker before any\ncode is written"))
        XCTAssertFalse(text.contains("appended below"),
                       "no tier extension appends a second route any more")
        for tier in ["weak model", "strong model", "model-tier", "model tier", "capable model"] {
            XCTAssertFalse(text.lowercased().contains(tier.lowercased()),
                           "planning must not branch on model tier (found \(tier))")
        }
    }

    /// The plan loop that motivated the decoupling: a design doc, a plan doc, a review of
    /// the plan doc, and a re-plan when the read-only planner could not write the file.
    /// The protocol must forbid each of those by name, not merely stop recommending them.
    func testForbidsPlanArtifactCeremony() throws {
        let text = try installedBossPrompt()

        XCTAssertTrue(text.contains("Plans are lists, not documents"))
        XCTAssertTrue(text.contains("unless the user asked for that document"))
        XCTAssertTrue(text.contains("MUST NOT run a design→approval→plan→plan-review sequence"))
        XCTAssertTrue(text.contains("Never dispatch a reviewer to\n  review a plan document"))
        XCTAssertTrue(text.contains("MUST omit `verify`"))
        XCTAssertTrue(text.contains("Never re-dispatch a read-only worker to\n  make a shell command pass"))
    }

    /// Skills are advice from another harness, so the protocol states how to translate the
    /// collisions instead of letting a skill re-take ownership of the session.
    func testSkillLibraryIsOptInAndTranslated() throws {
        let text = try installedBossPrompt()

        XCTAssertTrue(text.contains("The skill library is opt-in"))
        XCTAssertTrue(text.contains("never tell a worker to invoke a skill"))
        XCTAssertTrue(text.contains("translate rather than obey"))
        XCTAssertTrue(text.contains("the\n  brief is that confirmation"),
                      "a skill demanding mid-flow user confirmation must not stall a worker")
        XCTAssertTrue(text.contains("Workers have no channel to the user"))
        XCTAssertTrue(text.contains("`Task`, `Agent`, or \"a general-purpose subagent\""),
                      "foreign dispatch verbs must map onto the subagent tool")
        XCTAssertTrue(text.contains("two\n  `reviewer` tasks in one call"))
        XCTAssertTrue(text.contains("issue tracker, tickets, PRDs, or labels"))
        XCTAssertTrue(text.contains("do not create tickets or issues"))
        XCTAssertTrue(text.contains("is not\n  BLOCKED until two materially different routes have failed"))
        // A named external skill is how the protocol lost ownership last time.
        for skill in ["using-superpowers", "writing-plans", "brainstorming",
                      "subagent-driven-development", "Superpowers"] {
            XCTAssertFalse(text.contains(skill),
                           "boss protocol must not name an external skill (found \(skill))")
        }
        XCTAssertFalse(text.contains("dispatching-parallel-agents"))
    }
}

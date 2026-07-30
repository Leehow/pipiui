import XCTest
@testable import PipiUI

/// Content guards for the four philosophy layers, ported from the old single boss prompt.
///
/// These pin *meaning*, not line wrapping: assertions run against whitespace-normalized text
/// so re-flowing a paragraph cannot fail a test that is really about a rule still being there.
final class PhilosophyLayerTests: XCTestCase {
    private func layer(_ id: String) throws -> PhilosophySettings.Layer {
        try PhilosophyLayerFixture.layer(id)
    }

    private func text(_ id: String) throws -> String {
        try PhilosophyLayerFixture.normalizedBody(id)
    }

    private func normalized(_ s: String) -> String {
        PhilosophyLayerFixture.normalize(s)
    }

    private func assertContains(_ haystack: String, _ needle: String,
                                _ message: String = "", line: UInt = #line) {
        XCTAssertTrue(haystack.contains(normalized(needle)),
                      message.isEmpty ? "missing: \(needle)" : message, line: line)
    }

    // MARK: - Structure

    func testFourLayersWithDeclaredDependency() throws {
        let layers = try PhilosophyLayerFixture.layers()
        XCTAssertEqual(layers.map(\.id), ["foundation", "method", "orchestration", "fanout"])
        XCTAssertEqual(try layer("fanout").requires, ["orchestration"])
        for id in ["foundation", "method", "orchestration"] {
            XCTAssertTrue(try layer(id).requires.isEmpty, "\(id) must stand alone")
        }
        for l in layers {
            XCTAssertFalse(l.name.isEmpty)
            XCTAssertFalse(l.summary.isEmpty, "\(l.id) needs a summary for the settings row")
        }
    }

    /// The whole point of the split: judgement rules must not be hostage to the delegation
    /// protocol. Turning orchestration off must not cost you the confirmation gate.
    func testJudgementRulesLiveOutsideOrchestration() throws {
        let foundation = try text("foundation")
        assertContains(foundation, "Authorization is established by the request")
        assertContains(foundation, "No early stopping")
        assertContains(foundation, "Evidence outranks authority")
        let orchestration = try text("orchestration")
        XCTAssertFalse(orchestration.contains(normalized("No early stopping")),
                       "failure recovery belongs to foundation, not to the dispatch protocol")

        // Craft belongs to method: delete foundation and the agent becomes untrustworthy;
        // delete method and it stays trustworthy but works badly.
        let method = try text("method")
        assertContains(method, "Process weight must match the work")
        assertContains(method, "Plans are lists, not documents")
        assertContains(method, "Write the minimum that solves it")
        assertContains(method, "Change only what the task requires")
        for craft in ["Process weight must match the work", "Plans are lists, not documents"] {
            XCTAssertFalse(foundation.contains(normalized(craft)),
                           "\(craft) is craft, not an axiom of the relationship")
        }
    }

    // MARK: - Ported content guards

    /// Difficulty tiers were a classification ritual paid for on every goal, and a heavy tier
    /// pulled trivial work into recon + planning + review. The judgement stays; labels do not.
    func testNoDifficultyTiersOrClassificationRitual() throws {
        let t = try text("method")
        assertContains(t, "There are no difficulty tiers and no classification ritual")
        assertContains(t, "Never emit a difficulty label and never announce a level")
        assertContains(t, "Process weight must match the work")
        assertContains(t, "Add a step only when you can name what it would catch that the previous step did not")
        assertContains(t, "When the route is unclear, take the cheap one first")
        assertContains(t, "Research and analysis-only requests are terminal")
        assertContains(t, "do not invent a code change the user did not request")
        assertContains(t, "never completion of a change request")

        let all = try PhilosophyLayerFixture.allNormalizedBodies()
        for label in ["[T0", "T0 trivial", "T1 simple", "T2 medium", "T3 complex",
                      "T1/T2", "T0/T1", "T2/T3", "triage line", "Triage first"] {
            XCTAssertFalse(all.contains(label), "difficulty tiering must be gone (found \(label))")
        }
    }

    /// One planning route, owned by the philosophy — never branching on how strong the model is.
    func testSelfContainedPlanningRouteWithoutModelTiers() throws {
        let t = try text("orchestration")
        assertContains(t, "## Planning")
        assertContains(t, "the plan is a short numbered list of dispatchable steps")
        assertContains(t, "lightweight `plan` worker")
        // "whichever is proportionate" put self-service first and gave no criterion, so the
        // boss always wrote it. The criterion is what it already knows, not how big it feels.
        assertContains(t, "Who writes it follows from what you already know, never from how large the goal feels")
        assertContains(t, "if working out the decomposition means reading code nobody has read yet, that is a lightweight `plan` worker, not a longer think")
        // "if a brief is complete enough to dispatch, no plan is needed" was always true —
        // briefs are required to be complete — so it read as a standing ban on the agent.
        assertContains(t, "It never rules out dispatching a `plan` worker to work the steps out in the first place")
        assertContains(t, "you cannot put steps in a brief that nobody has established yet")
        assertContains(t, "MUST NOT present, relay, or ask the user to choose an execution-mode menu")
        assertContains(t, "third round of workers before any code is written")
        // Counting workers rather than rounds made a wide research fan-out illegal, which the
        // research route and the lead's ≥4 trigger both assume is legal.
        assertContains(t, "capped at two rounds, not at two workers")
        assertContains(t, "A wave of parallel `explore`s is one round however wide it is")
        assertContains(t, "more independent questions means more workers at once, never more rounds")

        let all = try PhilosophyLayerFixture.allNormalizedBodies()
        for tier in ["weak model", "strong model", "model-tier", "model tier", "capable model"] {
            XCTAssertFalse(all.lowercased().contains(tier.lowercased()),
                           "planning must not branch on model tier (found \(tier))")
        }
    }

    /// The plan loop that motivated all of this: a design doc, a plan doc, a review of the plan
    /// doc, and a re-plan when the read-only planner could not write the file.
    func testForbidsPlanArtifactCeremony() throws {
        let method = try text("method")
        assertContains(method, "Plans are lists, not documents")
        assertContains(method, "a spec / design / plan / review document by default")
        assertContains(method, "write one when the user asked for it, or when you have judged this specific goal large enough")
        assertContains(method, "exception to the two rules above, not a way around them")
        assertContains(method, "stays: one planning step, no document")
        assertContains(method, "MUST NOT run a design → approval → plan → plan-review sequence")

        let orchestration = try text("orchestration")
        assertContains(orchestration, "MUST omit `verify`")
        assertContains(orchestration, "Never re-dispatch a read-only worker to make a shell command pass")
        assertContains(orchestration, "never dispatch a reviewer to review a plan document")
    }

    /// Persistent coordination state is required once delegation begins, but merely loading
    /// the orchestration philosophy must not make an ordinary direct task probe the shell.
    func testLedgerDiscoveryIsLazyUntilRealOrchestration() throws {
        let orchestration = try text("orchestration")

        assertContains(
            orchestration,
            "Ledger discovery is lazy"
        )
        assertContains(
            orchestration,
            "Ordinary direct tasks — including web research, {{browser}} or desktop operations, simple read-only questions, and single-lane direct work — MUST NOT read `PIPIUI_SESSION_KEY`, inspect `.pi/boss/`, create or read a ledger, or run shell merely to discover ledger state"
        )
        assertContains(
            orchestration,
            "The trigger is this session actually deciding to dispatch or otherwise entering real multi-worker coordination"
        )
        // The runtime now creates the file at that same trigger, so the layer points at it
        // instead of carrying ~380 tokens of layout on every turn.
        assertContains(
            orchestration,
            "the runtime has already created your ledger under `.pi/boss/`"
        )
        assertContains(orchestration, "Find it, fill it in, and keep it current")
        assertContains(
            orchestration,
            "From that point onward, update the ledger BEFORE acting"
        )
        assertContains(
            orchestration,
            "After context compaction, or whenever compaction is suspected during active orchestration, re-read this session's own ledger before acting"
        )
        assertContains(
            orchestration,
            "Other ledger files under `.pi/boss/` belong to other sessions"
        )
        XCTAssertFalse(
            orchestration.contains(normalized(
                "At session start, if this session's own ledger already exists"
            )),
            "session start alone must not trigger a ledger probe"
        )
    }

    /// Search is for cross-checking a hypothesis you already formed — not a first move and not
    /// a mandatory step. Tool names must be placeholders so a pi rename stays a one-line edit.
    func testSearchComesAfterThinkingAndIsNeverMandatory() throws {
        let t = try text("method")
        assertContains(t, "Form your own read of the problem before you search")
        assertContains(t, "anchors you to")
        assertContains(t, "{{search}}")
        assertContains(t, "{{fetch}}")
        assertContains(t, "it is triage, not floor work")
        assertContains(t, "Skip it when you already know the fix")
        assertContains(t, "probably not unique to this codebase")
        assertContains(t, "prior art would sharpen or overturn your plan")
        assertContains(t, "unverified assumption about")
        assertContains(t, "This is a judgement call, never a mandatory step")

        // What counts as proof is an axiom, so it sits in foundation, not in craft.
        let foundation = try text("foundation")
        assertContains(foundation, "Evidence outranks authority")
        assertContains(foundation, "evidence, not authority")
        assertContains(foundation, "A command nobody ran is reported as \"not executed\"")
    }

    /// Skills are advice from another harness, so the philosophy states how to translate the
    /// collisions instead of letting a skill re-take ownership of the session.
    func testExternalWorkflowsAreTranslatedNotObeyed() throws {
        let foundation = try text("foundation")
        assertContains(foundation, "translate rather than obey")
        assertContains(foundation, "the brief is the confirmation")
        assertContains(foundation, "When you have no channel to the user")
        assertContains(foundation, "is not BLOCKED until two materially different routes have failed")

        let orchestration = try text("orchestration")
        assertContains(orchestration, "never tell a worker to invoke a skill")
        assertContains(orchestration, "`Task`, `Agent`, or \"a general-purpose sub-agent\"")
        assertContains(orchestration, "two reviewer tasks in one call")
        assertContains(orchestration, "issue tracker, tickets, PRDs, or labels")
        assertContains(orchestration, "do not create tickets or issues")

        let all = try PhilosophyLayerFixture.allNormalizedBodies()
        for skill in ["using-superpowers", "writing-plans", "brainstorming",
                      "subagent-driven-development", "Superpowers", "dispatching-parallel-agents"] {
            XCTAssertFalse(all.contains(skill), "must not name an external skill (found \(skill))")
        }
    }

    /// A dispatched `lead` delegates, so it must be marked as a lead rather than a worker;
    /// depth alone cannot tell them apart, and a plain worker taught to fan out would fight
    /// the recursion guard.
    func testSubagentExtensionMarksLeadsSeparatelyFromWorkers() throws {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let source = try String(
            contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
        XCTAssertTrue(source.contains("PIPI_PHILOSOPHY_ROLE: agentName === \"lead\" ? \"lead\" : \"worker\""))
    }

    /// Dropping the tier table took the only route that named `explore` with it, leaving four
    /// rules arguing against recon and none for it — so the boss grepped everything itself.
    /// The routing has to be stated where delegation lives, not inferred from a cost model.
    func testInvestigationIsRoutedToExploreNotDoneByTheBoss() throws {
        let t = try text("orchestration")
        assertContains(t, "a handful of locating reads to size a goal or answer the user")
        assertContains(t, "Past a handful of reads, that is an `explore`, not your own grep")
        assertContains(t, "a sweep across directories, call sites, or naming conventions")
        assertContains(t, "it is never a reason to run a search yourself")
        // The cost model priced the worker's report and left self-service looking free, which
        // is the arithmetic that made "do it myself" win every weighing.
        assertContains(t, "reading files yourself spends that same resource")
        assertContains(t, "Self-service is not the cheap option")
        assertContains(t, "A research or analysis-only goal is delegated like any other")
        assertContains(t, "one `explore` for a contained question, several over non-overlapping partitions")
        assertContains(t, "before answering about code you have not read")
    }

    /// "One worker for a contained change" next to a section headed "One worker per vertical
    /// slice" outvoted the fan-out layer, which the boss only reaches ~7k tokens later.
    func testWorkerCountFollowsIndependenceNotSize() throws {
        let t = try text("orchestration")
        assertContains(t, "Two unrelated changes are two workers in one dispatch")
        assertContains(t, "never one worker told to do both")
        assertContains(t, "independence decides the count, size does not")

        let fanout = try text("fanout")
        assertContains(fanout, "Two unrelated small changes are two workers")
        assertContains(fanout, "one worker told to cover several independent sub-items")
    }

    /// `{{agents}}` used to render five bare names, so a rule saying "delegate this" left the
    /// boss without a way to answer "to whom" — and an unrecognized name resolves as "do it
    /// myself". Each entry now carries when to reach for it, written for the boss routing a
    /// task rather than for the agent describing itself.
    func testRosterTellsTheBossWhenToReachForEachAgent() throws {
        let table = try capabilityTable()
        let agents = try XCTUnwrap(table["agents"] as? [[String: String]],
                                   "the roster must be entries with a `use`, not bare strings")
        let byName = Dictionary(uniqueKeysWithValues: agents.compactMap { entry in
            entry["name"].map { ($0, entry["use"] ?? "") }
        })

        for required in ["explore", "plan", "general-purpose", "reviewer", "lead", "secretary"] {
            let use = try XCTUnwrap(byName[required], "\(required) is missing from the roster")
            XCTAssertFalse(use.isEmpty, "\(required) has no `use` text")
        }
        // The two the boss could not infer from the name alone are the whole point.
        XCTAssertTrue(byName["plan"]?.contains("depends on code nobody has read yet") == true)
        XCTAssertTrue(byName["lead"]?.contains("keep a wide wave out of your context") == true)

        let body = try PhilosophyLayerFixture.normalizedBody("orchestration")
        assertContains(body, "Your roster: {{agents}}")
        assertContains(body, "A name whose purpose you cannot recall is one to look up here")
    }

    /// The roster is hand-written in capabilities.json because the philosophy package cannot
    /// reach PiExt's agent directory. Nothing stops the two drifting, so the names are pinned
    /// to the definitions that actually ship.
    func testEveryRosterNameHasAnAgentDefinition() throws {
        let table = try capabilityTable()
        let agents = try XCTUnwrap(table["agents"] as? [[String: String]])
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        for entry in agents {
            let name = try XCTUnwrap(entry["name"])
            let definition = root.appendingPathComponent("Sources/PipiUI/PiExt/agents/\(name).md")
            XCTAssertTrue(FileManager.default.fileExists(atPath: definition.path),
                          "roster names \(name) but no agents/\(name).md ships")
        }
    }

    private func capabilityTable() throws -> [String: Any] {
        let bundled = try XCTUnwrap(PhilosophyPackage.bundledURL)
        let data = try Data(contentsOf: bundled.appendingPathComponent("capabilities.json"))
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// Layer bodies sit in the cached prefix of every request; English is roughly half the
    /// tokens of the equivalent Chinese. Frontmatter (name/summary) is UI text and may be
    /// Chinese — only the body that reaches the model is pinned.
    func testLayerBodiesStayEnglish() throws {
        for id in ["foundation", "method", "orchestration", "fanout"] {
            let han = try layer(id).body.unicodeScalars.filter { (0x4E00...0x9FFF).contains($0.value) }
            XCTAssertTrue(han.isEmpty, "\(id) body must stay English (found \(han.count) Han chars)")
        }
    }
}

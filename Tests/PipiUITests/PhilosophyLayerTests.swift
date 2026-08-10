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

    /// Foundation is a runtime prompt layer (including worker scope), so the host lifecycle
    /// rule must stay in the injected prompt rather than only in repository documentation.
    func testFoundationInjectedPromptGuardsPipiUIHostLifecycle() throws {
        let prompt = try text("foundation")
        assertContains(prompt, "## PipiUI host lifecycle is user-authorized")
        assertContains(prompt, "Never execute `kill`, `pkill`, `killall`, Force Quit")
        assertContains(prompt, "`NSRunningApplication.terminate()`")
        assertContains(prompt, "`NSRunningApplication.forceTerminate()`")
        assertContains(prompt, "or an equivalent mechanism against it")
        assertContains(prompt, "Never automatically open, launch, or relaunch PipiUI after a build, package, or update")
        assertContains(prompt, "Package only, then tell the user to quit and reopen PipiUI manually")
        assertContains(prompt, "The sole exception is when the current user explicitly requests that PipiUI be terminated or restarted")
        assertContains(prompt, "Never infer that request, and never use termination or restart as a verification step")
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
        // research route assumes is legal at any width under the boss.
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

    /// Formal planning is the main LLM's automatic judgement: explicit plan/spec asks or
    /// genuinely substantial work load `to-spec` when present, show and publish the plan, then
    /// wait for a natural-language approval decision mapped to internal lifecycle actions.
    func testAutomaticFormalPlanningSkillTranscriptAndStructuredPublish() throws {
        let method = try text("method")
        assertContains(method, "## Automatic formal-planning judgement")
        assertContains(method, "You automatically judge whether this goal needs a detailed executable plan")
        assertContains(method, "explicit approval boundary")
        assertContains(method, "explicitly** asked for a plan, a spec")
        assertContains(method, "genuinely substantial or decomposition-heavy")
        assertContains(method, "Small, local, single-file, one-line, question-only")
        assertContains(method, "MUST stay direct")
        assertContains(method, "skill_search(\"spec plan\")")
        assertContains(method, "skill_load(\"to-spec\")")
        assertContains(method, "fall back without blocking")
        assertContains(method, "main assistant transcript")
        assertContains(method, "not only as a Markdown file artifact")
        assertContains(method, "approval invitation in the user's language")
        assertContains(method, "Do not ask the user to choose, type, or repeat the internal **Execute**, **Adjust**, or **Ignore** lifecycle labels")
        assertContains(method, "Classify their natural-language reply semantically")
        assertContains(method, "approval is Execute")
        assertContains(method, "a request to revise with feedback is Adjust")
        assertContains(method, "a refusal or cancellation is Ignore")
        assertContains(method, "Do not dispatch business-code work")

        let orchestration = try text("orchestration")
        assertContains(orchestration, "automatic formal-planning judgement has fired")
        assertContains(orchestration, "skill_search(\"spec plan\")")
        assertContains(orchestration, "skill_load(\"to-spec\")")
        assertContains(orchestration, "fall back without blocking")
        assertContains(orchestration, "main assistant transcript")
        assertContains(orchestration, "not only as a Markdown artifact")
        assertContains(orchestration, "plan_publish")
        assertContains(orchestration, "plan_task_update")
        assertContains(orchestration, "plan_approve")
        assertContains(orchestration, "plan_cancel")
        assertContains(orchestration, "stable unique `plan.id`")
        assertContains(orchestration, "same `planId`")
        assertContains(orchestration, "ordered tasks")
        assertContains(orchestration, "During authorized execution")
        assertContains(orchestration, "Tool absence is not BLOCKED")
        assertContains(orchestration, "After formal publish, stop and await exactly one natural-language user response")
        assertContains(orchestration, "never ask the user to choose or type **Execute**, **Adjust**, or **Ignore**")
        assertContains(orchestration, "a request to adjust or revise with feedback as Adjust")
        assertContains(orchestration, "a refusal or cancellation as Ignore")
        assertContains(orchestration, "Before an approval classified as Execute, MUST NOT dispatch business-code work")
        assertContains(orchestration, "On an approval classified as Execute, call `plan_approve`")
        assertContains(orchestration, "MUST NOT present an execution-mode menu")
        // Existing automatic-routing ban stays the product rule; formal planning must not
        // reintroduce a user-facing mode choice after the plan is written.
        assertContains(orchestration, "MUST NOT present, relay, or ask the user to choose an execution-mode menu")

        let all = try PhilosophyLayerFixture.allNormalizedBodies()
        for banned in ["please approve this plan", "reply approve to continue",
                       "ask the user to choose exactly one next action: **execute**, **adjust**, or **ignore**",
                       "after formal publish, stop and await exactly one user response: **execute**, **adjust**, or **ignore**",
                       "until the user says execute", "choose execution mode", "delegated execution versus"] {
            XCTAssertFalse(all.lowercased().contains(banned),
                           "formal planning must not add an approval/mode gate (found \(banned))")
        }
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
    /// a mandatory step. Who runs it follows tooling first (native → explore → {{search}}
    /// fallback). Tool names must be placeholders so a pi rename stays a one-line edit.
    func testSearchComesAfterThinkingAndIsNeverMandatory() throws {
        let t = try text("method")
        assertContains(t, "Form your own read of the problem before you search")
        assertContains(t, "anchors you to")
        assertContains(t, "{{search}}")
        assertContains(t, "{{fetch}}")
        // Who runs the search follows tooling first, then question size; direct {{search}}
        // is only the last-resort fallback when there is no native search and explore failed.
        assertContains(t, "Who does the searching follows your tooling first")
        assertContains(t, "No native search: delegate first")
        assertContains(t, "only as the last resort")
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

    /// Philosophy role "lead" is assigned by the runtime ternary when an agent declares
    /// `delegates: true` — that role name is orthogonal to any agent named lead. The
    /// mechanism must keep working so a future `delegates: true` agent gets the lead role.
    /// Built-in agent defs (other than the removed `lead` agent, which a parallel worker
    /// deletes) must not declare delegates.
    func testSubagentExtensionAssignsLeadRoleFromDelegatesTrait() throws {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        let source = try String(
            contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
        XCTAssertTrue(source.contains("agent.traits.delegates && runtimePolicy.allowRecursiveDelegation"))
        XCTAssertTrue(source.contains("? \"lead\" : \"worker\""))

        let agentsDir = bundled.appendingPathComponent("agents")
        let entries = try FileManager.default.contentsOfDirectory(
            at: agentsDir, includingPropertiesForKeys: [.isDirectoryKey]
        )
        let agentFiles = entries.compactMap { url -> URL? in
            let isDirectory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDirectory {
                let package = url.appendingPathComponent("AGENT.md")
                return FileManager.default.fileExists(atPath: package.path) ? package : nil
            }
            return url.pathExtension == "md" ? url : nil
        }
        XCTAssertFalse(agentFiles.isEmpty, "expected bundled agent definitions")
        for url in agentFiles {
            // `lead.md` is deleted by the parallel agent-catalog worker; ignore it if still present.
            if url.deletingPathExtension().lastPathComponent == "lead" { continue }
            let body = try String(contentsOf: url, encoding: .utf8)
            XCTAssertFalse(
                body.contains("delegates:"),
                "\(url.lastPathComponent) must not declare delegates (no built-in orchestrator agent)"
            )
        }
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

        for required in ["explore", "plan", "general-purpose", "reviewer", "operator", "secretary"] {
            let use = try XCTUnwrap(byName[required], "\(required) is missing from the roster")
            XCTAssertFalse(use.isEmpty, "\(required) has no `use` text")
        }
        // The two the boss could not infer from the name alone are the whole point.
        XCTAssertTrue(byName["plan"]?.contains("depends on code nobody has read yet") == true)
        let operatorUse = try XCTUnwrap(byName["operator"])
        XCTAssertTrue(
            operatorUse.lowercased().contains("desktop")
                || operatorUse.lowercased().contains("computer"),
            "operator use text must mention desktop/computer use: \(operatorUse)"
        )

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
            let definition = root.appendingPathComponent("Sources/PipiUI/PiExt/agents/\(name)/AGENT.md")
            XCTAssertTrue(FileManager.default.fileExists(atPath: definition.path),
                          "roster names \(name) but no agents/\(name)/AGENT.md ships")
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

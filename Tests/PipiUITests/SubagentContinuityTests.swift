import XCTest
@testable import PipiUI

/// Named, resumable workers: the boss picks a short id, and re-dispatching that id continues
/// the same worker with its own conversation rather than a stranger with an empty head.
final class SubagentContinuityTests: XCTestCase {
    private func source() throws -> String {
        let bundled = try XCTUnwrap(PipiResourceBundle.shared.url(forResource: "PiExt", withExtension: nil))
        return try String(contentsOf: bundled.appendingPathComponent("subagent/index.ts"), encoding: .utf8)
    }

    /// The id is retyped by a model to continue a worker, and lands verbatim in a git branch
    /// and a session filename. Long random ids drift; a drifted id is silently a new worker.
    func testAgentIdIsShortSemanticAndValidated() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,23}$/"))
        XCTAssertTrue(s.contains(#"RESERVED_AGENT_IDS = new Set(["root", "main", "head", "master"])"#))
        XCTAssertTrue(s.contains("function validateAgentId(id: string): string | null"))
        XCTAssertTrue(s.contains(#"id.includes("..")"#), "must not allow path traversal into a branch name")
    }

    /// Codex's pattern: a bad name is answered to the model so it renames and retries. Silently
    /// substituting a generated id would hand back a worker the boss cannot address again.
    func testInvalidAgentIdIsReportedToTheModelNotSilentlyReplaced() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const problem = validateAgentId(candidate.trim());"))
        XCTAssertTrue(s.contains("content: [{ type: \"text\", text: problem }]"))
        XCTAssertTrue(s.contains("isError: true"))
    }

    /// The worker's cwd is a worktree that a successful merge deletes, so its conversation must
    /// not live there — that would discard context on exactly the runs that went well.
    func testSessionsLiveUnderTheMainProjectNotTheWorktree() throws {
        let s = try source()
        XCTAssertTrue(s.contains(#"path.join(PIPIUI_MAIN_CWD, ".pi", "agent-sessions")"#))
        XCTAssertTrue(s.contains(#"args.push("--session-id", sessionId, "--session-dir", sessionDir)"#))
        XCTAssertTrue(s.contains("const sessionId = `pipiui-${pipiuiAgentId}`"))
    }

    /// A report is a one-shot deliverable; yesterday's context would only bias the next one.
    func testReadOnlyRolesStayEphemeral() throws {
        let s = try source()
        XCTAssertTrue(s.contains("const sessionDir = READ_ONLY_AGENTS.has(agentName) ? undefined : agentSessionDir();"))
        XCTAssertTrue(s.contains(#"args.push("--no-session")"#), "no session dir must still mean no session")
    }

    /// Continuity must be escapable: a context that went wrong is worth throwing away.
    func testFreshDiscardsTheStoredConversation() throws {
        let s = try source()
        XCTAssertTrue(s.contains("if (sessionDir && options?.fresh)"))
        XCTAssertTrue(s.contains("for (const file of agentSessionFiles(sessionDir, sessionId))"))
        XCTAssertTrue(s.contains("fs.rmSync(file)"))
    }

    /// The boss cannot see the worker: absence of resumed=true on a name it meant to continue
    /// is the only signal that the name was typed wrong.
    func testResumedIsReportedInTheDoneHeader() throws {
        let s = try source()
        XCTAssertTrue(s.contains(#"${result.resumed ? " resumed=true" : ""}"#))
        XCTAssertTrue(s.contains("resumed?: boolean;"))
    }

    func testAgentIdAndFreshAreDispatchParameters() throws {
        let s = try source()
        XCTAssertTrue(s.contains("agentId: Type.Optional(Type.String({ description: AGENT_ID_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION }))"))
        XCTAssertTrue(s.contains("const agentId = t.agentId?.trim() || generatePipiuiAgentId();"),
                      "parallel tasks must be nameable too")
        XCTAssertTrue(s.contains("const agentId = params.agentId?.trim() || generatePipiuiAgentId();"))
        // Regression: the synchronous paths minted their own id, so a named worker silently
        // became an anonymous one whenever the dispatch was not backgrounded.
        XCTAssertTrue(s.contains("agentId: t.agentId?.trim(), fresh: t.fresh }"),
                      "synchronous parallel must honour the caller's name")
        XCTAssertTrue(s.contains("agentId: params.agentId?.trim(), fresh: params.fresh }"),
                      "synchronous single must honour the caller's name")
    }

    /// The philosophy has to teach the boss to use the mechanism, or nobody names anything.
    func testOrchestrationLayerTeachesNamedVerticalSlices() throws {
        let t = try PhilosophyLayerFixture.normalizedBody("orchestration")
        XCTAssertTrue(t.contains("One worker per vertical slice"))
        XCTAssertTrue(t.contains("Name the worker, not just the task"))
        XCTAssertTrue(t.contains("implement → verify → diagnose the failure → fix → re-verify"))
        XCTAssertTrue(t.contains("two-attempts rule outranks continuity"))
        XCTAssertTrue(t.contains("Read-only roles (plan / explore / reviewer) are always cold"))
    }
}

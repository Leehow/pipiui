import XCTest
@testable import PipiUI

/// Guards the prompt-cache rules documented in `docs/progressive-disclosure.md`.
///
/// The prefix sent to the model is `tools + system prompt + history`; anything that
/// rewrites it costs a full re-prime of the whole conversation at uncached prices.
/// These tests pin the two ways PipiUI used to violate that.
final class PromptCacheDisciplineTests: XCTestCase {
    private func install(_ body: (URL) -> String?) throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-cache-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(body(dir))
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    /// `before_agent_start` fires every user turn and always receives the *base* prompt, so
    /// returning `systemPrompt` there rewrites the cached prefix. The git snapshot must ride
    /// a custom message instead, and only when it actually changed.
    func testGitExtensionNeverRewritesSystemPrompt() throws {
        let source = try install(GitExtension.install(into:))
        XCTAssertFalse(source.contains("systemPrompt:"),
                       "git snapshot must not be injected into the system prompt")
        XCTAssertTrue(source.contains("customType: \"pipiui-git-snapshot\""))
        // Memoized: an unchanged worktree emits nothing at all.
        XCTAssertTrue(source.contains("if (snap === lastSnapshot) return;"))
    }

    /// `generate_image` is rarely used but rode in the prefix twice: once as a system-prompt
    /// section and once as promptGuidelines saying the same thing. The long form now comes
    /// back from the `confirmed=false` branch, which lands in the conversation.
    func testMediaExtensionNeverRewritesSystemPrompt() throws {
        let source = try install(MediaExtension.install(into:))
        XCTAssertFalse(source.contains("systemPrompt:"))
        XCTAssertFalse(source.contains("## Image generation"))
        XCTAssertTrue(source.contains("How this tool is meant to be used:"))
    }

    /// git_status + git_diff folded into one `git` tool, same CLI-style shape as `browser`.
    func testGitExtensionRegistersOneStableTool() throws {
        let source = try install(GitExtension.install(into:))
        XCTAssertEqual(source.components(separatedBy: "registerTool(").count - 1, 1)
        XCTAssertTrue(source.contains("name: \"git\""))
        for action in ["status", "diff", "log", "show", "help"] {
            XCTAssertTrue(source.contains("case \"\(action)\":"), "missing git action \(action)")
        }
        XCTAssertTrue(source.contains("actions: status | diff | log | show | help"))
        for field in ["n:", "ref:", "full:"] {
            XCTAssertTrue(source.contains(field), "missing git schema field \(field)")
        }
    }

    /// The tool set is part of the prefix, so it must stay constant within a session.
    /// The five browser_* tools are one `browser` tool with an `action` discriminator.
    func testWebviewExtensionRegistersOneStableTool() throws {
        let source = try install(WebviewExtension.install(into:))
        let registrations = source.components(separatedBy: "registerTool(").count - 1
        XCTAssertEqual(registrations, 1, "browser actions must stay behind a single tool")
        XCTAssertTrue(source.contains("name: \"browser\""))
        for action in [
            "navigate", "observe", "wait", "click", "input", "select", "scroll",
            "content", "eval", "console", "screenshot", "help",
        ] {
            XCTAssertTrue(source.contains("case \"\(action)\":"), "missing browser action \(action)")
        }
        for field in [
            "scope:", "snapshot_id:", "element_index:", "element_token:",
            "text:", "option:", "direction:", "amount:",
            "selector:", "timeout:", "idle_ms:",
        ] {
            XCTAssertTrue(source.contains(field), "missing browser schema field \(field)")
        }
        XCTAssertTrue(source.contains("Type.Literal(\"selector\")"), "wait mode selector must be in schema")
        XCTAssertTrue(source.contains("Type.Literal(\"idle\")"), "wait mode idle must be in schema")
        XCTAssertTrue(source.contains("mode='idle'"), "help text must document idle wait")
        XCTAssertFalse(source.contains("target: Type."), "browser must remain embedded-WebView only")
        XCTAssertTrue(source.contains("async execute(_id, params, signal)"))
        XCTAssertTrue(source.contains("requestID"))
        XCTAssertTrue(source.contains("browser_cancel"))
        XCTAssertTrue(source.contains("Raw fallback"))
        XCTAssertTrue(source.contains("Debug fallback"))
    }

    /// Settings still store the `browser_*` group id; it has to resolve to the real tool name
    /// or `--exclude-tools` would silently stop disabling the browser.
    func testBrowserGroupExpandsToRealToolName() {
        XCTAssertEqual(ToolSkillSettings.browserToolNames, ["browser"])
    }

    func testSensitiveBrowserHandoffTargetsIssuingSession() throws {
        XCTAssertTrue(AppStore.browserResponseRequiresWebPanel([
            "code": "user_handoff_required",
        ]))
        XCTAssertFalse(AppStore.browserResponseRequiresWebPanel(["ok": true]))

        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: repository.appendingPathComponent("Sources/PipiUI/AppStore.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("session.rightPanel = .web"))
        XCTAssertTrue(source.contains("browserResponseRequiresWebPanel(response)"))
        XCTAssertFalse(source.contains("currentSession?.rightPanel = .web"))
    }

    func testBrowserFoundationBudgetAndTimeoutExplanationContract() throws {
        let slash = String(repeating: "/", count: 1_000)
        let oversized: [String: Any] = [
            "ok": true,
            "snapshotID": "snapshot-test",
            "elements": (0..<30).map { index in
                ["index": index, "token": "token-\(index)", "name": slash] as [String: Any]
            } + [["index": 30, "token": "later", "name": "Later useful element"]],
            "limitations": [],
            "truncated": false,
            "note": "load did not finish within 20s (page may still be loading)",
        ]
        let bounded = WebViewStore.boundedStructuredBrowserResponse(oversized)
        XCTAssertLessThanOrEqual(try XCTUnwrap(WebViewStore.foundationSerializedUTF16Length(bounded)), 20_000)
        XCTAssertEqual(bounded["truncated"] as? Bool, true)
        let names = (bounded["elements"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
        XCTAssertTrue(names.contains("Later useful element"))
        XCTAssertEqual(
            bounded["note"] as? String,
            "load did not finish within 20s (page may still be loading)"
        )
        let repository = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: repository.appendingPathComponent("Sources/PipiUI/WebViewStore.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("note: \"load did not finish within 20s (page may still be loading)\""))
        XCTAssertTrue(source.contains("private static let productionFrameNavigationTimeout: TimeInterval = 20"))
        XCTAssertTrue(source.contains("private static let productionFrameNavigationTimeoutNote = \"iframe navigation timed out after 20s\""))
    }

    /// Layer bodies sit in the cached prefix of every request; English is roughly half the
    /// tokens of the equivalent Chinese, so a regression back to Chinese is a real cost.
    /// Frontmatter (name/summary) is settings-panel text and stays Chinese by design.
    func testPhilosophyLayerBodiesStayEnglish() throws {
        for layer in try PhilosophyLayerFixture.layers() {
            let han = layer.body.unicodeScalars.filter { (0x4E00...0x9FFF).contains($0.value) }
            XCTAssertTrue(han.isEmpty,
                          "layer \(layer.id) must stay English (found \(han.count) Han chars)")
        }
    }
}

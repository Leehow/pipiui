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

    /// The tool set is part of the prefix, so it must stay constant within a session.
    /// The five browser_* tools are one `browser` tool with an `action` discriminator.
    func testWebviewExtensionRegistersOneStableTool() throws {
        let source = try install(WebviewExtension.install(into:))
        let registrations = source.components(separatedBy: "registerTool(").count - 1
        XCTAssertEqual(registrations, 1, "browser actions must stay behind a single tool")
        XCTAssertTrue(source.contains("name: \"browser\""))
        for action in ["navigate", "content", "eval", "console", "screenshot", "help"] {
            XCTAssertTrue(source.contains("case \"\(action)\":"), "missing browser action \(action)")
        }
    }

    /// Settings still store the `browser_*` group id; it has to resolve to the real tool name
    /// or `--exclude-tools` would silently stop disabling the browser.
    func testBrowserGroupExpandsToRealToolName() {
        XCTAssertEqual(ToolSkillSettings.browserToolNames, ["browser"])
    }

    /// The boss prompt sits in the cached prefix of every request; English is roughly half the
    /// tokens of the equivalent Chinese, so a regression back to Chinese is a real cost.
    func testBossPromptStaysEnglish() throws {
        let text = try install(BossPrompt.install(into:))
        let han = text.unicodeScalars.filter { (0x4E00...0x9FFF).contains($0.value) }
        XCTAssertTrue(han.isEmpty, "boss prompt must stay English (found \(han.count) Han chars)")
    }
}

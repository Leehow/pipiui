import XCTest
@testable import PipiUI

/// Skills load on demand: the prompt carries names only, and descriptions/bodies arrive
/// through `skill_search` / `skill_load`. This buys two things at once — the per-turn
/// catalog tax drops, and `disable-model-invocation` skills stop being unreachable to the
/// model (previously only a human typing `/skill:name` could ever load one).
final class SkillLoaderExtensionTests: XCTestCase {
    private func installedSource() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-skillloader-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = try XCTUnwrap(SkillLoaderExtension.install(into: dir))
        XCTAssertTrue(path.hasSuffix("pipiui-skillloader.ts"))
        return try String(contentsOfFile: path, encoding: .utf8)
    }

    func testReplacesPiCatalogWithNamesOnlyIndex() throws {
        let source = try installedSource()

        // Both halves of Pi's rendering must go: the XML block AND the preamble that tells
        // the model to `read` skill files itself, which would bypass the tools entirely.
        XCTAssertTrue(source.contains("const AVAILABLE_SKILLS_BLOCK = /\\n*<available_skills>[\\s\\S]*?<\\/available_skills>/g"))
        XCTAssertTrue(source.contains("The following skills provide specialized instructions for specific tasks."))
        XCTAssertTrue(source.contains("systemPrompt.replace(AVAILABLE_SKILLS_BLOCK, \"\")"))
        XCTAssertTrue(source.contains("Skills are loaded on demand: only their names are listed here."))
        XCTAssertTrue(source.contains("never `read` a SKILL.md directly"))
        // Cache discipline: an unchanged prompt must not be rewritten into an identical copy.
        XCTAssertTrue(source.contains("if (rebuilt === event.systemPrompt) return;"))
    }

    /// The point of the index: a heavy workflow is visible by name and is the model's own
    /// call to open. The index states what one costs so that call is informed — it does not
    /// gate it behind an announcement or an approval.
    func testHeavyWorkflowsAreDiscoverableAndTheModelsOwnCall() throws {
        let source = try installedSource()

        XCTAssertTrue(source.contains("Available on your own judgement:"))
        XCTAssertTrue(source.contains("Also yours to load, heavier:"))
        XCTAssertTrue(source.contains("load one when you judge the work is actually that size"))
        XCTAssertTrue(source.contains("userInvoked: fm[\"disable-model-invocation\"] === \"true\""))
        XCTAssertTrue(source.contains("This is a heavier workflow."))
        // Cost information, so the judgement is informed rather than blind.
        XCTAssertTrue(source.contains("These carry multi-step processes and document or ticket deliverables"))
        XCTAssertTrue(source.contains("Some expect an issue tracker, which this"))
        // No obligation to justify, and no permission step.
        for control in ["Never escalate silently", "deliberate escalation", "announce before loading",
                        "which condition made it worth loading", "reason: Type.String"] {
            XCTAssertFalse(source.contains(control),
                           "loading a skill is the model's own call (found \(control))")
        }
    }

    func testRegistersSearchAndLoadTools() throws {
        let source = try installedSource()

        XCTAssertTrue(source.contains("name: \"skill_search\""))
        XCTAssertTrue(source.contains("name: \"skill_load\""))
        XCTAssertTrue(source.contains("Returns descriptions only — call skill_load for the instructions themselves."))
        // A skill must never become a mandate the way an auto-injected bootstrap did.
        XCTAssertTrue(source.contains("never a mandate to add gates or documents the user did not ask for"))
        // A name, never a path: skill_load must not become an arbitrary file reader.
        XCTAssertTrue(source.contains("a path is not accepted"))
        XCTAssertTrue(source.contains("const entry = entries.find((e) => e.name === wanted);"))
        XCTAssertTrue(source.contains("const MAX_BODY_CHARS = 60_000;"))
        // The body is useless if the skill's own relative paths cannot be resolved.
        XCTAssertTrue(source.contains("Skill directory (resolve its relative paths against this)"))
    }

    /// Discovery reads Pi's own settings so the index cannot drift from what Pi loaded,
    /// and honours the Settings skill denylist without a session restart.
    func testDiscoveryFollowsPiSettingsAndSkillDenylist() throws {
        let source = try installedSource()

        XCTAssertTrue(source.contains("process.env.PIPIUI_SKILL_ROOTS"))
        XCTAssertTrue(source.contains(".pi/agent/settings.json"))
        XCTAssertTrue(source.contains("Library/Application Support/PipiUI/tool-skill-settings.json"))
        XCTAssertTrue(source.contains("disabledSkills"))
        XCTAssertTrue(source.contains("if (!description || disabled.has(name)) continue;"))
        // Pi's rule: a directory holding SKILL.md is a leaf, so a skills root that also
        // contains nested repos does not get walked into forever.
        XCTAssertTrue(source.contains("if (entries.some((e) => e.name === \"SKILL.md\" && !e.isDirectory()))"))
        XCTAssertTrue(source.contains("const WALK_MAX_DEPTH = 4;"))
        XCTAssertTrue(source.contains("entry.name === \"node_modules\""))
    }

    /// Main session only. Dispatched workers run `--no-skills` with the catalog stripped,
    /// and handing them a loader would put the skill library back inside every worker.
    func testWiredIntoMainSessionOnly() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let chat = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(chat.contains("if let skillLoaderExtension { args += [\"-e\", skillLoaderExtension] }"))
        XCTAssertTrue(chat.contains("Main session only: dispatched workers stay fully skill-free."))

        let subagent = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )
        XCTAssertFalse(subagent.contains("skillloader"),
                       "the loader must never be passed to a dispatched worker")

        let plugin = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(plugin.contains("SkillLoaderExtension.install(into: root)"))
        XCTAssertTrue(plugin.contains("(\"pipiui-skillloader.ts\", \\.skillLoaderExtension)"))
    }
}

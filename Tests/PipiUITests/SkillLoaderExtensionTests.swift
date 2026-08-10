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

    func testGeneratedModuleExecutesBundledFirstReadOnlyDiscoveryAndPathRejection() throws {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("pipiui-skillloader-runtime-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: root) }
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)

        let moduleDirectory = root.appendingPathComponent("module", isDirectory: true)
        let modulePath = try XCTUnwrap(SkillLoaderExtension.install(into: moduleDirectory))
        let home = root.appendingPathComponent("home", isDirectory: true)
        let builtInRoot = home.appendingPathComponent(
            "Library/Application Support/PipiUI/built-in-skills", isDirectory: true
        )
        let userRoot = home.appendingPathComponent(".pi/agent/skills", isDirectory: true)
        let settingsRoot = root.appendingPathComponent("settings-skills", isDirectory: true)
        let overrideRoot = root.appendingPathComponent("override-skills", isDirectory: true)
        let denylistURL = home.appendingPathComponent(
            "Library/Application Support/PipiUI/tool-skill-settings.json"
        )
        func writeSkill(_ root: URL, _ name: String, _ description: String, _ body: String) throws {
            let directory = root.appendingPathComponent(name, isDirectory: true)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try "---\nname: \(name)\ndescription: \(description)\n---\n\(body)\n".write(
                to: directory.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8
            )
        }
        try writeSkill(builtInRoot, "create-subagent", "bundled description", "bundled body")
        try writeSkill(userRoot, "create-subagent", "user shadow description", "user shadow body")
        try writeSkill(userRoot, "user-only", "user description", "user body")
        try writeSkill(settingsRoot, "settings-only", "settings description", "settings body")
        try writeSkill(overrideRoot, "override-only", "override description", "override body")
        try writeSkill(userRoot, "disabled-one", "disabled description", "disabled body")
        try fileManager.createDirectory(at: denylistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "{\"disabledSkills\":[\"disabled-one\"]}".write(to: denylistURL, atomically: true, encoding: .utf8)
        let settingsURL = home.appendingPathComponent(".pi/agent/settings.json")
        try fileManager.createDirectory(at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "{\"skills\":[\"\(settingsRoot.path)\"]}".write(to: settingsURL, atomically: true, encoding: .utf8)

        // Discovery must work without write permission to normal user/settings roots.
        for directory in [userRoot, settingsRoot] {
            try fileManager.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        }
        defer {
            for directory in [userRoot, settingsRoot] {
                try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            }
        }

        let typebox = moduleDirectory.appendingPathComponent("node_modules/typebox", isDirectory: true)
        try fileManager.createDirectory(at: typebox, withIntermediateDirectories: true)
        try "{\"type\":\"module\",\"exports\":\"./index.js\"}".write(
            to: typebox.appendingPathComponent("package.json"), atomically: true, encoding: .utf8
        )
        try "export const Type = new Proxy({}, { get: () => (...args) => args[0] ?? {} });\n".write(
            to: typebox.appendingPathComponent("index.js"), atomically: true, encoding: .utf8
        )
        let harness = moduleDirectory.appendingPathComponent("harness.mjs")
        let harnessSource = #"""
        import { pathToFileURL } from "node:url";
        const tools = new Map();
        const handlers = new Map();
        const module = await import(pathToFileURL(process.env.PIPIUI_SKILL_LOADER).href);
        module.default({
          on(event, handler) { handlers.set(event, handler); },
          registerTool(tool) { tools.set(tool.name, tool); },
        });
        const search = await tools.get("skill_search").execute("search", {});
        const load = await tools.get("skill_load").execute("load", { name: "create-subagent" });
        const rejected = await tools.get("skill_load").execute("bad", { name: "../outside/SKILL.md" });
        const prompt = handlers.get("before_agent_start")({
          systemPrompt: "before\n<available_skills>legacy</available_skills>\nafter",
        });
        process.stdout.write(JSON.stringify({
          tools: [...tools.keys()].sort(),
          search: search.content[0].text,
          load: load.content[0].text,
          rejected: { isError: rejected.isError, text: rejected.content[0].text },
          prompt: prompt.systemPrompt,
        }));
        """#
        try harnessSource.write(to: harness, atomically: true, encoding: .utf8)

        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = home.path
        environment["PIPIUI_SKILL_ROOTS"] = overrideRoot.path
        environment["PIPIUI_SKILL_LOADER"] = modulePath
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--experimental-strip-types", harness.path]
        process.currentDirectoryURL = moduleDirectory
        process.environment = environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        let stdout = output.fileHandleForReading.readDataToEndOfFile()
        let stderr = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        XCTAssertEqual(process.terminationStatus, 0, "skill loader runtime harness failed: \(stderr)")
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: stdout) as? [String: Any])
        XCTAssertEqual(report["tools"] as? [String], ["skill_load", "skill_search"])
        let search = try XCTUnwrap(report["search"] as? String)
        XCTAssertTrue(search.contains("bundled description"))
        XCTAssertFalse(search.contains("user shadow description"), "bundled root must win same-name deduplication")
        XCTAssertTrue(search.contains("user description"))
        XCTAssertTrue(search.contains("settings description"))
        XCTAssertTrue(search.contains("override description"))
        XCTAssertFalse(search.contains("disabled description"), "denylisted skills must not be discovered")
        XCTAssertTrue((report["load"] as? String)?.contains("bundled body") == true)
        let rejected = try XCTUnwrap(report["rejected"] as? [String: Any])
        XCTAssertEqual(rejected["isError"] as? Bool, true)
        XCTAssertTrue((rejected["text"] as? String)?.contains("Unknown skill") == true)
        XCTAssertTrue((report["prompt"] as? String)?.contains("create-subagent") == true)
        XCTAssertFalse((report["prompt"] as? String)?.contains("legacy") == true)
        XCTAssertEqual(
            try String(contentsOf: userRoot.appendingPathComponent("user-only/SKILL.md"), encoding: .utf8),
            "---\nname: user-only\ndescription: user description\n---\nuser body\n"
        )
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
        // PipiUI's signed, app-owned root is first (so a same-named user skill cannot
        // replace it), while explicit roots and Pi's normal settings remain available.
        XCTAssertTrue(source.contains("const PIPIUI_BUILT_IN_SKILL_ROOT = path.join("))
        XCTAssertTrue(source.contains("\"Library\", \"Application Support\", \"PipiUI\", \"built-in-skills\""))
        XCTAssertTrue(source.contains("const roots: string[] = [PIPIUI_BUILT_IN_SKILL_ROOT];"))
        XCTAssertTrue(source.contains("roots.push(...override.split(\":\").filter(Boolean).map(homePath));"))
        XCTAssertTrue(source.contains("roots.push(path.join(os.homedir(), \".pi/agent/skills\"));"))
        XCTAssertTrue(source.contains("First root wins in loadCatalog"))
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
        let assembly = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"),
            encoding: .utf8
        )
        // The skill loader is mounted in the main session only and gated by the
        // built-in feature snapshot; both now live in the pure spawn assembly.
        XCTAssertTrue(assembly.contains("skillLoaderExtension"))
        XCTAssertTrue(assembly.contains("Main session only: dispatched workers stay fully skill-free."))
        XCTAssertTrue(chat.contains("skillLoaderExtension"))

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

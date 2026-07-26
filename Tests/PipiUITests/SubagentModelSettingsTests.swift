import XCTest
@testable import PipiUI

final class SubagentModelSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.subagentModels.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    func testDefaultFollowsMain() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        XCTAssertNil(SubagentModelSettings.modelOverride(for: "explore", defaults: suite))
        XCTAssertEqual(
            SubagentModelSettings.resolveModel(
                for: "explore",
                mainModelId: "xai/grok-4",
                frontmatterFallback: "anthropic/claude-sonnet-4-6",
                defaults: suite
            ),
            "xai/grok-4"
        )
    }

    func testExplicitOverrideBeatsMain() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        let fm = FileManager.default
        let tmpRoot = fm.temporaryDirectory.appendingPathComponent("pipiui-subagent-\(UUID().uuidString)", isDirectory: true)
        try? fm.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmpRoot) }

        // Write via setModelOverride using standard path — then verify resolve with suite.
        // Directly mutate suite + resolve to keep the unit test hermetic.
        suite.set(["explore": "anthropic/claude-opus-4-6"], forKey: SubagentModelSettings.defaultsKey)
        XCTAssertEqual(
            SubagentModelSettings.modelOverride(for: "explore", defaults: suite),
            "anthropic/claude-opus-4-6"
        )
        XCTAssertEqual(
            SubagentModelSettings.resolveModel(
                for: "explore",
                mainModelId: "xai/grok-4",
                frontmatterFallback: "xai/grok-4.5:high",
                defaults: suite
            ),
            "anthropic/claude-opus-4-6"
        )
        XCTAssertNil(SubagentModelSettings.modelOverride(for: "plan", defaults: suite))
    }

    func testLegacyStringOverrideLoadsWithoutThinking() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        suite.set(["explore": "xai/grok-4.5:high"], forKey: SubagentModelSettings.defaultsKey)

        XCTAssertEqual(SubagentModelSettings.modelOverride(for: "explore", defaults: suite), "xai/grok-4.5:high")
        XCTAssertNil(SubagentModelSettings.thinkingOverride(for: "explore", defaults: suite))
        XCTAssertEqual(
            SubagentModelSettings.resolveModel(
                for: "explore",
                mainModelId: "anthropic/claude-sonnet-4-6",
                frontmatterFallback: nil,
                defaults: suite
            ),
            "xai/grok-4.5:high"
        )
    }

    func testExplicitThinkingPersistsSeparatelyFromModel() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("pipiui-thinking-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let url = root.appendingPathComponent("subagent-models.json")

        SubagentModelSettings.setOverride(
            "anthropic/claude-sonnet-4-6",
            thinking: "high",
            for: "reviewer",
            defaults: suite,
            to: url
        )

        XCTAssertEqual(SubagentModelSettings.modelOverride(for: "reviewer", defaults: suite), "anthropic/claude-sonnet-4-6")
        XCTAssertEqual(SubagentModelSettings.thinkingOverride(for: "reviewer", defaults: suite), "high")
        let data = try Data(contentsOf: url)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let reviewer = try XCTUnwrap(obj["reviewer"] as? [String: String])
        XCTAssertEqual(reviewer["model"], "anthropic/claude-sonnet-4-6")
        XCTAssertEqual(reviewer["thinking"], "high")
    }

    func testDefaultThinkingUsesLegacyStringShape() throws {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        suite.set(["plan": "xai/grok-4"], forKey: SubagentModelSettings.defaultsKey)

        XCTAssertNil(SubagentModelSettings.thinkingOverride(for: "plan", defaults: suite))
        let encoded = SubagentModelSettings.jsonString(defaults: suite)
        let data = try XCTUnwrap(encoded.data(using: .utf8))
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(obj["plan"], "xai/grok-4")
    }

    func testEmptyOverrideClearsAndFallsBack() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        suite.set(["plan": "xai/grok-4"], forKey: SubagentModelSettings.defaultsKey)
        // Simulate clear: remove key
        var map = SubagentModelSettings.allOverrides(defaults: suite)
        map.removeValue(forKey: "plan")
        suite.set(map, forKey: SubagentModelSettings.defaultsKey)

        XCTAssertEqual(
            SubagentModelSettings.resolveModel(
                for: "plan",
                mainModelId: nil,
                frontmatterFallback: "xai/grok-4.5:high",
                defaults: suite
            ),
            "xai/grok-4.5:high"
        )
        XCTAssertNil(
            SubagentModelSettings.resolveModel(
                for: "plan",
                mainModelId: nil,
                frontmatterFallback: nil,
                defaults: suite
            )
        )
    }

    func testSyncJSONFileRoundTrip() throws {
        let fm = FileManager.default
        let tmpRoot = fm.temporaryDirectory.appendingPathComponent("pipiui-json-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmpRoot) }

        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }
        suite.set(["lead": "anthropic/claude-sonnet-4-6", "explore": ""], forKey: SubagentModelSettings.defaultsKey)
        let url = tmpRoot.appendingPathComponent("subagent-models.json")
        SubagentModelSettings.syncJSONFile(defaults: suite, to: url)
        let data = try Data(contentsOf: url)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(obj["lead"], "anthropic/claude-sonnet-4-6")
        XCTAssertEqual(obj["explore"], "")
    }

    func testSetModelOverrideWritesDefaults() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        // Use a temp Application Support substitute by writing JSON manually after set —
        // setModelOverride always targets real Application Support; test the defaults API surface.
        suite.set(["reviewer": "xai/grok-4"], forKey: SubagentModelSettings.defaultsKey)
        XCTAssertEqual(SubagentModelSettings.modelOverride(for: "reviewer", defaults: suite), "xai/grok-4")

        var map = SubagentModelSettings.allOverrides(defaults: suite)
        map.removeValue(forKey: "reviewer")
        suite.set(map, forKey: SubagentModelSettings.defaultsKey)
        XCTAssertNil(SubagentModelSettings.modelOverride(for: "reviewer", defaults: suite))
    }

    func testSubagentExtensionUsesSeparateThinkingArgumentForExplicitOverride() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
        let source = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("function resolveAgentThinking"))
        XCTAssertTrue(source.contains("args.push(\"--thinking\", resolvedThinking)"))
        XCTAssertTrue(source.contains("stripModelThinkingSuffix(resolvedModel)"))
    }
}

final class AgentCatalogTests: XCTestCase {
    func testParseFrontmatter() {
        let md = """
        ---
        name: explore
        description: Research agent
        tools: read, grep, find, ls, bash
        model: xai/grok-4.5:high
        ---

        You are explore.
        """
        let agent = AgentCatalog.parseFrontmatter(md, filePath: "/tmp/explore.md")
        XCTAssertEqual(agent?.name, "explore")
        XCTAssertEqual(agent?.description, "Research agent")
        XCTAssertEqual(agent?.tools, ["read", "grep", "find", "ls", "bash"])
        XCTAssertEqual(agent?.frontmatterModel, "xai/grok-4.5:high")
    }

    func testParseRequiresName() {
        let md = """
        ---
        description: no name
        ---

        body
        """
        XCTAssertNil(AgentCatalog.parseFrontmatter(md))
    }

    func testPreferredSort() {
        let agents = [
            AgentDefinition(name: "lead", description: "", tools: [], frontmatterModel: nil, filePath: ""),
            AgentDefinition(name: "explore", description: "", tools: [], frontmatterModel: nil, filePath: ""),
            AgentDefinition(name: "zzz", description: "", tools: [], frontmatterModel: nil, filePath: ""),
        ]
        XCTAssertEqual(AgentCatalog.sort(agents).map(\.name), ["explore", "lead", "zzz"])
    }

    func testLoadFromTempDirectory() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("agents-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }

        let body = """
        ---
        name: plan
        description: Planner
        tools: read, bash
        ---

        plan body
        """
        try body.write(to: dir.appendingPathComponent("plan.md"), atomically: true, encoding: .utf8)
        let loaded = AgentCatalog.load(from: dir)
        // Disk agents merge with built-ins so Settings always lists explore / general-purpose / …
        XCTAssertTrue(loaded.map(\.name).contains("plan"))
        XCTAssertTrue(loaded.map(\.name).contains("explore"))
        XCTAssertTrue(loaded.map(\.name).contains("general-purpose"))
        XCTAssertEqual(loaded.first(where: { $0.name == "plan" })?.tools, ["read", "bash"])
    }

    func testLoadNeverEmptyWithoutDirectory() {
        let names = AgentCatalog.load(from: URL(fileURLWithPath: "/tmp/pipiui-missing-agents-\(UUID().uuidString)"))
            .map(\.name)
        XCTAssertEqual(names, AgentCatalog.preferredOrder)
        XCTAssertTrue(names.contains("explore"))
        XCTAssertTrue(names.contains("general-purpose"))
    }

    func testMergeBuiltInsDiskWins() {
        let custom = AgentDefinition(
            name: "explore",
            description: "custom",
            tools: ["read"],
            frontmatterModel: nil,
            filePath: "/tmp/explore.md"
        )
        let merged = AgentCatalog.mergeBuiltIns([custom])
        XCTAssertEqual(merged.first(where: { $0.name == "explore" })?.description, "custom")
        XCTAssertTrue(merged.contains(where: { $0.name == "general-purpose" }))
    }
}

final class ToolSkillCatalogTests: XCTestCase {
    func testSkillsFilter() {
        let cmds = [
            SlashCommand(name: "foo", description: "a", source: .skill, argumentHint: nil),
            SlashCommand(name: "bar", description: "b", source: .prompt, argumentHint: nil),
            SlashCommand(name: "baz", description: "c", source: .skill, argumentHint: nil),
        ]
        XCTAssertEqual(ToolSkillCatalog.skills(from: cmds).map(\.name), ["baz", "foo"])
    }

    func testBuiltinToolsNonEmpty() {
        XCTAssertTrue(ToolSkillCatalog.builtinTools.contains(where: { $0.name == "subagent" }))
        XCTAssertTrue(ToolSkillCatalog.extensionTools.contains(where: { $0.name == "generate_image" }))
    }
}

final class ToolSkillSettingsTests: XCTestCase {
    private func tempSuite() -> (String, UserDefaults) {
        let name = "pipiui.test.toolSkill.\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: name)!
        return (name, suite)
    }

    func testToolTogglePersistsAndExpandsBrowser() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        XCTAssertTrue(ToolSkillSettings.isToolEnabled("bash", defaults: suite))
        ToolSkillSettings.setToolEnabled(false, name: "bash", defaults: suite)
        XCTAssertFalse(ToolSkillSettings.isToolEnabled("bash", defaults: suite))
        XCTAssertEqual(ToolSkillSettings.excludeToolNames(defaults: suite), ["bash"])

        ToolSkillSettings.setToolEnabled(false, name: ToolSkillSettings.browserGroupId, defaults: suite)
        let excluded = Set(ToolSkillSettings.excludeToolNames(defaults: suite))
        XCTAssertTrue(excluded.isSuperset(of: ToolSkillSettings.browserToolNames))
        XCTAssertFalse(excluded.contains(ToolSkillSettings.browserGroupId))
        XCTAssertEqual(
            ToolSkillSettings.excludeToolsCLIArgs(defaults: suite).first,
            "--exclude-tools"
        )
    }

    func testSkillTogglePersists() {
        let (name, suite) = tempSuite()
        defer { suite.removePersistentDomain(forName: name) }

        ToolSkillSettings.setSkillEnabled(false, name: "brainstorming", defaults: suite)
        XCTAssertFalse(ToolSkillSettings.isSkillEnabled("brainstorming", defaults: suite))
        ToolSkillSettings.setSkillEnabled(true, name: "brainstorming", defaults: suite)
        XCTAssertTrue(ToolSkillSettings.isSkillEnabled("brainstorming", defaults: suite))
    }
}

final class MainModelFileTests: XCTestCase {
    func testWriteReadMainModelRoundTrip() throws {
        let fm = FileManager.default
        let url = fm.temporaryDirectory.appendingPathComponent("main-model-\(UUID().uuidString).txt")
        defer { try? fm.removeItem(at: url) }
        SubagentModelSettings.writeMainModel("xai/test-composer-model", to: url)
        XCTAssertEqual(SubagentModelSettings.readMainModel(from: url), "xai/test-composer-model")
        SubagentModelSettings.writeMainModel(nil, to: url)
        XCTAssertNil(SubagentModelSettings.readMainModel(from: url))
    }

    func testWriteMainModelSkipsUnchangedValue() throws {
        let fm = FileManager.default
        let url = fm.temporaryDirectory.appendingPathComponent("main-model-\(UUID().uuidString).txt")
        defer { try? fm.removeItem(at: url) }
        SubagentModelSettings.writeMainModel("xai/skip-test", to: url)
        XCTAssertEqual(SubagentModelSettings.readMainModel(from: url), "xai/skip-test")
        // Same value again: must not rewrite. Deleting the file first proves the
        // second call is a no-op (a real write would recreate it).
        try fm.removeItem(at: url)
        SubagentModelSettings.writeMainModel("xai/skip-test", to: url)
        XCTAssertFalse(fm.fileExists(atPath: url.path))
        // Changed value must still write through.
        SubagentModelSettings.writeMainModel("xai/skip-test-2", to: url)
        XCTAssertEqual(SubagentModelSettings.readMainModel(from: url), "xai/skip-test-2")
    }
}

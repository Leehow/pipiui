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

    func testModelInfoParsesCapabilityMetadataWithoutCollapsingUnknownToFalse() throws {
        let data = Data(
            """
            [
              {
                "provider": "missing",
                "id": "unknown",
                "name": "Unknown",
                "contextWindow": 123456,
                "thinkingLevelMap": {
                  "off": null,
                  "xhigh": "provider_high",
                  "low": 42
                }
              },
              {
                "provider": "known",
                "id": "non-reasoning",
                "reasoning": false
              },
              {
                "provider": "known",
                "id": "reasoning",
                "reasoning": true
              }
            ]
            """.utf8
        )
        let rows = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let models = rows.compactMap(ModelInfo.parseModelListRow)

        XCTAssertEqual(models.count, 3)
        XCTAssertNil(models[0].reasoning)
        XCTAssertEqual(models[0].contextWindow, 123456)
        XCTAssertEqual(models[0].thinkingLevelMap?.keys.contains("off"), true)
        XCTAssertNil(models[0].thinkingLevelMap?["off"] ?? nil)
        XCTAssertEqual(models[0].thinkingLevelMap?["xhigh"] ?? nil, "provider_high")
        XCTAssertEqual(models[0].thinkingLevelMap?.keys.contains("low"), false)
        XCTAssertFalse(try XCTUnwrap(models[1].reasoning))
        XCTAssertNil(models[1].thinkingLevelMap)
        XCTAssertTrue(try XCTUnwrap(models[2].reasoning))
    }

    func testModelInfoInitializerDefaultsCapabilityToUnknownAndHashingIncludesTriStateMap() {
        let legacy = ModelInfo(provider: "p", modelId: "m", name: "M", contextWindow: nil)
        XCTAssertNil(legacy.reasoning)
        XCTAssertNil(legacy.thinkingLevelMap)

        let first = ModelInfo(
            provider: "p",
            modelId: "m",
            name: "M",
            contextWindow: 1,
            reasoning: true,
            thinkingLevelMap: ["off": nil, "xhigh": "high"]
        )
        let reordered = ModelInfo(
            provider: "p",
            modelId: "m",
            name: "M",
            contextWindow: 1,
            reasoning: true,
            thinkingLevelMap: ["xhigh": "high", "off": nil]
        )
        let absentOff = ModelInfo(
            provider: "p",
            modelId: "m",
            name: "M",
            contextWindow: 1,
            reasoning: true,
            thinkingLevelMap: ["xhigh": "high"]
        )

        XCTAssertEqual(first, reordered)
        XCTAssertEqual(Set([first, reordered]).count, 1)
        XCTAssertNotEqual(first, absentOff)
    }

    func testEverySubagentIsolatesSkillsAndKeepsExtensions() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
        let source = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )

        // Skills are off for every dispatched role, not only `plan`: a worker that finds a
        // process skill on its own turns a scoped brief into a design-and-plan ceremony.
        XCTAssertTrue(source.contains("args.push(\"--no-skills\");"))
        XCTAssertEqual(source.components(separatedBy: "args.push(\"--no-skills\")").count - 1, 1)
        XCTAssertFalse(source.contains("if (agentName === \"plan\") args.push(\"--no-skills\")"))
        XCTAssertTrue(source.contains("PIPIUI_SUBAGENT_SKILL_ISOLATION: \"1\""))
        XCTAssertTrue(source.contains("process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION === \"1\""))
        XCTAssertTrue(source.contains("if (PIPIUI_SUBAGENT_SKILL_ISOLATION)"))
        XCTAssertTrue(source.contains("pi.on(\"before_agent_start\""))
        XCTAssertTrue(source.contains("stripPiSkillsFromSystemPrompt(event.systemPrompt)"))
        XCTAssertTrue(source.contains("The following skills provide specialized instructions for specific tasks."))
        XCTAssertTrue(source.contains("<available_skills>"))
        XCTAssertTrue(source.contains("<\\/available_skills>"))
        XCTAssertTrue(source.contains("[DISPATCHED SUBAGENT ISOLATION — HIGHEST PRIORITY]"))
        XCTAssertTrue(source.contains(
            "using-superpowers, brainstorming, writing-plans, subagent-driven-development, or any other SKILL.md"
        ))
        XCTAssertTrue(source.contains("no skill may add gates, approvals, or extra process on top of your brief"))
        XCTAssertTrue(source.contains("MUST NOT write a spec or plan document unless your brief names its exact path"))
        XCTAssertTrue(source.contains("MUST NOT create or save plan artifacts"))
        XCTAssertTrue(source.contains("pi.on(\"context\""))
        XCTAssertTrue(source.contains("superpowers:using-superpowers bootstrap for pi"))
        XCTAssertTrue(source.contains("text: SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE"))
        // The read block is scoped to read-only planners: an implementer may legitimately
        // need to read a skills/ path that belongs to the user's own repository.
        XCTAssertTrue(source.contains("PIPIUI_SKILL_READ_BLOCK: agentName === \"plan\" ? \"1\" : undefined"))
        XCTAssertTrue(source.contains("if (PIPIUI_SKILL_READ_BLOCK) {"))
        XCTAssertTrue(source.contains("if (event.toolName !== \"read\") return"))
        XCTAssertTrue(source.contains("isSkillReadPath(requestedPath)"))
        XCTAssertTrue(source.contains("cannot load SKILL.md files or files under a skills directory"))
        XCTAssertTrue(source.contains("writePromptToTempFile(agent.name, agent.systemPrompt)"))
        XCTAssertTrue(source.contains("if (PIPIUI_SUBAGENT_EXT) args.push(\"-e\", PIPIUI_SUBAGENT_EXT);"))
        // `--no-extensions` would also cut the provider server-tool extensions workers use.
        XCTAssertFalse(source.contains("args.push(\"--no-extensions\")"))
    }

    /// The main session keeps skills discoverable for an explicit request, but the
    /// "invoke a skill before any response" bootstrap is suppressed — otherwise it
    /// competes with the Boss protocol for ownership of the session's process.
    func testMainSessionSuppressesSkillBootstrapWithStableSentinel() throws {
        let source = try subagentExtensionSource()

        XCTAssertTrue(source.contains("MAIN_BOOTSTRAP_SUPPRESSION_NOTE"))
        XCTAssertTrue(source.contains("The skill-library auto-bootstrap is suppressed in this session"))
        XCTAssertTrue(source.contains("may be loaded when the user explicitly asks for one by name"))
        XCTAssertTrue(source.contains("messagesContainSuperpowersMarker(event.messages)"))
        // A per-turn timestamp on an always-present front message would read as fresh
        // content to the prompt cache.
        XCTAssertTrue(source.contains("const MAIN_SUPPRESSION_TIMESTAMP = Date.now();"))
        XCTAssertTrue(source.contains("timestamp: MAIN_SUPPRESSION_TIMESTAMP"))
        XCTAssertFalse(source.contains("text: MAIN_BOOTSTRAP_SUPPRESSION_NOTE }],\n\t\t\t\t\t\ttimestamp: Date.now()"))
    }

    /// The structural defect behind the plan loop: a read-only role was handed a `verify`
    /// that only a file write could satisfy, so it failed, got re-dispatched, failed again,
    /// and burned the two-attempts budget before any code was written.
    func testReadOnlyAgentsNeverRunAnUnattestableVerify() throws {
        let source = try subagentExtensionSource()

        XCTAssertTrue(source.contains("const READ_ONLY_AGENTS = new Set([\"plan\", \"explore\", \"reviewer\"]);"))
        XCTAssertTrue(source.contains(
            "const attestableVerify = READ_ONLY_AGENTS.has(agentName) ? undefined : options?.verify;"
        ))
        XCTAssertTrue(source.contains("currentResult.verifyDropped = true;"))
        XCTAssertTrue(source.contains("verifyDropped?: boolean;"))
        XCTAssertTrue(source.contains("Verification: not applicable"))
        XCTAssertTrue(source.contains("do not re-dispatch to make a verify pass"))
        XCTAssertTrue(source.contains("the runtime drops any verify they are given"))
    }

    private func subagentExtensionSource() throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
        return try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiExt/subagent/index.ts"),
            encoding: .utf8
        )
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

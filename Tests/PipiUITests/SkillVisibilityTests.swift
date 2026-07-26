import XCTest

/// Settings → skill 开关 must reach the model, not just the slash palette.
/// `disabledSkills` has no pi CLI flag, so the app-owned subagent extension strips the
/// disabled entries out of pi's `<available_skills>` block in `before_agent_start`.
final class SkillVisibilityTests: XCTestCase {
    // MARK: - Wiring (index.ts source)

    func testSubagentExtensionFiltersDisabledSkillsFromEverySystemPrompt() throws {
        let source = try extensionSource("Sources/PipiUI/PiExt/subagent/index.ts")

        XCTAssertTrue(source.contains(
            "import { filterDisabledSkills, loadDisabledSkills } from \"./skill-visibility.ts\";"
        ))
        XCTAssertTrue(source.contains("loadDisabledSkills(TOOL_SKILL_SETTINGS_FILE)"))
        XCTAssertTrue(source.contains("filterDisabledSkills(event.systemPrompt, disabled)"))
        // Hot-read per turn (no session restart) and applied outside the plan-only branch,
        // so the main session and every nested subagent honor the toggle.
        XCTAssertTrue(source.contains("if (disabled.size === 0) return;"))
        XCTAssertTrue(source.contains("if (!result.hadBlock || result.removed.length === 0) return;"))
        XCTAssertTrue(source.contains(
            "result.remaining === 0\n\t\t\t\t? stripPiSkillsFromSystemPrompt(event.systemPrompt).trimEnd()"
        ))
        // Two before_agent_start handlers: plan isolation (conditional) + skill filtering.
        XCTAssertEqual(source.components(separatedBy: "pi.on(\"before_agent_start\"").count - 1, 2)

        let filterHandler = try XCTUnwrap(source.range(of: "loadDisabledSkills(TOOL_SKILL_SETTINGS_FILE)"))
        let planGuard = try XCTUnwrap(source.range(of: "if (PIPIUI_PLAN_SKILL_ISOLATION) {"))
        XCTAssertTrue(planGuard.lowerBound < filterHandler.lowerBound,
                      "The filter handler must be registered outside the plan-only branch")
    }

    func testFilterModuleDocumentsThatDisabledSkillsStayExplicitlyInvocable() throws {
        let source = try extensionSource("Sources/PipiUI/PiExt/subagent/skill-visibility.ts")
        XCTAssertTrue(source.contains("a disabled skill stays invocable via `/skill:name`"))
        XCTAssertTrue(source.contains("disableModelInvocation"))
    }

    // MARK: - Behavior (node unit tests against skill-visibility.ts)

    func testFilterDropsOnlyDisabledSkillEntries() throws {
        try runNodeScenario("filters")
    }

    func testFilterReportsEmptyBlockAndMissingBlock() throws {
        try runNodeScenario("empty-and-missing")
    }

    func testFilterMatchesXMLEscapedSkillNames() throws {
        try runNodeScenario("escaped-names")
    }

    func testLoadDisabledSkillsNormalizesSlashCommandNames() throws {
        try runNodeScenario("settings-file")
    }

    // MARK: - Helpers

    private func extensionSource(_ relativePath: String) throws -> String {
        try String(contentsOf: repositoryRoot().appendingPathComponent(relativePath), encoding: .utf8)
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PipiUITests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // repository root
    }

    private func runNodeScenario(_ scenario: String) throws {
        let module = repositoryRoot()
            .appendingPathComponent("Sources/PipiUI/PiExt/subagent/skill-visibility.ts")

        let node = Process()
        node.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        node.arguments = [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            #"""
            import assert from "node:assert/strict";
            import fs from "node:fs";
            import os from "node:os";
            import path from "node:path";

            const { filterDisabledSkills, loadDisabledSkills, normalizeSkillName } =
                await import(process.env.SKILL_MODULE);
            const scenario = process.env.SKILL_SCENARIO;

            // Exact shape emitted by pi's formatSkillsForPrompt() (dist/core/skills.js).
            const PREAMBLE = [
                "",
                "",
                "The following skills provide specialized instructions for specific tasks.",
                "Use the read tool to load a skill's file when the task matches its description.",
                "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
                "",
            ].join("\n");
            const entry = (name, description, location) =>
                [
                    "  <skill>",
                    `    <name>${name}</name>`,
                    `    <description>${description}</description>`,
                    `    <location>${location}</location>`,
                    "  </skill>",
                ].join("\n");
            const prompt = (...entries) =>
                `You are pi.${PREAMBLE}\n<available_skills>\n${entries.join("\n")}\n</available_skills>`;

            const tdd = entry("tdd", "Test driven development", "/skills/engineering/tdd/SKILL.md");
            const research = entry("research", "Research a topic", "/skills/productivity/research/SKILL.md");
            const grilling = entry("grilling", "Grill an idea", "/skills/productivity/grilling/SKILL.md");

            if (scenario === "filters") {
                const full = prompt(tdd, research, grilling);

                const result = filterDisabledSkills(full, new Set(["research"]));
                assert.equal(result.hadBlock, true);
                assert.deepEqual(result.removed, ["research"]);
                assert.equal(result.remaining, 2);
                assert.equal(result.systemPrompt, prompt(tdd, grilling));
                // Surviving entries and the rest of the prompt stay byte-identical.
                assert.ok(result.systemPrompt.includes(tdd));
                assert.ok(result.systemPrompt.includes(grilling));
                assert.ok(result.systemPrompt.startsWith("You are pi."));
                assert.ok(!result.systemPrompt.includes("<name>research</name>"));
                assert.ok(!/\n\n *<skill>/.test(result.systemPrompt), "no blank line left behind");

                // Removing the first and the last entry keeps the block well-formed.
                assert.equal(
                    filterDisabledSkills(full, new Set(["tdd"])).systemPrompt,
                    prompt(research, grilling),
                );
                assert.equal(
                    filterDisabledSkills(full, new Set(["grilling"])).systemPrompt,
                    prompt(tdd, research),
                );
                assert.equal(
                    filterDisabledSkills(full, new Set(["tdd", "grilling"])).systemPrompt,
                    prompt(research),
                );

                // No disabled skills, or only unknown ones → prompt untouched.
                const none = filterDisabledSkills(full, new Set());
                assert.equal(none.systemPrompt, full);
                assert.deepEqual(none.removed, []);
                assert.equal(none.remaining, 3);
                const unknown = filterDisabledSkills(full, new Set(["not-installed"]));
                assert.equal(unknown.systemPrompt, full);
                assert.deepEqual(unknown.removed, []);

                // The disabled skill's own file path is gone from the prompt, so the model
                // cannot pick it up by reading the location either.
                assert.ok(!result.systemPrompt.includes("/skills/productivity/research/SKILL.md"));
            } else if (scenario === "empty-and-missing") {
                const full = prompt(tdd, research);

                // Every skill disabled → caller is told nothing remains (index.ts then strips
                // pi's whole skills section instead of leaving an empty block).
                const all = filterDisabledSkills(full, new Set(["tdd", "research"]));
                assert.equal(all.hadBlock, true);
                assert.equal(all.remaining, 0);
                assert.deepEqual(all.removed, ["tdd", "research"]);
                assert.ok(!all.systemPrompt.includes("<skill>"));
                assert.ok(all.systemPrompt.includes("<available_skills>"));

                // A prompt with no skills block at all is returned unchanged.
                const bare = "You are pi. No skills configured.";
                const missing = filterDisabledSkills(bare, new Set(["tdd"]));
                assert.equal(missing.hadBlock, false);
                assert.equal(missing.systemPrompt, bare);
                assert.deepEqual(missing.removed, []);
                assert.equal(missing.remaining, 0);
            } else if (scenario === "escaped-names") {
                // pi XML-escapes names; the settings file stores the raw name.
                const weird = entry("ops&amp;sre", "Escaped &amp; name", "/skills/ops/SKILL.md");
                const full = prompt(tdd, weird);
                const result = filterDisabledSkills(full, new Set(["ops&sre"]));
                assert.deepEqual(result.removed, ["ops&sre"]);
                assert.equal(result.remaining, 1);
                assert.equal(result.systemPrompt, prompt(tdd));

                // Namespaced skills keep their inner colons; only one `skill:` prefix is stripped.
                assert.equal(normalizeSkillName("skill:superpowers:brainstorming"), "superpowers:brainstorming");
                assert.equal(normalizeSkillName("skill:tdd"), "tdd");
                assert.equal(normalizeSkillName("  tdd  "), "tdd");
                const namespaced = entry("superpowers:brainstorming", "Brainstorm", "/skills/sp/SKILL.md");
                const nsResult = filterDisabledSkills(prompt(tdd, namespaced), new Set(["superpowers:brainstorming"]));
                assert.deepEqual(nsResult.removed, ["superpowers:brainstorming"]);
                assert.equal(nsResult.systemPrompt, prompt(tdd));
            } else if (scenario === "settings-file") {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-skill-visibility-"));
                try {
                    const file = path.join(dir, "tool-skill-settings.json");

                    // Settings stores pi's slash-command name (`skill:tdd`).
                    fs.writeFileSync(file, JSON.stringify({
                        disabledTools: ["bash"],
                        disabledSkills: ["skill:tdd", "research", "skill:superpowers:writing-plans", "", 7],
                    }));
                    const loaded = loadDisabledSkills(file);
                    assert.deepEqual(
                        [...loaded].sort(),
                        ["research", "superpowers:writing-plans", "tdd"],
                    );

                    // Missing key / missing file / malformed JSON → nothing disabled.
                    fs.writeFileSync(file, JSON.stringify({ disabledTools: ["bash"] }));
                    assert.equal(loadDisabledSkills(file).size, 0);
                    fs.writeFileSync(file, "{not json");
                    assert.equal(loadDisabledSkills(file).size, 0);
                    assert.equal(loadDisabledSkills(path.join(dir, "nope.json")).size, 0);
                } finally {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } else {
                throw new Error(`Unknown scenario: ${scenario}`);
            }
            """#,
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["SKILL_MODULE"] = module.path
        environment["SKILL_SCENARIO"] = scenario
        node.environment = environment

        let stderr = Pipe()
        node.standardError = stderr
        try node.run()
        node.waitUntilExit()
        let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
        let errorText = String(data: errorData, encoding: .utf8) ?? ""
        XCTAssertEqual(node.terminationStatus, 0, errorText)
    }
}

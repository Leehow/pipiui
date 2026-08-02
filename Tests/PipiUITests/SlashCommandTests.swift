import XCTest
import PipiUI

final class SlashCommandTests: XCTestCase {

    // MARK: - Model

    func testSlashCommandIdIncludesSourceAndName() {
        let c = SlashCommand(
            name: "fix-tests",
            description: "Fix tests",
            source: .prompt,
            argumentHint: nil
        )
        XCTAssertEqual(c.id, "prompt:fix-tests")
    }

    func testBuiltinSourceRawValue() {
        XCTAssertEqual(SlashSource.builtin.rawValue, "builtin")
        XCTAssertEqual(SlashSource.extension_.rawValue, "extension")
        XCTAssertEqual(SlashSource.prompt.rawValue, "prompt")
        XCTAssertEqual(SlashSource.skill.rawValue, "skill")
    }

    // MARK: - get_commands parser

    func testParseGetCommandsModernSourceInfoShape() {
        let json: [String: Any] = [
            "type": "response",
            "command": "get_commands",
            "success": true,
            "data": [
                "commands": [
                    [
                        "name": "session-name",
                        "description": "Set session name",
                        "source": "extension",
                        "sourceInfo": [
                            "path": "/home/user/.pi/agent/extensions/session.ts",
                            "source": "extension",
                            "scope": "user",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                    [
                        "name": "fix-tests",
                        "description": "Fix failing tests",
                        "source": "prompt",
                        "sourceInfo": [
                            "path": "/proj/.pi/agent/prompts/fix-tests.md",
                            "source": "prompt",
                            "scope": "project",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                    [
                        "name": "skill:brave-search",
                        "description": "Web search",
                        "source": "skill",
                        "sourceInfo": [
                            "path": "/home/user/.pi/agent/skills/brave-search/SKILL.md",
                            "source": "skill",
                            "scope": "user",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                ] as [[String: Any]],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.count, 3)
        XCTAssertEqual(cmds[0].name, "session-name")
        XCTAssertEqual(cmds[0].source, .extension_)
        XCTAssertEqual(cmds[0].description, "Set session name")
        XCTAssertNil(cmds[0].argumentHint)
        XCTAssertEqual(cmds[1].source, .prompt)
        XCTAssertEqual(cmds[2].name, "skill:brave-search")
        XCTAssertEqual(cmds[2].source, .skill)
        XCTAssertEqual(cmds[2].id, "skill:skill:brave-search")
    }

    func testParseGetCommandsLegacyPathLocationStillWorks() {
        // rpc.md examples still show path/location; parser must not crash and still map name/source.
        let json: [String: Any] = [
            "success": true,
            "data": [
                "commands": [
                    [
                        "name": "old",
                        "description": "legacy",
                        "source": "prompt",
                        "location": "project",
                        "path": "/x/y.md",
                    ] as [String: Any],
                ],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.map(\.name), ["old"])
        XCTAssertEqual(cmds.first?.source, .prompt)
    }

    func testParseGetCommandsFailureOrMissingReturnsEmpty() {
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(["success": false, "error": "nope"])).count, 0)
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(["success": true, "data": [String: Any]()])).count, 0)
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(nil)).count, 0)
    }

    func testParseGetCommandsSkipsUnknownSourceAndMissingName() {
        let json: [String: Any] = [
            "success": true,
            "data": [
                "commands": [
                    ["name": "x", "source": "mystery"] as [String: Any],
                    ["description": "no name", "source": "prompt"] as [String: Any],
                    ["name": "ok", "source": "extension"] as [String: Any],
                ],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.map(\.name), ["ok"])
    }

    // MARK: - Palette query

    func testPaletteQueryShowsForSlashPrefix() {
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "/"), "")
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "  /mo"), "mo")
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "\n/model"), "model")
    }

    func testPaletteQueryHidesWhenArgsStarted() {
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/model "))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/model gpt"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/name my session"))
    }

    func testPaletteQueryHidesWithoutSlash() {
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "hello"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "  hello"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: ""))
    }

    // MARK: - Fuzzy

    private func sampleCommands() -> [SlashCommand] {
        [
            SlashCommand(name: "compact", description: nil, source: .builtin, argumentHint: nil),
            SlashCommand(name: "model", description: nil, source: .builtin, argumentHint: "<provider/model>"),
            SlashCommand(name: "session-name", description: nil, source: .extension_, argumentHint: nil),
            SlashCommand(name: "skill:brave-search", description: nil, source: .skill, argumentHint: nil),
            SlashCommand(name: "fix-tests", description: nil, source: .prompt, argumentHint: nil),
        ]
    }

    func testFuzzyEmptyQueryPreservesOrder() {
        let all = sampleCommands()
        XCTAssertEqual(SlashFuzzy.filter(commands: all, query: "").map(\.name), all.map(\.name))
    }

    func testFuzzySubsequenceMatch() {
        let names = SlashFuzzy.filter(commands: sampleCommands(), query: "mdl").map(\.name)
        XCTAssertTrue(names.contains("model"))
        XCTAssertFalse(names.contains("compact"))
    }

    func testFuzzyPrefixRanksHigher() {
        let cmds = [
            SlashCommand(name: "remodel", description: nil, source: .prompt, argumentHint: nil),
            SlashCommand(name: "model", description: nil, source: .builtin, argumentHint: nil),
        ]
        let ranked = SlashFuzzy.filter(commands: cmds, query: "model").map(\.name)
        XCTAssertEqual(ranked.first, "model")
    }

    func testFuzzyCaseInsensitive() {
        let names = SlashFuzzy.filter(commands: sampleCommands(), query: "COMP").map(\.name)
        XCTAssertEqual(names, ["compact"])
    }

    func testFuzzyNoMatchReturnsEmpty() {
        XCTAssertTrue(SlashFuzzy.filter(commands: sampleCommands(), query: "zzz").isEmpty)
    }

    // MARK: - Builtin table + parse

    func testBuiltinInventory() {
        XCTAssertEqual(BuiltinCommands.all.count, 11)
        let names = Set(BuiltinCommands.all.map(\.name))
        XCTAssertEqual(names, ["compact", "new", "name", "session", "export", "copy", "quit", "model", "reload", "stats", "schedule"])
        XCTAssertTrue(BuiltinCommands.all.allSatisfy { $0.source == .builtin })
        XCTAssertEqual(BuiltinCommands.command(named: "model")?.argumentHint, "<provider/model>")
        XCTAssertEqual(BuiltinCommands.command(named: "name")?.argumentHint, "<name>")
        XCTAssertNil(BuiltinCommands.command(named: "compact")?.argumentHint)
        XCTAssertNil(BuiltinCommands.command(named: "reload")?.argumentHint)
        XCTAssertEqual(BuiltinCommands.command(named: "schedule")?.argumentHint, "<prompt>")
    }

    func testParseInvocation() {
        let a = BuiltinCommands.parseInvocation("  /name  hello world  ")
        XCTAssertEqual(a?.name, "name")
        XCTAssertEqual(a?.args, "hello world")
        let b = BuiltinCommands.parseInvocation("/compact")
        XCTAssertEqual(b?.name, "compact")
        XCTAssertEqual(b?.args, "")
        XCTAssertNil(BuiltinCommands.parseInvocation("nope"))
        XCTAssertNil(BuiltinCommands.parseInvocation(""))
        // bare slash is not a named invocation
        XCTAssertNil(BuiltinCommands.parseInvocation("/"))
        XCTAssertNil(BuiltinCommands.parseInvocation("/ "))
    }

    // MARK: - Builtin execute

    func testExecuteUnknownReturnsFalse() {
        let host = BuiltinHostMock()
        XCTAssertFalse(BuiltinCommands.execute(name: "not-a-real-cmd", args: "", host: host))
        XCTAssertEqual(host.flashMessages.count, 0)
        XCTAssertEqual(host.compactCount, 0)
    }

    func testExecuteCompact() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "compact", args: "", host: host))
        XCTAssertEqual(host.compactCount, 1)
    }

    func testExecuteReload() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "reload", args: "", host: host))
        XCTAssertEqual(host.reloadCount, 1)
    }

    func testExecuteNameRequiresArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "name", args: "", host: host))
        XCTAssertEqual(host.setNames.count, 0)
        XCTAssertEqual(host.flashMessages.count, 1)
        XCTAssertTrue(host.flashMessages[0].contains("/name"))
    }

    func testExecuteNameWithArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "name", args: "My Session", host: host))
        XCTAssertEqual(host.setNames, ["My Session"])
    }

    func testExecuteModelRequiresArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "model", args: "  ", host: host))
        XCTAssertEqual(host.setModels.count, 0)
        XCTAssertTrue(host.flashMessages.last?.contains("/model") == true)
    }

    func testExecuteModelWithArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "model", args: "openai/gpt-4o", host: host))
        XCTAssertEqual(host.setModels, ["openai/gpt-4o"])
    }

    func testExecuteScheduleOnlyOpensConfirmationDraft() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "schedule", args: "  总结今天  ", host: host))
        XCTAssertEqual(host.schedulePrompts, ["总结今天"])
        XCTAssertTrue(BuiltinCommands.execute(name: "schedule", args: "", host: host))
        XCTAssertEqual(host.schedulePrompts, ["总结今天", ""])
    }

    func testExecuteNewWithoutClosureFlashes() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "new", args: "", host: host))
        XCTAssertEqual(host.newCount, 0)
        XCTAssertTrue(host.flashMessages.last?.contains("新建") == true || host.flashMessages.last?.contains("AppStore") == true)
    }

    func testExecuteNewWithClosure() {
        let host = BuiltinHostMock()
        host.enableNew()
        XCTAssertTrue(BuiltinCommands.execute(name: "new", args: "", host: host))
        XCTAssertEqual(host.newCount, 1)
        XCTAssertTrue(host.flashMessages.isEmpty)
    }

    func testExecuteQuitWithoutClosureFlashes() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "quit", args: "", host: host))
        XCTAssertEqual(host.quitCount, 0)
        XCTAssertFalse(host.flashMessages.isEmpty)
    }

    func testExecuteQuitWithClosure() {
        let host = BuiltinHostMock()
        host.enableQuit()
        XCTAssertTrue(BuiltinCommands.execute(name: "quit", args: "", host: host))
        XCTAssertEqual(host.quitCount, 1)
    }

    func testExecuteSessionExportCopy() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "session", args: "", host: host))
        XCTAssertTrue(BuiltinCommands.execute(name: "export", args: "", host: host))
        XCTAssertTrue(BuiltinCommands.execute(name: "copy", args: "", host: host))
        XCTAssertEqual(host.showStatsCount, 1)
        XCTAssertEqual(host.exportCount, 1)
        XCTAssertEqual(host.copyCount, 1)
    }
}

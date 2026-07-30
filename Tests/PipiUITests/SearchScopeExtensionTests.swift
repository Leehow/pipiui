import XCTest
@testable import PipiUI

final class SearchScopeExtensionTests: XCTestCase {
    private func temporaryDirectory(_ prefix: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    func testExplicitPathExtractionIsConservative() {
        let prompt = """
        Search `/tmp/reference library`, ../shared-notes, and $HOME/Music.
        The words home, music, pictures, and https://example.com/a/b are not paths.
        """

        XCTAssertEqual(
            SearchScopeExtension.explicitPathCandidates(in: prompt),
            ["/tmp/reference library", "../shared-notes", "$HOME/Music"]
        )
        XCTAssertTrue(
            SearchScopeExtension.explicitPathCandidates(
                in: "Look through my home music and pictures library."
            ).isEmpty
        )
    }

    func testTurnGrantIsReplacedAndExpiresOnNextUserTurn() throws {
        let stateRoot = try temporaryDirectory("pipiui-search-grants")
        let projectRoot = try temporaryDirectory("pipiui-search-project")
        let grantURL = SearchScopeExtension.grantFileURL(
            sessionKey: "session/test",
            baseDirectory: stateRoot
        )

        try SearchScopeExtension.recordUserTurn(
            "You may inspect `/tmp/reference library` and ../shared.",
            sessionKey: "session/test",
            projectRoot: projectRoot,
            baseDirectory: stateRoot
        )
        var grant = try SearchScopeExtension.readGrantFile(at: grantURL)
        XCTAssertEqual(
            grant.paths,
            [
                "/tmp/reference library",
                projectRoot.deletingLastPathComponent()
                    .appendingPathComponent("shared").standardizedFileURL.path,
            ]
        )

        try SearchScopeExtension.recordUserTurn(
            "Now stay inside the project.",
            sessionKey: "session/test",
            projectRoot: projectRoot,
            baseDirectory: stateRoot
        )
        grant = try SearchScopeExtension.readGrantFile(at: grantURL)
        XCTAssertTrue(grant.paths.isEmpty, "the next user turn must revoke prior grants")
    }

    func testGeneratedGuardHandlesContainmentSymlinksExplicitGrantAndBash() throws {
        let jiti = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/.bin/jiti"
            )
        guard FileManager.default.isExecutableFile(atPath: jiti.path) else {
            throw XCTSkip("installed Pi jiti runtime is unavailable")
        }

        let dir = try temporaryDirectory("pipiui-search-extension")
        let root = dir.appendingPathComponent("project", isDirectory: true)
        let outside = dir.appendingPathComponent("outside", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("escaped-link"),
            withDestinationURL: outside
        )

        let extensionPath = try XCTUnwrap(SearchScopeExtension.install(into: dir))
        let installedSource = try String(contentsOfFile: extensionPath, encoding: .utf8)
        XCTAssertFalse(
            installedSource.contains("event.prompt"),
            "a Pi/subagent prompt must never create its own external-path grant"
        )
        let harness = dir.appendingPathComponent("harness.ts")
        let script = """
        import { evaluateSearchPath, bashBlockReason } from "./pipiui-search-scope.ts";
        import * as fs from "node:fs";
        const [root, outside] = process.argv.slice(2);
        const checks: Record<string, boolean> = {
          inside: evaluateSearchPath("missing/child", root, []).allowed,
          parent: !evaluateSearchPath("..", root, []).allowed,
          prefixSibling: !evaluateSearchPath(`${root}-sibling`, root, []).allowed,
          symlinkEscape: !evaluateSearchPath("escaped-link", root, []).allowed,
          explicitExternal: evaluateSearchPath(outside, root, [outside]).allowed,
          bashBroad: bashBlockReason("find / -name '*.mp3'", root, []) !== null,
          bashMedia: bashBlockReason("rg cover ~/Pictures", root, []) !== null,
          bashCdRoot: bashBlockReason("cd / && find . -name '*.mp3'", root, []) !== null,
          bashCdMedia: bashBlockReason("cd ~/Pictures && rg cover .", root, []) !== null,
          bashFindTraversal: bashBlockReason("find -L / -name '*.mp3'", root, []) !== null,
          bashFindSeparator: bashBlockReason("find -- / -name '*.mp3'", root, []) !== null,
          bashProject: bashBlockReason("rg TODO Sources", root, []) === null,
          bashCdProject: bashBlockReason("cd Sources && rg TODO .", root, []) === null,
          bashBuild: bashBlockReason("swift build && git status", root, []) === null,
          inheritedGrant: evaluateSearchPath(outside, root).allowed,
        };
        fs.writeFileSync(
          process.env.PIPIUI_SEARCH_GRANT_FILE!,
          JSON.stringify({ version: 1, paths: [] }),
        );
        checks.expiredGrant = !evaluateSearchPath(outside, root).allowed;
        process.stdout.write(JSON.stringify(checks));
        """
        try script.write(to: harness, atomically: true, encoding: .utf8)
        let grantFile = dir.appendingPathComponent("turn-grant.json")
        let grantData = try JSONSerialization.data(
            withJSONObject: ["version": 1, "paths": [outside.path]]
        )
        try grantData.write(to: grantFile)

        let process = Process()
        process.executableURL = jiti
        process.arguments = [harness.path, root.path, outside.path]
        process.environment = ProcessInfo.processInfo.environment.merging(
            ["PIPIUI_SEARCH_GRANT_FILE": grantFile.path],
            uniquingKeysWith: { _, new in new }
        )
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()

        let stderr = String(
            data: errors.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        XCTAssertEqual(process.terminationStatus, 0, stderr)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let checks = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Bool]
        )
        for (name, passed) in checks {
            XCTAssertTrue(passed, "guard check failed: \(name)")
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: extensionPath))
    }

    func testMainAndSubagentsWireTheSameGuard() throws {
        let root = repositoryRoot()
        let chat = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/ChatSession.swift"),
            encoding: .utf8
        )
        let plugin = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        let assembly = try String(
            contentsOf: root.appendingPathComponent("Sources/PipiUI/PipiSpawnAssembly.swift"),
            encoding: .utf8
        )
        let subagent = try String(
            contentsOf: root.appendingPathComponent(
                "Sources/PipiUI/PiExt/subagent/index.ts"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(plugin.contains("SearchScopeExtension.install(into: root)"))
        // ChatSession must take the path as an explicit initializer argument and
        // must NOT statically read `PiPlugin.searchScopeExtensionPath` anymore.
        XCTAssertTrue(chat.contains("searchScopeExtension:"))
        XCTAssertFalse(chat.contains("PiPlugin.searchScopeExtensionPath"))
        XCTAssertTrue(chat.contains("sendAppGeneratedPrompt(text)"))
        // The -e / env wiring now lives in the pure assembly (gated by the
        // built-in feature snapshot), not inline in ChatSession.
        XCTAssertTrue(assembly.contains("PIPIUI_SEARCH_SCOPE_EXT"))
        XCTAssertTrue(assembly.contains("PIPIUI_SEARCH_GRANT_FILE"))
        XCTAssertTrue(subagent.contains("process.env.PIPIUI_SEARCH_SCOPE_EXT"))
        XCTAssertTrue(
            subagent.contains(
                "if (PIPIUI_SEARCH_SCOPE_EXT) args.push(\"-e\", PIPIUI_SEARCH_SCOPE_EXT);"
            )
        )
    }
}

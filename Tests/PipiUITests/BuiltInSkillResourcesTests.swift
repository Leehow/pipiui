import XCTest
@testable import PipiUI

final class BuiltInSkillResourcesTests: XCTestCase {
    private func copiedBundledSkills(to destination: URL) throws {
        let bundled = try XCTUnwrap(BuiltInSkillResources.bundledURL())
        try FileManager.default.copyItem(at: bundled, to: destination)
    }

    func testBundledSkillResourceUsesStandardSkillDirectoryAndShipsThroughSwiftPMResources() throws {
        let bundled = try XCTUnwrap(BuiltInSkillResources.bundledURL())
        XCTAssertTrue(BuiltInSkillResources.isComplete(bundled))

        let skill = try String(
            contentsOf: bundled.appendingPathComponent("create-subagent/SKILL.md"),
            encoding: .utf8
        )
        XCTAssertTrue(skill.hasPrefix("---\nname: create-subagent\n"))
        XCTAssertTrue(skill.contains("description:"))
        XCTAssertTrue(skill.contains("Agent, Skill, and Prompt"))
        XCTAssertTrue(skill.contains("subagent_manage"))
        XCTAssertTrue(skill.contains("action:\"scaffold\""))
        XCTAssertTrue(skill.contains("action:\"validate\""))
        XCTAssertTrue(skill.contains("action:\"install\""))
        XCTAssertTrue(skill.contains("desktop: requestable"))
        XCTAssertTrue(skill.contains("Never put"))
        XCTAssertTrue(skill.contains("`browser` in `tools`"))
        XCTAssertTrue(skill.contains("Never use `true`, `*`, a server-wide grant"))

        let template = try String(
            contentsOf: bundled.appendingPathComponent("create-subagent/AGENT.template.md"),
            encoding: .utf8
        )
        for field in ["schema: 1", "name:", "description:", "mode:", "capabilities:", "worktree:", "deliverable:"] {
            XCTAssertTrue(template.contains(field), "missing schema v1 field \(field)")
        }

        let package = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Package.swift"),
            encoding: .utf8
        )
        let packaging = try String(
            contentsOf: repositoryRoot().appendingPathComponent("make-app.sh"),
            encoding: .utf8
        )
        XCTAssertTrue(package.contains(".copy(\"Resources\")"))
        XCTAssertTrue(packaging.contains("cp -R .build/release/PipiUI_PipiUI.bundle/."))
    }

    func testAppOwnedInstallUpgradesOnlyItsOwnTreeAndPreservesUserSkillFiles() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-built-in-skills-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let bundled = temp.appendingPathComponent("bundled", isDirectory: true)
        try copiedBundledSkills(to: bundled)
        let updatedSkill = bundled.appendingPathComponent("create-subagent/SKILL.md")
        try "updated bundled skill".write(to: updatedSkill, atomically: true, encoding: .utf8)

        let applicationSupport = temp.appendingPathComponent("Application Support", isDirectory: true)
        let destination = BuiltInSkillResources.installedURL(applicationSupportRoot: applicationSupport)
        try FileManager.default.createDirectory(
            at: destination.appendingPathComponent("create-subagent", isDirectory: true),
            withIntermediateDirectories: true
        )
        try "old app skill".write(
            to: destination.appendingPathComponent("create-subagent/SKILL.md"),
            atomically: true,
            encoding: .utf8
        )
        try "stale".write(
            to: destination.appendingPathComponent("stale.txt"),
            atomically: true,
            encoding: .utf8
        )

        let userSkill = temp.appendingPathComponent("user/.pi/agent/skills/create-subagent/SKILL.md")
        try FileManager.default.createDirectory(at: userSkill.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "user-owned skill".write(to: userSkill, atomically: true, encoding: .utf8)

        XCTAssertEqual(
            BuiltInSkillResources.install(bundledRoot: bundled, destination: destination),
            destination
        )
        XCTAssertEqual(
            try String(
                contentsOf: destination.appendingPathComponent("create-subagent/SKILL.md"),
                encoding: .utf8
            ),
            "updated bundled skill"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.appendingPathComponent("stale.txt").path))
        XCTAssertEqual(try String(contentsOf: userSkill), "user-owned skill")
        XCTAssertFalse(destination.path.contains(".pi/agent/skills"))
    }

    func testMissingOrIncompleteUpgradeRetainsLastCompleteAppOwnedTree() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-built-in-skills-safe-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let existing = temp.appendingPathComponent("installed", isDirectory: true)
        try copiedBundledSkills(to: existing)
        let existingSkill = existing.appendingPathComponent("create-subagent/SKILL.md")
        try "known good skill".write(to: existingSkill, atomically: true, encoding: .utf8)

        let incomplete = temp.appendingPathComponent("incomplete", isDirectory: true)
        try copiedBundledSkills(to: incomplete)
        try FileManager.default.removeItem(at: incomplete.appendingPathComponent("create-subagent/AGENT.template.md"))

        let missing = temp.appendingPathComponent("missing-resource", isDirectory: true)
        XCTAssertEqual(BuiltInSkillResources.install(bundledRoot: incomplete, destination: existing), existing)
        XCTAssertEqual(BuiltInSkillResources.install(bundledRoot: missing, destination: existing), existing)
        XCTAssertEqual(try String(contentsOf: existingSkill, encoding: .utf8), "known good skill")
    }

    func testInstallerCleansOnlyStrictStaleSiblingsAndNeverFollowsTheirLinks() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-built-in-skills-stale-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let bundled = temp.appendingPathComponent("bundled", isDirectory: true)
        try copiedBundledSkills(to: bundled)
        let applicationSupport = temp.appendingPathComponent("Application Support", isDirectory: true)
        let parent = applicationSupport.appendingPathComponent("PipiUI", isDirectory: true)
        let destination = BuiltInSkillResources.installedURL(applicationSupportRoot: applicationSupport)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)

        let staleDirectory = parent.appendingPathComponent(".built-in-skills.install-old", isDirectory: true)
        let staleFile = parent.appendingPathComponent(".built-in-skills.install-old-file")
        let normalDirectory = parent.appendingPathComponent("ordinary-directory", isDirectory: true)
        let similarButNotStale = parent.appendingPathComponent(".built-in-skills.install")
        let outside = temp.appendingPathComponent("outside", isDirectory: true)
        let staleLink = parent.appendingPathComponent(".built-in-skills.install-outside")
        let outsideParentFile = applicationSupport.appendingPathComponent(".built-in-skills.install-not-a-sibling")
        try FileManager.default.createDirectory(at: staleDirectory, withIntermediateDirectories: true)
        try "stale file".write(to: staleFile, atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: normalDirectory, withIntermediateDirectories: true)
        try "retain".write(to: similarButNotStale, atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        let outsideSentinel = outside.appendingPathComponent("sentinel.txt")
        try "outside".write(to: outsideSentinel, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(atPath: staleLink.path, withDestinationPath: outside.path)
        try "not a PipiUI sibling".write(to: outsideParentFile, atomically: true, encoding: .utf8)

        XCTAssertEqual(BuiltInSkillResources.install(bundledRoot: bundled, destination: destination), destination)
        XCTAssertFalse(FileManager.default.fileExists(atPath: staleDirectory.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: staleFile.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: staleLink.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: normalDirectory.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: similarButNotStale.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outsideSentinel.path), "cleanup must unlink, not traverse, stale symlinks")
        XCTAssertTrue(FileManager.default.fileExists(atPath: outsideParentFile.path), "cleanup is limited to PipiUI's direct parent")
    }

    func testInstallerRejectsAnAppOwnedParentSymlinkThatEscapesApplicationSupport() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-built-in-skills-parent-link-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let bundled = temp.appendingPathComponent("bundled", isDirectory: true)
        try copiedBundledSkills(to: bundled)
        let applicationSupport = temp.appendingPathComponent("Application Support", isDirectory: true)
        let outside = temp.appendingPathComponent("outside", isDirectory: true)
        try FileManager.default.createDirectory(at: applicationSupport, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try copiedBundledSkills(to: outside.appendingPathComponent("built-in-skills", isDirectory: true))
        let escapedStale = outside.appendingPathComponent(".built-in-skills.install-keep")
        try "do not touch".write(to: escapedStale, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(
            atPath: applicationSupport.appendingPathComponent("PipiUI").path,
            withDestinationPath: outside.path
        )

        let destination = BuiltInSkillResources.installedURL(applicationSupportRoot: applicationSupport)
        XCTAssertEqual(BuiltInSkillResources.install(bundledRoot: bundled, destination: destination), destination)
        XCTAssertTrue(FileManager.default.fileExists(atPath: escapedStale.path), "a symlinked PipiUI parent must be rejected, not cleaned through")
    }

    func testPiPluginInstallsTheAppOwnedSkillsWithoutTouchingPiUserSkills() throws {
        let source = try String(
            contentsOf: repositoryRoot().appendingPathComponent("Sources/PipiUI/PiPlugin.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("BuiltInSkillResources.install()"))
        XCTAssertTrue(source.contains("BuiltInSkillResources.bundledURL()"))
        XCTAssertTrue(source.contains("BuiltInSkillResources.isComplete(BuiltInSkillResources.installedURL)"))
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}

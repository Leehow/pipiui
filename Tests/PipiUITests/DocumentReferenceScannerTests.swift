import Foundation
import PipiUI
import XCTest

final class DocumentReferenceScannerTests: XCTestCase {
    private func temporaryBase() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-document-scan-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func write(_ relativePath: String, in base: URL, contents: String = "x") throws -> URL {
        let url = base.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func testAbsoluteAndFileURLProduceNormalizedAbsoluteReferences() {
        let refs = DocumentReferenceScanner.references(
            in: "see /Users/a/docs/../spec.md and file:///Users/a/x.pdf",
            base: nil
        )

        XCTAssertEqual(refs.map(\.url.path), ["/Users/a/spec.md", "/Users/a/x.pdf"])
        XCTAssertEqual(refs.map(\.origin), [.absolute, .fileURL])
        XCTAssertTrue(refs.allSatisfy { $0.url.path.hasPrefix("/") })
    }

    func testRelativeResolvesAgainstBaseAndExistenceGate() throws {
        let base = try temporaryBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let expected = try write("docs/spec.md", in: base)

        let refs = DocumentReferenceScanner.references(in: "see docs/spec.md", base: base)
        let visible = DocumentReferenceScanner.filterExisting(refs) {
            FileManager.default.fileExists(atPath: $0.path)
        }

        XCTAssertEqual(visible.count, 1)
        XCTAssertEqual(visible.first?.url.path, expected.path)
        XCTAssertEqual(visible.first?.origin, .relativeResolved)
    }

    func testMissingSpeculativeReferencesAreDroppedButExplicitPathsRemain() {
        let relative = DocumentReferenceScanner.references(
            in: "see docs/ghost.md and ghost.txt",
            base: URL(fileURLWithPath: "/tmp/project", isDirectory: true)
        )
        XCTAssertTrue(DocumentReferenceScanner.filterExisting(relative) { _ in false }.isEmpty)

        let absolute = DocumentReferenceScanner.references(
            in: "see /Users/ghost/missing.md",
            base: nil
        )
        XCTAssertEqual(DocumentReferenceScanner.filterExisting(absolute) { _ in false }.count, 1)
    }

    func testTildeExpansionIsExplicitAndAbsolute() {
        let refs = DocumentReferenceScanner.references(in: "see ~/notes/a.md", base: nil)
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs.first?.origin, .tilde)
        XCTAssertEqual(
            refs.first?.url.path,
            FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("notes/a.md").standardizedFileURL.path
        )
    }

    func testDotAndDotDotAreStandardized() throws {
        let base = try temporaryBase()
        defer { try? FileManager.default.removeItem(at: base) }
        let expected = try write("a.md", in: base)
        let nested = base.appendingPathComponent("sub", isDirectory: true)

        let refs = DocumentReferenceScanner.references(in: "see .././a.md", base: nested)
        let visible = DocumentReferenceScanner.filterExisting(refs) {
            FileManager.default.fileExists(atPath: $0.path)
        }
        XCTAssertEqual(visible.first?.url.path, expected.path)
    }

    func testCodeAndConfigTokensNeverProduceDocumentReferences() {
        let base = URL(fileURLWithPath: "/tmp/project", isDirectory: true)
        let refs = DocumentReferenceScanner.references(
            in: "main.swift config.json settings.yaml script.py",
            base: base
        )
        XCTAssertTrue(refs.isEmpty)
    }

    func testAllPreviewableKindsIncludingKnownBasenameAndPdfAreRecognized() {
        let base = URL(fileURLWithPath: "/tmp/project", isDirectory: true)
        let refs = DocumentReferenceScanner.references(
            in: "README a.md b.markdown c.mdx d.mdown e.mkd f.txt g.text h.log i.pdf",
            base: base
        )
        XCTAssertEqual(
            refs.map(\.title),
            ["README", "a.md", "b.markdown", "c.mdx", "d.mdown", "e.mkd",
             "f.txt", "g.text", "h.log", "i.pdf"]
        )
    }

    func testSameAbsolutePathDeduplicatesAcrossRelativeSpellings() {
        let base = URL(fileURLWithPath: "/tmp/project", isDirectory: true)
        let refs = DocumentReferenceScanner.references(
            in: "same.md and ./same.md and docs/../same.md",
            base: base
        )
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs.first?.url.path, "/tmp/project/same.md")
    }

    func testEffectiveBasePrefersWorktreeAndFallsBackToProject() {
        let worktree = URL(fileURLWithPath: "/Users/wt", isDirectory: true)
        let project = URL(fileURLWithPath: "/Users/project", isDirectory: true)

        XCTAssertEqual(
            DocumentReferenceScanner.effectiveBase(
                worktreePath: worktree.path,
                projectURL: project
            ),
            worktree.standardizedFileURL
        )
        XCTAssertEqual(
            DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: project),
            project.standardizedFileURL
        )
        XCTAssertNil(
            DocumentReferenceScanner.effectiveBase(worktreePath: nil, projectURL: nil)
        )
    }

    func testSubagentAndMainBasesResolveSameTokenDifferently() throws {
        let worktree = try temporaryBase()
        let project = try temporaryBase()
        defer {
            try? FileManager.default.removeItem(at: worktree)
            try? FileManager.default.removeItem(at: project)
        }
        let worktreeFile = try write("out/r.txt", in: worktree, contents: "worktree")
        let projectFile = try write("out/r.txt", in: project, contents: "project")

        let subagentBase = DocumentReferenceScanner.effectiveBase(
            worktreePath: worktree.path,
            projectURL: project
        )
        let mainBase = DocumentReferenceScanner.effectiveBase(
            worktreePath: nil,
            projectURL: project
        )
        let subagentRef = DocumentReferenceScanner.references(
            in: "see out/r.txt",
            base: subagentBase
        ).first
        let mainRef = DocumentReferenceScanner.references(
            in: "see out/r.txt",
            base: mainBase
        ).first

        XCTAssertEqual(subagentRef?.url.path, worktreeFile.path)
        XCTAssertEqual(mainRef?.url.path, projectFile.path)
        XCTAssertNotEqual(subagentRef?.url.path, mainRef?.url.path)
    }
}

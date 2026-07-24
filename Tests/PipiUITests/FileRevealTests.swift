import XCTest
import PipiUI
import Foundation

final class FileRevealTests: XCTestCase {

    // MARK: - isAbsoluteFilePath / fileURL

    func testIsAbsoluteFilePathCommonRoots() {
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/Users/alice/Desktop/a.png"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/tmp/foo.txt"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/private/tmp/x"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/var/folders/xx/file"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/Volumes/Disk/file"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/Applications/App.app"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/opt/homebrew/bin/pi"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/usr/local/bin/x"))
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/Library/Preferences/x.plist"))
    }

    func testRejectsHTTPAndRelative() {
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("https://example.com/a.png"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("http://example.com/a.png"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("relative/path.png"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("./local.png"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath(""))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("   "))
    }

    func testRejectsPathsWithSpacesV1() {
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("/Users/alice/My Photos/a.png"))
    }

    func testRejectsBareRootsWithSingleComponent() {
        // /Users alone has 1 component
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("/Users"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("/tmp"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("/"))
    }

    func testFileURLScheme() {
        let u = FileReveal.fileURL(fromCandidate: "file:///Users/alice/a.png")
        XCTAssertEqual(u?.path, "/Users/alice/a.png")
        XCTAssertTrue(u?.isFileURL == true)

        let encoded = FileReveal.fileURL(fromCandidate: "file:///tmp/foo%20bar.png")
        // Encoded space in file URL is OK (path decodes); candidate itself has no raw space.
        XCTAssertNotNil(encoded)
        XCTAssertEqual(encoded?.path, "/tmp/foo bar.png")
    }

    func testStripTrailingPunctuationCJK() {
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png。"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png，"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png；"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png："),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png、"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png）"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png】"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png》"),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png."),
            "/Users/a/b.png"
        )
        XCTAssertEqual(
            FileReveal.stripTrailingPunctuation("/Users/a/b.png,"),
            "/Users/a/b.png"
        )
    }

    // MARK: - Extract from prose

    func testAbsolutePathMatchesInProse() {
        let text = "请查看 /Users/alice/proj/src/main.swift 和 /tmp/out.log 两个文件。"
        let matches = FileReveal.absolutePathMatches(in: text)
        let paths = matches.map { String(text[$0]) }
        XCTAssertEqual(paths, [
            "/Users/alice/proj/src/main.swift",
            "/tmp/out.log"
        ])
    }

    func testAbsolutePathMatchesStripsCJKPunct() {
        let text = "路径在/Users/bob/a.png。"
        let matches = FileReveal.absolutePathMatches(in: text)
        XCTAssertEqual(matches.count, 1, "expected path after CJK prose; got \(matches.map { String(text[$0]) })")
        if let first = matches.first {
            XCTAssertEqual(String(text[first]), "/Users/bob/a.png")
        }
    }

    func testFileURLMatchInProse() {
        let text = "open file:///Users/alice/doc.pdf now"
        let matches = FileReveal.absolutePathMatches(in: text)
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(String(text[matches[0]]), "file:///Users/alice/doc.pdf")
    }

    func testDoesNotMatchHTTP() {
        let text = "see https://example.com/Users/fake/a.png please"
        let matches = FileReveal.absolutePathMatches(in: text)
        // Should not treat the URL path as a local file via http
        let paths = matches.map { String(text[$0]) }
        XCTAssertFalse(paths.contains { $0.hasPrefix("https://") })
    }

    func testAttributedStringStylesPathsWithoutLinkAttribute() {
        let text = "file at /Users/alice/x.txt end"
        let attr = FileReveal.attributedStringLinkingPaths(text)
        let plain = String(attr.characters)
        XCTAssertEqual(plain, text)

        // Visual style only — no `.link` (Cmd+click is handled by PathLinkedText).
        var foundStyle = false
        for run in attr.runs {
            XCTAssertNil(run.link)
            if run.underlineStyle == .single {
                foundStyle = true
                let slice = String(attr[run.range].characters)
                XCTAssertEqual(slice, "/Users/alice/x.txt")
            }
        }
        XCTAssertTrue(foundStyle)

        let targets = FileReveal.pathTargets(in: text)
        XCTAssertEqual(targets.count, 1)
        XCTAssertEqual(targets[0].path, "/Users/alice/x.txt")
        XCTAssertEqual(targets[0].range.location, ("file at " as NSString).length)
    }

    // MARK: - Reveal existing / missing

    func testRevealMissingReturnsFalse() {
        let missing = "/tmp/pipiui-file-reveal-missing-\(UUID().uuidString)"
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing))
        XCTAssertFalse(FileReveal.revealInFinder(path: missing))
        XCTAssertFalse(FileReveal.open(path: missing))
    }

    func testRevealExistingReturnsTrue() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-file-reveal-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let file = dir.appendingPathComponent("sample.txt")
        try Data("hello".utf8).write(to: file)

        // activateFileViewerSelecting should succeed for an existing file
        XCTAssertTrue(FileReveal.revealInFinder(path: file.path))
        XCTAssertTrue(FileReveal.revealInFinder(url: file))
    }

    func testMissingPathMessage() {
        let msg = FileReveal.missingPathMessage("/no/such")
        XCTAssertTrue(msg.contains("找不到文件"))
        XCTAssertTrue(msg.contains("/no/such"))
    }

    func testGenericTwoComponentAbsolute() {
        // /data/foo is not in the common-root list but has ≥2 components
        XCTAssertTrue(FileReveal.isAbsoluteFilePath("/data/foo"))
        XCTAssertFalse(FileReveal.isAbsoluteFilePath("/data"))
    }
}

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

    func testAbsolutePathMatchesStopsAtCJKBracketsAndProse() {
        // 回归：路径后面紧跟 CJK 括号/中文时不能吞进去（此前 /tmp/demo.md」就是正文 整体被当成路径）
        let cases: [(String, String)] = [
            ("点这里「/tmp/demo.md」就是正文", "/tmp/demo.md"),
            ("验证：/tmp/demo.md」（现在应该是蓝色下划线了）→", "/tmp/demo.md"),
            ("看《/Users/a/b.md》这本书", "/Users/a/b.md"),
            ("文件（/tmp/x.log）已生成", "/tmp/x.log"),
            // CJK 表意文字本身是合法路径字符，不能误伤
            ("打开 /Users/x/文档/报告.md 看看", "/Users/x/文档/报告.md"),
        ]
        for (text, expected) in cases {
            let matches = FileReveal.absolutePathMatches(in: text)
            XCTAssertEqual(matches.map { String(text[$0]) }, [expected], "text: \(text)")
        }
    }

    func testFileURLMatchInProse() {
        let text = "open file:///Users/alice/doc.pdf now"
        let matches = FileReveal.absolutePathMatches(in: text)
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(String(text[matches[0]]), "file:///Users/alice/doc.pdf")
    }

    func testFileURLMatchCaseInsensitiveScheme() {
        let text = "open FILE:///Users/alice/doc.pdf and File:///tmp/out.log"
        let matches = FileReveal.absolutePathMatches(in: text)
        let paths = matches.map { String(text[$0]) }
        XCTAssertEqual(paths, [
            "FILE:///Users/alice/doc.pdf",
            "File:///tmp/out.log",
        ])
    }

    func testAbsolutePathMatchesLinearOnLongText() {
        // Regression guard: old impl lowercased text[i...] per character → ~O(n²).
        // ~80k chars should finish well under a second on any reasonable host.
        // Use a delimiter after the path — CJK letters are path-body chars, punctuation is not.
        let path = "/Users/alice/proj/src/main.swift"
        let padding = String(repeating: "字", count: 40_000)
        let text = padding + path + "。" + padding
        let started = CFAbsoluteTimeGetCurrent()
        let matches = FileReveal.absolutePathMatches(in: text)
        let elapsed = CFAbsoluteTimeGetCurrent() - started
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(String(text[matches[0]]), path)
        XCTAssertLessThan(elapsed, 0.5, "path scan took \(elapsed)s — likely super-linear")
    }

    func testPathLinkCacheIdempotent() {
        FileReveal.clearPathLinkCache()
        let text = "see /Users/alice/x.txt and file:///tmp/y.log end"

        let firstTargets = FileReveal.pathTargets(in: text)
        let secondTargets = FileReveal.pathTargets(in: text)
        XCTAssertEqual(firstTargets, secondTargets)
        XCTAssertEqual(firstTargets.count, 2)

        let first = FileReveal.pathLinkedContent(text: text)
        let second = FileReveal.pathLinkedContent(text: text)
        XCTAssertEqual(first.targets, second.targets)
        XCTAssertEqual(String(first.visual.characters), text)
        XCTAssertEqual(String(second.visual.characters), text)

        // Cached visual must keep path underline styling (no `.link`).
        var underlined = 0
        for run in second.visual.runs {
            XCTAssertNil(run.link)
            if run.underlineStyle == .single {
                underlined += 1
            }
        }
        XCTAssertEqual(underlined, 2)

        // inject path + targets share the same scan cache
        let md = AttributedString(text)
        let injected = FileReveal.pathLinkedContent(attributed: md)
        XCTAssertEqual(injected.targets, first.targets)
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

    // MARK: - Document path highlight

    func testDocumentPathsGetBackgroundHighlight() {
        let text = "打开 /tmp/notes.md 或 /tmp/image.png 看看"
        let attr = FileReveal.attributedStringLinkingPaths(text)
        var mdHighlighted = false
        var pngHighlighted = false
        for run in attr.runs {
            let slice = String(attr[run.range].characters)
            if slice == "/tmp/notes.md" {
                mdHighlighted = run.backgroundColor != nil
                XCTAssertEqual(run.underlineStyle, .single)
            }
            if slice == "/tmp/image.png" {
                pngHighlighted = run.backgroundColor != nil
            }
        }
        XCTAssertTrue(mdHighlighted, "文档路径应带背景高亮")
        XCTAssertFalse(pngHighlighted, "非文档路径不应带背景高亮")
    }

    func testDocumentHighlightBridgesToNSAttributedString() {
        // NSTextView 渲染链：SwiftUI AttributedString 的背景高亮必须能桥接成 NSAttributedString。
        let text = "看 /tmp/notes.md 这里"
        let attr = FileReveal.attributedStringLinkingPaths(text)
        let ns = NSAttributedString(attr)
        var foundBackground = false
        var foundAccentForeground = false
        ns.enumerateAttribute(.backgroundColor, in: NSRange(location: 0, length: ns.length)) { value, range, _ in
            if value != nil {
                foundBackground = true
                XCTAssertEqual((ns.string as NSString).substring(with: range), "/tmp/notes.md")
            }
        }
        ns.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: ns.length)) { value, range, _ in
            if value != nil, (ns.string as NSString).substring(with: range) == "/tmp/notes.md" {
                foundAccentForeground = true
            }
        }
        XCTAssertTrue(foundBackground, "背景高亮应能桥接到 NSAttributedString（NSTextView 渲染路径）")
        XCTAssertTrue(foundAccentForeground, "accent 前景色应能桥接到 NSAttributedString")
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

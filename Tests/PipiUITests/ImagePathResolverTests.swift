import XCTest
import PipiUI
import Foundation

final class ImagePathResolverTests: XCTestCase {

    // MARK: - Footnote path extraction

    func testAttachmentPathsSingle() {
        let text = """
        看图

        Attached image file: /Users/me/proj/.pi/attachments/a.png
        (Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)
        """
        let paths = ImagePathResolver.attachmentPaths(fromMessageText: text)
        XCTAssertEqual(paths, ["/Users/me/proj/.pi/attachments/a.png"])
    }

    func testAttachmentPathsMulti() {
        let text = """
        两张图

        Attached image files:
        - /tmp/one.png
        - /tmp/two.jpg
        (Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)
        """
        let paths = ImagePathResolver.attachmentPaths(fromMessageText: text)
        XCTAssertEqual(paths, ["/tmp/one.png", "/tmp/two.jpg"])
    }

    func testAttachmentPathsViaImageAttachment() {
        let urls = [
            URL(fileURLWithPath: "/Users/x/.pi/attachments/1.png"),
            URL(fileURLWithPath: "/Users/x/.pi/attachments/2.png")
        ]
        let annotated = ImageAttachment.messageWithAttachmentPaths(text: "hi", paths: urls)
        let paths = ImageAttachment.attachmentPaths(fromMessageText: annotated)
        XCTAssertEqual(paths, urls.map(\.path))
    }

    func testAttachmentPathsEmptyWhenNoFooter() {
        XCTAssertEqual(ImagePathResolver.attachmentPaths(fromMessageText: "普通文本"), [])
    }

    // MARK: - resolve order

    func testResolvePrefersKnownPathWhenExists() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let data = Data("image-bytes-aaa".utf8)
        let known = dir.appendingPathComponent("known.png")
        try data.write(to: known)

        // Also put a different file in attachments that would match if used
        let attachments = dir.appendingPathComponent(".pi/attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true)
        try Data("other".utf8).write(to: attachments.appendingPathComponent("other.png"))

        let resolved = ImagePathResolver.resolve(
            data: data,
            knownPath: known.path,
            footnotePaths: ["/nope"],
            imageIndex: 0,
            projectURL: dir
        )
        XCTAssertEqual(resolved, known.path)
    }

    func testResolveFallsBackToFootnotePath() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let data = Data("image-bytes-bbb".utf8)
        let foot = dir.appendingPathComponent("foot.png")
        try data.write(to: foot)

        let resolved = ImagePathResolver.resolve(
            data: data,
            knownPath: "/tmp/does-not-exist-\(UUID().uuidString)",
            footnotePaths: [foot.path],
            imageIndex: 0,
            projectURL: dir
        )
        XCTAssertEqual(resolved, foot.path)
    }

    func testResolveFootnoteIndex() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let d0 = Data("img0".utf8)
        let d1 = Data("img1".utf8)
        let f0 = dir.appendingPathComponent("0.png")
        let f1 = dir.appendingPathComponent("1.png")
        try d0.write(to: f0)
        try d1.write(to: f1)

        let r0 = ImagePathResolver.resolve(
            data: d0, knownPath: nil,
            footnotePaths: [f0.path, f1.path], imageIndex: 0, projectURL: dir
        )
        let r1 = ImagePathResolver.resolve(
            data: d1, knownPath: nil,
            footnotePaths: [f0.path, f1.path], imageIndex: 1, projectURL: dir
        )
        XCTAssertEqual(r0, f0.path)
        XCTAssertEqual(r1, f1.path)
    }

    func testResolveContentMatchInAttachments() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let data = Data("unique-content-match-\(UUID().uuidString)".utf8)
        let attachments = dir.appendingPathComponent(".pi/attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true)
        let file = attachments.appendingPathComponent("saved.png")
        try data.write(to: file)

        let resolved = ImagePathResolver.resolve(
            data: data,
            knownPath: nil,
            footnotePaths: [],
            imageIndex: 0,
            projectURL: dir
        )
        XCTAssertEqual(resolved, file.resolvingSymlinksInPath().path)
    }

    func testMatchAttachmentByContent() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let data = Data("match-me-\(UUID().uuidString)".utf8)
        let attachments = dir.appendingPathComponent(".pi/attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true)

        // Decoy same size different content
        let decoy = Data(repeating: 0x41, count: data.count)
        try decoy.write(to: attachments.appendingPathComponent("decoy.bin"))
        try data.write(to: attachments.appendingPathComponent("real.bin"))

        let matched = ImagePathResolver.matchAttachment(data: data, projectURL: dir)
        let expected = attachments.appendingPathComponent("real.bin").resolvingSymlinksInPath().path
        XCTAssertEqual(matched, expected)
    }

    func testMatchAttachmentMiss() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let attachments = dir.appendingPathComponent(".pi/attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true)
        try Data("other".utf8).write(to: attachments.appendingPathComponent("x.bin"))

        let matched = ImagePathResolver.matchAttachment(
            data: Data("not-there".utf8),
            projectURL: dir
        )
        XCTAssertNil(matched)
    }

    func testResolveNilWhenNothingMatches() {
        let resolved = ImagePathResolver.resolve(
            data: Data("zzz".utf8),
            knownPath: nil,
            footnotePaths: [],
            imageIndex: 0,
            projectURL: nil
        )
        XCTAssertNil(resolved)
    }

    func testKnownPathMissingDoesNotWin() throws {
        let dir = try makeTempProject()
        defer { try? FileManager.default.removeItem(at: dir) }

        let data = Data("fallback-content".utf8)
        let attachments = dir.appendingPathComponent(".pi/attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: attachments, withIntermediateDirectories: true)
        let file = attachments.appendingPathComponent("fb.png")
        try data.write(to: file)

        let resolved = ImagePathResolver.resolve(
            data: data,
            knownPath: "/tmp/missing-\(UUID().uuidString).png",
            footnotePaths: [],
            imageIndex: 0,
            projectURL: dir
        )
        XCTAssertEqual(resolved, file.resolvingSymlinksInPath().path)
    }

    // MARK: - helpers

    private func makeTempProject() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-path-resolver-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

import XCTest
@testable import PipiUI
import Foundation
import AppKit

/// T12: attachment disk writes happen off the calling thread; paths are precomputed;
/// duplicate sends don't rewrite; permanent-failure cleanup removes our files only.
final class ImageAttachmentAsyncSaveTests: XCTestCase {

    private var tempDirs: [URL] = []

    override func setUp() {
        super.setUp()
        ImageAttachment.resetAttachmentWriteState()
    }

    override func tearDown() {
        for dir in tempDirs { try? FileManager.default.removeItem(at: dir) }
        tempDirs = []
        ImageAttachment.resetAttachmentWriteState()
        super.tearDown()
    }

    private func makeProject() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-async-save-\(UUID().uuidString)", isDirectory: true)
        tempDirs.append(dir)
        return dir
    }

    private func makeDraft(byteCount: Int = 64) -> DraftImage {
        DraftImage(
            data: Data((0..<byteCount).map { UInt8($0 % 251) }),
            mimeType: "image/png",
            preview: NSImage(size: NSSize(width: 1, height: 1))
        )
    }

    func testPathsReturnedSynchronouslyBeforeBytesWritten() {
        let project = makeProject()
        let draft = makeDraft()

        // Must not block on / require the file to exist at return time.
        let written = expectation(description: "background write completes")
        let urls = ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project) { _ in
            written.fulfill()
        }
        XCTAssertEqual(urls.count, 1)
        XCTAssertTrue(urls[0].path.contains(".pi/attachments"))
        XCTAssertTrue(urls[0].path.hasSuffix(".png"))

        wait(for: [written], timeout: 5)
        // After the (already-in-flight/done) write settles, the file exists with the right bytes.
        XCTAssertEqual(try? Data(contentsOf: urls[0]), draft.data)
    }

    func testDuplicateSendReusesPathAndWritesOnce() {
        let project = makeProject()
        let draft = makeDraft()

        let first = ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project)
        let second = ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project)
        XCTAssertEqual(first, second, "same draft id must reuse its original path")

        let done = expectation(description: "write done")
        ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project) { _ in
            done.fulfill()
        }
        wait(for: [done], timeout: 5)

        let dir = project.appendingPathComponent(".pi/attachments", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        XCTAssertEqual(files.count, 1, "duplicate sends must not write the same attachment twice")
    }

    func testDiscardRemovesOnlyRecordedFiles() {
        let project = makeProject()
        let draft = makeDraft()

        let done = expectation(description: "write done")
        let urls = ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project) { _ in
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        XCTAssertTrue(FileManager.default.fileExists(atPath: urls[0].path))

        // A foreign path must survive discard untouched.
        let foreign = project.appendingPathComponent("keep.png")
        try? draft.data.write(to: foreign)

        ImageAttachment.discardAttachments(atPaths: [urls[0].path, foreign.path])

        let deleted = expectation(description: "background delete")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { deleted.fulfill() }
        wait(for: [deleted], timeout: 5)

        XCTAssertFalse(FileManager.default.fileExists(atPath: urls[0].path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: foreign.path))

        // Mapping forgotten → re-send gets a fresh path and writes again.
        let resent = ImageAttachment.saveToProjectAttachmentsAsync([draft], projectURL: project)
        XCTAssertNotEqual(resent, urls)
    }

    func testFileDataCacheReadsOnceAndDeduopes() throws {
        let project = makeProject()
        let file = project.appendingPathComponent("img.png")
        try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
        let bytes = Data([1, 2, 3, 4, 5])
        try bytes.write(to: file)

        ImageFileDataCache.removeAll()
        XCTAssertEqual(ImageFileDataCache.data(forPath: file.path), bytes)

        // Delete the file: a cached second read must still succeed (proves no re-read).
        try FileManager.default.removeItem(at: file)
        XCTAssertEqual(ImageFileDataCache.data(forPath: file.path), bytes)

        // After cache clear the missing file yields nil (same shape as failed Data(contentsOf:)).
        ImageFileDataCache.removeAll()
        XCTAssertNil(ImageFileDataCache.data(forPath: file.path))
    }
}

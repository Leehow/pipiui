import XCTest
@testable import PipiUI
import Foundation

/// T4: live ingest (message_end / tool_execution_end on the main thread) must not touch disk.
/// Path-only images become zero-byte placeholders; bytes are backfilled off-main and the
/// final blocks are identical to the legacy synchronous behavior.
final class LiveImageBackfillTests: XCTestCase {

    private var tempDirs: [URL] = []

    override func tearDown() {
        for dir in tempDirs { try? FileManager.default.removeItem(at: dir) }
        tempDirs = []
        super.tearDown()
    }

    private func makePNGFile(named name: String = "shot.png") throws -> (url: URL, data: Data) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-backfill-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        tempDirs.append(dir)
        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let data = Data(base64Encoded: pngB64)!
        let url = dir.appendingPathComponent(name)
        try data.write(to: url)
        return (url, data)
    }

    // MARK: parseImageBlock

    func testParseImageBlockNoDiskReadReturnsPlaceholder() throws {
        let (file, _) = try makePNGFile()
        ImageFileDataCache.removeAll()
        let json: [String: Any] = ["type": "image", "path": file.path]
        guard let block = ChatSession.parseImageBlock(J(json), allowDiskRead: false) else {
            return XCTFail("expected placeholder block")
        }
        XCTAssertTrue(block.data.isEmpty, "live path must not read bytes")
        XCTAssertEqual(block.path, file.path)
        XCTAssertEqual(block.mimeType, "image/png")
    }

    func testParseImageBlockWithDiskReadLoadsBytesViaCache() throws {
        let (file, data) = try makePNGFile()
        ImageFileDataCache.removeAll()
        let json: [String: Any] = ["type": "image", "path": file.path]
        let block = ChatSession.parseImageBlock(J(json), allowDiskRead: true)
        XCTAssertEqual(block?.data, data)
        XCTAssertEqual(block?.path, file.path)
    }

    func testParseImageBlockMissingFileStillNilWithDiskRead() {
        ImageFileDataCache.removeAll()
        let json: [String: Any] = ["type": "image", "path": "/nonexistent/none.png"]
        XCTAssertNil(ChatSession.parseImageBlock(J(json), allowDiskRead: true))
        // Live path still produces a placeholder; backfill drops it later.
        XCTAssertNotNil(ChatSession.parseImageBlock(J(json), allowDiskRead: false))
    }

    // MARK: hydrate placeholders

    func testHydrateNoDiskReadAppendsPlaceholder() throws {
        let (file, _) = try makePNGFile()
        ImageFileDataCache.removeAll()
        let note = "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
        let text = "see this\n\nAttached image file: \(file.path)\n\(note)"
        let item = ChatItem(id: "u", role: "user", blocks: [.text(text)])

        let hydrated = ChatSession.hydrateUserImagesIfNeeded(item, allowDiskRead: false)
        XCTAssertEqual(ChatSession.imageCount(of: hydrated), 1)
        guard case .image(let img)? = hydrated.blocks.first else {
            return XCTFail("expected leading image placeholder")
        }
        XCTAssertTrue(img.data.isEmpty)
        XCTAssertEqual(img.path, file.path)
    }

    // MARK: backfill merge

    func testBackfilledBlocksFillsAndDrops() throws {
        let (file, data) = try makePNGFile()
        let good = ImageBlock(id: "good", data: Data(), mimeType: "image/png", path: file.path)
        let bad = ImageBlock(id: "bad", data: Data(), mimeType: "image/png", path: "/nonexistent/x.png")
        let keep = ImageBlock(id: "keep", data: Data([9]), mimeType: "image/png", path: nil)
        let blocks: [ChatBlock] = [.image(good), .text("hi"), .image(bad), .image(keep)]

        let merged = ChatSession.backfilledBlocks(blocks, loaded: ["good": data])
        XCTAssertEqual(merged.count, 3)
        guard case .image(let filled) = merged[0] else { return XCTFail() }
        XCTAssertEqual(filled.id, "good")
        XCTAssertEqual(filled.data, data)
        XCTAssertEqual(filled.path, file.path)
        XCTAssertEqual(merged[1], .text("hi"))
        // Unreadable placeholder dropped — matches legacy skip-missing behavior.
        XCTAssertEqual(merged[2], .image(keep))
    }

    func testBackfilledImagesDropsUnreadable() {
        let imgs = [
            ImageBlock(id: "a", data: Data(), mimeType: "image/png", path: "/x/a.png"),
            ImageBlock(id: "b", data: Data([1]), mimeType: "image/png", path: nil),
        ]
        let merged = ChatSession.backfilledImages(imgs, loaded: [:])
        XCTAssertEqual(merged, [imgs[1]])
    }

    // MARK: end-to-end equivalence: live placeholder + backfill == legacy disk-read result

    func testPlaceholderThenBackfillMatchesLegacyResult() throws {
        let (file, data) = try makePNGFile()
        ImageFileDataCache.removeAll()
        let note = "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
        let text = "cap\n\nAttached image file: \(file.path)\n\(note)"
        let item = ChatItem(id: "u", role: "user", blocks: [.text(text)])

        // Legacy (history path): reads inline.
        let legacy = ChatSession.hydrateUserImagesIfNeeded(item, allowDiskRead: true)

        // Live path: placeholder, then off-main load, then merge.
        ImageFileDataCache.removeAll()
        let live = ChatSession.hydrateUserImagesIfNeeded(item, allowDiskRead: false)
        XCTAssertEqual(ChatSession.imageCount(of: live), 1)
        var loaded: [String: Data] = [:]
        for block in live.blocks {
            if case .image(let img) = block, img.data.isEmpty, let p = img.path {
                loaded[img.id] = ImageFileDataCache.data(forPath: p)
            }
        }
        let merged = ChatSession.backfilledBlocks(live.blocks, loaded: loaded)

        XCTAssertEqual(ChatSession.imageCount(of: ChatItem(id: "u", role: "user", blocks: merged)),
                       ChatSession.imageCount(of: legacy))
        guard case .image(let legacyImg) = legacy.blocks.first,
              case .image(let mergedImg) = merged.first else {
            return XCTFail("expected image blocks")
        }
        XCTAssertEqual(mergedImg.data, data)
        XCTAssertEqual(mergedImg.data, legacyImg.data)
        XCTAssertEqual(mergedImg.mimeType, legacyImg.mimeType)
        XCTAssertEqual(mergedImg.path, legacyImg.path)
        XCTAssertEqual(ChatSession.plainText(of: ChatItem(id: "u", role: "user", blocks: merged)),
                       ChatSession.plainText(of: legacy))
    }
}

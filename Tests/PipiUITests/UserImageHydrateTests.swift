import XCTest
@testable import PipiUI
import Foundation
import AppKit

final class UserImageHydrateTests: XCTestCase {

    func testShouldReplaceOptimisticUserSameText() {
        let optimistic = ChatItem(
            id: "local",
            role: "user",
            blocks: [
                .image(ImageBlock(id: "i1", data: Data([1, 2, 3]), mimeType: "image/png", path: "/tmp/a.png")),
                .text("hello\n\nAttached image file: /tmp/a.png\n(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)")
            ]
        )
        let server = ChatItem(
            id: "srv",
            role: "user",
            blocks: [
                .image(ImageBlock(id: "s1", data: Data([1, 2, 3]), mimeType: "image/png")),
                .text("hello\n\nAttached image file: /tmp/a.png\n(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)")
            ]
        )
        XCTAssertTrue(ChatSession.shouldReplaceOptimisticUser(existing: optimistic, incoming: server))
    }

    func testShouldNotReplaceDifferentText() {
        let a = ChatItem(id: "1", role: "user", blocks: [.text("one")])
        let b = ChatItem(id: "2", role: "user", blocks: [.text("two")])
        XCTAssertFalse(ChatSession.shouldReplaceOptimisticUser(existing: a, incoming: b))
    }

    func testShouldNotReplaceNonUser() {
        let a = ChatItem(id: "1", role: "user", blocks: [.text("x")])
        let b = ChatItem(id: "2", role: "assistant", blocks: [.text("x")])
        XCTAssertFalse(ChatSession.shouldReplaceOptimisticUser(existing: a, incoming: b))
    }

    func testHydrateLoadsMissingImageFromFootnotePath() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-hydrate-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        // Minimal valid 1x1 PNG
        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        let file = dir.appendingPathComponent("shot.png")
        try pngData.write(to: file)

        let note = "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
        let text = "see this\n\nAttached image file: \(file.path)\n\(note)"
        let item = ChatItem(id: "u", role: "user", blocks: [.text(text)])
        let hydrated = ChatSession.hydrateUserImagesIfNeeded(item)

        XCTAssertEqual(ChatSession.imageCount(of: hydrated), 1)
        if case .image(let img)? = hydrated.blocks.first {
            XCTAssertEqual(img.data, pngData)
            XCTAssertEqual(img.path, file.path)
            XCTAssertEqual(img.mimeType, "image/png")
        } else {
            XCTFail("expected leading image block")
        }
        XCTAssertEqual(ChatSession.plainText(of: hydrated), text)
    }

    func testHydrateFillsPathOnExistingImage() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-hydrate-path-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        let file = dir.appendingPathComponent("a.png")
        try pngData.write(to: file)

        let note = "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
        let text = "cap\n\nAttached image file: \(file.path)\n\(note)"
        let item = ChatItem(
            id: "u",
            role: "user",
            blocks: [
                .image(ImageBlock(id: "i", data: pngData, mimeType: "image/png", path: nil)),
                .text(text)
            ]
        )
        let hydrated = ChatSession.hydrateUserImagesIfNeeded(item)
        XCTAssertEqual(ChatSession.imageCount(of: hydrated), 1)
        if case .image(let img)? = hydrated.blocks.first {
            XCTAssertEqual(img.path, file.path)
        } else {
            XCTFail("missing image")
        }
    }

    func testParseImageBlockIgnoreUnknownCharactersAndPathFallback() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-parse-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        let file = dir.appendingPathComponent("x.png")
        try pngData.write(to: file)

        // Whitespace inside base64 → ignoreUnknownCharacters
        let spaced = pngB64.map { String($0) }.joined(separator: "\n")
        let json: [String: Any] = [
            "type": "image",
            "data": spaced,
            "mimeType": "image/png"
        ]
        let block = ChatSession.parseImageBlock(J(json))
        XCTAssertNotNil(block)
        XCTAssertEqual(block?.data, pngData)

        // Path-only fallback
        let pathOnly: [String: Any] = [
            "type": "image",
            "path": file.path
        ]
        let fromPath = ChatSession.parseImageBlock(J(pathOnly))
        XCTAssertNotNil(fromPath)
        XCTAssertEqual(fromPath?.data, pngData)
        XCTAssertEqual(fromPath?.path, file.path)
        XCTAssertEqual(fromPath?.mimeType, "image/png")
    }

    func testNSImageDecodesHydratedPNG() throws {
        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        XCTAssertNotNil(NSImage(data: pngData))
    }
}

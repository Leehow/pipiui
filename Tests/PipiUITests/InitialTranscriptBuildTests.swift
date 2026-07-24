import XCTest
@testable import PipiUI
import Foundation

final class InitialTranscriptBuildTests: XCTestCase {

    func testBuildTranscriptOrderAndRoles() {
        let messages: [J] = [
            J([
                "role": "user",
                "content": "hello",
            ]),
            J([
                "role": "assistant",
                "content": [
                    ["type": "text", "text": "hi there"],
                ],
            ]),
            J([
                "role": "bashExecution",
                "command": "pwd",
                "output": "/tmp",
            ]),
        ]

        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.count, 3)
        XCTAssertEqual(built.items[0].role, "user")
        XCTAssertEqual(built.items[1].role, "assistant")
        XCTAssertEqual(built.items[2].role, "system")
        XCTAssertEqual(built.itemCounter, 3)
        XCTAssertFalse(built.skipNextAssistantIngest)

        XCTAssertEqual(ChatSession.plainText(of: built.items[0]), "hello")
        XCTAssertEqual(ChatSession.plainText(of: built.items[1]), "hi there")
        if case .text(let t) = built.items[2].blocks.first {
            XCTAssertTrue(t.contains("$ pwd"))
            XCTAssertTrue(t.contains("/tmp"))
        } else {
            XCTFail("expected bash system text")
        }
    }

    func testBuildTranscriptSkipsGhostTitlePair() {
        let marker = ChatSession.sessionTitleJobMarker
        let messages: [J] = [
            J([
                "role": "user",
                "content": "\(marker) do not show",
            ]),
            J([
                "role": "assistant",
                "content": "ghost reply",
            ]),
            J([
                "role": "user",
                "content": "real",
            ]),
            J([
                "role": "assistant",
                "content": "ok",
            ]),
        ]

        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.map(\.role), ["user", "assistant"])
        XCTAssertEqual(ChatSession.plainText(of: built.items[0]), "real")
        XCTAssertEqual(ChatSession.plainText(of: built.items[1]), "ok")
    }

    func testBuildTranscriptToolResultImagesAndRuns() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-build-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        let file = dir.appendingPathComponent("tool.png")
        try pngData.write(to: file)

        let messages: [J] = [
            J([
                "role": "assistant",
                "content": [
                    [
                        "type": "toolCall",
                        "id": "call-1",
                        "name": "generate_image",
                        "arguments": ["prompt": "dot"],
                    ],
                ],
            ]),
            J([
                "role": "toolResult",
                "toolCallId": "call-1",
                "isError": false,
                "content": [
                    ["type": "text", "text": "done"],
                    [
                        "type": "image",
                        "path": file.path,
                    ],
                ],
            ]),
        ]

        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.count, 1)
        XCTAssertEqual(built.items[0].role, "assistant")
        guard let run = built.toolRuns["call-1"] else {
            return XCTFail("missing tool run")
        }
        XCTAssertFalse(run.isRunning)
        XCTAssertFalse(run.isError)
        XCTAssertEqual(run.output, "done")
        XCTAssertEqual(run.images.count, 1)
        XCTAssertEqual(run.images[0].data, pngData)
        XCTAssertEqual(run.images[0].path, file.path)
    }

    func testBuildTranscriptHydratesUserFootnoteImages() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-build-user-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        let pngData = Data(base64Encoded: pngB64)!
        let file = dir.appendingPathComponent("u.png")
        try pngData.write(to: file)

        let note = "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
        let text = "see\n\nAttached image file: \(file.path)\n\(note)"
        let messages: [J] = [
            J([
                "role": "user",
                "content": text,
            ]),
        ]

        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.count, 1)
        XCTAssertEqual(ChatSession.imageCount(of: built.items[0]), 1)
        if case .image(let img)? = built.items[0].blocks.first {
            XCTAssertEqual(img.data, pngData)
            XCTAssertEqual(img.path, file.path)
        } else {
            XCTFail("expected hydrated leading image")
        }
    }

    func testBuildTranscriptStableIdsSequential() {
        let messages: [J] = [
            J(["role": "user", "content": "a"]),
            J(["role": "assistant", "content": "b"]),
        ]
        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.map(\.id), ["item-1", "item-2"])
        XCTAssertEqual(built.itemCounter, 2)
    }
}

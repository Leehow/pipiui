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

    func testBuildTranscriptStampsToolDurationAndRunDatesFromTimestamps() throws {
        let messages: [J] = [
            J([
                "role": "assistant",
                "timestamp": "2026-07-26T12:00:00.000Z",
                "content": [
                    [
                        "type": "toolCall",
                        "id": "call-1",
                        "name": "read",
                        "arguments": ["path": "/tmp/x"],
                    ],
                ],
            ]),
            J([
                "role": "toolResult",
                "timestamp": "2026-07-26T12:00:05.000Z",
                "toolCallId": "call-1",
                "isError": false,
                "content": [["type": "text", "text": "ok"]],
            ]),
        ]

        let built = ChatSession.buildTranscript(from: messages)
        XCTAssertEqual(built.items.count, 1)
        guard case .toolCall(let call)? = built.items[0].blocks.first else {
            return XCTFail("expected toolCall block")
        }
        XCTAssertEqual(call.durationSeconds, 5)
        let run = try XCTUnwrap(built.toolRuns["call-1"])
        let startedAt = try XCTUnwrap(run.startedAt)
        let lastOutputAt = try XCTUnwrap(run.lastOutputAt)
        XCTAssertEqual(lastOutputAt.timeIntervalSince(startedAt), 5)
        XCTAssertEqual(run.output, "ok")
    }

    func testBuildTranscriptLeavesDurationNilWithoutUsableTimestamps() throws {
        // No timestamps at all → nil duration, no run dates.
        let plain: [J] = [
            J([
                "role": "assistant",
                "content": [
                    ["type": "toolCall", "id": "c1", "name": "bash", "arguments": ["command": "ls"]],
                ],
            ]),
            J([
                "role": "toolResult",
                "toolCallId": "c1",
                "isError": false,
                "content": ["done"],
            ]),
        ]
        var built = ChatSession.buildTranscript(from: plain)
        guard case .toolCall(let call)? = built.items.first?.blocks.first else {
            return XCTFail("expected toolCall block")
        }
        XCTAssertNil(call.durationSeconds)
        XCTAssertNil(built.toolRuns["c1"]?.startedAt)
        XCTAssertNil(built.toolRuns["c1"]?.lastOutputAt)

        // Result before start (non-positive delta) → duration stays nil.
        let reversed: [J] = [
            J([
                "role": "assistant",
                "timestamp": "2026-07-26T12:00:10.000Z",
                "content": [
                    ["type": "toolCall", "id": "c2", "name": "bash", "arguments": ["command": "ls"]],
                ],
            ]),
            J([
                "role": "toolResult",
                "timestamp": "2026-07-26T12:00:05.000Z",
                "toolCallId": "c2",
                "isError": false,
                "content": ["done"],
            ]),
        ]
        built = ChatSession.buildTranscript(from: reversed)
        guard case .toolCall(let late)? = built.items.first?.blocks.first else {
            return XCTFail("expected toolCall block")
        }
        XCTAssertNil(late.durationSeconds)
    }

    func testStampToolDurationsOnlyStampsPositiveDeltasWithKnownStart() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        var items: [ChatItem] = [
            ChatItem(id: "item-1", role: "assistant", blocks: [
                .toolCall(ToolCallBlock(id: "a", name: "read", argsSummary: "/x")),
                .text("keep me"),
                .toolCall(ToolCallBlock(id: "b", name: "bash", argsSummary: "ls")),
                .toolCall(ToolCallBlock(id: "c", name: "edit", argsSummary: "/f")),
                .toolCall(ToolCallBlock(id: "d", name: "read", argsSummary: "/y")),
                .toolCall(ToolCallBlock(id: "e", name: "read", argsSummary: "/z")),
            ]),
            ChatItem(id: "item-2", role: "user", blocks: [.text("u")]),
        ]
        var alreadyStamped = ToolCallBlock(id: "e", name: "read", argsSummary: "/z")
        alreadyStamped.durationSeconds = 9
        items[0].blocks[5] = .toolCall(alreadyStamped)

        let runs: [String: ToolRun] = [
            // Complete positive delta → stamped.
            "a": ToolRun(
                isRunning: false,
                startedAt: base,
                lastOutputAt: base.addingTimeInterval(5)
            ),
            // Started but no final output time → not stamped.
            "b": ToolRun(isRunning: false, startedAt: base),
            // No start → not stamped.
            "c": ToolRun(isRunning: false, lastOutputAt: base.addingTimeInterval(3)),
            // Negative delta → not stamped.
            "d": ToolRun(
                isRunning: false,
                startedAt: base,
                lastOutputAt: base.addingTimeInterval(-2)
            ),
            // Missing run → existing duration must be preserved, not cleared.
        ]

        ChatSession.stampToolDurations(&items, from: runs)

        XCTAssertEqual(duration(of: items[0], id: "a"), 5)
        XCTAssertNil(duration(of: items[0], id: "b"))
        XCTAssertNil(duration(of: items[0], id: "c"))
        XCTAssertNil(duration(of: items[0], id: "d"))
        XCTAssertEqual(duration(of: items[0], id: "e"), 9)
        XCTAssertEqual(ChatSession.plainText(of: items[0]), "keep me")
        XCTAssertEqual(items[0].blocks.count, 6)
    }

    private func duration(of item: ChatItem, id: String) -> TimeInterval? {
        for block in item.blocks {
            if case .toolCall(let call) = block, call.id == id {
                return call.durationSeconds
            }
        }
        return nil
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

import Foundation
import XCTest
@testable import PipiUI

final class FileChangePresentationTests: XCTestCase {
    func testSuccessfulEditsCoalesceByNormalizedPathWithDeterministicTotals() {
        let first = ToolCallBlock(
            id: "edit-1",
            name: "edit",
            argsSummary: "Sources/Foo.swift",
            fileChangePayload: .edit(
                path: "Sources/./Foo.swift",
                replacements: [
                    .init(oldText: "one\ntwo\n", newText: "ONE\n"),
                ],
                isTruncated: false
            )
        )
        let second = ToolCallBlock(
            id: "edit-2",
            name: "edit",
            argsSummary: "Sources/Foo.swift",
            fileChangePayload: .edit(
                path: "Sources/Foo.swift",
                replacements: [
                    .init(oldText: "three", newText: "THREE\nFOUR"),
                ],
                isTruncated: false
            )
        )

        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(first), .thinking("between"), .toolCall(second)],
            toolRuns: [
                "edit-1": ToolRun(),
                "edit-2": ToolRun(),
            ],
            projectURL: URL(fileURLWithPath: "/tmp/project")
        )

        XCTAssertEqual(result.files.count, 1)
        XCTAssertEqual(result.files[0].displayPath, "Sources/Foo.swift")
        XCTAssertEqual(result.files[0].callIDs, ["edit-1", "edit-2"])
        XCTAssertEqual(result.files[0].additions, 3)
        XCTAssertEqual(result.files[0].deletions, 3)
        XCTAssertEqual(result.additions, 3)
        XCTAssertEqual(result.deletions, 3)
        XCTAssertNil(result.files[0].qualityMessage)
    }

    func testFailedAndMissingRunsDoNotCount() {
        let failed = write(id: "failed", path: "a.txt", content: "a\nb\n")
        let missing = write(id: "missing", path: "b.txt", content: "c")
        let successful = write(id: "successful", path: "c.txt", content: "d\n")

        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(failed), .toolCall(missing), .toolCall(successful)],
            toolRuns: [
                "failed": ToolRun(isError: true),
                "successful": ToolRun(),
            ],
            projectURL: nil
        )

        XCTAssertEqual(result.files.map(\.displayPath), ["c.txt"])
        XCTAssertEqual(result.additions, 1)
        XCTAssertEqual(result.deletions, 0)
    }

    func testWriteIsPresentedAsAdditionsWithHonestMissingPreimageMessage() {
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(write(id: "write", path: "note.md", content: "a\nb\n"))],
            toolRuns: ["write": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(result.files.first?.additions, 2)
        XCTAssertEqual(result.files.first?.deletions, 0)
        XCTAssertEqual(
            result.files.first?.qualityMessage,
            "显示写入内容；缺少写入前版本"
        )
        XCTAssertEqual(
            result.files.first?.lines.map(\.kind),
            [.addition, .addition]
        )
    }

    func testEditDiffExcludesSharedUnchangedLines() {
        let call = ToolCallBlock(
            id: "edit",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [
                    .init(
                        oldText: "keep\nold\nkeep2",
                        newText: "keep\nnew\nkeep2"
                    ),
                ],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(call)],
            toolRuns: ["edit": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(result.additions, 1)
        XCTAssertEqual(result.deletions, 1)
        XCTAssertEqual(result.files[0].lines.map(\.text), ["old", "new"])
        XCTAssertEqual(result.files[0].lines[0].oldLineNumber, 2)
        XCTAssertEqual(result.files[0].lines[1].newLineNumber, 2)
    }

    func testWriteThenUnambiguousEditShowsFinalKnownWrittenStateOnce() {
        let writeCall = write(id: "write", path: "a.txt", content: "a\nb\n")
        let editCall = ToolCallBlock(
            id: "edit",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "b", newText: "B\nc")],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(writeCall), .toolCall(editCall)],
            toolRuns: ["write": ToolRun(), "edit": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(result.files.count, 1)
        XCTAssertEqual(result.additions, 3)
        XCTAssertEqual(result.deletions, 0)
        XCTAssertEqual(result.files[0].lines.map(\.text), ["a", "B", "c"])
        XCTAssertEqual(
            result.files[0].qualityMessage,
            "显示写入内容；缺少写入前版本"
        )
    }

    func testWriteAndRepeatedEditsRetainChronologicalOperations() {
        let writeCall = write(id: "write-1", path: "a.txt", content: "a\nb\n")
        let editOne = ToolCallBlock(
            id: "edit-1",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "b", newText: "B")],
                isTruncated: false
            )
        )
        let editTwo = ToolCallBlock(
            id: "edit-2",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "B", newText: "B\nc")],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [
                .toolCall(writeCall),
                .toolCall(editOne),
                .toolCall(editTwo),
            ],
            toolRuns: [
                "write-1": ToolRun(),
                "edit-1": ToolRun(),
                "edit-2": ToolRun(),
            ],
            projectURL: nil
        )

        XCTAssertEqual(result.files.count, 1)
        XCTAssertEqual(
            result.files[0].operations.map(\.id),
            ["write-1", "edit-1", "edit-2"]
        )
        XCTAssertEqual(
            result.files[0].operations.map(\.toolName),
            ["write", "edit", "edit"]
        )
        XCTAssertEqual(result.additions, 3)
        XCTAssertEqual(result.deletions, 0)
        XCTAssertEqual(result.files[0].lines.map(\.text), ["a", "B", "c"])
    }

    func testFailedOperationIsAbsentBetweenSuccessfulOperations() {
        let writeCall = write(id: "write", path: "a.txt", content: "a\nb\n")
        let failedEdit = ToolCallBlock(
            id: "failed-edit",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "a", newText: "bad")],
                isTruncated: false
            )
        )
        let successfulEdit = ToolCallBlock(
            id: "successful-edit",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "b", newText: "B")],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [
                .toolCall(writeCall),
                .toolCall(failedEdit),
                .toolCall(successfulEdit),
            ],
            toolRuns: [
                "write": ToolRun(),
                "failed-edit": ToolRun(isError: true),
                "successful-edit": ToolRun(),
            ],
            projectURL: nil
        )

        XCTAssertEqual(
            result.files[0].operations.map(\.id),
            ["write", "successful-edit"]
        )
        XCTAssertEqual(result.files[0].lines.map(\.text), ["a", "B"])
    }

    func testRepeatedEditBlocksWithSharedLinesHaveDeterministicTotals() {
        func edit(_ id: String, old: String, new: String) -> ChatBlock {
            .toolCall(ToolCallBlock(
                id: id,
                name: "edit",
                argsSummary: "a.txt",
                fileChangePayload: .edit(
                    path: "a.txt",
                    replacements: [.init(oldText: old, newText: new)],
                    isTruncated: false
                )
            ))
        }
        let blocks: [ChatBlock] = [
            edit("one", old: "keep\nold-1\nend", new: "keep\nnew-1\nend"),
            edit("two", old: "head\nold-2\nkeep", new: "head\nnew-2\nkeep"),
        ]
        let first = FileChangeGroupPresentation.make(
            blocks: blocks,
            toolRuns: ["one": ToolRun(), "two": ToolRun()],
            projectURL: nil
        )
        let second = FileChangeGroupPresentation.make(
            blocks: blocks,
            toolRuns: ["one": ToolRun(), "two": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.additions, 2)
        XCTAssertEqual(first.deletions, 2)
        XCTAssertEqual(
            first.files[0].lines.filter { $0.kind != .separator }.map(\.text),
            ["old-1", "new-1", "old-2", "new-2"]
        )
    }

    func testAmbiguousEditAfterWriteFallsBackToOperationDiffHonestly() {
        let writeCall = write(id: "write", path: "a.txt", content: "same\nsame\n")
        let editCall = ToolCallBlock(
            id: "edit",
            name: "edit",
            argsSummary: "a.txt",
            fileChangePayload: .edit(
                path: "a.txt",
                replacements: [.init(oldText: "same", newText: "changed")],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(writeCall), .toolCall(editCall)],
            toolRuns: ["write": ToolRun(), "edit": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(result.additions, 3)
        XCTAssertEqual(result.deletions, 1)
        XCTAssertTrue(
            result.files[0].qualityMessage?.contains("按操作行统计") == true
        )
    }

    func testPayloadParserKeepsOnlySupportedWriteAndEditShapes() {
        XCTAssertEqual(
            FileChangePayload.parse(
                toolName: "write",
                arguments: J(["file_path": "a.txt", "content": "hello", "secret": "discard"])
            ),
            .write(path: "a.txt", content: "hello", isTruncated: false)
        )
        XCTAssertEqual(
            FileChangePayload.parse(
                toolName: "edit",
                arguments: J([
                    "path": "a.txt",
                    "oldText": "old",
                    "newText": "new",
                ])
            ),
            .edit(
                path: "a.txt",
                replacements: [.init(oldText: "old", newText: "new")],
                isTruncated: false
            )
        )
        XCTAssertNil(
            FileChangePayload.parse(
                toolName: "bash",
                arguments: J(["path": "a.txt", "content": "hello"])
            )
        )
    }

    func testChatConversionPersistsBoundedStructuredPayload() {
        let message = J([
            "role": "assistant",
            "content": [
                [
                    "type": "toolCall",
                    "id": "edit-1",
                    "name": "edit",
                    "arguments": [
                        "file_path": "Sources/Foo.swift",
                        "edits": [
                            ["oldText": "old", "newText": "new"],
                        ],
                        "unrelated": ["must": "not be retained"],
                    ] as [String: Any],
                ] as [String: Any],
            ] as [[String: Any]],
        ])

        guard case .toolCall(let call)? = ChatSession.convert(
            message: message,
            id: "item"
        )?.blocks.first else {
            return XCTFail("expected converted tool call")
        }
        XCTAssertEqual(
            call.fileChangePayload,
            .edit(
                path: "Sources/Foo.swift",
                replacements: [.init(oldText: "old", newText: "new")],
                isTruncated: false
            )
        )
    }

    func testRenderedDiffIsCappedAndDisclosesTruncation() {
        let content = Array(
            repeating: "line",
            count: FileChangeGroupPresentation.renderedLineLimit + 1
        ).joined(separator: "\n")
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(write(id: "large", path: "large.txt", content: content))],
            toolRuns: ["large": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(
            result.files.first?.lines.count,
            FileChangeGroupPresentation.renderedLineLimit
        )
        XCTAssertEqual(
            result.files.first?.qualityMessage,
            "显示写入内容；缺少写入前版本；变更内容过长，以下差异已截断"
        )
        XCTAssertEqual(
            result.files.first?.additions,
            FileChangeGroupPresentation.renderedLineLimit + 1
        )
    }

    func testOversizedLineDiffUsesDisclosedBoundedFallback() {
        let lines = Array(
            repeating: "same",
            count: FileChangeGroupPresentation.lineDiffInputLimit / 2 + 1
        )
        let call = ToolCallBlock(
            id: "large-edit",
            name: "edit",
            argsSummary: "large.txt",
            fileChangePayload: .edit(
                path: "large.txt",
                replacements: [
                    .init(
                        oldText: lines.joined(separator: "\n"),
                        newText: (lines.dropLast() + ["changed"]).joined(separator: "\n")
                    ),
                ],
                isTruncated: false
            )
        )
        let result = FileChangeGroupPresentation.make(
            blocks: [.toolCall(call)],
            toolRuns: ["large-edit": ToolRun()],
            projectURL: nil
        )

        XCTAssertEqual(result.additions, lines.count)
        XCTAssertEqual(result.deletions, lines.count)
        XCTAssertTrue(
            result.files[0].qualityMessage?.contains("按操作行统计") == true
        )
    }

    private func write(id: String, path: String, content: String) -> ToolCallBlock {
        ToolCallBlock(
            id: id,
            name: "write",
            argsSummary: path,
            fileChangePayload: .write(
                path: path,
                content: content,
                isTruncated: false
            )
        )
    }
}

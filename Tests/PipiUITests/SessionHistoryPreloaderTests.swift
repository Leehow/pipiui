import XCTest
@testable import PipiUI

final class SessionHistoryPreloaderTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-history-preload-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: temporaryDirectory,
            withIntermediateDirectories: true
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: temporaryDirectory)
    }

    func testNewSessionReceivesExplicitEmptySeed() throws {
        let seed = try XCTUnwrap(
            SessionInitialTranscriptSeed.select(
                sessionPath: nil,
                cachedTranscript: nil
            )
        )
        XCTAssertEqual(
            seed,
            InitialTranscriptBuild(
                items: [],
                toolRuns: [:],
                itemCounter: 0,
                skipNextAssistantIngest: false
            )
        )
    }

    func testHistoricalSessionUsesCacheHitAsSeed() {
        let cached = InitialTranscriptBuild(
            items: [
                ChatItem(id: "item-1", role: "user", blocks: [.text("cached")]),
            ],
            toolRuns: [:],
            itemCounter: 1,
            skipNextAssistantIngest: false
        )
        XCTAssertEqual(
            SessionInitialTranscriptSeed.select(
                sessionPath: "/tmp/history.jsonl",
                cachedTranscript: cached
            ),
            cached
        )
    }

    func testColdHistoricalSessionKeepsLoadingSeedNil() {
        XCTAssertNil(
            SessionInitialTranscriptSeed.select(
                sessionPath: "/tmp/cold.jsonl",
                cachedTranscript: nil
            )
        )
    }

    func testParserReconstructsLatestActiveBranchAndToolRunsWithoutImages() throws {
        let imageBytes = Data(repeating: 0xAB, count: 128 * 1024).base64EncodedString()
        let file = temporaryDirectory.appendingPathComponent("branch.jsonl")
        try writeJSONLines([
            ["type": "session", "version": 3, "id": "session"],
            ["type": "model_change", "id": "root", "parentId": NSNull()],
            messageEntry(id: "u1", parent: "root", role: "user", content: "root user"),
            messageEntry(id: "a1", parent: "u1", role: "assistant", content: "root answer"),
            messageEntry(id: "old-u", parent: "a1", role: "user", content: "abandoned"),
            messageEntry(id: "old-a", parent: "old-u", role: "assistant", content: "old answer"),
            messageEntry(id: "u2", parent: "a1", role: "user", content: "active user"),
            messageEntry(
                id: "a2",
                parent: "u2",
                role: "assistant",
                content: [
                    ["type": "text", "text": "active answer"],
                    [
                        "type": "image",
                        "source": [
                            "type": "base64",
                            "mediaType": "image/png",
                            "data": imageBytes,
                        ],
                    ],
                    [
                        "type": "toolCall",
                        "id": "call-1",
                        "name": "read",
                        "arguments": ["path": "/tmp/example"],
                    ],
                ]
            ),
            messageEntry(
                id: "tool-1",
                parent: "a2",
                role: "toolResult",
                content: [
                    ["type": "text", "text": "tool output"],
                    ["type": "image", "data": imageBytes, "mimeType": "image/png"],
                ],
                extras: ["toolCallId": "call-1", "isError": false]
            ),
            messageEntry(id: "a3", parent: "tool-1", role: "assistant", content: "done"),
        ], to: file)

        let snapshot = try XCTUnwrap(SessionHistoryParser.load(path: file.path))
        XCTAssertEqual(
            snapshot.transcript.items.map(ChatSession.plainText(of:)),
            ["root user", "root answer", "active user", "active answer", "done"]
        )
        XCTAssertEqual(
            snapshot.transcript.items.compactMap(\.entryId),
            ["u1", "a1", "u2", "a2", "a3"]
        )
        XCTAssertFalse(
            snapshot.transcript.items.contains { ChatSession.imageCount(of: $0) > 0 }
        )
        XCTAssertEqual(snapshot.transcript.toolRuns["call-1"]?.output, "tool output")
        XCTAssertEqual(snapshot.transcript.toolRuns["call-1"]?.images.count, 0)
    }

    func testChangedOrDeletedFileInvalidatesCachedSnapshot() throws {
        let file = temporaryDirectory.appendingPathComponent("invalidate.jsonl")
        try writeSimpleSession(text: "first", padding: 32, to: file)
        let preloader = SessionHistoryPreloader(byteBudget: 1_000_000)
        XCTAssertNotNil(preloader.loadNow(path: file.path))
        XCTAssertNotNil(preloader.snapshotIfCurrent(path: file.path))

        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\n ".utf8))
        try handle.close()
        XCTAssertNil(preloader.snapshotIfCurrent(path: file.path))

        XCTAssertNotNil(preloader.loadNow(path: file.path))
        try FileManager.default.removeItem(at: file)
        XCTAssertNil(preloader.snapshotIfCurrent(path: file.path))
    }

    func testByteBudgetEvictsLeastRecentlyUsedSnapshot() throws {
        let first = temporaryDirectory.appendingPathComponent("first.jsonl")
        let second = temporaryDirectory.appendingPathComponent("second.jsonl")
        try writeSimpleSession(text: "first", padding: 900, to: first)
        try writeSimpleSession(text: "second", padding: 900, to: second)
        let firstSize = try XCTUnwrap(SessionFileIdentity.current(path: first.path)).size
        let secondSize = try XCTUnwrap(SessionFileIdentity.current(path: second.path)).size
        let budget = max(firstSize, secondSize) + 16
        XCTAssertLessThan(budget, firstSize + secondSize)

        let preloader = SessionHistoryPreloader(byteBudget: budget)
        XCTAssertNotNil(preloader.loadNow(path: first.path))
        XCTAssertNotNil(preloader.loadNow(path: second.path))

        XCTAssertNil(preloader.snapshotIfCurrent(path: first.path))
        XCTAssertNotNil(preloader.snapshotIfCurrent(path: second.path))
        XCTAssertEqual(preloader.cachedPaths, [second.path])
    }

    func testOverBudgetSourceIsRejectedBeforeProductionOrSynchronousLoad() throws {
        let oversized = temporaryDirectory.appendingPathComponent("oversized.jsonl")
        try writeSimpleSession(text: "too large", padding: 8_192, to: oversized)
        let identity = try XCTUnwrap(SessionFileIdentity.current(path: oversized.path))
        let budget = max(1, identity.size - 1)
        XCTAssertGreaterThan(identity.size, budget)

        let callsLock = NSLock()
        var parserCalls = 0
        let preloader = SessionHistoryPreloader(
            byteBudget: budget,
            snapshotLoader: { path in
                callsLock.lock()
                parserCalls += 1
                callsLock.unlock()
                return SessionHistoryParser.load(path: path)
            }
        )
        preloader.preload(paths: [oversized.path])
        preloader.waitForAllLoads()
        XCTAssertFalse(preloader.cachedPaths.contains(oversized.path))
        XCTAssertNil(preloader.snapshotIfCurrent(path: oversized.path))

        XCTAssertNil(preloader.loadNow(path: oversized.path))
        XCTAssertFalse(preloader.cachedPaths.contains(oversized.path))
        callsLock.lock()
        let finalParserCalls = parserCalls
        callsLock.unlock()
        XCTAssertEqual(finalParserCalls, 0)
    }

    func testPlanUsesExactlyTwentyPerProjectAndPrioritizesSelectionAndLastSession() {
        let firstProject = URL(fileURLWithPath: "/projects/first")
        let selectedProject = URL(fileURLWithPath: "/projects/selected")
        let first = (0..<25).map {
            SessionMeta(path: "/first/\($0)", name: "\($0)", modified: Date())
        }
        let selected = (0..<25).map {
            SessionMeta(path: "/selected/\($0)", name: "\($0)", modified: Date())
        }

        let result = SessionHistoryPreloadPlan.candidates(
            projects: [firstProject, selectedProject],
            sessionsByProject: [
                firstProject.path: first,
                selectedProject.path: selected,
            ],
            selectedProjectPath: selectedProject.path,
            preferredSessionPath: "/first/3",
            archivedPaths: ["/selected/2"]
        )

        XCTAssertEqual(SessionHistoryPreloadPlan.sessionsPerProject, 20)
        XCTAssertEqual(result.count, 40)
        XCTAssertEqual(result.first, "/first/3")
        XCTAssertFalse(result.contains("/selected/2"))
        XCTAssertFalse(result.contains("/selected/21"))
        XCTAssertFalse(result.contains("/first/20"))
        XCTAssertEqual(
            result.filter { $0.hasPrefix("/selected/") }.count,
            SessionHistoryPreloadPlan.sessionsPerProject
        )
        XCTAssertEqual(
            result.filter { $0.hasPrefix("/first/") }.count,
            SessionHistoryPreloadPlan.sessionsPerProject
        )
    }

    func testDefaultConcurrencyIsExplicitlyBoundedToTwo() {
        let preloader = SessionHistoryPreloader()
        XCTAssertEqual(
            preloader.maxConcurrentLoadCount,
            SessionHistoryPreloader.defaultMaxConcurrentLoads
        )
        XCTAssertEqual(preloader.maxConcurrentLoadCount, 2)
    }

    func testAuthoritativeReconciliationReplacesPreviewWithoutDuplication() {
        let preview = InitialTranscriptBuild(
            items: [
                ChatItem(id: "item-1", role: "user", blocks: [.text("preview old")]),
                ChatItem(id: "item-2", role: "assistant", blocks: [.text("preview answer")]),
            ],
            toolRuns: [
                "preview-tool": ToolRun(isRunning: false, output: "preview"),
            ],
            itemCounter: 2,
            skipNextAssistantIngest: false
        )
        let liveExtra = ChatItem(
            id: "local",
            role: "user",
            blocks: [.text("optimistic")],
            isLocalOnly: true
        )
        let authoritative = InitialTranscriptBuild(
            items: [
                ChatItem(id: "item-1", role: "user", blocks: [.text("authoritative")]),
                ChatItem(id: "item-2", role: "assistant", blocks: [.text("answer")]),
            ],
            toolRuns: [
                "preview-tool": ToolRun(isRunning: false, output: "authoritative"),
            ],
            itemCounter: 2,
            skipNextAssistantIngest: false
        )

        let reconciled = InitialTranscriptReconciler.reconcile(
            authoritative: authoritative,
            currentItems: preview.items + [liveExtra],
            currentToolRuns: preview.toolRuns.merging([
                "live-tool": ToolRun(isRunning: true, output: "live"),
            ]) { _, new in new },
            currentItemCounter: 3,
            previewItemCount: preview.items.count,
            previewToolRunIDs: Set(preview.toolRuns.keys)
        )

        XCTAssertEqual(
            reconciled.items.map(ChatSession.plainText(of:)),
            ["authoritative", "answer", "optimistic"]
        )
        XCTAssertEqual(reconciled.items.last?.id, "item-4")
        XCTAssertEqual(reconciled.items.last?.isLocalOnly, true)
        XCTAssertEqual(reconciled.toolRuns["preview-tool"]?.output, "authoritative")
        XCTAssertEqual(reconciled.toolRuns["live-tool"]?.output, "live")
        XCTAssertEqual(reconciled.appendedLiveItemCount, 1)
    }

    func testChatSessionPublishesSeedBeforeAnyLiveHistoryIsAvailable() {
        let seed = InitialTranscriptBuild(
            items: [
                ChatItem(id: "item-1", role: "user", blocks: [.text("cached")]),
            ],
            toolRuns: [:],
            itemCounter: 1,
            skipNextAssistantIngest: false
        )
        let session = ChatSession(
            id: "resume:/tmp/preloaded.jsonl",
            projectURL: temporaryDirectory,
            sessionPath: "/tmp/preloaded.jsonl",
            blockedReason: "test blocks process construction",
            initialTranscript: seed
        )

        XCTAssertEqual(session.transcript.map(ChatSession.plainText(of:)), ["cached"])
        XCTAssertFalse(session.isInitializing)
        XCTAssertFalse(session.processAlive)
        XCTAssertEqual(session.transcriptVisibleCount, 150)
    }

    private func writeSimpleSession(text: String, padding: Int, to file: URL) throws {
        try writeJSONLines([
            ["type": "session", "version": 3, "id": "session", "padding": String(repeating: "x", count: padding)],
            ["type": "model_change", "id": "root", "parentId": NSNull()],
            messageEntry(id: "u1", parent: "root", role: "user", content: text),
        ], to: file)
    }

    private func messageEntry(
        id: String,
        parent: String,
        role: String,
        content: Any,
        extras: [String: Any] = [:]
    ) -> [String: Any] {
        var message: [String: Any] = [
            "role": role,
            "content": content,
        ]
        for (key, value) in extras {
            message[key] = value
        }
        return [
            "type": "message",
            "id": id,
            "parentId": parent,
            "message": message,
        ]
    }

    private func writeJSONLines(_ objects: [[String: Any]], to file: URL) throws {
        var data = Data()
        for object in objects {
            data.append(try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
            data.append(0x0A)
        }
        try data.write(to: file, options: .atomic)
    }
}

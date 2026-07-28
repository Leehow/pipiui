import XCTest
@testable import PipiUI

final class ComputerScreenshotChatTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ComputerScreenshotMemoryCache.removeAll()
    }

    override func tearDown() {
        ComputerScreenshotMemoryCache.removeAll()
        super.tearDown()
    }

    func testCacheHitYieldsOneToolRunImageFromMarker() {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01])
        let id = ComputerScreenshotMemoryCache.retain(pngData: png)
        let content = J([
            [
                "type": "text",
                "text":
                    "{\n  \"batchOK\": true\n}\n[PIPIUI_COMPUTER_SCREENSHOT:\(id)]",
            ] as [String: Any],
        ])

        let images = ChatSession.contentImages(content, allowDiskRead: false)
        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(images[0].id, id)
        XCTAssertEqual(images[0].data, png)
        XCTAssertEqual(images[0].mimeType, "image/png")
        XCTAssertFalse(ChatSession.contentText(content).contains(png.base64EncodedString()))
    }

    func testCacheMissYieldsNoImagesAndDoesNotThrow() {
        let content = J([
            [
                "type": "text",
                "text":
                    "{\n  \"batchOK\": true\n}\n"
                    + "[PIPIUI_COMPUTER_SCREENSHOT:00000000-0000-4000-8000-000000000099]",
            ] as [String: Any],
        ])

        let images = ChatSession.contentImages(content, allowDiskRead: false)
        XCTAssertTrue(images.isEmpty)
    }

    func testOrdinaryImageBlocksWinOverMarkers() {
        let png = Data([0x01, 0x02, 0x03, 0x04])
        let markerId = ComputerScreenshotMemoryCache.retain(pngData: Data([0xFF]))
        let content = J([
            [
                "type": "image",
                "data": png.base64EncodedString(),
                "mimeType": "image/png",
            ] as [String: Any],
            [
                "type": "text",
                "text": "[PIPIUI_COMPUTER_SCREENSHOT:\(markerId)]",
            ] as [String: Any],
        ])

        let images = ChatSession.contentImages(content, allowDiskRead: false)
        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(images[0].data, png)
        XCTAssertNotEqual(images[0].id, markerId)
    }

    func testDisplayTextStripsMarkerButKeepsMetadata() {
        let id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        let raw =
            "{\n  \"batchOK\": true,\n  \"width\": 100\n}\n"
            + "[PIPIUI_COMPUTER_SCREENSHOT:\(id)]"
        let display = ComputerScreenshotMarker.displayText(raw)
        XCTAssertFalse(display.contains("PIPIUI_COMPUTER_SCREENSHOT"))
        XCTAssertFalse(display.contains(id))
        XCTAssertTrue(display.contains("batchOK"))
        XCTAssertTrue(display.contains("100"))
    }

    func testDisplayTextWithOnlyMarkerIsEmpty() {
        let display = ComputerScreenshotMarker.displayText(
            "[PIPIUI_COMPUTER_SCREENSHOT:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]"
        )
        XCTAssertTrue(display.isEmpty)
    }

    func testAttachStampsScreenshotIdAndRetainsBytes() {
        let png = Data([0x89, 0x50, 0x4E, 0x47])
        var response: [String: Any] = ["ok": true]
        ComputerScreenshotMemoryCache.attach(to: &response, pngData: png)

        let id = try! XCTUnwrap(response["screenshotId"] as? String)
        XCTAssertEqual(response["mimeType"] as? String, "image/png")
        XCTAssertEqual(response["base64"] as? String, png.base64EncodedString())
        XCTAssertEqual(ComputerScreenshotMemoryCache.entry(for: id)?.data, png)
    }

    func testFifoEvictsOldestBeyondCapacity() {
        var ids: [String] = []
        for i in 0..<(ComputerScreenshotMemoryCache.maxCount + 2) {
            let id = ComputerScreenshotMemoryCache.retain(
                pngData: Data([UInt8(i)]),
                id: "id-\(i)"
            )
            ids.append(id)
        }
        XCTAssertNil(ComputerScreenshotMemoryCache.entry(for: ids[0]))
        XCTAssertNil(ComputerScreenshotMemoryCache.entry(for: ids[1]))
        XCTAssertNotNil(ComputerScreenshotMemoryCache.entry(for: ids.last!))
    }

    func testBridgeScreenshotIdAlignsWithNodeMarkerContractInExtensionSource() {
        let source = ComputerUseExtension.source
        XCTAssertTrue(source.contains("result.screenshotId"))
        XCTAssertTrue(source.contains("result?.screenshotId"))
        XCTAssertTrue(source.contains("missing stable screenshotId"))
        XCTAssertTrue(source.contains("refusing unhydratable marker"))
        XCTAssertTrue(source.contains("PIPIUI_COMPUTER_SCREENSHOT"))
        // Marker-only path must not put base64 into toolResult content assembly beyond retain.
        XCTAssertTrue(source.contains("Keep only an opaque marker in agent"))
        // screenshotToolResult must require bridge id; random UUID fallback is only for
        // Node-local retain helpers, not agent-facing markers.
        XCTAssertTrue(source.contains(
            "Callers that mint agent-facing markers must require a stable bridge id"
        ))
    }

    @MainActor
    func testFinishBatchWithoutOwnershipDoesNotCacheOrRespond() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        var responses: [[String: Any]] = []
        let app = ComputerApplicationIdentity(
            bundleID: "com.example.editor",
            name: "Editor",
            processID: 42,
            windowTitle: "Doc"
        )
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xAA])
        let screenshot = ComputerScreenshot(
            pngData: png,
            imageSize: .init(width: 100, height: 80),
            displayID: 1,
            app: app
        )
        // Fill FIFO so any orphan retain would evict the oldest keep-* entry.
        var kept: [String] = []
        for i in 0..<ComputerScreenshotMemoryCache.maxCount {
            kept.append(
                ComputerScreenshotMemoryCache.retain(
                    pngData: Data([UInt8(i)]),
                    id: "keep-\(i)"
                )
            )
        }
        let execution = ComputerInFlightExecution(
            requestID: UUID().uuidString,
            sessionKey: "lost-owner",
            generation: 1,
            gate: ComputerExecutionGate(),
            reply: ComputerResponseGate { responses.append($0) }
        )
        // Superseded path: execution is no longer the in-flight owner.
        coordinator.inFlightExecution = nil
        coordinator.executionGeneration = 2
        execution.markNoLongerCurrent()

        coordinator.finishBatch(
            ComputerBatchExecutionResult(
                outcomes: [],
                screenshot: screenshot,
                finalApplication: app,
                focusDrift: false,
                error: nil
            ),
            request: ComputerRequest(actions: []),
            execution: execution,
            auditSessionID: "audit-lost-owner"
        )

        XCTAssertTrue(responses.isEmpty, "lost ownership must not respond")
        for id in kept {
            XCTAssertNotNil(
                ComputerScreenshotMemoryCache.entry(for: id),
                "orphan capture must not retain into the FIFO cache"
            )
        }
        XCTAssertEqual(
            ComputerScreenshotMemoryCache.entry(for: kept[0])?.data,
            Data([0])
        )
    }

    @MainActor
    func testFinishBatchWithOwnershipCachesAlignedScreenshotId() {
        let coordinator = ComputerCoordinator(computerUseEnabledProvider: { true })
        var responses: [[String: Any]] = []
        let app = ComputerApplicationIdentity(
            bundleID: "com.example.editor",
            name: "Editor",
            processID: 42,
            windowTitle: "Doc"
        )
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xBB])
        let screenshot = ComputerScreenshot(
            pngData: png,
            imageSize: .init(width: 120, height: 90),
            displayID: 1,
            app: app
        )
        let execution = ComputerInFlightExecution(
            requestID: UUID().uuidString,
            sessionKey: "owner",
            generation: 7,
            gate: ComputerExecutionGate(),
            reply: ComputerResponseGate { responses.append($0) }
        )
        coordinator.executionGeneration = 7
        coordinator.inFlightExecution = execution

        coordinator.finishBatch(
            ComputerBatchExecutionResult(
                outcomes: [],
                screenshot: screenshot,
                finalApplication: app,
                focusDrift: false,
                error: nil
            ),
            request: ComputerRequest(actions: []),
            execution: execution,
            auditSessionID: "audit-owner"
        )

        XCTAssertEqual(responses.count, 1)
        let id = try! XCTUnwrap(responses[0]["screenshotId"] as? String)
        XCTAssertEqual(ComputerScreenshotMemoryCache.entry(for: id)?.data, png)
        XCTAssertEqual(responses[0]["base64"] as? String, png.base64EncodedString())
        XCTAssertNil(coordinator.inFlightExecution)
    }
}

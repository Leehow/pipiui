import XCTest
import AppKit
@testable import PipiUI

@MainActor
final class CuaDriverIntegrationTests: XCTestCase {
    private struct Launch {
        let bundleID: String
        let name: String
        let processID: Int32
        let windowID: UInt32
    }

    private final class FrontmostSequence: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [ComputerApplicationIdentity?]

        init(_ values: [ComputerApplicationIdentity?]) {
            self.values = values
        }

        func next() -> ComputerApplicationIdentity? {
            lock.withLock {
                guard values.count > 1 else { return values.first ?? nil }
                return values.removeFirst()
            }
        }
    }

    private final class FakeDriver: CuaDriverTransport, @unchecked Sendable {
        struct Call {
            let tool: String
            let arguments: [String: Any]
        }

        private let lock = NSLock()
        private var launch = Launch(
            bundleID: "com.example.Editor",
            name: "Editor",
            processID: 101,
            windowID: 1001
        )
        private var windows: [Int32: [UInt32]] = [101: [1001]]
        private var detailedWindows: [Int32: [[String: Any]]] = [:]
        private var launchIncludesWindows = true
        private var recordedCalls: [Call] = []
        private var nextFailures: [String: Error] = [:]
        private var snapshotSequence = 0
        private var blockedTool: String?
        private var blockedContinuation:
            CheckedContinuation<CuaToolResult, Error>?
        private var stopCount = 0
        let pngBase64: String

        init(pngBase64: String) {
            self.pngBase64 = pngBase64
        }

        var calls: [Call] {
            lock.withLock { recordedCalls }
        }

        var cancellations: Int {
            lock.withLock { stopCount }
        }

        var hasBlockedCall: Bool {
            lock.withLock { blockedContinuation != nil }
        }

        func setLaunch(_ value: Launch) {
            lock.withLock {
                launch = value
                windows[value.processID] = [value.windowID]
                detailedWindows.removeValue(forKey: value.processID)
                launchIncludesWindows = true
            }
        }

        func setWindows(_ value: [UInt32], processID: Int32) {
            lock.withLock {
                windows[processID] = value
                detailedWindows.removeValue(forKey: processID)
            }
        }

        func setWindowRecords(
            _ value: [[String: Any]],
            processID: Int32
        ) {
            lock.withLock {
                detailedWindows[processID] = value
                windows[processID] = value.compactMap {
                    ($0["window_id"] as? NSNumber)?.uint32Value
                }
            }
        }

        func setLaunchIncludesWindows(_ value: Bool) {
            lock.withLock { launchIncludesWindows = value }
        }

        func block(_ tool: String) {
            lock.withLock { blockedTool = tool }
        }

        func failNext(_ tool: String, error: Error) {
            lock.withLock { nextFailures[tool] = error }
        }

        func call(
            tool: String,
            arguments: [String: Any]
        ) async throws -> CuaToolResult {
            let disposition = lock.withLock {
                recordedCalls.append(Call(tool: tool, arguments: arguments))
                return (blockedTool == tool, nextFailures.removeValue(
                    forKey: tool
                ))
            }
            if let failure = disposition.1 {
                throw failure
            }
            if disposition.0 {
                return try await withCheckedThrowingContinuation {
                    continuation in
                    lock.withLock {
                        blockedContinuation = continuation
                    }
                }
            }
            return response(tool: tool, arguments: arguments)
        }

        func cancelAndStop() {
            let pending = lock.withLock {
                stopCount += 1
                let pending = blockedContinuation
                blockedContinuation = nil
                blockedTool = nil
                return pending
            }
            pending?.resume(throwing: CuaDriverError.cancelled)
        }

        private func response(
            tool: String,
            arguments: [String: Any]
        ) -> CuaToolResult {
            switch tool {
            case "start_session", "bring_to_front", "end_session",
                 "click", "double_click", "drag", "move_cursor", "type_text",
                 "press_key", "hotkey", "scroll":
                return CuaToolResult(structuredContent: ["ok": true])
            case "launch_app":
                return lock.withLock {
                    CuaToolResult(structuredContent: [
                        "bundle_id": launch.bundleID,
                        "name": launch.name,
                        "pid": launch.processID,
                        "windows": launchIncludesWindows
                            ? windowDictionaries(processID: launch.processID)
                            : [],
                    ])
                }
            case "list_windows":
                let processID = (arguments["pid"] as? NSNumber)?
                    .int32Value ?? 0
                return lock.withLock {
                    CuaToolResult(structuredContent: [
                        "windows": windowDictionaries(processID: processID),
                    ])
                }
            case "get_window_state":
                let windowID = (arguments["window_id"] as? NSNumber)?
                    .uint32Value ?? 0
                let sequence = lock.withLock {
                    snapshotSequence += 1
                    return snapshotSequence
                }
                return CuaToolResult(
                    content: [[
                        "type": "image",
                        "data": pngBase64,
                        "mimeType": "image/png",
                    ]],
                    structuredContent: [
                        "screenshot_width": 200,
                        "screenshot_height": 100,
                        "snapshot_id": "snapshot-\(windowID)",
                        "elements": [[
                            "element_index": 0,
                            "element_token":
                                "field-token-\(windowID)-\(sequence)",
                            "role": "AXTextField",
                        ]],
                    ]
                )
            default:
                return CuaToolResult(
                    content: [[
                        "type": "text",
                        "text": "unexpected tool \(tool)",
                    ]],
                    isError: true
                )
            }
        }

        private func windowDictionaries(
            processID: Int32
        ) -> [[String: Any]] {
            if let detailed = detailedWindows[processID] {
                return detailed
            }
            return (windows[processID] ?? []).map {
                [
                    "window_id": $0,
                    "pid": processID,
                    "app_name": launch.name,
                    "title": "Window \($0)",
                ]
            }
        }
    }

    private let descriptor = ComputerCaptureDescriptor(
        displayID: 7,
        outputSize: ComputerImageSize(width: 300, height: 300),
        globalBounds: CGRect(x: 0, y: 0, width: 300, height: 300)
    )

    func testOpenApplicationStoresExactCuaTargetAndSwitchesByName() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)

        let first = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        XCTAssertEqual(first["ok"] as? Bool, true)
        XCTAssertEqual(target(first)["processID"] as? Int32, 101)
        XCTAssertEqual(target(first)["windowID"] as? UInt32, 1001)
        XCTAssertEqual(
            (first["screenshotTarget"] as? [String: Any])?["screenshotIdentity"]
                as? String,
            "snapshot-1001"
        )

        driver.setLaunch(Launch(
            bundleID: "com.example.Viewer",
            name: "Viewer",
            processID: 202,
            windowID: 2002
        ))
        let second = await open(
            coordinator,
            session: "session-a",
            applicationName: "Viewer"
        )
        XCTAssertEqual(second["ok"] as? Bool, true)
        XCTAssertEqual(target(second)["bundleID"] as? String, "com.example.Viewer")
        XCTAssertEqual(target(second)["processID"] as? Int32, 202)
        XCTAssertEqual(
            driver.calls.filter { $0.tool == "launch_app" }.last?
                .arguments["name"] as? String,
            "Viewer"
        )
    }

    func testLaunchAppSelectsChromeMainWindowOverUtilityWindows() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let processID: Int32 = 41_272
        driver.setLaunch(Launch(
            bundleID: "com.google.Chrome",
            name: "Google Chrome",
            processID: processID,
            windowID: 308_217
        ))
        driver.setWindowRecords(
            chromeLikeWindows(processID: processID),
            processID: processID
        )

        let response = await open(
            makeCoordinator(driver),
            session: "session-a",
            bundleID: "com.google.Chrome"
        )

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(target(response)["windowID"] as? UInt32, 308_215)
        XCTAssertFalse(driver.calls.contains { $0.tool == "list_windows" })
        XCTAssertEqual(
            driver.calls.first { $0.tool == "bring_to_front" }?
                .arguments["window_id"] as? UInt32,
            308_215
        )
        XCTAssertEqual(
            driver.calls.first { $0.tool == "get_window_state" }?
                .arguments["window_id"] as? UInt32,
            308_215
        )
    }

    func testListWindowsFallbackSelectsChromeMainWindowOverUtilityWindows()
        async throws {
        let driver = FakeDriver(pngBase64: try png())
        let processID: Int32 = 41_272
        driver.setLaunch(Launch(
            bundleID: "com.google.Chrome",
            name: "Google Chrome",
            processID: processID,
            windowID: 308_217
        ))
        driver.setWindowRecords(
            chromeLikeWindows(processID: processID),
            processID: processID
        )
        driver.setLaunchIncludesWindows(false)

        let response = await open(
            makeCoordinator(driver),
            session: "session-a",
            bundleID: "com.google.Chrome"
        )

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(target(response)["windowID"] as? UInt32, 308_215)
        XCTAssertEqual(
            driver.calls.filter { $0.tool == "list_windows" }.count,
            1
        )
        XCTAssertEqual(
            driver.calls.first { $0.tool == "bring_to_front" }?
                .arguments["window_id"] as? UInt32,
            308_215
        )
    }

    func testFinderDownloadsUsesPinnedWindowShortcutRoute() async throws {
        let driver = FakeDriver(pngBase64: try png())
        driver.setLaunch(Launch(
            bundleID: "com.apple.finder",
            name: "Finder",
            processID: 901,
            windowID: 9_001
        ))
        let coordinator = makeCoordinator(driver)

        let opened = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.apple.finder"
        )
        XCTAssertEqual(opened["ok"] as? Bool, true)
        let downloads = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads", isDirectory: true).path
        let navigated = await batch(
            coordinator,
            session: "session-a",
            actions: [
                ["type": "keypress", "keys": ["CMD", "SHIFT", "G"]],
                ["type": "type", "text": downloads],
                ["type": "keypress", "keys": ["ENTER"]],
            ]
        )

        XCTAssertEqual(navigated["ok"] as? Bool, true)
        let navigationCalls = driver.calls.filter {
            ["hotkey", "type_text", "press_key"].contains($0.tool)
        }
        XCTAssertEqual(
            navigationCalls.map(\.tool),
            ["hotkey", "type_text", "press_key"]
        )
        XCTAssertEqual(
            navigationCalls[0].arguments["keys"] as? [String],
            ["CMD", "SHIFT", "G"]
        )
        XCTAssertEqual(
            navigationCalls[1].arguments["text"] as? String,
            downloads
        )
        XCTAssertEqual(
            navigationCalls[2].arguments["key"] as? String,
            "ENTER"
        )
        XCTAssertEqual(
            Set(navigationCalls.compactMap {
                $0.arguments["window_id"] as? UInt32
            }),
            [9_001]
        )
        XCTAssertTrue(
            driver.calls.suffix(1).allSatisfy {
                $0.tool == "get_window_state"
                    && ($0.arguments["window_id"] as? UInt32) == 9_001
            }
        )
    }

    func testTwoSessionsRetainIndependentTargetsWhenFrontmostAppChanges() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        driver.setLaunch(Launch(
            bundleID: "com.example.Viewer",
            name: "Viewer",
            processID: 202,
            windowID: 2002
        ))
        _ = await open(
            coordinator,
            session: "session-b",
            bundleID: "com.example.Viewer"
        )

        let responseA = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "click", "x": 150, "y": 150]]
        )
        let responseB = await batch(
            coordinator,
            session: "session-b",
            actions: [["type": "type", "text": "hello"]]
        )

        XCTAssertEqual(target(responseA)["processID"] as? Int32, 101)
        XCTAssertEqual(target(responseA)["windowID"] as? UInt32, 1001)
        XCTAssertEqual(target(responseB)["processID"] as? Int32, 202)
        XCTAssertEqual(target(responseB)["windowID"] as? UInt32, 2002)
        let clicks = driver.calls.filter { $0.tool == "click" }
        XCTAssertEqual(clicks.last?.arguments["pid"] as? Int32, 101)
        XCTAssertEqual(clicks.last?.arguments["window_id"] as? UInt32, 1001)
        let types = driver.calls.filter { $0.tool == "type_text" }
        XCTAssertEqual(types.last?.arguments["pid"] as? Int32, 202)
    }

    func testTargetLossClearsStoredTargetAndRequiresReopen() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        driver.setWindows([], processID: 101)

        let lost = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "screenshot"]]
        )
        XCTAssertEqual(lost["ok"] as? Bool, false)
        XCTAssertTrue(
            (lost["error"] as? String)?.contains("no longer owns") == true
        )
        let missing = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "screenshot"]]
        )
        XCTAssertEqual(
            missing["errorCode"] as? String,
            "computer_target_missing"
        )
    }

    func testPrimaryWindowLossDoesNotRetargetSiblingWindow() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        driver.setWindows([1002], processID: 101)

        let lost = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "click", "x": 150, "y": 150]]
        )
        XCTAssertEqual(lost["errorCode"] as? String, "computer_target_lost")
        XCTAssertFalse(driver.calls.contains {
            $0.tool == "click"
                && ($0.arguments["window_id"] as? UInt32) == 1002
        })
        let missing = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "screenshot"]]
        )
        XCTAssertEqual(
            missing["errorCode"] as? String,
            "computer_target_missing"
        )
    }

    func testExactBundleMismatchFailsClosed() async throws {
        let driver = FakeDriver(pngBase64: try png())
        driver.setLaunch(Launch(
            bundleID: "com.example.Impostor",
            name: "Impostor",
            processID: 303,
            windowID: 3003
        ))
        let response = await open(
            makeCoordinator(driver),
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "expected exact bundle"
            ) == true
        )
    }

    func testSessionPinnedAXIndexIsTranslatedToSnapshotToken() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        _ = await open(
            coordinator,
            session: "session-b",
            bundleID: "com.example.Editor"
        )

        let response = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "click", "element_index": 0]]
        )
        XCTAssertEqual(response["ok"] as? Bool, true)
        let click = try XCTUnwrap(driver.calls.last {
            $0.tool == "click"
        })
        XCTAssertNil(click.arguments["element_index"])
        XCTAssertEqual(
            click.arguments["element_token"] as? String,
            "field-token-1001-1",
            "session A must keep its own snapshot token even after session B observes the same window"
        )
    }

    func testFinalObservationTransportFailureReportsUnknownAndRequiresReopen() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        driver.failNext(
            "get_window_state",
            error: CuaDriverError.protocolFailure("synthetic timeout")
        )

        let response = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "click", "x": 150, "y": 150]]
        )
        XCTAssertEqual(
            response["errorCode"] as? String,
            "computer_outcome_unknown"
        )
        XCTAssertEqual(response["outcomeUnknown"] as? Bool, true)
        XCTAssertEqual(response["requiresReopen"] as? Bool, true)
        let outcomes = response["outcomes"] as? [[String: Any]]
        XCTAssertEqual(outcomes?.first?["ok"] as? Bool, true)
        XCTAssertTrue(
            (response["error"] as? String)?.contains(
                "Do not blindly retry"
            ) == true
        )
        let missing = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "screenshot"]]
        )
        XCTAssertEqual(
            missing["errorCode"] as? String,
            "computer_target_missing"
        )
    }

    func testUnsupportedHoldAndExactClickSemantics() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        let hold = await batch(
            coordinator,
            session: "session-a",
            actions: [[
                "type": "hold_key",
                "keys": ["A"],
                "duration": 1,
            ]]
        )
        XCTAssertEqual(hold["ok"] as? Bool, false)
        XCTAssertTrue(
            (hold["error"] as? String)?.contains(
                "hold_key is unsupported"
            ) == true
        )

        let double = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "double_click", "element_index": 0]]
        )
        XCTAssertEqual(double["ok"] as? Bool, true)
        XCTAssertTrue(driver.calls.contains {
            $0.tool == "double_click"
                && $0.arguments["element_token"] != nil
        })

        let triple = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "triple_click", "element_index": 0]]
        )
        XCTAssertEqual(triple["ok"] as? Bool, false)
        XCTAssertTrue(
            (triple["error"] as? String)?.contains(
                "triple_click does not support AX"
            ) == true
        )
    }

    func testBatchMapsCoordinatesAXAndDragThenReturnsFreshScreenshot() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )

        let response = await batch(
            coordinator,
            session: "session-a",
            actions: [
                ["type": "mouse_move", "x": 150, "y": 150],
                ["type": "click", "element_index": 0],
                ["type": "left_mouse_down", "x": 75, "y": 150],
                ["type": "mouse_move", "x": 225, "y": 150],
                ["type": "left_mouse_up", "x": 225, "y": 150],
            ]
        )

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertNotNil(response["base64"] as? String)
        XCTAssertEqual((response["outcomes"] as? [[String: Any]])?.count, 5)
        let firstEvidence = ((response["outcomes"] as? [[String: Any]])?
            .first?["driverEvidence"] as? [String: Any])
        XCTAssertEqual(
            firstEvidence?["cursorSemantics"] as? String,
            "agent_overlay_only"
        )
        XCTAssertEqual(firstEvidence?["nativeHover"] as? Bool, false)
        XCTAssertEqual(
            (response["foregroundApp"] as? [String: Any])?["bundleID"]
                as? String,
            "com.unrelated.Frontmost"
        )
        let move = try XCTUnwrap(
            driver.calls.first { $0.tool == "move_cursor" }
        )
        XCTAssertNil(move.arguments["pid"])
        XCTAssertNil(move.arguments["window_id"])
        XCTAssertEqual(
            try XCTUnwrap(move.arguments["x"] as? Double),
            100,
            accuracy: 0.01
        )
        XCTAssertEqual(
            try XCTUnwrap(move.arguments["y"] as? Double),
            50,
            accuracy: 0.01
        )
        let axClick = try XCTUnwrap(
            driver.calls.first {
                $0.tool == "click"
                    && $0.arguments["element_token"] != nil
            }
        )
        XCTAssertNil(axClick.arguments["element_index"])
        XCTAssertEqual(
            axClick.arguments["element_token"] as? String,
            "field-token-1001-1"
        )
        let drag = try XCTUnwrap(
            driver.calls.first { $0.tool == "drag" }
        )
        XCTAssertEqual(
            try XCTUnwrap(drag.arguments["from_x"] as? Double),
            50,
            accuracy: 0.01
        )
        XCTAssertEqual(
            try XCTUnwrap(drag.arguments["to_x"] as? Double),
            150,
            accuracy: 0.01
        )
        let stateCalls = driver.calls.filter {
            $0.tool == "get_window_state"
        }
        XCTAssertEqual(
            stateCalls.count,
            2,
            "open and the completed batch must each capture fresh state"
        )
        for call in stateCalls {
            XCTAssertEqual(
                call.arguments["max_elements"] as? Int,
                ComputerCoordinator.cuaMaximumAccessibilityElements
            )
            XCTAssertEqual(
                call.arguments["max_depth"] as? Int,
                ComputerCoordinator.cuaMaximumAccessibilityDepth
            )
        }
    }

    func testCancellationStopsBlockedTransportAndReleasesMutex() async throws {
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(driver)
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        driver.block("click")
        let requestID = UUID().uuidString
        let responseTask = Task { @MainActor in
            await batch(
                coordinator,
                session: "session-a",
                requestID: requestID,
                actions: [["type": "click", "x": 150, "y": 150]]
            )
        }
        for _ in 0..<100 where !driver.hasBlockedCall {
            await Task.yield()
        }
        XCTAssertTrue(driver.hasBlockedCall)
        XCTAssertTrue(coordinator.cancelCuaRequest(
            requestID: requestID,
            sessionKey: "session-a",
            reason: "test emergency stop",
            respond: true
        ))
        let cancelled = await responseTask.value
        XCTAssertEqual(
            cancelled["errorCode"] as? String,
            "computer_cancelled"
        )
        XCTAssertEqual(driver.cancellations, 1)
        // Mutex must free immediately so a retry can begin; presentation stays
        // in the grace window (activeSessionKey retained) until hard clear.
        XCTAssertNil(coordinator.cuaInFlightOperation)
        XCTAssertTrue(coordinator.isPresentingDesktopOperation)
        XCTAssertEqual(coordinator.activeSessionKey, "session-a")
        XCTAssertNotNil(coordinator.presentationGraceWork)
    }

    func testBatchReportsObservedForegroundAndFocusDrift() async throws {
        let before = ComputerApplicationIdentity(
            bundleID: "com.example.Before",
            name: "Before",
            processID: 701,
            windowTitle: "Before Window"
        )
        let after = ComputerApplicationIdentity(
            bundleID: "com.example.After",
            name: "After",
            processID: 702,
            windowTitle: "After Window"
        )
        let sequence = FrontmostSequence([before, before, after])
        let driver = FakeDriver(pngBase64: try png())
        let coordinator = makeCoordinator(
            driver,
            frontmostApplicationProvider: { sequence.next() }
        )
        _ = await open(
            coordinator,
            session: "session-a",
            bundleID: "com.example.Editor"
        )
        let response = await batch(
            coordinator,
            session: "session-a",
            actions: [["type": "screenshot"]]
        )
        XCTAssertEqual(response["focusDrift"] as? Bool, true)
        XCTAssertEqual(
            (response["foregroundApp"] as? [String: Any])?["bundleID"]
                as? String,
            "com.example.After"
        )
        XCTAssertEqual(response["windowTitle"] as? String, "After Window")
    }

    func testTransformLetterboxesExactlyAndRejectsMarginCoordinates() throws {
        let transform = try CuaScreenshotTransform(
            sourceSize: ComputerImageSize(width: 200, height: 100),
            advertisedSize: ComputerImageSize(width: 300, height: 300)
        )
        XCTAssertEqual(transform.scale, 1.5, accuracy: 0.0001)
        XCTAssertEqual(transform.offsetX, 0, accuracy: 0.0001)
        XCTAssertEqual(transform.offsetY, 75, accuracy: 0.0001)
        let source = try transform.advertisedToSource(
            ComputerImagePoint(x: 150, y: 150)
        )
        XCTAssertEqual(source.x, 100, accuracy: 0.0001)
        XCTAssertEqual(source.y, 50, accuracy: 0.0001)
        XCTAssertThrowsError(try transform.advertisedToSource(
            ComputerImagePoint(x: 150, y: 20)
        ))
        XCTAssertThrowsError(try transform.advertisedToSource(
            ComputerImagePoint(x: 300, y: 150)
        ))

        let rendered = try transform.renderAdvertisedPNG(base64: png())
        let image = try XCTUnwrap(NSBitmapImageRep(
            data: try XCTUnwrap(Data(base64Encoded: rendered))
        ))
        XCTAssertEqual(image.pixelsWide, 300)
        XCTAssertEqual(image.pixelsHigh, 300)
    }

    func testRuntimeUsesExactTrustedEmbeddedEnvironment() {
        XCTAssertEqual(CuaDriverProcessRuntime.environmentOverlay, [
            "CUA_DRIVER_EMBEDDED": "1",
            "CUA_DRIVER_HOST_BUNDLE_ID": "com.leehow.pipiui",
            "CUA_DRIVER_PERMISSION_MODE": "unrestricted",
            "CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS": "1",
            "CUA_DRIVER_RS_TELEMETRY_ENABLED": "false",
        ])
    }

    func testRuntimeHandshakeRejectsWrongProtocolOrHostAttribution() throws {
        XCTAssertNoThrow(try CuaDriverProcessRuntime
            .validateInitializeResponse([
                "result": ["protocolVersion": "2025-06-18"],
            ]))
        XCTAssertThrowsError(try CuaDriverProcessRuntime
            .validateInitializeResponse([
                "result": ["protocolVersion": "2024-11-05"],
            ]))
        let validSource: [String: Any] = [
            "source": [
                "attribution": "host",
                "embedded": true,
                "host_bundle_id": "com.leehow.pipiui",
            ],
        ]
        XCTAssertNoThrow(try CuaDriverProcessRuntime
            .validatePermissionSource(validSource))
        for source in [
            ["attribution": "caller", "embedded": true,
             "host_bundle_id": "com.leehow.pipiui"] as [String: Any],
            ["attribution": "host", "embedded": false,
             "host_bundle_id": "com.leehow.pipiui"],
            ["attribution": "host", "embedded": true,
             "host_bundle_id": "com.example.Other"],
        ] {
            XCTAssertThrowsError(try CuaDriverProcessRuntime
                .validatePermissionSource(["source": source]))
        }
    }

    func testRuntimeEmergencyCancellationDoesNotWaitForMCPTimeout() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let blockedMarker = directory.appendingPathComponent("blocked")
        let trace = directory.appendingPathComponent("trace")
        let source = """
        #!/usr/bin/python3
        import json, os, signal, socket, sys, time
        sys.stderr = open("\(trace.path)", "a")
        mode = sys.argv[1]
        socket_path = sys.argv[sys.argv.index("--socket") + 1]
        with open("\(trace.path)", "a") as log:
            log.write(mode + "\\n")
        if mode == "serve":
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(socket_path)
            os.chmod(socket_path, 0o600)
            server.listen(1)
            while os.read(0, 1):
                pass
        if mode == "mcp":
            # Deliberately never answer initialize. This puts the transport
            # queue inside the same bounded poll/read used by every tool call.
            open("\(blockedMarker.path)", "w").close()
            while True:
                time.sleep(1)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 2,
            responseTimeout: 5
        )
        let call = Task {
            try await runtime.call(
                tool: "block_forever",
                arguments: [:]
            )
        }
        for _ in 0..<200 where
            !FileManager.default.fileExists(atPath: blockedMarker.path) {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: blockedMarker.path),
            (try? String(contentsOf: trace)) ?? "no fake MCP trace"
        )
        let started = Date()
        runtime.cancelAndStop()
        XCTAssertLessThan(
            Date().timeIntervalSince(started),
            0.2,
            "Emergency stop must never queue.sync behind the MCP timeout"
        )
        do {
            _ = try await call.value
            XCTFail("blocked MCP call unexpectedly succeeded")
        } catch {
            XCTAssertTrue(
                error is CuaDriverError,
                "unexpected cancellation error: \(error)"
            )
        }
    }

    func testRuntimeShutdownWaitsUntilSIGTERMIgnoringChildrenAreReaped() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let trace = directory.appendingPathComponent("pids.jsonl")
        let source = """
        #!/usr/bin/python3
        import json, os, signal, socket, sys, time
        mode = sys.argv[1]
        socket_path = sys.argv[sys.argv.index("--socket") + 1]
        with open("\(trace.path)", "a") as output:
            output.write(json.dumps({"mode": mode, "pid": os.getpid()}) + "\\n")
            output.flush()
        signal.signal(signal.SIGTERM, lambda signum, frame: None)
        if mode == "serve":
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(socket_path)
            os.chmod(socket_path, 0o600)
            server.listen(1)
            while True:
                time.sleep(1)
        if mode == "mcp":
            for line in sys.stdin:
                message = json.loads(line)
                if "id" not in message:
                    continue
                if message["method"] == "initialize":
                    result = {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "fake", "version": "1"},
                    }
                else:
                    name = message["params"]["name"]
                    structured = {"ok": True}
                    if name == "check_permissions":
                        structured = {"source": {
                            "attribution": "host",
                            "embedded": True,
                            "host_bundle_id": "com.leehow.pipiui",
                        }}
                    result = {
                        "content": [],
                        "structuredContent": structured,
                        "isError": False,
                    }
                print(json.dumps({
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "result": result,
                }), flush=True)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 2,
            responseTimeout: 2
        )
        _ = try await runtime.call(tool: "ping", arguments: [:])
        let records = try String(contentsOf: trace, encoding: .utf8)
            .split(separator: "\n")
            .compactMap { line -> [String: Any]? in
                try? JSONSerialization.jsonObject(
                    with: Data(line.utf8)
                ) as? [String: Any]
            }
        XCTAssertEqual(records.count, 2)

        runtime.shutdownAndWait()

        for record in records {
            guard let pid = (record["pid"] as? NSNumber)?.int32Value else {
                return XCTFail("missing child pid: \(record)")
            }
            XCTAssertEqual(Darwin.kill(pid, 0), -1, "pid \(pid) survived shutdown")
            XCTAssertEqual(errno, ESRCH)
        }

        do {
            _ = try await runtime.call(tool: "must_not_restart", arguments: [:])
            XCTFail("a final App shutdown must fence future driver generations")
        } catch {
            XCTAssertEqual(error as? CuaDriverError, .cancelled)
        }
        let recordsAfterRejectedCall = try String(
            contentsOf: trace,
            encoding: .utf8
        ).split(separator: "\n")
        XCTAssertEqual(recordsAfterRejectedCall.count, 2)
    }

    func testRuntimeShutdownInterruptsBlockedRequestBeforeProtocolTimeout() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let blockedMarker = directory.appendingPathComponent("blocked")
        let trace = directory.appendingPathComponent("pids.jsonl")
        let source = """
        #!/usr/bin/python3
        import json, os, signal, socket, sys, time
        mode = sys.argv[1]
        socket_path = sys.argv[sys.argv.index("--socket") + 1]
        with open("\(trace.path)", "a") as output:
            output.write(json.dumps({"mode": mode, "pid": os.getpid()}) + "\\n")
            output.flush()
        signal.signal(signal.SIGTERM, lambda signum, frame: None)
        if mode == "serve":
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(socket_path)
            os.chmod(socket_path, 0o600)
            server.listen(1)
            while True:
                time.sleep(1)
        if mode == "mcp":
            open("\(blockedMarker.path)", "w").close()
            while True:
                time.sleep(1)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 2,
            responseTimeout: 5
        )
        let call = Task {
            try await runtime.call(tool: "block_forever", arguments: [:])
        }
        for _ in 0..<200 where
            !FileManager.default.fileExists(atPath: blockedMarker.path) {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: blockedMarker.path),
            "fake MCP process never entered its blocked request"
        )

        let started = Date()
        runtime.shutdownAndWait()
        XCTAssertLessThan(
            Date().timeIntervalSince(started),
            1.5,
            "App shutdown must reap a blocked generation before its protocol timeout"
        )
        do {
            _ = try await call.value
            XCTFail("blocked MCP call unexpectedly succeeded")
        } catch {
            XCTAssertTrue(error is CuaDriverError, "unexpected error: \(error)")
        }

        let records = try String(contentsOf: trace, encoding: .utf8)
            .split(separator: "\n")
            .compactMap { line -> [String: Any]? in
                try? JSONSerialization.jsonObject(
                    with: Data(line.utf8)
                ) as? [String: Any]
            }
        XCTAssertEqual(records.count, 2)
        for record in records {
            guard let pid = (record["pid"] as? NSNumber)?.int32Value else {
                return XCTFail("missing child pid: \(record)")
            }
            XCTAssertEqual(Darwin.kill(pid, 0), -1, "pid \(pid) survived shutdown")
            XCTAssertEqual(errno, ESRCH)
        }
    }

    func testRuntimeShutdownReapsChildThatLosesRegistrationRace() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let spawnedMarker = directory.appendingPathComponent("spawned")
        let releaseMarker = directory.appendingPathComponent("release")
        let trace = directory.appendingPathComponent("pid")
        let source = """
        #!/usr/bin/python3
        import os, signal, sys, time
        with open("\(trace.path)", "w") as output:
            output.write(str(os.getpid()))
            output.flush()
        signal.signal(signal.SIGTERM, lambda signum, frame: None)
        open("\(spawnedMarker.path)", "w").close()
        while not os.path.exists("\(releaseMarker.path)"):
            time.sleep(0.01)
        while True:
            time.sleep(1)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 2,
            responseTimeout: 2
        )
        let call = Task {
            try await runtime.call(tool: "race", arguments: [:])
        }
        for _ in 0..<200 where
            !FileManager.default.fileExists(atPath: spawnedMarker.path) {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: spawnedMarker.path))

        let shutdown = Task.detached { runtime.shutdownAndWait() }
        try await Task.sleep(nanoseconds: 50_000_000)
        try Data().write(to: releaseMarker, options: .atomic)
        _ = await shutdown.value
        do {
            _ = try await call.value
            XCTFail("startup unexpectedly survived final shutdown")
        } catch {
            XCTAssertEqual(error as? CuaDriverError, .cancelled)
        }

        let pid = Int32(try String(contentsOf: trace, encoding: .utf8))!
        XCTAssertEqual(Darwin.kill(pid, 0), -1, "race-losing child survived")
        XCTAssertEqual(errno, ESRCH)
    }

    func testRuntimeFatalTimeoutReapsGenerationAndRestartsCleanly() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let trace = directory.appendingPathComponent("trace.jsonl")
        let generationFile = directory.appendingPathComponent("generation")
        let source = """
        #!/usr/bin/python3
        import json, os, socket, sys, time
        mode = sys.argv[1]
        socket_path = sys.argv[sys.argv.index("--socket") + 1]
        def trace(value):
            with open("\(trace.path)", "a") as output:
                output.write(json.dumps(value) + "\\n")
                output.flush()
        if mode == "serve":
            trace({"mode": mode, "pid": os.getpid(), "socket": socket_path, "args": sys.argv[2:]})
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(socket_path)
            os.chmod(socket_path, 0o600)
            server.listen(1)
            while os.read(0, 1):
                pass
            sys.exit(0)
        if mode == "mcp":
            try:
                generation = int(open("\(generationFile.path)").read()) + 1
            except Exception:
                generation = 1
            with open("\(generationFile.path)", "w") as output:
                output.write(str(generation))
            trace({"mode": mode, "pid": os.getpid(), "socket": socket_path, "args": sys.argv[2:], "generation": generation})
            for line in sys.stdin:
                message = json.loads(line)
                if "id" not in message:
                    continue
                request_id = message["id"]
                if message["method"] == "initialize":
                    result = {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "cua-driver", "version": "0.12.5"},
                    }
                else:
                    name = message["params"]["name"]
                    if name == "check_permissions":
                        structured = {"source": {
                            "attribution": "host",
                            "embedded": True,
                            "host_bundle_id": "com.leehow.pipiui",
                        }}
                    elif name == "timeout_once" and generation == 1:
                        time.sleep(10)
                        continue
                    else:
                        structured = {"generation": generation}
                    result = {
                        "content": [],
                        "structuredContent": structured,
                        "isError": False,
                    }
                print(json.dumps({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result,
                }), flush=True)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 2,
            responseTimeout: 0.2
        )
        do {
            _ = try await runtime.call(tool: "timeout_once", arguments: [:])
            XCTFail("first generation unexpectedly returned")
        } catch let error as CuaDriverError {
            guard case .protocolFailure(let message) = error else {
                return XCTFail("unexpected failure: \(error)")
            }
            XCTAssertTrue(message.contains("timed out"))
        }

        let restarted = try await runtime.call(tool: "ping", arguments: [:])
        XCTAssertEqual(
            restarted.structuredContent["generation"] as? Int,
            2
        )
        runtime.cancelAndStop()

        var records: [[String: Any]] = []
        for _ in 0..<200 {
            if let data = try? Data(contentsOf: trace) {
                records = String(decoding: data, as: UTF8.self)
                    .split(separator: "\n")
                    .compactMap {
                        (try? JSONSerialization.jsonObject(
                            with: Data($0.utf8)
                        )) as? [String: Any]
                    }
            }
            let socketsGone = records.allSatisfy {
                guard let path = $0["socket"] as? String else { return true }
                return !FileManager.default.fileExists(atPath: path)
            }
            let childrenGone = records.allSatisfy {
                guard let pid = ($0["pid"] as? NSNumber)?.int32Value else {
                    return true
                }
                return Darwin.kill(pid, 0) == -1 && errno == ESRCH
            }
            if records.count >= 4, socketsGone, childrenGone { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(
            records.filter { $0["mode"] as? String == "serve" }.count,
            2
        )
        XCTAssertEqual(
            records.filter { $0["mode"] as? String == "mcp" }.count,
            2
        )
        for record in records {
            let args = record["args"] as? [String] ?? []
            XCTAssertTrue(args.contains("--host-bundle-id"))
            if record["mode"] as? String == "serve" {
                XCTAssertTrue(args.contains("--parent-liveness-stdio"))
                XCTAssertTrue(args.contains("--no-permissions-gate"))
                XCTAssertTrue(args.contains("--dangerously-bypass-approvals"))
            }
            if let socket = record["socket"] as? String {
                XCTAssertFalse(
                    FileManager.default.fileExists(atPath: socket),
                    "socket must be removed after generation teardown"
                )
            }
            if let pid = (record["pid"] as? NSNumber)?.int32Value {
                XCTAssertEqual(Darwin.kill(pid, 0), -1)
                XCTAssertEqual(errno, ESRCH)
            }
        }
    }

    func testStderrSanitizerRedactsLongTokensTruncatesLinesAndTotal() {
        // Long base64/hex token runs are replaced with a placeholder.
        let secret = String(repeating: "B", count: 80)
        let redacted = StderrSanitizer.sanitize("token=\(secret) done")
        XCTAssertTrue(redacted.contains(StderrSanitizer.placeholder), redacted)
        XCTAssertFalse(redacted.contains(secret), redacted)

        // Short readable markers survive unchanged.
        XCTAssertEqual(
            StderrSanitizer.sanitize("panic: widget not found"),
            "panic: widget not found"
        )

        // An overlong line (no long token run inside) is truncated per line.
        let longLine = String(repeating: "word ", count: 250)
        let capped = StderrSanitizer.sanitize(longLine)
        XCTAssertTrue(capped.contains("<line truncated>"), capped)
        XCTAssertLessThan(capped.count, longLine.count)

        // Total length is bounded.
        let huge = (0..<1_000).map { "line \($0)" }.joined(separator: "\n")
        let bounded = StderrSanitizer.sanitize(huge)
        XCTAssertLessThanOrEqual(
            bounded.count,
            StderrSanitizer.maxTotalCharacters + 64,
            "sanitizer must bound total output length"
        )
    }

    func testBoundedPipeTailKeepsNewestBytesOnly() {
        let tail = BoundedPipeTail(capacity: 16)
        tail.append(Data("HEAD".utf8))
        tail.append(Data((0..<2_000).map { _ in UInt8(ascii: "X") }))
        tail.append(Data("TAIL".utf8))
        let snapshot = tail.sanitizedTail()
        XCTAssertTrue(snapshot.contains("TAIL"), snapshot)
        XCTAssertFalse(snapshot.contains("HEAD"), snapshot)
    }

    func testRuntimeExposesNonZeroExitCodeAndSanitizedStderrMarker() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let secret = String(repeating: "A", count: 64)
        let source = """
        #!/usr/bin/python3
        import sys
        mode = sys.argv[1]
        if mode == "serve":
            sys.stderr.write("BOOT_FAILURE reason=demo secret=\(secret)\\n")
            sys.stderr.flush()
            sys.exit(7)
        sys.exit(1)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let runtime = CuaDriverProcessRuntime(
            driverPathOverride: helper.path,
            startupTimeout: 3,
            responseTimeout: 3
        )
        do {
            _ = try await runtime.call(tool: "ping", arguments: [:])
            XCTFail("serve unexpectedly came up")
        } catch let error as CuaDriverError {
            guard case .processExited(let role) = error else {
                return XCTFail("expected processExited, got \(error)")
            }
            XCTAssertTrue(role.contains("status=7"), role)
            XCTAssertTrue(role.contains("reason="), role)
            XCTAssertTrue(role.contains("BOOT_FAILURE"), role)
            XCTAssertFalse(
                role.contains(String(repeating: "A", count: 40)),
                "long secret token must be redacted: \(role)"
            )
            XCTAssertTrue(role.contains("<redacted>"), role)
        }
        runtime.cancelAndStop()
    }

    func testBoundedPipeTailWaitForEOFBlocksUntilMarked() {
        let tail = BoundedPipeTail(capacity: 64)
        tail.append(Data("buffered-bytes".utf8))
        // Without EOF, a bounded wait times out and reports false.
        XCTAssertFalse(tail.waitForEOF(timeout: 0.05))
        // Once EOF is marked, the wait returns immediately and true, and the
        // buffered content survives.
        tail.markEOF()
        XCTAssertTrue(tail.waitForEOF(timeout: 1.0))
        XCTAssertTrue(tail.sanitizedTail().contains("buffered-bytes"))
    }

    func testRuntimeFastExitStderrCapturedDeterministicallyAcrossRuns() async throws {
        // Regression guard for the fast-exit drain race: a helper that writes
        // a marker + long secret to stderr and exits non-zero must surface that
        // marker (secret redacted) every single time, not just usually.
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = directory.appendingPathComponent("fake-cua-driver")
        let marker = "BOOT_FAILURE reason=fastexit"
        let secret = String(repeating: "Z", count: 64)
        let source = """
        #!/usr/bin/python3
        import sys
        mode = sys.argv[1]
        if mode == "serve":
            sys.stderr.write("\(marker) secret=\(secret)\\n")
            sys.stderr.flush()
            sys.exit(9)
        sys.exit(1)
        """
        try Data(source.utf8).write(to: helper, options: .atomic)
        XCTAssertEqual(chmod(helper.path, 0o755), 0)

        let iterations = 12
        for index in 0..<iterations {
            let runtime = CuaDriverProcessRuntime(
                driverPathOverride: helper.path,
                startupTimeout: 3,
                responseTimeout: 3
            )
            do {
                _ = try await runtime.call(tool: "ping", arguments: [:])
                XCTFail("iteration \(index): serve unexpectedly came up")
            } catch let error as CuaDriverError {
                guard case .processExited(let role) = error else {
                    return XCTFail(
                        "iteration \(index): expected processExited, got \(error)"
                    )
                }
                XCTAssertTrue(
                    role.contains("status=9"),
                    "iteration \(index): \(role)"
                )
                XCTAssertTrue(
                    role.contains(marker),
                    "iteration \(index): stderr marker lost: \(role)"
                )
                XCTAssertTrue(role.contains("<redacted>"), "iteration \(index): \(role)")
                XCTAssertFalse(
                    role.contains(String(repeating: "Z", count: 40)),
                    "iteration \(index): secret not redacted: \(role)"
                )
            }
            runtime.cancelAndStop()
        }
    }

    private func chromeLikeWindows(
        processID: Int32
    ) -> [[String: Any]] {
        func window(
            id: UInt32,
            title: String,
            width: Int,
            height: Int,
            zIndex: Int,
            isOnScreen: Bool,
            onCurrentSpace: Bool
        ) -> [String: Any] {
            [
                "window_id": id,
                "pid": processID,
                "app_name": "Google Chrome",
                "title": title,
                "bounds": [
                    "x": 0,
                    "y": 0,
                    "width": width,
                    "height": height,
                ],
                "z_index": zIndex,
                "is_on_screen": isOnScreen,
                "on_current_space": onCurrentSpace,
            ]
        }
        return [
            window(
                id: 314_877,
                title: "Window",
                width: 66,
                height: 20,
                zIndex: 387,
                isOnScreen: true,
                onCurrentSpace: true
            ),
            window(
                id: 308_217,
                title: "",
                width: 1_062,
                height: 218,
                zIndex: 386,
                isOnScreen: false,
                onCurrentSpace: false
            ),
            window(
                id: 308_216,
                title: "",
                width: 1_062,
                height: 112,
                zIndex: 385,
                isOnScreen: false,
                onCurrentSpace: false
            ),
            window(
                id: 308_219,
                title: "",
                width: 1,
                height: 1,
                zIndex: 384,
                isOnScreen: false,
                onCurrentSpace: false
            ),
            window(
                id: 308_215,
                title: "Example Domain",
                width: 1_512,
                height: 903,
                zIndex: 383,
                isOnScreen: true,
                onCurrentSpace: true
            ),
        ]
    }

    private func makeCoordinator(
        _ driver: FakeDriver,
        frontmostApplicationProvider:
            @escaping @Sendable () -> ComputerApplicationIdentity? = {
                ComputerApplicationIdentity(
                    bundleID: "com.unrelated.Frontmost",
                    name: "Unrelated",
                    processID: 999,
                    windowTitle: nil
                )
            },
        applicationResolver:
            @escaping @Sendable (String) throws
                -> ComputerResolvedApplication = {
                    try ComputerApplicationResolver.resolve(
                        bundleIdentifier: $0
                    )
                }
    ) -> ComputerCoordinator {
        ComputerCoordinator(
            supportsInputMonitoring: false,
            frontmostApplicationProvider: frontmostApplicationProvider,
            applicationResolver: applicationResolver,
            openApplicationPermissionProvider: {
                ComputerPermissionSnapshot(
                    screenRecording: true,
                    accessibility: true
                )
            },
            openApplicationDescriptorProvider: { self.descriptor },
            computerUseEnabledProvider: { true },
            cuaDriver: driver,
            cuaTargetValidator: { _ in true }
        )
    }

    private func open(
        _ coordinator: ComputerCoordinator,
        session: String,
        bundleID: String? = nil,
        applicationName: String? = nil
    ) async -> [String: Any] {
        var object: [String: Any] = [
            "requestID": UUID().uuidString,
            "displayID": Int(descriptor.displayID),
            "displayWidth": descriptor.outputSize.width,
            "displayHeight": descriptor.outputSize.height,
        ]
        object["bundle_identifier"] = bundleID
        object["application_name"] = applicationName
        return await withCheckedContinuation { continuation in
            coordinator.handleOpenApplication(
                request: J(object),
                sessionKey: session
            ) { continuation.resume(returning: $0) }
        }
    }

    private func batch(
        _ coordinator: ComputerCoordinator,
        session: String,
        requestID: String = UUID().uuidString,
        actions: [[String: Any]]
    ) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            coordinator.handle(
                request: J([
                    "requestID": requestID,
                    "displayID": Int(descriptor.displayID),
                    "displayWidth": descriptor.outputSize.width,
                    "displayHeight": descriptor.outputSize.height,
                    "actions": actions,
                ]),
                sessionKey: session
            ) { continuation.resume(returning: $0) }
        }
    }

    private func target(_ response: [String: Any]) -> [String: Any] {
        response["target"] as? [String: Any] ?? [:]
    }

    private func png() throws -> String {
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: 2,
            pixelsHigh: 1,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ), let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CuaIntegrationError.invalidScreenshotData
        }
        return data.base64EncodedString()
    }
}

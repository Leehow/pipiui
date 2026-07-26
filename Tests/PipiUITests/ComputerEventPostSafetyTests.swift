import CoreGraphics
import XCTest
@testable import PipiUI

final class ComputerEventPostSafetyTests: XCTestCase {
    private let target = ComputerApplicationIdentity(
        bundleID: "com.example.editor",
        name: "Editor",
        processID: 42,
        windowTitle: nil
    )
    private let replacement = ComputerApplicationIdentity(
        bundleID: "com.example.other",
        name: "Other",
        processID: 99,
        windowTitle: nil
    )

    func testUnicodeFocusChangeStopsLaterTextAndEmitsTextFreeCleanupUp() {
        let frontmost = EventFrontmostBox(target)
        let replacement = replacement
        let log = EventPostLog { kind in
            if case .unicodeDown = kind {
                frontmost.set(replacement)
            }
        }
        let synth = makeSynth(log)
        let gate = ComputerExecutionGate()
        let postGate = makePostGate(
            executionGate: gate,
            frontmost: frontmost
        )

        XCTAssertThrowsError(try synth.execute(
            action(.type, text: String(repeating: "a", count: 41)),
            imageSize: .init(width: 100, height: 100),
            displayBounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            postGate: postGate
        ))

        let records = log.snapshot()
        XCTAssertEqual(
            records.filter {
                if case .unicodeDown = $0.kind { return true }
                return false
            }.count,
            1
        )
        XCTAssertFalse(records.contains { $0.kind == .unicodeUp })
        XCTAssertEqual(
            records.filter { $0.kind == .cleanupUnicodeUp },
            [.init(
                channel: .targetPID,
                pid: target.processID,
                kind: .cleanupUnicodeUp
            )]
        )
        XCTAssertTrue(records.allSatisfy { $0.channel == .targetPID })
        XCTAssertFalse(records.contains { $0.pid == replacement.processID })
        XCTAssertNil(synth.heldUnicodeTargetPID)
    }

    func testCancellationWinningAtPostBoundaryPreventsThePost() {
        let frontmost = EventFrontmostBox(target)
        let log = EventPostLog()
        let synth = makeSynth(log)
        let gate = ComputerExecutionGate()
        let postGate = makePostGate(
            executionGate: gate,
            frontmost: frontmost,
            beforePostAttempt: { gate.cancel() }
        )

        XCTAssertThrowsError(try synth.execute(
            action(.key, keys: ["A"]),
            imageSize: .init(width: 100, height: 100),
            displayBounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            postGate: postGate
        ))
        XCTAssertTrue(log.snapshot().isEmpty)
        XCTAssertTrue(synth.heldKeys.isEmpty)
    }

    func testSupersededExecutionCannotPostEvenWithMatchingFrontmostPID() {
        let frontmost = EventFrontmostBox(target)
        let log = EventPostLog()
        let synth = makeSynth(log)
        let postGate = ComputerLivePostGate(
            executionGate: ComputerExecutionGate(),
            targetApplication: target,
            frontmostApplicationProvider: { frontmost.current() },
            isExecutionCurrent: { false }
        )

        XCTAssertThrowsError(try synth.execute(
            action(.key, keys: ["A"]),
            imageSize: .init(width: 100, height: 100),
            displayBounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            postGate: postGate
        ))
        XCTAssertTrue(log.snapshot().isEmpty)
    }

    func testHeldKeyFocusChangeCleansUpOnlyOriginalTargetPID() {
        let frontmost = EventFrontmostBox(target)
        let replacement = replacement
        let log = EventPostLog { kind in
            if case .keyDown = kind {
                frontmost.set(replacement)
            }
        }
        let synth = makeSynth(log)
        let gate = ComputerExecutionGate()
        let postGate = makePostGate(
            executionGate: gate,
            frontmost: frontmost
        )

        XCTAssertThrowsError(try synth.execute(
            action(.holdKey, keys: ["SHIFT"], duration: 0.2),
            imageSize: .init(width: 100, height: 100),
            displayBounds: CGRect(x: 0, y: 0, width: 100, height: 100),
            postGate: postGate
        ))

        let records = log.snapshot()
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(records[0].pid, target.processID)
        XCTAssertEqual(records[0].channel, .targetPID)
        if case .keyDown = records[0].kind {
            // Expected.
        } else {
            XCTFail("first post must be the held key down")
        }
        XCTAssertEqual(
            records[1],
            .init(
                channel: .targetPID,
                pid: target.processID,
                kind: .cleanupKeyUp(records[0].keyCode ?? 0)
            )
        )
        XCTAssertFalse(records.contains { $0.pid == replacement.processID })
        XCTAssertTrue(synth.heldKeys.isEmpty)
    }

    private func makeSynth(_ log: EventPostLog) -> ComputerInputSynth {
        ComputerInputSynth(
            eventSink: .init(
                postGlobal: { _, pid, kind in
                    log.append(channel: .global, pid: pid, kind: kind)
                },
                postToPID: { _, pid, kind in
                    log.append(channel: .targetPID, pid: pid, kind: kind)
                }
            ),
            accessibilityTrusted: { true }
        )
    }

    private func makePostGate(
        executionGate: ComputerExecutionGate,
        frontmost: EventFrontmostBox,
        beforePostAttempt: @escaping @Sendable () -> Void = {}
    ) -> ComputerLivePostGate {
        ComputerLivePostGate(
            executionGate: executionGate,
            targetApplication: target,
            frontmostApplicationProvider: { frontmost.current() },
            beforePostAttempt: beforePostAttempt
        )
    }

    private func action(
        _ kind: ComputerActionKind,
        text: String? = nil,
        keys: [String] = [],
        duration: TimeInterval? = nil
    ) -> ComputerAction {
        ComputerAction(
            kind: kind,
            coordinate: nil,
            startCoordinate: nil,
            text: text,
            keys: keys,
            scrollDirection: nil,
            scrollAmount: nil,
            duration: duration
        )
    }
}

private struct EventPostRecord: Equatable {
    let channel: EventPostChannel
    let pid: Int32
    let kind: ComputerEventPostKind

    var keyCode: CGKeyCode? {
        switch kind {
        case .keyDown(let keyCode), .keyUp(let keyCode),
             .cleanupKeyUp(let keyCode):
            return keyCode
        default:
            return nil
        }
    }
}

private enum EventPostChannel: Equatable {
    case global
    case targetPID
}

private final class EventPostLog: @unchecked Sendable {
    private let lock = NSLock()
    private var records: [EventPostRecord] = []
    private let onPost: @Sendable (ComputerEventPostKind) -> Void

    init(
        onPost: @escaping @Sendable (ComputerEventPostKind) -> Void = { _ in }
    ) {
        self.onPost = onPost
    }

    func append(
        channel: EventPostChannel,
        pid: Int32,
        kind: ComputerEventPostKind
    ) {
        lock.withLock {
            records.append(.init(channel: channel, pid: pid, kind: kind))
        }
        onPost(kind)
    }

    func snapshot() -> [EventPostRecord] {
        lock.withLock { records }
    }
}

private final class EventFrontmostBox: @unchecked Sendable {
    private let lock = NSLock()
    private var application: ComputerApplicationIdentity?

    init(_ application: ComputerApplicationIdentity?) {
        self.application = application
    }

    func current() -> ComputerApplicationIdentity? {
        lock.withLock { application }
    }

    func set(_ application: ComputerApplicationIdentity?) {
        lock.withLock { self.application = application }
    }
}

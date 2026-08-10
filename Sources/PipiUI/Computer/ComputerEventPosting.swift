import CoreGraphics
import Foundation

enum ComputerEventPostKind: Equatable, Sendable {
    case pointer
    case scroll
    case unicodeDown(utf16Count: Int)
    case unicodeUp
    case keyDown(CGKeyCode)
    case keyUp(CGKeyCode)
    case cleanupMouseUp
    case cleanupUnicodeUp
    case cleanupKeyUp(CGKeyCode)
}

struct ComputerEventSink: @unchecked Sendable {
    let postGlobal:
        @Sendable (CGEvent, Int32, ComputerEventPostKind) throws -> Void
    let postToPID:
        @Sendable (CGEvent, Int32, ComputerEventPostKind) throws -> Void

    static let live = ComputerEventSink(
        postGlobal: { event, _, _ in
            event.post(tap: .cghidEventTap)
        },
        postToPID: { event, targetPID, _ in
            event.postToPid(targetPID)
        }
    )
}

/// The one path for every non-cleanup input event. The execution gate keeps
/// cancellation and the final target verification + post in a single critical
/// section. Keyboard delivery is also process-targeted by the event sink.
final class ComputerLivePostGate: @unchecked Sendable {
    let targetApplication: ComputerApplicationIdentity
    private let executionGate: ComputerExecutionGate
    private let frontmostApplicationProvider:
        @Sendable () -> ComputerApplicationIdentity?
    private let authorizePointer: @Sendable (CGPoint) throws -> Void
    private let beforePostAttempt: @Sendable () -> Void
    private let isExecutionCurrent: @Sendable () -> Bool
    private let authorizeHost: @Sendable (
        ComputerApplicationIdentity,
        ComputerApplicationIdentity
    ) throws -> Void

    init(
        executionGate: ComputerExecutionGate,
        targetApplication: ComputerApplicationIdentity,
        frontmostApplicationProvider:
            @escaping @Sendable () -> ComputerApplicationIdentity?,
        authorizePointer:
            @escaping @Sendable (CGPoint) throws -> Void = { _ in },
        isExecutionCurrent: @escaping @Sendable () -> Bool = { true },
        beforePostAttempt: @escaping @Sendable () -> Void = {},
        authorizeHost: @escaping @Sendable (
            ComputerApplicationIdentity,
            ComputerApplicationIdentity
        ) throws -> Void = { _, _ in }
    ) {
        self.executionGate = executionGate
        self.targetApplication = targetApplication
        self.frontmostApplicationProvider = frontmostApplicationProvider
        self.authorizePointer = authorizePointer
        self.isExecutionCurrent = isExecutionCurrent
        self.beforePostAttempt = beforePostAttempt
        self.authorizeHost = authorizeHost
    }

    var targetPID: Int32 {
        targetApplication.processID
    }

    func poll() throws {
        try executionGate.withActivePost {
            try verifyExactFrontmostTarget()
        }
    }

    func post<T>(
        pointerAt point: CGPoint? = nil,
        _ body: () throws -> T
    ) throws -> T {
        // This seam permits a deterministic cancellation-at-the-boundary test.
        // Production uses the no-op default.
        beforePostAttempt()
        return try executionGate.withActivePost {
            try verifyExactFrontmostTarget()
            if let point {
                try authorizePointer(point)
            }
            return try body()
        }
    }

    private func verifyExactFrontmostTarget() throws {
        guard isExecutionCurrent() else {
            throw ComputerInputError.executionStopped
        }
        guard let current = frontmostApplicationProvider() else {
            throw ComputerInputError.targetProcessChanged
        }
        try authorizeHost(targetApplication, current)
        guard current.processID == targetApplication.processID,
              current.normalizedBundleID
                == targetApplication.normalizedBundleID else {
            throw ComputerInputError.targetProcessChanged
        }
    }
}

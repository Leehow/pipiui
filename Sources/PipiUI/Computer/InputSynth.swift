import Foundation
import ApplicationServices
import CoreGraphics

enum ComputerInputError: LocalizedError {
    case accessibilityPermissionMissing
    case missingCoordinate(ComputerActionKind)
    case missingText
    case invalidScroll
    case durationOutOfRange
    case unsupportedAppSwitchShortcut
    case sensitiveShortcutBlocked
    case sensitiveTextBlocked
    case eventCreationFailed
    case executionStopped
    case targetProcessChanged

    var errorDescription: String? {
        switch self {
        case .accessibilityPermissionMissing:
            return "Accessibility permission is required"
        case .missingCoordinate(let kind):
            return "\(kind.rawValue) requires a coordinate"
        case .missingText:
            return "type requires non-empty text"
        case .invalidScroll:
            return "scroll requires direction up/down/left/right and a positive amount"
        case .durationOutOfRange:
            return "wait/hold duration must be between 0 and "
                + "\(Int(ComputerRuntimeBudget.maximumPauseSeconds)) seconds"
        case .unsupportedAppSwitchShortcut:
            return "application-switching shortcuts are blocked; select and authorize the target app first"
        case .sensitiveShortcutBlocked:
            return "a destructive or system-level shortcut is blocked by Computer Use"
        case .sensitiveTextBlocked:
            return "text resembling a password, token, or private key is blocked by Computer Use"
        case .eventCreationFailed:
            return "macOS refused to create an input event"
        case .executionStopped:
            return "computer execution stopped"
        case .targetProcessChanged:
            return "frontmost application no longer matches the authorized target process"
        }
    }
}

struct ComputerHeldMouseState {
    let targetPID: Int32
    let point: CGPoint
}

struct ComputerHeldKeyState {
    let targetPID: Int32
    let modifiers: CGEventFlags
}

final class ComputerInputSynth: @unchecked Sendable {
    static let shared = ComputerInputSynth()
    static let syntheticEventTag: Int64 = 0x5049_5049_4355

    let lock = NSLock()
    var heldMouseButtons: Set<CGMouseButton> = []
    var heldKeys: Set<CGKeyCode> = []
    var heldMouseStates: [CGMouseButton: ComputerHeldMouseState] = [:]
    var heldKeyStates: [CGKeyCode: ComputerHeldKeyState] = [:]
    var heldUnicodeTargetPID: Int32?
    let source = CGEventSource(stateID: .privateState)
    let eventSink: ComputerEventSink
    let accessibilityTrusted: @Sendable () -> Bool

    init(
        eventSink: ComputerEventSink = .live,
        accessibilityTrusted: @escaping @Sendable () -> Bool = {
            AXIsProcessTrusted()
        }
    ) {
        self.eventSink = eventSink
        self.accessibilityTrusted = accessibilityTrusted
        source?.localEventsSuppressionInterval = 0
    }

    func validate(
        actions: [ComputerAction],
        imageSize: ComputerImageSize,
        displayBounds: CGRect
    ) throws {
        for action in actions {
            for point in [action.coordinate, action.startCoordinate].compactMap({ $0 }) {
                _ = try ComputerCoordinateMap.globalPoint(
                    imagePoint: point,
                    imageSize: imageSize,
                    displayBounds: displayBounds
                )
            }
            switch action.kind {
            case .mouseMove, .leftClick, .rightClick, .middleClick,
                 .doubleClick, .tripleClick:
                guard action.coordinate != nil else {
                    throw ComputerInputError.missingCoordinate(action.kind)
                }
            case .drag:
                guard action.coordinate != nil else {
                    throw ComputerInputError.missingCoordinate(action.kind)
                }
            case .type:
                guard let text = action.text, !text.isEmpty else {
                    throw ComputerInputError.missingText
                }
                guard text.utf16.count <= ComputerRuntimeBudget.maximumTypedUTF16Units else {
                    throw ComputerRequestError.invalidAction(
                        "typed text exceeds \(ComputerRuntimeBudget.maximumTypedUTF16Units) "
                            + "UTF-16 units"
                    )
                }
                _ = try ComputerUnicodeChunker.chunks(text)
            case .key, .holdKey:
                _ = try ComputerKeyChord.parse(
                    keys: action.keys,
                    fallbackText: action.text
                )
                if action.kind == .holdKey {
                    let duration = action.duration ?? 1
                    guard duration >= 0,
                          duration <= ComputerRuntimeBudget.maximumPauseSeconds else {
                        throw ComputerInputError.durationOutOfRange
                    }
                }
            case .scroll:
                guard let direction = action.scrollDirection?.lowercased(),
                      ["up", "down", "left", "right"].contains(direction),
                      (action.scrollAmount ?? 0) > 0 else {
                    throw ComputerInputError.invalidScroll
                }
            case .wait:
                let duration = action.duration ?? 1
                guard duration >= 0,
                      duration <= ComputerRuntimeBudget.maximumPauseSeconds else {
                    throw ComputerInputError.durationOutOfRange
                }
            case .leftMouseDown, .leftMouseUp, .screenshot:
                break
            }
        }
    }

    func execute(
        _ action: ComputerAction,
        imageSize: ComputerImageSize,
        displayBounds: CGRect,
        shouldStop: @escaping @Sendable () -> Bool = { false },
        postGate: ComputerLivePostGate
    ) throws {
        guard accessibilityTrusted() || !action.emitsInput else {
            throw ComputerInputError.accessibilityPermissionMissing
        }
        try ensureRunning(shouldStop)
        switch action.kind {
        case .screenshot:
            return
        case .wait:
            try cancellablePause(
                action.duration ?? 1,
                shouldStop: shouldStop,
                poll: { try postGate.poll() }
            )
        case .mouseMove:
            try postMouse(
                .mouseMoved,
                at: try point(action, imageSize, displayBounds),
                postGate: postGate
            )
        case .leftClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .rightClick:
            try click(
                .right,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .middleClick:
            try click(
                .center,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .doubleClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 2,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .tripleClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 3,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .leftMouseDown:
            let location = try optionalPoint(action, imageSize, displayBounds)
                ?? CGEvent(source: nil)?.location ?? .zero
            try mouseDown(
                .left,
                at: location,
                postGate: postGate
            )
        case .leftMouseUp:
            let location = try optionalPoint(action, imageSize, displayBounds)
                ?? CGEvent(source: nil)?.location ?? .zero
            try mouseUp(.left, at: location, postGate: postGate)
        case .drag:
            try drag(
                action,
                imageSize: imageSize,
                displayBounds: displayBounds,
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .type:
            try typeUnicode(
                action.text ?? "",
                shouldStop: shouldStop,
                postGate: postGate
            )
        case .key:
            let chord = try ComputerKeyChord.parse(keys: action.keys, fallbackText: action.text)
            try keyDown(chord, postGate: postGate)
            do {
                try cancellablePause(
                    0.012,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
                try keyUp(chord, postGate: postGate)
            } catch {
                cleanupKeyUp(chord)
                throw error
            }
        case .holdKey:
            let chord = try ComputerKeyChord.parse(keys: action.keys, fallbackText: action.text)
            try keyDown(chord, postGate: postGate)
            do {
                try cancellablePause(
                    action.duration ?? 1,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
                try keyUp(chord, postGate: postGate)
            } catch {
                cleanupKeyUp(chord)
                throw error
            }
        case .scroll:
            try scroll(action, postGate: postGate)
        }
        try cancellablePause(
            0.012,
            shouldStop: shouldStop,
            poll: { try postGate.poll() }
        )
    }

    func releaseAll() {
        let snapshot = lock.withLock {
            let value = (
                mouse: heldMouseStates,
                keys: heldKeyStates,
                unicodePID: heldUnicodeTargetPID
            )
            heldMouseButtons.removeAll()
            heldKeys.removeAll()
            heldMouseStates.removeAll()
            heldKeyStates.removeAll()
            heldUnicodeTargetPID = nil
            return value
        }
        for (button, state) in snapshot.mouse {
            let eventType: CGEventType
            switch button {
            case .left: eventType = .leftMouseUp
            case .right: eventType = .rightMouseUp
            default: eventType = .otherMouseUp
            }
            postCleanupMouseUp(
                eventType,
                button: button,
                state: state
            )
        }
        for (keyCode, state) in snapshot.keys {
            postCleanupKeyUp(
                keyCode: keyCode,
                state: state
            )
        }
        if let targetPID = snapshot.unicodePID {
            postCleanupUnicodeUp(targetPID: targetPID)
        }
    }

    func ensureRunning(_ shouldStop: @Sendable () -> Bool) throws {
        if shouldStop() {
            throw ComputerInputError.executionStopped
        }
    }

    func cancellablePause(
        _ duration: TimeInterval,
        shouldStop: @Sendable () -> Bool,
        poll: @Sendable () throws -> Void = {}
    ) throws {
        let deadline = Date().addingTimeInterval(duration)
        repeat {
            try ensureRunning(shouldStop)
            try poll()
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { return }
            Thread.sleep(forTimeInterval: min(0.02, remaining))
        } while true
    }
}

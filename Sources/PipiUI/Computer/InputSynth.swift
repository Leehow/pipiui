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
            return "wait/hold duration must be between 0 and 10 seconds"
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
        }
    }
}

final class ComputerInputSynth: @unchecked Sendable {
    static let shared = ComputerInputSynth()
    static let syntheticEventTag: Int64 = 0x5049_5049_4355

    let lock = NSLock()
    var heldMouseButtons: Set<CGMouseButton> = []
    var heldKeys: Set<CGKeyCode> = []
    let source = CGEventSource(stateID: .privateState)

    private init() {
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
                guard text.utf16.count <= 100_000 else {
                    throw ComputerRequestError.invalidAction("typed text exceeds 100000 UTF-16 units")
                }
                if ComputerSensitiveTextPolicy.appearsSensitive(text) {
                    throw ComputerInputError.sensitiveTextBlocked
                }
            case .key, .holdKey:
                let chord = try ComputerKeyChord.parse(
                    keys: action.keys,
                    fallbackText: action.text
                )
                if chord.keyCode == 48, chord.modifiers.contains(.maskCommand) {
                    throw ComputerInputError.unsupportedAppSwitchShortcut
                }
                if chord.keyCode == 49, chord.modifiers.contains(.maskCommand) {
                    throw ComputerInputError.unsupportedAppSwitchShortcut
                }
                if chord.modifiers.contains(.maskCommand),
                   chord.keyCode == 12 || chord.keyCode == 51
                    || (chord.keyCode == 53
                        && chord.modifiers.contains(.maskAlternate)) {
                    throw ComputerInputError.sensitiveShortcutBlocked
                }
                if action.kind == .holdKey {
                    let duration = action.duration ?? 1
                    guard duration >= 0, duration <= 10 else {
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
                guard duration >= 0, duration <= 10 else {
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
        shouldStop: @escaping @Sendable () -> Bool = { false }
    ) throws {
        guard AXIsProcessTrusted() || !action.emitsInput else {
            throw ComputerInputError.accessibilityPermissionMissing
        }
        try ensureRunning(shouldStop)
        switch action.kind {
        case .screenshot:
            return
        case .wait:
            try cancellablePause(action.duration ?? 1, shouldStop: shouldStop)
        case .mouseMove:
            try ensureRunning(shouldStop)
            try postMouse(.mouseMoved, at: try point(action, imageSize, displayBounds))
        case .leftClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop
            )
        case .rightClick:
            try click(
                .right,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop
            )
        case .middleClick:
            try click(
                .center,
                at: try point(action, imageSize, displayBounds),
                count: 1,
                shouldStop: shouldStop
            )
        case .doubleClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 2,
                shouldStop: shouldStop
            )
        case .tripleClick:
            try click(
                .left,
                at: try point(action, imageSize, displayBounds),
                count: 3,
                shouldStop: shouldStop
            )
        case .leftMouseDown:
            let location = try optionalPoint(action, imageSize, displayBounds)
                ?? CGEvent(source: nil)?.location ?? .zero
            try mouseDown(.left, at: location, shouldStop: shouldStop)
        case .leftMouseUp:
            let location = try optionalPoint(action, imageSize, displayBounds)
                ?? CGEvent(source: nil)?.location ?? .zero
            try mouseUp(.left, at: location)
        case .drag:
            try drag(
                action,
                imageSize: imageSize,
                displayBounds: displayBounds,
                shouldStop: shouldStop
            )
        case .type:
            try typeUnicode(action.text ?? "", shouldStop: shouldStop)
        case .key:
            let chord = try ComputerKeyChord.parse(keys: action.keys, fallbackText: action.text)
            try keyDown(chord, shouldStop: shouldStop)
            do {
                try cancellablePause(0.012, shouldStop: shouldStop)
                try keyUp(chord)
            } catch {
                try? keyUp(chord)
                throw error
            }
        case .holdKey:
            let chord = try ComputerKeyChord.parse(keys: action.keys, fallbackText: action.text)
            try keyDown(chord, shouldStop: shouldStop)
            defer { try? keyUp(chord) }
            try cancellablePause(action.duration ?? 1, shouldStop: shouldStop)
        case .scroll:
            try ensureRunning(shouldStop)
            try scroll(action)
        }
        try cancellablePause(0.012, shouldStop: shouldStop)
    }

    func releaseAll() {
        lock.lock()
        let buttons = heldMouseButtons
        let keys = heldKeys

        let location = CGEvent(source: nil)?.location ?? .zero
        for button in buttons {
            let eventType: CGEventType
            switch button {
            case .left: eventType = .leftMouseUp
            case .right: eventType = .rightMouseUp
            default: eventType = .otherMouseUp
            }
            try? postMouse(eventType, at: location, button: button)
        }
        for keyCode in keys {
            if let event = CGEvent(
                keyboardEventSource: source,
                virtualKey: keyCode,
                keyDown: false
            ) {
                tag(event)
                event.post(tap: .cghidEventTap)
            }
        }
        heldMouseButtons.removeAll()
        heldKeys.removeAll()
        lock.unlock()
    }

    func ensureRunning(_ shouldStop: @Sendable () -> Bool) throws {
        if shouldStop() {
            throw ComputerInputError.executionStopped
        }
    }

    func cancellablePause(
        _ duration: TimeInterval,
        shouldStop: @Sendable () -> Bool
    ) throws {
        let deadline = Date().addingTimeInterval(duration)
        repeat {
            try ensureRunning(shouldStop)
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { return }
            Thread.sleep(forTimeInterval: min(0.02, remaining))
        } while true
    }
}

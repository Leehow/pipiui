import CoreGraphics
import Foundation

extension ComputerInputSynth {
    func makeMouseEvent(
        _ type: CGEventType,
        at point: CGPoint,
        button: CGMouseButton,
        clickState: Int = 1
    ) -> CGEvent? {
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button
        ) else { return nil }
        event.setIntegerValueField(
            .mouseEventClickState,
            value: Int64(clickState)
        )
        tag(event)
        return event
    }

    func tag(_ event: CGEvent) {
        event.setIntegerValueField(
            .eventSourceUserData,
            value: Self.syntheticEventTag
        )
    }

    func cleanupMouseUp(_ button: CGMouseButton) {
        let state = lock.withLock {
            heldMouseButtons.remove(button)
            return heldMouseStates.removeValue(forKey: button)
        }
        guard let state else { return }
        let type: CGEventType
        switch button {
        case .left: type = .leftMouseUp
        case .right: type = .rightMouseUp
        default: type = .otherMouseUp
        }
        postCleanupMouseUp(type, button: button, state: state)
    }

    func cleanupKeyUp(_ chord: ComputerKeyChord) {
        let state = lock.withLock {
            heldKeys.remove(chord.keyCode)
            return heldKeyStates.removeValue(forKey: chord.keyCode)
        }
        guard let state else { return }
        postCleanupKeyUp(keyCode: chord.keyCode, state: state)
    }

    func cleanupUnicodeUp(targetPID: Int32) {
        let shouldPost = lock.withLock {
            guard heldUnicodeTargetPID == targetPID else { return false }
            heldUnicodeTargetPID = nil
            return true
        }
        if shouldPost {
            postCleanupUnicodeUp(targetPID: targetPID)
        }
    }

    func postCleanupMouseUp(
        _ type: CGEventType,
        button: CGMouseButton,
        state: ComputerHeldMouseState
    ) {
        guard let event = makeMouseEvent(
            type,
            at: state.point,
            button: button
        ) else { return }
        try? eventSink.postGlobal(
            event,
            state.targetPID,
            .cleanupMouseUp
        )
    }

    func postCleanupKeyUp(
        keyCode: CGKeyCode,
        state: ComputerHeldKeyState
    ) {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: keyCode,
            keyDown: false
        ) else { return }
        event.flags = state.modifiers
        tag(event)
        try? eventSink.postToPID(
            event,
            state.targetPID,
            .cleanupKeyUp(keyCode)
        )
    }

    func postCleanupUnicodeUp(targetPID: Int32) {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: 0,
            keyDown: false
        ) else { return }
        // Intentionally text-free: never repeat a Unicode payload during
        // cancellation/focus-drift cleanup.
        tag(event)
        try? eventSink.postToPID(
            event,
            targetPID,
            .cleanupUnicodeUp
        )
    }
}

extension NSLock {
    @discardableResult
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}

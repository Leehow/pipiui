import Foundation
import CoreGraphics

extension ComputerInputSynth {
    func point(
        _ action: ComputerAction,
        _ imageSize: ComputerImageSize,
        _ displayBounds: CGRect
    ) throws -> CGPoint {
        guard let coordinate = action.coordinate else {
            throw ComputerInputError.missingCoordinate(action.kind)
        }
        return try ComputerCoordinateMap.globalPoint(
            imagePoint: coordinate,
            imageSize: imageSize,
            displayBounds: displayBounds
        )
    }

    func optionalPoint(
        _ action: ComputerAction,
        _ imageSize: ComputerImageSize,
        _ displayBounds: CGRect
    ) throws -> CGPoint? {
        guard let coordinate = action.coordinate else { return nil }
        return try ComputerCoordinateMap.globalPoint(
            imagePoint: coordinate,
            imageSize: imageSize,
            displayBounds: displayBounds
        )
    }

    func click(
        _ button: CGMouseButton,
        at point: CGPoint,
        count: Int,
        shouldStop: @Sendable () -> Bool
    ) throws {
        for clickState in 1...count {
            try mouseDown(
                button,
                at: point,
                clickState: clickState,
                shouldStop: shouldStop
            )
            do {
                try cancellablePause(0.012, shouldStop: shouldStop)
                try mouseUp(button, at: point, clickState: clickState)
            } catch {
                try? mouseUp(button, at: point, clickState: clickState)
                throw error
            }
            if clickState < count {
                try cancellablePause(0.012, shouldStop: shouldStop)
            }
        }
    }

    func mouseDown(
        _ button: CGMouseButton,
        at point: CGPoint,
        clickState: Int = 1,
        shouldStop: @Sendable () -> Bool = { false }
    ) throws {
        let type: CGEventType
        switch button {
        case .left: type = .leftMouseDown
        case .right: type = .rightMouseDown
        default: type = .otherMouseDown
        }
        try lock.withLock {
            try ensureRunning(shouldStop)
            heldMouseButtons.insert(button)
            do {
                try postMouse(type, at: point, button: button, clickState: clickState)
            } catch {
                heldMouseButtons.remove(button)
                throw error
            }
        }
    }

    func mouseUp(
        _ button: CGMouseButton,
        at point: CGPoint,
        clickState: Int = 1
    ) throws {
        let type: CGEventType
        switch button {
        case .left: type = .leftMouseUp
        case .right: type = .rightMouseUp
        default: type = .otherMouseUp
        }
        try lock.withLock {
            try postMouse(type, at: point, button: button, clickState: clickState)
            heldMouseButtons.remove(button)
        }
    }

    func postMouse(
        _ type: CGEventType,
        at point: CGPoint,
        button: CGMouseButton = .left,
        clickState: Int = 1
    ) throws {
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        tag(event)
        event.post(tap: .cghidEventTap)
    }

    func drag(
        _ action: ComputerAction,
        imageSize: ComputerImageSize,
        displayBounds: CGRect,
        shouldStop: @Sendable () -> Bool
    ) throws {
        let end = try point(action, imageSize, displayBounds)
        let start: CGPoint
        if let startCoordinate = action.startCoordinate {
            start = try ComputerCoordinateMap.globalPoint(
                imagePoint: startCoordinate,
                imageSize: imageSize,
                displayBounds: displayBounds
            )
        } else {
            start = CGEvent(source: nil)?.location ?? end
        }
        try mouseDown(.left, at: start, shouldStop: shouldStop)
        defer { try? mouseUp(.left, at: end) }
        let frames = 16
        for index in 1...frames {
            try ensureRunning(shouldStop)
            let progress = CGFloat(index) / CGFloat(frames)
            let point = CGPoint(
                x: start.x + (end.x - start.x) * progress,
                y: start.y + (end.y - start.y) * progress
            )
            try postMouse(.leftMouseDragged, at: point)
            try cancellablePause(0.012, shouldStop: shouldStop)
        }
    }

    func typeUnicode(
        _ text: String,
        shouldStop: @Sendable () -> Bool
    ) throws {
        let units = Array(text.utf16)
        let chunkSize = 20
        for start in stride(from: 0, to: units.count, by: chunkSize) {
            try ensureRunning(shouldStop)
            let end = min(units.count, start + chunkSize)
            let chunk = Array(units[start..<end])
            guard let down = CGEvent(
                keyboardEventSource: source,
                virtualKey: 0,
                keyDown: true
            ), let up = CGEvent(
                keyboardEventSource: source,
                virtualKey: 0,
                keyDown: false
            ) else {
                throw ComputerInputError.eventCreationFailed
            }
            chunk.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(
                    stringLength: buffer.count,
                    unicodeString: buffer.baseAddress
                )
                up.keyboardSetUnicodeString(
                    stringLength: buffer.count,
                    unicodeString: buffer.baseAddress
                )
            }
            tag(down)
            tag(up)
            down.post(tap: .cghidEventTap)
            throttle()
            up.post(tap: .cghidEventTap)
            try cancellablePause(0.012, shouldStop: shouldStop)
        }
    }

    func keyDown(
        _ chord: ComputerKeyChord,
        shouldStop: @Sendable () -> Bool = { false }
    ) throws {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: chord.keyCode,
            keyDown: true
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        try lock.withLock {
            try ensureRunning(shouldStop)
            heldKeys.insert(chord.keyCode)
            event.flags = chord.modifiers
            tag(event)
            event.post(tap: .cghidEventTap)
        }
    }

    func keyUp(_ chord: ComputerKeyChord) throws {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: chord.keyCode,
            keyDown: false
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        lock.withLock {
            event.flags = chord.modifiers
            tag(event)
            event.post(tap: .cghidEventTap)
            heldKeys.remove(chord.keyCode)
        }
    }

    func scroll(_ action: ComputerAction) throws {
        let amount = Int32(min(10_000, max(1, action.scrollAmount ?? 0)))
        let direction = action.scrollDirection?.lowercased() ?? ""
        let vertical: Int32
        let horizontal: Int32
        switch direction {
        case "up": vertical = amount; horizontal = 0
        case "down": vertical = -amount; horizontal = 0
        case "left": vertical = 0; horizontal = amount
        case "right": vertical = 0; horizontal = -amount
        default: throw ComputerInputError.invalidScroll
        }
        guard let event = CGEvent(
            scrollWheelEvent2Source: source,
            units: .pixel,
            wheelCount: 2,
            wheel1: vertical,
            wheel2: horizontal,
            wheel3: 0
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        tag(event)
        event.post(tap: .cghidEventTap)
    }

    func tag(_ event: CGEvent) {
        event.setIntegerValueField(
            .eventSourceUserData,
            value: Self.syntheticEventTag
        )
    }

    func throttle() {
        Thread.sleep(forTimeInterval: 0.012)
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

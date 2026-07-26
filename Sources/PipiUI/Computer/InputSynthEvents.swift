import CoreGraphics
import Foundation

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
        shouldStop: @Sendable () -> Bool,
        postGate: ComputerLivePostGate
    ) throws {
        for clickState in 1...count {
            try mouseDown(
                button,
                at: point,
                clickState: clickState,
                postGate: postGate
            )
            do {
                try cancellablePause(
                    0.012,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
                try mouseUp(
                    button,
                    at: point,
                    clickState: clickState,
                    postGate: postGate
                )
            } catch {
                cleanupMouseUp(button)
                throw error
            }
            if clickState < count {
                try cancellablePause(
                    0.012,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
            }
        }
    }

    func mouseDown(
        _ button: CGMouseButton,
        at point: CGPoint,
        clickState: Int = 1,
        postGate: ComputerLivePostGate
    ) throws {
        let type: CGEventType
        switch button {
        case .left: type = .leftMouseDown
        case .right: type = .rightMouseDown
        default: type = .otherMouseDown
        }
        guard let event = makeMouseEvent(
            type,
            at: point,
            button: button,
            clickState: clickState
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        try postGate.post(pointerAt: point) {
            try lock.withLock {
                heldMouseButtons.insert(button)
                heldMouseStates[button] = .init(
                    targetPID: postGate.targetPID,
                    point: point
                )
                do {
                    try eventSink.postGlobal(
                        event,
                        postGate.targetPID,
                        .pointer
                    )
                } catch {
                    heldMouseButtons.remove(button)
                    heldMouseStates.removeValue(forKey: button)
                    throw error
                }
            }
        }
    }

    func mouseUp(
        _ button: CGMouseButton,
        at point: CGPoint,
        clickState: Int = 1,
        postGate: ComputerLivePostGate
    ) throws {
        let type: CGEventType
        switch button {
        case .left: type = .leftMouseUp
        case .right: type = .rightMouseUp
        default: type = .otherMouseUp
        }
        guard let event = makeMouseEvent(
            type,
            at: point,
            button: button,
            clickState: clickState
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        try postGate.post(pointerAt: point) {
            try eventSink.postGlobal(event, postGate.targetPID, .pointer)
            lock.withLock {
                heldMouseButtons.remove(button)
                heldMouseStates.removeValue(forKey: button)
            }
        }
    }

    func postMouse(
        _ type: CGEventType,
        at point: CGPoint,
        button: CGMouseButton = .left,
        clickState: Int = 1,
        trackHeldButton: CGMouseButton? = nil,
        postGate: ComputerLivePostGate
    ) throws {
        guard let event = makeMouseEvent(
            type,
            at: point,
            button: button,
            clickState: clickState
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        try postGate.post(pointerAt: point) {
            try eventSink.postGlobal(event, postGate.targetPID, .pointer)
            if let trackHeldButton {
                lock.withLock {
                    heldMouseStates[trackHeldButton] = .init(
                        targetPID: postGate.targetPID,
                        point: point
                    )
                }
            }
        }
    }

    func drag(
        _ action: ComputerAction,
        imageSize: ComputerImageSize,
        displayBounds: CGRect,
        shouldStop: @Sendable () -> Bool,
        postGate: ComputerLivePostGate
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
        try mouseDown(.left, at: start, postGate: postGate)
        do {
            let frames = 16
            for index in 1...frames {
                let progress = CGFloat(index) / CGFloat(frames)
                let nextPoint = CGPoint(
                    x: start.x + (end.x - start.x) * progress,
                    y: start.y + (end.y - start.y) * progress
                )
                try postMouse(
                    .leftMouseDragged,
                    at: nextPoint,
                    trackHeldButton: .left,
                    postGate: postGate
                )
                try cancellablePause(
                    0.012,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
            }
            try mouseUp(.left, at: end, postGate: postGate)
        } catch {
            cleanupMouseUp(.left)
            throw error
        }
    }

    func typeUnicode(
        _ text: String,
        shouldStop: @Sendable () -> Bool,
        postGate: ComputerLivePostGate
    ) throws {
        for textChunk in try ComputerUnicodeChunker.chunks(text) {
            let chunk = Array(textChunk.utf16)
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
            }
            tag(down)
            tag(up)

            try postGate.post {
                try lock.withLock {
                    heldUnicodeTargetPID = postGate.targetPID
                    do {
                        try eventSink.postToPID(
                            down,
                            postGate.targetPID,
                            .unicodeDown(utf16Count: chunk.count)
                        )
                    } catch {
                        heldUnicodeTargetPID = nil
                        throw error
                    }
                }
            }
            do {
                try cancellablePause(
                    0.012,
                    shouldStop: shouldStop,
                    poll: { try postGate.poll() }
                )
                try postGate.post {
                    try eventSink.postToPID(
                        up,
                        postGate.targetPID,
                        .unicodeUp
                    )
                    lock.withLock { heldUnicodeTargetPID = nil }
                }
            } catch {
                cleanupUnicodeUp(targetPID: postGate.targetPID)
                throw error
            }
            try cancellablePause(
                0.012,
                shouldStop: shouldStop,
                poll: { try postGate.poll() }
            )
        }
    }

    func keyDown(
        _ chord: ComputerKeyChord,
        postGate: ComputerLivePostGate
    ) throws {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: chord.keyCode,
            keyDown: true
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        event.flags = chord.modifiers
        tag(event)
        try postGate.post {
            try lock.withLock {
                heldKeys.insert(chord.keyCode)
                heldKeyStates[chord.keyCode] = .init(
                    targetPID: postGate.targetPID,
                    modifiers: chord.modifiers
                )
                do {
                    try eventSink.postToPID(
                        event,
                        postGate.targetPID,
                        .keyDown(chord.keyCode)
                    )
                } catch {
                    heldKeys.remove(chord.keyCode)
                    heldKeyStates.removeValue(forKey: chord.keyCode)
                    throw error
                }
            }
        }
    }

    func keyUp(
        _ chord: ComputerKeyChord,
        postGate: ComputerLivePostGate
    ) throws {
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: chord.keyCode,
            keyDown: false
        ) else {
            throw ComputerInputError.eventCreationFailed
        }
        event.flags = chord.modifiers
        tag(event)
        try postGate.post {
            try eventSink.postToPID(
                event,
                postGate.targetPID,
                .keyUp(chord.keyCode)
            )
            lock.withLock {
                heldKeys.remove(chord.keyCode)
                heldKeyStates.removeValue(forKey: chord.keyCode)
            }
        }
    }

    func scroll(
        _ action: ComputerAction,
        postGate: ComputerLivePostGate
    ) throws {
        let location = CGEvent(source: nil)?.location ?? .zero
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
        event.location = location
        tag(event)
        try postGate.post(pointerAt: location) {
            try eventSink.postGlobal(event, postGate.targetPID, .scroll)
        }
    }

}

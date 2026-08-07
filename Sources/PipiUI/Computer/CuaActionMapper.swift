import Foundation

struct CuaActionStep: @unchecked Sendable {
    let sourceIndexes: [Int]
    let kind: ComputerActionKind
    let tool: String?
    let arguments: [String: Any]
    let waitDuration: TimeInterval?
}

enum CuaActionMapper {
    static func steps(
        actions: [ComputerAction],
        target: CuaComputerTarget,
        session: String
    ) throws -> [CuaActionStep] {
        try actions.forEach { try $0.validateTechnicalBounds() }
        var result: [CuaActionStep] = []
        var index = 0
        while index < actions.count {
            let action = actions[index]
            if action.kind == .leftMouseDown {
                let drag = try coalescedDrag(
                    actions: actions,
                    startIndex: index,
                    target: target,
                    session: session
                )
                result.append(drag.step)
                index = drag.nextIndex
                continue
            }
            if action.kind == .leftMouseUp {
                throw CuaIntegrationError.invalidAction(
                    "left_mouse_up has no preceding left_mouse_down"
                )
            }
            result.append(
                try step(
                    action: action,
                    index: index,
                    target: target,
                    session: session
                )
            )
            index += 1
        }
        return result
    }

    private static func coalescedDrag(
        actions: [ComputerAction],
        startIndex: Int,
        target: CuaComputerTarget,
        session: String
    ) throws -> (step: CuaActionStep, nextIndex: Int) {
        guard let from = actions[startIndex].coordinate else {
            throw CuaIntegrationError.invalidAction(
                "left_mouse_down requires a coordinate"
            )
        }
        var lastPoint = from
        var consumed = [startIndex]
        var cursor = startIndex + 1
        while cursor < actions.count {
            let action = actions[cursor]
            switch action.kind {
            case .mouseMove:
                if let coordinate = action.coordinate {
                    lastPoint = coordinate
                }
                consumed.append(cursor)
            case .leftMouseUp:
                if let coordinate = action.coordinate {
                    lastPoint = coordinate
                }
                consumed.append(cursor)
                let fromSource = try target.transform
                    .advertisedToSource(from)
                let toSource = try target.transform
                    .advertisedToSource(lastPoint)
                return (
                    CuaActionStep(
                        sourceIndexes: consumed,
                        kind: .drag,
                        tool: "drag",
                        arguments: baseArguments(
                            target: target,
                            session: session
                        ).merging([
                            "from_x": fromSource.x,
                            "from_y": fromSource.y,
                            "to_x": toSource.x,
                            "to_y": toSource.y,
                            "duration_ms": try durationMilliseconds(
                                actions[startIndex].duration ?? 0.5
                            ),
                        ]) { _, new in new },
                        waitDuration: nil
                    ),
                    cursor + 1
                )
            default:
                throw CuaIntegrationError.invalidAction(
                    "left_mouse_down must be followed only by mouse_move actions and left_mouse_up"
                )
            }
            cursor += 1
        }
        throw CuaIntegrationError.invalidAction(
            "left_mouse_down is missing a matching left_mouse_up"
        )
    }

    private static func step(
        action: ComputerAction,
        index: Int,
        target: CuaComputerTarget,
        session: String
    ) throws -> CuaActionStep {
        var arguments = baseArguments(target: target, session: session)
        if let deliveryMode = action.deliveryMode {
            arguments["delivery_mode"] = deliveryMode
        }
        if let elementIndex = action.elementIndex {
            guard let token = target.elementTokens[elementIndex] else {
                throw CuaIntegrationError.invalidAction(
                    "This element_index/token is stale (from an older pinned "
                        + "screenshot). Capture a fresh observation and use "
                        + "the new element_token; do not retry the same index "
                        + "or token. (missing element_index \(elementIndex))"
                )
            }
            arguments["element_token"] = token
        }
        if let elementToken = action.elementToken {
            arguments["element_token"] = elementToken
        }

        func addCoordinate(_ coordinate: ComputerImagePoint?) throws {
            guard let coordinate else {
                throw CuaIntegrationError.invalidAction(
                    "\(action.kind.rawValue) requires a coordinate or AX element"
                )
            }
            let source = try target.transform
                .advertisedToSource(coordinate)
            arguments["x"] = source.x
            arguments["y"] = source.y
        }

        let tool: String?
        var waitDuration: TimeInterval?
        switch action.kind {
        case .screenshot:
            tool = nil
        case .mouseMove:
            try addCoordinate(action.coordinate)
            // Window-scope move_cursor is a visible agent overlay only. It is
            // useful for pointing/inspection but does not synthesize OS hover.
            arguments.removeValue(forKey: "pid")
            arguments.removeValue(forKey: "window_id")
            tool = "move_cursor"
        case .leftClick:
            if action.elementIndex == nil, action.elementToken == nil {
                try addCoordinate(action.coordinate)
            }
            arguments["button"] = "left"
            tool = "click"
        case .rightClick:
            if action.elementIndex == nil, action.elementToken == nil {
                try addCoordinate(action.coordinate)
            }
            arguments["button"] = "right"
            tool = "click"
        case .middleClick:
            if action.elementIndex == nil, action.elementToken == nil {
                try addCoordinate(action.coordinate)
            }
            arguments["button"] = "middle"
            tool = "click"
        case .doubleClick:
            if action.elementIndex != nil || action.elementToken != nil {
                tool = "double_click"
            } else {
                try addCoordinate(action.coordinate)
                arguments["count"] = 2
                tool = "click"
            }
        case .tripleClick:
            guard action.elementIndex == nil,
                  action.elementToken == nil else {
                throw CuaIntegrationError.invalidAction(
                    "triple_click does not support AX element_index/element_token; "
                        + "use a pixel coordinate"
                )
            }
            try addCoordinate(action.coordinate)
            arguments["count"] = 3
            tool = "click"
        case .drag:
            guard let from = action.startCoordinate,
                  let to = action.coordinate else {
                throw CuaIntegrationError.invalidAction(
                    "left_click_drag requires start_coordinate and coordinate"
                )
            }
            let sourceFrom = try target.transform
                .advertisedToSource(from)
            let sourceTo = try target.transform
                .advertisedToSource(to)
            arguments["from_x"] = sourceFrom.x
            arguments["from_y"] = sourceFrom.y
            arguments["to_x"] = sourceTo.x
            arguments["to_y"] = sourceTo.y
            arguments["duration_ms"] = try durationMilliseconds(
                action.duration ?? 0.5
            )
            tool = "drag"
        case .type:
            guard let text = action.text else {
                throw CuaIntegrationError.invalidAction(
                    "type requires text"
                )
            }
            arguments["text"] = text
            if action.elementIndex == nil,
               action.elementToken == nil,
               action.coordinate != nil {
                try addCoordinate(action.coordinate)
            }
            tool = "type_text"
        case .holdKey:
            throw CuaIntegrationError.invalidAction(
                "hold_key is unsupported by Cua Driver 0.12.5 because it "
                    + "does not expose matching key_down/key_up operations"
            )
        case .key:
            guard !action.keys.isEmpty else {
                throw CuaIntegrationError.invalidAction(
                    "\(action.kind.rawValue) requires keys"
                )
            }
            if action.keys.count == 1 {
                arguments["key"] = action.keys[0]
                tool = "press_key"
            } else {
                arguments["keys"] = action.keys
                tool = "hotkey"
            }
        case .scroll:
            try addCoordinate(action.coordinate)
            arguments["direction"] =
                action.scrollDirection?.lowercased() ?? "down"
            arguments["amount"] = max(1, action.scrollAmount ?? 3)
            tool = "scroll"
        case .wait:
            tool = nil
            waitDuration = max(0, action.duration ?? 1)
        case .leftMouseDown, .leftMouseUp:
            preconditionFailure("drag sequence handled before step mapping")
        }
        return CuaActionStep(
            sourceIndexes: [index],
            kind: action.kind,
            tool: tool,
            arguments: arguments,
            waitDuration: waitDuration
        )
    }

    private static func baseArguments(
        target: CuaComputerTarget,
        session: String
    ) -> [String: Any] {
        [
            "session": session,
            "pid": target.processID,
            "window_id": target.primaryWindowID,
        ]
    }

    private static func durationMilliseconds(
        _ duration: TimeInterval
    ) throws -> Int {
        guard duration.isFinite,
              duration >= 0,
              duration <= ComputerAction.maximumDurationSeconds else {
            throw CuaIntegrationError.invalidAction(
                "duration must be finite and between 0 and "
                    + "\(Int(ComputerAction.maximumDurationSeconds)) seconds"
            )
        }
        let milliseconds = duration * 1_000
        guard milliseconds <= Double(Int.max) else {
            throw CuaIntegrationError.invalidAction(
                "duration cannot be represented in milliseconds"
            )
        }
        return Int(milliseconds.rounded())
    }
}

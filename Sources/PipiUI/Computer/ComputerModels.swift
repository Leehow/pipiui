import Foundation

struct ComputerImageSize: Equatable, Codable, Sendable {
    let width: Int
    let height: Int

    var isValid: Bool { width > 0 && height > 0 }
}

struct ComputerImagePoint: Equatable, Codable, Sendable {
    let x: Double
    let y: Double
}

enum ComputerActionKind: String, Codable, CaseIterable, Sendable {
    case screenshot
    case mouseMove = "mouse_move"
    case leftClick = "left_click"
    case rightClick = "right_click"
    case middleClick = "middle_click"
    case doubleClick = "double_click"
    case tripleClick = "triple_click"
    case leftMouseDown = "left_mouse_down"
    case leftMouseUp = "left_mouse_up"
    case drag = "left_click_drag"
    case type
    case key
    case holdKey = "hold_key"
    case scroll
    case wait

    static func normalized(_ value: String) -> ComputerActionKind? {
        switch value.lowercased() {
        case "click": return .leftClick
        case "move": return .mouseMove
        case "keypress": return .key
        case "drag": return .drag
        default: return ComputerActionKind(rawValue: value.lowercased())
        }
    }

    var emitsPointerEvent: Bool {
        switch self {
        case .mouseMove, .leftClick, .rightClick, .middleClick,
             .doubleClick, .tripleClick, .leftMouseDown, .leftMouseUp,
             .drag, .scroll:
            return true
        default:
            return false
        }
    }
}

struct ComputerAction: Equatable, Sendable {
    let kind: ComputerActionKind
    let coordinate: ComputerImagePoint?
    let startCoordinate: ComputerImagePoint?
    let text: String?
    let keys: [String]
    let scrollDirection: String?
    let scrollAmount: Int?
    let duration: TimeInterval?

    var emitsInput: Bool {
        kind != .screenshot && kind != .wait
    }

    var auditMetadata: [String: Any] {
        var result: [String: Any] = ["type": kind.rawValue]
        if let coordinate {
            result["coordinate"] = [coordinate.x, coordinate.y]
        }
        if let startCoordinate {
            result["startCoordinate"] = [startCoordinate.x, startCoordinate.y]
        }
        if kind == .type {
            // Never persist the typed payload itself.
            result["characterCount"] = text?.count ?? 0
        }
        if kind == .key || kind == .holdKey {
            // Named keys can themselves carry user data, so retain only the count.
            result["keyCount"] = keys.count
        }
        if kind == .scroll {
            result["scrollDirection"] = scrollDirection ?? "unspecified"
            result["scrollAmount"] = scrollAmount ?? 0
        }
        if let duration {
            result["durationMilliseconds"] = Int(duration * 1000)
        }
        return result
    }

    static func parse(_ value: J) throws -> ComputerAction {
        guard let rawKind = value["type"].string ?? value["action"].string,
              let kind = ComputerActionKind.normalized(rawKind) else {
            throw ComputerRequestError.invalidAction("missing or unsupported action type")
        }

        let coordinate = try parsePoint(
            array: value["coordinate"],
            x: value["x"],
            y: value["y"],
            field: "coordinate"
        )
        let start = try parsePoint(
            array: value["start_coordinate"],
            x: value["startX"],
            y: value["startY"],
            field: "start_coordinate"
        )
        let keys = value["keys"].array.compactMap(\.string)
        let text = value["text"].string
        let duration: TimeInterval?
        if let ms = value["duration_ms"].double {
            duration = ms / 1000
        } else {
            duration = value["duration"].double
        }

        return ComputerAction(
            kind: kind,
            coordinate: coordinate,
            startCoordinate: start,
            text: text,
            keys: keys,
            scrollDirection: value["scroll_direction"].string ?? value["direction"].string,
            scrollAmount: value["scroll_amount"].int ?? value["amount"].int,
            duration: duration
        )
    }

    private static func parsePoint(
        array: J,
        x: J,
        y: J,
        field: String
    ) throws -> ComputerImagePoint? {
        if array.exists {
            let values = array.array
            guard values.count == 2,
                  let px = values[0].double,
                  let py = values[1].double else {
                throw ComputerRequestError.invalidAction("\(field) must contain exactly two numbers")
            }
            return ComputerImagePoint(x: px, y: py)
        }
        if x.exists || y.exists {
            guard let px = x.double, let py = y.double else {
                throw ComputerRequestError.invalidAction("x and y must both be numbers")
            }
            return ComputerImagePoint(x: px, y: py)
        }
        return nil
    }
}

struct ComputerRequest: Equatable, Sendable {
    static let maximumActions = 12
    let actions: [ComputerAction]

    var requiresWriteApproval: Bool {
        actions.contains { $0.kind != .screenshot }
    }

    static func normalize(_ request: J) throws -> ComputerRequest {
        let rawActions: [J]
        if request["actions"].exists {
            rawActions = request["actions"].array
        } else if request["type"].exists {
            // Anthropic's official tool calls contain one top-level action.
            rawActions = [request]
        } else {
            throw ComputerRequestError.invalidRequest("actions must be a non-empty array")
        }
        guard !rawActions.isEmpty else {
            throw ComputerRequestError.invalidRequest("actions must be a non-empty array")
        }
        guard rawActions.count <= maximumActions else {
            throw ComputerRequestError.invalidRequest(
                "a batch may contain at most \(maximumActions) actions"
            )
        }
        return ComputerRequest(actions: try rawActions.map(ComputerAction.parse))
    }
}

enum ComputerRequestError: LocalizedError, Equatable {
    case invalidRequest(String)
    case invalidAction(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message): return "invalid computer request: \(message)"
        case .invalidAction(let message): return "invalid computer action: \(message)"
        }
    }
}

struct ComputerActionOutcome: Sendable {
    let index: Int
    let kind: ComputerActionKind
    let ok: Bool
    let message: String

    var dictionary: [String: Any] {
        [
            "index": index,
            "type": kind.rawValue,
            "ok": ok,
            "message": message,
        ]
    }
}

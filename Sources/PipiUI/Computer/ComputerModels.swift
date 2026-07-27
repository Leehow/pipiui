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
    static let maximumCoordinateMagnitude = 1_000_000.0
    static let maximumDurationSeconds =
        ComputerRuntimeBudget.maximumPauseSeconds
    static let maximumScrollAmount = 50
    static let maximumElementIndex = 1_000_000
    static let maximumKeyCount = 16
    static let maximumKeyLength = 64

    let kind: ComputerActionKind
    let coordinate: ComputerImagePoint?
    let startCoordinate: ComputerImagePoint?
    let text: String?
    let keys: [String]
    let scrollDirection: String?
    let scrollAmount: Int?
    let duration: TimeInterval?
    let elementIndex: Int?
    let elementToken: String?
    let deliveryMode: String?

    init(
        kind: ComputerActionKind,
        coordinate: ComputerImagePoint?,
        startCoordinate: ComputerImagePoint?,
        text: String?,
        keys: [String],
        scrollDirection: String?,
        scrollAmount: Int?,
        duration: TimeInterval?,
        elementIndex: Int? = nil,
        elementToken: String? = nil,
        deliveryMode: String? = nil
    ) {
        self.kind = kind
        self.coordinate = coordinate
        self.startCoordinate = startCoordinate
        self.text = text
        self.keys = keys
        self.scrollDirection = scrollDirection
        self.scrollAmount = scrollAmount
        self.duration = duration
        self.elementIndex = elementIndex
        self.elementToken = elementToken
        self.deliveryMode = deliveryMode
    }

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
            let milliseconds = duration * 1_000
            if milliseconds.isFinite,
               milliseconds >= Double(Int.min),
               milliseconds < Double(Int.max) {
                result["durationMilliseconds"] = Int(milliseconds)
            }
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
        if value["duration_ms"].exists {
            let ms = try boundedNumber(
                value["duration_ms"],
                field: "duration_ms",
                minimum: 0,
                maximum: maximumDurationSeconds * 1_000
            )
            duration = ms / 1000
        } else if value["duration"].exists {
            duration = try boundedNumber(
                value["duration"],
                field: "duration",
                minimum: 0,
                maximum: maximumDurationSeconds
            )
        } else {
            duration = nil
        }
        let scrollValue = value["scroll_amount"].exists
            ? value["scroll_amount"] : value["amount"]
        let scrollAmount = try boundedInteger(
            scrollValue,
            field: "scroll amount",
            minimum: 1,
            maximum: maximumScrollAmount
        )
        let elementIndex = try boundedInteger(
            value["element_index"],
            field: "element_index",
            minimum: 0,
            maximum: maximumElementIndex
        )

        let action = ComputerAction(
            kind: kind,
            coordinate: coordinate,
            startCoordinate: start,
            text: text,
            keys: keys,
            scrollDirection: value["scroll_direction"].string ?? value["direction"].string,
            scrollAmount: scrollAmount,
            duration: duration,
            elementIndex: elementIndex,
            elementToken: value["element_token"].string,
            deliveryMode: value["delivery_mode"].string
        )
        try action.validateTechnicalBounds()
        return action
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
                  values[0].double != nil,
                  values[1].double != nil else {
                throw ComputerRequestError.invalidAction("\(field) must contain exactly two numbers")
            }
            let px = try boundedNumber(
                values[0],
                field: "\(field).x",
                minimum: -maximumCoordinateMagnitude,
                maximum: maximumCoordinateMagnitude
            )
            let py = try boundedNumber(
                values[1],
                field: "\(field).y",
                minimum: -maximumCoordinateMagnitude,
                maximum: maximumCoordinateMagnitude
            )
            return ComputerImagePoint(x: px, y: py)
        }
        if x.exists || y.exists {
            guard x.double != nil, y.double != nil else {
                throw ComputerRequestError.invalidAction("x and y must both be numbers")
            }
            let px = try boundedNumber(
                x,
                field: "x",
                minimum: -maximumCoordinateMagnitude,
                maximum: maximumCoordinateMagnitude
            )
            let py = try boundedNumber(
                y,
                field: "y",
                minimum: -maximumCoordinateMagnitude,
                maximum: maximumCoordinateMagnitude
            )
            return ComputerImagePoint(x: px, y: py)
        }
        return nil
    }

    func validateTechnicalBounds() throws {
        for (field, point) in [
            ("coordinate", coordinate),
            ("start_coordinate", startCoordinate),
        ] {
            guard let point else { continue }
            for (axis, value) in [("x", point.x), ("y", point.y)] {
                guard value.isFinite,
                      abs(value) <= Self.maximumCoordinateMagnitude else {
                    throw ComputerRequestError.invalidAction(
                        "\(field).\(axis) must be finite and within "
                            + "±\(Int(Self.maximumCoordinateMagnitude))"
                    )
                }
            }
        }
        if let duration {
            guard duration.isFinite,
                  duration >= 0,
                  duration <= Self.maximumDurationSeconds else {
                throw ComputerRequestError.invalidAction(
                    "duration must be finite and between 0 and "
                        + "\(Int(Self.maximumDurationSeconds)) seconds"
                )
            }
        }
        if let scrollAmount {
            guard (1...Self.maximumScrollAmount).contains(scrollAmount) else {
                throw ComputerRequestError.invalidAction(
                    "scroll amount must be an integer between 1 and "
                        + "\(Self.maximumScrollAmount)"
                )
            }
        }
        if let elementIndex {
            guard (0...Self.maximumElementIndex).contains(elementIndex) else {
                throw ComputerRequestError.invalidAction(
                    "element_index must be an integer between 0 and "
                        + "\(Self.maximumElementIndex)"
                )
            }
        }
        if let text,
           text.utf16.count > ComputerRuntimeBudget.maximumTypedUTF16Units {
            throw ComputerRequestError.invalidAction(
                "typed text exceeds "
                    + "\(ComputerRuntimeBudget.maximumTypedUTF16Units) UTF-16 units"
            )
        }
        guard keys.count <= Self.maximumKeyCount,
              keys.allSatisfy({ !$0.isEmpty && $0.utf8.count <= Self.maximumKeyLength }) else {
            throw ComputerRequestError.invalidAction(
                "keys must contain at most \(Self.maximumKeyCount) non-empty names, "
                    + "each at most \(Self.maximumKeyLength) bytes"
            )
        }
    }

    private static func boundedNumber(
        _ value: J,
        field: String,
        minimum: Double,
        maximum: Double
    ) throws -> Double {
        guard let number = value.double,
              number.isFinite,
              number >= minimum,
              number <= maximum else {
            throw ComputerRequestError.invalidAction(
                "\(field) must be a finite number between \(minimum) and \(maximum)"
            )
        }
        return number
    }

    private static func boundedInteger(
        _ value: J,
        field: String,
        minimum: Int,
        maximum: Int
    ) throws -> Int? {
        guard value.exists else { return nil }
        let number = try boundedNumber(
            value,
            field: field,
            minimum: Double(minimum),
            maximum: Double(maximum)
        )
        guard number.rounded(.towardZero) == number else {
            throw ComputerRequestError.invalidAction(
                "\(field) must be an integer"
            )
        }
        return Int(number)
    }
}

struct ComputerRequest: Equatable, Sendable {
    /// Technical request-size ceiling for bridge/decoder stability. It is not a
    /// multi-turn action budget and creates no approval or pause state.
    static let maximumActions = 64
    let actions: [ComputerAction]

    var requiresWriteApproval: Bool {
        false
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

struct ComputerActionOutcome: @unchecked Sendable {
    let index: Int
    let kind: ComputerActionKind
    let ok: Bool
    let message: String
    let details: [String: Any]?

    init(
        index: Int,
        kind: ComputerActionKind,
        ok: Bool,
        message: String,
        details: [String: Any]? = nil
    ) {
        self.index = index
        self.kind = kind
        self.ok = ok
        self.message = message
        self.details = details
    }

    var dictionary: [String: Any] {
        var result: [String: Any] = [
            "index": index,
            "type": kind.rawValue,
            "ok": ok,
            "message": message,
        ]
        if let details, !details.isEmpty {
            result["driverEvidence"] = details
        }
        return result
    }
}

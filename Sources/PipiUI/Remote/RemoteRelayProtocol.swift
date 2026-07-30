import Foundation

enum RemoteRelayLimits {
    static let protocolVersion = 1
    static let maximumRequestFrameBytes = 256 * 1024
    static let maximumRequestBodyBytes = 256 * 1024
    static let maximumResponseFrameBytes = 8 * 1024 * 1024
    static let maximumOutstandingRequests = 16
    static let maximumDeadlineInterval: TimeInterval = 15
}

enum RemoteRelayCommand: String, Codable, CaseIterable, Sendable {
    case index
    case sessionCreate = "session.create"
    case sessionOpen = "session.open"
    case snapshot
    case promptSend = "prompt.send"
    case generationStop = "generation.stop"

    var isMutation: Bool {
        switch self {
        case .index, .snapshot:
            return false
        case .sessionCreate, .sessionOpen, .promptSend, .generationStop:
            return true
        }
    }

    static func localHTTPCommand(method: String, path: String) -> RemoteRelayCommand? {
        switch (method, path) {
        case ("GET", "/api/index"): .index
        case ("POST", "/api/sessions"): .sessionCreate
        case ("POST", "/api/sessions/open"): .sessionOpen
        case ("POST", "/api/snapshot"): .snapshot
        case ("POST", "/api/send"): .promptSend
        case ("POST", "/api/stop"): .generationStop
        default: nil
        }
    }
}

enum RemoteJSONValue: Codable, Equatable, Sendable {
    case object([String: RemoteJSONValue])
    case array([RemoteJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: RemoteJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([RemoteJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "unsupported JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    init(jsonObject: Any) throws {
        switch jsonObject {
        case let value as [String: Any]:
            self = .object(try value.mapValues(RemoteJSONValue.init(jsonObject:)))
        case let value as [Any]:
            self = .array(try value.map(RemoteJSONValue.init(jsonObject:)))
        case let value as String:
            self = .string(value)
        case let value as NSNumber:
            self = CFGetTypeID(value) == CFBooleanGetTypeID()
                ? .bool(value.boolValue)
                : .number(value.doubleValue)
        case _ as NSNull:
            self = .null
        default:
            throw RemoteRelayProtocolError.invalidBody
        }
    }

    func encodedData() throws -> Data {
        try JSONEncoder().encode(self)
    }
}

struct RemoteRelayHelloFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let deviceID: String
    let hostEpoch: String
    let clientVersion: String
    let displayName: String
}

struct RemoteRelayRequestFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let requestID: String
    let command: RemoteRelayCommand
    /// Unix epoch milliseconds.
    let deadlineMs: Int64
    let body: RemoteJSONValue
}

struct RemoteRelayResponseFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let requestID: String
    let hostEpoch: String
    let status: Int
    let body: RemoteJSONValue
}

struct RemoteRelayHeartbeatFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let at: Int64
}

enum RemoteRelayProtocolError: Error, Equatable {
    case oversized
    case invalidJSON
    case invalidEnvelope
    case protocolMismatch
    case invalidRequestID
    case invalidDeadline
    case invalidBody
}

enum RemoteRelayProtocol {
    static func decodeRequest(_ data: Data, now: Date = Date()) throws -> RemoteRelayRequestFrame {
        guard data.count <= RemoteRelayLimits.maximumRequestFrameBytes else {
            throw RemoteRelayProtocolError.oversized
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == ["v", "type", "requestID", "command", "deadlineMs", "body"]
        else {
            throw RemoteRelayProtocolError.invalidEnvelope
        }
        let frame: RemoteRelayRequestFrame
        do {
            frame = try JSONDecoder().decode(RemoteRelayRequestFrame.self, from: data)
        } catch {
            throw RemoteRelayProtocolError.invalidJSON
        }
        guard frame.v == RemoteRelayLimits.protocolVersion else {
            throw RemoteRelayProtocolError.protocolMismatch
        }
        guard frame.type == "request" else {
            throw RemoteRelayProtocolError.invalidEnvelope
        }
        guard UUID(uuidString: frame.requestID) != nil else {
            throw RemoteRelayProtocolError.invalidRequestID
        }
        let deadline = Date(timeIntervalSince1970: TimeInterval(frame.deadlineMs) / 1_000)
        guard deadline > now,
              deadline.timeIntervalSince(now) <= RemoteRelayLimits.maximumDeadlineInterval else {
            throw RemoteRelayProtocolError.invalidDeadline
        }
        guard (try? frame.body.encodedData().count) ?? Int.max
                <= RemoteRelayLimits.maximumRequestBodyBytes else {
            throw RemoteRelayProtocolError.oversized
        }
        return frame
    }
}

enum RemoteCommandSchema {
    static func validate(command: RemoteRelayCommand, body: Data) -> Bool {
        if command == .index {
            if body.isEmpty { return true }
            guard let object = try? JSONSerialization.jsonObject(with: body),
                  let dictionary = object as? [String: Any] else { return false }
            return dictionary.isEmpty
        }
        guard let object = try? JSONSerialization.jsonObject(with: body),
              let dictionary = object as? [String: Any] else { return false }
        switch command {
        case .index:
            return dictionary.isEmpty
        case .sessionCreate:
            return exactKeys(dictionary, ["projectID"])
                && nonemptyString(dictionary["projectID"], maximumBytes: 256)
        case .sessionOpen, .generationStop:
            return exactKeys(dictionary, ["sessionID"])
                && nonemptyString(dictionary["sessionID"], maximumBytes: 256)
        case .snapshot:
            guard Set(dictionary.keys).isSubset(of: ["sessionID", "revision"]),
                  dictionary.keys.contains("sessionID"),
                  nonemptyString(dictionary["sessionID"], maximumBytes: 256) else {
                return false
            }
            if let revision = dictionary["revision"] {
                guard let number = revision as? NSNumber,
                      number.doubleValue >= 0,
                      number.doubleValue.rounded(.towardZero) == number.doubleValue else {
                    return false
                }
            }
            return true
        case .promptSend:
            return exactKeys(dictionary, ["sessionID", "text", "commandID"])
                && nonemptyString(dictionary["sessionID"], maximumBytes: 256)
                && string(dictionary["text"], maximumBytes: 64 * 1024)
                && ((dictionary["commandID"] as? String).flatMap(UUID.init(uuidString:)) != nil)
        }
    }

    private static func exactKeys(_ dictionary: [String: Any], _ keys: Set<String>) -> Bool {
        Set(dictionary.keys) == keys
    }

    private static func nonemptyString(_ value: Any?, maximumBytes: Int) -> Bool {
        guard let value = value as? String, !value.isEmpty else { return false }
        return value.utf8.count <= maximumBytes
    }

    private static func string(_ value: Any?, maximumBytes: Int) -> Bool {
        guard let value = value as? String else { return false }
        return value.utf8.count <= maximumBytes
    }
}

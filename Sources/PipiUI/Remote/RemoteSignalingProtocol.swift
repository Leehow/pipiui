import Foundation

enum RemoteSignalingProtocolError: Error, Equatable {
    case oversized
    case invalidEnvelope
    case invalidChallenge
    case invalidResult
}

struct RemoteDeviceAuthChallenge: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let connectionID: String
    let nonce: String
    let audience: String
    let expiresAt: Int64
}

struct RemoteDeviceAuthProof: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let deviceID: String
    let publicKeyX963: String
    let fingerprint: String
    let connectionID: String
    let expiresAt: Int64
    let hostEpoch: String
    let clientVersion: String
    let displayName: String
    let signatureDER: String
}

struct RemoteDeviceAuthResult: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let enrollmentStatus: String
    let commandAuthorized: Bool
}

struct RemotePairCreateFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let pairID: String
    let deviceID: String
    let fingerprint: String
    let secretHash: String
    let expiresAt: Int64
    let signatureDER: String
}

struct RemotePairServerFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let pairID: String
    let expiresAt: Int64?
    let state: String?
}

struct RemotePairControlFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let pairID: String
    let deviceID: String
}

struct RemoteBindingRevokedFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let subject: String
    let deviceID: String
    let connectionIDs: [String]
}

enum RemoteSignalingProtocol {
    static let maximumFrameBytes = 256 * 1024
    static let maximumChallengeFutureSeconds: TimeInterval = 10

    static func decodeChallenge(
        _ data: Data,
        expectedAudience: String,
        now: Date = Date()
    ) throws -> RemoteDeviceAuthChallenge {
        let keys: Set<String> = [
            "v", "type", "connectionID", "nonce", "audience", "expiresAt",
        ]
        let frame: RemoteDeviceAuthChallenge = try decodeExact(data, keys: keys)
        guard frame.v == 1,
              frame.type == "auth.challenge",
              UUID(uuidString: frame.connectionID) != nil,
              base64URLData(frame.nonce)?.count == 32,
              frame.audience == expectedAudience,
              frame.expiresAt > milliseconds(now),
              frame.expiresAt <= milliseconds(
                  now.addingTimeInterval(maximumChallengeFutureSeconds)
              ) else {
            throw RemoteSignalingProtocolError.invalidChallenge
        }
        return frame
    }

    static func makeProof(
        challenge: RemoteDeviceAuthChallenge,
        identity: RemoteDeviceIdentity,
        hostEpoch: String,
        clientVersion: String,
        displayName: String
    ) throws -> RemoteDeviceAuthProof {
        let boundedClientVersion = try boundedUTF8(clientVersion, maximumBytes: 80)
        let boundedDisplayName = try boundedUTF8(displayName, maximumBytes: 80)
        let message = authTranscript(
            challenge: challenge,
            deviceID: identity.deviceID,
            hostEpoch: hostEpoch,
            fingerprint: identity.fingerprint
        )
        return RemoteDeviceAuthProof(
            v: 1,
            type: "auth.proof",
            deviceID: identity.deviceID,
            publicKeyX963: identity.publicKeyX963.base64URLEncodedString(),
            fingerprint: identity.fingerprint,
            connectionID: challenge.connectionID,
            expiresAt: challenge.expiresAt,
            hostEpoch: hostEpoch,
            clientVersion: boundedClientVersion,
            displayName: boundedDisplayName,
            signatureDER: try identity.sign(message).base64URLEncodedString()
        )
    }

    static func authTranscript(
        challenge: RemoteDeviceAuthChallenge,
        deviceID: String,
        hostEpoch: String,
        fingerprint: String
    ) -> Data {
        Data([
            "PIPIUI-DEVICE-AUTH-V1",
            challenge.audience,
            deviceID,
            challenge.nonce,
            challenge.connectionID,
            String(challenge.expiresAt),
            hostEpoch,
            fingerprint,
        ].joined(separator: "\n").utf8)
    }

    static func decodeAuthResult(_ data: Data) throws -> RemoteDeviceAuthResult {
        let frame: RemoteDeviceAuthResult = try decodeExact(
            data,
            keys: ["v", "type", "enrollmentStatus", "commandAuthorized"]
        )
        guard frame.v == 1,
              frame.type == "auth.result",
              ["pending", "active"].contains(frame.enrollmentStatus) else {
            throw RemoteSignalingProtocolError.invalidResult
        }
        return frame
    }

    static func decodePairServerFrame(_ data: Data) throws -> RemotePairServerFrame {
        guard data.count <= maximumFrameBytes,
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              dictionary["v"] as? Int == 1,
              let type = dictionary["type"] as? String,
              ["pair.created", "pair.claimed", "pair.rejected", "pair.status"]
                .contains(type),
              let pairID = dictionary["pairID"] as? String,
              UUID(uuidString: pairID) != nil else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        let allowed: Set<String>
        switch type {
        case "pair.created", "pair.claimed":
            allowed = ["v", "type", "pairID", "expiresAt"]
        case "pair.rejected":
            allowed = ["v", "type", "pairID"]
        default:
            allowed = ["v", "type", "pairID", "state", "expiresAt"]
        }
        guard Set(dictionary.keys) == allowed else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        return RemotePairServerFrame(
            v: 1,
            type: type,
            pairID: pairID.lowercased(),
            expiresAt: (dictionary["expiresAt"] as? NSNumber)?.int64Value,
            state: dictionary["state"] as? String
        )
    }

    static func decodeBindingRevoked(
        _ data: Data,
        expectedDeviceID: String
    ) throws -> RemoteBindingRevokedFrame {
        let frame: RemoteBindingRevokedFrame = try decodeExact(
            data,
            keys: ["v", "type", "subject", "deviceID", "connectionIDs"]
        )
        guard frame.v == 1,
              frame.type == "binding.revoked",
              frame.deviceID.lowercased() == expectedDeviceID.lowercased(),
              (1...1_024).contains(frame.subject.utf8.count),
              frame.connectionIDs.count <= 4_096,
              Set(frame.connectionIDs).count == frame.connectionIDs.count,
              frame.connectionIDs.allSatisfy({
                  UUID(uuidString: $0)?.uuidString.lowercased() == $0
              }) else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        return frame
    }

    private static func decodeExact<T: Decodable>(
        _ data: Data,
        keys: Set<String>
    ) throws -> T {
        guard data.count <= maximumFrameBytes else {
            throw RemoteSignalingProtocolError.oversized
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == keys,
              let value = try? JSONDecoder().decode(T.self, from: data) else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        return value
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }

    /// Truncates only at extended-grapheme boundaries while matching the
    /// Relay's byte-based UTF-8 limit.
    private static func boundedUTF8(
        _ value: String,
        maximumBytes: Int
    ) throws -> String {
        guard !value.contains("\r"),
              !value.contains("\n"),
              !value.contains("\0") else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        var result = ""
        var byteCount = 0
        for character in value {
            let bytes = String(character).utf8.count
            guard byteCount + bytes <= maximumBytes else { break }
            result.append(character)
            byteCount += bytes
        }
        guard !result.isEmpty else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        return result
    }

    private static func base64URLData(_ value: String) -> Data? {
        Data(base64URLEncoded: value)
    }
}

extension Data {
    init?(base64URLEncoded value: String) {
        guard !value.contains("="),
              value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            return nil
        }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        self.init(base64Encoded: value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

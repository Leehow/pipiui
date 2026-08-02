import Foundation
import Security

enum RemotePeerConnectionLimits {
    static let maximumSignalingFrameBytes = 256 * 1024
    static let maximumSDPBytes = 128 * 1024
    static let maximumCandidateBytes = 4 * 1024
    static let maximumCandidates = 64
    static let maximumChunkPayloadBytes = 64 * 1024
    static let maximumRequestBytes = 256 * 1024
    static let maximumResponseBytes = 8 * 1024 * 1024
    static let maximumInflightMessages = 16
    static let reassemblyLifetime: TimeInterval = 15
    static let activeLeaseMilliseconds: Int64 = 24 * 60 * 60 * 1_000

    static func activeLeaseExpiresAt(signalingExpiresAt: Int64) -> Int64? {
        let (value, overflow) = signalingExpiresAt.addingReportingOverflow(
            activeLeaseMilliseconds
        )
        return overflow ? nil : value
    }
}

struct RemotePeerConnectionOffer: Equatable, Sendable {
    let connectionID: String
    let deviceID: String
    let sequence: Int
    let expiresAt: Int64
    let browserNonce: String
    let offerSDP: String
    let offerFingerprint: String
}

struct RemotePeerICECandidate: Codable, Equatable, Sendable {
    let candidate: String
    let sdpMid: String
    let sdpMLineIndex: Int
}

enum RemotePeerIncomingSignal: Equatable, Sendable {
    case offer(RemotePeerConnectionOffer)
    case candidate(
        connectionID: String,
        deviceID: String,
        sequence: Int,
        expiresAt: Int64,
        candidate: RemotePeerICECandidate
    )
    case close(
        connectionID: String,
        deviceID: String,
        sequence: Int,
        expiresAt: Int64,
        reason: String
    )
}

struct RemotePeerAnswerMaterial: Equatable, Sendable {
    let connectionID: String
    let deviceID: String
    let expiresAt: Int64
    let browserNonce: String
    let hostNonce: String
    let hostEpoch: String
    let offerFingerprint: String
    let answerFingerprint: String
    let answerSDP: String
}

struct RemotePeerCandidateMaterial: Equatable, Sendable {
    let connectionID: String
    let deviceID: String
    let expiresAt: Int64
    let candidate: RemotePeerICECandidate
}

struct RemotePeerBindFrame: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let connectionID: String
    let deviceID: String
    let publicKeyX963: String
    let deviceFingerprint: String
    let hostEpoch: String
    let browserNonce: String
    let hostNonce: String
    let expiresAt: Int64
    let activeLeaseExpiresAt: Int64
    let offerFingerprint: String
    let answerFingerprint: String
    let signatureDER: String

    static func decodeExact(_ data: Data) throws -> RemotePeerBindFrame {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == [
                  "v", "type", "connectionID", "deviceID", "publicKeyX963",
                  "deviceFingerprint", "hostEpoch", "browserNonce", "hostNonce",
                  "expiresAt", "activeLeaseExpiresAt",
                  "offerFingerprint", "answerFingerprint",
                  "signatureDER",
              ],
              let frame = try? JSONDecoder().decode(Self.self, from: data),
              frame.v == 1,
              frame.type == "bind",
              UUID(uuidString: frame.connectionID) != nil,
              UUID(uuidString: frame.deviceID) != nil,
              UUID(uuidString: frame.hostEpoch) != nil,
              Data(base64URLEncoded: frame.publicKeyX963)?.count == 65,
              frame.deviceFingerprint.range(
                  of: #"^[0-9a-f]{64}$"#,
                  options: .regularExpression
              ) != nil,
              Data(base64URLEncoded: frame.browserNonce)?.count == 32,
              Data(base64URLEncoded: frame.hostNonce)?.count == 32,
              RemotePeerConnectionLimits.activeLeaseExpiresAt(
                  signalingExpiresAt: frame.expiresAt
              ) == frame.activeLeaseExpiresAt,
              canonicalFingerprint(frame.offerFingerprint)
                == frame.offerFingerprint,
              canonicalFingerprint(frame.answerFingerprint)
                == frame.answerFingerprint,
              let signature = Data(base64URLEncoded: frame.signatureDER),
              (64...80).contains(signature.count) else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        return frame
    }

    var answerMaterial: RemotePeerAnswerMaterial {
        RemotePeerAnswerMaterial(
            connectionID: connectionID,
            deviceID: deviceID,
            expiresAt: expiresAt,
            browserNonce: browserNonce,
            hostNonce: hostNonce,
            hostEpoch: hostEpoch,
            offerFingerprint: offerFingerprint,
            answerFingerprint: answerFingerprint,
            answerSDP: ""
        )
    }

    var transcript: Data {
        RemotePeerConnectionProtocol.bindingTranscript(
            material: answerMaterial,
            deviceFingerprint: deviceFingerprint
        )
    }

    func verifiesSignature() -> Bool {
        guard let publicKeyData = Data(base64URLEncoded: publicKeyX963),
              let signature = Data(base64URLEncoded: signatureDER),
              let key = SecKeyCreateWithData(
                  publicKeyData as CFData,
                  [
                      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                      kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
                      kSecAttrKeySizeInBits as String: 256,
                  ] as CFDictionary,
                  nil
              ) else { return false }
        return SecKeyVerifySignature(
            key,
            .ecdsaSignatureMessageX962SHA256,
            transcript as CFData,
            signature as CFData,
            nil
        )
    }

    private static func canonicalFingerprint(_ value: String) -> String? {
        RemotePeerConnectionProtocol.canonicalFingerprint(value)
    }
}

enum RemotePeerHostEvent: Equatable, Sendable {
    case answer(RemotePeerAnswerMaterial)
    case candidate(RemotePeerCandidateMaterial)
    case close(connectionID: String, deviceID: String, expiresAt: Int64, reason: String)
}

struct RemoteDeviceAnswerSignal: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let connectionID: String
    let deviceID: String
    let direction: String
    let sequence: Int
    let expiresAt: Int64
    let hostNonce: String
    let hostEpoch: String
    let offerFingerprint: String
    let answerFingerprint: String
    let answerSDP: String
    let signatureDER: String
}

struct RemoteDeviceCandidateSignal: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let connectionID: String
    let deviceID: String
    let direction: String
    let sequence: Int
    let expiresAt: Int64
    let candidate: String
    let sdpMid: String
    let sdpMLineIndex: Int
}

struct RemoteDeviceCloseSignal: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let connectionID: String
    let deviceID: String
    let direction: String
    let sequence: Int
    let expiresAt: Int64
    let reason: String
}

enum RemotePeerConnectionProtocol {
    static func decodeIncoming(
        _ data: Data,
        expectedDeviceID: String,
        now: Date = Date()
    ) throws -> RemotePeerIncomingSignal {
        guard data.count <= RemotePeerConnectionLimits.maximumSignalingFrameBytes,
              let object = try? JSONSerialization.jsonObject(with: data),
              let frame = object as? [String: Any],
              frame["v"] as? Int == 1,
              let type = frame["type"] as? String,
              let connectionID = frame["connectionID"] as? String,
              UUID(uuidString: connectionID) != nil,
              let deviceID = frame["deviceID"] as? String,
              deviceID.lowercased() == expectedDeviceID.lowercased(),
              frame["direction"] as? String == "browser-to-device",
              let sequence = strictInteger(frame["sequence"]),
              sequence >= 1,
              let expiresAt = strictInt64(frame["expiresAt"]),
              expiresAt > milliseconds(now),
              expiresAt <= milliseconds(now.addingTimeInterval(32)) else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        switch type {
        case "signal.offer":
            guard Set(frame.keys) == [
                "v", "type", "connectionID", "deviceID", "direction", "sequence",
                "expiresAt", "browserNonce", "offerSDP", "offerFingerprint",
            ],
                  sequence == 1,
                  let browserNonce = frame["browserNonce"] as? String,
                  Data(base64URLEncoded: browserNonce)?.count == 32,
                  let offerSDP = frame["offerSDP"] as? String,
                  (1...RemotePeerConnectionLimits.maximumSDPBytes)
                    .contains(offerSDP.utf8.count),
                  offerSDP.hasPrefix("v=0"),
                  let offerFingerprint = frame["offerFingerprint"] as? String,
                  canonicalFingerprint(offerFingerprint) == offerFingerprint,
                  sdpFingerprint(offerSDP) == offerFingerprint else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            return .offer(RemotePeerConnectionOffer(
                connectionID: connectionID.lowercased(),
                deviceID: deviceID.lowercased(),
                sequence: sequence,
                expiresAt: expiresAt,
                browserNonce: browserNonce,
                offerSDP: offerSDP,
                offerFingerprint: offerFingerprint
            ))

        case "signal.ice":
            guard Set(frame.keys) == [
                "v", "type", "connectionID", "deviceID", "direction", "sequence",
                "expiresAt", "candidate", "sdpMid", "sdpMLineIndex",
            ],
                  let candidate = frame["candidate"] as? String,
                  (1...RemotePeerConnectionLimits.maximumCandidateBytes)
                    .contains(candidate.utf8.count),
                  let sdpMid = frame["sdpMid"] as? String,
                  sdpMid.utf8.count <= 256,
                  let line = strictInteger(frame["sdpMLineIndex"]),
                  (0...65_535).contains(line) else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            return .candidate(
                connectionID: connectionID.lowercased(),
                deviceID: deviceID.lowercased(),
                sequence: sequence,
                expiresAt: expiresAt,
                candidate: RemotePeerICECandidate(
                    candidate: candidate,
                    sdpMid: sdpMid,
                    sdpMLineIndex: line
                )
            )

        case "signal.close":
            guard Set(frame.keys) == [
                "v", "type", "connectionID", "deviceID", "direction", "sequence",
                "expiresAt", "reason",
            ],
                  let reason = frame["reason"] as? String,
                  (1...256).contains(reason.utf8.count) else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            return .close(
                connectionID: connectionID.lowercased(),
                deviceID: deviceID.lowercased(),
                sequence: sequence,
                expiresAt: expiresAt,
                reason: reason
            )

        default:
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
    }

    static func sdpFingerprint(_ sdp: String) -> String? {
        var values: [String] = []
        let records = sdp.unicodeScalars.split(
            omittingEmptySubsequences: false
        ) { scalar in
            scalar.value == 0x0A || scalar.value == 0x0D
        }
        for record in records {
            let trimmed = trimSDPHorizontal(String(record))
            guard trimmed.lowercased().hasPrefix("a=fingerprint:") else {
                continue
            }
            guard let canonical = canonicalFingerprint(
                String(trimmed.dropFirst("a=fingerprint:".count))
            ) else { return nil }
            values.append(canonical)
        }
        guard let first = values.first,
              values.allSatisfy({ $0 == first }) else { return nil }
        return first
    }

    static func canonicalFingerprint(_ value: String) -> String? {
        let trimmed = trimSDPHorizontal(value)
        let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 2,
              parts[0].lowercased() == "sha-256" else { return nil }
        let bytes = parts[1].split(separator: ":", omittingEmptySubsequences: false)
        guard bytes.count == 32,
              bytes.allSatisfy({
                  $0.utf8.count == 2 && $0.utf8.allSatisfy { byte in
                      (48...57).contains(byte)
                          || (65...70).contains(byte)
                          || (97...102).contains(byte)
                  }
              }) else { return nil }
        return "sha-256 " + bytes.map { $0.uppercased() }.joined(separator: ":")
    }

    private static func trimSDPHorizontal(_ value: String) -> String {
        var lower = value.startIndex
        while lower < value.endIndex,
              value[lower] == " " || value[lower] == "\t" {
            lower = value.index(after: lower)
        }
        var upper = value.endIndex
        while upper > lower {
            let previous = value.index(before: upper)
            guard value[previous] == " " || value[previous] == "\t" else {
                break
            }
            upper = previous
        }
        return String(value[lower..<upper])
    }

    static func bindingTranscript(
        material: RemotePeerAnswerMaterial,
        deviceFingerprint: String
    ) -> Data {
        Data([
            "PIPIUI-REMOTE-BIND-V1",
            "1",
            material.connectionID,
            material.deviceID,
            deviceFingerprint,
            material.browserNonce,
            material.hostNonce,
            material.hostEpoch,
            String(material.expiresAt),
            String(
                RemotePeerConnectionLimits.activeLeaseExpiresAt(
                    signalingExpiresAt: material.expiresAt
                ) ?? 0
            ),
            material.offerFingerprint,
            material.answerFingerprint,
        ].joined(separator: "\n").utf8)
    }

    private static func strictInteger(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue == Double(number.intValue) else { return nil }
        return number.intValue
    }

    private static func strictInt64(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue == Double(number.int64Value) else { return nil }
        return number.int64Value
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }
}

struct RemotePeerChunkEnvelope: Codable, Equatable, Sendable {
    let v: Int
    let type: String
    let messageID: String
    let kind: String
    let chunkIndex: Int
    let chunkCount: Int
    let totalBytes: Int
    let expiresAt: Int64
    let payload: String

    static func decodeExact(
        _ data: Data,
        now: Date = Date()
    ) throws -> RemotePeerChunkEnvelope {
        guard data.count <= RemotePeerConnectionLimits.maximumChunkPayloadBytes * 2,
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == [
                "v", "type", "messageID", "kind", "chunkIndex", "chunkCount",
                "totalBytes", "expiresAt", "payload",
              ],
              let value = try? JSONDecoder().decode(
                  RemotePeerChunkEnvelope.self,
                  from: data
              ),
              value.v == 1,
              value.type == "chunk",
              UUID(uuidString: value.messageID) != nil,
              ["request", "response"].contains(value.kind),
              value.chunkCount > 0,
              value.chunkIndex >= 0,
              value.chunkIndex < value.chunkCount,
              value.totalBytes >= 0,
              value.expiresAt > milliseconds(now),
              value.expiresAt <= milliseconds(
                  now.addingTimeInterval(RemotePeerConnectionLimits.reassemblyLifetime)
              ),
              let decoded = Data(base64URLEncoded: value.payload),
              decoded.count <= RemotePeerConnectionLimits.maximumChunkPayloadBytes else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        let maximum = value.kind == "request"
            ? RemotePeerConnectionLimits.maximumRequestBytes
            : RemotePeerConnectionLimits.maximumResponseBytes
        guard value.totalBytes <= maximum,
              value.chunkCount <= max(1, (maximum + 65_535) / 65_536) else {
            throw RemoteSignalingProtocolError.oversized
        }
        return value
    }

    var decodedPayload: Data {
        Data(base64URLEncoded: payload) ?? Data()
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }
}

final class RemotePeerChunkReassembler {
    private struct Context {
        let kind: String
        let chunkCount: Int
        let totalBytes: Int
        let messageExpiresAt: Int64
        let expiresAt: Date
        var chunks: [Int: Data]
        var receivedBytes: Int
    }

    private var contexts: [String: Context] = [:]

    func accept(
        _ envelope: RemotePeerChunkEnvelope,
        expectedKind: String,
        now: Date = Date()
    ) throws -> Data? {
        collectExpired(now: now)
        guard envelope.kind == expectedKind else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        let payload = envelope.decodedPayload
        if var context = contexts[envelope.messageID] {
            guard context.kind == envelope.kind,
                  context.chunkCount == envelope.chunkCount,
                  context.totalBytes == envelope.totalBytes,
                  context.messageExpiresAt == envelope.expiresAt,
                  context.chunks[envelope.chunkIndex] == nil,
                  context.receivedBytes + payload.count <= context.totalBytes else {
                contexts.removeValue(forKey: envelope.messageID)
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            context.chunks[envelope.chunkIndex] = payload
            context.receivedBytes += payload.count
            contexts[envelope.messageID] = context
        } else {
            guard contexts.count < RemotePeerConnectionLimits.maximumInflightMessages,
                  payload.count <= envelope.totalBytes else {
                throw RemoteSignalingProtocolError.oversized
            }
            contexts[envelope.messageID] = Context(
                kind: envelope.kind,
                chunkCount: envelope.chunkCount,
                totalBytes: envelope.totalBytes,
                messageExpiresAt: envelope.expiresAt,
                expiresAt: min(
                    now.addingTimeInterval(
                        RemotePeerConnectionLimits.reassemblyLifetime
                    ),
                    Date(
                        timeIntervalSince1970:
                            TimeInterval(envelope.expiresAt) / 1_000
                    )
                ),
                chunks: [envelope.chunkIndex: payload],
                receivedBytes: payload.count
            )
        }
        guard let completed = contexts[envelope.messageID],
              completed.chunks.count == completed.chunkCount else { return nil }
        guard completed.receivedBytes == completed.totalBytes else {
            contexts.removeValue(forKey: envelope.messageID)
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        var data = Data()
        data.reserveCapacity(completed.totalBytes)
        for index in 0..<completed.chunkCount {
            guard let chunk = completed.chunks[index] else {
                contexts.removeValue(forKey: envelope.messageID)
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            data.append(chunk)
        }
        contexts.removeValue(forKey: envelope.messageID)
        return data
    }

    func removeAll() {
        contexts.removeAll()
    }

    @discardableResult
    func collectExpired(now: Date = Date()) -> Int {
        let expired = contexts.filter { $0.value.expiresAt <= now }.map(\.key)
        for key in expired { contexts.removeValue(forKey: key) }
        return expired.count
    }

    var count: Int { contexts.count }
}

enum RemotePeerChunker {
    static func envelopes(
        data: Data,
        kind: String,
        messageID: String = UUID().uuidString.lowercased(),
        expiresAt: Int64? = nil,
        now: Date = Date()
    ) throws -> [RemotePeerChunkEnvelope] {
        let maximum = kind == "request"
            ? RemotePeerConnectionLimits.maximumRequestBytes
            : RemotePeerConnectionLimits.maximumResponseBytes
        let resolvedExpiry: Int64
        if kind == "request" {
            if let request = try? RemoteRelayProtocol.decodeRequest(data, now: now) {
                guard expiresAt == nil || expiresAt == request.deadlineMs else {
                    throw RemoteSignalingProtocolError.invalidEnvelope
                }
                resolvedExpiry = request.deadlineMs
            } else if let expiresAt {
                resolvedExpiry = expiresAt
            } else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
        } else {
            resolvedExpiry = expiresAt ?? Int64(
                now.addingTimeInterval(RemotePeerConnectionLimits.reassemblyLifetime)
                    .timeIntervalSince1970 * 1_000
            )
        }
        let nowMilliseconds = Int64((now.timeIntervalSince1970 * 1_000).rounded(.down))
        let maximumExpiry = Int64(
            (now.addingTimeInterval(RemotePeerConnectionLimits.reassemblyLifetime)
                .timeIntervalSince1970 * 1_000).rounded(.down)
        )
        guard ["request", "response"].contains(kind),
              data.count <= maximum,
              UUID(uuidString: messageID) != nil,
              resolvedExpiry > nowMilliseconds,
              resolvedExpiry <= maximumExpiry else {
            throw RemoteSignalingProtocolError.oversized
        }
        let chunkSize = RemotePeerConnectionLimits.maximumChunkPayloadBytes
        let chunkCount = max(1, (data.count + chunkSize - 1) / chunkSize)
        return (0..<chunkCount).map { index in
            let lower = min(index * chunkSize, data.count)
            let upper = min(lower + chunkSize, data.count)
            return RemotePeerChunkEnvelope(
                v: 1,
                type: "chunk",
                messageID: messageID.lowercased(),
                kind: kind,
                chunkIndex: index,
                chunkCount: chunkCount,
                totalBytes: data.count,
                expiresAt: resolvedExpiry,
                payload: data.subdata(in: lower..<upper).base64URLEncodedString()
            )
        }
    }
}

final class RemotePeerCommandAdapter {
    private let controller: RemoteHostController
    private let hostEpoch: String
    private let reassembler = RemotePeerChunkReassembler()
    private var outstanding: Set<String> = []

    init(controller: RemoteHostController, hostEpoch: String) {
        self.controller = controller
        self.hostEpoch = hostEpoch
    }

    func receive(
        envelopeData: Data,
        now: Date = Date(),
        respond: @escaping (Result<[RemotePeerChunkEnvelope], Error>) -> Void
    ) {
        do {
            let envelope = try RemotePeerChunkEnvelope.decodeExact(
                envelopeData,
                now: now
            )
            guard let requestData = try reassembler.accept(
                envelope,
                expectedKind: "request",
                now: now
            ) else { return }
            let request = try RemoteRelayProtocol.decodeRequest(requestData, now: now)
            guard request.deadlineMs == envelope.expiresAt else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            let body = try request.body.encodedData()
            guard outstanding.count < RemotePeerConnectionLimits.maximumInflightMessages,
                  outstanding.insert(envelope.messageID).inserted else {
                throw RemoteSignalingProtocolError.oversized
            }
            controller.handle(RemoteCommandRequest(
                command: request.command,
                body: body,
                deadline: Date(
                    timeIntervalSince1970: TimeInterval(request.deadlineMs) / 1_000
                )
            )) { [weak self] response in
                guard let self,
                      self.outstanding.remove(envelope.messageID) != nil else { return }
                do {
                    let responseNow = Date()
                    let object = (try? JSONSerialization.jsonObject(with: response.body))
                        ?? NSNull()
                    let frame = RemoteRelayResponseFrame(
                        v: RemoteRelayLimits.protocolVersion,
                        type: "response",
                        requestID: request.requestID,
                        hostEpoch: self.hostEpoch,
                        status: response.status,
                        body: try RemoteJSONValue(jsonObject: object)
                    )
                    let encoded = try JSONEncoder().encode(frame)
                    respond(.success(try RemotePeerChunker.envelopes(
                        data: encoded,
                        kind: "response",
                        messageID: envelope.messageID,
                        now: responseNow
                    )))
                } catch {
                    respond(.failure(error))
                }
            }
        } catch {
            respond(.failure(error))
        }
    }

    func reset() {
        reassembler.removeAll()
        outstanding.removeAll()
    }
}

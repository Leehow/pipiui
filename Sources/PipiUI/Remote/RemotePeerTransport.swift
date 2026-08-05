import Foundation

enum RemotePeerTransportState: Equatable {
    case disabled
    case loading
    case ready
    case negotiating
    case channelOpen
    case echoVerified
    case recovering
    case failed(String)

    var displayText: String {
        switch self {
        case .disabled:
            return "已关闭"
        case .loading:
            return "正在载入 WKWebView host…"
        case .ready:
            return "WKWebView host 已就绪，等待 Chrome"
        case .negotiating:
            return "正在协商 WebRTC DataChannel…"
        case .channelOpen:
            return "DataChannel 已打开，等待 echo 往返验证…"
        case .echoVerified:
            return "WKWebView echo 往返已验证"
        case .recovering:
            return "WebContent 已终止，正在重建…"
        case .failed(let message):
            return "实验失败：\(message)"
        }
    }
}

enum RemotePeerProductionState: Equatable, Sendable {
    case disabled
    case ready
    case negotiating
    case connected
    case reconnecting(attempt: Int, delaySeconds: Int)
    case closed(String)
    case failed(String)

    var displayText: String {
        switch self {
        case .disabled: "远程隧道已关闭"
        case .ready: "浏览器尚未连接"
        case .negotiating: "正在等待浏览器连接服务器隧道…"
        case .connected: "服务器隧道已连接"
        case .reconnecting(let attempt, let delaySeconds):
            "服务器隧道断开，\(delaySeconds) 秒后第 \(attempt) 次重连…"
        case .closed(let reason): "服务器隧道已断开：\(reason)"
        case .failed(let reason): "服务器隧道失败：\(reason)"
        }
    }
}

enum RemotePeerLimits {
    static let protocolVersion = 1
    static let maximumSDPBytes = 128 * 1024
    static let maximumEchoBytes = 64 * 1024
    static let maximumErrorBytes = 512
    static let sessionLifetime: TimeInterval = 30
    static let maximumFutureSkew: TimeInterval = 2
    static let negotiationTimeout: TimeInterval = 10
}

enum RemotePeerProtocolVersion {
    static func isExact(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return false
        }
        let numeric = number.doubleValue
        return numeric.isFinite
            && numeric == Double(RemotePeerLimits.protocolVersion)
            && numeric.rounded(.towardZero) == numeric
    }
}

struct RemotePeerTestSession: Equatable, Codable {
    let v: Int
    let sessionID: String
    let generation: String
    let expiresAtMilliseconds: Int64

    var expirationDate: Date {
        Date(timeIntervalSince1970: TimeInterval(expiresAtMilliseconds) / 1_000)
    }
}

struct RemotePeerOffer: Equatable {
    let sessionID: String
    let generation: String
    let expiresAtMilliseconds: Int64
    let sdp: String

    static func decodeExact(_ data: Data) throws -> RemotePeerOffer {
        guard data.count <= LocalRemoteRequestLimits.maximumBodyBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == [
                "v",
                "sessionID",
                "generation",
                "expiresAtMilliseconds",
                "sdp",
              ],
              RemotePeerProtocolVersion.isExact(object["v"]),
              let sessionID = object["sessionID"] as? String,
              let generation = object["generation"] as? String,
              let expiresAt = object["expiresAtMilliseconds"] as? NSNumber,
              CFGetTypeID(expiresAt) != CFBooleanGetTypeID(),
              expiresAt.doubleValue == Double(expiresAt.int64Value),
              let sdp = object["sdp"] as? String else {
            throw RemotePeerTransportError.invalidRequest("invalid offer schema")
        }
        guard Self.isOpaqueIdentifier(sessionID),
              Self.isOpaqueIdentifier(generation),
              (1...RemotePeerLimits.maximumSDPBytes).contains(sdp.utf8.count),
              sdp.hasPrefix("v=0") else {
            throw RemotePeerTransportError.invalidRequest("invalid offer values")
        }
        return RemotePeerOffer(
            sessionID: sessionID,
            generation: generation,
            expiresAtMilliseconds: expiresAt.int64Value,
            sdp: sdp
        )
    }

    func validate(
        session: RemotePeerTestSession,
        now: Date
    ) throws {
        guard sessionID == session.sessionID,
              generation == session.generation,
              expiresAtMilliseconds == session.expiresAtMilliseconds else {
            throw RemotePeerTransportError.staleSession
        }
        let expiration = Date(
            timeIntervalSince1970: TimeInterval(expiresAtMilliseconds) / 1_000
        )
        guard expiration > now,
              expiration.timeIntervalSince(now)
                <= RemotePeerLimits.sessionLifetime + RemotePeerLimits.maximumFutureSkew else {
            throw RemotePeerTransportError.expiredSession
        }
    }

    static func isOpaqueIdentifier(_ value: String) -> Bool {
        guard (16...128).contains(value.utf8.count) else { return false }
        let allowed = CharacterSet(
            charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        )
        return value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}

struct RemotePeerAnswer: Equatable, Codable {
    let v: Int
    let sessionID: String
    let generation: String
    let sdp: String
}

enum RemotePeerTransportError: Error, Equatable {
    case notReady
    case invalidRequest(String)
    case staleSession
    case expiredSession
    case answerUnavailable
    case resourceUnavailable
    case javaScriptFailure(String)

    var httpStatus: Int {
        switch self {
        case .notReady:
            return 503
        case .invalidRequest:
            return 422
        case .staleSession, .expiredSession:
            return 409
        case .answerUnavailable:
            return 204
        case .resourceUnavailable, .javaScriptFailure:
            return 500
        }
    }

    var safeMessage: String {
        switch self {
        case .notReady:
            return "WKWebView host is not ready"
        case .invalidRequest(let message):
            return message
        case .staleSession:
            return "stale peer session"
        case .expiredSession:
            return "peer session expired"
        case .answerUnavailable:
            return "answer is not ready"
        case .resourceUnavailable:
            return "bundled peer resources are unavailable"
        case .javaScriptFailure:
            return "WKWebView host rejected the offer"
        }
    }
}

protocol RemotePeerTransport: AnyObject {
    var state: RemotePeerTransportState { get }
    var generation: String { get }

    func start()
    func stop()
    func makeTestSession(now: Date) throws -> RemotePeerTestSession
    func accept(offer: RemotePeerOffer, now: Date) throws
    func answer(
        sessionID: String,
        generation: String,
        now: Date
    ) throws -> RemotePeerAnswer
}

/// Production WebRTC signaling surface. The Relay client owns ordering,
/// authentication, signing, and socket-generation checks; this transport owns
/// only the retained WKWebView peer and its bound DataChannel.
protocol RemotePeerSignalingTransport: AnyObject {
    func acceptConnection(
        offer: RemotePeerConnectionOffer,
        hostEpoch: String,
        controller: RemoteHostController,
        emit: @escaping (RemotePeerHostEvent) -> Void
    ) throws
    func addRemoteCandidate(
        connectionID: String,
        candidate: RemotePeerICECandidate
    ) throws
    func installBinding(
        _ frame: RemotePeerBindFrame
    ) throws
    func closeConnection(connectionID: String, reason: String)
}

enum RemotePeerQuery {
    static func exactAnswerLookup(
        requestTarget: String
    ) -> (sessionID: String, generation: String)? {
        guard let queryStart = requestTarget.firstIndex(of: "?"),
              String(requestTarget[..<queryStart]) == "/p2p-test/answer" else {
            return nil
        }
        let query = String(requestTarget[requestTarget.index(after: queryStart)...])
        let components = query.split(separator: "&", omittingEmptySubsequences: false)
        guard components.count == 2 else { return nil }
        var values: [String: String] = [:]
        for component in components {
            let pair = component.split(
                separator: "=",
                maxSplits: 1,
                omittingEmptySubsequences: false
            )
            guard pair.count == 2,
                  let key = String(pair[0]).removingPercentEncoding,
                  let value = String(pair[1]).removingPercentEncoding,
                  values[key] == nil else {
                return nil
            }
            values[key] = value
        }
        guard Set(values.keys) == ["sessionID", "generation"],
              let sessionID = values["sessionID"],
              let generation = values["generation"],
              RemotePeerOffer.isOpaqueIdentifier(sessionID),
              RemotePeerOffer.isOpaqueIdentifier(generation) else {
            return nil
        }
        return (sessionID, generation)
    }
}

enum RemotePeerLoopbackSDP {
    static func normalizeMDNSHostCandidates(_ sdp: String) -> String {
        sdp.components(separatedBy: "\r\n")
            .map { line in
                guard line.hasPrefix("a=candidate:") else { return line }
                var fields = line.split(
                    separator: " ",
                    omittingEmptySubsequences: true
                ).map(String.init)
                guard fields.count >= 8,
                      fields[4].lowercased().hasSuffix(".local") else {
                    return line
                }
                fields[4] = "127.0.0.1"
                return fields.joined(separator: " ")
            }
            .joined(separator: "\r\n")
    }
}

enum RemotePeerBrowserPage {
    static func render(token: String, nonce: String) throws -> Data {
        guard let htmlURL = RemotePeerResources.fileURL(
                  name: "browser",
                  extension: "html"
              ),
              let scriptURL = RemotePeerResources.fileURL(
                  name: "browser",
                  extension: "js"
              ),
              let html = try? String(
                  contentsOf: htmlURL,
                  encoding: .utf8
              ),
              let script = try? String(
                  contentsOf: scriptURL,
                  encoding: .utf8
              ) else {
            throw RemotePeerTransportError.resourceUnavailable
        }
        return Data(
            html
                .replacingOccurrences(of: "__NONCE__", with: nonce)
                .replacingOccurrences(of: "__TOKEN__", with: token)
                .replacingOccurrences(
                    of: "__TOKEN_HEADER__",
                    with: LocalRemoteWebPage.tokenHeader
                )
                .replacingOccurrences(of: "__BUNDLED_SCRIPT__", with: script)
                .utf8
        )
    }
}

enum RemotePeerResources {
    static func fileURL(name: String, extension fileExtension: String) -> URL? {
        let bundle = PipiResourceBundle.shared
        return bundle.url(
            forResource: name,
            withExtension: fileExtension,
            subdirectory: "Resources/RemoteP2P"
        ) ?? directoryURL()?.appendingPathComponent("\(name).\(fileExtension)")
    }

    static func directoryURL() -> URL? {
        let bundle = PipiResourceBundle.shared
        if let directory = bundle.url(
            forResource: "RemoteP2P",
            withExtension: nil,
            subdirectory: "Resources"
        ) {
            return directory
        }
        let candidate = bundle.bundleURL
            .appendingPathComponent("Resources/RemoteP2P", isDirectory: true)
        return FileManager.default.fileExists(atPath: candidate.path)
            ? candidate
            : nil
    }
}

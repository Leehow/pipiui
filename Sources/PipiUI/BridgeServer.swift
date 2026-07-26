import Foundation
import Network
import Security

enum BridgeCapabilityToken {
    static func generate(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: max(16, byteCount))
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess {
            return bytes.map { String(format: "%02x", $0) }.joined()
        }
        // UUID randomness is a fail-safe fallback; two UUIDs still provide a
        // high-entropy per-session capability and are never written to logs.
        return UUID().uuidString.replacingOccurrences(of: "-", with: "")
            + UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    /// Constant-time equality for request capabilities of equal byte length.
    static func matches(_ candidate: String, expected: String) -> Bool {
        let lhs = Array(candidate.utf8)
        let rhs = Array(expected.utf8)
        guard !lhs.isEmpty, lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for index in lhs.indices {
            difference |= lhs[index] ^ rhs[index]
        }
        return difference == 0
    }
}

enum BridgeRequestLimits {
    static let maximumHeaderBytes = 64 * 1024
    static let maximumBodyBytes = 2 * 1024 * 1024
    static let requestTimeout: TimeInterval = 40

    static func acceptsContentLength(_ length: Int) -> Bool {
        length >= 0 && length <= maximumBodyBytes
    }
}

/// Minimal HTTP/1.1 JSON server on 127.0.0.1 used by the pi webview extension
/// to drive the in-app WKWebView. Single endpoint: POST /rpc with a JSON body.
final class BridgeServer {
    /// Handler is invoked on the main thread; call `respond` exactly once (any thread).
    typealias Handler = (_ request: J, _ respond: @escaping ([String: Any]) -> Void) -> Void

    private var listener: NWListener?
    private let handler: Handler
    private let authorize: ((J) -> Bool)?
    private let queue = DispatchQueue(label: "pipiui.bridge")
    private(set) var port: UInt16 = 0

    init?(
        authorize: ((J) -> Bool)? = nil,
        handler: @escaping Handler
    ) {
        self.handler = handler
        self.authorize = authorize
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        guard let listener = try? NWListener(using: params) else { return nil }
        self.listener = listener

        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { [weak self] state in
            if case .ready = state {
                self?.port = listener.port?.rawValue ?? 0
                ready.signal()
            } else if case .failed = state {
                ready.signal()
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.serve(connection)
        }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 3)
        if port == 0 { return nil }
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + BridgeRequestLimits.requestTimeout) {
            connection.cancel()
        }
        readRequest(connection, buffer: Data())
    }

    private func readRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
            [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if error != nil {
                connection.cancel()
                return
            }
            switch Self.parseRequestBody(buffer) {
            case .complete(let request):
                self.process(request, connection)
            case .invalid(let message):
                self.reply(connection, ["ok": false, "error": message])
            case .incomplete where isComplete:
                connection.cancel()
            case .incomplete:
                self.readRequest(connection, buffer: buffer)
            }
        }
    }

    enum RequestParse {
        case incomplete
        case complete(Data)
        case invalid(String)
    }

    /// Returns a bounded POST /rpc body once headers + Content-Length have arrived.
    static func parseRequestBody(_ buffer: Data) -> RequestParse {
        if buffer.count > BridgeRequestLimits.maximumHeaderBytes
            + BridgeRequestLimits.maximumBodyBytes {
            return .invalid("bridge request exceeds size limit")
        }
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            if buffer.count > BridgeRequestLimits.maximumHeaderBytes {
                return .invalid("bridge request headers exceed size limit")
            }
            return .incomplete
        }
        guard headerEnd.lowerBound <= BridgeRequestLimits.maximumHeaderBytes else {
            return .invalid("bridge request headers exceed size limit")
        }
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        guard let headers = String(data: headerData, encoding: .utf8) else {
            return .invalid("invalid HTTP headers")
        }
        let lines = headers.components(separatedBy: "\r\n")
        let requestLine = lines.first?.split(separator: " ") ?? []
        guard requestLine.count == 3,
              requestLine[0] == "POST",
              requestLine[1] == "/rpc",
              requestLine[2].hasPrefix("HTTP/1.") else {
            return .invalid("bridge accepts only POST /rpc")
        }
        var contentLength: Int?
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].lowercased() == "content-length" {
                guard contentLength == nil else {
                    return .invalid("duplicate Content-Length")
                }
                contentLength = Int(parts[1].trimmingCharacters(in: .whitespaces))
            }
        }
        guard let contentLength,
              BridgeRequestLimits.acceptsContentLength(contentLength) else {
            return .invalid("missing or invalid Content-Length")
        }
        let body = buffer.suffix(from: headerEnd.upperBound)
        guard body.count >= contentLength else { return .incomplete }
        return .complete(Data(body.prefix(contentLength)))
    }

    private func process(_ body: Data, _ connection: NWConnection) {
        guard let json = J.parse(body), json.dict != nil else {
            reply(connection, ["ok": false, "error": "invalid JSON body"])
            return
        }
        DispatchQueue.main.async { [authorize, handler] in
            if let authorize, !authorize(json) {
                self.queue.async {
                    self.reply(
                        connection,
                        ["ok": false, "error": "unauthorized bridge capability"]
                    )
                }
                return
            }
            handler(json) { [weak self] response in
                self?.queue.async {
                    self?.reply(connection, response)
                }
            }
        }
    }

    private func reply(_ connection: NWConnection, _ object: [String: Any]) {
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        var response = Data("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    func stop() {
        listener?.cancel()
    }
}

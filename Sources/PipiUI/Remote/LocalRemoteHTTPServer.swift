import Foundation
import Network

enum LocalRemoteRequestLimits {
    static let maximumHeaderBytes = 32 * 1024
    static let maximumBodyBytes = 256 * 1024
    static let requestTimeout: TimeInterval = 15
}

struct LocalRemoteHTTPRequest: Equatable, Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

struct LocalRemoteHTTPResponse: Sendable {
    let status: Int
    let contentType: String
    let headers: [String: String]
    let body: Data

    static func json(status: Int = 200, _ value: Any) -> LocalRemoteHTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
            ?? Data(#"{"error":"response encoding failed"}"#.utf8)
        return LocalRemoteHTTPResponse(
            status: status,
            contentType: "application/json; charset=utf-8",
            headers: [:],
            body: data
        )
    }

    static func empty(status: Int) -> LocalRemoteHTTPResponse {
        LocalRemoteHTTPResponse(
            status: status,
            contentType: "application/octet-stream",
            headers: [:],
            body: Data()
        )
    }
}

enum LocalRemoteHTTPRequestParser {
    enum Result {
        case incomplete
        case complete(LocalRemoteHTTPRequest)
        case invalid(status: Int, message: String)
    }

    static func parse(_ buffer: Data) -> Result {
        if buffer.count > LocalRemoteRequestLimits.maximumHeaderBytes
            + LocalRemoteRequestLimits.maximumBodyBytes {
            return .invalid(status: 413, message: "request exceeds size limit")
        }
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            return buffer.count > LocalRemoteRequestLimits.maximumHeaderBytes
                ? .invalid(status: 431, message: "request headers exceed size limit")
                : .incomplete
        }
        guard headerEnd.lowerBound <= LocalRemoteRequestLimits.maximumHeaderBytes else {
            return .invalid(status: 431, message: "request headers exceed size limit")
        }
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return .invalid(status: 400, message: "invalid HTTP headers")
        }
        let lines = headerText.components(separatedBy: "\r\n")
        let requestLine = lines.first?.split(separator: " ", omittingEmptySubsequences: true) ?? []
        guard requestLine.count == 3,
              requestLine[2].hasPrefix("HTTP/1.") else {
            return .invalid(status: 400, message: "invalid request line")
        }
        let method = String(requestLine[0])
        guard method == "GET" || method == "POST" else {
            return .invalid(status: 405, message: "method not allowed")
        }
        let path = String(requestLine[1])
        guard path.hasPrefix("/"), !path.contains("#") else {
            return .invalid(status: 400, message: "invalid request target")
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else {
                return .invalid(status: 400, message: "invalid HTTP header")
            }
            let name = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, headers[name] == nil else {
                return .invalid(status: 400, message: "duplicate or empty HTTP header")
            }
            headers[name] = value
        }
        if headers["transfer-encoding"] != nil {
            return .invalid(status: 400, message: "transfer encoding is not supported")
        }
        let bodyStart = headerEnd.upperBound
        let receivedBody = buffer.suffix(from: bodyStart)
        let contentLength: Int
        if let rawLength = headers["content-length"] {
            guard let parsed = Int(rawLength),
                  parsed >= 0,
                  parsed <= LocalRemoteRequestLimits.maximumBodyBytes else {
                return .invalid(status: 413, message: "invalid Content-Length")
            }
            contentLength = parsed
        } else if method == "POST" {
            return .invalid(status: 411, message: "Content-Length required")
        } else {
            contentLength = 0
        }
        guard receivedBody.count >= contentLength else { return .incomplete }
        guard receivedBody.count == contentLength else {
            return .invalid(status: 400, message: "unexpected bytes after request body")
        }
        return .complete(LocalRemoteHTTPRequest(
            method: method,
            path: path,
            headers: headers,
            body: Data(receivedBody)
        ))
    }
}

enum LocalRemoteRequestPolicy {
    static func authorizationError(
        for request: LocalRemoteHTTPRequest,
        expectedToken: String,
        port: UInt16
    ) -> LocalRemoteHTTPResponse? {
        let expectedHost = "127.0.0.1:\(port)"
        guard request.headers["host"] == expectedHost else {
            return .json(status: 400, ["error": "invalid Host"])
        }
        if let origin = request.headers["origin"],
           origin != "http://\(expectedHost)" {
            return .json(status: 403, ["error": "cross-origin request denied"])
        }
        // The initial document request cannot carry a custom browser header.
        // Every API request requires the independent per-launch token.
        if request.path != "/" {
            let candidate = request.headers[LocalRemoteWebPage.tokenHeader.lowercased()] ?? ""
            guard BridgeCapabilityToken.matches(candidate, expected: expectedToken) else {
                return .json(status: 401, ["error": "unauthorized"])
            }
        }
        if request.method == "POST" {
            let contentType = request.headers["content-type"]?
                .split(separator: ";", maxSplits: 1)
                .first?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            guard contentType == "application/json" else {
                return .json(status: 415, ["error": "application/json required"])
            }
        }
        return nil
    }
}

enum LocalRemoteRoutes {
    static let methodsByPath: [String: String] = [
        "/": "GET",
        "/api/index": "GET",
        "/api/sessions": "POST",
        "/api/sessions/open": "POST",
        "/api/snapshot": "POST",
        "/api/send": "POST",
        "/api/stop": "POST",
    ]

    static func rejection(for request: LocalRemoteHTTPRequest) -> LocalRemoteHTTPResponse? {
        guard let method = methodsByPath[request.path] else {
            return .json(status: 404, ["error": "route not found"])
        }
        guard request.method == method else {
            return .json(status: 405, ["error": "method not allowed"])
        }
        return nil
    }
}

/// Separate loopback-only HTTP service for the local remote-web test. This does
/// not reuse or mutate BridgeServer and accepts one bounded request per connection.
final class LocalRemoteHTTPServer {
    typealias Handler = (LocalRemoteHTTPRequest, @escaping (LocalRemoteHTTPResponse) -> Void) -> Void

    private let queue = DispatchQueue(label: "pipiui.local-remote-http")
    private var listener: NWListener?
    private var activeConnections: [ObjectIdentifier: NWConnection] = [:]
    private let handler: Handler
    private let onReady: (UInt16) -> Void
    private let onFailure: (String) -> Void
    private(set) var port: UInt16 = 0

    init?(
        handler: @escaping Handler,
        onReady: @escaping (UInt16) -> Void,
        onFailure: @escaping (String) -> Void
    ) {
        self.handler = handler
        self.onReady = onReady
        self.onFailure = onFailure
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        guard let listener = try? NWListener(using: parameters) else { return nil }
        self.listener = listener
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard let self else { return }
            switch state {
            case .ready:
                let port = listener?.port?.rawValue ?? 0
                guard port != 0 else {
                    self.onFailure("listener became ready without a port")
                    return
                }
                self.port = port
                self.onReady(port)
            case .failed(let error):
                self.onFailure(error.localizedDescription)
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.serve(connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        listener = nil
        queue.async { [weak self] in
            guard let self else { return }
            for connection in self.activeConnections.values {
                connection.cancel()
            }
            self.activeConnections.removeAll()
            self.port = 0
        }
    }

    private func serve(_ connection: NWConnection) {
        let identifier = ObjectIdentifier(connection)
        activeConnections[identifier] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self, let connection else { return }
            if case .failed = state {
                self.finish(connection)
            } else if case .cancelled = state {
                self.finish(connection)
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + LocalRemoteRequestLimits.requestTimeout) {
            [weak self, weak connection] in
            guard let self, let connection,
                  self.activeConnections[ObjectIdentifier(connection)] != nil else { return }
            connection.cancel()
        }
        read(connection, buffer: Data())
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
            [weak self, weak connection] data, _, isComplete, error in
            guard let self, let connection else { return }
            var next = buffer
            if let data { next.append(data) }
            if error != nil {
                connection.cancel()
                return
            }
            switch LocalRemoteHTTPRequestParser.parse(next) {
            case .incomplete where isComplete:
                self.send(
                    .json(status: 400, ["error": "incomplete request"]),
                    to: connection
                )
            case .incomplete:
                self.read(connection, buffer: next)
            case .invalid(let status, let message):
                self.send(.json(status: status, ["error": message]), to: connection)
            case .complete(let request):
                self.handler(request) { [weak self, weak connection] response in
                    guard let self, let connection else { return }
                    self.queue.async {
                        guard self.activeConnections[ObjectIdentifier(connection)] != nil else {
                            return
                        }
                        self.send(response, to: connection)
                    }
                }
            }
        }
    }

    private func send(_ response: LocalRemoteHTTPResponse, to connection: NWConnection) {
        let reason: String
        switch response.status {
        case 200: reason = "OK"
        case 201: reason = "Created"
        case 202: reason = "Accepted"
        case 204: reason = "No Content"
        case 304: reason = "Not Modified"
        case 400: reason = "Bad Request"
        case 401: reason = "Unauthorized"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 405: reason = "Method Not Allowed"
        case 409: reason = "Conflict"
        case 411: reason = "Length Required"
        case 413: reason = "Payload Too Large"
        case 415: reason = "Unsupported Media Type"
        case 422: reason = "Unprocessable Content"
        case 431: reason = "Request Header Fields Too Large"
        default: reason = "Internal Server Error"
        }
        var headers = response.headers
        headers["Content-Type"] = response.contentType
        headers["Content-Length"] = String(response.body.count)
        headers["Connection"] = "close"
        headers["Cache-Control"] = "no-store"
        headers["X-Content-Type-Options"] = "nosniff"
        let headerLines = headers
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { "\($0.key): \($0.value)" }
            .joined(separator: "\r\n")
        let head = "HTTP/1.1 \(response.status) \(reason)\r\n\(headerLines)\r\n\r\n"
        var payload = Data(head.utf8)
        payload.append(response.body)
        connection.send(content: payload, completion: .contentProcessed { [weak self, weak connection] _ in
            guard let self, let connection else { return }
            connection.cancel()
            self.queue.async { self.finish(connection) }
        })
    }

    private func finish(_ connection: NWConnection) {
        activeConnections.removeValue(forKey: ObjectIdentifier(connection))
    }
}

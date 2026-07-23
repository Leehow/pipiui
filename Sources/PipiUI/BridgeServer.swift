import Foundation
import Network

/// Minimal HTTP/1.1 JSON server on 127.0.0.1 used by the pi webview extension
/// to drive the in-app WKWebView. Single endpoint: POST /rpc with a JSON body.
final class BridgeServer {
    /// Handler is invoked on the main thread; call `respond` exactly once (any thread).
    typealias Handler = (_ request: J, _ respond: @escaping ([String: Any]) -> Void) -> Void

    private var listener: NWListener?
    private let handler: Handler
    private let queue = DispatchQueue(label: "pipiui.bridge")
    private(set) var port: UInt16 = 0

    init?(handler: @escaping Handler) {
        self.handler = handler
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
        readRequest(connection, buffer: Data())
    }

    private func readRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if error != nil {
                connection.cancel()
                return
            }
            if let request = Self.completeRequestBody(buffer) {
                self.process(request, connection)
            } else if isComplete {
                connection.cancel()
            } else if buffer.count > 8 << 20 {
                connection.cancel()
            } else {
                self.readRequest(connection, buffer: buffer)
            }
        }
    }

    /// Returns the body once headers + full Content-Length body have arrived.
    private static func completeRequestBody(_ buffer: Data) -> Data? {
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        guard let headers = String(data: headerData, encoding: .utf8) else { return nil }
        var contentLength = 0
        for line in headers.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].lowercased() == "content-length" {
                contentLength = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        let body = buffer.suffix(from: headerEnd.upperBound)
        guard body.count >= contentLength else { return nil }
        return body.prefix(contentLength)
    }

    private func process(_ body: Data, _ connection: NWConnection) {
        guard let json = J.parse(body), json.dict != nil else {
            reply(connection, ["ok": false, "error": "invalid JSON body"])
            return
        }
        DispatchQueue.main.async { [handler] in
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

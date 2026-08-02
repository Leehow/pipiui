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

final class BridgeRequestLifecycle: @unchecked Sendable {
    private enum State {
        case active
        case completed
        case cancelled
    }

    private let lock = NSLock()
    private var state: State = .active
    private var cancellation: (() -> Void)?

    @discardableResult
    func registerCancellation(_ callback: @escaping () -> Void) -> Bool {
        let result = lock.withLock { () -> (registered: Bool, call: Bool) in
            switch state {
            case .active:
                cancellation = callback
                return (true, false)
            case .cancelled:
                return (false, true)
            case .completed:
                return (false, false)
            }
        }
        if result.call { callback() }
        return result.registered
    }

    func complete() -> Bool {
        lock.withLock {
            guard case .active = state else { return false }
            state = .completed
            cancellation = nil
            return true
        }
    }

    @discardableResult
    func cancel() -> Bool {
        let callback: (() -> Void)? = lock.withLock {
            guard case .active = state else { return nil }
            state = .cancelled
            let callback = cancellation
            cancellation = nil
            return callback
        }
        callback?()
        return callback != nil
    }
}

/// Small FIFO with bounded pops. The head offset avoids shifting the full request burst
/// for every main-thread yield; processed storage is compacted only amortized.
struct BridgeFIFOBuffer<Element> {
    private var storage: [Element] = []
    private var head = 0

    var count: Int { storage.count - head }
    var isEmpty: Bool { count == 0 }

    mutating func append(_ element: Element) {
        storage.append(element)
    }

    mutating func popFirst(maxCount: Int) -> [Element] {
        guard maxCount > 0, head < storage.count else { return [] }
        let end = min(storage.count, head + maxCount)
        let chunk = Array(storage[head..<end])
        head = end
        if head == storage.count {
            storage.removeAll(keepingCapacity: true)
            head = 0
        } else if head >= 4_096, head * 2 >= storage.count {
            storage.removeFirst(head)
            head = 0
        }
        return chunk
    }
}

/// Minimal HTTP/1.1 JSON server on 127.0.0.1 used by app-owned pi extensions.
/// Single endpoint: POST /rpc with a bounded JSON body.
final class BridgeServer {
    /// Handler is invoked on the main thread; call `respond` exactly once (any thread).
    typealias CancellationRegistrar = (@escaping () -> Void) -> Bool
    typealias Handler = (
        _ request: J,
        _ respond: @escaping ([String: Any]) -> Void,
        _ registerCancellation: @escaping CancellationRegistrar
    ) -> Void

    private var listener: NWListener?
    private let handler: Handler
    private let authorize: ((J) -> Bool)?
    private let queue = DispatchQueue(label: "pipiui.bridge")
    private var activeConnections: [
        ObjectIdentifier: (NWConnection, BridgeRequestLifecycle)
    ] = [:]
    /// Requests arrive on `queue`. Main-queue drains process bounded FIFO chunks so
    /// high-fanout telemetry neither enqueues one block per socket nor monopolizes main.
    private struct PendingMainRequest {
        let json: J
        let connection: NWConnection
        let lifecycle: BridgeRequestLifecycle
    }
    private var pendingMainRequests = BridgeFIFOBuffer<PendingMainRequest>()
    private var mainDrainScheduled = false
    static let maximumMainRequestsPerDrain = 256
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
        let lifecycle = BridgeRequestLifecycle()
        let identifier = ObjectIdentifier(connection)
        activeConnections[identifier] = (connection, lifecycle)
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self, let connection else { return }
            switch state {
            case .failed, .cancelled:
                lifecycle.cancel()
                self.queue.async {
                    self.activeConnections.removeValue(
                        forKey: ObjectIdentifier(connection)
                    )
                }
            default:
                break
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + BridgeRequestLimits.requestTimeout) {
            lifecycle.cancel()
            connection.cancel()
        }
        readRequest(connection, lifecycle: lifecycle, buffer: Data())
    }

    private func readRequest(
        _ connection: NWConnection,
        lifecycle: BridgeRequestLifecycle,
        buffer: Data
    ) {
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
                self.process(request, connection, lifecycle: lifecycle)
            case .invalid(let message):
                self.reply(
                    connection,
                    lifecycle: lifecycle,
                    ["ok": false, "error": message]
                )
            case .incomplete where isComplete:
                connection.cancel()
            case .incomplete:
                self.readRequest(
                    connection,
                    lifecycle: lifecycle,
                    buffer: buffer
                )
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

    private func process(
        _ body: Data,
        _ connection: NWConnection,
        lifecycle: BridgeRequestLifecycle
    ) {
        guard let json = J.parse(body), json.dict != nil else {
            reply(
                connection,
                lifecycle: lifecycle,
                ["ok": false, "error": "invalid JSON body"]
            )
            return
        }
        pendingMainRequests.append(PendingMainRequest(
            json: json,
            connection: connection,
            lifecycle: lifecycle
        ))
        guard !mainDrainScheduled else { return }
        mainDrainScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.drainPendingRequestsOnMain()
        }
    }

    /// Main-thread isolation is retained for authorization and session routing. Each
    /// invocation handles one bounded FIFO chunk, then yields before scheduling the next.
    private func drainPendingRequestsOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        let (batch, hasMore): ([PendingMainRequest], Bool) = queue.sync {
            let batch = pendingMainRequests.popFirst(
                maxCount: Self.maximumMainRequestsPerDrain
            )
            let hasMore = !pendingMainRequests.isEmpty
            if !hasMore { mainDrainScheduled = false }
            return (batch, hasMore)
        }
        for pending in batch {
            let json = pending.json
            let connection = pending.connection
            let lifecycle = pending.lifecycle
            if let authorize, !authorize(json) {
                self.queue.async {
                    let action = json["action"].string ?? ""
                    let response: [String: Any] =
                        ComputerRuntimeContract.operations.contains(action)
                        ? ComputerRuntimeContract.failure(
                            code: "unauthorized_session_capability",
                            message: "unauthorized bridge capability",
                            retryable: false,
                            requiresObservation: false
                        )
                        : ["ok": false, "error": "unauthorized bridge capability"]
                    self.reply(
                        connection,
                        lifecycle: lifecycle,
                        response
                    )
                }
                continue
            }
            handler(
                json,
                { [weak self] response in
                    self?.queue.async {
                        self?.reply(
                            connection,
                            lifecycle: lifecycle,
                            response
                        )
                    }
                },
                { cancellation in
                    lifecycle.registerCancellation(cancellation)
                }
            )
        }
        if hasMore {
            DispatchQueue.main.async { [weak self] in
                self?.drainPendingRequestsOnMain()
            }
        }
    }

    private func reply(
        _ connection: NWConnection,
        lifecycle: BridgeRequestLifecycle,
        _ object: [String: Any]
    ) {
        guard lifecycle.complete() else { return }
        activeConnections.removeValue(forKey: ObjectIdentifier(connection))
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        var response = Data("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    func stop() {
        listener?.cancel()
        queue.async { [weak self] in
            guard let self else { return }
            let active = self.activeConnections.values
            self.activeConnections.removeAll()
            for (connection, lifecycle) in active {
                lifecycle.cancel()
                connection.cancel()
            }
        }
    }
}

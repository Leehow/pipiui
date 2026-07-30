import Foundation

enum RemoteRelayConnectionState: Equatable, Sendable {
    case disabled
    case connecting
    case connected
    case retrying(seconds: Int)
    case authenticationFailed
    case invalidConfiguration
    case protocolMismatch

    var displayText: String {
        switch self {
        case .disabled: "已关闭"
        case .connecting: "正在连接 Relay…"
        case .connected: "Relay 已连接"
        case .retrying(let seconds): "连接中断，\(seconds) 秒后重试"
        case .authenticationFailed: "认证失败或 Keychain 凭据不完整"
        case .invalidConfiguration: "Relay 地址无效或主机名不一致"
        case .protocolMismatch: "Relay 协议版本不兼容"
        }
    }
}

struct RemoteRelayCredentials: Equatable, Sendable {
    let accessClientID: String
    let accessClientSecret: String
    let deviceSecret: String
}

protocol RemoteRelayWebSocketTask: AnyObject, Sendable {
    func resume()
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
    func send(
        _ message: URLSessionWebSocketTask.Message,
        completionHandler: @escaping @Sendable (Error?) -> Void
    )
    func receive(
        completionHandler: @escaping @Sendable (
            Result<URLSessionWebSocketTask.Message, Error>
        ) -> Void
    )
    func sendPing(pongReceiveHandler: @escaping @Sendable (Error?) -> Void)
}

extension URLSessionWebSocketTask: RemoteRelayWebSocketTask {}

/// All socket ownership and retry state is confined to lifecycleQueue. Every
/// asynchronous callback carries both task identity and connection generation,
/// so a delayed callback from an old task cannot tear down its replacement.
final class RemoteRelayClient: @unchecked Sendable {
    typealias TaskFactory = (URLRequest) -> any RemoteRelayWebSocketTask
    typealias CredentialsProvider = () -> RemoteRelayCredentials?
    typealias RetryScheduler = (DispatchWorkItem, TimeInterval) -> Void

    private let controller: RemoteHostController
    private let configuration: RemoteRelayConfiguration
    private let stateChanged: (RemoteRelayConnectionState) -> Void
    private let taskFactory: TaskFactory
    private let credentialsProvider: CredentialsProvider
    private let configurationValidator: (RemoteRelayConfiguration) -> Bool
    private let retryDelayProvider: (Int) -> Int
    private let retryScheduler: RetryScheduler
    private let lifecycleQueue: DispatchQueue
    private let hostEpoch = UUID().uuidString.lowercased()

    // lifecycleQueue-owned state.
    private var socket: (any RemoteRelayWebSocketTask)?
    private var socketGeneration: UInt64 = 0
    private var nextGeneration: UInt64 = 0
    private var retryWorkItem: DispatchWorkItem?
    private var heartbeatTimer: DispatchSourceTimer?
    private var retryAttempt = 0
    private var inFlight: Set<String> = []
    private var stopped = true

    init(
        controller: RemoteHostController,
        configuration: RemoteRelayConfiguration,
        session: URLSession = .shared,
        lifecycleQueue: DispatchQueue = DispatchQueue(
            label: "com.pipiui.remote-relay.lifecycle"
        ),
        taskFactory: TaskFactory? = nil,
        credentialsProvider: CredentialsProvider? = nil,
        configurationValidator: ((RemoteRelayConfiguration) -> Bool)? = nil,
        retryDelayProvider: @escaping (Int) -> Int = { attempt in
            let cap = min(30, 1 << min(attempt, 5))
            return Int.random(in: 1...max(1, cap))
        },
        retryScheduler: RetryScheduler? = nil,
        stateChanged: @escaping (RemoteRelayConnectionState) -> Void
    ) {
        self.controller = controller
        self.configuration = configuration
        self.lifecycleQueue = lifecycleQueue
        self.taskFactory = taskFactory ?? { session.webSocketTask(with: $0) }
        self.credentialsProvider = credentialsProvider ?? {
            guard let accessClientID = RemoteRelayCredentialStore.read(.accessClientID),
                  let accessClientSecret = RemoteRelayCredentialStore.read(.accessClientSecret),
                  let deviceSecret = RemoteRelayCredentialStore.read(.deviceSecret) else {
                return nil
            }
            return RemoteRelayCredentials(
                accessClientID: accessClientID,
                accessClientSecret: accessClientSecret,
                deviceSecret: deviceSecret
            )
        }
        self.configurationValidator = configurationValidator ?? { configuration in
            RemoteRelaySettings.validatedURLPair(
                webSocketURL: configuration.webSocketURL,
                publicURL: configuration.publicURL
            ) != nil
        }
        self.retryDelayProvider = retryDelayProvider
        self.retryScheduler = retryScheduler ?? { item, delay in
            lifecycleQueue.asyncAfter(deadline: .now() + delay, execute: item)
        }
        self.stateChanged = stateChanged
    }

    func start() {
        lifecycleQueue.async { [self] in
            self.stopped = false
            self.retryAttempt = 0
            self.connectLocked()
        }
    }

    func stop() {
        lifecycleQueue.async { [self] in
            self.stopLocked(publishDisabled: true)
        }
    }

    private func connectLocked() {
        dispatchPrecondition(condition: .onQueue(lifecycleQueue))
        guard !stopped else { return }
        retryWorkItem?.cancel()
        retryWorkItem = nil
        guard configurationValidator(configuration) else {
            publish(.invalidConfiguration)
            return
        }
        guard let credentials = credentialsProvider() else {
            publish(.authenticationFailed)
            return
        }

        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        inFlight.removeAll()

        nextGeneration &+= 1
        let generation = nextGeneration
        var request = URLRequest(url: configuration.webSocketURL)
        request.timeoutInterval = 15
        request.setValue(credentials.accessClientID, forHTTPHeaderField: "CF-Access-Client-Id")
        request.setValue(
            credentials.accessClientSecret,
            forHTTPHeaderField: "CF-Access-Client-Secret"
        )
        request.setValue(configuration.deviceID, forHTTPHeaderField: "X-PipiUI-Device-ID")
        request.setValue(credentials.deviceSecret, forHTTPHeaderField: "X-PipiUI-Device-Secret")
        let task = taskFactory(request)
        socket = task
        socketGeneration = generation
        publish(.connecting)
        task.resume()
        sendHelloLocked(task: task, generation: generation)
    }

    private func sendHelloLocked(
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        let frame = RemoteRelayHelloFrame(
            v: RemoteRelayLimits.protocolVersion,
            type: "hello",
            deviceID: configuration.deviceID,
            hostEpoch: hostEpoch,
            clientVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                ?? "development",
            displayName: configuration.displayName
        )
        sendLocked(frame, task: task, generation: generation) { [weak self] error in
            guard let self else { return }
            if error != nil {
                self.disconnectLocked(task: task, generation: generation)
                return
            }
            guard self.owns(task, generation: generation) else { return }
            self.retryAttempt = 0
            self.publish(.connected)
            self.startHeartbeatLocked(task: task, generation: generation)
            self.receiveNextLocked(task: task, generation: generation)
        }
    }

    private func receiveNextLocked(
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        guard owns(task, generation: generation) else { return }
        task.receive { [weak self, weak task] result in
            guard let self, let task else { return }
            self.lifecycleQueue.async {
                guard self.owns(task, generation: generation) else { return }
                switch result {
                case .failure:
                    self.disconnectLocked(task: task, generation: generation)
                case .success(let message):
                    self.handleLocked(message, task: task, generation: generation)
                    self.receiveNextLocked(task: task, generation: generation)
                }
            }
        }
    }

    private func handleLocked(
        _ message: URLSessionWebSocketTask.Message,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        guard owns(task, generation: generation) else { return }
        guard case .string(let value) = message else {
            publish(.protocolMismatch)
            stopLocked(publishDisabled: false)
            return
        }
        let data = Data(value.utf8)
        if let heartbeat = try? JSONDecoder().decode(RemoteRelayHeartbeatFrame.self, from: data),
           heartbeat.v == RemoteRelayLimits.protocolVersion,
           heartbeat.type == "ping" {
            sendLocked(RemoteRelayHeartbeatFrame(
                v: RemoteRelayLimits.protocolVersion,
                type: "pong",
                at: heartbeat.at
            ), task: task, generation: generation)
            return
        }

        let request: RemoteRelayRequestFrame
        do {
            request = try RemoteRelayProtocol.decodeRequest(data)
        } catch RemoteRelayProtocolError.protocolMismatch {
            publish(.protocolMismatch)
            stopLocked(publishDisabled: false)
            return
        } catch {
            sendProtocolErrorLocked(
                for: data,
                status: 422,
                task: task,
                generation: generation
            )
            return
        }
        guard inFlight.count < RemoteRelayLimits.maximumOutstandingRequests else {
            sendResponseLocked(
                requestID: request.requestID,
                status: 429,
                body: ["error": "too many outstanding requests"],
                task: task,
                generation: generation
            )
            return
        }
        inFlight.insert(request.requestID)
        let deadline = Date(timeIntervalSince1970: TimeInterval(request.deadlineMs) / 1_000)
        let body = (try? request.body.encodedData()) ?? Data("{}".utf8)
        DispatchQueue.main.async { [weak self, weak task] in
            guard let self, let task else { return }
            self.controller.handle(RemoteCommandRequest(
                command: request.command,
                body: body,
                deadline: deadline
            )) { response in
                self.lifecycleQueue.async {
                    guard self.owns(task, generation: generation),
                          self.inFlight.remove(request.requestID) != nil else {
                        return
                    }
                    let object = (try? JSONSerialization.jsonObject(with: response.body))
                        ?? NSNull()
                    let relayBody = (try? RemoteJSONValue(jsonObject: object)) ?? .null
                    let frame = RemoteRelayResponseFrame(
                        v: RemoteRelayLimits.protocolVersion,
                        type: "response",
                        requestID: request.requestID,
                        hostEpoch: self.hostEpoch,
                        status: response.status,
                        body: relayBody
                    )
                    guard let data = try? JSONEncoder().encode(frame),
                          data.count <= RemoteRelayLimits.maximumResponseFrameBytes else {
                        self.sendResponseLocked(
                            requestID: request.requestID,
                            status: 507,
                            body: ["error": "response exceeds relay limit"],
                            task: task,
                            generation: generation
                        )
                        return
                    }
                    self.sendEncodedTextLocked(
                        data,
                        task: task,
                        generation: generation
                    )
                }
            }
        }
    }

    private func sendResponseLocked(
        requestID: String,
        status: Int,
        body: [String: Any],
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        let object = (try? RemoteJSONValue(jsonObject: body)) ?? .null
        sendLocked(RemoteRelayResponseFrame(
            v: RemoteRelayLimits.protocolVersion,
            type: "response",
            requestID: requestID,
            hostEpoch: hostEpoch,
            status: status,
            body: object
        ), task: task, generation: generation)
    }

    private func sendProtocolErrorLocked(
        for data: Data,
        status: Int,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let requestID = object["requestID"] as? String,
              UUID(uuidString: requestID) != nil else {
            return
        }
        sendResponseLocked(
            requestID: requestID,
            status: status,
            body: ["error": "invalid request"],
            task: task,
            generation: generation
        )
    }

    private func startHeartbeatLocked(
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        heartbeatTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: lifecycleQueue)
        timer.schedule(deadline: .now() + 20, repeating: 20)
        timer.setEventHandler { [weak self, weak task] in
            guard let self, let task, self.owns(task, generation: generation) else { return }
            task.sendPing { [weak self, weak task] error in
                guard let self, let task else { return }
                self.lifecycleQueue.async {
                    guard self.owns(task, generation: generation) else { return }
                    if error != nil {
                        self.disconnectLocked(task: task, generation: generation)
                    }
                }
            }
        }
        heartbeatTimer = timer
        timer.resume()
    }

    private func disconnectLocked(
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        guard !stopped, owns(task, generation: generation) else { return }
        task.cancel(with: .goingAway, reason: nil)
        socket = nil
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        inFlight.removeAll()
        retryWorkItem?.cancel()
        retryWorkItem = nil

        let delay = max(0, retryDelayProvider(retryAttempt))
        retryAttempt += 1
        publish(.retrying(seconds: delay))
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.stopped, self.socket == nil else { return }
            self.retryWorkItem = nil
            self.connectLocked()
        }
        retryWorkItem = item
        retryScheduler(item, TimeInterval(delay))
    }

    private func stopLocked(publishDisabled: Bool) {
        stopped = true
        retryWorkItem?.cancel()
        retryWorkItem = nil
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        nextGeneration &+= 1
        socketGeneration = nextGeneration
        inFlight.removeAll()
        if publishDisabled {
            publish(.disabled)
        }
    }

    private func sendLocked<T: Encodable>(
        _ value: T,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64,
        completion: ((Error?) -> Void)? = nil
    ) {
        guard owns(task, generation: generation),
              let data = try? JSONEncoder().encode(value) else {
            completion?(RemoteRelayProtocolError.invalidBody)
            return
        }
        sendEncodedTextLocked(
            data,
            task: task,
            generation: generation,
            completion: completion
        )
    }

    private func sendEncodedTextLocked(
        _ data: Data,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64,
        completion: ((Error?) -> Void)? = nil
    ) {
        guard owns(task, generation: generation),
              let text = String(data: data, encoding: .utf8) else {
            completion?(RemoteRelayProtocolError.invalidBody)
            return
        }
        task.send(.string(text)) { [weak self, weak task] error in
            guard let self, let task else { return }
            self.lifecycleQueue.async {
                guard self.owns(task, generation: generation) else { return }
                completion?(error)
                if error != nil, completion == nil {
                    self.disconnectLocked(task: task, generation: generation)
                }
            }
        }
    }

    private func owns(
        _ task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) -> Bool {
        guard let socket else { return false }
        return socketGeneration == generation
            && ObjectIdentifier(socket) == ObjectIdentifier(task)
    }

    private func publish(_ state: RemoteRelayConnectionState) {
        DispatchQueue.main.async { [stateChanged] in stateChanged(state) }
    }
}

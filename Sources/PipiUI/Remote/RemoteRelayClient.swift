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
        case .connecting: "正在连接服务器隧道…"
        case .connected: "服务器隧道已连接"
        case .retrying(let seconds): "连接中断，\(seconds) 秒后重试"
        case .authenticationFailed: "设备身份认证失败"
        case .invalidConfiguration: "远程地址无效或主机名不一致"
        case .protocolMismatch: "Signaling 协议版本不兼容"
        }
    }
}

struct RemoteRelayCredentials: Equatable, Sendable {
    let accessClientID: String
    let accessClientSecret: String
    let deviceSecret: String
}

struct RemotePairingPresentation: Equatable, Sendable {
    let url: URL
    let pairID: String
    let fingerprint: String
    let expiresAt: Date
}

enum RemotePairingLifecycleEvent: Equatable, Sendable {
    case created(RemotePairingPresentation)
    case claimed
    case cancelled
    case invalidated
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
    typealias IdentityProvider = () -> RemoteDeviceIdentity?
    typealias RetryScheduler = (DispatchWorkItem, TimeInterval) -> Void

    private let controller: RemoteHostController
    private let peerTransport: (any RemotePeerSignalingTransport)?
    private let configuration: RemoteRelayConfiguration
    private let stateChanged: (RemoteRelayConnectionState) -> Void
    private let pairingChanged: (RemotePairingLifecycleEvent) -> Void
    private let taskFactory: TaskFactory
    private let credentialsProvider: CredentialsProvider
    private let identityProvider: IdentityProvider
    private let usesLegacyAuthentication: Bool
    private let configurationValidator: (RemoteRelayConfiguration) -> Bool
    private let retryDelayProvider: (Int) -> Int
    private let retryScheduler: RetryScheduler
    private let lifecycleQueue: DispatchQueue
    private let hostEpoch = UUID().uuidString.lowercased()
    private var usesTunnel: Bool {
        configuration.webSocketURL.path == "/tunnel/ws"
    }
    private var tunnelPairID: String?

    // lifecycleQueue-owned state.
    private var socket: (any RemoteRelayWebSocketTask)?
    private var socketGeneration: UInt64 = 0
    private var nextGeneration: UInt64 = 0
    private var retryWorkItem: DispatchWorkItem?
    private var heartbeatTimer: DispatchSourceTimer?
    private var retryAttempt = 0
    private var inFlight: Set<String> = []
    private var stopped = true
    private var identity: RemoteDeviceIdentity?
    private var deviceProofSent = false
    private var deviceAuthenticated = false
    private var commandAuthorized = false
    private var pairingSession: RemotePairingSession?
    private var pairingCompletion: ((Result<URL, Error>) -> Void)?
    private struct ActivePeerConnection {
        let offer: RemotePeerConnectionOffer
        var lastBrowserSequence: Int
        var nextDeviceSequence: Int
        var browserCandidates: Int
        var deviceCandidates: Int
    }
    private var activePeerConnection: ActivePeerConnection?

    init(
        controller: RemoteHostController,
        configuration: RemoteRelayConfiguration,
        peerTransport: (any RemotePeerSignalingTransport)? = nil,
        session: URLSession = .shared,
        lifecycleQueue: DispatchQueue = DispatchQueue(
            label: "com.pipiui.remote-relay.lifecycle"
        ),
        taskFactory: TaskFactory? = nil,
        credentialsProvider: CredentialsProvider? = nil,
        identityProvider: IdentityProvider? = nil,
        configurationValidator: ((RemoteRelayConfiguration) -> Bool)? = nil,
        retryDelayProvider: @escaping (Int) -> Int = { attempt in
            let cap = min(30, 1 << min(attempt, 5))
            return Int.random(in: 1...max(1, cap))
        },
        retryScheduler: RetryScheduler? = nil,
        pairingChanged: @escaping (RemotePairingLifecycleEvent) -> Void = { _ in },
        stateChanged: @escaping (RemoteRelayConnectionState) -> Void
    ) {
        self.controller = controller
        self.peerTransport = peerTransport
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
        self.identityProvider = identityProvider ?? {
            try? SecurityRemoteDeviceIdentityStore.shared.loadOrCreate()
        }
        usesLegacyAuthentication = configuration.webSocketURL.path == "/host/ws"
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
        self.pairingChanged = pairingChanged
    }

    func start() {
        lifecycleQueue.async { [self] in
            self.stopped = false
            self.retryAttempt = 0
            if self.usesTunnel {
                guard self.configurationValidator(self.configuration),
                      self.peerTransport is WebKitRemotePeerTransport else {
                    self.publish(.invalidConfiguration)
                    return
                }
                self.publish(.connecting)
                return
            }
            self.connectLocked()
        }
    }

    func stop() {
        lifecycleQueue.async { [self] in
            if self.usesTunnel {
                self.tunnelPairID = nil
                DispatchQueue.main.async {
                    (self.peerTransport as? WebKitRemotePeerTransport)?
                        .stopTunnelLink()
                }
            }
            self.stopLocked(publishDisabled: true)
        }
    }

    func beginPairing(
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        lifecycleQueue.async { [self] in
            if self.usesTunnel {
                guard let transport = self.peerTransport as? WebKitRemotePeerTransport,
                      self.configurationValidator(self.configuration) else {
                    completion(.failure(RemotePairingError.invalidated))
                    self.pairingChanged(.invalidated)
                    return
                }
                let pairID = UUID().uuidString.lowercased()
                let password = BridgeCapabilityToken.generate(byteCount: 32)
                var components = URLComponents(
                    url: self.configuration.publicURL
                        .appendingPathComponent("pair")
                        .appendingPathComponent(pairID),
                    resolvingAgainstBaseURL: false
                )
                components?.fragment = password
                guard let url = components?.url else {
                    completion(.failure(RemotePairingError.invalidated))
                    self.pairingChanged(.invalidated)
                    return
                }
                self.tunnelPairID = pairID
                let expiresAt = Date().addingTimeInterval(30 * 60)
                DispatchQueue.main.async {
                    transport.startTunnelLink(
                        roomID: pairID,
                        secret: password,
                        tunnelURL: self.configuration.webSocketURL,
                        controller: self.controller
                    ) { [weak self] event in
                        guard let self else { return }
                        self.lifecycleQueue.async {
                            guard self.tunnelPairID == pairID else { return }
                            switch event {
                            case .ready:
                                self.publish(.connected)
                            case .accepted:
                                self.pairingChanged(.claimed)
                            case .failed:
                                self.pairingChanged(.invalidated)
                            case .closed:
                                break
                            }
                        }
                    }
                }
                let presentation = RemotePairingPresentation(
                    url: url,
                    pairID: pairID,
                    fingerprint: String(password.prefix(12)),
                    expiresAt: expiresAt
                )
                self.pairingChanged(.created(presentation))
                completion(.success(url))
                return
            }
            guard !usesLegacyAuthentication,
                  deviceAuthenticated,
                  let identity,
                  let socket,
                  let session = try? RemotePairingSession(identity: identity),
                  let frame = try? session.createFrame(identity: identity),
                  let url = try? session.claimURL(publicURL: configuration.publicURL) else {
                completion(.failure(RemotePairingError.invalidated))
                pairingChanged(.invalidated)
                return
            }
            pairingSession?.invalidate()
            pairingCompletion?(.failure(RemotePairingError.invalidated))
            pairingSession = session
            pairingCompletion = completion
            pendingPairURL = url
            let pairID = session.pairID
            sendLocked(frame, task: socket, generation: socketGeneration) { [weak self] error in
                guard let self else { return }
                guard self.pairingSession?.pairID == pairID else { return }
                if let error {
                    self.pairingSession?.invalidate()
                    self.pairingSession = nil
                    self.pendingPairURL = nil
                    let activeCompletion = self.pairingCompletion
                    self.pairingCompletion = nil
                    activeCompletion?(.failure(error))
                    self.pairingChanged(.invalidated)
                    return
                }
                self.publish(.connecting)
            }
        }
    }

    func cancelPairing() {
        lifecycleQueue.async { [self] in
            if self.usesTunnel {
                guard self.tunnelPairID != nil else { return }
                self.tunnelPairID = nil
                DispatchQueue.main.async {
                    (self.peerTransport as? WebKitRemotePeerTransport)?
                        .stopTunnelLink()
                }
                self.pairingChanged(.cancelled)
                return
            }
            guard let session = pairingSession else { return }
            if let socket {
                sendLocked(
                    RemotePairControlFrame(
                        v: 1,
                        type: "pair.revoke",
                        pairID: session.pairID,
                        deviceID: session.deviceID
                    ),
                    task: socket,
                    generation: socketGeneration
                )
            }
            session.invalidate()
            pairingSession = nil
            pendingPairURL = nil
            pairingCompletion?(.failure(RemotePairingError.invalidated))
            pairingCompletion = nil
            pairingChanged(.cancelled)
            publish(.connecting)
        }
    }

    // lifecycleQueue-owned; retained separately so a URL is never published
    // before the Relay confirms the hash-only pair transaction.
    private var pendingPairURL: URL?

    private func connectLocked() {
        dispatchPrecondition(condition: .onQueue(lifecycleQueue))
        guard !stopped else { return }
        retryWorkItem?.cancel()
        retryWorkItem = nil
        guard configurationValidator(configuration) else {
            publish(.invalidConfiguration)
            return
        }
        let credentials: RemoteRelayCredentials?
        if usesLegacyAuthentication {
            credentials = credentialsProvider()
            guard credentials != nil else {
                publish(.authenticationFailed)
                return
            }
            identity = nil
        } else {
            credentials = nil
            guard let loadedIdentity = identityProvider() else {
                publish(.authenticationFailed)
                return
            }
            identity = loadedIdentity
        }

        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        resetPeerLocked(reason: "Relay connection replaced")
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        inFlight.removeAll()
        deviceProofSent = false
        deviceAuthenticated = false
        commandAuthorized = false
        let replacedPairing = pairingSession != nil
        pairingSession?.invalidate()
        pairingSession = nil
        pendingPairURL = nil
        pairingCompletion?(.failure(RemotePairingError.invalidated))
        pairingCompletion = nil
        if replacedPairing {
            pairingChanged(.invalidated)
        }

        nextGeneration &+= 1
        let generation = nextGeneration
        var request = URLRequest(url: configuration.webSocketURL)
        request.timeoutInterval = 15
        if let credentials {
            request.setValue(
                credentials.accessClientID,
                forHTTPHeaderField: "CF-Access-Client-Id"
            )
            request.setValue(
                credentials.accessClientSecret,
                forHTTPHeaderField: "CF-Access-Client-Secret"
            )
            request.setValue(configuration.deviceID, forHTTPHeaderField: "X-PipiUI-Device-ID")
            request.setValue(
                credentials.deviceSecret,
                forHTTPHeaderField: "X-PipiUI-Device-Secret"
            )
        }
        let task = taskFactory(request)
        socket = task
        socketGeneration = generation
        publish(.connecting)
        task.resume()
        if usesLegacyAuthentication {
            sendHelloLocked(task: task, generation: generation)
        } else {
            receiveNextLocked(task: task, generation: generation)
        }
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
        if !usesLegacyAuthentication, !deviceAuthenticated {
            if !deviceProofSent,
               let identity,
               let challenge = try? RemoteSignalingProtocol.decodeChallenge(
                   data,
                   expectedAudience: RemoteRelaySettings.signalingAudience(
                       configuration.webSocketURL
                   ) ?? configuration.webSocketURL.absoluteString
               ),
               let proof = try? RemoteSignalingProtocol.makeProof(
                   challenge: challenge,
                   identity: identity,
                   hostEpoch: hostEpoch,
                   clientVersion: Bundle.main.infoDictionary?[
                       "CFBundleShortVersionString"
                   ] as? String ?? "development",
                   displayName: configuration.displayName
               ) {
                deviceProofSent = true
                sendLocked(proof, task: task, generation: generation)
                return
            }
            if deviceProofSent,
               let result = try? RemoteSignalingProtocol.decodeAuthResult(data) {
                deviceAuthenticated = true
                commandAuthorized = result.commandAuthorized
                retryAttempt = 0
                publish(result.commandAuthorized ? .connected : .connecting)
                startHeartbeatLocked(task: task, generation: generation)
                return
            }
            publish(.authenticationFailed)
            stopLocked(publishDisabled: false)
            return
        }
        if !usesLegacyAuthentication,
           let pair = try? RemoteSignalingProtocol.decodePairServerFrame(data),
           let session = pairingSession,
           pair.pairID == session.pairID {
            switch pair.type {
            case "pair.created":
                let expectedExpiry = Int64(
                    (session.expiresAt.timeIntervalSince1970 * 1_000).rounded(.down)
                )
                if let confirmedExpiry = pair.expiresAt,
                   confirmedExpiry == expectedExpiry,
                   let url = pendingPairURL {
                    pairingCompletion?(.success(url))
                    pairingCompletion = nil
                    pairingChanged(.created(RemotePairingPresentation(
                        url: url,
                        pairID: session.pairID,
                        fingerprint: session.fingerprint,
                        expiresAt: Date(
                            timeIntervalSince1970: TimeInterval(confirmedExpiry) / 1_000
                        )
                    )))
                } else {
                    session.invalidate()
                    pairingSession = nil
                    pendingPairURL = nil
                    pairingCompletion?(.failure(RemotePairingError.invalidated))
                    pairingCompletion = nil
                    pairingChanged(.invalidated)
                }
            case "pair.claimed":
                session.invalidate()
                pairingSession = nil
                pendingPairURL = nil
                pairingCompletion = nil
                commandAuthorized = true
                pairingChanged(.claimed)
                publish(.connected)
            case "pair.rejected":
                session.invalidate()
                pairingSession = nil
                pendingPairURL = nil
                pairingCompletion?(.failure(RemotePairingError.invalidated))
                pairingCompletion = nil
                pairingChanged(.invalidated)
                publish(.connecting)
            default:
                break
            }
            return
        }
        if !usesLegacyAuthentication,
           let object = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
           object["type"] as? String == "binding.revoked" {
            do {
                let frame = try RemoteSignalingProtocol.decodeBindingRevoked(
                    data,
                    expectedDeviceID: configuration.deviceID
                )
                if let current = activePeerConnection,
                   frame.connectionIDs.contains(current.offer.connectionID) {
                    activePeerConnection = nil
                    let connectionID = current.offer.connectionID
                    DispatchQueue.main.async { [peerTransport] in
                        peerTransport?.closeConnection(
                            connectionID: connectionID,
                            reason: "browser binding revoked"
                        )
                    }
                }
            } catch {
                publish(.protocolMismatch)
                stopLocked(publishDisabled: false)
            }
            return
        }
        if !usesLegacyAuthentication,
           let object = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
           let type = object["type"] as? String,
           type.hasPrefix("signal.") {
            guard commandAuthorized, peerTransport != nil else {
                publish(.authenticationFailed)
                stopLocked(publishDisabled: false)
                return
            }
            do {
                let signal = try RemotePeerConnectionProtocol.decodeIncoming(
                    data,
                    expectedDeviceID: configuration.deviceID
                )
                try handlePeerSignalLocked(
                    signal,
                    task: task,
                    generation: generation
                )
            } catch {
                if !rejectConnectionLocalSignalLocked(
                    object,
                    task: task,
                    generation: generation
                ) {
                    publish(.protocolMismatch)
                    stopLocked(publishDisabled: false)
                }
            }
            return
        }
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
        guard usesLegacyAuthentication || commandAuthorized else {
            publish(.authenticationFailed)
            stopLocked(publishDisabled: false)
            return
        }
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

    private func rejectConnectionLocalSignalLocked(
        _ object: [String: Any],
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) -> Bool {
        guard let type = object["type"] as? String,
              type.hasPrefix("signal."),
              let rawConnectionID = object["connectionID"] as? String,
              let connectionID = UUID(uuidString: rawConnectionID)?
                .uuidString.lowercased(),
              let rawDeviceID = object["deviceID"] as? String,
              rawDeviceID.lowercased() == configuration.deviceID.lowercased(),
              let number = object["expiresAt"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue == Double(number.int64Value) else {
            return false
        }
        let suppliedExpiry = number.int64Value
        if let current = activePeerConnection,
           current.offer.connectionID == connectionID {
            sendPeerCloseLocked(
                connectionID: connectionID,
                deviceID: current.offer.deviceID,
                expiresAt: current.offer.expiresAt,
                reason: "invalid connection signal",
                task: task,
                generation: generation
            )
            activePeerConnection = nil
            DispatchQueue.main.async { [peerTransport] in
                peerTransport?.closeConnection(
                    connectionID: connectionID,
                    reason: "invalid connection signal"
                )
            }
        } else if type == "signal.offer" {
            sendPeerCloseLocked(
                connectionID: connectionID,
                deviceID: configuration.deviceID.lowercased(),
                expiresAt: suppliedExpiry,
                reason: "invalid connection offer",
                task: task,
                generation: generation
            )
        }
        return true
    }

    private func handlePeerSignalLocked(
        _ signal: RemotePeerIncomingSignal,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) throws {
        dispatchPrecondition(condition: .onQueue(lifecycleQueue))
        guard owns(task, generation: generation), let peerTransport else {
            throw RemoteSignalingProtocolError.invalidEnvelope
        }
        switch signal {
        case .offer(let offer):
            if let current = activePeerConnection {
                guard current.offer.connectionID != offer.connectionID else {
                    throw RemoteSignalingProtocolError.invalidEnvelope
                }
                sendPeerCloseLocked(
                    connectionID: current.offer.connectionID,
                    deviceID: current.offer.deviceID,
                    expiresAt: current.offer.expiresAt,
                    reason: "replaced",
                    task: task,
                    generation: generation
                )
                let oldID = current.offer.connectionID
                DispatchQueue.main.async {
                    peerTransport.closeConnection(
                        connectionID: oldID,
                        reason: "replaced"
                    )
                }
            }
            activePeerConnection = ActivePeerConnection(
                offer: offer,
                lastBrowserSequence: offer.sequence,
                nextDeviceSequence: 1,
                browserCandidates: 0,
                deviceCandidates: 0
            )
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self, let task else { return }
                do {
                    try peerTransport.acceptConnection(
                        offer: offer,
                        hostEpoch: self.hostEpoch,
                        controller: self.controller
                    ) { [weak self, weak task] event in
                        guard let self, let task else { return }
                        self.lifecycleQueue.async {
                            self.handlePeerEventLocked(
                                event,
                                task: task,
                                generation: generation
                            )
                        }
                    }
                } catch {
                    self.lifecycleQueue.async {
                        self.handlePeerEventLocked(
                            .close(
                                connectionID: offer.connectionID,
                                deviceID: offer.deviceID,
                                expiresAt: offer.expiresAt,
                                reason: "peer engine unavailable"
                            ),
                            task: task,
                            generation: generation
                        )
                    }
                }
            }

        case .candidate(
            let connectionID,
            let deviceID,
            let sequence,
            let expiresAt,
            let candidate
        ):
            guard var current = activePeerConnection,
                  current.offer.connectionID == connectionID,
                  current.offer.deviceID == deviceID,
                  current.offer.expiresAt == expiresAt,
                  sequence == current.lastBrowserSequence + 1,
                  current.browserCandidates
                    < RemotePeerConnectionLimits.maximumCandidates else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            current.lastBrowserSequence = sequence
            current.browserCandidates += 1
            activePeerConnection = current
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self, let task else { return }
                do {
                    try peerTransport.addRemoteCandidate(
                        connectionID: connectionID,
                        candidate: candidate
                    )
                } catch {
                    self.lifecycleQueue.async {
                        self.handlePeerEventLocked(
                            .close(
                                connectionID: connectionID,
                                deviceID: deviceID,
                                expiresAt: expiresAt,
                                reason: "candidate rejected"
                            ),
                            task: task,
                            generation: generation
                        )
                    }
                }
            }

        case .close(
            let connectionID,
            let deviceID,
            let sequence,
            let expiresAt,
            let reason
        ):
            guard let current = activePeerConnection,
                  current.offer.connectionID == connectionID,
                  current.offer.deviceID == deviceID,
                  current.offer.expiresAt == expiresAt,
                  sequence == current.lastBrowserSequence + 1 else {
                throw RemoteSignalingProtocolError.invalidEnvelope
            }
            activePeerConnection = nil
            DispatchQueue.main.async {
                peerTransport.closeConnection(
                    connectionID: connectionID,
                    reason: reason
                )
            }
        }
    }

    private func handlePeerEventLocked(
        _ event: RemotePeerHostEvent,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        dispatchPrecondition(condition: .onQueue(lifecycleQueue))
        guard owns(task, generation: generation),
              var current = activePeerConnection else { return }
        switch event {
        case .answer(let material):
            guard let identity,
                  material.connectionID == current.offer.connectionID,
                  material.deviceID == current.offer.deviceID,
                  material.expiresAt == current.offer.expiresAt,
                  material.browserNonce == current.offer.browserNonce,
                  material.hostEpoch == hostEpoch,
                  material.offerFingerprint == current.offer.offerFingerprint,
                  let activeLeaseExpiresAt =
                    RemotePeerConnectionLimits.activeLeaseExpiresAt(
                        signalingExpiresAt: material.expiresAt
                    ),
                  let signature = try? identity.sign(
                      RemotePeerConnectionProtocol.bindingTranscript(
                          material: material,
                          deviceFingerprint: identity.fingerprint
                      )
                  ) else {
                sendPeerCloseLocked(
                    connectionID: current.offer.connectionID,
                    deviceID: current.offer.deviceID,
                    expiresAt: current.offer.expiresAt,
                    reason: "binding failed",
                    task: task,
                    generation: generation
                )
                activePeerConnection = nil
                return
            }
            let sequence = current.nextDeviceSequence
            current.nextDeviceSequence += 1
            activePeerConnection = current
            let frame = RemoteDeviceAnswerSignal(
                v: 1,
                type: "signal.answer",
                connectionID: material.connectionID,
                deviceID: material.deviceID,
                direction: "device-to-browser",
                sequence: sequence,
                expiresAt: material.expiresAt,
                hostNonce: material.hostNonce,
                hostEpoch: material.hostEpoch,
                offerFingerprint: material.offerFingerprint,
                answerFingerprint: material.answerFingerprint,
                answerSDP: material.answerSDP,
                signatureDER: signature.base64URLEncodedString()
            )
            sendLocked(frame, task: task, generation: generation) { [weak self, weak task] error in
                guard let self, let task else { return }
                guard self.owns(task, generation: generation),
                      self.activePeerConnection?.offer.connectionID
                        == material.connectionID else { return }
                if error != nil {
                    self.disconnectLocked(task: task, generation: generation)
                    return
                }
                let bind = RemotePeerBindFrame(
                    v: 1,
                    type: "bind",
                    connectionID: material.connectionID,
                    deviceID: material.deviceID,
                    publicKeyX963: identity.publicKeyX963.base64URLEncodedString(),
                    deviceFingerprint: identity.fingerprint,
                    hostEpoch: material.hostEpoch,
                    browserNonce: material.browserNonce,
                    hostNonce: material.hostNonce,
                    expiresAt: material.expiresAt,
                    activeLeaseExpiresAt: activeLeaseExpiresAt,
                    offerFingerprint: material.offerFingerprint,
                    answerFingerprint: material.answerFingerprint,
                    signatureDER: signature.base64URLEncodedString()
                )
                DispatchQueue.main.async {
                    try? self.peerTransport?.installBinding(bind)
                }
            }

        case .candidate(let material):
            guard material.connectionID == current.offer.connectionID,
                  material.deviceID == current.offer.deviceID,
                  material.expiresAt == current.offer.expiresAt,
                  current.deviceCandidates
                    < RemotePeerConnectionLimits.maximumCandidates else { return }
            let sequence = current.nextDeviceSequence
            current.nextDeviceSequence += 1
            current.deviceCandidates += 1
            activePeerConnection = current
            sendLocked(RemoteDeviceCandidateSignal(
                v: 1,
                type: "signal.ice",
                connectionID: material.connectionID,
                deviceID: material.deviceID,
                direction: "device-to-browser",
                sequence: sequence,
                expiresAt: material.expiresAt,
                candidate: material.candidate.candidate,
                sdpMid: material.candidate.sdpMid,
                sdpMLineIndex: material.candidate.sdpMLineIndex
            ), task: task, generation: generation)

        case .close(let connectionID, let deviceID, let expiresAt, let reason):
            guard connectionID == current.offer.connectionID,
                  deviceID == current.offer.deviceID,
                  expiresAt == current.offer.expiresAt else { return }
            sendPeerCloseLocked(
                connectionID: connectionID,
                deviceID: deviceID,
                expiresAt: expiresAt,
                reason: reason,
                task: task,
                generation: generation
            )
            activePeerConnection = nil
        }
    }

    private func sendPeerCloseLocked(
        connectionID: String,
        deviceID: String,
        expiresAt: Int64,
        reason: String,
        task: any RemoteRelayWebSocketTask,
        generation: UInt64
    ) {
        var sequence = 1
        if var current = activePeerConnection,
           current.offer.connectionID == connectionID {
            sequence = current.nextDeviceSequence
            current.nextDeviceSequence += 1
            activePeerConnection = current
        }
        sendLocked(RemoteDeviceCloseSignal(
            v: 1,
            type: "signal.close",
            connectionID: connectionID,
            deviceID: deviceID,
            direction: "device-to-browser",
            sequence: sequence,
            expiresAt: expiresAt,
            reason: String(reason.prefix(256))
        ), task: task, generation: generation)
    }

    private func resetPeerLocked(reason: String) {
        guard let current = activePeerConnection else { return }
        activePeerConnection = nil
        let connectionID = current.offer.connectionID
        DispatchQueue.main.async { [peerTransport] in
            peerTransport?.closeConnection(
                connectionID: connectionID,
                reason: reason
            )
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
        resetPeerLocked(reason: "Relay disconnected")
        let invalidatedPairing = pairingSession != nil
        pairingSession?.invalidate()
        pairingSession = nil
        pendingPairURL = nil
        pairingCompletion?(.failure(RemotePairingError.invalidated))
        pairingCompletion = nil
        if invalidatedPairing {
            pairingChanged(.invalidated)
        }
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
        resetPeerLocked(reason: "Relay stopped")
        let invalidatedPairing = pairingSession != nil
        pairingSession?.invalidate()
        pairingSession = nil
        pendingPairURL = nil
        pairingCompletion?(.failure(RemotePairingError.invalidated))
        pairingCompletion = nil
        if invalidatedPairing {
            pairingChanged(.invalidated)
        }
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

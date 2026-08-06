import AppKit
import Foundation
import WebKit

final class WebKitRemotePeerTransport: NSObject, RemotePeerTransport, RemotePeerSignalingTransport {
    static let bridgeName = "pipiRemotePeer"

    private(set) var state: RemotePeerTransportState = .disabled {
        didSet {
            guard oldValue != state else { return }
            stateChanged(state)
        }
    }
    private(set) var generation = BridgeCapabilityToken.generate(byteCount: 18)

    private let stateChanged: (RemotePeerTransportState) -> Void
    private let productionStateChanged: (RemotePeerProductionState) -> Void
    private var panel: NSPanel?
    private var webView: WKWebView?
    private var bridgeProxy: RemotePeerWeakScriptHandler?
    private var activeSession: RemotePeerTestSession?
    private var pendingAnswer: RemotePeerAnswer?
    private var didRequestStop = false
    private let negotiationTimeout: TimeInterval
    private var negotiationWorkItem: DispatchWorkItem?
    private var negotiationAttempt = UUID()
    private let userScriptsForTesting: [WKUserScript]
    var offerEvaluationCompletedForTesting: ((Error?) -> Void)?
    private struct ProductionConnection {
        let offer: RemotePeerConnectionOffer
        let hostEpoch: String
        let adapter: RemotePeerCommandAdapter
        let emit: (RemotePeerHostEvent) -> Void
        var candidateCount = 0
    }
    private var productionConnection: ProductionConnection?
    enum TunnelEvent {
        case ready
        case accepted
        case reconnecting(attempt: Int, delaySeconds: Int)
        case closed(reason: String)
        case failed
    }
    private var tunnelController: RemoteHostController?
    private var tunnelEvent: ((TunnelEvent) -> Void)?
    private var tunnelRequestIDs: Set<String> = []
    private var pendingTunnelStart: [String: Any]?

    init(
        negotiationTimeout: TimeInterval = RemotePeerLimits.negotiationTimeout,
        userScriptsForTesting: [WKUserScript] = [],
        productionStateChanged: @escaping (RemotePeerProductionState) -> Void = { _ in },
        stateChanged: @escaping (RemotePeerTransportState) -> Void
    ) {
        self.negotiationTimeout = max(0.001, negotiationTimeout)
        self.userScriptsForTesting = userScriptsForTesting
        self.stateChanged = stateChanged
        self.productionStateChanged = productionStateChanged
        super.init()
    }

    deinit {
        precondition(webView == nil, "Remote peer transport must be stopped before release")
    }

    func start() {
        dispatchPrecondition(condition: .onQueue(.main))
        didRequestStop = false
        finishProductionConnection(reason: "peer engine restarted")
        generation = BridgeCapabilityToken.generate(byteCount: 18)
        clearNegotiationOwnership()
        rebuildWebView(stateBeforeLoad: .loading)
    }

    func stop() {
        dispatchPrecondition(condition: .onQueue(.main))
        didRequestStop = true
        stopTunnelLink()
        finishProductionConnection(reason: "peer engine stopped")
        generation = BridgeCapabilityToken.generate(byteCount: 18)
        clearNegotiationOwnership()
        tearDownWebView()
        state = .disabled
        productionStateChanged(.disabled)
    }

    func startTunnelLink(
        roomID: String,
        secret: String,
        tunnelURL: URL,
        controller: RemoteHostController,
        event: @escaping (TunnelEvent) -> Void
    ) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard UUID(uuidString: roomID) != nil,
              secret.utf8.count == 64,
              secret.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }),
              ["wss", "ws"].contains(tunnelURL.scheme?.lowercased()),
              tunnelURL.path == "/tunnel/ws" else {
            event(.failed)
            return
        }
        stopTunnelLink()
        tunnelController = controller
        tunnelEvent = event
        pendingTunnelStart = [
            "generation": generation,
            "roomID": roomID.lowercased(),
            "secret": secret,
            "tunnelURL": tunnelURL.absoluteString,
        ]
        evaluatePendingTunnelStart()
    }

    func stopTunnelLink() {
        dispatchPrecondition(condition: .onQueue(.main))
        pendingTunnelStart = nil
        tunnelRequestIDs.removeAll()
        tunnelController = nil
        tunnelEvent = nil
        webView?.evaluateJavaScript("window.pipiTunnelHost?.leave(); true")
    }

    private func evaluatePendingTunnelStart() {
        guard let webView, let payload = pendingTunnelStart,
              let json = try? Self.json(payload) else { return }
        webView.evaluateJavaScript(
            "window.pipiTunnelHost.start(\(json)); true"
        ) { [weak self] _, error in
            guard let self, error != nil else { return }
            self.productionStateChanged(.failed("服务器隧道 host 启动失败"))
            self.tunnelEvent?(.failed)
        }
    }

    func makeTestSession(now: Date = Date()) throws -> RemotePeerTestSession {
        dispatchPrecondition(condition: .onQueue(.main))
        guard state == .ready
                || state == .channelOpen
                || state == .echoVerified else {
            throw RemotePeerTransportError.notReady
        }
        if activeSession != nil {
            resetCurrentJavaScriptSession()
            clearNegotiationOwnership()
            state = .ready
        }
        let session = RemotePeerTestSession(
            v: RemotePeerLimits.protocolVersion,
            sessionID: BridgeCapabilityToken.generate(byteCount: 18),
            generation: generation,
            expiresAtMilliseconds: Int64(
                now.addingTimeInterval(RemotePeerLimits.sessionLifetime)
                    .timeIntervalSince1970 * 1_000
            )
        )
        activeSession = session
        pendingAnswer = nil
        return session
    }

    func accept(offer: RemotePeerOffer, now: Date = Date()) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard state == .ready,
              let session = activeSession else {
            throw RemotePeerTransportError.notReady
        }
        try offer.validate(session: session, now: now)
        guard let webView else { throw RemotePeerTransportError.notReady }
        let payload: [String: Any] = [
            "v": RemotePeerLimits.protocolVersion,
            "sessionID": offer.sessionID,
            "generation": offer.generation,
            "expiresAtMilliseconds": offer.expiresAtMilliseconds,
            "sdp": RemotePeerLoopbackSDP.normalizeMDNSHostCandidates(offer.sdp),
        ]
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.sortedKeys]
        ),
              let json = String(data: data, encoding: .utf8) else {
            throw RemotePeerTransportError.invalidRequest("offer cannot be encoded")
        }
        let callbackGeneration = generation
        state = .negotiating
        scheduleNegotiationDeadline(for: session, now: now)
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.acceptOffer(\(json)); true"
        ) {
            [weak self] _, error in
            self?.offerEvaluationCompletedForTesting?(error)
            guard let self,
                  self.generation == callbackGeneration,
                  self.activeSession?.sessionID == offer.sessionID else {
                return
            }
            if error != nil {
                self.recoverCurrentSessionToReady(
                    sessionID: offer.sessionID,
                    generation: callbackGeneration,
                    resetJavaScript: false
                )
            }
        }
    }

    func answer(
        sessionID: String,
        generation: String,
        now: Date = Date()
    ) throws -> RemotePeerAnswer {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let session = activeSession,
              session.sessionID == sessionID,
              session.generation == generation,
              self.generation == generation else {
            throw RemotePeerTransportError.staleSession
        }
        guard session.expirationDate > now else {
            recoverCurrentSessionToReady(
                sessionID: session.sessionID,
                generation: session.generation
            )
            throw RemotePeerTransportError.expiredSession
        }
        guard let answer = pendingAnswer else {
            throw RemotePeerTransportError.answerUnavailable
        }
        return answer
    }

    func acceptConnection(
        offer: RemotePeerConnectionOffer,
        hostEpoch: String,
        controller: RemoteHostController,
        emit: @escaping (RemotePeerHostEvent) -> Void
    ) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard state == .ready, activeSession == nil, let webView,
              offer.expiresAt > Int64(Date().timeIntervalSince1970 * 1_000) else {
            throw RemotePeerTransportError.notReady
        }
        if let current = productionConnection {
            closeConnection(connectionID: current.offer.connectionID, reason: "replaced")
        }
        let payload: [String: Any] = [
            "v": 1,
            "generation": generation,
            "connectionID": offer.connectionID,
            "deviceID": offer.deviceID,
            "expiresAt": offer.expiresAt,
            "browserNonce": offer.browserNonce,
            "offerFingerprint": offer.offerFingerprint,
            "offerSDP": offer.offerSDP,
        ]
        let json = try Self.json(payload)
        productionConnection = ProductionConnection(
            offer: offer,
            hostEpoch: hostEpoch,
            adapter: RemotePeerCommandAdapter(
                controller: controller,
                hostEpoch: hostEpoch
            ),
            emit: emit
        )
        productionStateChanged(.negotiating)
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.acceptConnection(\(json)); true"
        ) { [weak self] _, error in
            guard let self,
                  self.productionConnection?.offer.connectionID
                    == offer.connectionID,
                  error != nil else { return }
            self.finishProductionConnection(reason: "WKWebView rejected offer")
        }
    }

    func addRemoteCandidate(
        connectionID: String,
        candidate: RemotePeerICECandidate
    ) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard var current = productionConnection,
              current.offer.connectionID == connectionID,
              current.offer.expiresAt > Int64(Date().timeIntervalSince1970 * 1_000),
              current.candidateCount < RemotePeerConnectionLimits.maximumCandidates,
              let webView else {
            throw RemotePeerTransportError.staleSession
        }
        current.candidateCount += 1
        productionConnection = current
        let json = try Self.json([
            "v": 1,
            "generation": generation,
            "connectionID": connectionID,
            "candidate": candidate.candidate,
            "sdpMid": candidate.sdpMid,
            "sdpMLineIndex": candidate.sdpMLineIndex,
        ])
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.addCandidate(\(json)); true"
        )
    }

    func installBinding(_ frame: RemotePeerBindFrame) throws {
        dispatchPrecondition(condition: .onQueue(.main))
        guard productionConnection?.offer.connectionID == frame.connectionID,
              let webView else {
            throw RemotePeerTransportError.staleSession
        }
        let encoded = try JSONEncoder().encode(frame)
        guard var payload = try JSONSerialization.jsonObject(with: encoded)
                as? [String: Any] else {
            throw RemotePeerTransportError.invalidRequest("bind cannot be encoded")
        }
        payload["generation"] = generation
        let json = try Self.json(payload)
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.installBinding(\(json)); true"
        )
    }

    func closeConnection(connectionID: String, reason: String) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard productionConnection?.offer.connectionID == connectionID else { return }
        if let webView, let json = try? Self.json([
            "v": 1,
            "generation": generation,
            "connectionID": connectionID,
        ]) {
            webView.evaluateJavaScript(
                "window.pipiRemotePeer.closeConnection(\(json)); true"
            )
        }
        finishProductionConnection(reason: reason)
    }

    static func makeConfiguration(
        scriptHandler: WKScriptMessageHandler
    ) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // Developer extras intentionally retain WebKit's default-off value.
        configuration.userContentController.add(
            scriptHandler,
            name: bridgeName
        )
        return configuration
    }

    var hasRetainedViewHierarchyForTesting: Bool {
        guard let panel, let webView else { return false }
        return panel.contentView === webView
    }

    var hasVisibleHostWindowForTesting: Bool {
        guard let panel, let webView,
              panel.contentView === webView,
              panel.isVisible,
              panel.alphaValue > 0 else {
            return false
        }
        return NSScreen.screens.contains { screen in
            screen.frame.intersects(panel.frame)
        }
    }

    func acceptBridgeMessageForTesting(_ body: Any) {
        acceptBridgeMessage(body)
    }

    func simulateWebContentTerminationForTesting() {
        guard let webView else { return }
        webViewWebContentProcessDidTerminate(webView)
    }

    func armNegotiationTimeoutForTesting() throws {
        guard let session = activeSession else {
            throw RemotePeerTransportError.notReady
        }
        state = .negotiating
        scheduleNegotiationDeadline(for: session, now: Date())
    }

    func evaluateJavaScriptForTesting(_ source: String) async throws -> Any? {
        guard let webView else { throw RemotePeerTransportError.notReady }
        return try await webView.evaluateJavaScript(source)
    }

    private func rebuildWebView(stateBeforeLoad: RemotePeerTransportState) {
        tearDownWebView()
        state = stateBeforeLoad
        guard let resourceRoot = Self.resourceRoot(),
              let hostURL = Self.hostURL(resourceRoot: resourceRoot) else {
            state = .failed(RemotePeerTransportError.resourceUnavailable.safeMessage)
            return
        }

        let proxy = RemotePeerWeakScriptHandler(target: self)
        let configuration = Self.makeConfiguration(scriptHandler: proxy)
        for userScript in userScriptsForTesting {
            configuration.userContentController.addUserScript(userScript)
        }
        let panelFrame = Self.hostPanelFrame()
        let webView = WKWebView(
            frame: NSRect(origin: .zero, size: panelFrame.size),
            configuration: configuration
        )
        webView.navigationDelegate = self

        let panel = NSPanel(
            contentRect: panelFrame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = true
        panel.isOpaque = true
        panel.backgroundColor = .black
        panel.alphaValue = 1
        panel.hasShadow = false
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.canHide = false
        panel.isExcludedFromWindowsMenu = true
        panel.sharingType = .none
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .ignoresCycle,
            .fullScreenAuxiliary,
        ]
        panel.contentView = webView

        bridgeProxy = proxy
        self.webView = webView
        self.panel = panel
        // WKWebView networking and WebRTC are suspended when their only
        // window is never ordered or is wholly offscreen. Keep a tiny,
        // non-activating, mouse-transparent host window genuinely onscreen so
        // the WebContent process remains schedulable while PipiUI is in the
        // background. The nonzero alpha is intentional: an alpha-zero window
        // is treated as occluded by WebKit.
        panel.orderFrontRegardless()
        webView.loadFileURL(hostURL, allowingReadAccessTo: resourceRoot)
    }

    private func tearDownWebView() {
        productionConnection?.adapter.reset()
        productionConnection = nil
        clearNegotiationOwnership()
        if let webView {
            webView.stopLoading()
            webView.navigationDelegate = nil
            webView.configuration.userContentController.removeScriptMessageHandler(
                forName: Self.bridgeName
            )
            webView.removeFromSuperview()
        }
        panel?.contentView = nil
        panel?.close()
        webView = nil
        panel = nil
        bridgeProxy = nil
    }

    private static func resourceRoot() -> URL? {
        RemotePeerResources.directoryURL()
    }

    private static func hostURL(resourceRoot: URL) -> URL? {
        RemotePeerResources.fileURL(name: "host", extension: "html")
    }

    private static func hostPanelFrame() -> NSRect {
        let size = NSSize(width: 2, height: 2)
        guard let visibleFrame = NSScreen.screens.first?.visibleFrame else {
            return NSRect(origin: .zero, size: size)
        }
        return NSRect(
            x: visibleFrame.maxX - size.width - 8,
            y: visibleFrame.minY + 8,
            width: size.width,
            height: size.height
        )
    }

    private static func safeError(_ error: Error) -> String {
        let message = String(error.localizedDescription.prefix(RemotePeerLimits.maximumErrorBytes))
        return message.isEmpty ? "unknown WebKit error" : message
    }

    private static func json(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        guard let json = String(data: data, encoding: .utf8) else {
            throw RemotePeerTransportError.invalidRequest("payload cannot be encoded")
        }
        return json
    }

    private func finishProductionConnection(reason: String) {
        guard let current = productionConnection else { return }
        productionConnection = nil
        current.adapter.reset()
        let text = String(reason.prefix(256))
        if reason.localizedCaseInsensitiveContains("failed")
            || reason.localizedCaseInsensitiveContains("invalid")
            || reason.localizedCaseInsensitiveContains("rejected")
            || reason.localizedCaseInsensitiveContains("unavailable") {
            productionStateChanged(.failed(text))
        } else {
            productionStateChanged(.closed(text))
        }
        current.emit(.close(
            connectionID: current.offer.connectionID,
            deviceID: current.offer.deviceID,
            expiresAt: current.offer.expiresAt,
            reason: text
        ))
    }

    private func sendProductionChunks(
        _ chunks: [RemotePeerChunkEnvelope],
        connectionID: String
    ) {
        guard productionConnection?.offer.connectionID == connectionID,
              let webView,
              let data = try? JSONEncoder().encode(chunks),
              let values = try? JSONSerialization.jsonObject(with: data),
              let json = try? Self.json([
                  "v": 1,
                  "generation": generation,
                  "connectionID": connectionID,
                  "chunks": values,
              ]) else {
            finishProductionConnection(reason: "response encoding failed")
            return
        }
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.sendChunks(\(json)); true"
        ) { [weak self] _, error in
            guard error != nil,
                  self?.productionConnection?.offer.connectionID
                    == connectionID else { return }
            self?.finishProductionConnection(reason: "DataChannel send failed")
        }
    }

    private func scheduleNegotiationDeadline(
        for session: RemotePeerTestSession,
        now: Date
    ) {
        negotiationWorkItem?.cancel()
        let attempt = UUID()
        negotiationAttempt = attempt
        let callbackGeneration = generation
        let remainingTTL = max(0.001, session.expirationDate.timeIntervalSince(now))
        let delay = min(negotiationTimeout, remainingTTL)
        let workItem = DispatchWorkItem { [weak self] in
            guard let self,
                  self.negotiationAttempt == attempt,
                  self.generation == callbackGeneration,
                  self.activeSession?.sessionID == session.sessionID,
                  (self.state == .negotiating || self.state == .channelOpen) else {
                return
            }
            self.recoverCurrentSessionToReady(
                sessionID: session.sessionID,
                generation: callbackGeneration
            )
        }
        negotiationWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func clearNegotiationOwnership() {
        negotiationWorkItem?.cancel()
        negotiationWorkItem = nil
        negotiationAttempt = UUID()
        activeSession = nil
        pendingAnswer = nil
    }

    private func recoverCurrentSessionToReady(
        sessionID: String,
        generation expectedGeneration: String,
        resetJavaScript: Bool = true
    ) {
        guard generation == expectedGeneration,
              activeSession?.sessionID == sessionID else {
            return
        }
        if resetJavaScript {
            resetCurrentJavaScriptSession()
        }
        clearNegotiationOwnership()
        if !didRequestStop, webView != nil {
            state = .ready
        }
    }

    private func resetCurrentJavaScriptSession() {
        guard let session = activeSession,
              let webView,
              let data = try? JSONSerialization.data(
                  withJSONObject: [
                      "generation": session.generation,
                      "sessionID": session.sessionID,
                  ],
                  options: [.sortedKeys]
              ),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        let callbackGeneration = generation
        webView.evaluateJavaScript(
            "window.pipiRemotePeer.resetSession(\(json)); true"
        ) { [weak self] _, _ in
            guard let self, self.generation == callbackGeneration else { return }
        }
    }

    private func acceptBridgeMessage(_ body: Any) {
        guard let object = body as? [String: Any],
              RemotePeerProtocolVersion.isExact(object["v"]),
              let type = object["type"] as? String,
              let messageGeneration = object["generation"] as? String,
              messageGeneration == generation else {
            return
        }
        switch type {
        case "tunnelReady":
            guard Set(object.keys) == ["v", "type", "generation"],
                  tunnelController != nil else { return }
            productionStateChanged(.negotiating)
            tunnelEvent?(.ready)

        case "tunnelBrowserAccepted":
            guard Set(object.keys) == ["v", "type", "generation"],
                  tunnelController != nil else { return }
            productionStateChanged(.connected)
            tunnelEvent?(.accepted)

        case "tunnelReconnecting":
            guard Set(object.keys) == ["v", "type", "generation", "attempt", "delayMs"],
                  tunnelController != nil,
                  let attemptNumber = object["attempt"] as? NSNumber,
                  CFGetTypeID(attemptNumber) != CFBooleanGetTypeID(),
                  attemptNumber.doubleValue == Double(attemptNumber.intValue),
                  (1...999).contains(attemptNumber.intValue),
                  let delayMs = object["delayMs"] as? NSNumber,
                  CFGetTypeID(delayMs) != CFBooleanGetTypeID(),
                  delayMs.doubleValue == Double(delayMs.intValue),
                  (0...300_000).contains(delayMs.intValue) else { return }
            let delaySeconds = max(0, Int((Double(delayMs.intValue) / 1000).rounded()))
            productionStateChanged(.reconnecting(
                attempt: attemptNumber.intValue,
                delaySeconds: delaySeconds
            ))
            tunnelEvent?(.reconnecting(
                attempt: attemptNumber.intValue,
                delaySeconds: delaySeconds
            ))

        case "tunnelClosed":
            guard Set(object.keys) == ["v", "type", "generation", "reason"],
                  tunnelController != nil,
                  let reason = object["reason"] as? String,
                  !reason.isEmpty,
                  reason.utf8.count <= 256 else { return }
            productionStateChanged(.closed(reason))
            tunnelEvent?(.closed(reason: reason))

        case "tunnelInvalidated":
            guard Set(object.keys) == ["v", "type", "generation"],
                  tunnelController != nil else { return }
            productionStateChanged(.closed("链接已失效"))
            tunnelEvent?(.closed(reason: "invalidated"))

        case "tunnelError":
            guard Set(object.keys) == ["v", "type", "generation", "message"],
                  let message = object["message"] as? String,
                  !message.isEmpty,
                  message.utf8.count <= 256 else { return }
            productionStateChanged(.failed(message))
            tunnelEvent?(.failed)

        case "tunnelRequest":
            guard Set(object.keys) == [
                "v", "type", "generation", "requestID", "command", "body",
            ],
                  tunnelRequestIDs.count
                    < RemotePeerConnectionLimits.maximumInflightMessages,
                  let requestID = object["requestID"] as? String,
                  UUID(uuidString: requestID) != nil,
                  tunnelRequestIDs.insert(requestID).inserted,
                  let commandName = object["command"] as? String,
                  let command = RemoteRelayCommand(rawValue: commandName),
                  let bodyObject = object["body"],
                  JSONSerialization.isValidJSONObject(bodyObject),
                  let body = try? JSONSerialization.data(
                      withJSONObject: bodyObject,
                      options: [.sortedKeys]
                  ),
                  body.count <= RemoteRelayLimits.maximumRequestBodyBytes,
                  let controller = tunnelController else { return }
            controller.handle(RemoteCommandRequest(
                command: command,
                body: body,
                deadline: Date().addingTimeInterval(
                    RemoteRelayLimits.maximumDeadlineInterval
                )
            )) { [weak self] response in
                DispatchQueue.main.async {
                    guard let self,
                          self.tunnelRequestIDs.remove(requestID) != nil,
                          let webView = self.webView else { return }
                    let responseBody = (try? JSONSerialization.jsonObject(
                        with: response.body
                    )) ?? NSNull()
                    guard let json = try? Self.json([
                        "status": response.status,
                        "body": responseBody,
                    ]),
                          let requestJSON = try? JSONSerialization.data(
                              withJSONObject: requestID,
                              options: [.fragmentsAllowed]
                          ),
                          let requestString = String(
                              data: requestJSON,
                              encoding: .utf8
                          ) else { return }
                    webView.evaluateJavaScript(
                        "window.pipiTunnelHost.resolveRequest(" +
                        "\(requestString), \(json)); true"
                    )
                }
            }

        case "ready":
            guard Set(object.keys) == ["v", "type", "generation"],
                  state == .loading || state == .recovering else { return }
            state = .ready
            productionStateChanged(.ready)
            // `startTunnelLink` may be called while this retained WKWebView is
            // still loading.  Do not invoke the tunnel script until the host
            // bridge itself has reported ready: `didFinish` only guarantees
            // navigation completion, not that our asynchronous bridge startup
            // message has been processed.
            evaluatePendingTunnelStart()

        case "connectionOpen":
            guard Set(object.keys) == [
                "v", "type", "generation", "connectionID",
            ],
                  let connectionID = object["connectionID"] as? String,
                  productionConnection?.offer.connectionID == connectionID else { return }
            productionStateChanged(.connected)

        case "connectionAnswer":
            guard Set(object.keys) == [
                "v", "type", "generation", "connectionID", "hostNonce",
                "answerFingerprint", "answerSDP",
            ],
                  let connectionID = object["connectionID"] as? String,
                  let hostNonce = object["hostNonce"] as? String,
                  Data(base64URLEncoded: hostNonce)?.count == 32,
                  let answerFingerprint = object["answerFingerprint"] as? String,
                  RemotePeerConnectionProtocol.canonicalFingerprint(answerFingerprint)
                    == answerFingerprint,
                  let answerSDP = object["answerSDP"] as? String,
                  RemotePeerConnectionProtocol.sdpFingerprint(answerSDP)
                    == answerFingerprint,
                  let current = productionConnection,
                  current.offer.connectionID == connectionID,
                  current.offer.expiresAt
                    > Int64(Date().timeIntervalSince1970 * 1_000) else { return }
            current.emit(.answer(RemotePeerAnswerMaterial(
                connectionID: connectionID,
                deviceID: current.offer.deviceID,
                expiresAt: current.offer.expiresAt,
                browserNonce: current.offer.browserNonce,
                hostNonce: hostNonce,
                hostEpoch: current.hostEpoch,
                offerFingerprint: current.offer.offerFingerprint,
                answerFingerprint: answerFingerprint,
                answerSDP: answerSDP
            )))

        case "connectionCandidate":
            guard Set(object.keys) == [
                "v", "type", "generation", "connectionID", "candidate",
                "sdpMid", "sdpMLineIndex",
            ],
                  let connectionID = object["connectionID"] as? String,
                  let candidate = object["candidate"] as? String,
                  (1...RemotePeerConnectionLimits.maximumCandidateBytes)
                    .contains(candidate.utf8.count),
                  let sdpMid = object["sdpMid"] as? String,
                  sdpMid.utf8.count <= 256,
                  let line = object["sdpMLineIndex"] as? NSNumber,
                  CFGetTypeID(line) != CFBooleanGetTypeID(),
                  line.doubleValue == Double(line.intValue),
                  (0...65_535).contains(line.intValue),
                  let current = productionConnection,
                  current.offer.connectionID == connectionID else { return }
            current.emit(.candidate(RemotePeerCandidateMaterial(
                connectionID: connectionID,
                deviceID: current.offer.deviceID,
                expiresAt: current.offer.expiresAt,
                candidate: RemotePeerICECandidate(
                    candidate: candidate,
                    sdpMid: sdpMid,
                    sdpMLineIndex: line.intValue
                )
            )))

        case "connectionData":
            guard Set(object.keys) == [
                "v", "type", "generation", "connectionID", "envelope",
            ],
                  let connectionID = object["connectionID"] as? String,
                  let envelope = object["envelope"],
                  let current = productionConnection,
                  current.offer.connectionID == connectionID,
                  let data = try? JSONSerialization.data(
                      withJSONObject: envelope,
                      options: [.sortedKeys]
                  ) else { return }
            current.adapter.receive(envelopeData: data) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self,
                          self.productionConnection?.offer.connectionID
                            == connectionID else { return }
                    switch result {
                    case .success(let chunks):
                        self.sendProductionChunks(chunks, connectionID: connectionID)
                    case .failure:
                        self.closeConnection(
                            connectionID: connectionID,
                            reason: "invalid command frame"
                        )
                    }
                }
            }

        case "connectionClosed":
            guard Set(object.keys) == [
                "v", "type", "generation", "connectionID", "reason",
            ],
                  let connectionID = object["connectionID"] as? String,
                  productionConnection?.offer.connectionID == connectionID,
                  let reason = object["reason"] as? String,
                  !reason.isEmpty,
                  reason.utf8.count <= 256 else { return }
            finishProductionConnection(reason: reason)

        case "answer":
            guard Set(object.keys) == [
                "v", "type", "generation", "sessionID", "sdp",
            ],
                  let sessionID = object["sessionID"] as? String,
                  let sdp = object["sdp"] as? String,
                  let session = activeSession,
                  session.sessionID == sessionID,
                  session.generation == generation,
                  session.expirationDate > Date(),
                  (1...RemotePeerLimits.maximumSDPBytes).contains(sdp.utf8.count),
                  sdp.hasPrefix("v=0") else {
                return
            }
            pendingAnswer = RemotePeerAnswer(
                v: RemotePeerLimits.protocolVersion,
                sessionID: sessionID,
                generation: generation,
                sdp: RemotePeerLoopbackSDP.normalizeMDNSHostCandidates(sdp)
            )

        case "channel":
            guard Set(object.keys) == [
                "v", "type", "generation", "sessionID", "state",
            ],
                  let sessionID = object["sessionID"] as? String,
                  sessionID == activeSession?.sessionID,
                  let channelState = object["state"] as? String,
                  channelState == "open" || channelState == "closed" else {
                return
            }
            if channelState == "open", state == .negotiating {
                state = .channelOpen
            } else if channelState == "closed" {
                recoverCurrentSessionToReady(
                    sessionID: sessionID,
                    generation: generation
                )
            }

        case "echoVerified":
            guard Set(object.keys) == [
                "v", "type", "generation", "sessionID", "payload",
            ],
                  let sessionID = object["sessionID"] as? String,
                  sessionID == activeSession?.sessionID,
                  let payload = object["payload"] as? String,
                  payload.utf8.count <= RemotePeerLimits.maximumEchoBytes,
                  state == .channelOpen else {
                return
            }
            negotiationWorkItem?.cancel()
            negotiationWorkItem = nil
            negotiationAttempt = UUID()
            state = .echoVerified

        case "peer":
            guard Set(object.keys) == [
                "v", "type", "generation", "sessionID", "state",
            ],
                  let sessionID = object["sessionID"] as? String,
                  sessionID == activeSession?.sessionID,
                  let peerState = object["state"] as? String,
                  ["failed", "disconnected", "closed"].contains(peerState) else {
                return
            }
            recoverCurrentSessionToReady(
                sessionID: sessionID,
                generation: generation
            )

        case "error":
            guard Set(object.keys) == [
                "v", "type", "generation", "sessionID", "message",
            ],
                  let sessionID = object["sessionID"] as? String,
                  sessionID == activeSession?.sessionID,
                  let message = object["message"] as? String,
                  !message.isEmpty,
                  message.utf8.count <= RemotePeerLimits.maximumErrorBytes else {
                return
            }
            recoverCurrentSessionToReady(
                sessionID: sessionID,
                generation: generation
            )

        default:
            return
        }
    }
}

extension WebKitRemotePeerTransport: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.targetFrame?.isMainFrame != false,
              let root = Self.resourceRoot(),
              let allowed = Self.hostURL(resourceRoot: root),
              navigationAction.request.url?.standardizedFileURL
                == allowed.standardizedFileURL else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let callbackGeneration = generation
        guard !didRequestStop else { return }
        let data = try? JSONSerialization.data(
            withJSONObject: ["generation": callbackGeneration],
            options: [.sortedKeys]
        )
        guard let data, let json = String(data: data, encoding: .utf8) else {
            state = .failed("cannot initialize WKWebView host")
            return
        }
        webView.evaluateJavaScript("window.pipiRemotePeer.start(\(json))") {
            [weak self] _, error in
            guard let self, self.generation == callbackGeneration else { return }
            if let error {
                self.state = .failed(Self.safeError(error))
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !didRequestStop, self.webView === webView else { return }
        finishProductionConnection(reason: "WKWebView process terminated")
        generation = BridgeCapabilityToken.generate(byteCount: 18)
        activeSession = nil
        pendingAnswer = nil
        rebuildWebView(stateBeforeLoad: .recovering)
    }
}

extension WebKitRemotePeerTransport: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.bridgeName,
              message.webView === webView else {
            return
        }
        acceptBridgeMessage(message.body)
    }
}

private final class RemotePeerWeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

import WebKit
import XCTest
@testable import PipiUI

final class RemotePeerTransportTests: XCTestCase {
    private func offerData(
        version: Any = RemotePeerLimits.protocolVersion,
        sessionID: String = String(repeating: "s", count: 24),
        generation: String = String(repeating: "g", count: 24),
        expiresAtMilliseconds: Int64 = 130_000,
        sdp: String = "v=0\r\n"
    ) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "v": version,
            "sessionID": sessionID,
            "generation": generation,
            "expiresAtMilliseconds": expiresAtMilliseconds,
            "sdp": sdp,
        ])
    }

    func testOfferRequiresExactSchemaAndBoundedValues() throws {
        let offer = try RemotePeerOffer.decodeExact(offerData())
        XCTAssertEqual(offer.sessionID, String(repeating: "s", count: 24))
        XCTAssertEqual(offer.generation, String(repeating: "g", count: 24))
        XCTAssertEqual(offer.sdp, "v=0\r\n")

        var extra = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: offerData()) as? [String: Any]
        )
        extra["unexpected"] = true
        XCTAssertThrowsError(
            try RemotePeerOffer.decodeExact(
                JSONSerialization.data(withJSONObject: extra)
            )
        )

        extra.removeValue(forKey: "unexpected")
        for invalidVersion: Any in [true, 1.5, -1, 1e100] {
            extra["v"] = invalidVersion
            XCTAssertThrowsError(
                try RemotePeerOffer.decodeExact(
                    JSONSerialization.data(withJSONObject: extra)
                ),
                "version \(invalidVersion) must be rejected"
            )
        }
        XCTAssertTrue(RemotePeerProtocolVersion.isExact(NSNumber(value: 1)))
        XCTAssertFalse(RemotePeerProtocolVersion.isExact(NSNumber(value: 1.5)))
        XCTAssertFalse(RemotePeerProtocolVersion.isExact(NSNumber(value: -1)))
        XCTAssertFalse(RemotePeerProtocolVersion.isExact(NSNumber(value: UInt64.max)))

        let oversizedSDP = "v=0" + String(
            repeating: "x",
            count: RemotePeerLimits.maximumSDPBytes
        )
        XCTAssertThrowsError(
            try RemotePeerOffer.decodeExact(offerData(sdp: oversizedSDP))
        )
    }

    func testOfferIsBoundToExactSessionGenerationAndTTL() throws {
        let now = Date(timeIntervalSince1970: 100)
        let session = RemotePeerTestSession(
            v: 1,
            sessionID: String(repeating: "s", count: 24),
            generation: String(repeating: "g", count: 24),
            expiresAtMilliseconds: 130_000
        )
        let offer = try RemotePeerOffer.decodeExact(offerData())
        XCTAssertNoThrow(try offer.validate(session: session, now: now))

        let stale = RemotePeerTestSession(
            v: 1,
            sessionID: String(repeating: "x", count: 24),
            generation: session.generation,
            expiresAtMilliseconds: session.expiresAtMilliseconds
        )
        XCTAssertThrowsError(try offer.validate(session: stale, now: now)) {
            XCTAssertEqual($0 as? RemotePeerTransportError, .staleSession)
        }
        XCTAssertThrowsError(
            try offer.validate(
                session: session,
                now: Date(timeIntervalSince1970: 131)
            )
        ) {
            XCTAssertEqual($0 as? RemotePeerTransportError, .expiredSession)
        }
    }

    func testAnswerLookupRequiresExactlyTwoOpaqueParameters() {
        let session = String(repeating: "s", count: 24)
        let generation = String(repeating: "g", count: 24)
        XCTAssertEqual(
            RemotePeerQuery.exactAnswerLookup(
                requestTarget:
                    "/p2p-test/answer?sessionID=\(session)&generation=\(generation)"
            )?.sessionID,
            session
        )
        XCTAssertNil(RemotePeerQuery.exactAnswerLookup(
            requestTarget:
                "/p2p-test/answer?sessionID=\(session)&generation=\(generation)&extra=1"
        ))
        XCTAssertNil(RemotePeerQuery.exactAnswerLookup(
            requestTarget: "/p2p-test/answer?sessionID=short&generation=\(generation)"
        ))
    }

    func testLoopbackSDPNormalizesOnlyMDNSCandidateAddressField() {
        let sdp = [
            "v=0",
            "a=candidate:one 1 udp 2122260223 abc-123.local 50000 typ host",
            "a=candidate:two 1 udp 2122260223 192.168.1.5 50001 typ host",
            "a=not-a-candidate abc-123.local",
            "",
        ].joined(separator: "\r\n")
        let normalized = RemotePeerLoopbackSDP.normalizeMDNSHostCandidates(sdp)
        XCTAssertTrue(normalized.contains(
            "a=candidate:one 1 udp 2122260223 127.0.0.1 50000 typ host"
        ))
        XCTAssertTrue(normalized.contains(
            "a=candidate:two 1 udp 2122260223 192.168.1.5 50001 typ host"
        ))
        XCTAssertTrue(normalized.contains("a=not-a-candidate abc-123.local"))
    }

    func testP2PDocumentIsUnauthenticatedOnlyOnExactLoopbackURL() {
        let token = String(repeating: "t", count: 64)
        let loopback = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/p2p-test/",
            headers: ["host": "127.0.0.1:4321"],
            body: Data()
        )
        XCTAssertNil(LocalRemoteRequestPolicy.authorizationError(
            for: loopback,
            expectedToken: token,
            port: 4321
        ))

        let wrongPath = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/p2p-test/?extra=1",
            headers: ["host": "127.0.0.1:4321"],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: wrongPath,
                expectedToken: token,
                port: 4321
            )?.status,
            400
        )

        let lanMode = LocalRemoteAccessMode.trustedLAN(
            privateIPv4: "192.168.43.200",
            pairingSecret: String(repeating: "p", count: 64)
        )
        let lanRequest = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/p2p-test/",
            headers: ["host": "192.168.43.200:4321"],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: lanRequest,
                expectedToken: token,
                port: 4321,
                accessMode: lanMode
            )?.status,
            403
        )

        let configWithoutToken = LocalRemoteHTTPRequest(
            method: "GET",
            path: "/p2p-test/config",
            headers: [
                "host": "127.0.0.1:4321",
                "origin": "http://127.0.0.1:4321",
            ],
            body: Data()
        )
        XCTAssertEqual(
            LocalRemoteRequestPolicy.authorizationError(
                for: configWithoutToken,
                expectedToken: token,
                port: 4321
            )?.status,
            401
        )
        XCTAssertNil(LocalRemoteRoutes.rejection(for: LocalRemoteHTTPRequest(
            method: "POST",
            path: "/p2p-test/offer",
            headers: [:],
            body: Data()
        )))
    }

    func testBundledBrowserHarnessIdentifiesWKHostAndInjectsOnlyOpaqueToken() throws {
        let token = String(repeating: "t", count: 64)
        let nonce = String(repeating: "n", count: 24)
        let page = try RemotePeerBrowserPage.render(token: token, nonce: nonce)
        let html = try XCTUnwrap(String(data: page, encoding: .utf8))
        XCTAssertTrue(html.contains("WKWebView (native app retained host)"))
        XCTAssertTrue(html.contains("pipiui.viability.echo.v1"))
        XCTAssertTrue(html.contains(token))
        XCTAssertFalse(html.contains("__TOKEN__"))
        XCTAssertFalse(html.contains("__BUNDLED_SCRIPT__"))
        XCTAssertFalse(html.contains("getUserMedia"))
        XCTAssertFalse(html.contains("addTrack"))
    }

    @MainActor
    func testWebKitConfigurationLifecycleGenerationAndStaleBridgeSafety() throws {
        let handler = TestScriptHandler()
        let configuration = WebKitRemotePeerTransport.makeConfiguration(
            scriptHandler: handler
        )
        XCTAssertFalse(configuration.websiteDataStore.isPersistent)
        XCTAssertFalse(configuration.preferences.javaScriptCanOpenWindowsAutomatically)

        var states: [RemotePeerTransportState] = []
        let transport = WebKitRemotePeerTransport { states.append($0) }
        let initialGeneration = transport.generation
        transport.start()
        let firstGeneration = transport.generation
        XCTAssertNotEqual(firstGeneration, initialGeneration)
        XCTAssertTrue(transport.hasRetainedViewHierarchyForTesting)
        XCTAssertTrue(transport.hasVisibleHostWindowForTesting)

        for invalidVersion: Any in [1.5, -1, 1e100] {
            transport.acceptBridgeMessageForTesting([
                "v": invalidVersion,
                "type": "ready",
                "generation": firstGeneration,
            ])
            XCTAssertEqual(transport.state, .loading)
        }
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": firstGeneration,
        ])
        XCTAssertEqual(transport.state, .ready)
        let session = try transport.makeTestSession(now: Date(timeIntervalSince1970: 100))

        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "answer",
            "generation": String(repeating: "x", count: 24),
            "sessionID": session.sessionID,
            "sdp": "v=0\r\nstale",
        ])
        XCTAssertThrowsError(try transport.answer(
            sessionID: session.sessionID,
            generation: session.generation,
            now: Date(timeIntervalSince1970: 101)
        )) {
            XCTAssertEqual($0 as? RemotePeerTransportError, .answerUnavailable)
        }

        transport.simulateWebContentTerminationForTesting()
        XCTAssertNotEqual(transport.generation, firstGeneration)
        XCTAssertEqual(transport.state, .recovering)
        XCTAssertTrue(transport.hasRetainedViewHierarchyForTesting)
        XCTAssertTrue(transport.hasVisibleHostWindowForTesting)

        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": firstGeneration,
        ])
        XCTAssertEqual(transport.state, .recovering)

        transport.stop()
        XCTAssertEqual(transport.state, .disabled)
        XCTAssertFalse(transport.hasRetainedViewHierarchyForTesting)
        XCTAssertFalse(transport.hasVisibleHostWindowForTesting)
        XCTAssertTrue(states.contains(.recovering))
    }

    @MainActor
    func testChannelOpenIsNotGreenUntilBoundEchoAckIsBridged() throws {
        let transport = WebKitRemotePeerTransport { _ in }
        transport.start()
        defer { transport.stop() }
        let generation = transport.generation
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": generation,
        ])
        let session = try transport.makeTestSession(now: Date())
        try transport.armNegotiationTimeoutForTesting()

        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "channel",
            "generation": generation,
            "sessionID": session.sessionID,
            "state": "open",
        ])
        XCTAssertEqual(transport.state, .channelOpen)
        XCTAssertNotEqual(transport.state, .echoVerified)

        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "echoVerified",
            "generation": String(repeating: "x", count: 24),
            "sessionID": session.sessionID,
            "payload": "stale",
        ])
        XCTAssertEqual(transport.state, .channelOpen)

        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "echoVerified",
            "generation": generation,
            "sessionID": session.sessionID,
            "payload": "round-trip",
        ])
        XCTAssertEqual(transport.state, .echoVerified)
        XCTAssertEqual(
            transport.state.displayText,
            "WKWebView echo 往返已验证"
        )

        _ = try transport.makeTestSession(now: Date())
        XCTAssertEqual(transport.state, .ready)
    }

    @MainActor
    func testNegotiationTimeoutReturnsReadyAndAllowsRetry() async throws {
        let transport = WebKitRemotePeerTransport(
            negotiationTimeout: 0.03
        ) { _ in }
        transport.start()
        defer { transport.stop() }
        let generation = transport.generation
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": generation,
        ])
        _ = try transport.makeTestSession(now: Date())
        try transport.armNegotiationTimeoutForTesting()
        XCTAssertEqual(transport.state, .negotiating)

        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertEqual(transport.state, .ready)
        XCTAssertNoThrow(try transport.makeTestSession(now: Date()))
    }

    @MainActor
    func testPeerFailureAndBrowserChannelCloseReturnReady() throws {
        let transport = WebKitRemotePeerTransport { _ in }
        transport.start()
        defer { transport.stop() }
        let generation = transport.generation
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": generation,
        ])
        var session = try transport.makeTestSession(now: Date())
        try transport.armNegotiationTimeoutForTesting()
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "peer",
            "generation": generation,
            "sessionID": session.sessionID,
            "state": "failed",
        ])
        XCTAssertEqual(transport.state, .ready)

        session = try transport.makeTestSession(now: Date())
        try transport.armNegotiationTimeoutForTesting()
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "channel",
            "generation": generation,
            "sessionID": session.sessionID,
            "state": "closed",
        ])
        XCTAssertEqual(transport.state, .ready)
        XCTAssertNoThrow(try transport.makeTestSession(now: Date()))
    }

    @MainActor
    func testStaleNegotiationTimerCannotPolluteRebuiltGeneration() async throws {
        let transport = WebKitRemotePeerTransport(
            negotiationTimeout: 0.03
        ) { _ in }
        transport.start()
        defer { transport.stop() }
        let firstGeneration = transport.generation
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": firstGeneration,
        ])
        _ = try transport.makeTestSession(now: Date())
        try transport.armNegotiationTimeoutForTesting()
        transport.simulateWebContentTerminationForTesting()
        let rebuiltGeneration = transport.generation
        XCTAssertNotEqual(rebuiltGeneration, firstGeneration)
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "ready",
            "generation": rebuiltGeneration,
        ])
        XCTAssertEqual(transport.state, .ready)

        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertEqual(transport.state, .ready)
    }

    @MainActor
    func testLoadedWKWebViewOfferInvocationReturnsBridgeablePrimitive() async throws {
        let ready = expectation(description: "bundled WK host loaded")
        var didObserveReady = false
        let transport = WebKitRemotePeerTransport { state in
            if state == .ready, !didObserveReady {
                didObserveReady = true
                ready.fulfill()
            }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [ready], timeout: 5)

        let session = try transport.makeTestSession(now: Date())
        let evaluated = expectation(description: "offer evaluation completed")
        var evaluationError: Error?
        transport.offerEvaluationCompletedForTesting = { error in
            evaluationError = error
            evaluated.fulfill()
        }
        let offer = try RemotePeerOffer.decodeExact(offerData(
            sessionID: session.sessionID,
            generation: session.generation,
            expiresAtMilliseconds: session.expiresAtMilliseconds,
            sdp: "v=0\r\n"
        ))
        try transport.accept(offer: offer, now: Date())
        await fulfillment(of: [evaluated], timeout: 5)
        XCTAssertNil(
            evaluationError,
            "sync wrapper must not expose a Promise as evaluateJavaScript result"
        )
    }

    @MainActor
    func testLoadedWKHostStaleAttemptCannotCloseOrImpersonateReplacement() async throws {
        let collector = PeerBridgeCollector()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(
            collector,
            name: WebKitRemotePeerTransport.bridgeName
        )
        configuration.userContentController.addUserScript(WKUserScript(
            source: Self.fakePeerAttemptHarness,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let pageLoaded = expectation(description: "attempt harness host loaded")
        let navigation = PeerHostNavigationObserver {
            pageLoaded.fulfill()
        }
        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 320, height: 180),
            configuration: configuration
        )
        webView.navigationDelegate = navigation
        let panel = NSPanel(
            contentRect: NSRect(x: -8_000, y: -8_000, width: 320, height: 180),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isReleasedWhenClosed = false
        panel.contentView = webView
        defer {
            webView.stopLoading()
            webView.navigationDelegate = nil
            configuration.userContentController.removeScriptMessageHandler(
                forName: WebKitRemotePeerTransport.bridgeName
            )
            panel.contentView = nil
            panel.close()
        }

        let root = try XCTUnwrap(RemotePeerResources.directoryURL())
        let host = try XCTUnwrap(
            RemotePeerResources.fileURL(name: "host", extension: "html")
        )
        webView.loadFileURL(host, allowingReadAccessTo: root)
        await fulfillment(of: [pageLoaded], timeout: 5)

        let generation = String(repeating: "g", count: 24)
        _ = try await webView.evaluateJavaScript(
            "window.pipiRemotePeer.start({generation:'\(generation)'})"
        )

        let sessionA = String(repeating: "a", count: 24)
        let sessionB = String(repeating: "b", count: 24)
        let expires = Int64(Date().addingTimeInterval(30).timeIntervalSince1970 * 1_000)
        let offerA = try Self.peerOfferJSON(
            sessionID: sessionA,
            generation: generation,
            expiresAtMilliseconds: expires
        )
        let offerB = try Self.peerOfferJSON(
            sessionID: sessionB,
            generation: generation,
            expiresAtMilliseconds: expires
        )
        _ = try await webView.evaluateJavaScript(
            "window.pipiRemotePeer.acceptOffer(\(offerA))"
        )
        let stalled = try await webView.evaluateJavaScript(
            "window.__peerTestPeers.length === 1 && typeof window.__releaseAttemptA === 'function'"
        ) as? Bool
        XCTAssertEqual(stalled, true)

        let reset = try await webView.evaluateJavaScript(
            "window.pipiRemotePeer.resetSession({generation:'\(generation)',sessionID:'\(sessionA)'})"
        ) as? Bool
        XCTAssertEqual(reset, true)

        let answerB = expectation(description: "replacement B answer")
        collector.onMessage = { message in
            if message["type"] as? String == "answer",
               message["sessionID"] as? String == sessionB {
                answerB.fulfill()
            }
        }
        _ = try await webView.evaluateJavaScript(
            "window.pipiRemotePeer.acceptOffer(\(offerB))"
        )
        await fulfillment(of: [answerB], timeout: 5)

        _ = try await webView.evaluateJavaScript(
            "window.__releaseAttemptA(); true"
        )
        try await Task.sleep(nanoseconds: 100_000_000)

        let peerState = try await webView.evaluateJavaScript(
            """
            JSON.stringify(window.__peerTestPeers.map(peer => ({
              closeCount: peer.closeCount,
              createAnswerCalls: peer.createAnswerCalls
            })))
            """
        ) as? String
        let peerData = try XCTUnwrap(peerState?.data(using: .utf8))
        let peers = try XCTUnwrap(
            JSONSerialization.jsonObject(with: peerData) as? [[String: Int]]
        )
        XCTAssertEqual(peers.count, 2)
        XCTAssertGreaterThanOrEqual(peers[0]["closeCount"] ?? 0, 1)
        XCTAssertEqual(peers[0]["createAnswerCalls"], 0)
        XCTAssertEqual(peers[1]["closeCount"], 0, "stale A must not close B")
        XCTAssertEqual(peers[1]["createAnswerCalls"], 1)

        let terminal = collector.messages.filter {
            let type = $0["type"] as? String
            return type == "answer" || type == "error"
        }
        XCTAssertEqual(terminal.count, 1)
        XCTAssertEqual(terminal[0]["type"] as? String, "answer")
        XCTAssertEqual(terminal[0]["sessionID"] as? String, sessionB)
        XCTAssertFalse(terminal.contains {
            ($0["sessionID"] as? String) == sessionA
        })
    }

    @MainActor
    func testSwiftTimeoutThenReplacementSurvivesReleasedStaleWKAttempt() async throws {
        let initialReady = expectation(description: "initial fake WK host ready")
        let retryReady = expectation(description: "Swift timeout reset returned ready")
        var readyCount = 0
        let script = WKUserScript(
            source: Self.fakePeerAttemptHarness,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        let transport = WebKitRemotePeerTransport(
            negotiationTimeout: 0.15,
            userScriptsForTesting: [script]
        ) { state in
            guard state == .ready else { return }
            readyCount += 1
            if readyCount == 1 {
                initialReady.fulfill()
            } else if readyCount == 2 {
                retryReady.fulfill()
            }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [initialReady], timeout: 5)

        let sessionA = try transport.makeTestSession(now: Date())
        let offerA = try RemotePeerOffer.decodeExact(offerData(
            sessionID: sessionA.sessionID,
            generation: sessionA.generation,
            expiresAtMilliseconds: sessionA.expiresAtMilliseconds
        ))
        try transport.accept(offer: offerA, now: Date())
        let stalled = try await transport.evaluateJavaScriptForTesting(
            "window.__peerTestPeers.length === 1 && typeof window.__releaseAttemptA === 'function'"
        ) as? Bool
        XCTAssertEqual(stalled, true)

        await fulfillment(of: [retryReady], timeout: 2)
        XCTAssertEqual(transport.state, .ready)

        let sessionB = try transport.makeTestSession(now: Date())
        let offerB = try RemotePeerOffer.decodeExact(offerData(
            sessionID: sessionB.sessionID,
            generation: sessionB.generation,
            expiresAtMilliseconds: sessionB.expiresAtMilliseconds
        ))
        try transport.accept(offer: offerB, now: Date())
        try await Task.sleep(nanoseconds: 30_000_000)
        let answerBeforeRelease = try transport.answer(
            sessionID: sessionB.sessionID,
            generation: sessionB.generation,
            now: Date()
        )

        _ = try await transport.evaluateJavaScriptForTesting(
            "window.__releaseAttemptA(); true"
        )
        try await Task.sleep(nanoseconds: 30_000_000)

        XCTAssertEqual(transport.state, .negotiating)
        XCTAssertEqual(
            try transport.answer(
                sessionID: sessionB.sessionID,
                generation: sessionB.generation,
                now: Date()
            ),
            answerBeforeRelease
        )
        let peerState = try await transport.evaluateJavaScriptForTesting(
            """
            JSON.stringify(window.__peerTestPeers.map(peer => ({
              closeCount: peer.closeCount,
              createAnswerCalls: peer.createAnswerCalls
            })))
            """
        ) as? String
        let peerData = try XCTUnwrap(peerState?.data(using: .utf8))
        let peers = try XCTUnwrap(
            JSONSerialization.jsonObject(with: peerData) as? [[String: Int]]
        )
        XCTAssertEqual(peers.count, 2)
        XCTAssertGreaterThanOrEqual(peers[0]["closeCount"] ?? 0, 1)
        XCTAssertEqual(peers[0]["createAnswerCalls"], 0)
        XCTAssertEqual(peers[1]["closeCount"], 0)
        XCTAssertEqual(peers[1]["createAnswerCalls"], 1)
    }

    @MainActor
    func testRealChromeHarnessCompletesLoadedWKHostEchoVerifiedBridge() async throws {
        let chromeURL = URL(
            fileURLWithPath:
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        guard FileManager.default.isExecutableFile(atPath: chromeURL.path) else {
            throw XCTSkip("Google Chrome is not installed")
        }
        let hostReady = expectation(description: "WK host ready")
        let echoVerified = expectation(description: "real echo ack bridged to Swift")
        var didObserveHostReady = false
        let transport = WebKitRemotePeerTransport { state in
            if state == .ready, !didObserveHostReady {
                didObserveHostReady = true
                hostReady.fulfill()
            }
            if state == .echoVerified {
                echoVerified.fulfill()
            }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [hostReady], timeout: 5)

        let listenerReady = expectation(description: "loopback harness listener ready")
        var loopbackURL: URL?
        let service = try XCTUnwrap(RemoteHostService(
            controller: nil,
            peerTransport: transport,
            stateChanged: { state in
                if case .listening(let url, _) = state {
                    loopbackURL = url
                        .appendingPathComponent("p2p-test", isDirectory: true)
                    listenerReady.fulfill()
                }
            }
        ))
        defer { service.stop() }
        await fulfillment(of: [listenerReady], timeout: 5)

        let profile = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "pipiui-p2p-chrome-\(UUID().uuidString)",
                isDirectory: true
            )
        try FileManager.default.createDirectory(
            at: profile,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: profile) }

        let chrome = Process()
        chrome.executableURL = chromeURL
        chrome.arguments = [
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-port=0",
            "--user-data-dir=\(profile.path)",
            try XCTUnwrap(loopbackURL).absoluteString,
        ]
        let chromeErrors = Pipe()
        chrome.standardError = chromeErrors
        try chrome.run()
        defer {
            if chrome.isRunning {
                chrome.terminate()
                chrome.waitUntilExit()
            }
        }
        await fulfillment(of: [echoVerified], timeout: 15)
        if transport.state != .echoVerified {
            chrome.terminate()
            chrome.waitUntilExit()
            let diagnostics = String(
                data: chromeErrors.fileHandleForReading.readDataToEndOfFile(),
                encoding: .utf8
            ) ?? ""
            XCTFail("Chrome seam did not verify echo: \(diagnostics.prefix(2_000))")
        }
        XCTAssertEqual(transport.state, .echoVerified)
    }

    private static func peerOfferJSON(
        sessionID: String,
        generation: String,
        expiresAtMilliseconds: Int64
    ) throws -> String {
        let data = try JSONSerialization.data(
            withJSONObject: [
                "v": 1,
                "sessionID": sessionID,
                "generation": generation,
                "expiresAtMilliseconds": expiresAtMilliseconds,
                "sdp": "v=0\r\n",
            ],
            options: [.sortedKeys]
        )
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private static let fakePeerAttemptHarness = #"""
    (() => {
      let nextID = 0;
      window.__peerTestPeers = [];
      window.__releaseAttemptA = null;
      class FakePeer {
        constructor() {
          this.id = nextID++;
          this.closeCount = 0;
          this.createAnswerCalls = 0;
          this.iceGatheringState = "complete";
          this.connectionState = "new";
          this.localDescription = null;
          window.__peerTestPeers.push(this);
        }
        setRemoteDescription() {
          if (this.id !== 0) return Promise.resolve();
          return new Promise(resolve => {
            window.__releaseAttemptA = resolve;
          });
        }
        createAnswer() {
          this.createAnswerCalls += 1;
          return Promise.resolve({
            type: "answer",
            sdp: `v=0\r\na=fake-peer:${this.id}\r\n`
          });
        }
        setLocalDescription(answer) {
          this.localDescription = answer;
          return Promise.resolve();
        }
        addEventListener() {}
        removeEventListener() {}
        close() {
          this.closeCount += 1;
          this.connectionState = "closed";
        }
      }
      Object.defineProperty(window, "RTCPeerConnection", {
        configurable: true,
        value: FakePeer
      });
    })();
    """#
}

private final class TestScriptHandler: NSObject, WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {}
}

private final class PeerBridgeCollector: NSObject, WKScriptMessageHandler {
    private(set) var messages: [[String: Any]] = []
    var onMessage: (([String: Any]) -> Void)?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any] else { return }
        messages.append(body)
        onMessage?(body)
    }
}

private final class PeerHostNavigationObserver: NSObject, WKNavigationDelegate {
    private let didFinish: () -> Void

    init(didFinish: @escaping () -> Void) {
        self.didFinish = didFinish
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        didFinish()
    }
}

import Security
import XCTest
@testable import PipiUI

final class RemoteRelayTests: XCTestCase {
    @MainActor
    func testClaimedPairingKeepsLinkUntilScheduledExpiry() async throws {
        let store = AppStore.shared
        store.handleRemotePairingEvent(.cancelled)
        let pairID = UUID().uuidString.lowercased()
        let url = try XCTUnwrap(URL(
            string: "https://remote.deepwood.cn/pair/\(pairID)#" +
                String(repeating: "a1", count: 32)
        ))
        store.handleRemotePairingEvent(.created(RemotePairingPresentation(
            url: url,
            pairID: pairID,
            fingerprint: "test-fingerprint",
            expiresAt: Date().addingTimeInterval(0.05)
        )))
        XCTAssertEqual(store.remotePairingPairID, pairID)
        // A claimed link stays visible: other browsers can still pair with it.
        store.handleRemotePairingEvent(.claimed)
        XCTAssertEqual(store.remotePairingPayload, url.absoluteString)
        XCTAssertEqual(store.remotePairingPairID, pairID)
        XCTAssertNotNil(store.remotePairingExpiresAt)
        XCTAssertEqual(store.remotePairingMessage, "已有浏览器配对，链接持续可用")
        // The scheduled expiry still tears the link down when an hour passes
        // without a browser pairing.
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertNil(store.remotePairingPayload)
        XCTAssertNil(store.remotePairingExpiresAt)
        XCTAssertEqual(store.remotePairingMessage, "配对链接已过期")
    }

    private func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    @discardableResult
    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        return condition()
    }

    func testCommandAllowlistMapsOnlyExistingLocalRoutes() {
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "GET", path: "/api/index"
        ), .index)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/send"
        ), .promptSend)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/models"
        ), .modelsGet)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/model"
        ), .modelSet)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/subagent-model"
        ), .subagentModelSet)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(method: "POST", path: "/api/agents"), .agentsList)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(method: "POST", path: "/api/agent"), .agentsDetail)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(method: "POST", path: "/api/panel-state"), .panelState)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(method: "POST", path: "/api/document"), .documentGet)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/queue/restore"
        ), .queueRestore)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/queue/cut-in"
        ), .queueCutIn)
        XCTAssertNil(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/rpc"
        ))
        XCTAssertNil(RemoteRelayCommand.localHTTPCommand(
            method: "GET", path: "https://example.test/arbitrary"
        ))
        XCTAssertEqual(Set(RemoteRelayCommand.allCases.map(\.rawValue)), [
            "index",
            "session.create",
            "session.open",
            "snapshot",
            "prompt.send",
            "message.edit",
            "message.resend",
            "generation.stop",
            "queue.restore",
            "queue.cutIn",
            "models.get",
            "model.set",
            "subagentModel.set",
            "agents.list",
            "agents.detail",
            "panel.state",
            "document.get",
        ])
        XCTAssertTrue(RemoteRelayCommand.queueRestore.isMutation)
        XCTAssertTrue(RemoteRelayCommand.queueCutIn.isMutation)
        XCTAssertTrue(RemoteRelayCommand.messageEdit.isMutation)
        XCTAssertTrue(RemoteRelayCommand.messageResend.isMutation)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/message/edit"
        ), .messageEdit)
        XCTAssertEqual(RemoteRelayCommand.localHTTPCommand(
            method: "POST", path: "/api/message/resend"
        ), .messageResend)
    }

    func testStrictRequestDecoderAcceptsV1AndRejectsUnknownFieldsAndVersions() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let requestID = UUID().uuidString.lowercased()
        let valid: [String: Any] = [
            "v": 1,
            "type": "request",
            "requestID": requestID,
            "command": "index",
            "deadlineMs": 1_010_000,
            "body": [:],
        ]
        let data = try JSONSerialization.data(withJSONObject: valid)
        XCTAssertEqual(
            try RemoteRelayProtocol.decodeRequest(data, now: now).command,
            .index
        )

        var unknownField = valid
        unknownField["headers"] = ["authorization": "must-not-forward"]
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: unknownField),
            now: now
        )) {
            XCTAssertEqual($0 as? RemoteRelayProtocolError, .invalidEnvelope)
        }

        var wrongVersion = valid
        wrongVersion["v"] = 2
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: wrongVersion),
            now: now
        )) {
            XCTAssertEqual($0 as? RemoteRelayProtocolError, .protocolMismatch)
        }
    }

    func testRequestDecoderRejectsExpiredOrOverlongDeadlines() throws {
        let now = Date(timeIntervalSince1970: 2_000)
        func data(deadlineMs: Int64) throws -> Data {
            try JSONSerialization.data(withJSONObject: [
                "v": 1,
                "type": "request",
                "requestID": UUID().uuidString,
                "command": "snapshot",
                "deadlineMs": deadlineMs,
                "body": ["sessionID": "opaque"],
            ])
        }
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            data(deadlineMs: 1_999_000), now: now
        ))
        XCTAssertThrowsError(try RemoteRelayProtocol.decodeRequest(
            data(deadlineMs: 2_020_000), now: now
        ))
    }

    func testMacCommandSchemaRejectsUnknownFieldsAndOversizedPrompts() throws {
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .sessionOpen,
            body: Data(#"{"sessionID":"opaque"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .sessionOpen,
            body: Data(#"{"sessionID":"opaque","url":"https://forbidden"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .promptSend,
            body: try JSONSerialization.data(withJSONObject: [
                "sessionID": "opaque",
                "text": String(repeating: "x", count: 64 * 1024 + 1),
                "commandID": UUID().uuidString,
            ])
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .modelsGet,
            body: Data(#"{"sessionID":"opaque"}"#.utf8)
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .modelSet,
            body: Data(#"{"sessionID":"opaque","modelId":"xai/grok"}"#.utf8)
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .subagentModelSet,
            body: Data(#"{"agent":"explore","model":""}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .subagentModelSet,
            body: Data(#"{"agent":"explore","model":"","extra":true}"#.utf8)
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(command: .agentsList, body: Data(#"{"sessionID":"opaque"}"#.utf8)))
        XCTAssertTrue(RemoteCommandSchema.validate(command: .agentsDetail, body: Data(#"{"sessionID":"opaque","agentID":"agent"}"#.utf8)))
        XCTAssertTrue(RemoteCommandSchema.validate(command: .panelState, body: Data(#"{"sessionID":"opaque"}"#.utf8)))
        XCTAssertTrue(RemoteCommandSchema.validate(command: .documentGet, body: Data(#"{"sessionID":"opaque","documentID":"document"}"#.utf8)))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .queueRestore,
            body: Data(#"{"sessionID":"opaque"}"#.utf8)
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .queueCutIn,
            body: Data(#"{"sessionID":"opaque"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .queueRestore,
            body: Data(#"{"sessionID":"opaque","extra":true}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .queueCutIn,
            body: Data(#"{}"#.utf8)
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .messageResend,
            body: try JSONSerialization.data(withJSONObject: [
                "sessionID": "opaque",
                "messageID": "entry-1",
                "commandID": UUID().uuidString,
            ])
        ))
        XCTAssertTrue(RemoteCommandSchema.validate(
            command: .messageEdit,
            body: try JSONSerialization.data(withJSONObject: [
                "sessionID": "opaque",
                "messageID": "entry-1",
                "text": "revised",
                "commandID": UUID().uuidString,
            ])
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .messageResend,
            body: Data(#"{"sessionID":"opaque","messageID":"entry-1"}"#.utf8)
        ))
        XCTAssertFalse(RemoteCommandSchema.validate(
            command: .messageEdit,
            body: try JSONSerialization.data(withJSONObject: [
                "sessionID": "opaque",
                "messageID": "entry-1",
                "text": "revised",
                "commandID": "not-a-uuid",
            ])
        ))
    }

    func testSettingsRequireSecureSchemesAndSeparatedDeviceSignalHost() throws {
        XCTAssertNotNil(RemoteRelaySettings.validatedWebSocketURL(
            "wss://remote.deepwood.cn/host/ws"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedWebSocketURL(
            "ws://remote.deepwood.cn/host/ws"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedWebSocketURL(
            "wss://remote.deepwood.cn/arbitrary"
        ))
        XCTAssertNotNil(RemoteRelaySettings.validatedPublicURL(
            "https://remote.deepwood.cn/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedPublicURL(
            "http://remote.deepwood.cn/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedPublicURL(
            "https://user:password@remote.deepwood.cn/"
        ))
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://remote.deepwood.cn/host/ws",
            publicURL: "https://remote.deepwood.cn/"
        ))
        // /tunnel/ws: same host (self-hosted single domain) is allowed.
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://remote.example/tunnel/ws",
            publicURL: "https://remote.example/"
        ))
        // /tunnel/ws: distinct tunnel host remains allowed (legacy dual-domain).
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://tunnel.deepwood.cn/tunnel/ws",
            publicURL: "https://remote.deepwood.cn/"
        ))
        // /trystero/ws follows the same same-or-split host rule.
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://remote.example/trystero/ws",
            publicURL: "https://remote.example/"
        ))
        XCTAssertNotNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://tunnel.deepwood.cn/device/ws",
            publicURL: "https://remote.deepwood.cn/"
        ))
        // /device/ws must keep signaling off the browser page origin.
        XCTAssertNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://remote.deepwood.cn/device/ws",
            publicURL: "https://remote.deepwood.cn/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://same.example:444/device/ws",
            publicURL: "https://same.example/"
        ))
        XCTAssertNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://evil.example/host/ws",
            publicURL: "https://remote.deepwood.cn/"
        ))
        XCTAssertEqual(
            RemoteRelaySettings.signalingAudience(
                URL(string: "wss://tunnel.deepwood.cn/device/ws")!
            ),
            "https://tunnel.deepwood.cn"
        )
    }

    func testDerivedTunnelWebSocketURLFromPublicOrigin() throws {
        XCTAssertEqual(
            RemoteRelaySettings.derivedTunnelWebSocketURL(
                publicURL: try XCTUnwrap(URL(string: "https://remote.example/"))
            )?.absoluteString,
            "wss://remote.example/tunnel/ws"
        )
        XCTAssertEqual(
            RemoteRelaySettings.derivedTunnelWebSocketURL(
                publicURL: try XCTUnwrap(URL(string: "https://remote.example:8443/pair"))
            )?.absoluteString,
            "wss://remote.example:8443/tunnel/ws"
        )
        XCTAssertEqual(
            RemoteRelaySettings.derivedTunnelWebSocketURL(
                publicURL: try XCTUnwrap(URL(string: "https://remote.example:443/"))
            )?.absoluteString,
            "wss://remote.example:443/tunnel/ws"
        )
        XCTAssertNil(RemoteRelaySettings.derivedTunnelWebSocketURL(
            publicURL: try XCTUnwrap(URL(string: "http://remote.example/"))
        ))
        XCTAssertNil(RemoteRelaySettings.derivedTunnelWebSocketURL(
            publicURL: try XCTUnwrap(URL(string: "wss://remote.example/tunnel/ws"))
        ))
        XCTAssertNil(RemoteRelaySettings.derivedTunnelWebSocketURL(
            publicURL: try XCTUnwrap(URL(string: "https://same.example./"))
        ))
        XCTAssertNil(RemoteRelaySettings.derivedTunnelWebSocketURL(
            publicURL: try XCTUnwrap(URL(string: "not-a-url"))
        ))
    }

    func testSecurityHostnameCanonicalizesDNSIPv4AndIPv6() throws {
        XCTAssertEqual(
            RemoteRelaySettings.canonicalSecurityHostname(
                try XCTUnwrap(URL(string: "https://ÉXAMPLE.com/"))
            ),
            "xn--xample-9ua.com"
        )
        XCTAssertEqual(
            RemoteRelaySettings.canonicalSecurityHostname(
                try XCTUnwrap(URL(string: "https://127.0.0.1/"))
            ),
            "127.0.0.1"
        )
        XCTAssertEqual(
            RemoteRelaySettings.canonicalSecurityHostname(
                try XCTUnwrap(URL(string: "https://[2001:0DB8:0:0:0:0:0:1]/"))
            ),
            "2001:db8::1"
        )
        XCTAssertEqual(
            RemoteRelaySettings.signalingAudience(
                try XCTUnwrap(URL(
                    string: "wss://[2001:0DB8:0:0:0:0:0:1]:444/device/ws"
                ))
            ),
            "https://[2001:db8::1]:444"
        )
    }

    func testCanonicalOriginsOmitDefaultPortsAndPreserveNonDefaultPorts() throws {
        for (rawURL, expectedOrigin) in [
            ("https://signal.example:443/path", "https://signal.example"),
            ("https://signal.example:444/path", "https://signal.example:444"),
            ("http://signal.example:80/path", "http://signal.example"),
            ("http://signal.example:444/path", "http://signal.example:444"),
            ("wss://signal.example:443/path", "wss://signal.example"),
            ("ws://signal.example:80/path", "ws://signal.example"),
            ("https://[2001:0DB8:0:0:0:0:0:1]:443/path", "https://[2001:db8::1]"),
            ("https://[2001:0DB8:0:0:0:0:0:1]:444/path", "https://[2001:db8::1]:444"),
        ] {
            XCTAssertEqual(
                RemoteRelaySettings.originString(try XCTUnwrap(URL(string: rawURL))),
                expectedOrigin,
                rawURL
            )
        }

        for (rawURL, expectedAudience) in [
            ("wss://signal.example:443/device/ws", "https://signal.example"),
            ("wss://signal.example:444/device/ws", "https://signal.example:444"),
            ("ws://signal.example:80/device/ws", "http://signal.example"),
            ("ws://signal.example:444/device/ws", "http://signal.example:444"),
            (
                "wss://[2001:0DB8:0:0:0:0:0:1]:443/device/ws",
                "https://[2001:db8::1]"
            ),
            (
                "wss://[2001:0DB8:0:0:0:0:0:1]:444/device/ws",
                "https://[2001:db8::1]:444"
            ),
        ] {
            XCTAssertEqual(
                RemoteRelaySettings.signalingAudience(
                    try XCTUnwrap(URL(string: rawURL))
                ),
                expectedAudience,
                rawURL
            )
        }
    }

    func testDefaultPortAudienceExactlyAcceptsNodeStyleChallenge() throws {
        let endpoint = try XCTUnwrap(URL(
            string: "wss://[2001:0DB8:0:0:0:0:0:1]:443/device/ws"
        ))
        let expectedAudience = try XCTUnwrap(
            RemoteRelaySettings.signalingAudience(endpoint)
        )
        XCTAssertEqual(expectedAudience, "https://[2001:db8::1]")

        let now = Date()
        let challenge = try JSONSerialization.data(withJSONObject: [
            "v": 1,
            "type": "auth.challenge",
            "connectionID": UUID().uuidString,
            "nonce": String(repeating: "A", count: 43),
            "audience": "https://[2001:db8::1]",
            "expiresAt": Int64(now.timeIntervalSince1970 * 1_000) + 1_000,
        ])
        XCTAssertNoThrow(try RemoteSignalingProtocol.decodeChallenge(
            challenge,
            expectedAudience: expectedAudience,
            now: now
        ))
        XCTAssertThrowsError(try RemoteSignalingProtocol.decodeChallenge(
            challenge,
            expectedAudience: "https://[2001:db8::1]:443",
            now: now
        ))
    }

    func testSecurityHostnameRejectsAliasesAndLegacyIPv4Spellings() throws {
        for hostname in [
            "same.example.",
            "0177.0.0.1",
            "2130706433",
            "127.1",
            "0x7f.1",
            "127.0.0.01",
            "999.0.0.1",
        ] {
            XCTAssertNil(RemoteRelaySettings.validatedPublicURL(
                "https://\(hostname)/"
            ), hostname)
        }

        for (webSocketURL, publicURL) in [
            (
                "wss://[2001:0DB8:0:0:0:0:0:1]:444/device/ws",
                "https://[2001:db8::1]/"
            ),
            (
                "wss://xn--xample-9ua.com:444/device/ws",
                "https://éxample.com/"
            ),
            (
                "wss://SAME.example:444/device/ws",
                "https://same.example/"
            ),
            (
                "wss://127.0.0.1:444/device/ws",
                "https://127.0.0.1/"
            ),
        ] {
            XCTAssertNil(RemoteRelaySettings.validatedURLPair(
                webSocketURL: webSocketURL,
                publicURL: publicURL
            ))
        }
        XCTAssertNil(RemoteRelaySettings.validatedURLPair(
            webSocketURL: "wss://same.example.:444/device/ws",
            publicURL: "https://same.example/"
        ))
    }

    func testMismatchedPersistedHostsFallBackAsAPair() throws {
        let suite = "RemoteRelayHostPairTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(
            "wss://evil.example/host/ws",
            forKey: "pipiui.remoteRelay.webSocketURL"
        )
        defaults.set(
            "https://remote.deepwood.cn/",
            forKey: "pipiui.remoteRelay.publicURL"
        )
        let loaded = RemoteRelaySettings.load(defaults: defaults)
        XCTAssertEqual(loaded.webSocketURL, RemoteRelaySettings.defaultWebSocketURL)
        XCTAssertEqual(loaded.publicURL, RemoteRelaySettings.defaultPublicURL)
    }

    func testEnabledDeviceWebSocketConfigurationMigratesOnLoadWithoutCredentials() throws {
        let suite = "RemoteRelayDeviceMigrationTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "pipiui.remoteRelay.enabled")
        defaults.set(
            "wss://tunnel.deepwood.cn/device/ws",
            forKey: "pipiui.remoteRelay.webSocketURL"
        )
        defaults.set(
            "https://remote.deepwood.cn/",
            forKey: "pipiui.remoteRelay.publicURL"
        )
        let loaded = RemoteRelaySettings.load(defaults: defaults)
        XCTAssertTrue(loaded.enabled)
        XCTAssertEqual(
            loaded.webSocketURL,
            RemoteRelaySettings.defaultWebSocketURL
        )
        XCTAssertEqual(loaded.publicURL, RemoteRelaySettings.defaultPublicURL)
        XCTAssertEqual(
            defaults.string(forKey: "pipiui.remoteRelay.webSocketURL"),
            RemoteRelaySettings.defaultWebSocketURL.absoluteString
        )
        XCTAssertFalse(RemoteRelaySettings.needsLegacyMigration(
            loaded,
            hasLegacyCredentials: true
        ))
    }

    func testEnabledHostWebSocketConfigurationAlsoMigratesOnLoad() throws {
        let suite = "RemoteRelayHostMigrationTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "pipiui.remoteRelay.enabled")
        defaults.set(
            "wss://remote.deepwood.cn/host/ws",
            forKey: "pipiui.remoteRelay.webSocketURL"
        )
        defaults.set(
            "https://remote.deepwood.cn/",
            forKey: "pipiui.remoteRelay.publicURL"
        )
        let loaded = RemoteRelaySettings.load(defaults: defaults)
        XCTAssertTrue(loaded.enabled)
        XCTAssertEqual(
            loaded.webSocketURL,
            RemoteRelaySettings.defaultWebSocketURL
        )
        XCTAssertEqual(loaded.publicURL, RemoteRelaySettings.defaultPublicURL)
    }

    func testEnabledTrysteroConfigurationSilentlyMigratesToTunnel() throws {
        let suite = "RemoteRelayTrysteroMigrationTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "pipiui.remoteRelay.enabled")
        defaults.set(
            "wss://tunnel.deepwood.cn/trystero/ws",
            forKey: "pipiui.remoteRelay.webSocketURL"
        )
        defaults.set(
            "https://remote.deepwood.cn/",
            forKey: "pipiui.remoteRelay.publicURL"
        )
        let loaded = RemoteRelaySettings.load(defaults: defaults)
        XCTAssertTrue(loaded.enabled)
        XCTAssertEqual(loaded.webSocketURL.path, "/tunnel/ws")
        XCTAssertEqual(
            defaults.string(forKey: "pipiui.remoteRelay.webSocketURL"),
            RemoteRelaySettings.defaultWebSocketURL.absoluteString
        )
    }

    func testMismatchedHostsAreRejectedBeforeCredentialsOrTaskCreation() {
        let credentialsReads = LockedTestBox(0)
        let taskCreations = LockedTestBox(0)
        let states = LockedTestBox<[RemoteRelayConnectionState]>([])
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: RemoteRelayConfiguration(
                enabled: true,
                webSocketURL: URL(string: "wss://evil.example/host/ws")!,
                publicURL: URL(string: "https://remote.deepwood.cn/")!,
                deviceID: UUID().uuidString.lowercased(),
                displayName: "Mismatch"
            ),
            taskFactory: { _ in
                taskCreations.withValue { $0 += 1 }
                return FakeRemoteRelayWebSocketTask()
            },
            credentialsProvider: {
                credentialsReads.withValue { $0 += 1 }
                return RemoteRelayCredentials(
                    accessClientID: "must-not-be-read",
                    accessClientSecret: "must-not-be-read",
                    deviceSecret: "must-not-be-read"
                )
            },
            stateChanged: { state in states.withValue { $0.append(state) } }
        )
        client.start()
        XCTAssertTrue(waitUntil { states.value.contains(.invalidConfiguration) })
        XCTAssertEqual(credentialsReads.value, 0)
        XCTAssertEqual(taskCreations.value, 0)
        client.stop()
    }

    func testSettingsPersistOnlyNonSecretConfiguration() throws {
        let suite = "RemoteRelayTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.register(defaults: [
            "unrelated.registered.token": "not-a-relay-secret",
        ])
        var configuration = RemoteRelaySettings.load(defaults: defaults)
        configuration.enabled = true
        configuration.displayName = "Test Mac"
        RemoteRelaySettings.save(configuration, defaults: defaults)

        XCTAssertTrue(
            defaults.dictionaryRepresentation().keys.contains("unrelated.registered.token"),
            "fixture must prove dictionaryRepresentation includes registered defaults"
        )
        let serialized = (defaults.persistentDomain(forName: suite) ?? [:]).description
        XCTAssertFalse(serialized.contains(RemoteRelayCredential.deviceSecret.rawValue))
        XCTAssertFalse(serialized.contains(RemoteRelayCredential.accessClientSecret.rawValue))
        XCTAssertFalse(serialized.localizedCaseInsensitiveContains("token"))
    }

    func testLegacyCredentialDeletionAcceptsSuccessAndNotFoundAfterReprobe() {
        let remaining = LockedTestBox(Set(RemoteRelayCredential.allCases))
        let statuses: [RemoteRelayCredential: OSStatus] = [
            .accessClientID: errSecSuccess,
            .accessClientSecret: errSecItemNotFound,
            .deviceSecret: errSecSuccess,
        ]
        let result = RemoteRelayCredentialStore.deleteAll(client: .init(
            delete: { credential in
                remaining.withValue { $0.remove(credential) }
                return statuses[credential]!
            },
            probe: {
                remaining.value.contains($0) ? .present : .absent
            }
        ))
        XCTAssertTrue(result.succeeded)
        XCTAssertTrue(result.remaining.isEmpty)
        XCTAssertEqual(result.statuses, statuses)
    }

    func testLegacyCredentialDeletionPartialFailureRequiresSuccessfulRetry() {
        let remaining = LockedTestBox(Set(RemoteRelayCredential.allCases))
        let shouldFail = LockedTestBox(true)
        func client() -> RemoteRelayKeychainClient {
            .init(
                delete: { credential in
                    if credential == .accessClientSecret && shouldFail.value {
                        return errSecInteractionNotAllowed
                    }
                    remaining.withValue { $0.remove(credential) }
                    return errSecSuccess
                },
                probe: {
                    remaining.value.contains($0) ? .present : .absent
                }
            )
        }

        let first = RemoteRelayCredentialStore.deleteAll(client: client())
        XCTAssertFalse(first.succeeded)
        XCTAssertEqual(first.remaining, [.accessClientSecret])
        shouldFail.withValue { $0 = false }
        let retry = RemoteRelayCredentialStore.deleteAll(client: client())
        XCTAssertTrue(retry.succeeded)
        XCTAssertTrue(retry.remaining.isEmpty)
    }

    func testLegacyCredentialDeletionDoesNotHideDeleteOrProbeErrors() {
        let deleteFails = LockedTestBox(true)
        func deleteFailureClient() -> RemoteRelayKeychainClient {
            .init(
                delete: {
                    $0 == .deviceSecret && deleteFails.value
                        ? errSecInteractionNotAllowed
                        : errSecSuccess
                },
                probe: { _ in .absent }
            )
        }
        let deleteFailure = RemoteRelayCredentialStore.deleteAll(
            client: deleteFailureClient()
        )
        XCTAssertFalse(deleteFailure.succeeded)
        XCTAssertTrue(
            deleteFailure.remaining.isEmpty,
            "an absent probe cannot erase a failed deletion status"
        )
        deleteFails.withValue { $0 = false }
        XCTAssertTrue(
            RemoteRelayCredentialStore.deleteAll(
                client: deleteFailureClient()
            ).succeeded
        )

        let probeFails = LockedTestBox(true)
        func client() -> RemoteRelayKeychainClient {
            .init(
                delete: { _ in errSecItemNotFound },
                probe: {
                    $0 == .accessClientSecret && probeFails.value
                        ? .error(errSecNotAvailable)
                        : .absent
                }
            )
        }
        let uncertain = RemoteRelayCredentialStore.deleteAll(client: client())
        XCTAssertFalse(uncertain.succeeded)
        XCTAssertEqual(uncertain.remaining, [.accessClientSecret])
        XCTAssertEqual(
            uncertain.probes[.accessClientSecret],
            .error(errSecNotAvailable)
        )
        probeFails.withValue { $0 = false }
        let retry = RemoteRelayCredentialStore.deleteAll(client: client())
        XCTAssertTrue(retry.succeeded)
        XCTAssertTrue(retry.remaining.isEmpty)
    }

    func testLegacyMigrationPreservesIdentityAndSwitchesModernDefaults() throws {
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: try XCTUnwrap(
                URL(string: "wss://legacy.example/host/ws")
            ),
            publicURL: try XCTUnwrap(URL(string: "https://legacy.example/")),
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Existing Mac"
        )
        XCTAssertTrue(RemoteRelaySettings.isLegacyConfiguration(configuration))
        XCTAssertTrue(RemoteRelaySettings.needsLegacyMigration(
            configuration,
            hasLegacyCredentials: false
        ))
        let migrated = RemoteRelaySettings.migratedFromLegacy(configuration)
        XCTAssertEqual(migrated.webSocketURL, RemoteRelaySettings.defaultWebSocketURL)
        XCTAssertEqual(migrated.publicURL, RemoteRelaySettings.defaultPublicURL)
        XCTAssertEqual(migrated.deviceID, configuration.deviceID)
        XCTAssertEqual(migrated.displayName, configuration.displayName)
        XCTAssertTrue(migrated.enabled)
        XCTAssertFalse(RemoteRelaySettings.isLegacyConfiguration(migrated))
        XCTAssertFalse(RemoteRelaySettings.needsLegacyMigration(
            migrated,
            hasLegacyCredentials: false
        ))
        XCTAssertFalse(RemoteRelaySettings.needsLegacyMigration(
            migrated,
            hasLegacyCredentials: true
        ))
    }

    func testControllerRejectsExpiredDeadlineBeforeCommandExecution() {
        let controller = RemoteHostController(store: AppStore.shared)
        let expectation = expectation(description: "response")
        controller.handle(RemoteCommandRequest(
            command: .index,
            body: Data("{}".utf8),
            deadline: Date(timeIntervalSince1970: 0)
        )) { response in
            XCTAssertEqual(response.status, 408)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1)
    }

    func testQueueCommandsRejectUnknownSession() {
        let controller = RemoteHostController(store: AppStore.shared)
        for command in [RemoteRelayCommand.queueRestore, .queueCutIn] {
            let expectation = expectation(description: "\(command.rawValue) unknown session")
            controller.handle(RemoteCommandRequest(
                command: command,
                body: Data(#"{"sessionID":"s_missing_queue_command"}"#.utf8),
                deadline: nil
            )) { response in
                XCTAssertEqual(response.status, 409, command.rawValue)
                expectation.fulfill()
            }
            wait(for: [expectation], timeout: 1)
        }
    }

    func testConnectionStatesExposeRequiredPresentation() {
        XCTAssertEqual(RemoteRelayConnectionState.disabled.displayText, "已关闭")
        XCTAssertTrue(RemoteRelayConnectionState.connecting.displayText.contains("连接"))
        XCTAssertTrue(RemoteRelayConnectionState.connected.displayText.contains("已连接"))
        XCTAssertTrue(RemoteRelayConnectionState.retrying(seconds: 3).displayText.contains("3"))
        XCTAssertTrue(
            RemoteRelayConnectionState.authenticationFailed.displayText.contains("认证失败")
        )
        XCTAssertTrue(
            RemoteRelayConnectionState.invalidConfiguration.displayText.contains("主机名")
        )
        XCTAssertTrue(RemoteRelayConnectionState.protocolMismatch.displayText.contains("协议"))
    }

    func testRelayQRCodeIsReusablePairingLinkAndLegacyIsExplicit() throws {
        let sheet = try String(
            contentsOf: repositoryRoot()
                .appendingPathComponent("Sources/PipiUI/Views/RemoteConnectionSheet.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(sheet.contains("24 小时内有效"))
        XCTAssertTrue(sheet.contains("顶掉已连接的"))
        XCTAssertTrue(sheet.contains("密钥只存在于 URL fragment"))
        XCTAssertTrue(sheet.contains("重新生成链接"))
        XCTAssertTrue(sheet.contains("作废链接"))
        XCTAssertTrue(sheet.contains("regenerateRemotePairing"))
        XCTAssertFalse(sheet.contains("只可使用一次"))
        XCTAssertFalse(sheet.contains("一次性配对链接"))
        XCTAssertFalse(sheet.contains("发现旧版远程连接试点配置"))
        XCTAssertFalse(sheet.contains("SecureField("))
    }

    func testTunnelPairingResolverReusesActiveCredentialsUntilForced() {
        let roomID = UUID().uuidString.lowercased()
        let secret = String(repeating: "ab", count: 32)
        let stored = RemoteTunnelPairingCredentials(
            roomID: roomID,
            secret: secret,
            expiresAt: Date().addingTimeInterval(3_600)
        )
        let reused = RemoteTunnelPairingResolver.resolve(
            forceNew: false,
            stored: stored,
            now: Date(),
            makeRoomID: { UUID().uuidString },
            makeSecret: { String(repeating: "cd", count: 32) }
        )
        XCTAssertTrue(reused.reused)
        XCTAssertEqual(reused.credentials, stored)

        let forced = RemoteTunnelPairingResolver.resolve(
            forceNew: true,
            stored: stored,
            now: Date(),
            makeRoomID: { "11111111-1111-1111-1111-111111111111" },
            makeSecret: { String(repeating: "ef", count: 32) }
        )
        XCTAssertFalse(forced.reused)
        XCTAssertNotEqual(forced.credentials.roomID, roomID)
        XCTAssertEqual(forced.credentials.secret, String(repeating: "ef", count: 32))

        let expired = RemoteTunnelPairingResolver.resolve(
            forceNew: false,
            stored: RemoteTunnelPairingCredentials(
                roomID: roomID,
                secret: secret,
                expiresAt: Date().addingTimeInterval(-1)
            ),
            now: Date(),
            makeRoomID: { "22222222-2222-2222-2222-222222222222" },
            makeSecret: { String(repeating: "11", count: 32) }
        )
        XCTAssertFalse(expired.reused)
        XCTAssertEqual(expired.credentials.roomID, "22222222-2222-2222-2222-222222222222")
    }

    func testTunnelPairingMemoryStoreRoundTripAndClear() {
        let store = RemoteTunnelPairingStore.memory()
        let credentials = RemoteTunnelPairingCredentials(
            roomID: UUID().uuidString.lowercased(),
            secret: String(repeating: "a1", count: 32),
            expiresAt: Date().addingTimeInterval(24 * 60 * 60)
        )
        XCTAssertNil(store.load())
        XCTAssertTrue(store.save(credentials))
        XCTAssertEqual(store.load(), credentials)
        store.clear()
        XCTAssertNil(store.load())
        XCTAssertFalse(store.save(RemoteTunnelPairingCredentials(
            roomID: "not-a-uuid",
            secret: "short",
            expiresAt: Date()
        )))
    }

    func testTunnelPairingKeychainStoreRoundTrip() throws {
        let service = "com.pipiui.tests.tunnel-pairing.\(UUID().uuidString)"
        let store = RemoteTunnelPairingStore.keychainForTesting(service: service)
        defer { store.clear() }
        let credentials = RemoteTunnelPairingCredentials(
            roomID: UUID().uuidString.lowercased(),
            secret: String(repeating: "b2", count: 32),
            expiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        )
        XCTAssertTrue(store.save(credentials))
        XCTAssertEqual(store.load(), credentials)
        store.clear()
        XCTAssertNil(store.load())
    }

    func testTunnelPairingPersistsAcrossClientRestartAndStopDoesNotInvalidate() {
        let store = RemoteTunnelPairingStore.memory()
        let tunnel = FakeRemoteTunnelLinkController()
        let lifecycleQueue = DispatchQueue(label: "RemoteRelayTests.tunnel-persist")
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(string: "wss://tunnel.deepwood.cn/tunnel/ws")!,
            publicURL: URL(string: "https://remote.deepwood.cn/")!,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Persist Test"
        )
        let events = LockedTestBox<[RemotePairingLifecycleEvent]>([])
        func makeClient() -> RemoteRelayClient {
            RemoteRelayClient(
                controller: RemoteHostController(store: AppStore.shared),
                configuration: configuration,
                tunnelLink: tunnel,
                pairingStore: store,
                lifecycleQueue: lifecycleQueue,
                pairingChanged: { event in
                    events.withValue { $0.append(event) }
                },
                stateChanged: { _ in }
            )
        }

        let first = makeClient()
        first.start()
        first.beginPairing { result in
            XCTAssertNotNil(try? result.get())
        }
        XCTAssertTrue(waitUntil {
            if case .created = events.value.last { return true }
            return false
        })
        guard case .created(let created) = events.value.last else {
            return XCTFail("expected created pairing")
        }
        let originalRoom = created.pairID
        let originalURL = created.url
        XCTAssertEqual(tunnel.starts.count, 1)
        XCTAssertEqual(tunnel.starts[0].roomID, originalRoom)
        XCTAssertEqual(store.load()?.roomID, originalRoom)

        // Normal stop (app quit / client replace): disconnect only, keep credentials.
        first.stop(invalidatePairing: false)
        XCTAssertTrue(waitUntil { tunnel.stops.contains(false) })
        XCTAssertFalse(tunnel.stops.contains(true))
        XCTAssertEqual(store.load()?.roomID, originalRoom)

        events.withValue { $0.removeAll() }
        tunnel.reset()
        let second = makeClient()
        second.start()
        XCTAssertTrue(waitUntil {
            if case .created(let pairing) = events.value.last {
                return pairing.pairID == originalRoom
            }
            return false
        })
        XCTAssertEqual(tunnel.starts.count, 1)
        XCTAssertEqual(tunnel.starts[0].roomID, originalRoom)
        XCTAssertEqual(tunnel.starts[0].secret, store.load()?.secret)
        if case .created(let restored) = events.value.last {
            XCTAssertEqual(restored.url, originalURL)
        } else {
            XCTFail("restart must republish the same pairing URL")
        }

        // Generate again without forceNew must reuse the same room.
        events.withValue { $0.removeAll() }
        let startsBefore = tunnel.starts.count
        second.beginPairing(forceNew: false) { _ in }
        XCTAssertTrue(waitUntil {
            if case .created(let pairing) = events.value.last {
                return pairing.pairID == originalRoom
            }
            return false
        })
        XCTAssertEqual(
            tunnel.starts.count,
            startsBefore,
            "idempotent reuse must not bounce an already-active tunnel link"
        )

        second.stop(invalidatePairing: true)
        XCTAssertTrue(waitUntil { tunnel.stops.contains(true) })
        XCTAssertNil(store.load())
    }

    func testForceNewPairingInvalidatesPreviousRoom() {
        let store = RemoteTunnelPairingStore.memory()
        let tunnel = FakeRemoteTunnelLinkController()
        let lifecycleQueue = DispatchQueue(label: "RemoteRelayTests.tunnel-force-new")
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(string: "wss://tunnel.deepwood.cn/tunnel/ws")!,
            publicURL: URL(string: "https://remote.deepwood.cn/")!,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Force New"
        )
        let events = LockedTestBox<[RemotePairingLifecycleEvent]>([])
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            tunnelLink: tunnel,
            pairingStore: store,
            lifecycleQueue: lifecycleQueue,
            pairingChanged: { event in events.withValue { $0.append(event) } },
            stateChanged: { _ in }
        )
        client.start()
        client.beginPairing(forceNew: false) { _ in }
        XCTAssertTrue(waitUntil {
            if case .created = events.value.last { return true }
            return false
        })
        guard case .created(let first) = events.value.last else {
            return XCTFail("missing first pairing")
        }

        events.withValue { $0.removeAll() }
        client.beginPairing(forceNew: true) { _ in }
        XCTAssertTrue(waitUntil {
            if case .created(let pairing) = events.value.last {
                return pairing.pairID != first.pairID
            }
            return false
        })
        XCTAssertTrue(tunnel.stops.contains(true), "forceNew must end the previous room")
        XCTAssertNotEqual(store.load()?.roomID, first.pairID)
        client.stop(invalidatePairing: true)
    }

    func testTunnelHostScriptExposesDisconnectWithoutEnd() throws {
        let script = try String(
            contentsOf: repositoryRoot()
                .appendingPathComponent(
                    "Sources/PipiUI/Resources/RemoteP2P/tunnel-host.js"
                ),
            encoding: .utf8
        )
        XCTAssertTrue(script.contains("function disconnect"))
        XCTAssertTrue(script.contains("host disconnected"))
        XCTAssertTrue(script.contains("disconnect, resolveRequest")
            || script.contains("leave, disconnect, resolveRequest"))
        // leave keeps the intentional end frame; disconnect must not send it.
        let leaveRange = try XCTUnwrap(script.range(of: "function leave"))
        let disconnectRange = try XCTUnwrap(script.range(of: "function disconnect"))
        let leaveBody = String(script[leaveRange.lowerBound..<disconnectRange.lowerBound])
        XCTAssertTrue(leaveBody.contains("type: \"end\"") || leaveBody.contains("type:\"end\""))
        let afterDisconnect = String(script[disconnectRange.lowerBound...])
        let nextFn = afterDisconnect.range(of: "function start")?.lowerBound
            ?? afterDisconnect.endIndex
        let disconnectBody = String(afterDisconnect[..<nextFn])
        XCTAssertFalse(disconnectBody.contains("type: \"end\""))
        XCTAssertFalse(disconnectBody.contains("type:\"end\""))
    }

    func testStaleCallbacksCannotCancelReplacementSocketOrScheduleDuplicateRetry() {
        let first = FakeRemoteRelayWebSocketTask()
        let second = FakeRemoteRelayWebSocketTask()
        let tasks = LockedTestBox([first, second])
        let factoryIndex = LockedTestBox(0)
        let scheduled = LockedTestBox<[DispatchWorkItem]>([])
        let states = LockedTestBox<[RemoteRelayConnectionState]>([])
        let lifecycleQueue = DispatchQueue(label: "RemoteRelayTests.lifecycle")
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(string: "ws://127.0.0.1:1/host/ws")!,
            publicURL: URL(string: "http://127.0.0.1:1/")!,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Lifecycle Test"
        )
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            lifecycleQueue: lifecycleQueue,
            taskFactory: { _ in
                let index = factoryIndex.withValue { value -> Int in
                    defer { value += 1 }
                    return value
                }
                return tasks.value[index]
            },
            credentialsProvider: {
                RemoteRelayCredentials(
                    accessClientID: "test-client-id",
                    accessClientSecret: "test-client-secret",
                    deviceSecret: "test-device-secret"
                )
            },
            configurationValidator: { _ in true },
            retryDelayProvider: { _ in 0 },
            retryScheduler: { item, _ in
                scheduled.withValue { $0.append(item) }
            },
            stateChanged: { state in
                states.withValue { $0.append(state) }
            }
        )
        client.start()
        XCTAssertTrue(waitUntil { first.sendCompletionCount == 1 })
        guard case .string = first.sentMessages.first else {
            return XCTFail("hello must use a WebSocket text frame")
        }
        first.completeSend(at: 0, error: nil)
        XCTAssertTrue(waitUntil { first.receiveHandlerCount == 1 })

        guard let staleReceive = first.receiveHandlers.first else {
            return XCTFail("first task must have an installed receive callback")
        }
        staleReceive(.failure(TestRelayError.disconnected))
        XCTAssertTrue(waitUntil { scheduled.value.count == 1 })
        // A duplicate callback for the same failed generation is idempotently ignored.
        staleReceive(.failure(TestRelayError.disconnected))
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        XCTAssertEqual(scheduled.value.count, 1)

        let retry = scheduled.value[0]
        lifecycleQueue.async { retry.perform() }
        XCTAssertTrue(waitUntil { second.sendCompletionCount == 1 })
        second.completeSend(at: 0, error: nil)
        XCTAssertTrue(waitUntil { states.value.contains(.connected) })

        // A delayed callback from task A after task B is online cannot cancel B.
        staleReceive(.failure(TestRelayError.disconnected))
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        XCTAssertEqual(second.cancelCount, 0)
        XCTAssertEqual(scheduled.value.count, 1)

        client.stop()
        XCTAssertTrue(waitUntil { second.cancelCount == 1 })
    }

    func testRealURLSessionTransportUsesTextHelloAndCorrelatedTextResponseWithNode() throws {
        let root = repositoryRoot()
        let relay = root.appendingPathComponent("Relay", isDirectory: true)
        let fixture = relay.appendingPathComponent("test/swift-transport-fixture.mjs")
        let wsModule = relay.appendingPathComponent("node_modules/ws")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: wsModule.path),
            "run `cd Relay && npm install` before the Swift transport integration test"
        )

        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("pipiui-relay-integration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: temporary) }
        let portFile = temporary.appendingPathComponent("port")
        let resultFile = temporary.appendingPathComponent("result.json")
        let deviceID = UUID().uuidString.lowercased()

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [
            "node",
            fixture.path,
            portFile.path,
            resultFile.path,
            deviceID,
        ]
        process.currentDirectoryURL = relay
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        defer {
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
        }
        XCTAssertTrue(waitUntil {
            FileManager.default.fileExists(atPath: portFile.path) || !process.isRunning
        })
        let portText = try String(contentsOf: portFile, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let port = try XCTUnwrap(Int(portText).flatMap { $0 > 0 ? $0 : nil })
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: try XCTUnwrap(URL(string: "ws://127.0.0.1:\(port)/host/ws")),
            publicURL: try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/")),
            deviceID: deviceID,
            displayName: "Swift Integration"
        )
        let connected = expectation(description: "Swift client connected")
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            credentialsProvider: {
                RemoteRelayCredentials(
                    accessClientID: "integration-client-id",
                    accessClientSecret: "integration-client-secret",
                    deviceSecret: "integration-device-secret"
                )
            },
            configurationValidator: { _ in true },
            stateChanged: { state in
                if state == .connected { connected.fulfill() }
            }
        )
        client.start()
        wait(for: [connected], timeout: 5)
        XCTAssertTrue(waitUntil(timeout: 5) {
            FileManager.default.fileExists(atPath: resultFile.path) || !process.isRunning
        })
        client.stop()

        let data = try Data(contentsOf: resultFile)
        let result = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["helloText"] as? Bool, true)
        XCTAssertEqual(result["responseText"] as? Bool, true)
        XCTAssertEqual(result["correlated"] as? Bool, true)
        XCTAssertTrue(waitUntil(timeout: 2) { !process.isRunning })
        XCTAssertEqual(process.terminationStatus, 0)
    }
}

private enum TestRelayError: Error {
    case disconnected
}

private final class LockedTestBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Value

    init(_ value: Value) {
        storage = value
    }

    var value: Value {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    @discardableResult
    func withValue<Result>(_ body: (inout Value) -> Result) -> Result {
        lock.lock()
        defer { lock.unlock() }
        return body(&storage)
    }
}

private final class FakeRemoteTunnelLinkController:
    RemoteTunnelLinkControlling,
    @unchecked Sendable
{
    struct Start: Equatable {
        var roomID: String
        var secret: String
    }

    private let lock = NSLock()
    private var startRecords: [Start] = []
    private var stopRecords: [Bool] = []

    var starts: [Start] {
        lock.lock()
        defer { lock.unlock() }
        return startRecords
    }

    var stops: [Bool] {
        lock.lock()
        defer { lock.unlock() }
        return stopRecords
    }

    func reset() {
        lock.lock()
        startRecords = []
        stopRecords = []
        lock.unlock()
    }

    func startTunnelLink(
        roomID: String,
        secret: String,
        tunnelURL: URL,
        controller: RemoteHostController,
        event: @escaping (WebKitRemotePeerTransport.TunnelEvent) -> Void
    ) {
        lock.lock()
        startRecords.append(Start(roomID: roomID, secret: secret))
        lock.unlock()
        event(.ready)
    }

    func stopTunnelLink(invalidate: Bool) {
        lock.lock()
        stopRecords.append(invalidate)
        lock.unlock()
    }
}

private final class FakeRemoteRelayWebSocketTask:
    RemoteRelayWebSocketTask,
    @unchecked Sendable
{
    typealias ReceiveHandler = @Sendable (
        Result<URLSessionWebSocketTask.Message, Error>
    ) -> Void

    private let lock = NSLock()
    private var messages: [URLSessionWebSocketTask.Message] = []
    private var sendHandlers: [@Sendable (Error?) -> Void] = []
    private var receiveCallbacks: [ReceiveHandler] = []
    private var cancellations = 0

    var sentMessages: [URLSessionWebSocketTask.Message] {
        lock.lock()
        defer { lock.unlock() }
        return messages
    }

    var sendCompletionCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return sendHandlers.count
    }

    var receiveHandlerCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return receiveCallbacks.count
    }

    var receiveHandlers: [ReceiveHandler] {
        lock.lock()
        defer { lock.unlock() }
        return receiveCallbacks
    }

    var cancelCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancellations
    }

    func resume() {}

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        lock.lock()
        cancellations += 1
        lock.unlock()
    }

    func send(
        _ message: URLSessionWebSocketTask.Message,
        completionHandler: @escaping @Sendable (Error?) -> Void
    ) {
        lock.lock()
        messages.append(message)
        sendHandlers.append(completionHandler)
        lock.unlock()
    }

    func receive(completionHandler: @escaping ReceiveHandler) {
        lock.lock()
        receiveCallbacks.append(completionHandler)
        lock.unlock()
    }

    func sendPing(pongReceiveHandler: @escaping @Sendable (Error?) -> Void) {}

    func completeSend(at index: Int, error: Error?) {
        lock.lock()
        let callback = sendHandlers[index]
        lock.unlock()
        callback(error)
    }
}

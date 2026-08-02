import Security
import WebKit
import XCTest
@testable import PipiUI

final class RemotePeerConnectionTests: XCTestCase {
    private struct FingerprintVector: Decodable {
        let name: String
        let sdp: String
        let expected: String?

        var resolvedSDP: String {
            sdp.replacingOccurrences(
                of: "{{AB32}}",
                with: Array(repeating: "AB", count: 32).joined(separator: ":")
            )
        }
    }

    private let fingerprint = "sha-256 " + Array(
        repeating: "AA",
        count: 32
    ).joined(separator: ":")

    func testBrowserSnapshotFixturePassesExactSwiftCommandContract() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("RemoteBrowserCommandVectors.json")
        let vectors = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url))
                as? [[String: Any]]
        )
        let now = Date()
        for vector in vectors {
            let name = try XCTUnwrap(vector["name"] as? String)
            let body = try XCTUnwrap(vector["expectedBody"] as? [String: Any])
            let bodyData = try JSONSerialization.data(withJSONObject: body)
            XCTAssertTrue(
                RemoteCommandSchema.validate(command: .snapshot, body: bodyData),
                name
            )
            let requestData = try JSONSerialization.data(withJSONObject: [
                "v": 1,
                "type": "request",
                "requestID": UUID().uuidString.lowercased(),
                "command": "snapshot",
                "deadlineMs": Int64(
                    now.addingTimeInterval(5).timeIntervalSince1970 * 1_000
                ),
                "body": body,
            ])
            let request = try RemoteRelayProtocol.decodeRequest(
                requestData,
                now: now
            )
            XCTAssertEqual(request.command, .snapshot, name)
            let decodedBody = try XCTUnwrap(
                JSONSerialization.jsonObject(
                    with: request.body.encodedData()
                ) as? NSDictionary
            )
            XCTAssertEqual(decodedBody, body as NSDictionary, name)
        }
    }

    private func offerFrame(
        deviceID: String,
        connectionID: String = UUID().uuidString.lowercased(),
        sequence: Int = 1,
        expiresAt: Int64,
        offerSDP: String? = nil,
        offerFingerprint: String? = nil,
        extra: Bool = false
    ) throws -> Data {
        var value: [String: Any] = [
            "v": 1,
            "type": "signal.offer",
            "connectionID": connectionID,
            "deviceID": deviceID,
            "direction": "browser-to-device",
            "sequence": sequence,
            "expiresAt": expiresAt,
            "browserNonce": Data(repeating: 7, count: 32).base64URLEncodedString(),
            "offerSDP": offerSDP ?? "v=0\r\na=fingerprint:\(fingerprint)\r\n",
            "offerFingerprint": offerFingerprint ?? fingerprint,
        ]
        if extra { value["extra"] = true }
        return try JSONSerialization.data(withJSONObject: value)
    }

    private func loadFingerprintVectors() throws -> [FingerprintVector] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("RemotePeerSDPFingerprintVectors.json")
        return try JSONDecoder().decode(
            [FingerprintVector].self,
            from: Data(contentsOf: url)
        )
    }

    func testSharedSDPFingerprintVectorsMatchSwiftOfferDecoder() throws {
        let now = Date()
        let deviceID = UUID().uuidString.lowercased()
        let expiry = Int64(now.addingTimeInterval(5).timeIntervalSince1970 * 1_000)
        for vector in try loadFingerprintVectors() {
            XCTAssertEqual(
                RemotePeerConnectionProtocol.sdpFingerprint(vector.resolvedSDP),
                vector.expected,
                vector.name
            )
            let data = try offerFrame(
                deviceID: deviceID,
                expiresAt: expiry,
                offerSDP: vector.resolvedSDP,
                offerFingerprint: vector.expected ?? fingerprint
            )
            if vector.expected == nil {
                XCTAssertThrowsError(try RemotePeerConnectionProtocol.decodeIncoming(
                    data,
                    expectedDeviceID: deviceID,
                    now: now
                ), vector.name)
            } else {
                guard case .offer(let offer) =
                        try RemotePeerConnectionProtocol.decodeIncoming(
                            data,
                            expectedDeviceID: deviceID,
                            now: now
                        ) else {
                    return XCTFail("\(vector.name): expected offer")
                }
                XCTAssertEqual(offer.offerFingerprint, vector.expected, vector.name)
            }
        }
    }

    func testSignalingOfferIsExactDeviceBoundAndExpiring() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let deviceID = UUID().uuidString.lowercased()
        let expiry: Int64 = 1_030_000
        let decoded = try RemotePeerConnectionProtocol.decodeIncoming(
            offerFrame(deviceID: deviceID, expiresAt: expiry),
            expectedDeviceID: deviceID,
            now: now
        )
        guard case .offer(let offer) = decoded else {
            return XCTFail("expected offer")
        }
        XCTAssertEqual(offer.deviceID, deviceID)
        XCTAssertEqual(offer.sequence, 1)
        XCTAssertEqual(offer.offerFingerprint, fingerprint)

        XCTAssertThrowsError(try RemotePeerConnectionProtocol.decodeIncoming(
            offerFrame(deviceID: deviceID, expiresAt: expiry, extra: true),
            expectedDeviceID: deviceID,
            now: now
        ))
        XCTAssertThrowsError(try RemotePeerConnectionProtocol.decodeIncoming(
            offerFrame(deviceID: deviceID, sequence: 2, expiresAt: expiry),
            expectedDeviceID: deviceID,
            now: now
        ))
        XCTAssertThrowsError(try RemotePeerConnectionProtocol.decodeIncoming(
            offerFrame(deviceID: deviceID, expiresAt: expiry),
            expectedDeviceID: UUID().uuidString.lowercased(),
            now: now
        ))
        XCTAssertThrowsError(try RemotePeerConnectionProtocol.decodeIncoming(
            offerFrame(deviceID: deviceID, expiresAt: expiry),
            expectedDeviceID: deviceID,
            now: Date(timeIntervalSince1970: 1_031)
        ))
    }

    func testBindingTranscriptIsDeterministicAndP256Signed() throws {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
        ]
        let key = try XCTUnwrap(
            SecKeyCreateRandomKey(attributes as CFDictionary, nil)
        )
        let identity = try RemoteDeviceIdentity(
            deviceID: UUID().uuidString.lowercased(),
            signingKey: key,
            storage: .ephemeralTest
        )
        let material = RemotePeerAnswerMaterial(
            connectionID: UUID().uuidString.lowercased(),
            deviceID: identity.deviceID,
            expiresAt: 1_030_000,
            browserNonce: Data(repeating: 1, count: 32).base64URLEncodedString(),
            hostNonce: Data(repeating: 2, count: 32).base64URLEncodedString(),
            hostEpoch: UUID().uuidString.lowercased(),
            offerFingerprint: fingerprint,
            answerFingerprint: fingerprint.replacingOccurrences(of: "AA", with: "BB"),
            answerSDP: "v=0\r\n"
        )
        let transcript = RemotePeerConnectionProtocol.bindingTranscript(
            material: material,
            deviceFingerprint: identity.fingerprint
        )
        let signature = try identity.sign(transcript)
        XCTAssertTrue(identity.verify(signature, message: transcript))

        let changed = RemotePeerAnswerMaterial(
            connectionID: material.connectionID,
            deviceID: material.deviceID,
            expiresAt: material.expiresAt,
            browserNonce: material.browserNonce,
            hostNonce: material.hostNonce,
            hostEpoch: material.hostEpoch,
            offerFingerprint: material.offerFingerprint,
            answerFingerprint: material.answerFingerprint,
            answerSDP: "v=0\r\nchanged"
        )
        // SDP bytes are deliberately not in the transcript; the signed,
        // canonical DTLS fingerprint is the stable cryptographic commitment.
        XCTAssertEqual(
            transcript,
            RemotePeerConnectionProtocol.bindingTranscript(
                material: changed,
                deviceFingerprint: identity.fingerprint
            )
        )
        XCTAssertFalse(identity.verify(
            signature,
            message: RemotePeerConnectionProtocol.bindingTranscript(
                material: material,
                deviceFingerprint: String(repeating: "0", count: 64)
            )
        ))
        XCTAssertEqual(
            RemotePeerConnectionLimits.activeLeaseExpiresAt(
                signalingExpiresAt: material.expiresAt
            ),
            material.expiresAt
                + RemotePeerConnectionLimits.activeLeaseMilliseconds
        )
    }

    func testChunkingReassemblyCapsDuplicatesInflightAndExpiry() throws {
        let now = Date()
        let expiresAt = Int64(
            now.addingTimeInterval(5).timeIntervalSince1970 * 1_000
        )
        let data = Data(repeating: 9, count: 256 * 1024)
        let chunks = try RemotePeerChunker.envelopes(
            data: data,
            kind: "request",
            expiresAt: expiresAt,
            now: now
        )
        XCTAssertEqual(chunks.count, 4)
        XCTAssertTrue(chunks.allSatisfy {
            $0.decodedPayload.count <= RemotePeerConnectionLimits.maximumChunkPayloadBytes
        })
        let reassembler = RemotePeerChunkReassembler()
        var completed: Data?
        for chunk in chunks.reversed() {
            completed = try reassembler.accept(chunk, expectedKind: "request")
                ?? completed
        }
        XCTAssertEqual(completed, data)

        let duplicate = try RemotePeerChunker.envelopes(
            data: Data(repeating: 1, count: 70_000),
            kind: "request",
            expiresAt: expiresAt,
            now: now
        )
        XCTAssertNil(try reassembler.accept(duplicate[0], expectedKind: "request"))
        XCTAssertThrowsError(
            try reassembler.accept(duplicate[0], expectedKind: "request")
        )

        let saturated = RemotePeerChunkReassembler()
        for _ in 0..<RemotePeerConnectionLimits.maximumInflightMessages {
            let partial = try RemotePeerChunker.envelopes(
                data: Data(repeating: 3, count: 70_000),
                kind: "request",
                expiresAt: expiresAt,
                now: now
            )
            XCTAssertNil(try saturated.accept(partial[0], expectedKind: "request"))
        }
        let overflow = try RemotePeerChunker.envelopes(
            data: Data(repeating: 4, count: 70_000),
            kind: "request",
            expiresAt: expiresAt,
            now: now
        )
        XCTAssertThrowsError(
            try saturated.accept(overflow[0], expectedKind: "request")
        )
        XCTAssertEqual(saturated.collectExpired(
            now: Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1_000)
        ), RemotePeerConnectionLimits.maximumInflightMessages)

        XCTAssertThrowsError(try RemotePeerChunker.envelopes(
            data: Data(
                repeating: 0,
                count: RemotePeerConnectionLimits.maximumResponseBytes + 1
            ),
            kind: "response"
        ))
    }

    func testCommandAdapterRejectsChunkAttacksWithoutExecutingController() throws {
        let now = Date()
        let expiry = Int64(now.addingTimeInterval(5).timeIntervalSince1970 * 1_000)
        var commandCount = 0
        let controller = RemoteHostController { _, respond in
            commandCount += 1
            respond(.json(["unexpected": true]))
        }

        func failure(
            _ adapter: RemotePeerCommandAdapter,
            _ envelope: RemotePeerChunkEnvelope,
            now: Date = now
        ) -> Bool {
            var failed = false
            adapter.receive(
                envelopeData: try! JSONEncoder().encode(envelope),
                now: now
            ) {
                if case .failure = $0 { failed = true }
            }
            return failed
        }

        let duplicateAdapter = RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        )
        let duplicate = try RemotePeerChunker.envelopes(
            data: Data(repeating: 1, count: 70_000),
            kind: "request",
            expiresAt: expiry,
            now: now
        )
        XCTAssertFalse(failure(duplicateAdapter, duplicate[0]))
        XCTAssertTrue(failure(duplicateAdapter, duplicate[0]))

        let inconsistentAdapter = RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        )
        XCTAssertFalse(failure(inconsistentAdapter, duplicate[0]))
        var inconsistent = duplicate[1]
        inconsistent = RemotePeerChunkEnvelope(
            v: inconsistent.v,
            type: inconsistent.type,
            messageID: inconsistent.messageID,
            kind: inconsistent.kind,
            chunkIndex: inconsistent.chunkIndex,
            chunkCount: inconsistent.chunkCount,
            totalBytes: inconsistent.totalBytes - 1,
            expiresAt: inconsistent.expiresAt,
            payload: inconsistent.payload
        )
        XCTAssertTrue(failure(inconsistentAdapter, inconsistent))

        let invalidUTF8 = try XCTUnwrap(RemotePeerChunker.envelopes(
            data: Data([0xff]),
            kind: "request",
            expiresAt: expiry,
            now: now
        ).first)
        XCTAssertTrue(failure(RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        ), invalidUTF8))

        let invalidBase64 = RemotePeerChunkEnvelope(
            v: invalidUTF8.v,
            type: invalidUTF8.type,
            messageID: invalidUTF8.messageID,
            kind: invalidUTF8.kind,
            chunkIndex: invalidUTF8.chunkIndex,
            chunkCount: invalidUTF8.chunkCount,
            totalBytes: invalidUTF8.totalBytes,
            expiresAt: invalidUTF8.expiresAt,
            payload: "***"
        )
        XCTAssertTrue(failure(RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        ), invalidBase64))

        let oversized = RemotePeerChunkEnvelope(
            v: invalidUTF8.v,
            type: invalidUTF8.type,
            messageID: UUID().uuidString.lowercased(),
            kind: invalidUTF8.kind,
            chunkIndex: 0,
            chunkCount: 1,
            totalBytes: RemotePeerConnectionLimits.maximumRequestBytes + 1,
            expiresAt: invalidUTF8.expiresAt,
            payload: invalidUTF8.payload
        )
        XCTAssertTrue(failure(RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        ), oversized))

        var wrongKind = invalidUTF8
        wrongKind = RemotePeerChunkEnvelope(
            v: wrongKind.v,
            type: wrongKind.type,
            messageID: wrongKind.messageID,
            kind: "response",
            chunkIndex: wrongKind.chunkIndex,
            chunkCount: wrongKind.chunkCount,
            totalBytes: wrongKind.totalBytes,
            expiresAt: wrongKind.expiresAt,
            payload: wrongKind.payload
        )
        XCTAssertTrue(failure(RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        ), wrongKind))

        let request = RemoteRelayRequestFrame(
            v: RemoteRelayLimits.protocolVersion,
            type: "request",
            requestID: UUID().uuidString.lowercased(),
            command: .index,
            deadlineMs: expiry,
            body: .object([:])
        )
        let requestData = try JSONEncoder().encode(request)
        let deadlineMismatch = RemotePeerChunkEnvelope(
            v: 1,
            type: "chunk",
            messageID: UUID().uuidString.lowercased(),
            kind: "request",
            chunkIndex: 0,
            chunkCount: 1,
            totalBytes: requestData.count,
            expiresAt: expiry - 1,
            payload: requestData.base64URLEncodedString()
        )
        XCTAssertTrue(failure(RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        ), deadlineMismatch))

        let expiredAdapter = RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        )
        XCTAssertTrue(failure(
            expiredAdapter,
            invalidUTF8,
            now: Date(timeIntervalSince1970: TimeInterval(expiry) / 1_000)
        ))

        let overflowAdapter = RemotePeerCommandAdapter(
            controller: controller,
            hostEpoch: UUID().uuidString.lowercased()
        )
        for _ in 0..<RemotePeerConnectionLimits.maximumInflightMessages {
            let partial = try RemotePeerChunker.envelopes(
                data: Data(repeating: 3, count: 70_000),
                kind: "request",
                expiresAt: expiry,
                now: now
            )
            XCTAssertFalse(failure(overflowAdapter, partial[0]))
        }
        let overflow = try RemotePeerChunker.envelopes(
            data: Data(repeating: 4, count: 70_000),
            kind: "request",
            expiresAt: expiry,
            now: now
        )
        XCTAssertTrue(failure(overflowAdapter, overflow[0]))
        XCTAssertEqual(commandCount, 0)
    }

    func testReassemblyUsesMessageDeadlineBeforeFixedLifetime() throws {
        let now = Date()
        let expiry = Int64(now.addingTimeInterval(1).timeIntervalSince1970 * 1_000)
        let chunks = try RemotePeerChunker.envelopes(
            data: Data(repeating: 2, count: 70_000),
            kind: "request",
            expiresAt: expiry,
            now: now
        )
        let reassembler = RemotePeerChunkReassembler()
        XCTAssertNil(try reassembler.accept(chunks[0], expectedKind: "request", now: now))
        XCTAssertEqual(reassembler.count, 1)
        XCTAssertEqual(
            reassembler.collectExpired(now: now.addingTimeInterval(1.1)),
            1
        )
    }

    @MainActor
    func testRelayClientRejectsBadConnectionLocallyThenAcceptsValidOffer() async throws {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
        ]
        let identity = try RemoteDeviceIdentity(
            deviceID: UUID().uuidString.lowercased(),
            signingKey: try XCTUnwrap(
                SecKeyCreateRandomKey(attributes as CFDictionary, nil)
            ),
            storage: .ephemeralTest
        )
        let socket = PeerConnectionTestSocket()
        let peer = PeerConnectionTestTransport()
        var states: [RemoteRelayConnectionState] = []
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(
                string: "wss://signal.aichattrpg.com/device/ws"
            )!,
            publicURL: URL(string: "https://pipi.aichattrpg.com/")!,
            deviceID: identity.deviceID,
            displayName: "Peer signaling test"
        )
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            peerTransport: peer,
            taskFactory: { _ in socket },
            identityProvider: { identity },
            configurationValidator: { _ in true },
            stateChanged: { states.append($0) }
        )
        client.start()
        let didStartReceiving = await waitUntil { socket.hasReceiver }
        XCTAssertTrue(didStartReceiving)
        let challenge = RemoteDeviceAuthChallenge(
            v: 1,
            type: "auth.challenge",
            connectionID: UUID().uuidString.lowercased(),
            nonce: Data(repeating: 6, count: 32).base64URLEncodedString(),
            audience: "https://signal.aichattrpg.com",
            expiresAt: Int64(Date().addingTimeInterval(4).timeIntervalSince1970 * 1_000)
        )
        socket.deliver(.string(String(
            data: try JSONEncoder().encode(challenge),
            encoding: .utf8
        )!))
        let didSendProof = await waitUntil {
            socket.sent.count == 1 && socket.hasReceiver
        }
        XCTAssertTrue(didSendProof)
        socket.deliver(.string(String(
            data: try JSONEncoder().encode(RemoteDeviceAuthResult(
                v: 1,
                type: "auth.result",
                enrollmentStatus: "active",
                commandAuthorized: true
            )),
            encoding: .utf8
        )!))
        let didAuthenticate = await waitUntil {
            states.contains(.connected) && socket.hasReceiver
        }
        XCTAssertTrue(didAuthenticate)

        let connectionID = UUID().uuidString.lowercased()
        let expiresAt = Int64(
            Date().addingTimeInterval(30).timeIntervalSince1970 * 1_000
        )
        var badObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: offerFrame(
                deviceID: identity.deviceID,
                connectionID: UUID().uuidString.lowercased(),
                expiresAt: expiresAt
            )) as? [String: Any]
        )
        badObject["offerFingerprint"] = fingerprint.replacingOccurrences(
            of: "AA",
            with: "CC"
        )
        socket.deliver(.string(String(
            data: try JSONSerialization.data(withJSONObject: badObject),
            encoding: .utf8
        )!))
        let didRejectBadOfferLocally = await waitUntil {
            socket.sent.count == 2 && socket.hasReceiver
        }
        XCTAssertTrue(didRejectBadOfferLocally)
        XCTAssertFalse(states.contains(.protocolMismatch))
        XCTAssertEqual(peer.acceptCount, 0)

        let offerData = try offerFrame(
            deviceID: identity.deviceID,
            connectionID: connectionID,
            expiresAt: expiresAt
        )
        socket.deliver(.string(String(data: offerData, encoding: .utf8)!))
        let didInstallBinding = await waitUntil {
            peer.acceptedConnectionID == connectionID
                && peer.installedConnectionID == connectionID
                && socket.sent.count >= 3
                && socket.hasReceiver
        }
        XCTAssertTrue(didInstallBinding)
        let answerText = try XCTUnwrap(socket.sent.last)
        let answer = try JSONDecoder().decode(
            RemoteDeviceAnswerSignal.self,
            from: Data(answerText.utf8)
        )
        XCTAssertEqual(answer.sequence, 1)
        let material = try XCTUnwrap(peer.answerMaterial)
        XCTAssertTrue(identity.verify(
            try XCTUnwrap(Data(base64URLEncoded: answer.signatureDER)),
            message: RemotePeerConnectionProtocol.bindingTranscript(
                material: material,
                deviceFingerprint: identity.fingerprint
            )
        ))

        socket.deliver(.string(String(
            data: try JSONEncoder().encode(RemoteBindingRevokedFrame(
                v: 1,
                type: "binding.revoked",
                subject: "cf:other",
                deviceID: identity.deviceID,
                connectionIDs: [UUID().uuidString.lowercased()]
            )),
            encoding: .utf8
        )!))
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertTrue(peer.closedConnectionIDs.isEmpty)

        socket.deliver(.string(String(
            data: try JSONEncoder().encode(RemoteBindingRevokedFrame(
                v: 1,
                type: "binding.revoked",
                subject: "cf:current",
                deviceID: identity.deviceID,
                connectionIDs: [connectionID]
            )),
            encoding: .utf8
        )!))
        let didCloseRevokedConnection = await waitUntil {
            peer.closedConnectionIDs == [connectionID]
        }
        XCTAssertTrue(didCloseRevokedConnection)
        client.stop()
    }

    @MainActor
    func testLoadedWKBindingSurvivesSignalingExpiryAndExecutesOneCommand() async throws {
        let ready = expectation(description: "production WK host ready")
        let answer = expectation(description: "production answer bridged")
        let fake = WKUserScript(
            source: Self.fakeProductionPeer,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        var installed = false
        let identity = try RemoteDeviceIdentity(
            deviceID: UUID().uuidString.lowercased(),
            signingKey: try XCTUnwrap(SecKeyCreateRandomKey([
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits as String: 256,
            ] as CFDictionary, nil)),
            storage: .ephemeralTest
        )
        let hostEpoch = UUID().uuidString.lowercased()
        var commandCount = 0
        var productionStates: [RemotePeerProductionState] = []
        let controller = RemoteHostController { request, respond in
            commandCount += 1
            XCTAssertEqual(request.command, .index)
            respond(.json(status: 207, ["ok": "p2p"]))
        }
        let transport = WebKitRemotePeerTransport(
            userScriptsForTesting: [fake],
            productionStateChanged: { productionStates.append($0) },
            stateChanged: { state in
                if state == .ready { ready.fulfill() }
            }
        )
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [ready], timeout: 5)

        let connectionID = UUID().uuidString.lowercased()
        let expiry = Int64(Date().addingTimeInterval(1).timeIntervalSince1970 * 1_000)
        let offer = RemotePeerConnectionOffer(
            connectionID: connectionID,
            deviceID: identity.deviceID,
            sequence: 1,
            expiresAt: expiry,
            browserNonce: Data(repeating: 8, count: 32).base64URLEncodedString(),
            offerSDP: "v=0\r\na=fingerprint:\(fingerprint)\r\n",
            offerFingerprint: fingerprint
        )
        try transport.acceptConnection(
            offer: offer,
            hostEpoch: hostEpoch,
            controller: controller
        ) { event in
            guard case .answer(let material) = event, !installed else { return }
            installed = true
            XCTAssertEqual(material.connectionID, connectionID)
            do {
                let signature = try identity.sign(
                    RemotePeerConnectionProtocol.bindingTranscript(
                        material: material,
                        deviceFingerprint: identity.fingerprint
                    )
                )
                try transport.installBinding(RemotePeerBindFrame(
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
                    activeLeaseExpiresAt:
                        RemotePeerConnectionLimits.activeLeaseExpiresAt(
                            signalingExpiresAt: material.expiresAt
                        )!,
                    offerFingerprint: material.offerFingerprint,
                    answerFingerprint: material.answerFingerprint,
                    signatureDER: signature.base64URLEncodedString()
                ))
            } catch {
                XCTFail("binding install failed: \(error)")
            }
            answer.fulfill()
        }
        await fulfillment(of: [answer], timeout: 5)
        try await Task.sleep(nanoseconds: 50_000_000)
        let first = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteSent[0]"
        ) as? String
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(first).utf8))
                as? [String: Any]
        )
        XCTAssertEqual(object["type"] as? String, "bind")
        XCTAssertEqual(object["connectionID"] as? String, connectionID)
        let bind = try RemotePeerBindFrame.decodeExact(Data(try XCTUnwrap(first).utf8))
        XCTAssertEqual(bind.deviceID, identity.deviceID)
        XCTAssertEqual(bind.hostEpoch, hostEpoch)
        XCTAssertEqual(bind.browserNonce, offer.browserNonce)
        XCTAssertEqual(bind.expiresAt, expiry)
        XCTAssertEqual(
            bind.activeLeaseExpiresAt,
            expiry + RemotePeerConnectionLimits.activeLeaseMilliseconds
        )
        XCTAssertEqual(bind.offerFingerprint, fingerprint)
        XCTAssertEqual(
            bind.answerFingerprint,
            fingerprint.replacingOccurrences(of: "AA", with: "BB")
        )
        XCTAssertTrue(bind.verifiesSignature())
        XCTAssertTrue(productionStates.contains(.negotiating))
        XCTAssertTrue(productionStates.contains(.connected))

        let untilExpired = max(
            0,
            TimeInterval(expiry) / 1_000 - Date().timeIntervalSince1970 + 0.15
        )
        try await Task.sleep(nanoseconds: UInt64(untilExpired * 1_000_000_000))
        let requestNow = Date()
        let request = RemoteRelayRequestFrame(
            v: RemoteRelayLimits.protocolVersion,
            type: "request",
            requestID: UUID().uuidString.lowercased(),
            command: .index,
            deadlineMs: Int64(
                requestNow.addingTimeInterval(5).timeIntervalSince1970 * 1_000
            ),
            body: .object([:])
        )
        let requestChunk = try XCTUnwrap(RemotePeerChunker.envelopes(
            data: JSONEncoder().encode(request),
            kind: "request",
            now: requestNow
        ).first)
        transport.acceptBridgeMessageForTesting([
            "v": 1,
            "type": "connectionData",
            "generation": "stale-generation-value",
            "connectionID": connectionID,
            "envelope": try JSONSerialization.jsonObject(
                with: JSONEncoder().encode(requestChunk)
            ),
        ])
        XCTAssertEqual(commandCount, 0)
        let requestChunkJSON = try XCTUnwrap(String(
            data: JSONEncoder().encode(requestChunk),
            encoding: .utf8
        ))
        _ = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteChannel.onmessage({data: JSON.stringify(\(requestChunkJSON))}); true"
        )
        let didExecute = await waitUntil { commandCount == 1 }
        XCTAssertTrue(didExecute)
        try await Task.sleep(nanoseconds: 100_000_000)
        let responseText = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteSent[1]"
        ) as? String
        let responseEnvelope = try RemotePeerChunkEnvelope.decodeExact(
            Data(try XCTUnwrap(responseText).utf8)
        )
        XCTAssertEqual(responseEnvelope.kind, "response")
        XCTAssertEqual(responseEnvelope.messageID, requestChunk.messageID)
        let responseData = try XCTUnwrap(RemotePeerChunkReassembler().accept(
            responseEnvelope,
            expectedKind: "response"
        ))
        let responseObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        )
        XCTAssertEqual(
            Set(responseObject.keys),
            ["v", "type", "requestID", "hostEpoch", "status", "body"]
        )
        let responseFrame = try JSONDecoder().decode(
            RemoteRelayResponseFrame.self,
            from: responseData
        )
        XCTAssertEqual(responseFrame.requestID, request.requestID)
        XCTAssertEqual(responseFrame.hostEpoch, hostEpoch)
        XCTAssertEqual(responseFrame.status, 207)
        XCTAssertEqual(responseFrame.body, .object(["ok": .string("p2p")]))
        XCTAssertEqual(commandCount, 1)

        _ = try await transport.evaluateJavaScriptForTesting(
            """
            Date.now = () => \(bind.activeLeaseExpiresAt);
            window.__pipiRemoteChannel.onmessage({
              data: JSON.stringify(\(requestChunkJSON))
            });
            true
            """
        )
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(
            commandCount,
            1,
            "the WK host must reject commands at the exact signed lease deadline"
        )
        let expiredState = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteChannel.readyState"
        ) as? String
        XCTAssertEqual(expiredState, "closed")
    }

    @MainActor
    func testLoadedWKPreBindDataClosesWithoutExecutingController() async throws {
        let ready = expectation(description: "production WK host ready")
        let answered = expectation(description: "production answer bridged")
        let transport = WebKitRemotePeerTransport(
            userScriptsForTesting: [WKUserScript(
                source: Self.fakeProductionPeer,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )]
        ) { state in
            if state == .ready { ready.fulfill() }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [ready], timeout: 5)
        var commandCount = 0
        let controller = RemoteHostController { _, respond in
            commandCount += 1
            respond(.json(["unexpected": true]))
        }
        let now = Date()
        let offer = RemotePeerConnectionOffer(
            connectionID: UUID().uuidString.lowercased(),
            deviceID: UUID().uuidString.lowercased(),
            sequence: 1,
            expiresAt: Int64(now.addingTimeInterval(5).timeIntervalSince1970 * 1_000),
            browserNonce: Data(repeating: 8, count: 32).base64URLEncodedString(),
            offerSDP: "v=0\r\na=fingerprint:\(fingerprint)\r\n",
            offerFingerprint: fingerprint
        )
        try transport.acceptConnection(
            offer: offer,
            hostEpoch: UUID().uuidString.lowercased(),
            controller: controller
        ) { event in
            if case .answer = event { answered.fulfill() }
        }
        await fulfillment(of: [answered], timeout: 5)
        let request = RemoteRelayRequestFrame(
            v: 1,
            type: "request",
            requestID: UUID().uuidString.lowercased(),
            command: .index,
            deadlineMs: Int64(now.addingTimeInterval(4).timeIntervalSince1970 * 1_000),
            body: .object([:])
        )
        let chunk = try XCTUnwrap(RemotePeerChunker.envelopes(
            data: JSONEncoder().encode(request),
            kind: "request",
            now: now
        ).first)
        let json = try XCTUnwrap(String(
            data: JSONEncoder().encode(chunk),
            encoding: .utf8
        ))
        _ = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteChannel.onmessage({data: JSON.stringify(\(json))}); true"
        )
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(commandCount, 0)
        let state = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteChannel.readyState"
        ) as? String
        XCTAssertEqual(state, "closed")
    }

    @MainActor
    func testLoadedWKUnboundConnectionClosesAtSignalingExpiry() async throws {
        let ready = expectation(description: "production WK host ready")
        let answered = expectation(description: "production answer bridged")
        let transport = WebKitRemotePeerTransport(
            userScriptsForTesting: [WKUserScript(
                source: Self.fakeProductionPeer,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )]
        ) { state in
            if state == .ready { ready.fulfill() }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [ready], timeout: 5)
        var commandCount = 0
        let controller = RemoteHostController { _, respond in
            commandCount += 1
            respond(.json(["unexpected": true]))
        }
        let offer = RemotePeerConnectionOffer(
            connectionID: UUID().uuidString.lowercased(),
            deviceID: UUID().uuidString.lowercased(),
            sequence: 1,
            expiresAt: Int64(
                Date().addingTimeInterval(0.25).timeIntervalSince1970 * 1_000
            ),
            browserNonce: Data(repeating: 8, count: 32).base64URLEncodedString(),
            offerSDP: "v=0\r\na=fingerprint:\(fingerprint)\r\n",
            offerFingerprint: fingerprint
        )
        try transport.acceptConnection(
            offer: offer,
            hostEpoch: UUID().uuidString.lowercased(),
            controller: controller
        ) { event in
            if case .answer = event { answered.fulfill() }
        }
        await fulfillment(of: [answered], timeout: 5)
        try await Task.sleep(nanoseconds: 350_000_000)
        let state = try await transport.evaluateJavaScriptForTesting(
            "window.__pipiRemoteChannel.readyState"
        ) as? String
        XCTAssertEqual(state, "closed")
        XCTAssertEqual(commandCount, 0)
    }

    @MainActor
    func testLoadedWKSharedSDPFingerprintVectorsMatchOffersAndAnswers() async throws {
        let ready = expectation(description: "production WK host ready")
        let transport = WebKitRemotePeerTransport(
            userScriptsForTesting: [WKUserScript(
                source: Self.fakeProductionPeer,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )]
        ) { state in
            if state == .ready { ready.fulfill() }
        }
        transport.start()
        defer { transport.stop() }
        await fulfillment(of: [ready], timeout: 5)

        let deviceID = UUID().uuidString.lowercased()
        let hostEpoch = UUID().uuidString.lowercased()
        let controller = RemoteHostController { _, respond in
            respond(.json(["unexpected": true]))
        }
        let canonicalAnswerSDP =
            "v=0\r\na=fingerprint:\(fingerprint.replacingOccurrences(of: "AA", with: "BB"))\r\n"

        for vector in try loadFingerprintVectors() {
            let encodedCanonicalAnswer = try XCTUnwrap(String(
                data: JSONEncoder().encode(canonicalAnswerSDP),
                encoding: .utf8
            ))
            _ = try await transport.evaluateJavaScriptForTesting(
                "window.__pipiAnswerSDP = \(encodedCanonicalAnswer); true"
            )
            var offerEvent: RemotePeerHostEvent?
            let offer = RemotePeerConnectionOffer(
                connectionID: UUID().uuidString.lowercased(),
                deviceID: deviceID,
                sequence: 1,
                expiresAt: Int64(
                    Date().addingTimeInterval(5).timeIntervalSince1970 * 1_000
                ),
                browserNonce: Data(repeating: 8, count: 32)
                    .base64URLEncodedString(),
                offerSDP: vector.resolvedSDP,
                offerFingerprint: vector.expected ?? fingerprint
            )
            try transport.acceptConnection(
                offer: offer,
                hostEpoch: hostEpoch,
                controller: controller
            ) { event in
                switch event {
                case .answer, .close:
                    if offerEvent == nil { offerEvent = event }
                case .candidate:
                    break
                }
            }
            let receivedOfferEvent = await waitUntil { offerEvent != nil }
            XCTAssertTrue(receivedOfferEvent, vector.name)
            if vector.expected == nil {
                guard case .close? = offerEvent else {
                    return XCTFail("\(vector.name): WK accepted invalid offer")
                }
            } else {
                guard case .answer(let material)? = offerEvent else {
                    return XCTFail("\(vector.name): WK rejected valid offer")
                }
                XCTAssertEqual(material.offerFingerprint, vector.expected, vector.name)
                transport.closeConnection(
                    connectionID: offer.connectionID,
                    reason: "offer vector complete"
                )
            }

            let encodedAnswer = try XCTUnwrap(String(
                data: JSONEncoder().encode(vector.resolvedSDP),
                encoding: .utf8
            ))
            _ = try await transport.evaluateJavaScriptForTesting(
                "window.__pipiAnswerSDP = \(encodedAnswer); true"
            )
            var answerEvent: RemotePeerHostEvent?
            let answerOffer = RemotePeerConnectionOffer(
                connectionID: UUID().uuidString.lowercased(),
                deviceID: deviceID,
                sequence: 1,
                expiresAt: Int64(
                    Date().addingTimeInterval(5).timeIntervalSince1970 * 1_000
                ),
                browserNonce: Data(repeating: 9, count: 32)
                    .base64URLEncodedString(),
                offerSDP: "v=0\r\na=fingerprint:\(fingerprint)\r\n",
                offerFingerprint: fingerprint
            )
            try transport.acceptConnection(
                offer: answerOffer,
                hostEpoch: hostEpoch,
                controller: controller
            ) { event in
                switch event {
                case .answer, .close:
                    if answerEvent == nil { answerEvent = event }
                case .candidate:
                    break
                }
            }
            let receivedAnswerEvent = await waitUntil { answerEvent != nil }
            XCTAssertTrue(receivedAnswerEvent, vector.name)
            if let expected = vector.expected {
                guard case .answer(let material)? = answerEvent else {
                    return XCTFail("\(vector.name): WK rejected valid answer")
                }
                XCTAssertEqual(material.answerFingerprint, expected, vector.name)
                transport.closeConnection(
                    connectionID: answerOffer.connectionID,
                    reason: "answer vector complete"
                )
            } else {
                guard case .close? = answerEvent else {
                    return XCTFail("\(vector.name): WK accepted invalid answer")
                }
            }
        }
    }

    private static let fakeProductionPeer = #"""
    window.__pipiRemoteSent = [];
    class PipiFakeChannel {
      constructor() {
        this.label = "pipiui.remote.v1";
        this.ordered = true;
        this.maxRetransmits = null;
        this.maxPacketLifeTime = null;
        this.readyState = "open";
        this.bufferedAmount = 0;
      }
      send(value) { window.__pipiRemoteSent.push(value); }
      close() { this.readyState = "closed"; }
    }
    class PipiFakePeer {
      constructor() {
        this.connectionState = "new";
        this.localDescription = null;
      }
      async setRemoteDescription() {
        queueMicrotask(() => {
          if (this.ondatachannel) {
            const channel = new PipiFakeChannel();
            window.__pipiRemoteChannel = channel;
            this.ondatachannel({channel});
            queueMicrotask(() => channel.onopen && channel.onopen());
          }
        });
      }
      async createAnswer() {
        return {
          type: "answer",
          sdp: window.__pipiAnswerSDP || "v=0\r\na=fingerprint:sha-256 BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB\r\n"
        };
      }
      async setLocalDescription(value) {
        this.localDescription = value;
        queueMicrotask(() => this.onicecandidate && this.onicecandidate({
          candidate: {
            candidate: "candidate:1 1 udp 1 127.0.0.1 5000 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0
          }
        }));
      }
      async addIceCandidate() {}
      close() { this.connectionState = "closed"; }
    }
    window.RTCPeerConnection = PipiFakePeer;
    """#

    @MainActor
    private func waitUntil(
        timeout: TimeInterval = 2,
        _ condition: () -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return condition()
    }
}

private final class PeerConnectionTestSocket: RemoteRelayWebSocketTask, @unchecked Sendable {
    private let lock = NSLock()
    private var receiver: (@Sendable (
        Result<URLSessionWebSocketTask.Message, Error>
    ) -> Void)?
    private var sentStorage: [String] = []

    var hasReceiver: Bool {
        lock.lock()
        defer { lock.unlock() }
        return receiver != nil
    }

    var sent: [String] {
        lock.lock()
        defer { lock.unlock() }
        return sentStorage
    }

    func resume() {}
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {}

    func send(
        _ message: URLSessionWebSocketTask.Message,
        completionHandler: @escaping @Sendable (Error?) -> Void
    ) {
        lock.lock()
        if case .string(let value) = message { sentStorage.append(value) }
        lock.unlock()
        completionHandler(nil)
    }

    func receive(
        completionHandler: @escaping @Sendable (
            Result<URLSessionWebSocketTask.Message, Error>
        ) -> Void
    ) {
        lock.lock()
        receiver = completionHandler
        lock.unlock()
    }

    func sendPing(pongReceiveHandler: @escaping @Sendable (Error?) -> Void) {
        pongReceiveHandler(nil)
    }

    func deliver(_ message: URLSessionWebSocketTask.Message) {
        lock.lock()
        let completion = receiver
        receiver = nil
        lock.unlock()
        completion?(.success(message))
    }
}

private final class PeerConnectionTestTransport: RemotePeerSignalingTransport {
    private(set) var acceptedConnectionID: String?
    private(set) var installedConnectionID: String?
    private(set) var answerMaterial: RemotePeerAnswerMaterial?
    private(set) var acceptCount = 0
    private let closeLock = NSLock()
    private var closedConnectionIDStorage: [String] = []

    var closedConnectionIDs: [String] {
        closeLock.lock()
        defer { closeLock.unlock() }
        return closedConnectionIDStorage
    }

    func acceptConnection(
        offer: RemotePeerConnectionOffer,
        hostEpoch: String,
        controller: RemoteHostController,
        emit: @escaping (RemotePeerHostEvent) -> Void
    ) throws {
        acceptedConnectionID = offer.connectionID
        acceptCount += 1
        let material = RemotePeerAnswerMaterial(
            connectionID: offer.connectionID,
            deviceID: offer.deviceID,
            expiresAt: offer.expiresAt,
            browserNonce: offer.browserNonce,
            hostNonce: Data(repeating: 3, count: 32).base64URLEncodedString(),
            hostEpoch: hostEpoch,
            offerFingerprint: offer.offerFingerprint,
            answerFingerprint: "sha-256 " + Array(
                repeating: "BB",
                count: 32
            ).joined(separator: ":"),
            answerSDP: "v=0\r\na=fingerprint:sha-256 "
                + Array(repeating: "BB", count: 32).joined(separator: ":")
                + "\r\n"
        )
        answerMaterial = material
        emit(.answer(material))
    }

    func addRemoteCandidate(
        connectionID: String,
        candidate: RemotePeerICECandidate
    ) throws {}

    func installBinding(_ frame: RemotePeerBindFrame) throws {
        installedConnectionID = frame.connectionID
    }

    func closeConnection(connectionID: String, reason: String) {
        closeLock.lock()
        closedConnectionIDStorage.append(connectionID)
        closeLock.unlock()
    }
}

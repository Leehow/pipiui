import CryptoKit
import Foundation
import Security
import XCTest
@testable import PipiUI

final class RemoteDeviceIdentityTests: XCTestCase {
    @discardableResult
    private func waitUntil(
        timeout: TimeInterval = 2,
        _ condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        return condition()
    }

    private func ephemeralIdentity(
        deviceID: String = UUID().uuidString
    ) throws -> RemoteDeviceIdentity {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
        ]
        var error: Unmanaged<CFError>?
        let key = try XCTUnwrap(
            SecKeyCreateRandomKey(attributes as CFDictionary, &error)
        )
        XCTAssertNil(error)
        return try RemoteDeviceIdentity(
            deviceID: deviceID,
            signingKey: key,
            storage: .ephemeralTest
        )
    }

    func testEphemeralInjectedIdentitiesAreIndependentAndNeverUseKeychain() throws {
        let firstStore = EphemeralIdentityStore {
            try self.ephemeralIdentity()
        }
        let secondStore = EphemeralIdentityStore {
            try self.ephemeralIdentity()
        }
        let first = try firstStore.loadOrCreate()
        let second = try secondStore.loadOrCreate()

        XCTAssertEqual(first.storage, .ephemeralTest)
        XCTAssertEqual(second.storage, .ephemeralTest)
        XCTAssertNotEqual(first.deviceID, second.deviceID)
        XCTAssertNotEqual(first.publicKeyX963, second.publicKeyX963)
        XCTAssertNotEqual(first.fingerprint, second.fingerprint)
        XCTAssertEqual(firstStore.loadCount, 1)
        XCTAssertEqual(secondStore.loadCount, 1)
    }

    func testPublicKeyFingerprintAndDERSignatureRoundTrip() throws {
        let identity = try ephemeralIdentity()
        XCTAssertEqual(identity.publicKeyX963.count, 65)
        XCTAssertEqual(identity.publicKeyX963.first, 0x04)
        XCTAssertEqual(identity.fingerprint.count, 64)
        XCTAssertEqual(
            identity.fingerprint,
            SHA256.hash(data: identity.publicKeyX963)
                .map { String(format: "%02x", $0) }
                .joined()
        )

        let message = Data("canonical transcript".utf8)
        let signature = try identity.sign(message)
        XCTAssertEqual(signature.first, 0x30, "ECDSA signature must use DER encoding")
        XCTAssertTrue(identity.verify(signature, message: message))
        XCTAssertFalse(identity.verify(signature, message: Data("different".utf8)))
    }

    func testStrictChallengeBuildsVerifiableProofAndRejectsUnknownFields() throws {
        let identity = try ephemeralIdentity()
        let now = Date(timeIntervalSince1970: 10_000)
        let challengeObject: [String: Any] = [
            "v": 1,
            "type": "auth.challenge",
            "connectionID": UUID().uuidString.lowercased(),
            "nonce": Data(repeating: 7, count: 32).base64URLEncodedString(),
            "audience": "https://pipi.aichattrpg.com",
            "expiresAt": 10_004_000,
        ]
        let challengeData = try JSONSerialization.data(withJSONObject: challengeObject)
        let challenge = try RemoteSignalingProtocol.decodeChallenge(
            challengeData,
            expectedAudience: "https://pipi.aichattrpg.com",
            now: now
        )
        let hostEpoch = UUID().uuidString.lowercased()
        let proof = try RemoteSignalingProtocol.makeProof(
            challenge: challenge,
            identity: identity,
            hostEpoch: hostEpoch,
            clientVersion: "test",
            displayName: "Test Mac"
        )
        let transcript = RemoteSignalingProtocol.authTranscript(
            challenge: challenge,
            deviceID: identity.deviceID,
            hostEpoch: hostEpoch,
            fingerprint: identity.fingerprint
        )
        let signature = try XCTUnwrap(Data(base64URLEncoded: proof.signatureDER))
        XCTAssertTrue(identity.verify(signature, message: transcript))
        XCTAssertEqual(proof.publicKeyX963, identity.publicKeyX963.base64URLEncodedString())

        var unknown = challengeObject
        unknown["token"] = "forbidden"
        XCTAssertThrowsError(try RemoteSignalingProtocol.decodeChallenge(
            JSONSerialization.data(withJSONObject: unknown),
            expectedAudience: "https://pipi.aichattrpg.com",
            now: now
        )) {
            XCTAssertEqual(
                $0 as? RemoteSignalingProtocolError,
                .invalidEnvelope
            )
        }
        XCTAssertThrowsError(try RemoteSignalingProtocol.decodeChallenge(
            challengeData,
            expectedAudience: "https://other.example",
            now: now
        ))
    }

    func testChallengeFutureToleranceAcceptsClockSkewButRejectsExpiredOrTooFar() throws {
        let now = Date(timeIntervalSince1970: 10_000)
        let audience = "https://signal.aichattrpg.com"
        func challenge(expiresAt: Int64) throws -> Data {
            try JSONSerialization.data(withJSONObject: [
                "v": 1,
                "type": "auth.challenge",
                "connectionID": UUID().uuidString.lowercased(),
                "nonce": Data(repeating: 9, count: 32).base64URLEncodedString(),
                "audience": audience,
                "expiresAt": expiresAt,
            ])
        }

        XCTAssertNoThrow(try RemoteSignalingProtocol.decodeChallenge(
            challenge(expiresAt: 10_005_100),
            expectedAudience: audience,
            now: now
        ))
        XCTAssertThrowsError(try RemoteSignalingProtocol.decodeChallenge(
            challenge(expiresAt: 10_010_100),
            expectedAudience: audience,
            now: now
        )) {
            XCTAssertEqual(
                $0 as? RemoteSignalingProtocolError,
                .invalidChallenge
            )
        }
        XCTAssertThrowsError(try RemoteSignalingProtocol.decodeChallenge(
            challenge(expiresAt: 9_999_999),
            expectedAudience: audience,
            now: now
        )) {
            XCTAssertEqual(
                $0 as? RemoteSignalingProtocolError,
                .invalidChallenge
            )
        }
    }

    func testProofFieldsUseGraphemeSafeEightyByteUTF8Limit() throws {
        let identity = try ephemeralIdentity()
        let challenge = RemoteDeviceAuthChallenge(
            v: 1,
            type: "auth.challenge",
            connectionID: UUID().uuidString.lowercased(),
            nonce: Data(repeating: 1, count: 32).base64URLEncodedString(),
            audience: "https://pipi.aichattrpg.com",
            expiresAt: Int64(Date().addingTimeInterval(4).timeIntervalSince1970 * 1_000)
        )
        let clientVersion = String(repeating: "版本", count: 30)
        let displayName = String(repeating: "🧑🏽‍💻", count: 20)
        let proof = try RemoteSignalingProtocol.makeProof(
            challenge: challenge,
            identity: identity,
            hostEpoch: UUID().uuidString.lowercased(),
            clientVersion: clientVersion,
            displayName: displayName
        )
        XCTAssertLessThanOrEqual(proof.clientVersion.utf8.count, 80)
        XCTAssertLessThanOrEqual(proof.displayName.utf8.count, 80)
        XCTAssertTrue(clientVersion.hasPrefix(proof.clientVersion))
        XCTAssertTrue(displayName.hasPrefix(proof.displayName))
        XCTAssertFalse(proof.clientVersion.contains("\u{FFFD}"))
        XCTAssertFalse(proof.displayName.contains("\u{FFFD}"))

        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let relay = root.appendingPathComponent("Relay", isDirectory: true)
        let tsx = relay.appendingPathComponent("node_modules/.bin/tsx")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: tsx.path),
            "run `cd Relay && npm install` before the cross-language test"
        )
        let process = Process()
        process.executableURL = tsx
        process.arguments = ["test/swift-device-proof-fixture.ts"]
        process.currentDirectoryURL = relay
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        input.fileHandleForWriting.write(try JSONEncoder().encode(proof))
        try input.fileHandleForWriting.close()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        let fixtureResult = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: output.fileHandleForReading.readDataToEndOfFile()
            ) as? [String: Any]
        )
        XCTAssertEqual(fixtureResult["accepted"] as? Bool, true)
        XCTAssertLessThanOrEqual(
            (fixtureResult["clientVersionBytes"] as? NSNumber)?.intValue ?? 81,
            80
        )
        XCTAssertLessThanOrEqual(
            (fixtureResult["displayNameBytes"] as? NSNumber)?.intValue ?? 81,
            80
        )
        XCTAssertThrowsError(try RemoteSignalingProtocol.makeProof(
            challenge: challenge,
            identity: identity,
            hostEpoch: UUID().uuidString.lowercased(),
            clientVersion: "",
            displayName: "Test"
        ))
    }

    func testRelayClientUsesChallengeProofWithoutSharedAccessHeaders() throws {
        let identity = try ephemeralIdentity()
        let task = IdentityTestWebSocketTask()
        let capturedRequest = IdentityLockedBox<URLRequest?>(nil)
        let states = IdentityLockedBox<[RemoteRelayConnectionState]>([])
        let pairingEvents = IdentityLockedBox<[RemotePairingLifecycleEvent]>([])
        let legacyCredentialReads = IdentityLockedBox(0)
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: try XCTUnwrap(
                URL(string: "wss://signal.aichattrpg.com/device/ws")
            ),
            publicURL: try XCTUnwrap(
                URL(string: "https://pipi.aichattrpg.com/")
            ),
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Identity Test"
        )
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            taskFactory: { request in
                capturedRequest.withValue { $0 = request }
                return task
            },
            credentialsProvider: {
                legacyCredentialReads.withValue { $0 += 1 }
                return nil
            },
            identityProvider: { identity },
            configurationValidator: { _ in true },
            pairingChanged: { event in
                pairingEvents.withValue { $0.append(event) }
            },
            stateChanged: { state in
                states.withValue { $0.append(state) }
            }
        )
        client.start()
        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        let request = try XCTUnwrap(capturedRequest.value)
        XCTAssertNil(request.value(forHTTPHeaderField: "CF-Access-Client-Id"))
        XCTAssertNil(request.value(forHTTPHeaderField: "CF-Access-Client-Secret"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-PipiUI-Device-Secret"))
        XCTAssertEqual(legacyCredentialReads.value, 0)

        let now = Date()
        let challenge = RemoteDeviceAuthChallenge(
            v: 1,
            type: "auth.challenge",
            connectionID: UUID().uuidString.lowercased(),
            nonce: Data(repeating: 3, count: 32).base64URLEncodedString(),
            audience: "https://signal.aichattrpg.com",
            expiresAt: Int64((now.addingTimeInterval(4).timeIntervalSince1970 * 1_000)
                .rounded(.down))
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(challenge),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil { task.sentMessages.count == 1 })
        guard case .string(let proofText) = task.sentMessages[0] else {
            return XCTFail("proof must be a text frame")
        }
        let proof = try JSONDecoder().decode(
            RemoteDeviceAuthProof.self,
            from: Data(proofText.utf8)
        )
        XCTAssertEqual(proof.deviceID, identity.deviceID)
        XCTAssertTrue(identity.verify(
            try XCTUnwrap(Data(base64URLEncoded: proof.signatureDER)),
            message: RemoteSignalingProtocol.authTranscript(
                challenge: challenge,
                deviceID: proof.deviceID,
                hostEpoch: proof.hostEpoch,
                fingerprint: proof.fingerprint
            )
        ))

        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        let result = RemoteDeviceAuthResult(
            v: 1,
            type: "auth.result",
            enrollmentStatus: "pending",
            commandAuthorized: false
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(result),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        let pairingResult = IdentityLockedBox<Result<URL, Error>?>(nil)
        client.beginPairing { result in
            pairingResult.withValue { $0 = result }
        }
        XCTAssertTrue(waitUntil { task.sentMessages.count == 2 })
        guard case .string(let pairText) = task.sentMessages[1] else {
            return XCTFail("pair.create must be a text frame")
        }
        let pair = try JSONDecoder().decode(
            RemotePairCreateFrame.self,
            from: Data(pairText.utf8)
        )
        let created = RemotePairServerFrame(
            v: 1,
            type: "pair.created",
            pairID: pair.pairID,
            expiresAt: pair.expiresAt,
            state: nil
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(created),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil {
            if case .success = pairingResult.value { return true }
            return false
        })
        guard case .success(let pairURL) = pairingResult.value else {
            return XCTFail("pair URL must be published after pair.created")
        }
        XCTAssertNotNil(P2PPairingPayloadPolicy.validatedPayload(
            pairURL.absoluteString,
            expectedOrigin: configuration.publicURL
        ))
        XCTAssertTrue(pairingEvents.value.contains {
            guard case .created(let presentation) = $0 else { return false }
            return presentation.pairID == pair.pairID
                && Int64(presentation.expiresAt.timeIntervalSince1970 * 1_000)
                    == pair.expiresAt
                && !presentation.url.absoluteString.contains(identity.deviceID)
        })

        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        let claimed = RemotePairServerFrame(
            v: 1,
            type: "pair.claimed",
            pairID: pair.pairID,
            expiresAt: pair.expiresAt,
            state: nil
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(claimed),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil { states.value.contains(.connected) })
        XCTAssertTrue(waitUntil { pairingEvents.value.contains(.claimed) })

        // A claim renews the session instead of destroying it: the link stays
        // usable by other browsers and the Mac keeps its pairing secret.
        XCTAssertNotNil(client.currentPairingExpiry())
        let renewedExpiry = Int64(
            Date().addingTimeInterval(50 * 60).timeIntervalSince1970 * 1_000
        )
        let renewedClaim = RemotePairServerFrame(
            v: 1,
            type: "pair.claimed",
            pairID: pair.pairID,
            expiresAt: renewedExpiry,
            state: nil
        )
        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(renewedClaim),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil {
            guard let expiry = client.currentPairingExpiry() else { return false }
            return Int64((expiry.timeIntervalSince1970 * 1_000).rounded(.down))
                == renewedExpiry
        })
        XCTAssertTrue(waitUntil {
            states.value.filter { $0 == .connected }.count == 2
        })
        XCTAssertTrue(waitUntil {
            pairingEvents.value.filter {
                if case .claimed = $0 { return true }
                return false
            }.count == 2
        })
        client.stop()
        XCTAssertTrue(waitUntil { task.cancelCount == 1 })
    }

    func testPairingURLIsFragmentOnlyAndSessionErasesSecret() throws {
        let identity = try ephemeralIdentity()
        let now = Date(timeIntervalSince1970: 20_000)
        let secret = Data((0..<32).map(UInt8.init))
        let session = try RemotePairingSession(
            identity: identity,
            now: now,
            ttl: 300,
            randomBytes: { secret }
        )
        let origin = try XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/"))
        let url = try session.claimURL(publicURL: origin, now: now)
        let components = try XCTUnwrap(
            URLComponents(url: url, resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.path, "/pair/\(session.pairID)")
        XCTAssertNil(components.query)
        XCTAssertTrue(components.fragment?.contains(
            "s=\(secret.base64URLEncodedString())"
        ) == true)
        XCTAssertFalse(components.fragment?.contains("d=") == true)
        XCTAssertFalse(url.absoluteString.contains(identity.deviceID))
        XCTAssertEqual(
            P2PPairingPayloadPolicy.validatedPayload(
                url.absoluteString,
                expectedOrigin: origin
            ),
            url.absoluteString
        )

        let frame = try session.createFrame(identity: identity, now: now)
        XCTAssertFalse(
            String(data: try JSONEncoder().encode(frame), encoding: .utf8)?
                .contains(secret.base64URLEncodedString()) == true
        )
        let transcript = Data([
            "PIPIUI-PAIR-CREATE-V1",
            frame.deviceID,
            frame.pairID,
            frame.secretHash,
            frame.fingerprint,
            String(frame.expiresAt),
        ].joined(separator: "\n").utf8)
        XCTAssertTrue(identity.verify(
            try XCTUnwrap(Data(base64URLEncoded: frame.signatureDER)),
            message: transcript
        ))

        session.invalidate()
        XCTAssertTrue(session.isInvalidated)
        XCTAssertThrowsError(try session.claimURL(publicURL: origin, now: now))
        XCTAssertThrowsError(try session.createFrame(identity: identity, now: now))
    }

    func testPairingRandomFailureIsFailClosedAndOwnedBufferIsZeroized() throws {
        let identity = try ephemeralIdentity()
        XCTAssertThrowsError(try RemotePairingSession(
            identity: identity,
            randomBytes: { throw RemotePairingError.randomGenerationFailed }
        )) {
            XCTAssertEqual($0 as? RemotePairingError, .randomGenerationFailed)
        }

        let buffer = ZeroizingSecretBuffer(
            copying: Data(repeating: 0xA5, count: 32)
        )
        XCTAssertEqual(buffer.copyData(), Data(repeating: 0xA5, count: 32))
        var erased: Data?
        buffer.zeroize { bytes in
            erased = Data(bytes)
        }
        XCTAssertEqual(erased, Data(repeating: 0, count: 32))
        XCTAssertNil(buffer.copyData())
    }

    func testDelayedPairingFailureCannotInvalidateReplacementPairing() throws {
        let identity = try ephemeralIdentity()
        let task = IdentityTestWebSocketTask()
        let configuration = RemoteRelayConfiguration(
            enabled: true,
            webSocketURL: URL(string: "wss://pipi.aichattrpg.com/device/ws")!,
            publicURL: URL(string: "https://pipi.aichattrpg.com/")!,
            deviceID: UUID().uuidString.lowercased(),
            displayName: "Pairing Race"
        )
        let client = RemoteRelayClient(
            controller: RemoteHostController(store: AppStore.shared),
            configuration: configuration,
            taskFactory: { _ in task },
            identityProvider: { identity },
            configurationValidator: { _ in true },
            stateChanged: { _ in }
        )
        client.start()
        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        let challenge = RemoteDeviceAuthChallenge(
            v: 1,
            type: "auth.challenge",
            connectionID: UUID().uuidString.lowercased(),
            nonce: Data(repeating: 4, count: 32).base64URLEncodedString(),
            audience: "https://pipi.aichattrpg.com",
            expiresAt: Int64(Date().addingTimeInterval(4).timeIntervalSince1970 * 1_000)
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(challenge),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil { task.sentMessages.count == 1 })
        let authResult = RemoteDeviceAuthResult(
            v: 1,
            type: "auth.result",
            enrollmentStatus: "pending",
            commandAuthorized: false
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(authResult),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil { task.receiveCount == 1 })
        task.deferSendCompletions = true

        let firstResult = IdentityLockedBox<Result<URL, Error>?>(nil)
        let secondResult = IdentityLockedBox<Result<URL, Error>?>(nil)
        client.beginPairing { result in
            firstResult.withValue { $0 = result }
        }
        XCTAssertTrue(waitUntil { task.sentMessages.count == 2 })
        client.beginPairing { result in
            secondResult.withValue { $0 = result }
        }
        XCTAssertTrue(waitUntil { task.sentMessages.count == 3 })
        XCTAssertTrue(waitUntil {
            if case .failure = firstResult.value { return true }
            return false
        })

        task.completeDeferredSend(at: 0, error: IdentityTestError.delayedFailure)
        task.completeDeferredSend(at: 1, error: nil)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        XCTAssertNil(secondResult.value)

        guard case .string(let secondText) = task.sentMessages[2] else {
            return XCTFail("replacement pair.create must be text")
        }
        let secondPair = try JSONDecoder().decode(
            RemotePairCreateFrame.self,
            from: Data(secondText.utf8)
        )
        task.deliver(.success(.string(String(
            data: try JSONEncoder().encode(RemotePairServerFrame(
                v: 1,
                type: "pair.created",
                pairID: secondPair.pairID,
                expiresAt: secondPair.expiresAt,
                state: nil
            )),
            encoding: .utf8
        )!)))
        XCTAssertTrue(waitUntil {
            if case .success = secondResult.value { return true }
            return false
        })
        client.cancelPairing()
        XCTAssertTrue(waitUntil { task.sentMessages.count == 4 })
        guard case .string(let revokeText) = task.sentMessages[3] else {
            return XCTFail("pair.revoke must be text")
        }
        XCTAssertEqual(
            try JSONDecoder().decode(
                RemotePairControlFrame.self,
                from: Data(revokeText.utf8)
            ),
            RemotePairControlFrame(
                v: 1,
                type: "pair.revoke",
                pairID: secondPair.pairID,
                deviceID: identity.deviceID
            )
        )
        client.stop()
    }

    func testPairingSessionExtendsExpiryWithinOneHourCapAndKeepsSecret() throws {
        let identity = try ephemeralIdentity()
        let now = Date(timeIntervalSince1970: 40_000)
        let secret = Data(repeating: 7, count: 32)
        let session = try RemotePairingSession(
            identity: identity,
            now: now,
            ttl: 300,
            randomBytes: { secret }
        )
        XCTAssertEqual(RemotePairingSession.maximumTTL, 60 * 60)
        XCTAssertEqual(session.expiresAt, now.addingTimeInterval(300))

        let renewed = now.addingTimeInterval(59 * 60)
        session.extendExpiry(to: renewed, now: now)
        XCTAssertEqual(session.expiresAt, renewed)

        // Beyond the one-hour ceiling from `now` is rejected.
        session.extendExpiry(to: now.addingTimeInterval(61 * 60), now: now)
        XCTAssertEqual(session.expiresAt, renewed)
        // Backdated renewals are rejected.
        session.extendExpiry(to: now.addingTimeInterval(-60), now: now)
        XCTAssertEqual(session.expiresAt, renewed)

        // The secret survives renewal: the same link still resolves mid-window.
        XCTAssertFalse(session.isInvalidated)
        let url = try session.claimURL(
            publicURL: try XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/")),
            now: now.addingTimeInterval(30 * 60)
        )
        XCTAssertTrue(url.absoluteString.contains(secret.base64URLEncodedString()))
    }

    func testPairingRejectsExpiredTTLWrongOriginQueryAndUnknownFragmentField() throws {
        let identity = try ephemeralIdentity()
        let now = Date(timeIntervalSince1970: 30_000)
        XCTAssertThrowsError(try RemotePairingSession(
            identity: identity,
            now: now,
            ttl: 3601
        ))
        let session = try RemotePairingSession(
            identity: identity,
            now: now,
            randomBytes: { Data(repeating: 9, count: 32) }
        )
        XCTAssertThrowsError(try session.claimURL(
            publicURL: XCTUnwrap(URL(string: "http://pipi.aichattrpg.com/")),
            now: now
        ))
        XCTAssertThrowsError(try session.claimURL(
            publicURL: XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/")),
            now: now.addingTimeInterval(3601)
        ))

        let valid = try session.claimURL(
            publicURL: XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/")),
            now: now
        ).absoluteString
        let expectedOrigin = try XCTUnwrap(
            URL(string: "https://pipi.aichattrpg.com/")
        )
        XCTAssertNil(P2PPairingPayloadPolicy.validatedPayload(
            valid.replacingOccurrences(of: "#", with: "?leak=1#"),
            expectedOrigin: expectedOrigin
        ))
        XCTAssertNil(P2PPairingPayloadPolicy.validatedPayload(
            valid + "&extra=1",
            expectedOrigin: expectedOrigin
        ))
        XCTAssertNil(P2PPairingPayloadPolicy.validatedPayload(
            valid.replacingOccurrences(
                of: "pipi.aichattrpg.com",
                with: "evil.example"
            ),
            expectedOrigin: expectedOrigin
        ))
    }

    func testSharedPairingFragmentVectorsMatchSwiftPolicy() throws {
        struct Vector: Decodable {
            let name: String
            let fragment: String
            let accepted: Bool
        }
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let vectors = try JSONDecoder().decode(
            [Vector].self,
            from: Data(contentsOf: root.appendingPathComponent(
                "Tests/Fixtures/P2PPairingFragmentVectors.json"
            ))
        )
        let origin = try XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/"))
        let pairID = UUID().uuidString.lowercased()
        for vector in vectors {
            let candidate = "\(origin.absoluteString)pair/\(pairID)#\(vector.fragment)"
            XCTAssertEqual(
                P2PPairingPayloadPolicy.validatedPayload(
                    candidate,
                    expectedOrigin: origin
                ) != nil,
                vector.accepted,
                vector.name
            )
        }
    }

    func testTunnelPairingPayloadAcceptsOnlyExact256BitFragment() throws {
        let origin = try XCTUnwrap(URL(string: "https://pipi.aichattrpg.com/"))
        let room = "21c5b03d-98cf-4da0-8b5c-17a20d557663"
        let secret = String(repeating: "a1", count: 32)
        let valid = "https://pipi.aichattrpg.com/pair/\(room)#\(secret)"
        XCTAssertEqual(
            P2PPairingPayloadPolicy.validatedPayload(
                valid,
                expectedOrigin: origin
            ),
            valid
        )
        XCTAssertNil(P2PPairingPayloadPolicy.validatedPayload(
            valid + "00",
            expectedOrigin: origin
        ))
        XCTAssertNil(P2PPairingPayloadPolicy.validatedPayload(
            valid.replacingOccurrences(of: "#", with: "?leak=1#"),
            expectedOrigin: origin
        ))
    }
}

private final class EphemeralIdentityStore: RemoteDeviceIdentityStore, @unchecked Sendable {
    private let factory: () throws -> RemoteDeviceIdentity
    private(set) var loadCount = 0

    init(factory: @escaping () throws -> RemoteDeviceIdentity) {
        self.factory = factory
    }

    func loadOrCreate() throws -> RemoteDeviceIdentity {
        loadCount += 1
        return try factory()
    }
}

private final class IdentityLockedBox<Value>: @unchecked Sendable {
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

private final class IdentityTestWebSocketTask:
    RemoteRelayWebSocketTask,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var receives: [
        @Sendable (Result<URLSessionWebSocketTask.Message, Error>) -> Void
    ] = []
    private var sent: [URLSessionWebSocketTask.Message] = []
    private var deferredSendHandlers: [@Sendable (Error?) -> Void] = []
    private var cancellations = 0
    private var defersSendCompletions = false

    var deferSendCompletions: Bool {
        get {
            lock.lock()
            defer { lock.unlock() }
            return defersSendCompletions
        }
        set {
            lock.lock()
            defersSendCompletions = newValue
            lock.unlock()
        }
    }

    var receiveCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return receives.count
    }

    var sentMessages: [URLSessionWebSocketTask.Message] {
        lock.lock()
        defer { lock.unlock() }
        return sent
    }

    var cancelCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancellations
    }

    func resume() {}

    func cancel(
        with closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        lock.lock()
        cancellations += 1
        lock.unlock()
    }

    func send(
        _ message: URLSessionWebSocketTask.Message,
        completionHandler: @escaping @Sendable (Error?) -> Void
    ) {
        lock.lock()
        sent.append(message)
        let shouldDefer = defersSendCompletions
        if shouldDefer {
            deferredSendHandlers.append(completionHandler)
        }
        lock.unlock()
        if !shouldDefer {
            completionHandler(nil)
        }
    }

    func receive(
        completionHandler: @escaping @Sendable (
            Result<URLSessionWebSocketTask.Message, Error>
        ) -> Void
    ) {
        lock.lock()
        receives.append(completionHandler)
        lock.unlock()
    }

    func sendPing(
        pongReceiveHandler: @escaping @Sendable (Error?) -> Void
    ) {
        pongReceiveHandler(nil)
    }

    func deliver(
        _ result: Result<URLSessionWebSocketTask.Message, Error>
    ) {
        lock.lock()
        let handler = receives.removeFirst()
        lock.unlock()
        handler(result)
    }

    func completeDeferredSend(at index: Int, error: Error?) {
        lock.lock()
        let handler = deferredSendHandlers[index]
        lock.unlock()
        handler(error)
    }
}

private enum IdentityTestError: Error {
    case delayedFailure
}

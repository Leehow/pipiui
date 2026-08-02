import CryptoKit
import Darwin
import Foundation
import Security

/// macOS does not export BSD `explicit_bzero`; C11 `memset_s` provides the
/// same non-elidable erase guarantee.
@inline(never)
private func explicitBzero(
    _ pointer: UnsafeMutableRawPointer,
    _ count: Int
) {
    _ = memset_s(pointer, count, 0, count)
}

enum RemotePairingError: Error, Equatable {
    case invalidOrigin
    case invalidTTL
    case randomGenerationFailed
    case expired
    case invalidated
}

/// Owns one allocation so invalidation can erase the bytes in place before
/// releasing storage. `Data.resetBytes` is insufficient here because Data may
/// share copy-on-write backing storage.
final class ZeroizingSecretBuffer: @unchecked Sendable {
    private var storage: UnsafeMutableRawPointer?
    let count: Int

    init(copying data: Data) {
        count = data.count
        let pointer = UnsafeMutableRawPointer.allocate(
            byteCount: max(1, data.count),
            alignment: MemoryLayout<UInt8>.alignment
        )
        if !data.isEmpty {
            data.withUnsafeBytes { source in
                pointer.copyMemory(from: source.baseAddress!, byteCount: data.count)
            }
        }
        storage = pointer
    }

    func copyData() -> Data? {
        guard let storage else { return nil }
        return Data(bytes: storage, count: count)
    }

    func zeroize(
        observing observer: ((UnsafeRawBufferPointer) -> Void)? = nil
    ) {
        guard let storage else { return }
        explicitBzero(storage, count)
        observer?(UnsafeRawBufferPointer(start: storage, count: count))
        storage.deallocate()
        self.storage = nil
    }

    deinit {
        zeroize()
    }
}

final class RemotePairingSession: @unchecked Sendable {
    static let maximumTTL: TimeInterval = 60 * 60

    let pairID: String
    let deviceID: String
    let fingerprint: String
    private let lock = NSLock()
    private var secret: ZeroizingSecretBuffer?
    private var expiresAtStorage: Date

    /// Current expiry. Renewed by `extendExpiry` each time the Relay confirms
    /// another browser paired; the link stays usable while a browser pairs at
    /// least once per hour.
    var expiresAt: Date {
        lock.lock()
        defer { lock.unlock() }
        return expiresAtStorage
    }

    init(
        identity: RemoteDeviceIdentity,
        now: Date = Date(),
        ttl: TimeInterval = maximumTTL,
        randomBytes: () throws -> Data = {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
                == errSecSuccess else {
                throw RemotePairingError.randomGenerationFailed
            }
            return Data(bytes)
        }
    ) throws {
        guard ttl > 0, ttl <= Self.maximumTTL else {
            throw RemotePairingError.invalidTTL
        }
        let generated = try randomBytes()
        guard generated.count == 32 else {
            throw RemotePairingError.invalidTTL
        }
        pairID = UUID().uuidString.lowercased()
        deviceID = identity.deviceID
        fingerprint = identity.fingerprint
        expiresAtStorage = now.addingTimeInterval(ttl)
        secret = ZeroizingSecretBuffer(copying: generated)
    }

    /// Slides the expiry forward after the Relay confirms a browser claim.
    /// Rejects values outside the bounded window (not after `now`, not more
    /// than `maximumTTL` ahead) so a compromised or buggy Relay cannot push
    /// the countdown arbitrarily far.
    func extendExpiry(to newExpiry: Date, now: Date = Date()) {
        lock.lock()
        defer { lock.unlock() }
        let upperBound = now.addingTimeInterval(Self.maximumTTL)
        guard newExpiry > now, newExpiry <= upperBound else { return }
        expiresAtStorage = newExpiry
    }

    func claimURL(publicURL: URL, now: Date = Date()) throws -> URL {
        let secret = try activeSecret(now: now)
        guard var components = URLComponents(
            url: publicURL,
            resolvingAgainstBaseURL: false
        ),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil else {
            throw RemotePairingError.invalidOrigin
        }
        components.path = "/pair/\(pairID)"
        components.query = nil
        components.fragment = [
            "v=1",
            "s=\(secret.base64URLEncodedString())",
            "fp=\(fingerprint)",
        ].joined(separator: "&")
        guard let url = components.url else { throw RemotePairingError.invalidOrigin }
        return url
    }

    func createFrame(
        identity: RemoteDeviceIdentity,
        now: Date = Date()
    ) throws -> RemotePairCreateFrame {
        let secret = try activeSecret(now: now)
        guard identity.deviceID == deviceID, identity.fingerprint == fingerprint else {
            throw RemotePairingError.invalidated
        }
        let secretHash = SHA256.hash(data: secret)
            .map { String(format: "%02x", $0) }
            .joined()
        let expiresAtMS = Int64((expiresAt.timeIntervalSince1970 * 1_000).rounded(.down))
        let transcript = Data([
            "PIPIUI-PAIR-CREATE-V1",
            deviceID,
            pairID,
            secretHash,
            fingerprint,
            String(expiresAtMS),
        ].joined(separator: "\n").utf8)
        return RemotePairCreateFrame(
            v: 1,
            type: "pair.create",
            pairID: pairID,
            deviceID: deviceID,
            fingerprint: fingerprint,
            secretHash: secretHash,
            expiresAt: expiresAtMS,
            signatureDER: try identity.sign(transcript).base64URLEncodedString()
        )
    }

    func invalidate() {
        lock.lock()
        let value = secret
        secret = nil
        lock.unlock()
        value?.zeroize()
    }

    var isInvalidated: Bool {
        lock.lock()
        defer { lock.unlock() }
        return secret == nil
    }

    private func activeSecret(now: Date) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        guard now < expiresAtStorage else { throw RemotePairingError.expired }
        guard let secret else { throw RemotePairingError.invalidated }
        guard let copy = secret.copyData() else {
            throw RemotePairingError.invalidated
        }
        return copy
    }

    deinit {
        invalidate()
    }
}

enum P2PPairingPayloadPolicy {
    static func validatedPayload(_ candidate: String?, expectedOrigin: URL) -> String? {
        guard let candidate,
              candidate.utf8.count <= 2_048,
              let value = URLComponents(string: candidate),
              let expected = URLComponents(
                url: expectedOrigin,
                resolvingAgainstBaseURL: false
              ),
              value.scheme?.lowercased() == "https",
              value.host?.lowercased() == expected.host?.lowercased(),
              value.port == expected.port,
              value.user == nil,
              value.password == nil,
              value.query == nil,
              value.path.range(
                of: #"^/pair/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#,
                options: [.regularExpression, .caseInsensitive]
              ) != nil,
              let fragmentMarker = candidate.firstIndex(of: "#") else {
            return nil
        }
        let fragment = String(candidate[candidate.index(after: fragmentMarker)...])
        // Current capability-tunnel links carry one 256-bit lowercase-hex
        // secret and nothing else. The older signed-device grammar remains accepted only
        // so an already-visible migration link does not disappear mid-sheet.
        if fragment.range(
            of: #"^[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil {
            return candidate
        }
        guard fragment.range(
            of: #"^v=1&s=[A-Za-z0-9_-]{43}&fp=[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil else {
            return nil
        }
        let fields = fragment.split(separator: "&", omittingEmptySubsequences: false)
        guard fields.count == 3,
              fields[1].hasPrefix("s="),
              fields[2].hasPrefix("fp=") else { return nil }
        let secret = String(fields[1].dropFirst(2))
        guard let decoded = Data(base64URLEncoded: secret),
              decoded.count == 32,
              decoded.base64URLEncodedString() == secret else { return nil }
        return candidate
    }
}

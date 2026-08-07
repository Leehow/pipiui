import Foundation
import Security

/// Durable tunnel room credentials. The secret authorizes remote control of this
/// Mac, so it is stored in Keychain (not UserDefaults).
struct RemoteTunnelPairingCredentials: Equatable, Sendable {
    var roomID: String
    var secret: String
    var expiresAt: Date

    var isValid: Bool {
        UUID(uuidString: roomID) != nil
            && secret.utf8.count == 64
            && secret.utf8.allSatisfy({
                ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
            })
            && expiresAt.timeIntervalSince1970 > 0
    }

    func isActive(at now: Date = Date()) -> Bool {
        isValid && expiresAt > now
    }
}

/// Resolves whether beginPairing should reuse a stored room or mint a new one.
enum RemoteTunnelPairingResolver {
    static func resolve(
        forceNew: Bool,
        stored: RemoteTunnelPairingCredentials?,
        now: Date = Date(),
        makeRoomID: () -> String = { UUID().uuidString.lowercased() },
        makeSecret: () -> String = { BridgeCapabilityToken.generate(byteCount: 32) },
        lifetime: TimeInterval = 24 * 60 * 60
    ) -> (credentials: RemoteTunnelPairingCredentials, reused: Bool) {
        if !forceNew, let stored, stored.isActive(at: now) {
            return (stored, true)
        }
        let credentials = RemoteTunnelPairingCredentials(
            roomID: makeRoomID().lowercased(),
            secret: makeSecret(),
            expiresAt: now.addingTimeInterval(lifetime)
        )
        return (credentials, false)
    }
}

/// Injectable store so unit tests never touch the process Keychain.
struct RemoteTunnelPairingStore: Sendable {
    var load: @Sendable () -> RemoteTunnelPairingCredentials?
    var save: @Sendable (RemoteTunnelPairingCredentials) -> Bool
    var clear: @Sendable () -> Void

    static let live = RemoteTunnelPairingStore(
        load: { KeychainBackend.load() },
        save: { KeychainBackend.save($0) },
        clear: { KeychainBackend.clear() }
    )

    /// In-memory backend for tests and deterministic fixtures.
    static func memory(
        initial: RemoteTunnelPairingCredentials? = nil
    ) -> RemoteTunnelPairingStore {
        let box = MemoryBox(initial)
        return RemoteTunnelPairingStore(
            load: { box.value },
            save: { credentials in
                guard credentials.isValid else { return false }
                box.value = credentials
                return true
            },
            clear: { box.value = nil }
        )
    }

    /// Isolated Keychain service for round-trip tests.
    static func keychainForTesting(service: String) -> RemoteTunnelPairingStore {
        RemoteTunnelPairingStore(
            load: { KeychainBackend.load(service: service) },
            save: { KeychainBackend.save($0, service: service) },
            clear: { KeychainBackend.clear(service: service) }
        )
    }
}

private final class MemoryBox: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: RemoteTunnelPairingCredentials?

    init(_ value: RemoteTunnelPairingCredentials?) {
        storage = value
    }

    var value: RemoteTunnelPairingCredentials? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return storage
        }
        set {
            lock.lock()
            storage = newValue
            lock.unlock()
        }
    }
}

private enum KeychainBackend {
    static let defaultService = "com.pipiui.remote-tunnel-pairing"
    static let account = "tunnel-pairing"

    private struct Payload: Codable {
        var roomID: String
        var secret: String
        var expiresAt: TimeInterval
    }

    static func load(service: String = defaultService) -> RemoteTunnelPairingCredentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
            return nil
        }
        let credentials = RemoteTunnelPairingCredentials(
            roomID: payload.roomID.lowercased(),
            secret: payload.secret,
            expiresAt: Date(timeIntervalSince1970: payload.expiresAt)
        )
        return credentials.isValid ? credentials : nil
    }

    @discardableResult
    static func save(
        _ credentials: RemoteTunnelPairingCredentials,
        service: String = defaultService
    ) -> Bool {
        guard credentials.isValid else { return false }
        let payload = Payload(
            roomID: credentials.roomID.lowercased(),
            secret: credentials.secret,
            expiresAt: credentials.expiresAt.timeIntervalSince1970
        )
        guard let data = try? JSONEncoder().encode(payload),
              data.count <= 4_096 else {
            return false
        }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        var insert = base
        attributes.forEach { insert[$0.key] = $0.value }
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    static func clear(service: String = defaultService) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}

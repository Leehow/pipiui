import Foundation
import Security

enum RemoteRelayCredential: String, CaseIterable, Hashable, Sendable {
    case accessClientID = "cloudflare-access-client-id"
    case accessClientSecret = "cloudflare-access-client-secret"
    case deviceSecret = "device-secret"
}

struct RemoteRelayKeychainClient {
    let delete: (RemoteRelayCredential) -> OSStatus
    let probe: (RemoteRelayCredential) -> RemoteRelayKeychainPresence

    static let live = RemoteRelayKeychainClient(
        delete: { credential in
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: RemoteRelayCredentialStore.service,
                kSecAttrAccount as String: credential.rawValue,
            ] as CFDictionary)
        },
        probe: { credential in
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: RemoteRelayCredentialStore.service,
                kSecAttrAccount as String: credential.rawValue,
                kSecReturnData as String: false,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            let status = SecItemCopyMatching(query as CFDictionary, nil)
            switch status {
            case errSecSuccess:
                return .present
            case errSecItemNotFound:
                return .absent
            default:
                return .error(status)
            }
        }
    )
}

enum RemoteRelayKeychainPresence: Equatable {
    case present
    case absent
    case error(OSStatus)
}

struct RemoteRelayCredentialDeletionResult: Equatable {
    let statuses: [RemoteRelayCredential: OSStatus]
    let probes: [RemoteRelayCredential: RemoteRelayKeychainPresence]

    var remaining: Set<RemoteRelayCredential> {
        Set(RemoteRelayCredential.allCases.filter {
            probes[$0] != .absent
        })
    }

    var succeeded: Bool {
        RemoteRelayCredential.allCases.allSatisfy {
            guard let status = statuses[$0] else { return false }
            return status == errSecSuccess || status == errSecItemNotFound
        } && RemoteRelayCredential.allCases.allSatisfy {
            probes[$0] == .absent
        }
    }
}

enum RemoteRelayCredentialStore {
    /// Stable automation contract:
    /// security add-generic-password -U -s com.pipiui.remote-relay -a <account> -w <value>
    static let service = "com.pipiui.remote-relay"

    static func read(_ credential: RemoteRelayCredential) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    /// Checks only for the existence of legacy pilot credentials. Secret bytes
    /// are never returned to the modern `/device/ws` product path.
    static func containsAnyLegacyCredential(
        client: RemoteRelayKeychainClient = .live
    ) -> Bool {
        RemoteRelayCredential.allCases.contains {
            client.probe($0) != .absent
        }
    }

    @discardableResult
    static func write(_ value: String, credential: RemoteRelayCredential) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 4_096 else { return false }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: credential.rawValue,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        var insert = base
        attributes.forEach { insert[$0.key] = $0.value }
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    static func deleteAll(
        client: RemoteRelayKeychainClient = .live
    ) -> RemoteRelayCredentialDeletionResult {
        var statuses: [RemoteRelayCredential: OSStatus] = [:]
        for credential in RemoteRelayCredential.allCases {
            statuses[credential] = client.delete(credential)
        }
        var probes: [
            RemoteRelayCredential: RemoteRelayKeychainPresence
        ] = [:]
        for credential in RemoteRelayCredential.allCases {
            probes[credential] = client.probe(credential)
        }
        return RemoteRelayCredentialDeletionResult(
            statuses: statuses,
            probes: probes
        )
    }
}

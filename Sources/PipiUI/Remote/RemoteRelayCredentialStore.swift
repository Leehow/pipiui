import Foundation
import Security

enum RemoteRelayCredential: String, CaseIterable, Sendable {
    case accessClientID = "cloudflare-access-client-id"
    case accessClientSecret = "cloudflare-access-client-secret"
    case deviceSecret = "device-secret"
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

    static func deleteAll() {
        for credential in RemoteRelayCredential.allCases {
            SecItemDelete([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: credential.rawValue,
            ] as CFDictionary)
        }
    }
}

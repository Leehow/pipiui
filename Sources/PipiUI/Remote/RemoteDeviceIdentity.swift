import CryptoKit
import Foundation
import Security

enum RemoteDeviceKeyStorage: String, Equatable, Sendable {
    case secureEnclave
    case keychain
    case ephemeralTest
}

enum RemoteDeviceIdentityError: Error, Equatable {
    case keychain(OSStatus)
    case keyCreation
    case publicKeyUnavailable
    case signingFailed
    case invalidDeviceID
}

protocol RemoteDeviceIdentityStore: Sendable {
    func loadOrCreate() throws -> RemoteDeviceIdentity
}

/// A per-install signing identity. `deviceID` is deliberately a random routing
/// identifier; authentication is exclusively proof of the non-exported P-256
/// private key.
final class RemoteDeviceIdentity: @unchecked Sendable {
    let deviceID: String
    let storage: RemoteDeviceKeyStorage
    let publicKeyX963: Data
    let fingerprint: String
    private let signingKey: SecKey

    init(
        deviceID: String,
        signingKey: SecKey,
        storage: RemoteDeviceKeyStorage
    ) throws {
        guard let normalized = UUID(uuidString: deviceID)?.uuidString.lowercased() else {
            throw RemoteDeviceIdentityError.invalidDeviceID
        }
        guard let publicKey = SecKeyCopyPublicKey(signingKey),
              let external = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
              external.count == 65,
              external.first == 0x04 else {
            throw RemoteDeviceIdentityError.publicKeyUnavailable
        }
        self.deviceID = normalized
        self.signingKey = signingKey
        self.storage = storage
        publicKeyX963 = external
        fingerprint = SHA256.hash(data: external)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    func sign(_ message: Data) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            signingKey,
            .ecdsaSignatureMessageX962SHA256,
            message as CFData,
            &error
        ) as Data? else {
            _ = error?.takeRetainedValue()
            throw RemoteDeviceIdentityError.signingFailed
        }
        return signature
    }

    func verify(_ signatureDER: Data, message: Data) -> Bool {
        guard let publicKey = SecKeyCopyPublicKey(signingKey) else { return false }
        return SecKeyVerifySignature(
            publicKey,
            .ecdsaSignatureMessageX962SHA256,
            message as CFData,
            signatureDER as CFData,
            nil
        )
    }
}

final class SecurityRemoteDeviceIdentityStore: RemoteDeviceIdentityStore, @unchecked Sendable {
    static let shared = SecurityRemoteDeviceIdentityStore()

    private static let service = "com.pipiui.remote-device-identity"
    private static let deviceIDAccount = "device-id-v1"
    private static let signingTag = Data("com.pipiui.remote-device-identity.p256.v1".utf8)

    func loadOrCreate() throws -> RemoteDeviceIdentity {
        let deviceID = try loadOrCreateDeviceID()
        if let key = loadSigningKey() {
            return try RemoteDeviceIdentity(
                deviceID: deviceID,
                signingKey: key,
                storage: keyStorage(key)
            )
        }
        if let key = createSecureEnclaveKey() {
            return try RemoteDeviceIdentity(
                deviceID: deviceID,
                signingKey: key,
                storage: .secureEnclave
            )
        }
        guard let key = createSoftwareKey() else {
            throw RemoteDeviceIdentityError.keyCreation
        }
        return try RemoteDeviceIdentity(
            deviceID: deviceID,
            signingKey: key,
            storage: .keychain
        )
    }

    private func loadOrCreateDeviceID() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.deviceIDAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess,
           let data = result as? Data,
           let value = String(data: data, encoding: .utf8),
           let normalized = UUID(uuidString: value)?.uuidString.lowercased() {
            return normalized
        }
        guard status == errSecItemNotFound else {
            throw RemoteDeviceIdentityError.keychain(status)
        }
        let value = UUID().uuidString.lowercased()
        var insert = query
        insert.removeValue(forKey: kSecReturnData as String)
        insert.removeValue(forKey: kSecMatchLimit as String)
        insert[kSecValueData as String] = Data(value.utf8)
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let inserted = SecItemAdd(insert as CFDictionary, nil)
        guard inserted == errSecSuccess else {
            throw RemoteDeviceIdentityError.keychain(inserted)
        }
        return value
    }

    private func loadSigningKey() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: Self.signingTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else {
            return nil
        }
        return (result as! SecKey)
    }

    private func createSecureEnclaveKey() -> SecKey? {
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            .privateKeyUsage,
            &accessError
        ) else {
            _ = accessError?.takeRetainedValue()
            return nil
        }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Self.signingTag,
                kSecAttrAccessControl as String: access,
            ],
        ]
        return SecKeyCreateRandomKey(attributes as CFDictionary, nil)
    }

    private func createSoftwareKey() -> SecKey? {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Self.signingTag,
                kSecAttrAccessible as String:
                    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ],
        ]
        return SecKeyCreateRandomKey(attributes as CFDictionary, nil)
    }

    private func keyStorage(_ key: SecKey) -> RemoteDeviceKeyStorage {
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any],
              let tokenID = attributes[kSecAttrTokenID as String] as? String else {
            return .keychain
        }
        return tokenID == (kSecAttrTokenIDSecureEnclave as String)
            ? .secureEnclave
            : .keychain
    }
}

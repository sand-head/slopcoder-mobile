#if canImport(UIKit)
import Foundation
import Security
import SlopcoderCore

/// The device key, in the Keychain.
///
/// One `kSecClassGenericPassword` keyed on service and account, with the
/// credential as JSON — the item the React Native build of this app wrote, kept
/// exactly so that an update does not sign anyone out.
///
/// `WhenUnlockedThisDeviceOnly`: it is a bearer credential that never expires,
/// so it does not leave the phone in a backup and is not readable while locked.
struct KeychainVault: CredentialVault {
    static let service = "codes.sand.slopcoder"
    private static let account = "slopcoder"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainVault.service,
            kSecAttrAccount as String: KeychainVault.account,
        ]
    }

    func load() -> Credential? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        // A keychain that will not open is the same as an empty one: sign in again.
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(Credential.self, from: data)
    }

    func save(_ credential: Credential) throws {
        let data = try JSONEncoder().encode(credential)
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: Error, LocalizedError {
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case .status(let status): return "The keychain refused the key (\(status))."
        }
    }
}
#endif

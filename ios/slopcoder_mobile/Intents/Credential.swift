import Foundation
import Security

/// The device key, read straight from the keychain item the JS side wrote.
///
/// `react-native-keychain` stores a `kSecClassGenericPassword` keyed on service
/// and account, with our JSON blob as the password. An App Intent runs in the
/// app's own process, so it reaches the same keychain with no access group and
/// no entitlement — which is the whole reason the intents live in the app target
/// rather than an extension.
struct Credential {
    let server: URL
    let apiKey: String
    let userName: String
}

enum CredentialStore {
    /// Must match `SERVICE` in `src/state/auth.ts`.
    private static let service = "codes.sand.slopcoder"
    private static let account = "slopcoder"

    private struct Stored: Decodable {
        let server: String
        let apiKey: String
        let userName: String
    }

    static func load() throws -> Credential {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        // The key is stored WhenUnlockedThisDeviceOnly, so a locked device gives
        // errSecInteractionNotAllowed rather than the item. Siri asks the user to
        // unlock when an intent says it needs to.
        guard status != errSecInteractionNotAllowed else { throw IntentError.deviceLocked }
        guard status == errSecSuccess, let data = item as? Data else { throw IntentError.notSignedIn }

        let stored = try JSONDecoder().decode(Stored.self, from: data)
        guard let url = URL(string: stored.server) else { throw IntentError.notSignedIn }

        return Credential(server: url, apiKey: stored.apiKey, userName: stored.userName)
    }
}

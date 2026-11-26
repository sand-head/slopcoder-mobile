#if canImport(CryptoKit) && canImport(Security)
import CryptoKit
import Foundation
import Security

/// The phone's half of a Web Push subscription: a P-256 keypair and a 16-byte
/// auth secret, made once and kept in the Keychain, plus the RFC 8291 decrypt
/// that turns what the relay forwarded back into the message.
///
/// Its own module because two bundles need it. The app makes the keys and
/// subscribes with the public half; the notification service extension reads the
/// private half when a notification lands.
///
/// Both reach one Keychain item through an **App Group**, named as the item's
/// access group. It used to be the app's own identifier group
/// (`<team>.codes.sand.slopcoder`), listed in both bundles' entitlements — but
/// xtool's signer rewrites `keychain-access-groups` to each bundle's *own*
/// identifier, which leaves the extension unable to see anything the app wrote.
/// An App Group survives that, and iOS accepts one as a Keychain access group.
///
/// The item is `AfterFirstUnlockThisDeviceOnly`, not `WhenUnlocked` like the
/// device key: a notification arrives with the phone in a pocket, and an
/// extension that cannot open the keys shows the relay's placeholder instead of
/// the message. Before the first unlock since boot it still cannot, which is the
/// same trade every messaging app makes.
///
/// The C# reference is `PushRelayTests.Phone` in the slopcoder repo; the
/// derivation below is that, line for line.
public struct PushKeys {
    let privateKey: P256.KeyAgreement.PrivateKey
    let auth: Data

    /// The App Group both bundles carry. Must match the two entitlements files.
    public static let accessGroup = "group.codes.sand.slopcoder"

    /// The credential's service with `.push` appended, so it reads as ours in a
    /// Keychain dump and never collides with the credential.
    public static let service = "codes.sand.slopcoder.push"
    private static let account = "subscription"

    /// The subscription's `p256dh`: the uncompressed public point, base64url.
    public var p256dh: String { Self.base64url(privateKey.publicKey.x963Representation) }

    /// The subscription's `auth`: the secret, base64url.
    public var authKey: String { Self.base64url(auth) }

    // MARK: keychain

    private static func query(group: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }

    private static func read(group: String?) -> PushKeys? {
        var lookup = query(group: group)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return PushKeys(stored: data)
    }

    /// The keys, or nil when this phone never subscribed. What the extension calls.
    public static func load() -> PushKeys? {
        read(group: accessGroup)
    }

    private static func store(_ keys: PushKeys) -> OSStatus {
        var attributes = query(group: accessGroup)
        attributes[kSecValueData as String] = keys.stored
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil)
    }

    /// The keys, made on first use. What the app calls when it has a token.
    ///
    /// Stable on purpose: a new keypair would need a new subscription on every
    /// instance the phone is signed in to, and the endpoint (which changes with
    /// the APNs token) is the part that has to be re-sent anyway.
    public static func loadOrCreate() throws -> PushKeys {
        if let existing = load() { return existing }

        // Keys an earlier build kept in the app's own group: move them rather
        // than make new ones, so the instance's row for this phone stays good.
        if let legacy = read(group: nil) {
            if store(legacy) == errSecSuccess { return legacy }
        }

        var auth = Data(count: 16)
        let status = auth.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard status == errSecSuccess else { throw PushKeysError.randomness }

        let keys = PushKeys(privateKey: P256.KeyAgreement.PrivateKey(), auth: auth)
        let added = store(keys)
        // Two launches racing to create is the only way to get here; whichever
        // won is the one to use.
        if added == errSecDuplicateItem, let existing = load() { return existing }
        guard added == errSecSuccess else { throw PushKeysError.keychain(added) }
        return keys
    }

    /// 32 bytes of private scalar, then the 16-byte secret.
    private var stored: Data { privateKey.rawRepresentation + auth }

    private init?(stored: Data) {
        guard stored.count == 48,
              let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: stored.prefix(32))
        else { return nil }
        self.init(privateKey: key, auth: stored.suffix(16))
    }

    private init(privateKey: P256.KeyAgreement.PrivateKey, auth: Data) {
        self.privateKey = privateKey
        self.auth = auth
    }

    // MARK: RFC 8291

    /// An `aes128gcm` body (RFC 8188 framing, RFC 8291 keys) back to plaintext.
    ///
    /// Header: salt (16) | record size (4, big-endian) | key id length (1) |
    /// key id (the sender's uncompressed public key, 65) — then one record of
    /// ciphertext ending in a 16-byte GCM tag. Web Push messages are one record.
    public func decrypt(_ body: Data) throws -> Data {
        let bytes = Data(body) // rebase indices at zero
        guard bytes.count > 21 else { throw PushKeysError.malformed }

        let salt = bytes[0..<16]
        let keyIdLength = Int(bytes[20])
        guard keyIdLength == 65, bytes.count >= 21 + keyIdLength + 16 else { throw PushKeysError.malformed }
        let senderPublic = bytes[21..<(21 + keyIdLength)]
        let record = bytes[(21 + keyIdLength)...]

        let sender = try P256.KeyAgreement.PublicKey(x963Representation: senderPublic)
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: sender)

        // IKM = HKDF(salt: auth, IKM: ecdh, info: "WebPush: info\0" || ua_public || as_public)
        var keyInfo = Data("WebPush: info\u{0}".utf8)
        keyInfo.append(privateKey.publicKey.x963Representation)
        keyInfo.append(senderPublic)
        let ikm = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self, salt: auth, sharedInfo: keyInfo, outputByteCount: 32)

        // CEK and nonce come off the same PRK, extracted with the message's salt.
        let cek = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: ikm, salt: salt,
            info: Data("Content-Encoding: aes128gcm\u{0}".utf8), outputByteCount: 16)
        let nonce = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: ikm, salt: salt,
            info: Data("Content-Encoding: nonce\u{0}".utf8), outputByteCount: 12)

        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: nonce.withUnsafeBytes { Data($0) }),
            ciphertext: record.dropLast(16),
            tag: record.suffix(16))
        let padded = try AES.GCM.open(box, using: cek)

        // The last record ends in a 0x02 delimiter and then zero padding.
        guard let delimiter = padded.lastIndex(where: { $0 != 0 }), padded[delimiter] == 2 else {
            throw PushKeysError.malformed
        }
        return padded[..<delimiter]
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

public enum PushKeysError: Error {
    case randomness
    case keychain(OSStatus)
    case malformed
}

/// What the relay forwarded, opened: `{ title, body, url }`, the same JSON the
/// web cockpit's service worker reads.
public struct PushMessage: Decodable {
    public let title: String?
    public let body: String?
    public let url: String?

    /// Apple delivers the relay's envelope with the Web Push ciphertext under
    /// `wp`. Nil for anything that will not open — no keys, a locked phone before
    /// first unlock, a body from someone else.
    public static func open(_ userInfo: [AnyHashable: Any]) -> PushMessage? {
        guard let encoded = userInfo["wp"] as? String,
              let ciphertext = Data(base64Encoded: encoded),
              let keys = PushKeys.load(),
              let plaintext = try? keys.decrypt(ciphertext)
        else { return nil }
        return try? JSONDecoder().decode(PushMessage.self, from: plaintext)
    }
}
#endif

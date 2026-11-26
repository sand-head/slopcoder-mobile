// Where the device key lives, and the one `Seam` everything else uses.
//
// The key goes in the Keychain, never a preferences file: it is a bearer
// credential that reaches everything its owner can reach, and it does not
// expire — only revocation at `/settings/api-keys` ends it.

import Foundation
import Observation

public struct Credential: Codable, Equatable, Sendable {
    public var server: String
    public var apiKey: String
    public var userName: String

    public init(server: String, apiKey: String, userName: String) {
        self.server = server
        self.apiKey = apiKey
        self.userName = userName
    }

    /// Two credentials are the same connection only if both halves match.
    var connectionKey: String { "\(server) \(apiKey)" }
}

/// Where a credential is kept. The app's is the Keychain; tests hold one in memory.
public protocol CredentialVault: Sendable {
    /// Nil when there is none — or when the vault will not open, which is the
    /// same thing to the caller: sign in again.
    func load() -> Credential?
    func save(_ credential: Credential) throws
    func clear()
}

public final class MemoryVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var credential: Credential?

    public init(_ credential: Credential? = nil) { self.credential = credential }

    public func load() -> Credential? { lock.withLock { credential } }
    public func save(_ credential: Credential) throws { lock.withLock { self.credential = credential } }
    public func clear() { lock.withLock { credential = nil } }
}

@MainActor
@Observable
public final class AuthStore {
    public private(set) var credential: Credential?
    public private(set) var seam: Seam?
    /// False until the vault has been read once, so the UI can hold its shell.
    public private(set) var ready = false

    @ObservationIgnored private let vault: CredentialVault
    @ObservationIgnored private let connection: ConnectionStatus
    @ObservationIgnored private let transport: HTTPTransport
    /// What the device calls itself in the key list, so there is something to revoke.
    @ObservationIgnored private let deviceName: String
    /// Asked after a sign-in and nowhere else: the key is in the vault, so the
    /// native side can post the push token the moment iOS hands it over, and the
    /// prompt lands when the reason for it is obvious.
    @ObservationIgnored public var onSignedIn: (@MainActor () -> Void)?
    /// Run before the key goes: unsubscribing is a seam call, and it needs the key.
    @ObservationIgnored public var beforeSignOut: (@MainActor () async -> Void)?

    public init(
        vault: CredentialVault,
        connection: ConnectionStatus,
        transport: HTTPTransport = URLSessionTransport(),
        deviceName: String = "iPhone (slopcoder)"
    ) {
        self.vault = vault
        self.connection = connection
        self.transport = transport
        self.deviceName = deviceName
    }

    public func restore() {
        if let stored = vault.load() {
            credential = stored
            seam = build(stored)
        }
        ready = true
    }

    public func signInWithPassword(server: String, userName: String, password: String) async throws {
        let key = try await DeviceAuth.loginWithPassword(
            server, PasswordLoginRequest(userName: userName, password: password, deviceName: deviceName), transport: transport
        )
        try persist(Credential(server: server, apiKey: key.fullKey, userName: key.userName))
    }

    public func signInWithPairingCode(server: String, code: String) async throws {
        let key = try await DeviceAuth.redeemPairingCode(server, PairRequest(code: code, deviceName: deviceName), transport: transport)
        try persist(Credential(server: server, apiKey: key.fullKey, userName: key.userName))
    }

    public func signOut() async {
        guard credential != nil else { return }
        await beforeSignOut?()
        vault.clear()
        credential = nil
        seam = nil
    }

    private func persist(_ credential: Credential) throws {
        try vault.save(credential)
        self.credential = credential
        seam = build(credential)
        onSignedIn?()
    }

    private func build(_ credential: Credential) -> Seam {
        let connection = self.connection
        let key = credential.apiKey
        return Seam(
            baseUrl: credential.server,
            apiKey: credential.apiKey,
            transport: transport,
            // A 401 means the key was revoked or the account deactivated. There is no
            // refresh to attempt; drop it and show the login screen.
            onSignedOut: { [weak self] in
                Task { @MainActor in
                    // A late 401 for a key already replaced must not sign the new one out.
                    guard let self, self.credential?.apiKey == key else { return }
                    await self.signOut()
                }
            },
            onReachable: { reachable in
                Task { @MainActor in connection.setReachable(reachable) }
            }
        )
    }
}

/// Turns a thrown error from the auth routes into something to show a person.
public func loginMessage(_ error: Error) -> String {
    // Wrong address, server down, no network — indistinguishable from here, and
    // all of them are "could not reach" rather than "wrong password". Saying the
    // latter would send someone to reset a password that was fine.
    if error is OfflineError {
        return "Could not reach that server. Check the address and your connection."
    }

    switch (error as? SeamError)?.message {
    case LoginFailure.invalid.rawValue:
        return "That username and password did not match."
    case LoginFailure.inactive.rawValue:
        return "That account is deactivated."
    case LoginFailure.twofactor.rawValue:
        return "This account uses two-factor sign-in. Pair with a QR code from Settings → API keys instead."
    case LoginFailure.tooManyAttempts.rawValue:
        return "Too many attempts. Wait a minute and try again."
    default:
        return "That server answered with an error. Try again in a moment."
    }
}

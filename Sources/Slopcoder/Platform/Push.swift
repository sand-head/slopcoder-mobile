#if canImport(UIKit)
import Foundation
import SlopcoderCore
import SlopcoderPush
import UIKit
import UserNotifications

/// Asks for notification permission, then registers with APNs.
///
/// *When* to ask is the whole point. iOS gives an app a single chance: refuse
/// the prompt once and it never appears again without a trip to Settings. So
/// this is called right after a successful sign-in, when the reason is
/// self-evident — never at cold launch, before anyone knows what the app is.
/// Everything after the prompt happens in the app delegate, which is where iOS
/// delivers the token.
enum PushRegistrar {
    static func enable() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            // Registering must happen on the main thread, and only after the user
            // has said yes — otherwise iOS hands back a token for an app that
            // cannot show anything.
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// Re-register on launch when permission was granted in an earlier session,
    /// so a rotated token reaches the server without prompting again.
    static func refreshIfAlreadyAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
}

/// The subscription, from the app's side: the relay for an endpoint, the
/// instance for the row, and what was last done so it is not done twice.
///
/// iOS hands over the device token on every launch, and the relay mints a
/// different endpoint each time it is asked — the registration is sealed with
/// a random nonce — so going back to the relay every launch would leave the
/// instance a row per launch and the phone a notification per row. The
/// endpoint is kept together with the token it was minted for, and the relay
/// is only asked again when Apple hands over a different token (or the
/// endpoint is old enough to be worth refreshing). Subscribing on the instance
/// still happens every launch: it is idempotent there, and it is what puts the
/// row back after a sign-in to another instance.
enum PushSubscriber {
    /// Where the last successful subscription went, so sign-out can remove it.
    private static let endpointKey = "slopcoder.push.endpoint"
    /// The device token that endpoint was minted for; a different one means a new endpoint.
    private static let tokenKey = "slopcoder.push.token"
    /// When the endpoint was minted, so a stale one is eventually replaced.
    private static let mintedAtKey = "slopcoder.push.mintedAt"

    /// Past this age the relay is asked for a fresh endpoint even for the same
    /// token. Cheap insurance against a relay that lost the keys the endpoint
    /// was sealed with: the instance treats the device's keypair as its
    /// identity, so the refresh replaces the row rather than adding one.
    private static let refreshAfter: TimeInterval = 30 * 24 * 60 * 60

    private static func instance() -> Seam? {
        guard let credential = KeychainVault().load() else { return nil }
        return Seam(baseUrl: credential.server, apiKey: credential.apiKey)
    }

    static func subscribe(token: String, sandbox: Bool) async {
        // Not signed in yet is the ordinary case on a first launch, not a failure.
        guard let instance = instance() else { return }

        guard let relay = PushRelayClient.configured else {
            NSLog("slopcoder: no push relay in this build (SlopcoderPushRelay); notifications are off")
            return
        }

        do {
            let keys = try PushKeys.loadOrCreate()
            let defaults = UserDefaults.standard
            let previous = defaults.string(forKey: endpointKey)

            let endpoint: String
            if let previous, defaults.string(forKey: tokenKey) == token, !isStale(defaults) {
                endpoint = previous
            } else {
                endpoint = try await relay.register(token: token, sandbox: sandbox)
                // The old endpoint still points at this phone, so the instance
                // would keep sending to it; take it away before adding the new
                // one. Best-effort: the instance also collapses rows that share
                // this phone's keys, so a miss here costs nothing.
                if let previous, previous != endpoint {
                    try? await instance.unsubscribePush(endpoint: previous)
                }
            }

            try await instance.subscribePush(endpoint: endpoint, p256dh: keys.p256dh, auth: keys.authKey)

            if endpoint != previous {
                defaults.set(endpoint, forKey: endpointKey)
                defaults.set(token, forKey: tokenKey)
                defaults.set(Date().timeIntervalSince1970, forKey: mintedAtKey)
            }
        } catch {
            // Next launch registers again. There is nothing to tell the user:
            // the app works without notifications, and this is not their bug.
            NSLog("slopcoder: push subscription failed — %@", String(describing: error))
        }
    }

    /// Drop this phone's subscription on the instance. Sign-out awaits it before
    /// forgetting the credential, because it is the credential that authorises
    /// the call. Best-effort: an instance that cannot be reached keeps a row that
    /// will 410 on its own once the token dies.
    static func unsubscribe() async {
        guard let endpoint = UserDefaults.standard.string(forKey: endpointKey), let instance = instance() else { return }
        try? await instance.unsubscribePush(endpoint: endpoint)
        forget()
    }

    private static func isStale(_ defaults: UserDefaults) -> Bool {
        let minted = defaults.double(forKey: mintedAtKey)
        return minted == 0 || Date().timeIntervalSince1970 - minted > refreshAfter
    }

    private static func forget() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: endpointKey)
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: mintedAtKey)
    }
}

/// Turns an APNs token into a Web Push endpoint, at the relay.
///
/// The relay is not the instance the phone is signed in to. It is whichever
/// slopcoder deployment holds the key Apple issued for this app — the app
/// publisher's — and the app has its address built in (`SlopcoderPushRelay` in
/// Info.plist, stamped by the release workflow). Registration is
/// unauthenticated: the relay has no accounts, only endpoints, and the endpoint
/// it hands back is the secret.
///
/// This is what lets a phone get notifications from an instance whose hoster
/// has nothing from Apple: the instance sends ordinary Web Push to the endpoint,
/// and never learns a phone is involved.
struct PushRelayClient {
    let relay: URL

    /// Nil when the build carries no relay address, in which case nothing can be
    /// subscribed and the app says so once in the log.
    static var configured: PushRelayClient? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SlopcoderPushRelay") as? String,
              !value.isEmpty,
              let url = URL(string: value.hasSuffix("/") ? value : value + "/"),
              url.scheme == "https" || url.host == "localhost"
        else { return nil }
        return PushRelayClient(relay: url)
    }

    private struct RegisterRequest: Encodable {
        let token: String
        let sandbox: Bool
    }

    private struct RegisterResponse: Decodable {
        let endpoint: String
    }

    /// `POST /relay/register` → the endpoint to subscribe with.
    func register(token: String, sandbox: Bool) async throws -> String {
        var request = URLRequest(url: relay.appendingPathComponent("relay/register"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RegisterRequest(token: token, sandbox: sandbox))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw PushRelayError.refused((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(RegisterResponse.self, from: data).endpoint
    }
}

enum PushRelayError: Error {
    case refused(Int)
}

/// Which APNs environment this binary's token belongs to.
///
/// A sandbox token is refused outright by production APNs, and only the device
/// knows which it holds, so it says. Xcode told us with `#if DEBUG`; xtool
/// builds have no such split that tracks signing, so the answer is read from
/// where it actually lives — the `aps-environment` the app was signed with.
enum PushEnvironment {
    static let isSandbox: Bool = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<key>aps-environment</key>")
        else {
            // No profile is an App Store build: Apple strips it on the way in.
            return false
        }
        let after = text[start.upperBound...]
        guard let open = after.range(of: "<string>"), let close = after.range(of: "</string>") else { return false }
        return after[open.upperBound..<close.lowerBound] == "development"
    }()
}
#endif

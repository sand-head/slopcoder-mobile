import Foundation
import React
import UIKit
import UserNotifications

/// Asks for notification permission, then registers with APNs.
///
/// A native module exists for one reason: *when* to ask. Prompting at cold
/// launch, before anyone knows what the app is, is how an app gets refused
/// permanently — so JavaScript calls this right after a successful sign-in,
/// when the reason is obvious. Everything after the prompt happens in the
/// AppDelegate, which is where iOS delivers the token.
@objc(PushRegistrar)
final class PushRegistrar: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc
    func enablePush() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }

            // Registering must happen on the main thread, and only after the
            // user has said yes — otherwise iOS hands back a token for an app
            // that cannot show anything.
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Re-register on launch when permission was granted in an earlier session,
    /// so a rotated token reaches the server without prompting again.
    @objc
    func refreshIfAlreadyAllowed() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Drop this phone's subscription on the instance. Sign-out awaits it
    /// before forgetting the credential, because it is the credential that
    /// authorises the call. Best-effort: an instance that cannot be reached
    /// keeps a row that will 410 on its own once the token dies.
    @objc
    func disablePush(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            await PushSubscriber.unsubscribe()
            resolve(nil)
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

    static func subscribe(token: String, sandbox: Bool) async {
        // Not signed in yet is the ordinary case on a first launch, not a failure.
        guard let credential = try? CredentialStore.load() else { return }

        guard let relay = PushRelayClient.configured else {
            NSLog("slopcoder: no push relay in this build (SLOPCODER_PUSH_RELAY); notifications are off")
            return
        }

        do {
            let keys = try PushKeys.loadOrCreate()
            let instance = SeamClient(credential: credential)
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

    static func unsubscribe() async {
        guard let endpoint = UserDefaults.standard.string(forKey: endpointKey),
              let credential = try? CredentialStore.load()
        else { return }
        try? await SeamClient(credential: credential).unsubscribePush(endpoint: endpoint)
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

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
/// instance for the row, and one remembered endpoint so sign-out can undo it.
enum PushSubscriber {
    /// Where the last successful subscription went, so sign-out can remove it.
    private static let endpointKey = "slopcoder.push.endpoint"

    static func subscribe(token: String, sandbox: Bool) async {
        // Not signed in yet is the ordinary case on a first launch, not a failure.
        guard let credential = try? CredentialStore.load() else { return }

        guard let relay = PushRelayClient.configured else {
            NSLog("slopcoder: no push relay in this build (SLOPCODER_PUSH_RELAY); notifications are off")
            return
        }

        do {
            let keys = try PushKeys.loadOrCreate()
            let endpoint = try await relay.register(token: token, sandbox: sandbox)
            try await SeamClient(credential: credential).subscribePush(
                endpoint: endpoint, p256dh: keys.p256dh, auth: keys.authKey)
            UserDefaults.standard.set(endpoint, forKey: endpointKey)
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
        UserDefaults.standard.removeObject(forKey: endpointKey)
    }
}

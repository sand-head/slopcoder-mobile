import Foundation
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
}

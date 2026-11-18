import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // React Native's window and factory belong to the scene on iOS 27. The
    // application delegate still owns the process-wide notification center.
    UNUserNotificationCenter.current().delegate = self

    // Permission is asked for in JavaScript, right after sign-in. This only
    // re-registers when it was granted in an earlier session, because APNs
    // tokens rotate and a stale one on the server delivers to nobody.
    PushRegistrar().refreshIfAlreadyAllowed()

    return true
  }

  // MARK: push

  /// iOS hands the token here, as bytes. From it, a Web Push subscription.
  ///
  /// The token never goes to the instance. It goes to the push relay — the
  /// deployment holding this app's Apple key — which answers with an endpoint;
  /// the instance gets the endpoint and the phone's own keys, exactly what a
  /// browser would give it, and sends Web Push. That is what lets a phone be
  /// notified by an instance whose hoster has nothing from Apple.
  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()

    // Debug builds get a sandbox token, which production APNs refuses outright.
    // Only the device knows which it holds, so it says.
#if DEBUG
    let sandbox = true
#else
    let sandbox = false
#endif

    Task { await PushSubscriber.subscribe(token: token, sandbox: sandbox) }
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    // Nothing to do and nothing worth telling the user: they will simply not get
    // notifications, and the app works without them.
    NSLog("slopcoder: APNs registration failed — %@", error.localizedDescription)
  }

  /// Show the banner even with the app open, because the thing being announced
  /// is usually a turn that has stopped and is waiting.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }

  /// A tap opens the session it came from. The payload carries the server's own
  /// path (`/session/<id>`); this turns it into the URL the navigator routes.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    defer { completionHandler() }

    guard let path = response.notification.request.content.userInfo["url"] as? String,
          let url = URL(string: "slopcoder://\(path.hasPrefix("/") ? String(path.dropFirst()) : path)")
    else { return }

    NotificationCenter.default.post(
      name: NSNotification.Name("RCTOpenURLNotification"),
      object: self,
      userInfo: ["url": url.absoluteString]
    )
  }
}

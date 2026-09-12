import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "slopcoder_mobile",
      in: window,
      launchOptions: launchOptions
    )

    // Taps arrive here whether the app was running or not.
    UNUserNotificationCenter.current().delegate = self

    // Permission is asked for in JavaScript, right after sign-in. This only
    // re-registers when it was granted in an earlier session, because APNs
    // tokens rotate and a stale one on the server delivers to nobody.
    PushRegistrar().refreshIfAlreadyAllowed()

    return true
  }

  // MARK: push

  /// iOS hands the token here, as bytes. The server wants lowercase hex.
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

    Task {
      // Not signed in yet is the ordinary case on a first launch, not a failure.
      guard let credential = try? CredentialStore.load() else { return }
      try? await SeamClient(credential: credential).registerDevice(
        token: token,
        sandbox: sandbox,
        deviceName: await UIDevice.current.name
      )
    }
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

  /// `slopcoder://session/<id>`, opened by OpenSessionIntent.
  ///
  /// This is what `RCTLinkingManager.application(_:open:options:)` does — it
  /// posts `RCTOpenURLNotification` and returns true. Posting it directly keeps
  /// the AppDelegate free of a React header import, which is one less thing to
  /// resolve in a Swift target. React Navigation's `linking` config is listening
  /// on the other side.
  ///
  /// A cold launch never reaches here: iOS puts the URL in `launchOptions`,
  /// where React Native's Linking picks it up as the initial URL.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    NotificationCenter.default.post(
      name: NSNotification.Name("RCTOpenURLNotification"),
      object: self,
      userInfo: ["url": url.absoluteString]
    )
    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

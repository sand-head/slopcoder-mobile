import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
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

    return true
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

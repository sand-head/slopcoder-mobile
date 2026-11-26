#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit
import UserNotifications

/// The shell: restore the key, then either the sign-in flow or the app.
///
/// Signed out: the login page and, over it, the scanner as a full-screen cover.
/// Signed in: the tab bar, and over it the screens you *enter* — a session, a
/// routine — which cover the tabs because each wants the bottom edge for a
/// composer or a switch. Starting a session is not a screen: the composer on
/// the sessions page is the launcher, as it is on the web. Writing a routine is
/// a form, and a form the platform presents as a sheet.
///
/// The bars are the platform's. Nothing here paints one.
@main
struct SlopcoderApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = AppModel.shared

    init() {
        AppFont.register()
        Appearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.auth)
                .environment(model.connection)
                .environment(model.router)
                .environment(model.routineAlert)
                .tint(Palette.primary)
                .onOpenURL { model.open($0) }
                .onChange(of: scenePhase) { _, phase in
                    // iOS suspends sockets in the background; coming back to the
                    // front is the poke that reconnects.
                    if phase == .active { model.hubs.poke() }
                }
        }
    }
}

/// The app's type on the platform's bars.
enum Appearance {
    static func apply() {
        let title = UIFont(name: AppFont.sansMediumName, size: 17) ?? .systemFont(ofSize: 17, weight: .semibold)
        let large = UIFont(name: AppFont.sansMediumName, size: 34) ?? .systemFont(ofSize: 34, weight: .bold)
        let bar = UINavigationBar.appearance()
        bar.titleTextAttributes = [.font: title, .foregroundColor: Palette.uiForeground]
        bar.largeTitleTextAttributes = [.font: large, .foregroundColor: Palette.uiForeground]
        bar.tintColor = Palette.uiPrimary
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AuthStore.self) private var auth

    var body: some View {
        Group {
            if !auth.ready {
                // Hold the shell until the keychain has answered, so a signed-in
                // launch never flashes the login screen. Painted, not empty: an
                // empty frame between the launch image and the first screen is a
                // flash of the window's own colour.
                Palette.background.ignoresSafeArea()
            } else if auth.credential != nil {
                MainTabs()
            } else {
                LoginScreen()
            }
        }
        .task { model.launch() }
        .onChange(of: auth.credential) { _, _ in model.sync() }
    }
}

/// The rail, as a phone has one: a tab bar.
///
/// The one thing the cockpit's rail has that a bar must keep: Routines carries a
/// red pip when a run failed, so "something broke overnight" reaches you on
/// whatever page you are on. That is the tab's badge.
struct MainTabs: View {
    @Environment(Router.self) private var router
    @Environment(RoutineAlert.self) private var alert

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            NavigationStack(path: $router.sessions) {
                SessionsScreen().routes()
            }
            .tabItem { Label("Sessions", systemImage: "bubble.left.and.bubble.right") }
            .tag(AppTab.sessions)

            NavigationStack(path: $router.routines) {
                RoutinesScreen().routes()
            }
            .tabItem { Label("Routines", systemImage: "clock") }
            .badge(alert.anyFailed ? "!" : nil)
            .tag(AppTab.routines)

            NavigationStack(path: $router.artifacts) {
                ArtifactsScreen().routes()
            }
            .tabItem { Label("Artifacts", systemImage: "doc.text") }
            .tag(AppTab.artifacts)

            NavigationStack(path: $router.usage) {
                UsageScreen().routes()
            }
            .tabItem { Label("Usage", systemImage: "chart.bar") }
            .tag(AppTab.usage)

            NavigationStack(path: $router.settings) {
                SettingsScreen().routes()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(AppTab.settings)
        }
    }
}

extension View {
    /// Every screen a tab can push. Screens that are entered hide the tab bar:
    /// a composer, a switch, a photo each want the bottom edge to themselves.
    func routes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .session(let id):
                SessionScreen(sessionId: id).toolbar(.hidden, for: .tabBar)
            case .reviews(let sessionId):
                ReviewsScreen(sessionId: sessionId).toolbar(.hidden, for: .tabBar)
            case .review(let id):
                ReviewDetailScreen(reviewId: id).toolbar(.hidden, for: .tabBar)
            case .routine(let id, let run):
                RoutineScreen(routineId: id, initialRun: run).toolbar(.hidden, for: .tabBar)
            case .artifact(let id, let version):
                ArtifactScreen(artifactId: id, version: version).toolbar(.hidden, for: .tabBar)
            case .settings(let page):
                SettingsPageView(page: page)
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Permission is asked for right after sign-in. This only re-registers when
        // it was granted in an earlier session, because APNs tokens rotate and a
        // stale one on the server delivers to nobody.
        PushRegistrar.refreshIfAlreadyAllowed()
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
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await PushSubscriber.subscribe(token: token, sandbox: PushEnvironment.isSandbox) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
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
    /// path (`/session/<id>`); this turns it into the URL the router routes.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard let path = response.notification.request.content.userInfo["url"] as? String,
              let url = URL(string: "slopcoder://\(path.hasPrefix("/") ? String(path.dropFirst()) : path)")
        else { return }
        Task { @MainActor in AppModel.shared.open(url) }
    }
}
#endif

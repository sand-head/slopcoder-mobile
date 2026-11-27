#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit
import UserNotifications

/// The shell: restore the key, then either the sign-in flow or the app.
///
/// Signed out: the login page and, over it, the scanner as a full-screen cover.
/// Signed in: the tabs, each a list with what it opened beside it — or, where
/// there is no room for both, pushed over it. Starting a session is not a screen: the composer on
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
@MainActor
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
    /// Palette colours read this as they resolve; a change rebuilds the tree
    /// under it, so the ones already drawn resolve again. Where you were is the
    /// router's, so it survives.
    @AppStorage(Night.oledKey) private var oledBlack = false

    var body: some View {
        Group {
            if !auth.ready {
                // Hold the shell until the keychain has answered, so a signed-in
                // launch never flashes the login screen. Painted, not empty: an
                // empty frame between the launch image and the first screen is a
                // flash of the window's own colour.
                Palette.background.ignoresSafeArea()
            } else if auth.credential != nil {
                MainTabs().id(oledBlack)
            } else {
                LoginScreen().id(oledBlack)
            }
        }
        .task { model.launch() }
        .onChange(of: auth.credential) { _, _ in model.sync() }
    }
}

/// The rail: a tab bar, wherever the system puts one.
///
/// At the bottom on an iPhone, down the side on the outer display of an iPhone
/// Duo, along the top where there is width to spare. Nothing here chooses; the
/// bar is the platform's, and following it is what keeps controls where people
/// already look for them.
///
/// The one thing the cockpit's rail has that a bar must keep: Routines carries a
/// red pip when a run failed, so "something broke overnight" reaches you on
/// whatever page you are on. That is the tab's badge.
struct MainTabs: View {
    @Environment(Router.self) private var router
    @Environment(RoutineAlert.self) private var alert
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        tabs
            // Read here, at the window: inside a column of a split view the size
            // class is the column's, which says nothing about the window.
            .environment(\.wideWindow, sizeClass == .regular)
            .modifier(TabBarMinimizing())
    }

    @ViewBuilder private var tabs: some View {
        @Bindable var router = router
        if #available(iOS 18.0, *) {
            TabView(selection: $router.tab) {
                Tab(value: AppTab.sessions) { page(.sessions) } label: { Label { Text("Sessions") } icon: { Glyph.sessions.image } }
                Tab(value: AppTab.routines) { page(.routines) } label: { Label { Text("Routines") } icon: { Glyph.routines.image } }
                    .badge(alert.anyFailed ? Text("!") : nil)
                Tab(value: AppTab.artifacts) { page(.artifacts) } label: { Label { Text("Artifacts") } icon: { Glyph.artifacts.image } }
                Tab(value: AppTab.usage) { page(.usage) } label: { Label { Text("Usage") } icon: { Glyph.usage.image } }
                Tab(value: AppTab.settings) { page(.settings) } label: { Label { Text("Settings") } icon: { Glyph.settings.image } }
            }
        } else {
            TabView(selection: $router.tab) {
                page(.sessions)
                    .tabItem { Label { Text("Sessions") } icon: { Glyph.sessions.image } }
                    .tag(AppTab.sessions)
                page(.routines)
                    .tabItem { Label { Text("Routines") } icon: { Glyph.routines.image } }
                    .badge(alert.anyFailed ? "!" : nil)
                    .tag(AppTab.routines)
                page(.artifacts)
                    .tabItem { Label { Text("Artifacts") } icon: { Glyph.artifacts.image } }
                    .tag(AppTab.artifacts)
                page(.usage)
                    .tabItem { Label { Text("Usage") } icon: { Glyph.usage.image } }
                    .tag(AppTab.usage)
                page(.settings)
                    .tabItem { Label { Text("Settings") } icon: { Glyph.settings.image } }
                    .tag(AppTab.settings)
            }
        }
    }

    @ViewBuilder
    private func page(_ tab: AppTab) -> some View {
        @Bindable var router = router
        switch tab {
        case .sessions:
            SplitTab(path: $router.sessions, empty: "No session open", hint: "Choose one from the list, or start one below it.") {
                SessionsScreen()
            }
        case .routines:
            SplitTab(path: $router.routines, empty: "No routine open", hint: "Choose one from the list to see its runs.") {
                RoutinesScreen()
            }
        case .artifacts:
            SplitTab(path: $router.artifacts, empty: "Nothing open", hint: "Choose something the agent published.") {
                ArtifactsScreen()
            }
        case .usage:
            // One page, nothing to open beside it.
            NavigationStack(path: $router.usage) { UsageScreen().routes() }
        case .settings:
            SplitTab(path: $router.settings, empty: "Settings", hint: "Choose a page from the list.") {
                SettingsScreen()
            }
        }
    }
}

/// A tab's list, and beside it whatever the list opened.
///
/// One view for both shapes of screen, on purpose. Where there is room — the
/// inner display of an iPhone Duo, an iPhone in Split View given the wider
/// half — the list stays and the session opens next to it. Where there is not,
/// the same view collapses to a stack: the list, and the session pushed over
/// it. Because it is the same view either way, opening or closing the device
/// in the middle of a sentence keeps the sentence: the draft, the scroll
/// position and the screen you were on all survive, which two separate layouts
/// switched on size class would throw away.
///
/// The tab's path is the router's, unchanged: its first entry is what the list
/// opened and shows as the detail; anything after it is pushed on top.
struct SplitTab<Root: View>: View {
    @Binding var path: [Route]
    let empty: String
    let hint: String
    @ViewBuilder var root: () -> Root
    @State private var columns = NavigationSplitViewVisibility.doubleColumn

    var body: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: compactColumn) {
            root()
        } detail: {
            NavigationStack(path: pushed) {
                Group {
                    if let head = path.first {
                        // A different session is a different screen, not the
                        // same one with new arguments.
                        RouteView(route: head).id(head)
                    } else {
                        EmptyState(empty, detail: hint)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .pageBackground()
                    }
                }
                .routes()
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    /// Collapsed, the detail is on top exactly when something is open; going
    /// back to the list closes it.
    private var compactColumn: Binding<NavigationSplitViewColumn> {
        Binding(
            get: { path.isEmpty ? .sidebar : .detail },
            set: { column in if column == .sidebar, !path.isEmpty { path = [] } }
        )
    }

    private var pushed: Binding<[Route]> {
        Binding(get: { Array(path.dropFirst()) }, set: { path = Array(path.prefix(1)) + $0 })
    }
}

/// The screen a route names.
struct RouteView: View {
    let route: Route
    @Environment(\.wideWindow) private var wide

    var body: some View {
        switch route {
        case .session(let id): entered(SessionScreen(sessionId: id))
        case .reviews(let sessionId): entered(ReviewsScreen(sessionId: sessionId))
        case .review(let id): entered(ReviewDetailScreen(reviewId: id))
        case .routine(let id, let run): entered(RoutineScreen(routineId: id, initialRun: run))
        case .artifact(let id, let version): entered(ArtifactScreen(artifactId: id, version: version))
        case .settings(let page): SettingsPageView(page: page)
        }
    }

    /// A screen that is entered hides a bottom tab bar: a composer, a switch, a
    /// photo each want that edge to themselves. In a wide window the bar is not
    /// at the bottom, and hiding it would take away the only way to change tab
    /// while something is open — which, beside a list, is always.
    private func entered(_ screen: some View) -> some View {
        screen.toolbar(wide ? .automatic : .hidden, for: .tabBar)
    }
}

extension View {
    /// Every screen a tab can push.
    func routes() -> some View {
        navigationDestination(for: Route.self) { RouteView(route: $0) }
    }
}

private struct WideWindowKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Whether the window has room for two columns: regular width at the root.
    var wideWindow: Bool {
        get { self[WideWindowKey.self] }
        set { self[WideWindowKey.self] = newValue }
    }
}

/// On iOS 26 the tab bar steps out of the way while a list is scrolled.
private struct TabBarMinimizing: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // The stub is for UI tests; it never registers for or answers a push.
        if AppModel.shared.stubbed { return true }
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

    // The notification centre's delegate is not the main actor's: nothing in the
    // header promises which thread these arrive on. Neither touches the app's
    // state directly — the tap hops to the main actor to route — so they are
    // nonisolated, and right on whichever thread they come.

    /// Show the banner even with the app open, because the thing being announced
    /// is usually a turn that has stopped and is waiting.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// A tap opens the session it came from. The payload carries the server's own
    /// path (`/session/<id>`); this turns it into the URL the router routes.
    nonisolated func userNotificationCenter(
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

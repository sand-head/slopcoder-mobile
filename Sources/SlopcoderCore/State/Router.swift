// Where the app is, and where a link takes it.
//
// Navigation state lives here, not in the views, so that the part of it that
// is a contract — `slopcoder://session/<id>` from a notification, from Siri,
// from a pasted link — can be tested without a screen. A route that spans
// Swift and the server's own URLs with nothing in between is exactly the kind
// of thing that breaks silently.

import Foundation
import Observation

/// The pages the tab bar switches between.
public enum AppTab: Hashable, Sendable {
    case sessions, routines, artifacts, usage, settings
}

/// The settings pages, by the web's own path segment so a link lands on its screen.
public enum SettingsPage: String, Hashable, CaseIterable, Sendable {
    case connections
    case mcp
    case nodes
    case terminal
    case gitIdentity = "git-identity"
    case facets
    case hooks
    case memory
    case skills
    case channels
    case apiKeys = "api-keys"
}

/// A screen you *enter*, pushed over a tab.
public enum Route: Hashable, Sendable {
    case session(id: String)
    case reviews(sessionId: String)
    case review(id: String)
    case routine(id: String, run: String?)
    case artifact(id: String, version: Int?)
    case settings(SettingsPage)
}

/// Where the app is: which tab, and what is pushed on each.
///
/// Each tab is a stack of its own so the page owns a real navigation bar: the
/// large title that collapses, the search field, the trailing button. Screens
/// that are entered — a session, a routine — are pushed on the tab they were
/// opened from, with the tab bar hidden, because a composer wants the bottom
/// edge to itself.
@MainActor
@Observable
public final class Router {
    public init() {}

    public var tab: AppTab = .sessions
    public var sessions: [Route] = []
    public var routines: [Route] = []
    public var artifacts: [Route] = []
    public var usage: [Route] = []
    public var settings: [Route] = []

    /// Push onto whichever tab is showing.
    public func push(_ route: Route) {
        switch tab {
        case .sessions: sessions.append(route)
        case .routines: routines.append(route)
        case .artifacts: artifacts.append(route)
        case .usage: usage.append(route)
        case .settings: settings.append(route)
        }
    }

    /// Leave the screen on top of the current tab.
    public func pop() {
        switch tab {
        case .sessions: _ = sessions.popLast()
        case .routines: _ = routines.popLast()
        case .artifacts: _ = artifacts.popLast()
        case .usage: _ = usage.popLast()
        case .settings: _ = settings.popLast()
        }
    }

    public func reset() {
        tab = .sessions
        sessions = []
        routines = []
        artifacts = []
        usage = []
        settings = []
    }

    private func stack(_ tab: AppTab) -> [Route] {
        switch tab {
        case .sessions: return sessions
        case .routines: return routines
        case .artifacts: return artifacts
        case .usage: return usage
        case .settings: return settings
        }
    }

    private func setStack(_ tab: AppTab, _ routes: [Route]) {
        switch tab {
        case .sessions: sessions = routes
        case .routines: routines = routes
        case .artifacts: artifacts = routes
        case .usage: usage = routes
        case .settings: settings = routes
        }
    }

    /// Show `route` on the current tab: back to it when it is already in the
    /// stack, pushed when it is not. Opening artifact A, then B, then A again is
    /// two screens, not three — and the A you return to is the one you left.
    public func show(_ route: Route) {
        var routes = stack(tab)
        if let existing = routes.lastIndex(of: route) {
            routes.removeSubrange((existing + 1)...)
        } else {
            routes.append(route)
        }
        setStack(tab, routes)
    }

    /// Go where a link points. Each lands with its tab's root underneath, so back
    /// goes somewhere — a session opened from a notification or from Siri must
    /// not be a dead end.
    @discardableResult
    public func open(_ target: LinkTarget) -> Bool {
        switch target {
        case .session(let id):
            tab = .sessions
            sessions = [.session(id: id)]
        case .routine(let id):
            tab = .routines
            routines = [.routine(id: id, run: nil)]
        case .artifact(let id, let version):
            // An edition is a screen of its own, so a link to v2 does not replace
            // the latest's. Inside a session it opens over the session; from
            // anywhere else it opens on the artifacts tab.
            if stack(tab).isEmpty { tab = .artifacts }
            show(.artifact(id: id, version: version))
        case .external, .unsupported:
            return false
        }
        return true
    }

    /// `slopcoder://…` — the scheme notifications, Siri and pasted links open.
    ///
    /// The paths are the web's own (`session/<id>`, `artifacts/<id>?v=2`,
    /// `routines/<id>`, `settings/api-keys`), so the server never has to know
    /// how a phone spells its screens.
    @discardableResult
    public func open(url: URL, baseUrl: String? = nil) -> Bool {
        let text = url.absoluteString
        guard text.lowercased().hasPrefix("slopcoder://") else { return false }
        let rest = String(text.dropFirst("slopcoder://".count))
        let withoutFragment = rest.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let parts = withoutFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        let segments = (parts.first ?? "").split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        let query = parseQuery(parts.count > 1 ? parts[1] : "")

        guard let head = segments.first else { return false }
        let id = segments.count > 1 ? segments[1] : nil

        switch (head, id) {
        case ("sessions", _):
            tab = .sessions
            sessions = []
        case ("session", let id?):
            tab = .sessions
            sessions = [.session(id: id)]
        case ("routines", nil):
            tab = .routines
            routines = []
        case ("routines", let id?):
            tab = .routines
            routines = [.routine(id: id, run: query["run"])]
        case ("artifacts", nil):
            tab = .artifacts
            artifacts = []
        case ("artifacts", let id?):
            // `?v=N` is the web's spelling of an edition.
            let version = query["v"].flatMap { Int($0) }.flatMap { $0 >= 1 ? $0 : nil }
            return open(.artifact(id: id, version: version))
        case ("usage", _):
            tab = .usage
            usage = []
        case ("settings", let page):
            tab = .settings
            settings = page.flatMap(SettingsPage.init(rawValue:)).map { [.settings($0)] } ?? []
        default:
            return false
        }
        return true
    }
}

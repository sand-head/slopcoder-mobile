// The sessions page's data and work: the list and what filters it, recall
// over what was said in past sessions, the routines strip, and the launcher
// that starts a session — its prompt, photos, dials and attachments.
//
// The view keeps the rename and delete prompts it is showing and lays out the
// rest. The model lives as long as the tab's list does; its registry listener
// is added each time the page appears and removed each time it goes.

import Foundation
import Observation

@MainActor
@Observable
public final class SessionsModel {
    public enum Filter: Sendable { case all, running }

    /// What the server's full-text search found for a query that matched no title.
    public struct Recall: Equatable, Sendable {
        public var query: String
        public var hits: [SessionSearchHit]
    }

    /// What the list says when it has no rows to show.
    public enum ListState: Equatable, Sendable {
        case loading
        case empty
        case noMatch(String)
        case rows
    }

    /// What recall waits on: a new query, or the local filter coming up empty.
    public struct RecallKey: Equatable, Sendable {
        public var query: String
        public var empty: Bool
    }

    public private(set) var sessions: [SessionSummary]?
    public private(set) var error: String?
    public var query = ""
    public var filter = Filter.all
    public private(set) var routines: RoutineStatus?

    // Recall: the search field filters the list locally, and when nothing in it
    // matches, the same words go to the server's full-text search over what was
    // *said* — scrollback, not titles.
    public private(set) var recall: Recall?
    public private(set) var recallBusy = false

    public var prompt = ""
    public private(set) var pendingImages: [PendingImage] = []
    public private(set) var imageError: String?
    public private(set) var starting = false
    public private(set) var startError: String?
    public var options = TurnOptions()
    public private(set) var models: [ModelCandidate] = []
    public private(set) var facets: [FacetOption] = []
    public private(set) var repos: [String] = []
    public private(set) var nodes: [String] = []
    public private(set) var recent: [RecentRepo] = []
    public private(set) var allNodes: [RemoteNodeSummary] = []
    public private(set) var owned: [RepoChoice] = []
    public private(set) var ownedLoaded = false
    public private(set) var ownedError: String?
    /// The server would not delete a session mid-turn; the page says so.
    public var stillRunning = false
    /// Why the last change to a session in the list did not happen.
    public private(set) var actionError: String?

    /// A session this launcher created and has not yet started, with what it
    /// was created from. A retry of the same request starts it rather than
    /// creating another; a different request deletes it first.
    @ObservationIgnored private var unstarted: (id: String, request: CreateSessionRequest)?
    @ObservationIgnored private var registry: (@Sendable () -> Void)?
    @ObservationIgnored private var refresh: SerialRefresh?
    @ObservationIgnored private let seam: @MainActor () -> Seam?
    @ObservationIgnored private let hub: @MainActor () -> SessionHub?
    @ObservationIgnored private let router: Router
    @ObservationIgnored private let routineAlert: RoutineAlert
    @ObservationIgnored private let feedback: Feedback
    @ObservationIgnored private let dismissKeyboard: @MainActor () -> Void
    @ObservationIgnored private let animate: @MainActor (_ change: () -> Void) -> Void
    @ObservationIgnored private let debounce: @Sendable (_ milliseconds: Int) async -> Void
    @ObservationIgnored private let zone: @Sendable () -> String?

    public init(
        seam: @escaping @MainActor () -> Seam?,
        hub: @escaping @MainActor () -> SessionHub?,
        router: Router,
        routineAlert: RoutineAlert,
        feedback: Feedback = .silent,
        dismissKeyboard: @escaping @MainActor () -> Void = {},
        animate: @escaping @MainActor (_ change: () -> Void) -> Void = { $0() },
        debounce: @escaping @Sendable (_ milliseconds: Int) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0) * 1_000_000) },
        zone: @escaping @Sendable () -> String? = { RoutineFormat.deviceZone() }
    ) {
        self.seam = seam
        self.hub = hub
        self.router = router
        self.routineAlert = routineAlert
        self.feedback = feedback
        self.dismissKeyboard = dismissKeyboard
        self.animate = animate
        self.debounce = debounce
        self.zone = zone
    }

    // MARK: what the page shows

    public var needle: String { query.trimmingCharacters(in: .whitespaces) }

    public var searched: [SessionSummary] {
        (sessions ?? []).filter { matchesSession($0, query: needle) }
    }

    public var visible: [SessionSummary] {
        searched.filter { filter == .all || SessionActivity.busy($0) }
    }

    public var listState: ListState {
        if sessions == nil, error == nil { return .loading }
        if let sessions, sessions.isEmpty, needle.isEmpty { return .empty }
        if sessions != nil, searched.isEmpty, !needle.isEmpty, !(recall == nil && recallBusy) { return .noMatch(needle) }
        return .rows
    }

    /// Recall's answer, while it is an answer to what is in the field.
    public var shownRecall: Recall? {
        guard let recall, !needle.isEmpty, recall.query == needle, searched.isEmpty else { return nil }
        return recall
    }

    /// The routines strip, when there are routines and nobody is searching.
    public var strip: RoutineStatus? {
        guard let routines, routines.anyRoutines, needle.isEmpty else { return nil }
        return routines
    }

    public var recallKey: RecallKey { RecallKey(query: needle, empty: searched.isEmpty) }
    public var promptIsEmpty: Bool { prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    public var recentChoices: [RepoChoice] { recent.map(recentToChoice) }
    public var enabledNodes: [RemoteNodeSummary] { allNodes.filter(\.enabled) }

    // MARK: lifetime

    /// The page appeared: listen for the registry, and read everything.
    public func opened() async {
        if refresh == nil {
            refresh = SerialRefresh { [weak self] in await self?.load() }
        }
        // The registry push carries no payload by design — it means "re-list".
        if registry == nil, let hub = hub() {
            let refresh = self.refresh
            registry = hub.addRegistryListener {
                Task { @MainActor in refresh?() }
            }
        }
        await load()
        await loadCatalogs()
    }

    /// The page went: stop listening.
    public func close() {
        registry?()
        registry = nil
    }

    /// Once the server is answering again, refresh without being asked: the
    /// list is the first thing anyone looks at after a reconnect.
    public func connectionRecovered() { refresh?() }

    public func load() async {
        guard let seam = seam() else { return }
        do {
            let next = try await seam.sessions()
            animate { sessions = next }
            error = nil
            // The strip's one read, and a cheap one. A failure here is not the
            // session list's problem, so it is caught on its own.
            if let status = try? await seam.routineStatus(tz: zone()) {
                routines = status
                // The tab's badge, from a read the strip was making anyway.
                routineAlert.setFailed(status.anyFailed)
            }
        } catch is CancellationError {
            return
        } catch {
            // OfflineError already carries the useful sentence; the banner says the
            // rest, so this only needs to explain a server that answered badly.
            self.error = describe(error)
        }
    }

    public func loadCatalogs() async {
        guard let seam = seam() else { return }
        async let modelList = try? seam.models()
        async let facetList = try? seam.facets()
        async let recentList = try? seam.recentRepos()
        async let nodeList = try? seam.nodes()
        models = await modelList ?? models
        facets = await facetList ?? facets
        recent = await recentList ?? recent
        allNodes = await nodeList ?? allNodes

        // Fetched on its own: the server fans this out across every connection, so
        // one slow forge would otherwise hold up the model list.
        if let listing = try? await seam.repos() {
            owned = listing.repos.map(rowToChoice)
            ownedError = listing.errors.isEmpty ? nil : "Couldn't list repositories — \(listing.errors.joined(separator: "; "))"
        }
        ownedLoaded = true
    }

    // MARK: the launcher

    public func addImages(_ added: [PendingImage], problem: String?) {
        pendingImages = Array((pendingImages + added).prefix(ImageRules.maxImages))
        imageError = problem
    }

    public func removeImage(_ key: String) {
        pendingImages.removeAll { $0.key == key }
    }

    public func attach(repos nextRepos: [String], nodes nextNodes: [String]) {
        repos = nextRepos
        nodes = nextNodes
    }

    public func searchRepos(_ term: String) async -> [RepoChoice] {
        guard let seam = seam() else { return [] }
        return ((try? await seam.searchRepos(term)) ?? []).map(rowToChoice)
    }

    /// The launcher's own two-call start, as on the web: create, then run.
    public func start() async {
        guard let seam = seam(), !starting else { return }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return }
        starting = true
        startError = nil
        defer { starting = false }
        let request = CreateSessionRequest(
            selection: options.selection,
            initialPrompt: text,
            repoUrls: repos.isEmpty ? nil : repos,
            thinkingLevel: options.thinking,
            facet: options.facet,
            nodeIds: nodes.isEmpty ? nil : nodes
        )
        do {
            let id: String
            if let pending = unstarted, pending.request == request {
                id = pending.id
            } else {
                if let stale = unstarted {
                    // Made for something else, and never run: nobody will look
                    // for it. Best effort — the new session matters more.
                    unstarted = nil
                    _ = try? await seam.deleteSession(stale.id)
                }
                guard let created = try await seam.createSession(request) else {
                    feedback.error()
                    startError = "That model selection is no longer available."
                    return
                }
                id = created
                unstarted = (created, request)
            }
            // The one setting with no create-time field.
            if options.approval != .dangerous {
                try await seam.setApprovalMode(id, SetApprovalRequest(mode: options.approval, useClassifier: true))
            }
            _ = try await seam.start(id, StartSessionRequest(
                prompt: text,
                selection: options.selection,
                images: pendingImages.isEmpty ? nil : pendingImages.map(\.attachment)
            ))
            unstarted = nil
            feedback.confirm()
            prompt = ""
            pendingImages = []
            imageError = nil
            repos = []
            nodes = []
            open(id)
        } catch {
            feedback.error()
            startError = describe(error)
        }
    }

    // MARK: the list

    public func open(_ id: String) {
        // Leaving with the keyboard up lands on a page with a composer of its own
        // and a keyboard already open for something else.
        dismissKeyboard()
        router.select(.session(id: id))
    }

    public func rename(_ session: SessionSummary, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let seam = seam(), !trimmed.isEmpty, trimmed != session.title else { return }
        actionError = nil
        do {
            try await seam.rename(session.id, name: trimmed)
        } catch is CancellationError {
            return
        } catch {
            // The list still has the old name, which is the truth.
            feedback.error()
            actionError = Self.notDone("renamed", "rename", session.title, error)
            return
        }
        await load()
    }

    public func remove(_ session: SessionSummary) async {
        guard let seam = seam() else { return }
        actionError = nil
        let answer: DeleteResult?
        do {
            answer = try await seam.deleteSession(session.id)
        } catch is CancellationError {
            return
        } catch {
            // Nothing was deleted, so nothing is closed or re-read: the row is
            // still there, and the page says why.
            feedback.error()
            actionError = Self.notDone("deleted", "delete", session.title, error)
            return
        }
        if answer == .running {
            // The server refuses to delete a session mid-turn rather than pull it
            // out from under the harness. Silence here read as a tap that did nothing.
            feedback.error()
            stillRunning = true
            return
        }
        feedback.refuse()
        // Beside the list, the session just deleted may be the one on show.
        if router.selection(on: .sessions) == .session(id: session.id) { router.sessions = [] }
        await load()
    }

    /// Why a change to a session did not happen: no server to ask, or a
    /// server that would not.
    static func notDone(_ done: String, _ doing: String, _ title: String, _ error: Error) -> String {
        if error is OfflineError {
            return "Could not reach the server, so “\(title)” was not \(done). Try again once you are back online."
        }
        if let refused = error as? SeamError {
            return "The server could not \(doing) “\(title)” just now (it answered \(refused.status)). Try again in a moment."
        }
        return "“\(title)” was not \(done): \(describe(error))"
    }

    public func retryRoutine(_ routineId: String, _ runId: String) async {
        guard let seam = seam() else { return }
        _ = try? await seam.retryRoutineRun(routineId, runId: runId)
        if let status = try? await seam.routineStatus(tz: zone()) { routines = status }
    }

    /// Debounced recall, mirroring the web's 300ms. Called from a task keyed on
    /// `recallKey`: a keystroke cancels whatever was in flight, so a slow answer
    /// to an old query never overwrites the answer to the current one. Only
    /// asked once the local filter has come up empty.
    public func recallIfNeeded() async {
        recall = nil
        let term = needle
        guard let seam = seam(), term.count >= 2, searched.isEmpty else {
            recallBusy = false
            return
        }
        await debounce(300)
        if Task.isCancelled { return }
        recallBusy = true
        let hits = (try? await seam.sessionSearch(term, limit: 10)) ?? []
        if Task.isCancelled { return }
        recall = Recall(query: term, hits: hits)
        recallBusy = false
    }
}

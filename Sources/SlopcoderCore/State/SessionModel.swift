// One session screen's data and work: the live store, the draft and what rides
// with it, the dials, the workspace panel and the session switcher.
//
// The view lays this out and keeps only what is its own — which sheet is open,
// whether the reader is at the end of the transcript, the scroll handle. The
// model outlives an appearance: pushing a review over the session stops the
// store (`close`) and coming back opens it again (`open`), while the draft and
// the photos waiting on it stay, as they did when they were the view's state.

import Foundation
import Observation

@MainActor
@Observable
public final class SessionModel {
    /// One repository in the session's workspace, as `workspace/changes` lists it.
    public struct WorkspaceRepo: Decodable, Hashable, Sendable {
        public var repo: String
        public var branch: String?
        public var detached: Bool?
        public var sandboxDown: Bool?
        public var notARepository: Bool?
        public var error: String?

        public init(repo: String, branch: String? = nil, detached: Bool? = nil, sandboxDown: Bool? = nil, notARepository: Bool? = nil, error: String? = nil) {
            self.repo = repo
            self.branch = branch
            self.detached = detached
            self.sandboxDown = sandboxDown
            self.notARepository = notARepository
            self.error = error
        }

        /// What the workspace panel says under the repository's name.
        public var line: String {
            if sandboxDown == true { return "Workspace unavailable" }
            if notARepository == true { return "Not a repository" }
            if let error, !error.isEmpty { return error }
            if let branch, !branch.isEmpty { return "\(detached == true ? "Detached · " : "Branch · ")\(branch)" }
            return "Branch unknown"
        }
    }

    public let sessionId: String

    public private(set) var store: SessionStore?
    public var draft = ""
    public private(set) var pendingImages: [PendingImage] = []
    public private(set) var imageError: String?
    public private(set) var sending = false
    public private(set) var sendError: String?
    public var jumpNotice: String?
    public private(set) var jumpSearching = false
    public private(set) var models: [ModelCandidate] = []
    public private(set) var facets: [FacetOption] = []
    public private(set) var commands: [SlashCommandInfo] = []
    /// What the dials say since the screen last opened, ahead of the server.
    public private(set) var options: TurnOptions?
    public private(set) var loadingEarlier = false

    public private(set) var repoDetails: [WorkspaceRepo]?
    public private(set) var repoError: String?
    public var repoUrl = ""
    public private(set) var addingRepo = false
    public private(set) var repoMessage: String?

    public private(set) var directory: [SessionSummary]?
    public private(set) var directoryError: String?
    public var directoryQuery = ""

    @ObservationIgnored private var commandsAsked = false
    @ObservationIgnored private let seam: @MainActor () -> Seam?
    @ObservationIgnored private let hub: @MainActor () -> SessionHub?
    @ObservationIgnored private let isActive: @MainActor () -> Bool
    @ObservationIgnored private let feedback: Feedback
    @ObservationIgnored private let storeSleep: SessionHub.Sleep?

    /// `seam` and `hub` are asked each time they are needed, as the screen
    /// asked the app: signing out takes them away mid-screen.
    public init(
        sessionId: String,
        seam: @escaping @MainActor () -> Seam?,
        hub: @escaping @MainActor () -> SessionHub?,
        isActive: @escaping @MainActor () -> Bool = { true },
        feedback: Feedback = .silent,
        storeSleep: SessionHub.Sleep? = nil
    ) {
        self.sessionId = sessionId
        self.seam = seam
        self.hub = hub
        self.isActive = isActive
        self.feedback = feedback
        self.storeSleep = storeSleep
    }

    // MARK: what the screen shows

    public var state: SessionState? { store?.state }
    public var running: Bool { state?.status == .running }
    public var archived: Bool { state?.archivedAt != nil }
    public var parentDriven: Bool { state?.parentSessionId != nil }
    public var title: String { state?.title ?? "Session" }
    public var contextPercent: Int? { TranscriptLayout.contextPercent(state?.lastUsage) }
    public var statusLine: String? { TranscriptLayout.statusLine(state) }

    /// Something is holding the turn until a person answers.
    public var waiting: Bool {
        !(state?.pendingApprovalIds.isEmpty ?? true) || !(state?.pendingQuestionIds.isEmpty ?? true)
    }

    public var subtitle: String {
        var branches: [String: String] = [:]
        for repo in repoDetails ?? [] { if let branch = repo.branch { branches[repo.repo] = branch } }
        return Captions.sessionSubtitle(state?.repoNames ?? [], branches: branches)
    }

    public var rows: [DisplayRow] { TranscriptLayout.rows(store?.items ?? []) }
    public var mentions: [SubSessionMention] { TranscriptLayout.mentions(store?.items ?? []) }
    /// The spinner above the first row: there is history still to load.
    public var showsEarlier: Bool { store?.canLoadEarlier == true || store?.loading == true || store == nil }

    public var composerPlaceholder: String { running ? "Steer this conversation…" : "Message \(title)…" }
    public var composerAction: String { running ? "Steer" : "Send" }
    public var draftIsEmpty: Bool { draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The model an Auto session last routed to, whose dial the panel follows.
    public var routed: (connectionId: String?, modelId: String?)? {
        state?.autoRoute == true ? (state?.connectionId, state?.selectedModel) : nil
    }

    /// The session's dials: what it is running as, and what it was last told.
    public var turnOptions: TurnOptions {
        options ?? state.map(TranscriptLayout.turnOptions) ?? TurnOptions()
    }

    public var dials: TurnDials { TurnDials(options: turnOptions, models: models, routed: routed) }

    public var visibleDirectory: [SessionSummary]? {
        directory?.filter { matchesSession($0, query: directoryQuery) }
    }

    // MARK: lifetime

    /// Open the session's live view, and the catalogs the dials offer. Called
    /// each time the screen appears.
    public func open() async {
        guard let seam = seam(), let hub = hub() else { return }
        store?.stop()
        options = nil
        let opened = storeSleep.map { SessionStore(seam: seam, hub: hub, id: sessionId, sleep: $0, isActive: isActive) }
            ?? SessionStore(seam: seam, hub: hub, id: sessionId, isActive: isActive)
        store = opened
        async let modelList = try? seam.models()
        async let facetList = try? seam.facets()
        await opened.start()
        models = await modelList ?? []
        facets = await facetList ?? []
        if options == nil, let state = opened.state { options = TranscriptLayout.turnOptions(state) }
    }

    /// The screen went: stop watching, and let go of the hub's listener.
    public func close() {
        store?.stop()
        store = nil
    }

    // MARK: the composer

    public func addImages(_ added: [PendingImage], problem: String?) {
        pendingImages = Array((pendingImages + added).prefix(ImageRules.maxImages))
        imageError = problem
    }

    public func removeImage(_ key: String) {
        pendingImages.removeAll { $0.key == key }
    }

    /// The slash menu's commands, the first time a slash is typed.
    public func loadCommands() {
        guard !commandsAsked, let seam = seam() else { return }
        commandsAsked = true
        let sessionId = self.sessionId
        Task { commands = (try? await seam.slashCommands(sessionId)) ?? [] }
    }

    /// Each dial is its own call: changing the thinking level must not also
    /// re-send an approval mode somebody changed on another device.
    public func apply(_ next: TurnOptions) {
        let previous = options ?? state.map(TranscriptLayout.turnOptions)
        options = next
        guard let seam = seam(), let previous else { return }
        let sessionId = self.sessionId
        Task {
            if next.thinking != previous.thinking { try? await seam.setThinking(sessionId, level: next.thinking) }
            if next.approval != previous.approval {
                try? await seam.setApprovalMode(sessionId, SetApprovalRequest(mode: next.approval, useClassifier: true))
            }
            if next.facet != previous.facet { try? await seam.setFacet(sessionId, facetName: next.facet) }
        }
    }

    public func send() async {
        guard let seam = seam(), let state, !sending else { return }
        let typed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty { return }
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            draft = ""
            feedback.confirm()
            var prompt = typed
            if parseSlashCommand(prompt) != nil {
                // The command ran there; only a repo template leaves a prompt to send.
                guard let expanded = try await seam.runSlashCommand(sessionId, input: prompt)?.promptToSend, !expanded.isEmpty else { return }
                prompt = expanded
            }
            // Steering is refused when the turn has just ended; start one instead.
            if running, try await seam.steer(sessionId, SteerRequest(prompt: prompt)) { return }
            let sent = pendingImages
            let started = try await seam.start(sessionId, StartSessionRequest(
                prompt: prompt,
                selection: options?.selection ?? TranscriptLayout.turnOptions(state).selection,
                images: sent.isEmpty ? nil : sent.map(\.attachment)
            ))
            if !started { throw SeamError(status: 404, message: "The session did not accept the message.") }
            let keys = Set(sent.map(\.key))
            pendingImages.removeAll { keys.contains($0.key) }
            imageError = nil
        } catch {
            // What was typed comes back, ahead of anything typed since.
            draft = draft.isEmpty ? typed : "\(typed)\n\n\(draft)"
            sendError = describe(error)
            feedback.error()
        }
    }

    public func stop() {
        feedback.refuse()
        let seam = seam()
        let sessionId = self.sessionId
        Task { _ = try? await seam?.stop(sessionId) }
    }

    // MARK: the transcript

    public func approve(_ requestId: String, _ approved: Bool) {
        if approved { feedback.confirm() } else { feedback.refuse() }
        let seam = seam()
        let sessionId = self.sessionId
        Task { _ = try? await seam?.approve(sessionId, ResolveApprovalRequest(requestId: requestId, approved: approved)) }
    }

    public func answer(_ requestId: String, _ answers: [UserQuestionAnswer]?) {
        feedback.confirm()
        let seam = seam()
        let sessionId = self.sessionId
        Task { _ = try? await seam?.answer(sessionId, ResolveQuestionRequest(requestId: requestId, answers: answers)) }
    }

    /// The list keeps the reader on the row they were reading while the page
    /// arrives above it.
    public func loadEarlier() {
        guard let store, store.canLoadEarlier, !loadingEarlier else { return }
        loadingEarlier = true
        Task {
            _ = await store.loadEarlier()
            loadingEarlier = false
        }
    }

    /// An approval was answered, here or elsewhere: what the last search said
    /// about it no longer holds.
    public func approvalsChanged() { jumpNotice = nil }

    /// The approval or question that is holding the turn, for the screen to
    /// scroll to — paging back through earlier messages if it is above what is
    /// loaded. Nil, with `jumpNotice` saying why, when it cannot be found.
    public func findCurrentRequest() async -> String? {
        guard let store, !jumpSearching else { return nil }
        jumpNotice = nil

        func target() -> String? {
            TranscriptLayout.rows(store.items).last { row in
                guard let request = row.requestId else { return false }
                return store.isPending(approval: request) || store.isPending(question: request)
            }?.id
        }
        func stillWaiting() -> Bool {
            !(store.state?.pendingApprovalIds.isEmpty ?? true) || !(store.state?.pendingQuestionIds.isEmpty ?? true)
        }

        if let id = target() { return id }
        guard store.canLoadEarlier else {
            jumpNotice = "Current request was not found in the available transcript."
            return nil
        }
        jumpSearching = true
        defer { jumpSearching = false }
        for _ in 0..<3 {
            let result = await store.loadEarlier()
            if !stillWaiting() {
                jumpNotice = "The request is no longer pending."
                return nil
            }
            if let error = result.error {
                jumpNotice = "Could not load earlier messages: \(error)"
                return nil
            }
            if !result.progress {
                jumpNotice = "Could not find the request in earlier messages."
                return nil
            }
            if let id = target() { return id }
            if !result.hasMore {
                jumpNotice = "Current request was not found in the available transcript."
                return nil
            }
        }
        jumpNotice = "Request not found in three earlier pages. Tap status to search further."
        return nil
    }

    // MARK: the panel

    public func loadWorkspace() async {
        guard let seam = seam() else { return }
        do {
            let rows = try await seam.get([WorkspaceRepo].self, "api/seam/sessions/\(encodeURIComponent(sessionId))/workspace/changes")
            if let rows {
                repoDetails = rows
                repoError = nil
            } else {
                repoError = "Workspace is unavailable."
            }
        } catch is CancellationError {
            return
        } catch {
            repoError = "Could not load workspace details."
        }
    }

    public func addRepository() async {
        guard let seam = seam(), !addingRepo else { return }
        let url = repoUrl.trimmingCharacters(in: .whitespaces)
        if url.isEmpty { return }
        addingRepo = true
        defer { addingRepo = false }
        do {
            if let problem = try await seam.addSessionRepository(sessionId, url: url) {
                repoMessage = problem
            } else {
                repoUrl = ""
                repoMessage = "Repository added."
            }
        } catch {
            repoMessage = describe(error)
        }
    }

    public func loadDirectory() async {
        guard let seam = seam() else { return }
        do {
            directory = try await seam.sessions()
            directoryError = nil
        } catch is CancellationError {
            return
        } catch {
            directoryError = describe(error)
        }
    }
}

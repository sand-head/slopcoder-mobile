#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// The launcher, and the session list — one screen, as on the web.
///
/// The bar is the platform's: a large title that collapses as you scroll and a
/// search field inside it. The composer under it is the one way to start a
/// session.
///
/// Each row's `…` opens a native menu for rename and delete.
struct SessionsScreen: View {
    private enum RecentFilter { case all, running }

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @Environment(ConnectionStatus.self) private var connection
    @Environment(RoutineAlert.self) private var alert

    @State private var sessions: [SessionSummary]?
    @State private var error: String?
    @State private var query = ""
    @State private var filter = RecentFilter.all
    @State private var routines: RoutineStatus?

    // Recall: the search field filters the list locally, and when nothing in it
    // matches, the same words go to the server's full-text search over what was
    // *said* — scrollback, not titles.
    @State private var recall: (query: String, hits: [SessionSearchHit])?
    @State private var recallBusy = false

    @State private var prompt = ""
    @State private var pendingImages: [PendingImage] = []
    @State private var imageError: String?
    @State private var starting = false
    @State private var startError: String?
    @State private var models: [ModelCandidate] = []
    @State private var facets: [FacetOption] = []
    @State private var repos: [String] = []
    @State private var nodes: [String] = []
    @State private var recent: [RecentRepo] = []
    @State private var allNodes: [RemoteNodeSummary] = []
    @State private var owned: [RepoChoice] = []
    @State private var ownedLoaded = false
    @State private var ownedError: String?
    @State private var options = TurnOptions()

    @State private var renaming: SessionSummary?
    @State private var renameDraft = ""
    @State private var deleting: SessionSummary?
    @State private var stillRunning = false
    @State private var registry: (@Sendable () -> Void)?
    @State private var refresh: SerialRefresh?

    private var needle: String { query.trimmingCharacters(in: .whitespaces) }

    private var searched: [SessionSummary] {
        (sessions ?? []).filter { matchesSession($0, query: needle) }
    }

    private var visible: [SessionSummary] {
        searched.filter { filter == .all || $0.status == .running }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(onRetry: { Task { await load() } })

                Text("Start a new chat").font(AppFont.sansMedium(22)).foregroundStyle(Palette.foreground)

                Composer(
                    launcher: true,
                    text: $prompt,
                    placeholder: "Message a new agent…",
                    action: "Start",
                    onAction: { Task { await start() } },
                    busy: starting,
                    disabled: prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    options: $options,
                    models: models,
                    facets: facets,
                    attachments: attachments,
                    images: ComposerImages(
                        pending: pendingImages,
                        error: imageError,
                        onAdd: { added, problem in
                            withAnimation { pendingImages = Array((pendingImages + added).prefix(ImageRules.maxImages)) }
                            imageError = problem
                        },
                        onRemove: { key in withAnimation { pendingImages.removeAll { $0.key == key } } }
                    )
                )

                if let startError { retryable(startError) { Task { await start() } } }
                if let error { retryable(error) { Task { await load() } } }

                listState
                recallSection
                recentSection

                if let routines, routines.anyRoutines, needle.isEmpty {
                    RoutineStrip(status: routines, onRetry: retryRoutine)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .readingWidth()
        }
        .scrollDismissesKeyboard(.interactively)
        .pageBackground()
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Search sessions")
        .textInputAutocapitalization(.never)
        .refreshable { await load() }
        .task { await opened() }
        .onDisappear {
            registry?()
            registry = nil
        }
        // Once the server is answering again, refresh without being asked: the
        // list is the first thing anyone looks at after a reconnect.
        .onChange(of: connection.recoveries) { _, _ in refresh?() }
        .task(id: RecallKey(query: needle, empty: searched.isEmpty)) { await recallIfNeeded() }
        .alert("Rename session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Session name", text: $renameDraft)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Rename") {
                if let target = renaming { Task { await rename(target, renameDraft) } }
                renaming = nil
            }
        }
        .confirmationDialog(
            deleting.map { "Delete “\($0.title)”?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let target = deleting { Task { await remove(target) } }
                deleting = nil
            }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            Text("This cannot be undone.")
        }
        .alert("Still running", isPresented: $stillRunning) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Stop the session before deleting it.")
        }
    }

    // MARK: sections

    private func retryable(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ErrorText(message)
            Button(action: retry) {
                Text("Try again").font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var listState: some View {
        if sessions == nil, error == nil {
            Skeleton(rows: 5)
        } else if let sessions, sessions.isEmpty, needle.isEmpty {
            Hint("No sessions yet. Start one above, or ask Siri. Archived ones are off this list; search still finds them.")
        } else if sessions != nil, searched.isEmpty, !needle.isEmpty, !(recall == nil && recallBusy) {
            Hint("No sessions match “\(needle)”.")
        }
    }

    @ViewBuilder private var recallSection: some View {
        if let recall, !needle.isEmpty, recall.query == needle, searched.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("said in past sessions", trailing: recallBusy ? nil : String(recall.hits.count))
                if recallBusy {
                    Hint("Searching scrollback…")
                } else if recall.hits.isEmpty {
                    Hint("Nothing said in a past session matches that.")
                } else {
                    ForEach(recall.hits, id: \.self) { hit in
                        Button { open(hit.sessionId) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                BodyText(hit.sessionTitle).lineLimit(1)
                                Mono("\(SettingsLogic.stamp(hit.when)) · \(hit.kind)\(hit.archived == true ? " · archived" : "")")
                                Mono(hit.snippet).lineLimit(3)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
                            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open \(hit.archived == true ? "archived " : "")session \(hit.sessionTitle)")
                    }
                }
            }
        }
    }

    @ViewBuilder private var recentSection: some View {
        if !searched.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Text("Recent sessions")
                        .font(AppFont.sansMedium(18))
                        .foregroundStyle(Palette.foreground)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    filterButton("All", .all, label: "All recent sessions")
                    filterButton("Running", .running, label: "Running sessions")
                }
                .padding(.bottom, 8)

                VStack(spacing: 0) {
                    if visible.isEmpty { Hint("No running sessions.").padding(.vertical, 16).frame(maxWidth: .infinity, alignment: .leading) }
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, session in
                        SessionRow(
                            session: session,
                            first: index == 0,
                            onOpen: { open(session.id) },
                            onRename: {
                                renameDraft = session.title
                                renaming = session
                            },
                            onDelete: { deleting = session }
                        )
                        .openBeside(router.selection(on: .sessions) == .session(id: session.id))
                    }
                }
                .padding(.horizontal, 12)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
            }
        }
    }

    private func filterButton(_ title: String, _ value: RecentFilter, label: String) -> some View {
        Button { filter = value } label: {
            Text(title)
                .font(AppFont.sansMedium(13))
                .foregroundStyle(filter == value ? Palette.primary : Palette.mutedForeground)
                .padding(.horizontal, 8)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(filter == value ? .isSelected : [])
    }

    private var attachments: Attachments {
        Attachments(
            repos: repos,
            nodes: nodes,
            recentRepos: recent.map(recentToChoice),
            ownedRepos: owned,
            ownedLoaded: ownedLoaded,
            ownedError: ownedError,
            availableNodes: allNodes.filter(\.enabled).map { SheetOption(key: $0.id, label: $0.name, description: $0.host) },
            searchRepos: { term in
                guard let seam = model.seam else { return [] }
                return ((try? await seam.searchRepos(term)) ?? []).map(rowToChoice)
            },
            onChange: { nextRepos, nextNodes in
                repos = nextRepos
                nodes = nextNodes
            }
        )
    }

    // MARK: work

    private func open(_ id: String) {
        // Leaving with the keyboard up lands on a page with a composer of its own
        // and a keyboard already open for something else.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        router.select(.session(id: id))
    }

    private func opened() async {
        if refresh == nil {
            refresh = SerialRefresh { await load() }
        }
        // The registry push carries no payload by design — it means "re-list".
        if registry == nil, let hub = model.hub {
            let refresh = self.refresh
            registry = hub.addRegistryListener {
                Task { @MainActor in refresh?() }
            }
        }
        await load()
        await loadCatalogs()
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            let next = try await seam.sessions()
            withAnimation { sessions = next }
            error = nil
            // The strip's one read, and a cheap one. A failure here is not the
            // session list's problem, so it is caught on its own.
            if let status = try? await seam.routineStatus(tz: RoutineFormat.deviceZone()) {
                routines = status
                // The tab's badge, from a read the strip was making anyway.
                alert.setFailed(status.anyFailed)
            }
        } catch is CancellationError {
            return
        } catch {
            // OfflineError already carries the useful sentence; the banner says the
            // rest, so this only needs to explain a server that answered badly.
            self.error = describe(error)
        }
    }

    private func loadCatalogs() async {
        guard let seam = model.seam else { return }
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

    /// The launcher's own two-call start, as on the web: create, then run.
    private func start() async {
        guard let seam = model.seam, !starting else { return }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return }
        starting = true
        startError = nil
        defer { starting = false }
        do {
            let created = try await seam.createSession(CreateSessionRequest(
                selection: options.selection,
                initialPrompt: text,
                repoUrls: repos.isEmpty ? nil : repos,
                thinkingLevel: options.thinking,
                facet: options.facet,
                nodeIds: nodes.isEmpty ? nil : nodes
            ))
            guard let id = created else {
                Haptics.error()
                startError = "That model selection is no longer available."
                return
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
            Haptics.confirm()
            prompt = ""
            pendingImages = []
            imageError = nil
            repos = []
            nodes = []
            open(id)
        } catch {
            Haptics.error()
            startError = describe(error)
        }
    }

    private func rename(_ session: SessionSummary, _ name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let seam = model.seam, !trimmed.isEmpty, trimmed != session.title else { return }
        try? await seam.rename(session.id, name: trimmed)
        await load()
    }

    private func remove(_ session: SessionSummary) async {
        guard let seam = model.seam else { return }
        let answer = try? await seam.deleteSession(session.id)
        if answer == .running {
            // The server refuses to delete a session mid-turn rather than pull it
            // out from under the harness. Silence here read as a tap that did nothing.
            Haptics.error()
            stillRunning = true
            return
        }
        Haptics.refuse()
        // Beside the list, the session just deleted may be the one on show.
        if router.selection(on: .sessions) == .session(id: session.id) { router.sessions = [] }
        await load()
    }

    private func retryRoutine(_ routineId: String, _ runId: String) async {
        guard let seam = model.seam else { return }
        _ = try? await seam.retryRoutineRun(routineId, runId: runId)
        if let status = try? await seam.routineStatus(tz: RoutineFormat.deviceZone()) { routines = status }
    }

    private struct RecallKey: Equatable {
        var query: String
        var empty: Bool
    }

    /// Debounced recall, mirroring the web's 300ms: a keystroke cancels whatever
    /// was in flight, so a slow answer to an old query never overwrites the answer
    /// to the current one. Only asked once the local filter has come up empty.
    private func recallIfNeeded() async {
        recall = nil
        let term = needle
        guard let seam = model.seam, term.count >= 2, searched.isEmpty else {
            recallBusy = false
            return
        }
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }
        recallBusy = true
        let hits = (try? await seam.sessionSearch(term, limit: 10)) ?? []
        if Task.isCancelled { return }
        recall = (term, hits)
        recallBusy = false
    }
}

private struct SessionRow: View {
    let session: SessionSummary
    let first: Bool
    let onOpen: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let running = session.status == .running
        let offline = session.clientWorkspace != nil && session.workspaceConnected == false
        let meta = [Captions.workspaceLabel(session), Captions.ago(session.updatedAt)].compactMap { $0 }.joined(separator: " · ")
        HStack(alignment: .top, spacing: 10) {
            Button(action: onOpen) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 15))
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: 20, height: 20)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.title).font(AppFont.sansMedium(13)).foregroundStyle(Palette.foreground).lineLimit(1)
                        Text(meta).font(AppFont.sans(11)).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                        if offline { Meta("workspace offline", color: Palette.destructive) }
                    }
                    Spacer(minLength: 8)
                    Text(running ? "Running" : "Idle")
                        .font(AppFont.sans(11))
                        .foregroundStyle(running ? Status.running : Palette.mutedForeground)
                        .frame(maxHeight: .infinity, alignment: .center)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(session.title), \(running ? "running" : "idle")")
            .accessibilityHint("Opens the session.")

            Menu {
                Button(action: onRename) { Label("Rename", systemImage: "pencil") }
                Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15))
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("More")
        }
        .padding(.vertical, 16)
        .frame(minHeight: 44)
        .overlay(alignment: .top) { if !first { Palette.border.frame(height: 1) } }
    }
}

/// What the routines are up to, under the session list: the failure that needs
/// you, the last thing one said, and what fires next.
private struct RoutineStrip: View {
    let status: RoutineStatus
    let onRetry: (String, String) async -> Void
    @Environment(Router.self) private var router
    @State private var retrying = false

    private func open(_ id: String, run: String?) {
        router.select(.routine(id: id, run: run))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if status.anyFailed { Circle().fill(Palette.destructive).frame(width: 7, height: 7) }
                Meta("routines")
                Spacer()
                Button { router.tab = .routines } label: { Mono("all routines ›", color: Palette.primary) }
                    .buttonStyle(.plain)
            }
            .padding(.top, 10)

            if let failure = status.newestFailure {
                HStack(spacing: 8) {
                    Button { open(failure.routineId, run: failure.runId) } label: {
                        Mono("\(failure.name) failed \(RoutineFormat.clock(failure.at))", color: Palette.destructive)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    Button {
                        retrying = true
                        Task {
                            await onRetry(failure.routineId, failure.runId)
                            retrying = false
                        }
                    } label: {
                        Text("retry").font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(retrying)
                }
            }

            if let notified = status.latestNotified {
                Button { open(notified.routineId, run: notified.id) } label: {
                    (Text(notified.routineName).foregroundStyle(Status.ok)
                        + Text(" \(RoutineFormat.clock(notified.startedAt))\(notified.said.map { " · \(RoutineFormat.firstWords($0))" } ?? "")")
                        .foregroundStyle(Palette.mutedForeground))
                        .font(AppFont.mono(12))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }

            if !status.upcoming.isEmpty {
                Mono("next · " + status.upcoming.map { "\($0.name) \(RoutineFormat.soon($0.at))" }.joined(separator: " · ")).lineLimit(1)
            }
        }
        .padding(.top, 4)
        .topBorder()
    }
}
#endif

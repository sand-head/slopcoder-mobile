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
    @Environment(AppModel.self) private var app
    /// The page's data and work, made the first time the tab's list is drawn
    /// and kept for as long as the list is. It listens for the registry while
    /// the page is on screen; see `SessionsView`.
    @State private var kept = Kept<SessionsModel>()

    var body: some View {
        let app = self.app
        SessionsView(screen: kept.model {
            SessionsModel(
                seam: { app.seam },
                hub: { app.hub },
                router: app.router,
                routineAlert: app.routineAlert,
                feedback: .haptics,
                dismissKeyboard: {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                },
                animate: { change in withAnimation { change() } }
            )
        })
    }
}

private struct SessionsView: View {
    @Bindable var screen: SessionsModel

    @Environment(Router.self) private var router
    @Environment(ConnectionStatus.self) private var connection

    @State private var renaming: SessionSummary?
    @State private var renameDraft = ""
    @State private var deleting: SessionSummary?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(onRetry: { Task { await screen.load() } })

                Text("Start a new chat").font(AppFont.sansMedium(22)).foregroundStyle(Palette.foreground)

                Composer(
                    launcher: true,
                    text: $screen.prompt,
                    placeholder: "Message a new agent…",
                    action: "Start",
                    onAction: { Task { await screen.start() } },
                    busy: screen.starting,
                    disabled: screen.promptIsEmpty,
                    options: $screen.options,
                    models: screen.models,
                    facets: screen.facets,
                    attachments: attachments,
                    images: ComposerImages(
                        pending: screen.pendingImages,
                        error: screen.imageError,
                        onAdd: { added, problem in withAnimation { screen.addImages(added, problem: problem) } },
                        onRemove: { key in withAnimation { screen.removeImage(key) } }
                    )
                )

                if let startError = screen.startError { retryable(startError) { Task { await screen.start() } } }
                if let error = screen.error { retryable(error) { Task { await screen.load() } } }

                listState
                recallSection
                recentSection

                if let routines = screen.strip {
                    RoutineStrip(status: routines, onRetry: screen.retryRoutine)
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
        .searchable(text: $screen.query, prompt: "Search sessions")
        .textInputAutocapitalization(.never)
        .refreshable { await screen.load() }
        .task { await screen.opened() }
        .onDisappear { screen.close() }
        .onChange(of: connection.recoveries) { _, _ in screen.connectionRecovered() }
        .task(id: screen.recallKey) { await screen.recallIfNeeded() }
        .alert("Rename session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Session name", text: $renameDraft)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Rename") {
                if let target = renaming {
                    let name = renameDraft
                    Task { await screen.rename(target, to: name) }
                }
                renaming = nil
            }
        }
        .confirmationDialog(
            deleting.map { "Delete “\($0.title)”?" } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let target = deleting { Task { await screen.remove(target) } }
                deleting = nil
            }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: {
            Text("This cannot be undone.")
        }
        .alert("Still running", isPresented: $screen.stillRunning) {
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
        switch screen.listState {
        case .loading:
            Skeleton(rows: 5)
        case .empty:
            Hint("No sessions yet. Start one above, or ask Siri. Archived ones are off this list; search still finds them.")
        case .noMatch(let needle):
            Hint("No sessions match “\(needle)”.")
        case .rows:
            EmptyView()
        }
    }

    @ViewBuilder private var recallSection: some View {
        if let recall = screen.shownRecall {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("said in past sessions", trailing: screen.recallBusy ? nil : String(recall.hits.count))
                if screen.recallBusy {
                    Hint("Searching scrollback…")
                } else if recall.hits.isEmpty {
                    Hint("Nothing said in a past session matches that.")
                } else {
                    ForEach(recall.hits, id: \.self) { hit in
                        Button { screen.open(hit.sessionId) } label: {
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
        if !screen.searched.isEmpty {
            let visible = screen.visible
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
                            onOpen: { screen.open(session.id) },
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

    private func filterButton(_ title: String, _ value: SessionsModel.Filter, label: String) -> some View {
        Button { screen.filter = value } label: {
            Text(title)
                .font(AppFont.sansMedium(13))
                .foregroundStyle(screen.filter == value ? Palette.primary : Palette.mutedForeground)
                .padding(.horizontal, 8)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(screen.filter == value ? .isSelected : [])
    }

    private var attachments: Attachments {
        Attachments(
            repos: screen.repos,
            nodes: screen.nodes,
            recentRepos: screen.recentChoices,
            ownedRepos: screen.owned,
            ownedLoaded: screen.ownedLoaded,
            ownedError: screen.ownedError,
            availableNodes: screen.enabledNodes.map { SheetOption(key: $0.id, label: $0.name, description: $0.host) },
            searchRepos: { [screen] term in await screen.searchRepos(term) },
            onChange: { [screen] repos, nodes in screen.attach(repos: repos, nodes: nodes) }
        )
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

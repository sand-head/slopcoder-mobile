#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// One session: the transcript, live, and the composer under it.
///
/// The transcript reads top to bottom and stays pinned to its end while a turn
/// streams; scrolling up lets go of that, and a button brings it back. The
/// composer floats over the transcript in glass, so the list runs under it.
struct SessionScreen: View {
    let sessionId: String

    @Environment(AppModel.self) private var app
    /// The screen's data and work: made the first time the screen is drawn and
    /// kept for as long as SwiftUI keeps this view — one session, since a
    /// route's screen is identified by its route. Its live store is opened on
    /// each appearance and stopped on each disappearance; see `SessionView`.
    @State private var kept = Kept<SessionModel>()

    var body: some View {
        let app = self.app
        let sessionId = self.sessionId
        SessionView(sessionId: sessionId, screen: kept.model {
            SessionModel(
                sessionId: sessionId,
                seam: { app.seam },
                hub: { app.hub },
                isActive: { UIApplication.shared.applicationState == .active },
                feedback: .haptics
            )
        })
    }
}

private struct SessionView: View {
    let sessionId: String
    @Bindable var screen: SessionModel

    private enum SheetKind: String, Identifiable {
        case context, usage, switcher, terminal
        var id: String { rawValue }
    }

    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    /// The reader is at the end of the transcript; the list says so.
    @State private var pinned = true
    @State private var scroller = TranscriptScroller()
    @State private var sheet: SheetKind?

    private var state: SessionState? { screen.state }
    private var archived: Bool { screen.archived }
    private var parentDriven: Bool { screen.parentDriven }
    private var title: String { screen.title }
    private var subtitle: String { screen.subtitle }
    private var contextPercent: Int? { screen.contextPercent }

    var body: some View {
        Group {
            if let error = screen.store?.error {
                VStack(alignment: .leading) {
                    ErrorText(error)
                    Spacer()
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                transcript
            }
        }
        .pageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task(id: sessionId) { await screen.open() }
        .onDisappear { screen.close() }
        // Shake for the terminal: the machine itself, wanted exactly when the
        // agent's account of what it did stops being enough.
        .onShake(enabled: sheet == nil && !archived && scenePhase == .active) {
            Haptics.confirm()
            sheet = .terminal
        }
        .sheet(item: sheetBinding) { kind in
            switch kind {
            case .context: contextSheet
            case .usage: usageSheet
            case .switcher: switcherSheet
            case .terminal: TerminalSheet(sessionId: sessionId)
            }
        }
        .fullScreenCover(isPresented: terminalCover) {
            TerminalSheet(sessionId: sessionId, fullScreen: true)
        }
    }

    /// Where the system can arrange a view around a fold (iOS 27.1), the terminal
    /// takes the whole window so that it can: its screen above the fold of an
    /// iPhone Duo set down like a laptop, its keys below. Before that it is a sheet.
    private static var terminalTakesTheWindow: Bool {
        if #available(iOS 27.1, *) { return true }
        return false
    }

    private var sheetBinding: Binding<SheetKind?> {
        Binding(
            get: { sheet == .terminal && SessionView.terminalTakesTheWindow ? nil : sheet },
            // A sheet finishing its own dismissal must not close a terminal
            // that was opened from it.
            set: { next in if next != nil || !(sheet == .terminal && SessionView.terminalTakesTheWindow) { sheet = next } }
        )
    }

    private var terminalCover: Binding<Bool> {
        Binding(
            get: { sheet == .terminal && SessionView.terminalTakesTheWindow },
            set: { shown in if !shown, sheet == .terminal { sheet = nil } }
        )
    }

    // MARK: the transcript

    private var transcript: some View {
        let rows = screen.rows
        let context = rowContext
        return GeometryReader { proxy in
            // The list runs under the bars, the banner, the composer and the
            // keyboard, and is told how much of it each covers.
            TranscriptList(
                rows: rows,
                context: context,
                live: screen.store?.live,
                showsEarlier: screen.showsEarlier,
                insets: proxy.safeAreaInsets,
                scroller: scroller,
                onPinned: { pinned = $0 },
                onNearTop: screen.loadEarlier
            )
            .ignoresSafeArea()
        }
        // A different session is a different list: nothing a row held, and no
        // measurement, carries over.
        .id(sessionId)
        .safeAreaInset(edge: .top) { ConnectionBanner().padding(.horizontal, 10) }
        .safeAreaInset(edge: .bottom) { footer }
        .onChange(of: state?.pendingApprovalIds.count ?? 0) { _, _ in screen.approvalsChanged() }
    }

    private var rowContext: RowContext {
        RowContext(
            parentDriven: parentDriven,
            roster: state?.subSessions ?? [],
            mentions: screen.mentions,
            pendingApprovals: state?.pendingApprovalIds ?? [],
            pendingQuestions: state?.pendingQuestionIds ?? [],
            onApprove: { [screen] requestId, approved in screen.approve(requestId, approved) },
            onAnswer: { [screen] requestId, answers in screen.answer(requestId, answers) },
            onOpenSession: { [router] id in router.push(.session(id: id)) }
        )
    }

    /// Scroll to the approval or question that is holding the turn, once the
    /// model has found it.
    private func jumpToCurrentRequest() async {
        if let id = await screen.findCurrentRequest() { scroller.reveal(id) }
    }

    // MARK: under the transcript

    @ViewBuilder private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !pinned {
                HStack {
                    Spacer()
                    Button {
                        scroller.toEnd()
                    } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Palette.foreground)
                            .frame(width: 36, height: 36)
                            .glassSurface(cornerRadius: 18, interactive: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Jump to the latest")
                    Spacer()
                }
            }

            if archived {
                ArchivedNote(at: state?.archivedAt) {
                    router.reset()
                }
            } else if parentDriven {
                SubSessionNote(closed: state?.closed == true)
            } else {
                if let sendError = screen.sendError { ErrorText(sendError) }
                if let jumpNotice = screen.jumpNotice { BodyText(jumpNotice, size: 13, color: Palette.mutedForeground) }
                if let photosHeld = screen.photosHeld { BodyText(photosHeld, size: 13, color: Palette.mutedForeground) }
                Composer(
                    text: $screen.draft,
                    placeholder: screen.composerPlaceholder,
                    action: screen.composerAction,
                    onAction: { Task { await screen.send() } },
                    busy: screen.sending,
                    disabled: screen.draftIsEmpty,
                    running: screen.running,
                    onStop: screen.stop,
                    stopping: state?.stopRequested ?? false,
                    options: turnOptions,
                    models: screen.models,
                    routed: screen.routed,
                    facets: screen.facets,
                    images: ComposerImages(
                        pending: screen.pendingImages,
                        error: screen.imageError,
                        onAdd: { added, problem in withAnimation { screen.addImages(added, problem: problem) } },
                        onRemove: { key in withAnimation { screen.removeImage(key) } }
                    ),
                    commands: ComposerCommands(list: screen.commands, onNeeded: screen.loadCommands),
                    sessionStatus: screen.statusLine,
                    onStatusTap: screen.waiting && !screen.jumpSearching ? { Task { await jumpToCurrentRequest() } } : nil
                )
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 4)
        .padding(.bottom, 10)
        // The same measure as the transcript above it, so the two share an edge.
        .readingWidth()
    }

    // MARK: the bar

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Button { sheet = .context } label: {
                VStack(spacing: 1) {
                    Text(title).font(AppFont.sansMedium(15)).foregroundStyle(Palette.foreground).lineLimit(1)
                    Text(subtitle).font(AppFont.sans(11)).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                }
                .padding(.horizontal, 6)
            }
            // On iOS 26 a bar gives a button its glass capsule; left plain, the
            // title would be bare text beside everything else that floats.
            .modifier(PlainBeforeGlass())
            .accessibilityLabel("\(title). \(subtitle). \(archived ? "archived · read-only. " : "")Session settings")
            .accessibilityIdentifier("session.title")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { sheet = .usage } label: {
                // A picture, not a view: the system only stands an item in a
                // vertical bar when its icon is an image.
                Label { Text("Session usage") } icon: { ContextRingImage(percent: contextPercent) }
            }
            .accessibilityLabel(
                contextPercent.map { "\($0)% of context used. Session usage" } ?? "Context usage not reported yet. Session usage"
            )
        }
        // The ring shows how full the context is; when a bar runs short of room
        // it is the item to keep.
        .keptVisible()
        optionsMenu
    }

    /// Everything else the session can do. Where the system has an overflow menu
    /// of its own (iOS 27) these go into it, so there is one place to look and
    /// it is the same place in every app; before that, a menu of ours.
    @ToolbarContentBuilder private var optionsMenu: some ToolbarContent {
        if #available(iOS 27.0, *) {
            ToolbarOverflowMenu { menuItems }
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                Menu { menuItems } label: { Label("Session options", systemImage: "ellipsis.circle") }
            }
        }
    }

    @ViewBuilder private var menuItems: some View {
        if !archived {
            Button { sheet = .terminal } label: { Label("Open terminal", systemImage: "terminal") }
        }
        Button { sheet = .context } label: { Label("Session settings", systemImage: "slider.horizontal.3") }
        Button { sheet = .switcher } label: { Label("Switch session", systemImage: "bubble.left.and.bubble.right") }
        Button { sheet = .usage } label: { Label("Session usage", systemImage: "chart.bar") }
    }

    // MARK: sheets

    /// The session's dials: what it is running as, and the way to change that.
    private var turnOptions: Binding<TurnOptions> {
        Binding(get: { screen.turnOptions }, set: { screen.apply($0) })
    }

    private var dials: TurnDials { screen.dials }

    /// Everything about the session that is not the conversation: what it runs
    /// as, what it works on, how full it is, and the ways out of it.
    ///
    /// The model and the turn's dials are here rather than on the composer
    /// because they belong to the session, not to the next message.
    private var contextSheet: some View {
        let dials = self.dials
        let status = TranscriptLayout.statusLine(state) ?? ""
        return AppSheet(title: "Session", detents: [.large]) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(AppFont.sansMedium(22)).foregroundStyle(Palette.foreground)
                HStack(spacing: 8) {
                    StatusDot(running: screen.running)
                    Mono(archived ? "archived · read-only" : status.lowercased())
                    if let handle = state?.chatHandle, !handle.isEmpty {
                        Mono("· @\(handle)").textSelection(.enabled)
                    }
                }
            }
            .padding(.bottom, 4)

            if let dialError = screen.dialError { ErrorText(dialError) }
            if !archived, !parentDriven {
                PanelSection(label: "runs as") {
                    NavigationLink {
                        ChoicePage(title: "Model") { done in
                            ModelPicker(options: turnOptions, models: screen.models, onPicked: done)
                        }
                    } label: { PanelRow(systemImage: "cpu", title: "Model", value: dials.modelLabel) }
                    PanelDivider()
                    NavigationLink { thinkingPage } label: {
                        PanelRow(systemImage: "brain", title: "Thinking", value: dials.thinkingLabel)
                    }
                    PanelDivider()
                    NavigationLink { approvalsPage } label: {
                        PanelRow(systemImage: "hand.raised", title: "Approvals", value: dials.approvalLabel)
                    }
                    if !screen.facets.isEmpty {
                        PanelDivider()
                        NavigationLink { facetPage } label: {
                            PanelRow(systemImage: "theatermasks", title: "Facet", value: turnOptions.wrappedValue.facet ?? "Default")
                        }
                    }
                }
                .buttonStyle(.plain)
            }

            PanelSection(label: "context") {
                VStack(alignment: .leading, spacing: 8) {
                    if let usage = state?.lastUsage, usage.contextWindowTokens > 0 {
                        ContextBar(percent: contextPercent ?? 0)
                        Mono("\(contextPercent ?? 0)% of \(usage.contextWindowTokens.formatted()) tokens on the last request")
                    } else {
                        Mono("No request yet.")
                    }
                }
                .padding(14)
                PanelDivider()
                Button { sheet = .usage } label: {
                    PanelRow(
                        systemImage: "chart.bar", title: "Usage",
                        value: state?.usage.estimatedCost.map { "$\(jsToFixed($0, 2))" }
                    )
                }
                PanelDivider()
                Button {
                    sheet = nil
                    router.push(.reviews(sessionId: sessionId))
                } label: { PanelRow(systemImage: "checklist", title: "Code reviews") }
            }
            .buttonStyle(.plain)

            PanelSection(label: "workspace") {
                let names = state?.repoNames ?? []
                if names.isEmpty, (screen.repoDetails ?? []).isEmpty {
                    Mono("No repositories.").padding(14)
                }
                if let details = screen.repoDetails {
                    ForEach(Array(details.enumerated()), id: \.element.repo) { index, repo in
                        if index > 0 { PanelDivider() }
                        workspaceRow(repo.repo, detail: repo.line)
                    }
                } else {
                    ForEach(Array(names.enumerated()), id: \.element) { index, name in
                        if index > 0 { PanelDivider() }
                        workspaceRow(name, detail: screen.repoError ?? "loading…")
                    }
                }
            }
            if !archived {
                HStack(spacing: 8) {
                    AppField(placeholder: "Add a repository URL", text: $screen.repoUrl, keyboard: .URL)
                    AppButton("Add", busy: screen.addingRepo, disabled: screen.repoUrl.trimmingCharacters(in: .whitespaces).isEmpty) {
                        Task { await screen.addRepository() }
                    }
                }
                if let repoMessage = screen.repoMessage { BodyText(repoMessage, size: 13) }
            }

            PanelSection {
                if !archived {
                    Button { sheet = .terminal } label: { PanelRow(systemImage: "terminal", title: "Open terminal") }
                    PanelDivider()
                }
                Button { sheet = .switcher } label: {
                    PanelRow(systemImage: "bubble.left.and.bubble.right", title: "Switch session")
                }
            }
            .buttonStyle(.plain)
        }
        .task(id: screen.repoMessage) { await screen.loadWorkspace() }
    }

    private func workspaceRow(_ name: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "folder").font(.system(size: 15)).foregroundStyle(Palette.mutedForeground).frame(width: 24).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(AppFont.sans(15)).foregroundStyle(Palette.foreground).textSelection(.enabled)
                Mono(detail).textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var thinkingPage: some View {
        let caps = dials.caps
        let offered = offeredLevels(caps)
        return ChoicePage(title: "Thinking") { done in
            SheetGroup(
                options: [SheetOption(key: "auto", label: "Auto", description: "Whatever the model does by default")]
                    + offered.map { SheetOption(key: levelKey($0), label: levelLabel($0, caps)) },
                selected: dials.shownThinking.map(levelKey) ?? "auto"
            ) { key in
                var next = turnOptions.wrappedValue
                next.thinking = offered.first { levelKey($0) == key }
                turnOptions.wrappedValue = next
                done()
            }
        }
    }

    private var approvalsPage: some View {
        ChoicePage(title: "Approvals") { done in
            SheetGroup(
                options: ApprovalChoice.all.map { SheetOption(key: $0.key, label: $0.label, description: $0.description) },
                selected: ApprovalChoice.all.first { $0.value == turnOptions.wrappedValue.approval }?.key ?? "dangerous"
            ) { key in
                var next = turnOptions.wrappedValue
                next.approval = ApprovalChoice.all.first { $0.key == key }?.value ?? .dangerous
                turnOptions.wrappedValue = next
                done()
            }
        }
    }

    private var facetPage: some View {
        ChoicePage(title: "Facet") { done in
            SheetGroup(
                options: [SheetOption(key: "", label: "Default")]
                    + screen.facets.map { SheetOption(key: $0.name, label: $0.name, description: $0.description) },
                selected: turnOptions.wrappedValue.facet ?? ""
            ) { key in
                var next = turnOptions.wrappedValue
                next.facet = key.isEmpty ? nil : key
                turnOptions.wrappedValue = next
                done()
            }
        }
    }

    private var usageSheet: some View {
        AppSheet(title: "Session usage") {
            if let state {
                AppButton("Open reviews", variant: .ghost) {
                    sheet = nil
                    router.push(.reviews(sessionId: sessionId))
                }

                Meta("context")
                if let usage = state.lastUsage, usage.contextWindowTokens > 0 {
                    ContextBar(percent: contextPercent ?? 0)
                    Mono("last request used \(contextPercent ?? 0)% of \(usage.contextWindowTokens.formatted()) tokens")
                } else {
                    Mono("No request yet.")
                }

                Meta("this session")
                if state.usage.models.isEmpty, state.usage.estimatedCost == nil {
                    Mono("Nothing spent yet.")
                } else {
                    ForEach(state.usage.models, id: \.model) { usage in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                BodyText(usage.model).lineLimit(1)
                                Mono("\(usage.completions) calls")
                            }
                            Spacer()
                            // New tokens, not the full footprint: the prefix is
                            // re-read on every step and would read as consumption
                            // it is not.
                            Mono(usage.newTokens.formatted(), size: 12.5, color: Palette.foreground)
                        }
                        .padding(.vertical, 8)
                        .frame(minHeight: 44)
                        .topBorder()
                    }
                }
                if let cost = state.usage.estimatedCost { Mono("estimated cost $\(jsToFixed(cost, 2))") }

                if let handle = state.chatHandle, !handle.isEmpty {
                    Meta("agent handle")
                    Mono("@\(handle)", size: 12.5, color: Palette.foreground).textSelection(.enabled)
                }
            }
        }
    }

    private var switcherSheet: some View {
        let visible = screen.visibleDirectory
        return AppSheet(title: "Sessions", detents: [.large]) {
            if let directoryError = screen.directoryError { Mono(directoryError, color: Palette.destructive) }
            AppField(placeholder: "Search sessions", text: $screen.directoryQuery)
            if screen.directory == nil { Skeleton(rows: 3) }
            if let directory = screen.directory, directory.isEmpty { Hint("No sessions yet.") }
            if let visible, visible.isEmpty, !screen.directoryQuery.trimmingCharacters(in: .whitespaces).isEmpty { Hint("No matching sessions.") }
            ForEach(visible ?? []) { session in
                Button { switchTo(session.id) } label: {
                    HStack(spacing: 10) {
                        StatusDot(running: session.status == .running)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.title)
                                .font(session.id == sessionId ? AppFont.sansMedium(14) : AppFont.sans(14))
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                            Mono([Captions.workspaceLabel(session), Captions.ago(session.updatedAt)].compactMap { $0 }.joined(separator: " · "), size: 11)
                        }
                        Spacer(minLength: 0)
                        if session.id == sessionId {
                            Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.primary)
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .topBorder()
            }
        }
        .task { await screen.loadDirectory() }
    }

    // MARK: navigation

    private func switchTo(_ id: String) {
        sheet = nil
        guard id != sessionId else { return }
        // Replace, not push: switching sessions is not going deeper.
        router.pop()
        router.push(.session(id: id))
    }
}

/// How much of the model's window the last request filled, as a ring: emerald,
/// then amber from 70%, then red from 90%.
struct ContextRing: View {
    let percent: Int?
    var size: CGFloat = 24
    /// Say the figure inside the ring, where there is nowhere else to say it.
    var showsNumber = false

    static func tone(_ percent: Int) -> Color {
        percent >= 90 ? Palette.destructive : percent >= 70 ? Status.running : Palette.primary
    }

    var body: some View {
        let value = percent ?? 0
        ZStack {
            Circle().stroke(Palette.mutedForeground.opacity(0.28), lineWidth: 3)
            // No arc at all when there is nothing to show: a sliver at zero reads
            // as "a little", which is not what unknown means.
            if value > 0 {
                Circle()
                    .trim(from: 0, to: CGFloat(min(100, value)) / 100)
                    .stroke(ContextRing.tone(value), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            if showsNumber, let percent {
                Text(String(min(100, percent)))
                    .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
                    .foregroundStyle(Palette.foreground)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(width: size, height: size)
    }
}

private struct ContextBar: View {
    let percent: Int

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.mutedForeground.opacity(0.2))
                Capsule().fill(ContextRing.tone(percent)).frame(width: proxy.size.width * CGFloat(min(100, max(0, percent))) / 100)
            }
        }
        .frame(height: 6)
    }
}

private struct ArchivedNote: View {
    let at: String?
    let onNewSession: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Archived\(at.map { " \(SettingsLogic.stamp($0))" } ?? "") after a long stretch without activity. It is read-only now — its sandbox won't start again — but it stays searchable until you delete it.")
                .font(AppFont.sans(13))
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            AppButton("Start a new session", variant: .ghost, action: onNewSession)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassSurface(cornerRadius: Radius.xl)
    }
}

private struct SubSessionNote: View {
    let closed: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Fork(color: Status.subagent)
            Text("This is a sub-session: its prompts come from the agent in its parent session\(closed ? ", which has set it aside for now" : ""). Watch it work and approve what it asks — the conversation is the parent's.")
                .font(AppFont.sans(13))
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassSurface(cornerRadius: Radius.xl)
    }
}
/// Before iOS 26 a button in a bar is drawn plain; from 26 the bar draws it.
private struct PlainBeforeGlass: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
        } else {
            content.buttonStyle(.plain)
        }
    }
}

/// The context ring as an image, with the percentage inside it.
private struct ContextRingImage: View {
    let percent: Int?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var scale

    var body: some View {
        let renderer = ImageRenderer(
            content: ContextRing(percent: percent, size: 26, showsNumber: true)
                .padding(2)
                .environment(\.colorScheme, scheme)
        )
        renderer.scale = scale
        return Group {
            if let image = renderer.uiImage {
                Image(uiImage: image).renderingMode(.original)
            } else {
                Image(systemName: "chart.pie")
            }
        }
    }
}
#endif

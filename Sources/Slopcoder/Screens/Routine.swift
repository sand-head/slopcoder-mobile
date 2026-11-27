#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// One routine: what it does, how it has gone, and the runs under it.
struct RoutineScreen: View {
    let routineId: String
    var initialRun: String?

    private enum Tab: String { case runs, prompt, triggers }

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router

    @State private var detail: RoutineDetail?
    @State private var missing = false
    @State private var runs: [RunSummary] = []
    @State private var total = 0
    @State private var paging = false
    @State private var tab = Tab.runs
    @State private var busy = false
    @State private var error: String?
    @State private var selectedRun: String?
    @State private var openedInitialRun = false
    @State private var run: RunDetail?

    // Drafts, and what the server last said — so a poll does not clobber typing,
    // but does pick up a change made somewhere else.
    @State private var prompt = ""
    @State private var storedPrompt = ""
    @State private var notepad = ""
    @State private var storedNotepad = ""
    @State private var beat = RoutineEditor.HeartbeatSettings(interval: "", activeStart: "", activeEnd: "", model: "")
    @State private var storedBeat = RoutineEditor.HeartbeatSettings(interval: "", activeStart: "", activeEnd: "", model: "")
    @State private var models: [ModelCandidate] = []
    @State private var pickingModel = false
    @State private var rotated: [AutomationWebhookSecret] = []
    @State private var confirmingDelete = false
    @State private var rotating: TriggerStats?
    @State private var editing: EditTarget?

    private struct EditTarget: Identifiable {
        let id = UUID()
        var addTrigger: Bool
    }

    private static let page = 30
    private static let pollNs: UInt64 = 15_000_000_000

    private var routine: AutomationSummary? { detail?.routine }
    private var isBeat: Bool { routine?.kind == .heartbeat }

    var body: some View {
        Group {
            if missing {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No such routine").font(AppFont.sansMedium(16)).foregroundStyle(Palette.foreground)
                    Hint("It was deleted, or it belongs to someone else.")
                    Spacer()
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                content
            }
        }
        .pageBackground()
        .navigationTitle(routine?.name ?? "Routine")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .refreshable { await load() }
        .task { await load() }
        .task(id: detail?.running ?? false) {
            guard detail?.running == true else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: RoutineScreen.pollNs)
                if Task.isCancelled { return }
                await load()
            }
        }
        .task(id: selectedRun) { await loadRun() }
        .sheet(isPresented: Binding(get: { selectedRun != nil }, set: { if !$0 { selectedRun = nil } })) { runSheet }
        .sheet(isPresented: $pickingModel) { modelSheet }
        .sheet(isPresented: Binding(get: { !rotated.isEmpty }, set: { if !$0 { rotated = [] } })) {
            SecretSheet(secrets: rotated, server: model.auth.credential?.server) { rotated = [] }
        }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { target in
            RoutineEditorScreen(routineId: routineId, addTrigger: target.addTrigger)
        }
        .confirmationDialog(
            "Delete “\(routine?.name ?? "this routine")”?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It stops running and its run history goes with it.")
        }
        .confirmationDialog(
            "Rotate the secret?", isPresented: Binding(get: { rotating != nil }, set: { if !$0 { rotating = nil } }), titleVisibility: .visible
        ) {
            Button("Rotate", role: .destructive) {
                if let trigger = rotating { Task { await rotate(trigger) } }
                rotating = nil
            }
            Button("Cancel", role: .cancel) { rotating = nil }
        } message: {
            Text("The old one stops working at once; the URL keeps its address.")
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if let routine {
                Toggle("Enabled", isOn: Binding(
                    get: { routine.enabled },
                    set: { on in
                        detail?.routine.enabled = on
                        Task { await act { try await $0.setRoutineEnabled(routineId, enabled: on) } }
                    }
                ))
                .labelsHidden()
                .tint(Palette.primary)
                .disabled(busy)
                .accessibilityLabel("\(routine.name) enabled")
            }
        }
        optionsMenu
    }

    /// In the system's own overflow menu where there is one (iOS 27).
    @ToolbarContentBuilder private var optionsMenu: some ToolbarContent {
        if #available(iOS 27.0, *) {
            ToolbarOverflowMenu { options }
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                if routine != nil {
                    Menu { options } label: { Label("More", systemImage: "ellipsis.circle") }
                }
            }
        }
    }

    @ViewBuilder private var options: some View {
        if let routine {
            if let sessionId = routine.sessionId {
                Button { router.push(.session(id: sessionId)) } label: { Label("Open session", systemImage: "bubble.left") }
            }
            // The heartbeat is the system's: its prompt and triggers are not a form.
            if !isBeat {
                Button { editing = EditTarget(addTrigger: false) } label: { Label("Edit", systemImage: "pencil") }
            }
            Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ConnectionBanner(onRetry: { Task { await load() } })
                if let error { ErrorText(error) }
                if detail == nil, error == nil { Skeleton(rows: 4) }

                if let detail, let routine {
                    summary(detail, routine)

                    AppButton("Run now", variant: .outline, busy: busy) {
                        Haptics.confirm()
                        Task { await act { try await $0.runRoutineNow(routineId) } }
                    }

                    Picker("View", selection: $tab) {
                        Text("Runs").tag(Tab.runs)
                        Text("Prompt").tag(Tab.prompt)
                        Text("Triggers").tag(Tab.triggers)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: tab) { _, _ in Haptics.select() }

                    switch tab {
                    case .runs: runsTab
                    case .prompt: promptTab(routine)
                    case .triggers: triggersTab(detail)
                    }
                }
            }
            .padding(20)
            .readingWidth()
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func summary(_ detail: RoutineDetail, _ routine: AutomationSummary) -> some View {
        let paused = !routine.enabled || !routine.scheduleEnabled
        return VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    if detail.running { StatusDot(running: true) }
                    BodyText(detail.scheduleSentence, size: 13.5)
                }
                if !detail.scheduleMeta.isEmpty { Mono(detail.scheduleMeta) }
                Mono("\(RoutineFormat.nextLabel(detail.nextFire, paused: paused)) · notifies \(detail.notifiesLabel) · model \(routine.model ?? "auto")")
                // A routine that can run shell on a machine with nobody watching
                // says so, in red, on the page that turns it on.
                if !routine.nodeIds.isEmpty {
                    Mono("runs shell on \(routine.nodeIds.count) \(routine.nodeIds.count == 1 ? "machine" : "machines"), unattended", color: Palette.destructive)
                }
            }
            HistoryStrip(history: detail.history, height: 22)
            HStack(spacing: 10) {
                Mono("\(detail.runs30d) runs · 30d")
                Mono("\(detail.notified30d) notified", color: Status.ok)
                Mono("\(detail.failed30d) failed", color: Palette.destructive)
                Mono(detail.medianDurationMs.map { "\(RoutineFormat.duration($0)) median" } ?? "no median yet")
            }
        }
    }

    @ViewBuilder private var runsTab: some View {
        if runs.isEmpty { Hint("No runs yet.") }
        VStack(spacing: 0) {
            ForEach(runs) { row in RoutineRunRow(run: row) { selectedRun = row.id } }
        }
        if runs.count < total {
            Button { Task { await loadMore() } } label: {
                Text(paging ? "loading…" : "load more · \(runs.count) of \(total)").font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private func promptTab(_ routine: AutomationSummary) -> some View {
        if isBeat {
            Hint("The check-in's prompt is fixed — what it watches is the notepad, and the agent keeps that current with set_notepad.")
            Text(routine.prompt)
                .font(AppFont.mono(11.5))
                .foregroundStyle(Palette.foreground)
                .lineSpacing(3)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Radius.md))
                .textSelection(.enabled)

            Meta("notepad")
            AppEditor(text: $notepad, placeholder: "What the check-in watches.")
            SaveRow(dirty: notepad != storedNotepad, busy: busy, label: "Save notepad") {
                Task { await act { try await $0.setRoutineNotepad(routineId, notepad: notepad) } }
            }

            Meta("schedule").padding(.top, 6)
            SheetSegments(
                label: "every",
                options: RoutineEditor.heartbeatIntervals.map { SheetOption(key: $0.key, label: $0.label) },
                selected: beat.interval
            ) { key in
                Haptics.select()
                beat.interval = key
            }
            Meta("active hours")
            HStack(spacing: 8) {
                AppField(placeholder: "any", text: $beat.activeStart, keyboard: .numbersAndPunctuation).accessibilityLabel("Active from")
                Mono("–")
                AppField(placeholder: "any", text: $beat.activeEnd, keyboard: .numbersAndPunctuation).accessibilityLabel("Active until")
            }
            Hint("Beats may only start inside this window, as HH:MM. Blank means any time.")

            let modelLabel = beat.model.isEmpty ? "auto" : models.first { $0.modelId == beat.model }?.modelDisplayName ?? beat.model
            Button { pickingModel = true } label: {
                HStack {
                    Meta("model")
                    Spacer()
                    BodyText(modelLabel, size: 15).lineLimit(1)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.mutedForeground)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel("Model: \(modelLabel)")

            SaveRow(dirty: beat != storedBeat, busy: busy, label: "Save schedule") {
                guard RoutineEditor.timeOk(beat.activeStart), RoutineEditor.timeOk(beat.activeEnd) else {
                    error = "Active hours read as HH:MM."
                    return
                }
                // A full draft, every other field carried across unchanged, so
                // saving the interval cannot quietly clear the delivery target.
                let draft = RoutineEditor.heartbeatDraft(routine, beat)
                Task { await act { try await $0.updateRoutine(routineId, draft).error } }
            }
        } else {
            AppEditor(text: $prompt, placeholder: "What to do each run. It arrives with no conversation around it.")
            SaveRow(dirty: prompt != storedPrompt, busy: busy, label: "Save") {
                Task { await act { try await $0.setRoutinePrompt(routineId, prompt: prompt) } }
            }
        }
    }

    @ViewBuilder private func triggersTab(_ detail: RoutineDetail) -> some View {
        Meta("triggers · \(detail.triggers.count) · \(detail.triggers.reduce(0) { $0 + $1.fires30d }) fires in 30d")
        if detail.triggers.isEmpty {
            Hint(isBeat
                ? "The heartbeat has no triggers of its own — it is what other routines ride."
                : "Nothing starts this yet — add a schedule, or a trigger.")
        }
        ForEach(detail.triggers, id: \.triggerId) { trigger in
            TriggerRow(
                trigger: trigger, busy: busy,
                onFire: { Task { await act { try await $0.fireTrigger(routineId, triggerId: trigger.triggerId) } } },
                onToggle: { on in Task { await act { try await $0.setTriggerEnabled(routineId, triggerId: trigger.triggerId, enabled: on) } } },
                onRotate: trigger.kind == .webhook ? { rotating = trigger } : nil
            )
        }
        if !isBeat {
            AppButton("+ Add trigger", variant: .outline) { editing = EditTarget(addTrigger: true) }.padding(.top, 10)
        }
    }

    private var modelSheet: some View {
        AppSheet(title: "Model") {
            SheetGroup(
                options: [SheetOption(key: "", label: "Auto", description: "Let the router pick per beat")]
                    + models.map { SheetOption(key: $0.modelId, label: $0.modelDisplayName.isEmpty ? $0.modelId : $0.modelDisplayName, description: $0.connectionName) },
                selected: beat.model
            ) { key in
                beat.model = key
                pickingModel = false
            }
        }
    }

    private var runSheet: some View {
        AppSheet(title: run.map { "Run · \(RoutineFormat.when($0.run.startedAt))" } ?? "Run", detents: [.large]) {
            if let run {
                RunPanel(
                    run: run, busy: busy,
                    onRetry: {
                        selectedRun = nil
                        Task { await act { try await $0.retryRoutineRun(routineId, runId: run.run.id) } }
                    },
                    onOpenSession: run.sessionId.map { sessionId in
                        {
                            selectedRun = nil
                            router.push(.session(id: sessionId))
                        }
                    }
                )
            } else {
                Hint("Loading…")
            }
        }
    }

    // MARK: work

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            async let found = seam.routine(routineId)
            async let page = seam.routineRuns(routineId, skip: 0, take: RoutineScreen.page)
            guard let fresh = try await found else {
                missing = true
                return
            }
            let firstPage = try await page
            detail = fresh
            runs = firstPage.runs
            total = firstPage.total
            error = nil

            // Only where the server's copy moved: typing survives a poll.
            if fresh.routine.prompt != storedPrompt { prompt = fresh.routine.prompt }
            storedPrompt = fresh.routine.prompt
            if fresh.routine.notepad != storedNotepad { notepad = fresh.routine.notepad }
            storedNotepad = fresh.routine.notepad

            if fresh.routine.kind == .heartbeat {
                let next = RoutineEditor.HeartbeatSettings(
                    interval: fresh.routine.cronExpression,
                    activeStart: fresh.routine.activeHoursStart.map(RoutineFormat.hhmm) ?? "",
                    activeEnd: fresh.routine.activeHoursEnd.map(RoutineFormat.hhmm) ?? "",
                    model: fresh.routine.model ?? ""
                )
                if next != storedBeat {
                    beat = next
                    storedBeat = next
                }
                if models.isEmpty { models = (try? await seam.models()) ?? [] }
            }

            // A run named by the link that opened this screen, shown once.
            if !openedInitialRun {
                openedInitialRun = true
                if let initialRun { selectedRun = initialRun }
            }
        } catch is CancellationError {
            return
        } catch {
            self.error = describe(error)
        }
    }

    private func loadRun() async {
        run = nil
        guard let seam = model.seam, let selectedRun else { return }
        do {
            run = try await seam.routineRun(routineId, runId: selectedRun)
            if run == nil { self.selectedRun = nil }
        } catch is CancellationError {
            return
        } catch {
            self.selectedRun = nil
        }
    }

    private func act(_ command: (Seam) async throws -> String?) async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            error = try await command(seam)
            await load()
        } catch {
            self.error = describe(error)
        }
    }

    private func loadMore() async {
        guard let seam = model.seam, !paging else { return }
        paging = true
        defer { paging = false }
        if let page = try? await seam.routineRuns(routineId, skip: runs.count, take: RoutineScreen.page) {
            runs += page.runs
            total = page.total
        }
    }

    private func remove() async {
        Haptics.refuse()
        _ = try? await model.seam?.deleteRoutine(routineId)
        router.pop()
    }

    private func rotate(_ trigger: TriggerStats) async {
        await act { seam in
            let result = try await seam.rotateWebhookSecret(routineId, triggerId: trigger.triggerId)
            // The one moment the secret is readable.
            if result.error == nil { rotated = result.webhooks }
            return result.error
        }
    }
}

private struct RoutineRunRow: View {
    let run: RunSummary
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Group {
                    if run.status == .running {
                        StatusDot(running: true)
                    } else {
                        Circle().fill(outcomeColor(run.outcome)).frame(width: 8, height: 8)
                    }
                }
                .padding(.top, 4)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        BodyText(RoutineFormat.when(run.startedAt), size: 13.5)
                        Spacer()
                        Mono(RoutineFormat.statusLabel(run.status), color: outcomeColor(run.outcome))
                        Mono(run.durationMs.map(RoutineFormat.duration) ?? "—")
                    }
                    Mono(run.error ?? run.said ?? "—").lineLimit(1)
                }
            }
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .topBorder()
        .accessibilityLabel("\(RoutineFormat.when(run.startedAt)), \(RoutineFormat.statusLabel(run.status))")
    }
}

private struct TriggerRow: View {
    let trigger: TriggerStats
    let busy: Bool
    let onFire: () -> Void
    let onToggle: @MainActor (Bool) -> Void
    let onRotate: (() -> Void)?

    var body: some View {
        let meta = [
            trigger.lastFired.map { "last \(RoutineFormat.when($0))" } ?? "never fired",
            trigger.lastFiredBy,
            "\(trigger.fires30d) in 30d",
        ].compactMap { $0 }.joined(separator: " · ")

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    BodyText("\(RoutineFormat.triggerKindName(trigger.kind, channel: trigger.channel)) · \(trigger.summary)", size: 13.5).lineLimit(2)
                    Mono(meta).lineLimit(1)
                }
                Spacer(minLength: 0)
                Toggle("Enabled", isOn: Binding(get: { trigger.enabled }, set: onToggle))
                    .labelsHidden()
                    .tint(Palette.primary)
                    .disabled(busy)
                    .accessibilityLabel("\(trigger.summary) enabled")
            }
            HStack(spacing: 12) {
                HistoryStrip(history: trigger.history, height: 12)
                if let onRotate {
                    Button(action: onRotate) { link("rotate secret") }.buttonStyle(.plain).disabled(busy).accessibilityLabel("Rotate secret")
                }
                Button(action: onFire) { link("fire") }.buttonStyle(.plain).disabled(busy).accessibilityLabel("Fire trigger")
            }
        }
        .padding(.vertical, 10)
        .topBorder()
        .opacity(trigger.enabled ? 1 : 0.55)
    }

    private func link(_ text: String) -> some View {
        Text(text).font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary).opacity(busy ? 0.5 : 1)
    }
}

struct SaveRow: View {
    let dirty: Bool
    let busy: Bool
    let label: String
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            AppButton(label, busy: busy, disabled: !dirty, action: onSave)
            if dirty { Mono("unsaved", color: Palette.primary) }
        }
    }
}

/// One run: what it cost, the steps it took, what it said, and how it ended.
private struct RunPanel: View {
    let run: RunDetail
    let busy: Bool
    let onRetry: () -> Void
    let onOpenSession: (() -> Void)?

    var body: some View {
        let line = RoutineFormat.spend(run)
        if !line.isEmpty { Mono(line) }

        VStack(alignment: .leading, spacing: 6) {
            if run.steps.isEmpty { Mono("No steps were recorded.") }
            ForEach(Array(run.steps.enumerated()), id: \.offset) { _, step in
                HStack(spacing: 8) {
                    Circle().fill(step.ok ? Palette.border : Palette.destructive).frame(width: 6, height: 6)
                    Mono(step.symbol, color: Palette.foreground)
                    Mono(step.name).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    if let meta = step.meta, !meta.isEmpty { Mono(meta).lineLimit(1) }
                }
            }
        }

        if let message = run.finalMessage, !message.isEmpty {
            Prose(message)
                .padding(12)
                .background(Palette.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Radius.md))
        }

        Mono(RoutineFormat.runNote(run), color: outcomeColor(run.run.outcome))

        HStack(spacing: 8) {
            AppButton(run.run.status == .failed ? "Retry" : "Run again", variant: .outline, busy: busy, action: onRetry)
            if let onOpenSession { AppButton("Open session", variant: .ghost, action: onOpenSession) }
        }
        Mono("started \(RoutineFormat.clock(run.run.startedAt))")
    }
}

/// A webhook's secret, shown the one time it can be.
struct SecretSheet: View {
    let secrets: [AutomationWebhookSecret]
    let server: String?
    /// Something else that happened, said above the secret so it is not lost behind it.
    var notice: String?
    let onContinue: () -> Void

    var body: some View {
        AppSheet(title: "Copy this now", detents: [.large]) {
            if let notice { ErrorText(notice) }
            Hint("The secret is stored hashed and can never be shown again.")
            ForEach(secrets, id: \.triggerId) { hook in
                let url = server.map { RoutineEditor.hookUrl(server: $0, automationId: hook.automationId, triggerId: hook.triggerId, secret: hook.secret) } ?? hook.secret
                VStack(alignment: .leading, spacing: 8) {
                    Meta("webhook \(RoutineEditor.shortId(hook.triggerId))")
                    Mono(url, color: Palette.foreground).textSelection(.enabled)
                    HStack(spacing: 8) {
                        AppButton("Copy", variant: .outline) { copyText(url) }
                        ShareLink(item: url) {
                            Text("Share the URL").font(AppFont.sansMedium(14)).foregroundStyle(Palette.foreground)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 40)
                                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                        }
                    }
                }
            }
            Hint("Send the secret as the X-Slopcoder-Hook header when you can; the ?secret= in the URL is for callers that cannot set one, and puts the secret in their logs.")
            AppButton("Continue", action: onContinue)
        }
        .interactiveDismissDisabled()
    }
}
#endif

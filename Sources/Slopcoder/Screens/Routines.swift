#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// The colour an outcome paints as: notified is emerald, failed is red, quiet is
/// grey, and a run still going has none yet.
func outcomeColor(_ outcome: RunOutcome?) -> Color {
    switch outcome {
    case RunOutcome.notified?: return Status.ok
    case RunOutcome.failed?: return Palette.destructive
    case RunOutcome.quiet?: return Palette.mutedForeground
    default: return Palette.border
    }
}

/// The last runs as bars: a full bar for one that ran, a stub for one that did not.
struct HistoryStrip: View {
    let history: [RunOutcome?]
    var height: CGFloat = 18

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(history.enumerated()), id: \.offset) { _, outcome in
                RoundedRectangle(cornerRadius: 1)
                    .fill(outcome == nil ? Palette.border : outcome == .quiet ? Palette.mutedForeground.opacity(0.35) : outcomeColor(outcome))
                    .frame(height: outcome == nil ? 3 : height)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: height, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel("last \(history.count) runs")
    }
}

/// Routines: what has run, what failed, what is next.
///
/// Every read here is already folded server-side, so the screen is one call and
/// no arithmetic. While something is running it polls, since a routine has no
/// hub stream of its own.
struct RoutinesScreen: View {
    private enum Tab: String { case runs, routines, heartbeat }

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @Environment(RoutineAlert.self) private var alert

    @State private var board: RoutineBoard?
    @State private var tab = Tab.runs
    @State private var error: String?
    @State private var busy = false
    @State private var editing = false

    private static let pollNs: UInt64 = 15_000_000_000

    private var cards: [RoutineCard] { (board?.routines ?? []).filter { $0.kind != .heartbeat } }

    private var running: Bool {
        (board?.routines.contains { $0.running } ?? false) || (board?.heartbeat?.running ?? false)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ConnectionBanner(onRetry: { Task { await load() } })

                Picker("View", selection: $tab) {
                    Text("Runs").tag(Tab.runs)
                    Text("Routines · \(cards.count)").tag(Tab.routines)
                    Text("Heartbeat").tag(Tab.heartbeat)
                }
                .pickerStyle(.segmented)
                .onChange(of: tab) { _, _ in Haptics.select() }

                if let error { ErrorText(error) }
                if board == nil, error == nil { Skeleton(rows: 4) }

                if let board {
                    if cards.isEmpty, board.heartbeat == nil { emptyState }
                    switch tab {
                    case .runs: runsTab(board)
                    case .routines: routinesTab(board)
                    case .heartbeat: heartbeatTab(board)
                    }
                    if !board.routines.isEmpty {
                        Mono("\(board.runsToday) \(RoutineFormat.plural(board.runsToday, "run")) today · \(board.notifiedToday) notified · \(board.quietToday) quiet\(board.failedToday > 0 ? " · \(board.failedToday) failed" : "")")
                            .padding(.top, 4)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .pageBackground()
        .navigationTitle("Routines")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { editing = true } label: { Image(systemName: "plus") }.accessibilityLabel("New routine")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .task(id: running) {
            guard running else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: RoutinesScreen.pollNs)
                if Task.isCancelled { return }
                await load()
            }
        }
        .sheet(isPresented: $editing, onDismiss: { Task { await load() } }) {
            RoutineEditorScreen(routineId: nil)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No routines yet").font(AppFont.sansMedium(16)).foregroundStyle(Palette.foreground)
            Hint("A routine is a prompt that runs itself — a morning triage, a digest on /digest, a webhook from CI — and only messages you when it has something to say. Describe one in a sentence and the form fills itself in.")
            HStack(spacing: 8) {
                AppButton("New routine", variant: .outline) { editing = true }
                AppButton("Set up the heartbeat", variant: .ghost, busy: busy) { Task { await setUpHeartbeat() } }
            }
        }
    }

    @ViewBuilder private func runsTab(_ board: RoutineBoard) -> some View {
        let runs = RoutineFormat.ledger(board)
        if !board.failures.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Meta(RoutineFormat.needs(board.failures.count), color: Palette.destructive)
                ForEach(board.failures, id: \.runId) { failure in
                    FailureRow(failure: failure, busy: busy, onOpen: { open(failure.routineId, run: failure.runId) }) {
                        Task { await act { try await $0.retryRoutineRun(failure.routineId, runId: failure.runId) } }
                    }
                }
            }
        }
        if runs.isEmpty, !cards.isEmpty { Hint("Nothing has run yet.") }
        ForEach(RoutineFormat.groupRuns(runs), id: \.label) { group in
            VStack(alignment: .leading, spacing: 0) {
                Meta("\(group.label) · \(group.runs.count)").padding(.bottom, 6)
                ForEach(group.runs) { run in
                    RunRow(run: run) { open(run.routineId, run: run.id) }
                }
            }
        }
    }

    @ViewBuilder private func routinesTab(_ board: RoutineBoard) -> some View {
        ForEach(cards) { card in
            RoutineTile(card: card, busy: busy, onOpen: { open(card.id, run: nil) }) { setEnabled(card.id, $0) }
        }
        if cards.isEmpty { Hint("No routines yet.") }
        if !board.upcoming.isEmpty {
            Mono("next · " + board.upcoming.map { "\($0.name) \(RoutineFormat.clock($0.at))" }.joined(separator: " · ")).padding(.top, 4)
        }
    }

    @ViewBuilder private func heartbeatTab(_ board: RoutineBoard) -> some View {
        if let beat = board.heartbeat {
            HeartbeatTile(beat: beat, busy: busy, onOpen: { open(beat.id, run: nil) }) { setEnabled(beat.id, $0) }
        } else {
            Hint("The heartbeat is one check-in the system owns: it wakes on its own cadence, reads the notepad it keeps, and says something only when there is something to say. Other routines can ride it.")
            AppButton("Set up the heartbeat", variant: .outline, busy: busy) { Task { await setUpHeartbeat() } }
            Hint("It is created paused, on the default cadence. Nothing runs until you say so.")
        }
    }

    private func open(_ id: String, run: String?) {
        router.push(.routine(id: id, run: run))
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            let next = try await seam.routineBoard(tz: RoutineFormat.deviceZone())
            board = next
            // The tab's badge: the board knows from its failures.
            alert.setFailed(!next.failures.isEmpty)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = describe(error)
        }
    }

    /// Run a command that answers with a problem or with silence, then re-read.
    private func act(_ run: (Seam) async throws -> String?) async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            error = try await run(seam)
            await load()
        } catch {
            self.error = describe(error)
        }
    }

    private func setEnabled(_ id: String, _ on: Bool) {
        // Flip it at once; the re-read after the call is what makes it true.
        if var current = board {
            for index in current.routines.indices where current.routines[index].id == id { current.routines[index].enabled = on }
            if current.heartbeat?.id == id { current.heartbeat?.enabled = on }
            board = current
        }
        Task { await act { try await $0.setRoutineEnabled(id, enabled: on) } }
    }

    private func setUpHeartbeat() async {
        guard let seam = model.seam, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let beat = try await seam.heartbeat()
            await load()
            if let beat { open(beat.id, run: nil) }
        } catch {
            self.error = describe(error)
        }
    }
}

private struct FailureRow: View {
    let failure: RoutineFailure
    let busy: Bool
    let onOpen: () -> Void
    let onRetry: () -> Void

    var body: some View {
        let meta = RoutineFormat.failureMeta(failure)
        HStack(alignment: .top, spacing: 10) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 3) {
                    BodyText("\(failure.name) failed at \(RoutineFormat.clock(failure.at))").lineLimit(1)
                    if !meta.isEmpty { Mono(meta, color: Palette.destructive).lineLimit(2) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: onRetry) {
                Text("retry").font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .opacity(busy ? 0.5 : 1)
            .accessibilityLabel("Retry")
        }
        .padding(12)
        .background(Palette.destructive.opacity(0.06), in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.destructive.opacity(0.3), lineWidth: 1))
    }
}

struct RunRow: View {
    let run: RunSummary
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Group {
                    if run.outcome == nil {
                        StatusDot(running: true)
                    } else {
                        Circle().fill(outcomeColor(run.outcome)).frame(width: 8, height: 8)
                    }
                }
                .padding(.top, 4)
                VStack(alignment: .leading, spacing: 2) {
                    (Text(run.routineName).font(AppFont.sans(14)).foregroundStyle(Palette.foreground)
                        + Text(" · \(RoutineFormat.statusLabel(run.status))").font(AppFont.sans(12)).foregroundStyle(outcomeColor(run.outcome)))
                        .lineLimit(1)
                    // A skipped run paints quiet, and the row says "skipped": it
                    // never happened, which is not the same as having nothing to say.
                    Mono(run.said.map { RoutineFormat.firstWords($0, max: 80) } ?? "—").lineLimit(1)
                }
                Spacer(minLength: 0)
                Mono(RoutineFormat.clock(run.startedAt)).padding(.top, 2)
            }
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .topBorder()
        .accessibilityLabel("\(run.routineName), \(RoutineFormat.statusLabel(run.status)), \(RoutineFormat.clock(run.startedAt))")
    }
}

private struct RoutineTile: View {
    let card: RoutineCard
    let busy: Bool
    let onOpen: () -> Void
    let onToggle: (Bool) -> Void

    var body: some View {
        let paused = !card.enabled || !card.scheduleEnabled
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Button(action: onOpen) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            if card.running {
                                StatusDot(running: true)
                            } else {
                                Circle()
                                    .fill(!card.enabled ? Palette.border : card.lastFailed ? Palette.destructive : Status.ok)
                                    .frame(width: 8, height: 8)
                            }
                            Text(card.name).font(AppFont.sansMedium(15)).foregroundStyle(Palette.foreground).lineLimit(1)
                        }
                        Mono(card.scheduleSentence).lineLimit(2)
                        if !card.scheduleMeta.isEmpty { Mono(card.scheduleMeta, size: 11).lineLimit(1) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(card.name)

                Toggle("Enabled", isOn: Binding(get: { card.enabled }, set: onToggle))
                    .labelsHidden()
                    .tint(Palette.primary)
                    .disabled(busy)
                    .accessibilityLabel("\(card.name) enabled")
            }
            if !card.history.isEmpty { HistoryStrip(history: card.history) }
            HStack {
                Mono(RoutineFormat.lastLabel(card), size: 11)
                Spacer()
                Mono(RoutineFormat.nextLabel(card.nextFire, paused: paused), size: 11)
            }
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(card.lastFailed ? Palette.destructive.opacity(0.35) : Palette.border, lineWidth: 1))
        .opacity(card.enabled ? 1 : 0.65)
    }
}

private struct HeartbeatTile: View {
    let beat: HeartbeatStatus
    let busy: Bool
    let onOpen: () -> Void
    let onToggle: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Button(action: onOpen) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            StatusDot(running: beat.running)
                            Text("Heartbeat").font(AppFont.sansMedium(15)).foregroundStyle(Palette.foreground)
                        }
                        Mono(RoutineFormat.heartbeatMeta(beat)).lineLimit(2)
                        Mono(RoutineFormat.notepadLine(beat), size: 11).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Toggle("Enabled", isOn: Binding(get: { beat.enabled }, set: onToggle))
                    .labelsHidden()
                    .tint(Palette.primary)
                    .disabled(busy)
                    .accessibilityLabel("Heartbeat enabled")
            }
            Mono("\(beat.notifiedToday) notified · \(beat.quietToday) quiet today", size: 11)
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
        .opacity(beat.enabled ? 1 : 0.65)
    }
}
#endif

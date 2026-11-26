// One session's live view: the state, the folded transcript, and the streaming
// tail — published together, so a 75ms push is one change and not three.
//
// This is where the gap machinery is actually wired: `SessionStream` notices a
// missed push, `LiveAccumulator` notices missed growth, and both are healed here
// by pulling rather than by hoping the next push repairs it.

import Foundation
import Observation

public struct EarlierResult: Equatable, Sendable {
    public var progress: Bool
    public var hasMore: Bool
    public var error: String?

    public init(progress: Bool, hasMore: Bool, error: String? = nil) {
        self.progress = progress
        self.hasMore = hasMore
        self.error = error
    }
}

@MainActor
@Observable
public final class SessionStore {
    /// How much scrollback to open with. Earlier pages load on demand.
    public static let initialWindow = 120
    /// The sandbox reaper's clock wants bumping while someone is watching.
    public static let presenceIntervalMs = 60_000

    public let id: String

    public private(set) var state: SessionState?
    public private(set) var items: [Item] = []
    /// `items` with each legacy subagent's thread gathered under one row.
    public private(set) var rows: [Row] = []
    public private(set) var live: LiveSnapshot?
    public private(set) var loading = true
    public private(set) var error: String?
    public private(set) var canLoadEarlier = false

    @ObservationIgnored private let seam: Seam
    @ObservationIgnored private let hub: SessionHub
    @ObservationIgnored private let sleep: SessionHub.Sleep
    /// Whether the app is in front; presence is only worth claiming when it is.
    @ObservationIgnored private let isActive: @MainActor () -> Bool

    @ObservationIgnored private var stream = SessionStream()
    @ObservationIgnored private var accumulator = LiveAccumulator()
    @ObservationIgnored private var folder = TranscriptFolder()
    @ObservationIgnored private var pulling = false
    @ObservationIgnored private var seeded = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var stopped = false
    /// The fold already handed out; see `publishItems`.
    @ObservationIgnored private var published = -1
    @ObservationIgnored private var listener: UUID?
    @ObservationIgnored private var presenceTask: Task<Void, Never>?
    @ObservationIgnored private var earlierFlight: Task<EarlierResult, Never>?

    public init(
        seam: Seam,
        hub: SessionHub,
        id: String,
        sleep: @escaping SessionHub.Sleep = { try await Task.sleep(nanoseconds: UInt64(max(0, $0)) * 1_000_000) },
        isActive: @escaping @MainActor () -> Bool = { true }
    ) {
        self.seam = seam
        self.hub = hub
        self.id = id
        self.sleep = sleep
        self.isActive = isActive
    }

    /// A new array only when the fold is a different fold.
    ///
    /// A running turn pushes constantly — every one of them re-folds, and nearly
    /// none of them add an item, because the text streaming past is the
    /// accumulator's business until the turn closes it into an event. Publishing
    /// regardless would redraw every row on every push, a cost that grows with
    /// the transcript.
    private func publishItems() {
        folder.fold(stream.all)
        if folder.revision == published { return }
        published = folder.revision
        items = folder.all
        rows = groupSubagents(folder.all)
    }

    private func publish(_ next: SessionState) {
        if state != next { state = next }
        publishItems()
        let snapshot = accumulator.snapshot
        if live != snapshot { live = snapshot }
        let earlier = stream.firstOrdinal > 0
        if canLoadEarlier != earlier { canLoadEarlier = earlier }
    }

    /// Pull whatever we missed, in order, until caught up. Single-flight: a burst
    /// of pushes during a gap must not start a fetch each.
    private func pullGap(from: Int, _ next: SessionState) async {
        if pulling { return }
        pulling = true
        defer { pulling = false }
        var cursor = from
        while cursor < next.nextOrdinal, !stopped {
            guard let missed = try? await seam.scrollback(id, from: cursor), !missed.isEmpty else { break }
            if !stream.append(missed) { break }
            cursor = stream.nextOrdinal
        }
        if !stopped { publish(next) }
    }

    private func reseed() async {
        guard let fresh = try? await seam.session(id), !stopped else { return }
        accumulator.seed(fresh.live)
        publish(fresh)
    }

    private func onDelta(_ next: SessionState, _ events: [AgentEventEnvelope], _ patch: LivePatch?) {
        if stopped { return }

        let outcome = stream.apply(state: next, incoming: events)
        accumulator.apply(patch)

        if accumulator.needsSeed {
            Task { await reseed() }
            return
        }
        if outcome.needsPull {
            Task { await pullGap(from: outcome.fromOrdinal, next) }
            return
        }
        publish(next)
    }

    /// Open the session: seed, subscribe, and keep its sandbox warm. Call once,
    /// when the screen appears; `stop()` when it goes.
    public func start() async {
        if started { return }
        started = true

        let sessionId = id
        listener = hub.addListener(id) { [weak self] incoming, next, events, patch in
            guard incoming == sessionId else { return }
            Task { @MainActor in self?.onDelta(next, events, patch) }
        }
        startPresence()

        do {
            guard let seed = try await seam.session(id) else {
                if !stopped {
                    error = "That session is gone."
                    loading = false
                }
                return
            }
            if stopped { return }

            let from = max(0, seed.nextOrdinal - SessionStore.initialWindow)
            let events = try await seam.scrollback(id, from: from)
            if stopped { return }

            stream.seed(from: from, events: events)
            seeded = true
            accumulator.seed(seed.live)
            folder.refold(stream.all)
            published = -1
            publish(seed)
            loading = false

            // Subscribing returns a fresher seed than the fetch above; fold it in
            // so nothing that landed in between is lost.
            if let fresher = try await hub.subscribe(id), !stopped {
                let outcome = stream.apply(state: fresher, incoming: [])
                if outcome.needsPull {
                    await pullGap(from: outcome.fromOrdinal, fresher)
                } else {
                    publish(fresher)
                }
            }
        } catch {
            if !stopped, !(error is CancellationError) { self.error = describe(error) }
        }
        if !stopped { loading = false }
    }

    public func stop() {
        if stopped { return }
        stopped = true
        seeded = false
        presenceTask?.cancel()
        presenceTask = nil
        if let listener { hub.removeListener(id, listener) }
        listener = nil
        let hub = self.hub
        let sessionId = id
        Task { await hub.unsubscribe(sessionId) }
    }

    /// Presence: on open, then while the app is in front.
    private func startPresence() {
        let seam = self.seam
        let sessionId = id
        let sleep = self.sleep
        let isActive = self.isActive
        presenceTask = Task { @MainActor in
            _ = try? await seam.presence(sessionId)
            while !Task.isCancelled {
                do {
                    try await sleep(SessionStore.presenceIntervalMs)
                } catch {
                    return
                }
                if isActive() { _ = try? await seam.presence(sessionId) }
            }
        }
    }

    /// Extend the window one page back. Concurrent calls share one fetch.
    public func loadEarlier() async -> EarlierResult {
        if let flight = earlierFlight { return await flight.value }
        if !seeded || stopped || stream.firstOrdinal == 0 { return EarlierResult(progress: false, hasMore: false) }

        let before = stream.firstOrdinal
        let take = min(SessionStore.initialWindow, before)
        let from = before - take
        let flight = Task<EarlierResult, Never> { @MainActor in
            do {
                let older = try await seam.scrollback(id, from: from, take: take)
                if stopped || !seeded { return EarlierResult(progress: false, hasMore: false) }
                if stream.firstOrdinal != before || !stream.prepend(from: from, older: older) {
                    return EarlierResult(progress: false, hasMore: stream.firstOrdinal > 0)
                }
                folder.refold(stream.all)
                publishItems()
                canLoadEarlier = stream.firstOrdinal > 0
                return EarlierResult(progress: true, hasMore: stream.firstOrdinal > 0)
            } catch {
                return EarlierResult(progress: false, hasMore: true, error: describe(error))
            }
        }
        earlierFlight = flight
        let result = await flight.value
        earlierFlight = nil
        return result
    }

    // MARK: what the screen asks

    /// The only trustworthy source of approval liveness. An approval answered on
    /// a laptop is still sitting in the scrollback here.
    public func isPending(approval requestId: String) -> Bool {
        state?.pendingApprovalIds.contains(requestId) ?? false
    }

    public func isPending(question requestId: String) -> Bool {
        state?.pendingQuestionIds.contains(requestId) ?? false
    }

    public var running: Bool { state?.status == .running }

    /// An archived session is read-only for good: its transcript stays, nothing runs again.
    public var archived: Bool { state?.archivedAt != nil }
}

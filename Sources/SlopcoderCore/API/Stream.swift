// Reassembling a transcript from pushes, ported from
// `SlopCoder.Web.Client/Sessions/SessionStream.cs` and
// `SlopCoder.Client/LiveAccumulator.cs`.
//
// The server pushes deltas, not snapshots: appended events since the last push,
// plus the *growth* of the streaming text. Both can be missed — a dropped
// WebSocket frame, a backgrounded app, a reconnect — so both carry enough
// information to notice, and the client heals by pulling.

import Foundation

/// What `SessionStream.apply` decided the caller must do next.
public struct SyncOutcome: Equatable, Sendable {
    /// Events were missed; pull scrollback from `fromOrdinal`.
    public let needsPull: Bool
    public let fromOrdinal: Int

    public init(needsPull: Bool, fromOrdinal: Int) {
        self.needsPull = needsPull
        self.fromOrdinal = fromOrdinal
    }
}

/// A window onto the scrollback. The app holds a tail, not the whole history —
/// a long session's transcript is unbounded and the phone does not want it.
public struct SessionStream: Sendable {
    public private(set) var firstOrdinal = 0
    public private(set) var all: [AgentEventEnvelope] = []

    public init() {}

    /// The ordinal one past the end of what is held.
    public var nextOrdinal: Int { firstOrdinal + all.count }

    /// Seed from a fetched window.
    public mutating func seed(from: Int, events: [AgentEventEnvelope]) {
        firstOrdinal = from
        all = events
    }

    public mutating func reset() {
        firstOrdinal = 0
        all = []
    }

    /// Fold a push in. Events at or below the cursor are duplicates and skipped;
    /// an event beyond it means a gap, so the loop stops rather than storing
    /// something out of order — `needsPull` then tells the caller to fetch it.
    public mutating func apply(state: SessionState, incoming: [AgentEventEnvelope]) -> SyncOutcome {
        for envelope in incoming {
            if envelope.ordinal < nextOrdinal { continue }
            if envelope.ordinal > nextOrdinal { break }
            all.append(envelope)
        }
        return SyncOutcome(needsPull: nextOrdinal < state.nextOrdinal, fromOrdinal: nextOrdinal)
    }

    /// Extend the window backwards. A page that does not abut the head is refused.
    public mutating func prepend(from: Int, older: [AgentEventEnvelope]) -> Bool {
        if older.isEmpty { return false }
        if from + older.count != firstOrdinal { return false }
        all = older + all
        firstOrdinal = from
        return true
    }

    /// Append a pulled gap. Returns false if it does not butt against the tail.
    public mutating func append(_ events: [AgentEventEnvelope]) -> Bool {
        var landed = false
        for envelope in events {
            if envelope.ordinal < nextOrdinal { continue }
            if envelope.ordinal > nextOrdinal { return landed }
            all.append(envelope)
            landed = true
        }
        return landed
    }
}

/// Re-accumulates `LivePatch` growth into the snapshot the UI renders.
///
/// `textFrom` is the sender's length at the *previous* push. Three cases, and
/// only the third is subtle: if our length is behind the sender's, a push was
/// missed and the text we hold is wrong — the caller must re-seed from
/// `GET /sessions/{id}` and take `state.live`, because nothing in the patch
/// stream will ever repair it.
///
/// Lengths are UTF-16 code units, as they are on the server (.NET strings) and
/// were in the JavaScript client. Counting Swift `Character`s here would call
/// every emoji a missed push.
public struct LiveAccumulator: Sendable {
    private var thinking = ""
    private var text = ""

    /// True once a patch proved a push was missed; cleared by `seed`.
    public private(set) var needsSeed = false

    public init() {}

    public var snapshot: LiveSnapshot? {
        thinking.isEmpty && text.isEmpty ? nil : LiveSnapshot(thinking: thinking, text: text)
    }

    public mutating func seed(_ live: LiveSnapshot?) {
        thinking = live?.thinking ?? ""
        text = live?.text ?? ""
        needsSeed = false
    }

    public mutating func clear() {
        thinking = ""
        text = ""
        needsSeed = false
    }

    /// A nil patch means no turn is streaming — drop what was accumulated.
    public mutating func apply(_ patch: LivePatch?) {
        guard let patch else {
            clear()
            return
        }
        thinking = grow(thinking, from: patch.thinkingFrom, append: patch.thinkingAppend)
        text = grow(text, from: patch.textFrom, append: patch.textAppend)
    }

    private mutating func grow(_ current: String, from: Int, append: String) -> String {
        if append.isEmpty {
            // A `from` of 0 with nothing to add is a new, empty turn.
            return from == 0 ? "" : current
        }

        // New turn: replace rather than append.
        if from == 0 { return append }

        let length = current.utf16.count
        if length == from { return current + append }

        // We are ahead of the sender — trim the overlap it is about to resend.
        if length > from { return current.utf16Prefix(from) + append }

        // We are behind. Nothing here can repair that; only a re-seed can.
        needsSeed = true
        return current
    }
}

extension String {
    /// The first `count` UTF-16 code units — JavaScript's `slice(0, count)`.
    func utf16Prefix(_ count: Int) -> String {
        let units = utf16
        guard count < units.count else { return self }
        let end = units.index(units.startIndex, offsetBy: max(0, count))
        return String(decoding: Array(units[units.startIndex..<end]), as: UTF16.self)
    }
}

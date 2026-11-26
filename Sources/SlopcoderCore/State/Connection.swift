// Whether the server is there, as one fact the whole app agrees on.
//
// Two signals feed it and they mean different things:
//
// - **reachable** — HTTP calls complete. False means the server cannot be
//   contacted at all, so nothing works and saying so is the only useful thing
//   the UI can do.
// - **live** — the hub is connected. False on its own is milder: reads still
//   work, the transcript is simply not updating itself, and the gap machinery
//   will heal it on reconnect.
//
// Keeping them apart matters, because "you are offline" and "this page is a few
// seconds stale" deserve different words and only one of them should stop you
// typing.

import Foundation
import Observation

@MainActor
@Observable
public final class ConnectionStatus {
    public private(set) var reachable = true
    public private(set) var live = false
    /// Why the hub is not up, in the transport's own words. Kept because a phone
    /// has no console to read and "reconnecting" on its own is not a symptom
    /// anyone can act on — least of all whoever is asked to fix it.
    public private(set) var reason: String?
    /// Bumped on every recovery, so screens can re-fetch without polling.
    public private(set) var recoveries = 0

    public init() {}

    public func setReachable(_ reachable: Bool) {
        if self.reachable == reachable { return }
        self.reachable = reachable
        if reachable { recoveries += 1 }
    }

    public func setLive(_ live: Bool) {
        if self.live != live { self.live = live }
    }

    public func setReason(_ reason: String?) {
        if self.reason != reason { self.reason = reason }
    }
}

/// Whether a routine's latest run failed — one fact, visible from every screen.
///
/// The cockpit's rail carries a red pip on the Routines icon for exactly this
/// reason: "something broke overnight" should reach you on whatever page you
/// happen to be on, not only on the one page that lists routines.
///
/// Whoever already knows writes it — the sessions strip reads
/// `/automations/status` on every load, and the board knows from its failures —
/// so the pip costs no request of its own.
@MainActor
@Observable
public final class RoutineAlert {
    public private(set) var anyFailed = false

    public init() {}

    public func setFailed(_ failed: Bool) {
        if anyFailed != failed { anyFailed = failed }
    }
}

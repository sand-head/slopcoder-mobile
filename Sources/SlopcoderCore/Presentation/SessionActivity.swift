// What a session-list row's dot says, decided once so the list, its filter and
// the tests agree.

import Foundation

/// A session as the list shows it, sub-sessions rolled in.
///
/// In precedence order: a session that needs the user says so above all else,
/// because nothing moves until they answer. An offline workspace comes next,
/// since nothing can run there either. A session is working when its own turn
/// is in flight or any of its sub-sessions' is, so an idle parent with a busy
/// team does not look finished.
public enum SessionActivity: Sendable, Equatable {
    case waiting, offline, working, idle

    public init(_ session: SessionSummary) {
        let offline = session.clientWorkspace != nil && session.workspaceConnected == false
        if session.waitingOnUser == true {
            self = .waiting
        } else if offline {
            self = .offline
        } else if session.status == .running || (session.runningSubSessions ?? 0) > 0 {
            self = .working
        } else {
            self = .idle
        }
    }

    /// For VoiceOver, now that the row carries no status text.
    public var label: String {
        switch self {
        case .waiting: return "Waiting for you"
        case .offline: return "Workspace offline"
        case .working: return "Working"
        case .idle: return "Idle"
        }
    }

    /// What the Running filter keeps: anything with a turn in flight, its own or
    /// a sub-session's. A blocked turn is still in flight, so most waiting
    /// sessions are kept too.
    public static func busy(_ session: SessionSummary) -> Bool {
        session.status == .running || (session.runningSubSessions ?? 0) > 0
    }
}

// The session terminal's wire, ported from
// `SlopCoder.Web.Client/Code/WebSocketTerminalConnection.cs`.
//
// `/ws/session/{id}/terminal` is not a seam endpoint and does not speak JSON:
// binary frames are raw PTY bytes in both directions, and text frames are the
// small control protocol in `TerminalControl.cs` — `{"t":"resize",…}` going up,
// `{"t":"exit"}` and `{"t":"error","msg":…}` coming down.
//
// Two things about it are worth stating:
//
// - **The shell is the server's, not the socket's.** `TerminalSessionManager`
//   holds it, so closing the connection leaves the shell running and
//   re-opening replays the scrollback. Dismissing the sheet costs nothing, and
//   a phone that sleeps has not killed anything.
// - **The credential is a header, not a query parameter.** The API key scheme
//   accepts `?access_token=` only under `/hubs`, deliberately — a key in a URL
//   is a key in a log.

import Foundation

/// What the server says down the text channel.
public enum TerminalControl: Equatable, Sendable {
    case exit
    case error(message: String)

    /// Parse one text frame. Anything unrecognised is dropped rather than thrown.
    public static func parse(_ payload: String) -> TerminalControl? {
        guard let message = JSONValue.parse(payload) else { return nil }
        switch message["t"].string {
        case "exit": return .exit
        case "error": return .error(message: message["msg"].string ?? "The terminal could not be started.")
        default: return nil
        }
    }

    /// The frame that tells the PTY its new size.
    public static func resize(cols: Int, rows: Int) -> String {
        JSONValue.object(["t": "resize", "cols": .number(Double(cols)), "rows": .number(Double(rows))]).serialized()
    }
}

/// `https://host` → `wss://host`, leaving anything else alone.
public func websocketUrl(baseUrl: String, path: String) -> String {
    var trimmedPath = Substring(path)
    while trimmedPath.hasPrefix("/") { trimmedPath = trimmedPath.dropFirst() }
    return "\(HubConnector.socketUrl(trimTrailingSlashes(baseUrl)))/\(trimmedPath)"
}

/// Where one session's terminal is attached, at a grid size.
public func terminalUrl(baseUrl: String, sessionId: String, cols: Int, rows: Int) -> String {
    websocketUrl(baseUrl: baseUrl, path: "ws/session/\(sessionId)/terminal?cols=\(cols)&rows=\(rows)")
}

/// The keys a phone keyboard has no key for, as the bytes a PTY expects.
///
/// Ctrl-C is the one that matters — it is the whole reason for typing into a
/// terminal from a phone at all — but a shell without arrows or tab is a
/// text box, so the row above the keyboard carries these.
public enum TerminalKeys {
    public static let ctrlC = "\u{03}"
    public static let ctrlD = "\u{04}"
    public static let ctrlZ = "\u{1a}"
    public static let ctrlL = "\u{0c}"
    public static let escape = "\u{1b}"
    public static let tab = "\t"
    public static let enter = "\r"
    public static let up = "\u{1b}[A"
    public static let down = "\u{1b}[B"
    public static let right = "\u{1b}[C"
    public static let left = "\u{1b}[D"
}

/// What the terminal sheet's header has to say.
public enum TerminalStatus: Equatable, Sendable {
    case connecting, live, exited
    case error(message: String)
    case closed
}

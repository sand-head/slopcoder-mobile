// Shared session handle tint and local session search, including historical
// transcript attribution after the removal of live shared rooms.

import Foundation

/// `SubSessionPalette.All`, in order — the hash below indexes into it.
public let handlePalette = ["violet", "amber", "sky", "rose", "teal", "fuchsia", "indigo", "orange"]

/// A stable colour per handle, so one session reads as the same shade in every
/// message, in the member list, and on the web. The same hash as the web's
/// `Tint`: 31-multiplied UTF-16 units of the lower-cased handle, wrapped to 32
/// bits, taken unsigned modulo the palette.
public func handleTint(_ handle: String) -> String {
    var hash: Int32 = 0
    for unit in handle.lowercased().utf16 {
        hash = hash &* 31 &+ Int32(unit)
    }
    return handlePalette[Int(UInt32(bitPattern: hash) % UInt32(handlePalette.count))]
}

/// Local title/repository/status/model search; older servers omit repoNames.
public func matchesSession(_ session: SessionSummary, query: String) -> Bool {
    let term = query.jsTrim.lowercased()
    if term.isEmpty { return true }
    let status = session.status == .running ? "running" : "idle"
    let fields = [session.title, session.model, status] + (session.repoNames ?? [])
        + [session.clientWorkspace?.machineName ?? "", session.clientWorkspace?.directory ?? ""]
    return fields.contains { $0.lowercased().jsContains(term) }
}

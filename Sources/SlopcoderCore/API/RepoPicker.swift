// Which repositories the attach sheet offers, and when it asks the server.
//
// The cockpit's `AttachPicker.razor` has settled this already, and the two have
// to agree or the same search gives different answers depending on which screen
// you are holding. Its rule, in order:
//
// 1. Nothing typed: the repositories recent sessions used.
// 2. Typed: the ones you own, matched locally — no round trip, no debounce.
// 3. Typed and *nothing* of yours matches: widen to a search across every
//    connected forge, minus what you already own, capped.
// 4. A clone URL rather than a search: offer it as itself, whoever owns it.
//
// Step 3 is the only one that costs a request, and the third condition is what
// keeps it rare.

import Foundation

public struct RepoChoice: Hashable, Sendable, Identifiable {
    /// The clone URL, which is what a session is actually attached to.
    public var key: String
    public var label: String
    public var description: String?
    /// Which forge the row came from — picks the mark beside the name.
    public var kind: GitServiceKind?

    public var id: String { key }

    public init(key: String, label: String, description: String? = nil, kind: GitServiceKind? = nil) {
        self.key = key
        self.label = label
        self.description = description
        self.kind = kind
    }
}

/// How many of your own repositories to show for one query.
private let localLimit = 20
/// How many to keep from a search across the forges.
private let remoteLimit = 15
/// Below this a query is not yet worth matching on.
private let minQuery = 2

public func rowToChoice(_ row: GitRepoRow) -> RepoChoice {
    RepoChoice(key: row.cloneUrl, label: row.fullName, description: row.private ? "private" : nil, kind: row.kind)
}

public func recentToChoice(_ repo: RecentRepo) -> RepoChoice {
    RepoChoice(key: repo.cloneUrl, label: repo.label.isEmpty ? repo.cloneUrl : repo.label, kind: repo.kind ?? kindFromUrl(repo.cloneUrl))
}

/// The mark for a repo the sheet only has a URL for — a recent one the server
/// has not labeled yet, or a pasted clone URL. github.com is the one host a
/// name alone recognizes; a bare URL row keeps the generic Git mark.
public func kindFromUrl(_ url: String) -> GitServiceKind? {
    let host = firstMatch(#"^https?://([^/]+)"#, in: url.jsTrim, caseInsensitive: true)?[1]?.lowercased()
    return host == "github.com" ? .gitHub : nil
}

/// A query that is a clone URL is an instruction, not a search.
public func urlIn(_ query: String) -> String? {
    let trimmed = query.jsTrim
    return trimmed.jsContains("://") || trimmed.jsStarts(with: "git@") ? trimmed : nil
}

/// Your own repositories whose name contains the query.
public func localMatches(_ owned: [RepoChoice], query: String) -> [RepoChoice] {
    let needle = query.jsTrim.lowercased()
    if needle.jsLength < minQuery { return [] }
    return Array(owned.filter { $0.label.lowercased().jsContains(needle) }.prefix(localLimit))
}

/// Whether to spend a request on this query.
///
/// Not for a URL (there is nothing to search for), not for a fragment, and not
/// while anything you own still matches — that last one is what makes the search
/// an expansion rather than the first resort.
public func shouldSearch(_ owned: [RepoChoice], query: String, ownedLoaded: Bool) -> Bool {
    ownedLoaded && urlIn(query) == nil && query.jsTrim.jsLength >= minQuery && localMatches(owned, query: query).isEmpty
}

/// A search's rows, minus the ones you own and any duplicates between forges.
public func remoteMatches(_ owned: [RepoChoice], found: [RepoChoice]) -> [RepoChoice] {
    let mine = Set(owned.map(\.key))
    var seen = Set<String>()
    return Array(found.filter { !mine.contains($0.key) && seen.insert($0.key).inserted }.prefix(remoteLimit))
}

public struct Offered: Equatable, Sendable {
    /// What the group is: recents, your own, or the wider forges.
    public var label: String
    public var options: [RepoChoice]
    /// Shown when there is nothing, which is not the same as not having looked.
    public var empty: String

    public init(label: String, options: [RepoChoice], empty: String) {
        self.label = label
        self.options = options
        self.empty = empty
    }
}

/// Everything above, as the one list the sheet renders.
public func offer(query: String, recent: [RepoChoice], owned: [RepoChoice], found: [RepoChoice], searching: Bool) -> Offered {
    if let url = urlIn(query) {
        return Offered(label: "clone url", options: [RepoChoice(key: url, label: url, kind: kindFromUrl(url))], empty: "")
    }

    if query.jsTrim.jsLength < minQuery {
        return Offered(label: "recent", options: recent, empty: "No recent repositories.")
    }

    let mine = localMatches(owned, query: query)
    if !mine.isEmpty { return Offered(label: "your repositories", options: mine, empty: "") }

    return Offered(
        label: searching ? "searching…" : "everywhere else",
        options: remoteMatches(owned, found: found),
        empty: searching ? "Searching…" : "Nothing matched."
    )
}

// What a link in a transcript points at, decided without touching navigation.
//
// The agent writes links in the web's own spelling — `/artifacts/{id}`, the
// route its publish tool hands back — and the cockpit catches those and opens
// its artifact panel. A phone has no origin for a relative path to resolve
// against, so without this a tap on `/artifacts/…` would do nothing at all.
//
// Same-host links (relative, or absolute on the server this app is signed in
// to) become the app's own screens; the deep-link scheme does too; any other
// http(s) link goes to the system browser; everything else is refused, out
// loud, by the caller.

import Foundation

public enum LinkTarget: Equatable, Sendable {
    case artifact(id: String, version: Int?)
    case session(id: String)
    case routine(id: String)
    case external(url: String)
    case unsupported(url: String)
}

private let guidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/// `scheme://host[:port]`, lowercased, or nil when the base is not a URL.
private func originOf(_ url: String) -> String? {
    guard let match = firstMatch(#"^(https?)://([^/?#]+)"#, in: url, caseInsensitive: true),
          let scheme = match[1], let host = match[2]
    else { return nil }
    return "\(scheme.lowercased())://\(host.lowercased())"
}

/// Path and query of an app route, split. Fragments are dropped.
private func splitRoute(_ rest: String) -> (path: String, query: String) {
    let noHash = rest.jsIndex(of: "#").map { rest.jsPrefix(upTo: $0) } ?? rest
    guard let question = noHash.jsIndex(of: "?") else { return (noHash, "") }
    return (noHash.jsPrefix(upTo: question), noHash.jsSlice(noHash.unicodeScalars.index(after: question)))
}

private func versionOf(_ query: String) -> Int? {
    for pair in query.jsSplit("&") {
        let parts = pair.jsSplit("=")
        guard parts[0] == "v", parts.count > 1, parts[1].isAllDigits, parts[1].unicodeScalars.count <= 6 else { continue }
        let number = Int(parts[1]) ?? 0
        return number >= 1 ? number : nil
    }
    return nil
}

/// An app route's path (with or without its leading slash), or nil when it is none of ours.
private func route(_ path: String, _ query: String) -> LinkTarget? {
    func id(_ segment: String) -> String? {
        firstMatch("^/?\(segment)/(\(guidPattern))/?$", in: path, caseInsensitive: true)?[1]?.lowercased()
    }
    if let artifact = id("artifacts") { return .artifact(id: artifact, version: versionOf(query)) }
    if let session = id("session") { return .session(id: session) }
    if let routine = id("routines") { return .routine(id: routine) }
    return nil
}

private func trimBase(_ baseUrl: String?) -> String? {
    guard let baseUrl, !baseUrl.isEmpty else { return nil }
    return trimTrailingSlashes(baseUrl)
}

/// Decide where `href` goes. `baseUrl` is the signed-in server (the seam's own
/// base URL, path included when the app is served under one).
public func resolveLink(_ href: String, baseUrl: String?) -> LinkTarget {
    let url = href.jsTrim
    if url.isEmpty { return .unsupported(url: url) }

    // The app's own scheme: slopcoder://artifacts/{id}, the same routes.
    if let scheme = firstMatch(#"^slopcoder://(.*)$"#, in: url, caseInsensitive: true) {
        let (path, query) = splitRoute(scheme[1] ?? "")
        return route(path, query) ?? .unsupported(url: url)
    }

    if firstMatch(#"^https?://"#, in: url, caseInsensitive: true) != nil {
        if let server = trimBase(baseUrl), let baseOrigin = originOf(server), originOf(url) == baseOrigin {
            // Strip the origin, then the base path if the server lives under one.
            var rest = url.jsDropFirst(baseOrigin.unicodeScalars.count)
            let basePath = server.jsDropFirst(baseOrigin.unicodeScalars.count)
            if !basePath.isEmpty, rest.lowercased().jsStarts(with: basePath.lowercased()) {
                rest = rest.jsDropFirst(basePath.unicodeScalars.count)
            }
            let (path, query) = splitRoute(rest)
            if let target = route(path, query) { return target }
        }
        return .external(url: url)
    }

    if firstMatch("^mailto:", in: url, caseInsensitive: true) != nil { return .external(url: url) }

    // Anything with a scheme we do not know is refused, not guessed at.
    if firstMatch("^[a-z][a-z0-9+.-]*:", in: url, caseInsensitive: true) != nil { return .unsupported(url: url) }

    // Relative: the web's own spelling, `/artifacts/{id}` or `artifacts/{id}`.
    let (path, query) = splitRoute(url)
    if let target = route(path, query) { return target }
    // Some other page of the server: open it in the browser rather than drop it.
    if let server = trimBase(baseUrl), url.jsStarts(with: "/"), !url.jsStarts(with: "//") {
        return .external(url: "\(server)\(url)")
    }
    return .unsupported(url: url)
}

/// One piece of a string: plain text, or a link and where it goes.
public struct TextSegment: Equatable, Sendable {
    public var text: String
    public var href: String?

    public init(text: String, href: String?) {
        self.text = text
        self.href = href
    }
}

/// Links inside tool-result text, which is plain text rather than markdown:
/// absolute http(s) URLs, the deep-link scheme, and the web's relative
/// `/artifacts/{id}`, `/session/{id}` and `/routines/{id}` routes. Trailing
/// sentence punctuation stays outside the link.
private let linksRegex = try? NSRegularExpression(
    pattern: "(?:https?://[^\\s<>\"'`]+|slopcoder://[^\\s<>\"'`]+|/?(?:artifacts|session|routines)/\(guidPattern)(?:\\?v=\\d+)?)",
    options: [.caseInsensitive]
)

public func linkSegments(_ text: String) -> [TextSegment] {
    guard let linksRegex else { return text.isEmpty ? [] : [TextSegment(text: text, href: nil)] }
    let whole = text as NSString
    var segments: [TextSegment] = []
    var last = 0

    for match in linksRegex.matches(in: text, options: [], range: NSRange(location: 0, length: whole.length)) {
        var link = whole.substring(with: match.range)
        if let trailing = firstMatch(#"[.,;:!?)\]}]+$"#, in: link)?[0] {
            link = (link as NSString).substring(to: (link as NSString).length - (trailing as NSString).length)
        }
        if link.isEmpty { continue }
        let start = match.range.location
        // A relative route has to start a word: `foo/artifacts/…` is somebody's
        // path, not our link.
        if firstMatch("^[a-z]+:", in: link, caseInsensitive: true) == nil, start > 0,
           firstMatch(#"[\w/.:-]"#, in: whole.substring(with: NSRange(location: start - 1, length: 1))) != nil {
            continue
        }
        if start > last { segments.append(TextSegment(text: whole.substring(with: NSRange(location: last, length: start - last)), href: nil)) }
        segments.append(TextSegment(text: link, href: link))
        last = start + (link as NSString).length
    }
    if last < whole.length { segments.append(TextSegment(text: whole.substring(from: last), href: nil)) }
    return segments
}

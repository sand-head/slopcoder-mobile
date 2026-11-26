// Where a picture in a transcript comes from, and whether the device's key may
// go with the request for it.
//
// The second half is the part that matters. An image's address is whatever the
// agent wrote, and the key reaches everything its owner can: so it rides only to
// the server the app is signed in to, never to an address that merely appeared
// in a reply.

import Foundation

public struct MediaSource: Equatable, Sendable {
    public var uri: String
    /// Send the bearer key with the request.
    public var authed: Bool

    public init(uri: String, authed: Bool) {
        self.uri = uri
        self.authed = authed
    }
}

public enum Media {
    /// Images decoded at once in a transcript; the rest wait their turn.
    public static let maxDecoding = 3
    /// Above this an image artifact is opened rather than previewed inline.
    public static let maxInlineImageBytes = 4 * 1024 * 1024
    public static let maxAudioBytes = 10 * 1024 * 1024
    private static let maxDataUrlChars = 2 * 1024 * 1024

    private static func origin(_ url: String) -> String? {
        guard let match = firstMatch(#"^(https?)://([^/?#]+)"#, in: url, caseInsensitive: true),
              let scheme = match[1], let host = match[2]
        else { return nil }
        return "\(scheme.lowercased())://\(host.lowercased())"
    }

    /// Nil for a source that cannot be shown: an unknown scheme, a relative path
    /// with no server to resolve it against, an inline image too big to decode.
    public static func resolve(_ src: String, baseUrl: String?) -> MediaSource? {
        let url = src.jsTrim
        if url.isEmpty { return nil }

        if firstMatch(#"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$"#, in: url, caseInsensitive: true) != nil {
            return url.jsLength <= maxDataUrlChars ? MediaSource(uri: url, authed: false) : nil
        }

        let base = baseUrl.truthy.map(trimTrailingSlashes)
        if firstMatch(#"^https?://"#, in: url, caseInsensitive: true) != nil {
            // The key goes only to the server it belongs to.
            let same = base != nil && origin(url) != nil && origin(url) == base.flatMap(origin)
            return MediaSource(uri: url, authed: same)
        }
        guard let base else { return nil }
        if url.jsStarts(with: "/"), !url.jsStarts(with: "//") { return MediaSource(uri: "\(base)\(url)", authed: true) }
        if firstMatch("^artifacts/", in: url, caseInsensitive: true) != nil { return MediaSource(uri: "\(base)/\(url)", authed: true) }
        return nil
    }

    /// Whether an artifact of this kind could be a picture or a sound. The text
    /// kinds never are, so their cards do not ask.
    public static func mightBeMedia(kind: String) -> Bool {
        !["Markdown", "Text", "HTML", "JSON", "CSV"].contains(kind)
    }

    private static func isType(_ contentType: String, _ family: String) -> Bool {
        let mime = contentType.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init)?.jsTrim ?? ""
        return firstMatch("^\(family)/[a-z0-9.+-]+$", in: mime, caseInsensitive: true) != nil
    }

    public static func isAudio(_ contentType: String) -> Bool { isType(contentType, "audio") }
    public static func isVideo(_ contentType: String) -> Bool { isType(contentType, "video") }
    public static func isImage(_ contentType: String) -> Bool { contentType.lowercased().hasPrefix("image/") }

    /// "2.4 MB", "182 KB".
    public static func megabytes(_ size: Int) -> String {
        size >= 1024 * 1024
            ? "\(jsToFixed(Double(size) / (1024 * 1024), 1)) MB"
            : "\(max(1, Int((Double(size) / 1024).rounded(.toNearestOrAwayFromZero)))) KB"
    }
}

public enum FilePeekPreview {
    public static let previewLines = 12
    public static let previewChars = 1600

    /// The opening of a read, for the card: a dozen lines, and whether there is more.
    public static func preview(_ text: String) -> (text: String, cut: Bool) {
        let lines = text.jsSplit("\n")
        var shown = lines.prefix(previewLines).joined(separator: "\n")
        var cut = lines.count > previewLines
        if shown.jsLength > previewChars {
            shown = shown.utf16Prefix(previewChars)
            cut = true
        }
        return (shown, cut)
    }

    public static func lineCount(_ text: String) -> Int { text.jsSplit("\n").count }
}

public enum SubSessionPresentation {
    public static let tailLength = 5
    public static let replyLimit = 500

    /// The last few things worth showing on a partner's card: what was said and
    /// done, and anything still waiting on a person.
    public static func tail(_ items: [Item], length: Int = tailLength) -> [Item] {
        var shown: [Item] = []
        for item in items.reversed() {
            if shown.count >= length { break }
            let shows: Bool
            switch item.body {
            case .user, .text, .tool, .error, .plan: shows = true
            case .approval(let approval): shows = approval.approved == nil
            case .question(let question): shows = !question.resolved
            default: shows = false
            }
            if shows { shown.append(item) }
        }
        return shown.reversed()
    }

    /// "8.2k tok ≈ $0.11".
    public static func spend(tokens: Int, cost: Double?) -> String {
        let figure: String
        if tokens < 1_000 {
            figure = "\(tokens)"
        } else if tokens < 1_000_000 {
            figure = "\(jsToFixed(Double(tokens) / 1_000, tokens < 10_000 ? 1 : 0))k"
        } else {
            figure = "\(jsToFixed(Double(tokens) / 1_000_000, 1))M"
        }
        return cost.map { "\(figure) tok ≈ $\(jsToFixed($0, 2))" } ?? "\(figure) tok"
    }

    /// What a partner is doing, in a word or two.
    public static func statusLabel(state: SessionState?, failed: Bool, in context: TimeContext = .current) -> String {
        if failed { return "gone" }
        guard let state else { return "" }
        if state.closed == true { return "set aside" }
        if !state.pendingApprovalIds.isEmpty || !state.pendingQuestionIds.isEmpty { return "waiting for you" }
        if state.status == .running { return "working" }
        return "idle · \(Captions.ago(state.lastActivityAt, in: context))"
    }

    /// A long reply, cut for the card.
    public static func clipped(_ text: String) -> String {
        text.jsLength > replyLimit ? "\(text.utf16Prefix(replyLimit))…" : text
    }
}

public enum ArtifactPresentation {
    private static func trim(_ value: Double) -> String {
        // One decimal, and none when it would be a zero: "2.4 MB", "182 KB".
        let text = jsToFixed(value, 1)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    /// "812 B", "182 KB", "2.4 MB".
    public static func bytes(_ size: Int) -> String {
        if size < 1024 { return "\(size) B" }
        if size < 1024 * 1024 { return "\(trim(Double(size) / 1024)) KB" }
        return "\(trim(Double(size) / (1024 * 1024))) MB"
    }

    /// "182 KB · v3 · 25 Nov".
    public static func meta(_ artifact: ArtifactSummary, in context: TimeContext = .current) -> String {
        var parts = [bytes(artifact.size)]
        if artifact.version > 1 { parts.append("v\(artifact.version)") }
        if let updated = WireDate.parse(artifact.updatedAt) { parts.append(context.format(updated, template: "MMMd")) }
        return parts.joined(separator: " · ")
    }

    /// An artifact as a screen shows it: the latest, or one kept edition.
    public struct Loaded: Equatable, Sendable {
        public var artifact: ArtifactSummary
        public var text: String?
        /// The edition being shown, when it is not the latest.
        public var pinned: Int?
        /// An edition that was asked for and is no longer kept; the latest is shown instead.
        public var missingVersion: Int?

        public init(artifact: ArtifactSummary, text: String? = nil, pinned: Int? = nil, missingVersion: Int? = nil) {
            self.artifact = artifact
            self.text = text
            self.pinned = pinned
            self.missingVersion = missingVersion
        }
    }

    /// The latest, or — for a link to an earlier edition — that edition's content
    /// under the latest's identity. Nil when the artifact is gone or not ours.
    public static func load(_ seam: Seam, id: String, version: Int?) async throws -> Loaded? {
        guard let latest = try await seam.artifact(id) else { return nil }
        guard let version, version != latest.artifact.version else {
            return Loaded(artifact: latest.artifact, text: latest.text)
        }
        guard let edition = try await seam.artifactVersion(id, version: version) else {
            return Loaded(artifact: latest.artifact, text: latest.text, missingVersion: version)
        }
        var artifact = latest.artifact
        artifact.title = edition.version.title
        artifact.format = edition.version.format
        artifact.contentType = edition.version.contentType
        artifact.size = edition.version.size
        artifact.version = edition.version.version
        artifact.description = edition.description
        return Loaded(artifact: artifact, text: edition.text, pinned: edition.version.version)
    }

    /// Whether an HTML artifact's web view may load `target`.
    ///
    /// Only the page itself, and its own fragments. Everything else is either a
    /// person leaving (a tapped link, which opens in the system browser) or
    /// content trying to go somewhere (which is refused): the view carries the
    /// device's key on its first request, and a navigation it followed would
    /// carry the view somewhere that key was never meant to be near.
    public static func mayLoad(_ target: String, page: String) -> Bool {
        target == page || target.hasPrefix("\(page)#")
    }

    /// Whether a tapped link may be handed to the system browser.
    public static func opensExternally(_ target: String, page: String) -> Bool {
        !mayLoad(target, page: page) && (target.hasPrefix("http://") || target.hasPrefix("https://"))
    }
}

public enum UsageFormat {
    /// "812", "8.3k", "38k", "2.4M", "24M".
    public static func compact(_ n: Int) -> String {
        if n >= 1_000_000 { return "\(jsToFixed(Double(n) / 1_000_000, n >= 10_000_000 ? 0 : 1))M" }
        if n >= 1_000 { return "\(jsToFixed(Double(n) / 1_000, n >= 10_000 ? 0 : 1))k" }
        return String(n)
    }

    /// "$0.11", "$0.004" for less than a cent, "—" when no price is known.
    public static func money(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value > 0 && value < 0.01 ? "$\(jsToFixed(value, 3))" : "$\(jsToFixed(value, 2))"
    }

    /// A subscription connection is paid for by the plan, not by the token: its
    /// row says "plan" rather than a dollar figure that would be fiction.
    public static func planBilled(_ kind: Int?) -> Bool {
        kind == ProviderKind.openAICodex.rawValue || kind == ProviderKind.claudeCode.rawValue
    }

    /// How much of a window is left, clamped; nil when the provider did not say.
    public static func percentLeft(_ window: LimitWindow) -> Double? {
        window.usedPercent.map { min(100, max(0, 100 - $0)) }
    }

    /// "5-hour · 62% left" — the bar fills with what is left, not what is spent.
    public static func windowLabel(_ window: LimitWindow) -> String {
        guard let left = percentLeft(window) else { return "\(window.label.lowercased()) · usage unknown" }
        return "\(window.label.lowercased()) · \(Int(left.rounded(.toNearestOrAwayFromZero)))% left"
    }

    public static func attribution(_ quality: UsageAttributionQuality) -> String {
        switch quality {
        case .exact: return ""
        case .inferredLegacy: return " · inferred"
        default: return " · unattributed"
        }
    }

    /// "advisory · observed 14:20 · stale".
    public static func quotaNote(_ quota: PlanQuotaSummary, in context: TimeContext = .current) -> String {
        var note = "advisory"
        if let observed = quota.observedAt.truthy {
            note += " · \(quota.kind == .claudeCode ? "as of the last turn," : "observed") \(RoutineFormat.clock(observed, in: context))"
        }
        if quota.isStale { note += " · stale" }
        return note
    }
}

// What the settings screens decide, with no screen in the way.
//
// Each web settings page carries a little logic in its `@code` block — how a
// channel's settings blob is read back into a form and written out again, what
// "valid JSON with 3 handlers" is, which line of a skill is its description,
// how memory entries group. This file is that logic, ported function for
// function so the phone and the browser agree on what they store, and so it
// can be tested without a screen.

import Foundation

public struct ProviderChoice: Hashable, Sendable {
    public var kind: ProviderKind
    public var label: String
    public var note: String

    public init(kind: ProviderKind, label: String, note: String) {
        self.kind = kind
        self.label = label
        self.note = note
    }
}

public struct ProviderPreset: Hashable, Sendable {
    public var name: String
    public var baseUrl: String
    public var hint: String

    public init(name: String, baseUrl: String, hint: String) {
        self.name = name
        self.baseUrl = baseUrl
        self.hint = hint
    }
}

/// The add form's words for one kind: what the key field is, what the placeholder shows.
public struct ProviderFormWords: Hashable, Sendable {
    public var title: String
    public var description: String
    public var namePlaceholder: String
    public var keyLabel: String
    public var keyPlaceholder: String
    public var baseUrlLabel: String?
    public var baseUrlPlaceholder: String

    public init(title: String, description: String, namePlaceholder: String, keyLabel: String, keyPlaceholder: String, baseUrlLabel: String? = nil, baseUrlPlaceholder: String) {
        self.title = title
        self.description = description
        self.namePlaceholder = namePlaceholder
        self.keyLabel = keyLabel
        self.keyPlaceholder = keyPlaceholder
        self.baseUrlLabel = baseUrlLabel
        self.baseUrlPlaceholder = baseUrlPlaceholder
    }
}

public struct MemoryGroup: Hashable, Sendable, Identifiable {
    /// "" is user scope; otherwise a repo key.
    public var key: String
    public var title: String
    public var entries: [MemorySummary]
    public var id: String { key }

    public init(key: String, title: String, entries: [MemorySummary]) {
        self.key = key
        self.title = title
        self.entries = entries
    }
}

public struct ChannelFact: Hashable, Sendable {
    public var label: String
    public var value: String
    public var mono = false
}

/// Every field the channel form can hold, as the text the fields bind.
public struct ChannelForm: Hashable, Sendable {
    public var kind: ChannelKind
    public var displayName = ""
    public var secret = ""
    public var server = "https://ntfy.sh"
    public var topic = ""
    public var listenChannelIds = ""
    public var deliverToChannelIds = ""
    public var instance = ""
    public var smtpHost = ""
    public var smtpPort = "587"
    public var smtpSecurity = "starttls"
    public var imapHost = ""
    public var imapPort = "993"
    public var imapSecurity = "ssl"
    public var username = ""
    public var fromAddress = ""
    public var fromName = ""
    public var folder = "INBOX"
    public var pollSeconds = "60"
    public var allowFrom = ""

    public init(kind: ChannelKind = .telegram) {
        self.kind = kind
    }
}

public enum SettingsLogic {
    // MARK: connections

    public static func providerLabel(_ kind: ProviderKind) -> String {
        switch kind {
        case .anthropic: return "Anthropic"
        case .openAICompatible: return "OpenAI-compatible"
        case .openAICodex: return "ChatGPT · Codex"
        case .claudeCode: return "Claude Code"
        case .kimiCode: return "Kimi Code"
        default: return "Provider"
        }
    }

    /// "Anthropic · default · added 2026-09-01" — a connection row's second line.
    public static func connectionMeta(_ c: ConnectionSummary, in context: TimeContext = .current) -> String {
        let place = c.kind == .openAICodex || c.kind == .claudeCode ? c.accountLabel ?? "subscription" : c.baseUrl ?? "default"
        return "\(providerLabel(c.kind)) · \(place) · added \(day(c.createdAt, in: context))"
    }

    /// The kinds a key-based form can add; Codex is a sign-in flow, not a form.
    public static let addableProviders: [ProviderChoice] = [
        ProviderChoice(kind: .anthropic, label: "Anthropic API", note: "api key"),
        ProviderChoice(kind: .openAICompatible, label: "OpenAI-compatible", note: "endpoint"),
        ProviderChoice(kind: .claudeCode, label: "Claude Code", note: "subscription"),
        ProviderChoice(kind: .kimiCode, label: "Kimi Code", note: "subscription"),
    ]

    /// Known OpenAI-compatible services, prefilled into the form. Data only: the
    /// catalog declines to grade unknown providers' models, and the user does that
    /// on the connection's models list as always.
    public static let providerPresets: [ProviderPreset] = [
        ProviderPreset(name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", hint: "Key from openrouter.ai/keys."),
        ProviderPreset(name: "Groq", baseUrl: "https://api.groq.com/openai/v1", hint: "Key from console.groq.com."),
        ProviderPreset(name: "Together", baseUrl: "https://api.together.xyz/v1", hint: "Key from api.together.ai."),
        ProviderPreset(name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", hint: "Key from platform.deepseek.com."),
        ProviderPreset(name: "Mistral", baseUrl: "https://api.mistral.ai/v1", hint: "Key from console.mistral.ai."),
        ProviderPreset(name: "xAI", baseUrl: "https://api.x.ai/v1", hint: "Key from console.x.ai."),
        ProviderPreset(name: "z.ai GLM", baseUrl: "https://api.z.ai/api/paas/v4", hint: "Key from z.ai; GLM coding plans use this endpoint."),
        ProviderPreset(name: "Ollama (local)", baseUrl: "http://localhost:11434/v1", hint: "No key needed — type anything."),
    ]

    public static func providerForm(_ kind: ProviderKind) -> ProviderFormWords {
        switch kind {
        case .anthropic:
            return ProviderFormWords(
                title: "Connect Anthropic",
                description: "The key is validated against the Anthropic API before it is stored encrypted.",
                namePlaceholder: "Personal Anthropic", keyLabel: "API key", keyPlaceholder: "sk-ant-…",
                baseUrlLabel: "Base URL (optional)", baseUrlPlaceholder: "https://api.anthropic.com"
            )
        case .claudeCode:
            return ProviderFormWords(
                title: "Connect Claude Code",
                description: "The token is checked for shape and stored encrypted; Claude Code verifies it against your plan on the first turn.",
                namePlaceholder: "My Claude plan", keyLabel: "Setup token", keyPlaceholder: "sk-ant-oat01-…",
                baseUrlLabel: nil, baseUrlPlaceholder: ""
            )
        case .kimiCode:
            return ProviderFormWords(
                title: "Connect Kimi Code",
                description: "The key is validated against your Kimi Code plan before it is stored encrypted.",
                namePlaceholder: "My Kimi plan", keyLabel: "API key", keyPlaceholder: "sk-…",
                baseUrlLabel: "Base URL (optional)", baseUrlPlaceholder: KimiCodeEndpoints.default
            )
        default:
            return ProviderFormWords(
                title: "Connect an OpenAI-compatible endpoint",
                description: "The key and endpoint are validated before they are stored encrypted.",
                namePlaceholder: "Local vLLM", keyLabel: "API key", keyPlaceholder: "sk-… (anything for a local server)",
                baseUrlLabel: "Base URL", baseUrlPlaceholder: "http://localhost:11434/v1"
            )
        }
    }

    public static let tiers: [(tier: ModelTier?, label: String)] = [
        (nil, "Unrated (medium)"), (.simple, "Simple"), (.medium, "Medium"), (.complex, "Complex"), (.reasoning, "Reasoning"),
    ]

    /// The model catalog shape, as the web's placeholder shows it: the Codex
    /// `models.json` a provider documents, pasted whole. Shared by the add form
    /// and the models sheet because it is one document, not two.
    public static let modelCatalogPlaceholder = """
    {
      "models": [
        {
          "slug": "glm-5.3",
          "display_name": "GLM 5.3",
          "context_window": 1048576,
          "default_reasoning_level": "max",
          "supported_reasoning_levels": [
            { "effort": "low" },
            { "effort": "high" },
            { "effort": "max" }
          ]
        }
      ]
    }
    """

    public static func tierLabel(_ tier: ModelTier?) -> String {
        tiers.first { $0.tier == tier }?.label ?? "Unrated (medium)"
    }

    /// Where a git account lives: "github.com", or the forge's host.
    public static func gitHost(_ c: GitConnectionSummary) -> String {
        if c.kind == .gitHub { return "github.com" }
        guard let base = c.baseUrl.truthy else { return "" }
        guard let components = URLComponents(string: base), let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty
        else { return base }
        let standard = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        if let port = components.port, port != standard { return "\(host.lowercased()):\(port)" }
        return host.lowercased()
    }

    /// A .NET `TimeSpan` — "00:00:05", or "1.02:03:04" with days — as milliseconds.
    public static func timeSpanMs(_ text: String) -> Double {
        guard let match = firstMatch(#"^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$"#, in: text.jsTrim) else { return 0 }
        let days = match[1].flatMap(Double.init) ?? 0
        let hours = match[2].flatMap(Double.init) ?? 0
        let minutes = match[3].flatMap(Double.init) ?? 0
        let seconds = match[4].flatMap(Double.init) ?? 0
        return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
    }

    // MARK: mcp servers

    /// The row's target: the command line for stdio, the URL for HTTP.
    public static func mcpTarget(_ s: McpServerSummary) -> String {
        if s.kind == .http { return s.url ?? "" }
        return s.args.isEmpty ? s.command : "\(s.command) \(s.args.joined(separator: " "))"
    }

    /// Non-blank lines, trimmed.
    public static func splitLines(_ text: String) -> [String] {
        text.jsSplit("\n").map(\.jsTrim).filter { !$0.isEmpty }
    }

    /// `KEY=value` per line into a map; the first line that is not one is the error.
    public static func parseSecrets(_ text: String) -> (secrets: [String: String], error: String?) {
        var secrets: [String: String] = [:]
        for raw in splitLines(text) {
            guard let split = raw.jsIndex(of: "="), split > raw.unicodeScalars.startIndex else {
                return (secrets, "\"\(raw)\" isn't KEY=value.")
            }
            secrets[raw.jsPrefix(upTo: split).jsTrim] = raw.jsSlice(raw.unicodeScalars.index(after: split))
        }
        return (secrets, nil)
    }

    // MARK: remote nodes

    /// "pi@192.168.1.20", with the port only when it is not 22.
    public static func nodeTarget(_ n: RemoteNodeSummary) -> String {
        "\(n.username)@\(n.host)\(n.port == 22 ? "" : ":\(n.port)")"
    }

    /// The command to run on the node, as the login user.
    public static func installCommand(_ authorizedKeysLine: String) -> String {
        "echo '\(authorizedKeysLine)' >> ~/.ssh/authorized_keys"
    }

    // MARK: hooks

    /// The web's client-side check: the document must parse and be an object
    /// keyed by event name. Returns the line to show and whether the document may
    /// be saved.
    public static func checkHooks(_ json: String) -> (ok: Bool, message: String) {
        if json.jsTrim.isEmpty { return (true, "empty — saving removes your global hooks") }
        guard let parsed = JSONValue.parse(json) else { return (false, "Invalid JSON: the document does not parse.") }
        guard case .object(let object) = parsed else {
            return (false, "Invalid: the document must be a JSON object keyed by event name.")
        }
        let handlers = object.values.compactMap(\.array).reduce(0) { $0 + $1.count }
        return (true, "valid JSON with \(handlers) handler\(handlers == 1 ? "" : "s")")
    }

    // MARK: skills

    /// The frontmatter's description line, read straight off the raw text. No
    /// parser: a skill whose frontmatter is unreadable would not have saved.
    public static func describeSkill(_ content: String) -> String {
        for line in content.jsSplit("\n").prefix(20) {
            let trimmed = line.jsTrim
            guard trimmed.lowercased().jsStarts(with: "description:") else { continue }
            var value = Substring(trimmed.jsDropFirst("description:".count).jsTrim).unicodeScalars
            if value.first == "\"" || value.first == "'" { value.removeFirst() }
            if value.last == "\"" || value.last == "'" { value.removeLast() }
            return String(value)
        }
        return ""
    }

    public static let skillPlaceholder =
        "---\nname: monthly-invoices\ndescription: Pull last month's invoices and total them\n---\n\nSteps…"

    public static let facetPlaceholder =
        "---\ndescription: writes docs only\ntools-allow: read_file, write_file\n---\nYou write documentation. Nothing else."

    // MARK: memory

    /// User scope sorts first; repo groups follow alphabetically. Inside a group
    /// the pinned entries lead — they cost prompt tokens on every request, so they
    /// are what a review is looking for.
    public static func groupMemories(_ entries: [MemorySummary], locale: Locale = .current) -> [MemoryGroup] {
        func before(_ a: String, _ b: String) -> Bool {
            a.compare(b, options: [], range: nil, locale: locale) == .orderedAscending
        }
        let sorted = entries.stableSorted { a, b in
            if a.pinned != b.pinned { return a.pinned }
            return before(a.name, b.name)
        }
        var order: [String] = []
        var groups: [String: [MemorySummary]] = [:]
        for entry in sorted {
            if groups[entry.repoKey] == nil { order.append(entry.repoKey) }
            groups[entry.repoKey, default: []].append(entry)
        }
        return order.stableSorted(by: before).map { key in
            MemoryGroup(key: key, title: key.isEmpty ? "User memory" : key, entries: groups[key] ?? [])
        }
    }

    // MARK: channels

    public static func channelLabel(_ kind: ChannelKind) -> String {
        switch kind {
        case .telegram: return "telegram"
        case .email: return "email"
        case .discord: return "discord"
        case .fluxer: return "fluxer"
        default: return "ntfy"
        }
    }

    public static let channelKinds: [(kind: ChannelKind, label: String)] = [
        (.telegram, "Telegram bot"), (.ntfy, "ntfy topic"), (.email, "Email (SMTP + IMAP)"),
        (.discord, "Discord bot"), (.fluxer, "Fluxer bot"),
    ]

    /// The two-way kinds: the ones a person can pair with and talk to.
    public static func channelPairs(_ kind: ChannelKind) -> Bool {
        kind == .telegram || kind == .discord || kind == .fluxer || kind == .email
    }

    private static func blob(_ channel: ChannelSummary) -> JSONObject {
        JSONValue.parse(channel.settings.jsTrim.isEmpty ? "{}" : channel.settings)?.object ?? JSONObject()
    }

    /// A string out of the settings blob, or "".
    public static func channelSetting(_ channel: ChannelSummary, _ name: String) -> String {
        blob(channel)[name]?.string ?? ""
    }

    private static func channelNumber(_ channel: ChannelSummary, _ name: String, fallback: String) -> String {
        blob(channel)[name]?.double.map(JSONValue.format) ?? fallback
    }

    /// A string array out of the blob, joined for a form's one-line field.
    private static func channelList(_ channel: ChannelSummary, _ name: String) -> String {
        guard let items = blob(channel)[name]?.array else { return "" }
        return items.map { $0.string ?? $0.serialized() }.filter { !$0.jsTrim.isEmpty }.joined(separator: ", ")
    }

    /// The facts a channel card lists under its name.
    public static func channelFacts(_ channel: ChannelSummary, in context: TimeContext = .current) -> [ChannelFact] {
        var facts = [
            ChannelFact(label: "paired", value: String(channel.pairedPeers.count)),
            ChannelFact(label: "last seen", value: channel.lastSeenAt.truthy.map { stamp($0, in: context) } ?? "never"),
        ]
        if channel.kind == .ntfy { facts.append(ChannelFact(label: "topic", value: channelSetting(channel, "topic"), mono: true)) }
        if channel.kind == .email {
            facts.append(ChannelFact(label: "mailbox", value: channelSetting(channel, "fromAddress"), mono: true))
            facts.append(ChannelFact(label: "inbound", value: channelSetting(channel, "imapHost").nonEmpty ?? "delivery only"))
        }
        return facts
    }

    /// A stored channel unfolded into the form. The secret never comes back, so it starts blank.
    public static func channelFormOf(_ channel: ChannelSummary) -> ChannelForm {
        var form = ChannelForm(kind: channel.kind)
        let empty = form
        form.displayName = channel.displayName
        form.server = channelSetting(channel, "server").nonEmpty ?? "https://ntfy.sh"
        form.topic = channelSetting(channel, "topic")
        form.listenChannelIds = channelList(channel, "listenChannelIds")
        form.deliverToChannelIds = channelList(channel, "deliverToChannelIds")
        form.instance = channelSetting(channel, "instance")
        form.smtpHost = channelSetting(channel, "smtpHost")
        form.smtpPort = channelNumber(channel, "smtpPort", fallback: empty.smtpPort)
        form.smtpSecurity = channelSetting(channel, "smtpSecurity").nonEmpty ?? empty.smtpSecurity
        form.imapHost = channelSetting(channel, "imapHost")
        form.imapPort = channelNumber(channel, "imapPort", fallback: empty.imapPort)
        form.imapSecurity = channelSetting(channel, "imapSecurity").nonEmpty ?? empty.imapSecurity
        form.username = channelSetting(channel, "username")
        form.fromAddress = channelSetting(channel, "fromAddress")
        form.fromName = channelSetting(channel, "fromName")
        form.folder = channelSetting(channel, "folder").nonEmpty ?? empty.folder
        form.pollSeconds = channelNumber(channel, "pollSeconds", fallback: empty.pollSeconds)
        form.allowFrom = channelList(channel, "allowFrom")
        return form
    }

    private static func splitIds(_ text: String) -> [JSONValue] {
        text.unicodeScalars.split { $0 == "," || isJSWhitespace($0) }
            .map { String(String.UnicodeScalarView($0)).jsTrim }
            .filter { !$0.isEmpty }
            .map(JSONValue.string)
    }

    /// `parseInt(text, 10)`: the leading integer, or nil.
    public static func parseInt(_ text: String) -> Int? {
        var scalars = Substring(text.jsTrimStart).unicodeScalars
        var sign = 1
        if scalars.first == "-" {
            sign = -1
            scalars.removeFirst()
        } else if scalars.first == "+" {
            scalars.removeFirst()
        }
        let digits = String(String.UnicodeScalarView(scalars.prefix { (0x30...0x39).contains($0.value) }))
        guard !digits.isEmpty, let value = Int(digits) else { return nil }
        return sign * value
    }

    /// A typed number, or the default: a blank port must reach the server as 587.
    private static func port(_ text: String, fallback: Int) -> JSONValue {
        .number(Double(parseInt(text) ?? fallback))
    }

    /// The non-secret half, as the JSON blob the server stores — the same shape
    /// `Channels.razor` writes, key for key. Telegram needs none, so it writes an
    /// empty object rather than a shape nobody reads.
    public static func channelSettingsJson(_ form: ChannelForm) -> String {
        switch form.kind {
        case .ntfy:
            return JSONValue.object([
                "server": .string(form.server.jsTrim.nonEmpty ?? "https://ntfy.sh"),
                "topic": .string(form.topic.jsTrim),
            ]).serialized()
        case .discord, .fluxer:
            var settings = JSONObject()
            settings["listenChannelIds"] = .array(splitIds(form.listenChannelIds))
            settings["deliverToChannelIds"] = .array(splitIds(form.deliverToChannelIds))
            if form.kind == .fluxer, let instance = form.instance.jsTrim.nonEmpty { settings["instance"] = .string(instance) }
            return JSONValue.object(settings).serialized()
        case .email:
            var seen = Set<String>()
            let allow = form.allowFrom.unicodeScalars.split(omittingEmptySubsequences: false) { $0 == "," || $0 == ";" || $0 == "\n" }
                .map { String(String.UnicodeScalarView($0)).jsTrim.lowercased() }
                .filter { !$0.isEmpty && seen.insert($0).inserted }
            return JSONValue.object([
                "smtpHost": .string(form.smtpHost.jsTrim),
                "smtpPort": port(form.smtpPort, fallback: 587),
                "smtpSecurity": .string(form.smtpSecurity),
                "imapHost": .string(form.imapHost.jsTrim),
                "imapPort": port(form.imapPort, fallback: 993),
                "imapSecurity": .string(form.imapSecurity),
                "username": .string(form.username.jsTrim),
                "fromAddress": .string(form.fromAddress.jsTrim),
                "fromName": .string(form.fromName.jsTrim),
                "folder": .string(form.folder.jsTrim.nonEmpty ?? "INBOX"),
                "pollSeconds": port(form.pollSeconds, fallback: 60),
                "allowFrom": .array(allow.map(JSONValue.string)),
            ]).serialized()
        default:
            return "{}"
        }
    }

    // MARK: git identity

    /// `GitIdentityPrefs.MaxLength`.
    public static let gitIdentityMax = 256

    /// Why a value can't be a git identity, or nil when it can — a port of
    /// `GitIdentityPrefs.Problem`, so a bad value is explained before the server
    /// refuses it with a bare 400. Blank is fine: it means leave it unset. Control
    /// characters would break the one-line config value, and git itself strips
    /// `<`/`>` from idents, so those never mean what was typed.
    public static func gitIdentityProblem(_ value: String?, field: String) -> String? {
        let trimmed = (value ?? "").jsTrim
        if trimmed.isEmpty { return nil }
        if trimmed.jsLength > gitIdentityMax { return "\(field) must be at most \(gitIdentityMax) characters." }
        if trimmed.unicodeScalars.contains(where: { $0.value <= 0x1F || (0x7F...0x9F).contains($0.value) }) {
            return "\(field) can't contain line breaks or control characters."
        }
        if trimmed.unicodeScalars.contains(where: { $0 == "<" || $0 == ">" }) { return "\(field) can't contain < or >." }
        return nil
    }

    /// The first problem with either field, or nil when both are usable.
    public static func gitIdentityProblems(name: String, email: String) -> String? {
        gitIdentityProblem(name, field: "Name") ?? gitIdentityProblem(email, field: "Email")
    }

    // MARK: time

    /// "2026-09-01" — the day a row was added, as the web's `TimeFormat.Day`.
    public static func day(_ iso: String, in context: TimeContext = .current) -> String {
        WireDate.parse(iso).map { context.format($0, pattern: "yyyy-MM-dd") } ?? ""
    }

    /// "2026-09-01 17:24" — the settings tables' stamp.
    public static func stamp(_ iso: String, in context: TimeContext = .current) -> String {
        WireDate.parse(iso).map { context.format($0, pattern: "yyyy-MM-dd HH:mm") } ?? ""
    }

    /// Seconds left on a pairing code; zero once it has gone.
    public static func secondsLeft(_ expiresAt: String, in context: TimeContext = .current) -> Int {
        guard let at = WireDate.parse(expiresAt) else { return 0 }
        return max(0, Int(((at.timeIntervalSince1970 * 1000 - context.nowMs) / 1000).rounded(.up)))
    }
}

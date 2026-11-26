#if canImport(UIKit) && canImport(AppIntents)
import AppIntents
import SlopcoderCore
import UIKit

// Siri and Shortcuts: start a session, ask what is running, open one.
//
// These talk to the server through the same `Seam` the app uses, with the key
// read straight from the Keychain — an intent can run when the app is not.
//
// A caveat that belongs next to the code: the system discovers intents from
// metadata Xcode's build extracts (`Metadata.appintents`). A build made on
// Linux with xtool has no such step, so until one exists these compile and are
// callable in-process, but Siri and the Shortcuts app do not list them.

/// Failures an intent can hit, phrased as something Siri can say out loud.
enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case noModel
    case server(Int)
    case unreachable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            return "Open slopcoder and sign in first."
        case .noModel:
            return "No usable model — check the provider connections in slopcoder."
        case .server(let status):
            // 401 is the interesting one: the key was revoked, and no retry helps.
            return status == 401
                ? "slopcoder rejected this device’s key. Sign in again."
                : "slopcoder answered with an error (\(status))."
        case .unreachable:
            return "Could not reach slopcoder."
        }
    }

    /// Run a server call, turning what it throws into something speakable.
    static func speaking<T>(_ work: () async throws -> T) async throws -> T {
        do {
            return try await work()
        } catch let error as IntentError {
            throw error
        } catch is SignedOutError {
            throw IntentError.server(401)
        } catch let error as SeamError {
            throw IntentError.server(error.status)
        } catch {
            throw IntentError.unreachable
        }
    }
}

/// The server, as the signed-in person: the Keychain's key, no app required.
private func intentSeam() throws -> Seam {
    guard let credential = KeychainVault().load() else { throw IntentError.notSignedIn }
    return Seam(baseUrl: credential.server, apiKey: credential.apiKey)
}

// MARK: - the session entity

/// A session, as something the system knows about rather than a sentence.
///
/// An intent says what the app can *do*; an entity says what it *knows*. Without
/// the second, sessions are strings in a spoken reply — Siri cannot refer back to
/// one, resolve "the pairing QR session" to it, or offer it in Spotlight.
struct SessionEntity: AppEntity {
    let id: String
    let title: String
    let model: String
    let isRunning: Bool
    /// Stopped on an approval or a question, and going nowhere until answered.
    let waiting: Bool

    static var typeDisplayRepresentation = TypeDisplayRepresentation(
        name: "Session",
        numericFormat: "\(placeholder: .int) sessions"
    )

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(status)")
    }

    /// What the row says underneath the title — the state first, because that is
    /// the reason anyone is looking.
    var status: String {
        if waiting { return "waiting for you · \(model)" }
        return isRunning ? "running · \(model)" : "idle · \(model)"
    }

    static var defaultQuery = SessionQuery()

    init(id: String, title: String, model: String, isRunning: Bool, waiting: Bool) {
        self.id = id
        self.title = title
        self.model = model
        self.isRunning = isRunning
        self.waiting = waiting
    }

    init(_ session: SessionSummary, waiting: Bool = false) {
        self.init(
            id: session.id, title: session.title, model: session.autoRoute ? "auto" : session.model,
            isRunning: session.status == .running, waiting: waiting
        )
    }
}

/// Resolves sessions by id, by spoken title, and offers recent ones unprompted.
struct SessionQuery: EntityStringQuery {
    func entities(for identifiers: [SessionEntity.ID]) async throws -> [SessionEntity] {
        let wanted = Set(identifiers)
        return try await all().filter { wanted.contains($0.id) }
    }

    /// "the pairing QR session" — a loose contains-match, because nobody says a
    /// session title the way it was typed.
    func entities(matching string: String) async throws -> [SessionEntity] {
        let needle = string.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        return try await all().filter {
            $0.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current).contains(needle)
        }
    }

    /// Running first, then the rest — the order someone would want them offered.
    func suggestedEntities() async throws -> [SessionEntity] {
        let sessions = try await all()
        return Array((sessions.filter(\.isRunning) + sessions.filter { !$0.isRunning }).prefix(10))
    }

    /// The list does not carry pending ids, and fetching state per session would
    /// be a call each for a picker; `RunningSessionsIntent` fills `waiting` in
    /// where it matters.
    private func all() async throws -> [SessionEntity] {
        let seam = try intentSeam()
        return try await IntentError.speaking { try await seam.sessions().map { SessionEntity($0) } }
    }
}

// MARK: - intents

/// "Hey Siri, start a slopcoder session to fix the login bug."
///
/// `openAppWhenRun` is false on purpose: the point is to start work without
/// stopping what you were doing. The session runs in the server's sandbox — the
/// phone is never an executor — so there is nothing for the app to be present for.
struct StartSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Session"
    static var description = IntentDescription(
        "Starts a slopcoder session on the server and gives it a task.",
        categoryName: "Sessions"
    )
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task", requestValueDialog: "What should it work on?")
    var task: String

    @Parameter(title: "Repository", optionsProvider: RecentRepoOptions())
    var repository: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Start a session to \(\.$task)") {
            \.$repository
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<SessionEntity> {
        let trimmed = task.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw $task.needsValueError("What should it work on?")
        }
        let seam = try intentSeam()
        let repos = repository.flatMap { $0.isEmpty ? nil : [$0] }
        // Create, then start: create is cheap and synchronous while the turn is
        // neither; the server hands back an id and the work proceeds without us.
        let id = try await IntentError.speaking { () -> String in
            // A nil id means the model selection did not resolve — with auto-route
            // that means the account has no usable model at all.
            guard let id = try await seam.createSession(
                CreateSessionRequest(selection: .autoRoute, initialPrompt: trimmed, repoUrls: repos)
            ) else { throw IntentError.noModel }
            _ = try await seam.start(id, StartSessionRequest(prompt: trimmed, selection: .autoRoute))
            return id
        }
        // Returned as an entity so "open it" resolves without another lookup.
        // The title is the prompt until the server names the session.
        let session = SessionEntity(id: id, title: trimmed, model: "auto", isRunning: true, waiting: false)
        // Deliberately not read back as "done" — the turn has only just begun.
        return .result(value: session, dialog: "Started. I'll keep working on it.")
    }
}

/// The repositories this account used recently, so the parameter is a pick
/// rather than a clone URL spoken aloud.
struct RecentRepoOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        let seam = try intentSeam()
        return try await IntentError.speaking { try await seam.recentRepos().map(\.cloneUrl) }
    }
}

/// "Hey Siri, what's slopcoder doing?"
///
/// Read-only, and the one worth asking most often. It answers what is running,
/// how far into its context each session is, and — the part that matters —
/// whether anything has stopped to ask you something.
struct RunningSessionsIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Running Sessions"
    static var description = IntentDescription(
        "Says what slopcoder is working on, and whether anything is waiting on you.",
        categoryName: "Sessions"
    )
    static var openAppWhenRun: Bool = false

    /// Fetching per-session state is one call each, so cap it. More than a
    /// handful of simultaneous turns is not a thing you listen to anyway.
    private static let detailLimit = 4

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<[SessionEntity]> {
        let seam = try intentSeam()
        let running = try await IntentError.speaking { try await seam.sessions().filter { $0.status == .running } }
        guard !running.isEmpty else {
            return .result(value: [], dialog: "Nothing is running.")
        }

        var lines: [String] = []
        var blocked: [String] = []
        var entities: [SessionEntity] = []
        for session in running.prefix(Self.detailLimit) {
            // A session that vanishes between the list and the detail is not
            // worth failing the whole answer over.
            let state = try? await seam.session(session.id)
            let waiting = !(state?.pendingApprovalIds.isEmpty ?? true) || !(state?.pendingQuestionIds.isEmpty ?? true)
            entities.append(SessionEntity(session, waiting: waiting))
            var detail = session.title
            if let percent = TranscriptLayout.contextPercent(state?.lastUsage) {
                detail += ", \(percent) percent of context"
            }
            lines.append(detail)
            if waiting { blocked.append(session.title) }
        }
        if running.count > Self.detailLimit {
            lines.append("and \(running.count - Self.detailLimit) more")
        }

        var spoken = running.count == 1
            ? "One session running: \(lines.joined(separator: ", "))."
            : "\(running.count) sessions running: \(lines.joined(separator: "; "))."
        // The headline, if there is one: a blocked turn is doing nothing until
        // someone answers, and that is the thing worth interrupting for.
        if !blocked.isEmpty {
            spoken += blocked.count == 1 ? " \(blocked[0]) is waiting for you." : " \(blocked.count) are waiting for you."
        }
        // The entities are what makes this composable: a follow-up, or a
        // Shortcuts action downstream, can act on the sessions themselves
        // rather than on the sentence describing them.
        return .result(value: entities, dialog: "\(spoken)")
    }
}

/// "Hey Siri, open the pairing QR session in slopcoder."
///
/// `OpenIntent` is the one intent here that *should* bring the app forward.
/// Navigation goes through the app's own URL scheme, the same door a tapped
/// notification and a pasted link use.
struct OpenSessionIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open Session"
    static var description = IntentDescription("Opens a slopcoder session in the app.", categoryName: "Sessions")

    @Parameter(title: "Session")
    var target: SessionEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$target)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "slopcoder://session/\(target.id)") else { throw IntentError.unreachable }
        // Whether the URL was handled is not something to act on: the app is
        // already coming forward.
        _ = await UIApplication.shared.open(url)
        return .result()
    }
}

/// Phrases that work with no setup — no Shortcuts app, no configuration.
///
/// Every phrase has to contain `\(.applicationName)`, which is why the bundle's
/// display name matters: Siri has to be able to say it.
struct SlopcoderShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSessionIntent(),
            phrases: ["Start a \(.applicationName) session", "New \(.applicationName) session", "Start \(.applicationName)"],
            shortTitle: "Start a Session",
            systemImageName: "play.circle"
        )
        AppShortcut(
            intent: RunningSessionsIntent(),
            phrases: ["What is \(.applicationName) doing", "\(.applicationName) status", "Check \(.applicationName)"],
            shortTitle: "Running Sessions",
            systemImageName: "list.bullet.rectangle"
        )
        AppShortcut(
            intent: OpenSessionIntent(),
            phrases: ["Open \(\.$target) in \(.applicationName)", "Show me \(\.$target) in \(.applicationName)"],
            shortTitle: "Open a Session",
            systemImageName: "arrow.up.forward.app"
        )
    }
}
#endif

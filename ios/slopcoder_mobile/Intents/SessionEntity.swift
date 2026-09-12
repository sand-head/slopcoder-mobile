import AppIntents
import Foundation

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
            $0.title
                .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                .contains(needle)
        }
    }

    /// Running first, then the rest — the order someone would want them offered.
    func suggestedEntities() async throws -> [SessionEntity] {
        let sessions = try await all()
        return Array((sessions.filter(\.isRunning) + sessions.filter { !$0.isRunning }).prefix(10))
    }

    private func all() async throws -> [SessionEntity] {
        let client = SeamClient(credential: try CredentialStore.load())
        return try await client.sessions().map {
            SessionEntity(
                id: $0.id,
                title: $0.title,
                model: $0.autoRoute ? "auto" : $0.model,
                isRunning: $0.status == 1,
                // The list does not carry pending ids; only the cockpit view
                // does, and fetching state per session here would be a call each
                // for a picker. RunningSessionsIntent fills this in where it
                // matters.
                waiting: false
            )
        }
    }
}

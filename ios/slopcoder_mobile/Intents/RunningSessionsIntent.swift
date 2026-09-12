import AppIntents
import Foundation

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

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let client = SeamClient(credential: try CredentialStore.load())
        let running = try await client.sessions().filter { $0.status == 1 }

        guard !running.isEmpty else {
            return .result(value: "Nothing running.", dialog: "Nothing is running.")
        }

        var lines: [String] = []
        var blocked: [String] = []

        for session in running.prefix(Self.detailLimit) {
            // A session that vanishes between the list and the detail is not
            // worth failing the whole answer over.
            guard let state = try? await client.state(of: session.id) else {
                lines.append(session.title)
                continue
            }

            var detail = session.title
            if let percent = state.lastUsage?.percentOfContext {
                detail += ", \(percent) percent of context"
            }
            lines.append(detail)

            if !state.pendingApprovalIds.isEmpty || !state.pendingQuestionIds.isEmpty {
                blocked.append(session.title)
            }
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
            spoken += blocked.count == 1
                ? " \(blocked[0]) is waiting for you."
                : " \(blocked.count) are waiting for you."
        }

        return .result(value: spoken, dialog: "\(spoken)")
    }
}

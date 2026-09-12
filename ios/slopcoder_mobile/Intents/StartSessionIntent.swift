import AppIntents
import Foundation

/// "Hey Siri, start a slopcoder session to fix the login bug."
///
/// `openAppWhenRun` is false on purpose: the point is to start work without
/// stopping what you were doing. The session runs in the server's sandbox — the
/// phone is never an executor — so there is nothing for the app to be present
/// for.
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

        let client = SeamClient(credential: try CredentialStore.load())
        let id = try await client.startSession(
            prompt: trimmed,
            repoUrls: repository.map { [$0] }
        )

        // Returned as an entity so "open it" resolves without another lookup.
        // The title is the prompt until the server names the session.
        let session = SessionEntity(
            id: id,
            title: trimmed,
            model: "auto",
            isRunning: true,
            waiting: false
        )

        // Deliberately not read back as "done" — the turn has only just begun.
        return .result(value: session, dialog: "Started. I'll keep working on it.")
    }
}

/// The repositories this account used recently, so the parameter is a pick
/// rather than a clone URL spoken aloud.
struct RecentRepoOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        let client = SeamClient(credential: try CredentialStore.load())
        return try await client.recentRepos()
    }
}

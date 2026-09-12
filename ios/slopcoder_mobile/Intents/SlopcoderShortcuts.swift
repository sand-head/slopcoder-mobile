import AppIntents

/// Phrases that work with no setup — no Shortcuts app, no configuration.
///
/// Every phrase has to contain `\(.applicationName)`, which is why the bundle's
/// display name matters: Siri has to be able to say it.
struct SlopcoderShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSessionIntent(),
            phrases: [
                "Start a \(.applicationName) session",
                "New \(.applicationName) session",
                "Start \(.applicationName)",
            ],
            shortTitle: "Start a Session",
            systemImageName: "play.circle"
        )

        AppShortcut(
            intent: RunningSessionsIntent(),
            phrases: [
                "What is \(.applicationName) doing",
                "\(.applicationName) status",
                "Check \(.applicationName)",
            ],
            shortTitle: "Running Sessions",
            systemImageName: "list.bullet.rectangle"
        )
    }
}

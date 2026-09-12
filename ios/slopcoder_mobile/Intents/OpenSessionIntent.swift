import AppIntents
import UIKit

/// "Hey Siri, open the pairing QR session in slopcoder."
///
/// `OpenIntent` is the one intent here that *should* bring the app forward, so
/// unlike the others it does not fight it.
///
/// Navigation goes through our own URL scheme rather than a native module: React
/// Navigation already knows how to turn `slopcoder://session/<id>` into the
/// cockpit, and RCTLinkingManager's whole job is to post a notification the
/// AppDelegate can post itself.
struct OpenSessionIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open Session"

    static var description = IntentDescription(
        "Opens a slopcoder session in the app.",
        categoryName: "Sessions"
    )

    @Parameter(title: "Session")
    var target: SessionEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$target)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let url = URL(string: "slopcoder://session/\(target.id)") else {
            throw IntentError.unreachable
        }

        UIApplication.shared.open(url)
        return .result()
    }
}

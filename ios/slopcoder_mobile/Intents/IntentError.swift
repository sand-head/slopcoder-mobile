import AppIntents
import Foundation

/// Failures an intent can hit, phrased as something Siri can say out loud.
enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case deviceLocked
    case noModel
    case server(Int)
    case unreachable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            return "Open slopcoder and sign in first."
        case .deviceLocked:
            return "Unlock your device first."
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
}

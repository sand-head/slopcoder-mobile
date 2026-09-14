import Foundation

/// The version the binary actually carries.
///
/// `package.json` says 0.0.1 and always will: the release workflow stamps
/// `MARKETING_VERSION` and the build number into the app at build time and
/// never touches the repo. Settings used to show the package version, which
/// matched nothing anyone could look up; this hands JavaScript the two values
/// App Store Connect and TestFlight show.
@objc(AppInfo)
final class AppInfo: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc
    func constantsToExport() -> [String: Any]! {
        let info = Bundle.main.infoDictionary ?? [:]
        return [
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
        ]
    }
}

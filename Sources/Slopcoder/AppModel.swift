#if canImport(UIKit)
import Foundation
import Observation
import SlopcoderCore
import SwiftUI

/// Everything that outlives a screen: the key, the connection, the one hub.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    let connection = ConnectionStatus()
    let routineAlert = RoutineAlert()
    let router = Router()
    let auth: AuthStore
    let hubs: HubCenter

    /// The hub for the signed-in credential, held for as long as anyone is signed in.
    private(set) var hub: SessionHub?
    /// Artifact summaries, kept for the life of the signed-in seam.
    private(set) var artifactInfo: ArtifactInfoCache?
    /// A link that arrived before the key was read, opened once it has been.
    private var pendingURL: URL?
    /// Running against the stub server, for a UI test: see `StubMode`.
    let stubbed: Bool

    private init() {
        // Only a debug build can be asked for the stub, and only by a launch
        // argument, which is how a UI test starts the app and nothing else
        // does. A release build has no way in.
        #if DEBUG
        let stub = StubMode.requested(in: ProcessInfo.processInfo.arguments) ? StubServer() : nil
        #else
        let stub: StubServer? = nil
        #endif
        stubbed = stub != nil

        if let stub {
            // Signed in from memory, talking to the stub in process, and never
            // asking for notifications: nothing leaves the phone, and nothing
            // a real sign-in left in the Keychain is read or touched.
            auth = AuthStore(vault: MemoryVault(StubMode.credential), connection: connection, transport: stub, deviceName: "iPhone (slopcoder)")
            hubs = HubCenter(connection: connection, makeHub: { SessionHub($0, connector: stub) })
        } else {
            auth = AuthStore(vault: KeychainVault(), connection: connection, deviceName: "iPhone (slopcoder)")
            hubs = HubCenter(connection: connection)
            auth.onSignedIn = { PushRegistrar.enable() }
            auth.beforeSignOut = { await PushSubscriber.unsubscribe() }
        }
    }

    var seam: Seam? { auth.seam }

    /// Read the key, then bring up whatever a signed-in app needs.
    func launch() {
        guard !auth.ready else { return }
        auth.restore()
        sync()
    }

    /// Match the hub and caches to the credential. Called whenever it changes.
    func sync() {
        if let credential = auth.credential, let seam = auth.seam {
            if hub == nil {
                hub = hubs.acquire(credential)
                artifactInfo = ArtifactInfoCache(seam: seam)
            }
            if let url = pendingURL {
                pendingURL = nil
                _ = router.open(url: url, baseUrl: credential.server)
            }
        } else {
            if let hub { hubs.release(hub) }
            hubs.teardown()
            hub = nil
            artifactInfo = nil
            router.reset()
        }
    }

    func open(_ url: URL) {
        guard auth.ready, let credential = auth.credential else {
            pendingURL = url
            return
        }
        _ = router.open(url: url, baseUrl: credential.server)
    }

    /// A link tapped in a transcript: one of the app's own screens, the system
    /// browser, or — out loud — nothing.
    func follow(_ href: String) -> Bool {
        switch resolveLink(href, baseUrl: auth.credential?.server) {
        case .external(let url):
            guard let target = URL(string: url) else { return false }
            UIApplication.shared.open(target)
            return true
        case .unsupported:
            return false
        case let target:
            return router.open(target)
        }
    }
}
#endif

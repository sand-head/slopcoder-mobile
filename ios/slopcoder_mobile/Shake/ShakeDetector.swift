import Foundation
import React

/// Forwards `ShakeWindow`'s motion events to JavaScript.
///
/// `start`/`stop` exist to match Android, where listening is not free — there
/// the sensor has to be registered and unregistered, and leaving an
/// accelerometer running behind a dismissed sheet is a battery complaint
/// waiting to happen. Here they only gate the forwarding, because UIKit is
/// doing the detecting either way.
@objc(ShakeDetector)
final class ShakeDetector: RCTEventEmitter {
    private var listening = false
    private var hasListeners = false

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! { ["shake"] }

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onShake),
            name: ShakeWindow.shakeNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override func startObserving() { hasListeners = true }

    override func stopObserving() { hasListeners = false }

    @objc
    func start() { listening = true }

    @objc
    func stop() { listening = false }

    @objc
    private func onShake() {
        // Sending an event with no listeners registered is a red-box warning in
        // debug, so both gates are checked and not just ours.
        guard listening, hasListeners else { return }
        sendEvent(withName: "shake", body: nil)
    }
}

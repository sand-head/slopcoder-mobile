import UIKit

/// The app's window, with the one thing a plain `UIWindow` will not tell you.
///
/// iOS already detects a shake and already tuned what counts as one — it is how
/// undo works everywhere — and delivers it as a motion event up the responder
/// chain. Nothing in React Native forwards it, so the choice is this or an
/// accelerometer loop of our own, second-guessing a threshold Apple has had
/// right for fifteen years and holding a sensor open to do it.
///
/// A window subclass rather than a category on `UIWindow`: overriding an
/// `@objc` method from an extension is undefined behaviour in Swift, and this
/// app creates its own window in the AppDelegate anyway, so there is a seam to
/// use.
final class ShakeWindow: UIWindow {
    /// Posted on every shake. `ShakeDetector` forwards it to JavaScript.
    static let shakeNotification = Notification.Name("slopcoder.shake")

    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        guard motion == .motionShake else { return }
        NotificationCenter.default.post(name: ShakeWindow.shakeNotification, object: nil)
    }
}

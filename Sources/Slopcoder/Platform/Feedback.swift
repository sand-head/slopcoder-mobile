#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit

/// The few moments that deserve a tap under the thumb.
///
/// A native toggle vibrates on its own; the buttons this app draws do not, so
/// the ones that change something real — approve, deny, stop, delete — say so
/// through the glass. Nothing here fires for navigation or for reads: a haptic
/// on every press is the same as none.
@MainActor
enum Haptics {
    /// A choice was made: approve, answer, send.
    static func confirm() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    /// Something was refused or stopped.
    static func refuse() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    /// Something finished well.
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    /// Something went wrong.
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    /// A selection changed: a segment, a row in a picker.
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}

extension Feedback {
    /// What a screen's model feels like on the phone.
    static let haptics = Feedback(
        confirm: { Haptics.confirm() },
        refuse: { Haptics.refuse() },
        success: { Haptics.success() },
        error: { Haptics.error() },
        select: { Haptics.select() }
    )
}

/// Copying, with the tap you feel when it lands.
///
/// A phone has no console and no mouse, so a transcript you cannot get text out
/// of is a transcript you have to retype. iOS does not toast a copy and neither
/// should we; the haptic is the whole acknowledgement. Empty text is not an
/// error, it is nothing to copy — doing nothing beats clearing whatever the
/// pasteboard already held.
@MainActor
func copyText(_ text: String?) {
    guard let value = text?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return }
    UIPasteboard.general.string = value
    Haptics.select()
}

/// Shake the phone.
///
/// Shake is the right gesture for the terminal because the terminal is not part
/// of the screen it appears over. Everything the cockpit shows is the agent's
/// account of what it did; the terminal is the machine itself, wanted exactly
/// when that account stops being enough. A button for it would sit there being
/// ignored for whole sessions. A shake costs nothing until you need it — which
/// is also the argument the system already makes for undo.
///
/// iOS already detects a shake and already tuned what counts as one, and
/// delivers it as a motion event up the responder chain to the window. SwiftUI
/// owns the window, so there is no subclass to put this in; `UIWindow` inherits
/// `motionEnded` from `UIResponder` without overriding it, which is what makes
/// overriding it here safe.
extension UIWindow {
    static let shakeNotification = Notification.Name("slopcoder.shake")

    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        guard motion == .motionShake else { return }
        NotificationCenter.default.post(name: UIWindow.shakeNotification, object: nil)
    }
}

extension View {
    /// Call `action` when the phone is shaken, while `enabled`.
    func onShake(enabled: Bool = true, perform action: @escaping () -> Void) -> some View {
        onReceive(NotificationCenter.default.publisher(for: UIWindow.shakeNotification)) { _ in
            if enabled { action() }
        }
    }
}

/// The version the binary actually carries: the two values App Store Connect
/// and TestFlight show.
enum AppInfo {
    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }
    static var build: String { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "" }

    static var label: String {
        build.isEmpty ? version : "\(version) (\(build))"
    }
}
#endif

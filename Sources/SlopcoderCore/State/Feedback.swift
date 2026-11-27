// What a screen's model asks of the platform when something happens that a
// person should feel. The app plays haptics; tests count; nothing here knows
// which.

import Foundation

/// The few moments that deserve a tap under the thumb, as the screen's model
/// sees them. The app fills these in with its haptics.
public struct Feedback: Sendable {
    /// A choice was made: approve, answer, send.
    public var confirm: @MainActor @Sendable () -> Void
    /// Something was refused or stopped.
    public var refuse: @MainActor @Sendable () -> Void
    /// Something finished well.
    public var success: @MainActor @Sendable () -> Void
    /// Something went wrong.
    public var error: @MainActor @Sendable () -> Void
    /// A selection changed.
    public var select: @MainActor @Sendable () -> Void

    public init(
        confirm: @escaping @MainActor @Sendable () -> Void,
        refuse: @escaping @MainActor @Sendable () -> Void,
        success: @escaping @MainActor @Sendable () -> Void,
        error: @escaping @MainActor @Sendable () -> Void,
        select: @escaping @MainActor @Sendable () -> Void
    ) {
        self.confirm = confirm
        self.refuse = refuse
        self.success = success
        self.error = error
        self.select = select
    }

    public static let silent = Feedback(confirm: {}, refuse: {}, success: {}, error: {}, select: {})
}

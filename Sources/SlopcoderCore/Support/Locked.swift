// Mutable state shared across threads, behind a lock.
//
// The standard library's `Mutex` is the checked version of this, but on Apple
// platforms it needs iOS 18 and the app runs on 17. So this is the one place
// the package asserts thread safety by hand, and every type that used to pair
// an `NSLock` with its own unchecked `Sendable` keeps its state in one of these
// instead, and is checked by the compiler from there.

import Foundation

/// A value only ever reached while holding a lock.
///
/// Safe to share because `state` is private and read or written only inside
/// `withLock`, which holds `lock` for the whole of the body; the lock is never
/// held across a suspension, since the body is synchronous. `State` must be
/// `Sendable`, so what goes in and comes out may cross threads.
public final class Locked<State: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var state: State

    public init(_ state: State) {
        self.state = state
    }

    public func withLock<Result>(_ body: (inout State) throws -> Result) rethrows -> Result {
        lock.lock()
        defer { lock.unlock() }
        return try body(&state)
    }
}

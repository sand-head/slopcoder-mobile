#if canImport(UIKit)
import SwiftUI

/// A screen's model, made the first time the screen's body runs and kept for
/// as long as SwiftUI keeps the screen.
///
/// Held in `@State`, so there is one per screen identity. Its model is made
/// from the environment, which a view's `init` cannot read and its `body` can;
/// filling in a plain class during `body` is not a state change, so there is
/// no extra update and no empty first frame waiting for `onAppear`.
@MainActor
final class Kept<Model: AnyObject> {
    private var model: Model?

    func model(_ make: () -> Model) -> Model {
        if let model { return model }
        let made = make()
        model = made
        return made
    }
}
#endif

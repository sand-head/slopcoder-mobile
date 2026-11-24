import React
import UIKit

/// The blur behind the session header: the system material over whatever
/// scrolls under it, fading out toward its lower edge so it has no hard line.
///
/// It stands in for iOS 26's scroll-edge effect, which the system draws only
/// under its own navigation bar, over a scroll view it has adopted. The session
/// screen has neither: its header is laid out by React Native, and its
/// transcript is an inverted list.
///
/// The fade is the effect view's own `mask` — a view, not a layer mask on an
/// ancestor, because UIKit only keeps a visual effect view blurred when it is
/// masked that way. Touches pass through: this is a backdrop, nothing more.
final class EdgeBlurView: UIView {
  private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
  private let fade = EdgeFadeMaskView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    blur.frame = bounds
    blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    blur.mask = fade
    addSubview(blur)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    blur.frame = bounds
    // A mask view is not in the hierarchy, so nothing lays it out for us.
    fade.frame = blur.bounds
  }
}

/// Opaque at the top, clear at the bottom: the blur's soft lower edge.
private final class EdgeFadeMaskView: UIView {
  override class var layerClass: AnyClass { CAGradientLayer.self }

  override init(frame: CGRect) {
    super.init(frame: frame)
    guard let gradient = layer as? CAGradientLayer else { return }
    gradient.colors = [UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
    gradient.locations = [0, 0.55, 1]
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }
}

/// Exposed to JavaScript as `SlopEdgeBlur`. A classic view manager: the new
/// architecture draws it through React Native's legacy-view interop layer,
/// which finds a registered `…Manager` module by name. Same `RCT_EXTERN_MODULE`
/// bridging as AppInfo, PushRegistrar and ShakeDetector.
@objc(SlopEdgeBlurManager)
final class SlopEdgeBlurManager: RCTViewManager {
  override func view() -> UIView! {
    EdgeBlurView()
  }
}

#if canImport(UIKit)
import SlopcoderCore
import SwiftUI
import UIKit

// The shared palette. Neutral values originate in the web cockpit's sRGB
// conversions; app chrome uses the live logo emerald for the two themes.
// Semantic status colours remain independent of the primary action colour.
//
// Every colour here is dynamic — it resolves against the trait collection it is
// drawn in — so nothing reads the colour scheme to pick one, and a view that
// forgets to cannot end up with day ink on a night ground.

extension UIColor {
    /// `#rrggbb`, `#rrggbbaa` or `rgba(r, g, b, a)`. Anything else is clear.
    convenience init(css: String) {
        let text = css.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") {
            let hex = String(text.dropFirst())
            var value: UInt64 = 0
            Scanner(string: hex).scanHexInt64(&value)
            if hex.count == 8 {
                self.init(
                    red: CGFloat((value >> 24) & 0xff) / 255, green: CGFloat((value >> 16) & 0xff) / 255,
                    blue: CGFloat((value >> 8) & 0xff) / 255, alpha: CGFloat(value & 0xff) / 255
                )
            } else {
                self.init(
                    red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
                    blue: CGFloat(value & 0xff) / 255, alpha: 1
                )
            }
            return
        }
        if text.hasPrefix("rgba("), text.hasSuffix(")") {
            let parts = text.dropFirst(5).dropLast().split(separator: ",").map {
                Double($0.trimmingCharacters(in: .whitespaces)) ?? 0
            }
            if parts.count == 4 {
                self.init(red: CGFloat(parts[0]) / 255, green: CGFloat(parts[1]) / 255, blue: CGFloat(parts[2]) / 255, alpha: CGFloat(parts[3]))
                return
            }
        }
        self.init(white: 0, alpha: 0)
    }

    static func dynamic(_ light: String, _ dark: String) -> UIColor {
        let lightColor = UIColor(css: light)
        let darkColor = UIColor(css: dark)
        return UIColor { traits in traits.userInterfaceStyle == .dark ? darkColor : lightColor }
    }
}

extension Color {
    init(css: String) {
        self.init(uiColor: UIColor(css: css))
    }

    static func dynamic(_ light: String, _ dark: String) -> Color {
        Color(uiColor: .dynamic(light, dark))
    }
}

enum Palette {
    static let background = Color.dynamic("#ffffff", "#17171d")
    static let foreground = Color.dynamic("#24232d", "#eeebf3")
    static let card = Color.dynamic("#ffffff", "#222229")
    static let primary = Color.dynamic("#007a55", "#00bc7d")
    static let primaryForeground = Color.dynamic("#ecfdf5", "#061d15")
    static let secondary = Color.dynamic("#f0eef3", "#29272e")
    static let userBubble = Color.dynamic("#f0eef3", "#29272e")
    static let muted = Color.dynamic("#f0eef3", "#29272e")
    static let mutedForeground = Color.dynamic("#625e6e", "#b9b3c5")
    static let accent = Color.dynamic("#f0eef3", "#29272e")
    static let destructive = Color.dynamic("#e7000b", "#ff6467")
    static let warning = Color.dynamic("#a04b00", "#ffb900")
    static let border = Color.dynamic("#e3e7e8", "rgba(255, 255, 255, 0.1)")
    static let input = Color.dynamic("#e3e7e8", "rgba(255, 255, 255, 0.12)")
    static let ring = Color.dynamic("#9ca8ab", "#a69d91")
    static let sidebar = Color.dynamic("#f9fbfb", "#1c1c22")

    static let uiBackground = UIColor.dynamic("#ffffff", "#17171d")
    static let uiForeground = UIColor.dynamic("#24232d", "#eeebf3")
    static let uiPrimary = UIColor.dynamic("#007a55", "#00bc7d")
}

/// Status colours. Amber = running, emerald = ok, violet = thinking,
/// fuchsia = subagent, sky = plan — the mapping the transcript uses. The
/// lighter variant reads on the dark ground; the darker one on white.
enum Status {
    static let running = Color.dynamic("#fe9a00", "#ffb900")
    static let ok = Color.dynamic("#00bc7d", "#00d492")
    static let thinking = Color.dynamic("#8e51ff", "#a684ff")
    static let subagent = Color.dynamic("#c800de", "#ed6aff")
    static let plan = Color.dynamic("#0084d1", "#00bcff")
}

/// Sub-session tints: one shade per partner, so Ada is the same colour on her
/// card, on her replies, and everywhere the agent names her in prose. The server
/// allocates these round-robin per parent (`SubSessionPalette`), never hashed
/// and never random, so no two partners on a team collide. Emerald and amber are
/// absent on purpose — they already mean ok and running here.
enum Tint {
    private static let tints: [String: (light: String, dark: String)] = [
        "violet": ("#7645d8", "#b39bff"),
        "amber": ("#8a6410", "#e8c168"),
        "sky": ("#0e6f9e", "#7cc6ec"),
        "rose": ("#c03259", "#f79aae"),
        "teal": ("#0e6d70", "#69c8c6"),
        "fuchsia": ("#a33396", "#ec9ae0"),
        "indigo": ("#4a51c9", "#9ba5f2"),
        "orange": ("#9c5117", "#eaa377"),
    ]

    /// A partner's colour by name, or nil when there is none to apply — a
    /// sub-session from before tints, or a name this build has never heard of. Nil
    /// rather than a fallback shade: an untinted partner reads as untinted, where a
    /// wrong-but-present colour reads as a different partner.
    static func color(_ name: String?) -> Color? {
        guard let name, let tint = tints[name] else { return nil }
        return .dynamic(tint.light, tint.dark)
    }

    static func uiColor(_ name: String?) -> UIColor? {
        guard let name, let tint = tints[name] else { return nil }
        return .dynamic(tint.light, tint.dark)
    }
}

/// The shadcn scale off --radius: 0.625rem.
enum Radius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 10
    static let xl: CGFloat = 14
    static let xxl: CGFloat = 18
}

/// Allo for names and prose, Geist Mono for meta lines, labels, counts,
/// timestamps, tool rows. That split is the strongest visual signature of this
/// UI, so it is a token rather than a per-screen choice.
///
/// One face per weight. The files are static cuts whose PostScript names equal
/// their filenames, so the name is the whole lookup; asking for a `weight`
/// alongside one would do nothing.
enum AppFont {
    static let sansName = "Allo-Regular"
    static let sansMediumName = "Allo-Medium"
    static let monoName = "GeistMono-Regular"
    static let monoSemiBoldName = "GeistMono-SemiBold"

    static func sans(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(sansName, size: size, relativeTo: style)
    }

    static func sansMedium(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(sansMediumName, size: size, relativeTo: style)
    }

    static func mono(_ size: CGFloat, relativeTo style: Font.TextStyle = .footnote) -> Font {
        .custom(monoName, size: size, relativeTo: style)
    }

    static func monoSemiBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .footnote) -> Font {
        .custom(monoSemiBoldName, size: size, relativeTo: style)
    }

    /// The faces live in this package's resource bundle, not the app's, so the
    /// `UIAppFonts` route cannot name them. Registered once, before the first view.
    static func register() {
        for name in [sansName, sansMediumName, monoName, monoSemiBoldName] {
            guard let url = Bundle.module.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

/// How a session reads, measured off the web cockpit at phone width. One place,
/// so the transcript, a routine's answer and a sub-session's tail cannot drift
/// apart.
enum Reading {
    /// The widest a column of reading gets. Past this a line is too long to
    /// follow back to its start, however much screen there is.
    static let maxWidth: CGFloat = 760
    /// The widest a short form gets: a sign-in is not a document.
    static let formWidth: CGFloat = 460
    /// Space either side of the transcript column.
    static let column: CGFloat = 21
    static let proseSize: CGFloat = 14
    /// Extra leading that takes Allo 14 to the web's 24pt line.
    static let proseLineSpacing: CGFloat = 6
    static let proseSmallSize: CGFloat = 13
    static let proseSmallLineSpacing: CGFloat = 4
    /// Between two paragraphs.
    static let paragraphGap: CGFloat = 8
    static let userSize: CGFloat = 14
    static let userLineSpacing: CGFloat = 4
    /// Disclosure rows — thinking, plan, tool activity — and their meta.
    static let summarySize: CGFloat = 12
    static let noteSize: CGFloat = 12
    static let captionSize: CGFloat = 13
    static let dateSize: CGFloat = 10
}

/// An image from this package's bundle, in its day or night cut.
struct ThemedImage: View {
    @Environment(\.colorScheme) private var scheme
    let day: String
    let night: String

    var body: some View {
        Image(scheme == .dark ? night : day, bundle: .module).resizable().scaledToFit()
    }
}
extension View {
    /// Hold content to a readable measure and centre it in whatever is left.
    ///
    /// On a phone held upright this does nothing — the screen is narrower than
    /// the measure. In landscape, on the inner display of an iPhone Duo, or in a
    /// wide Split View half, it is what stops prose running the width of the glass.
    func readingWidth(_ width: CGFloat = Reading.maxWidth) -> some View {
        frame(maxWidth: width, alignment: .leading).frame(maxWidth: .infinity, alignment: .center)
    }
}
#endif

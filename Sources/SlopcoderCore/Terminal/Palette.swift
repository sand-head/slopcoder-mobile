// Turning a terminal colour into something a view can paint.
//
// The first sixteen entries are the ones a program actually names — `ESC[31m`
// is "red", and which red is the terminal's business. The set below is
// slopterm's, so a log looks the same in the cockpit and on the phone; the rest
// of the 256 is the standard 6×6×6 cube and greyscale ramp, which is defined
// arithmetically and identical everywhere.
//
// The sheet is dark in both app themes (a terminal is), so there is one set of
// sixteen rather than a light and a dark cut.

import Foundation

public enum TerminalPalette {
    /// The named sixteen, in ANSI order: black, red, green, yellow, blue, magenta, cyan, white, then bright.
    static let ansi16 = [
        "#1c1917", "#f87171", "#4ade80", "#fbbf24", "#60a5fa", "#e879f9", "#22d3ee", "#d6d3d1",
        "#57534e", "#fca5a5", "#86efac", "#fcd34d", "#93c5fd", "#f0abfc", "#67e8f9", "#fafaf9",
    ]

    /// The terminal's own ground and ink, independent of the app's palette.
    public static let background = "#17130f"
    public static let foreground = "#e7e2db"

    private static let cubeSteps = [0, 95, 135, 175, 215, 255]

    private static func hex(_ n: Int) -> String { String(format: "%02x", n & 0xff) }

    /// One of the 256 palette entries, as a CSS colour.
    static func palette(_ index: Int) -> String {
        if index < 16 { return ansi16[max(0, index)] }
        if index < 232 {
            let n = index - 16
            return "#\(hex(cubeSteps[(n / 36) % 6]))\(hex(cubeSteps[(n / 6) % 6]))\(hex(cubeSteps[n % 6]))"
        }
        let level = 8 + (index - 232) * 10
        return "#\(hex(level))\(hex(level))\(hex(level))"
    }

    static func resolve(_ color: TerminalColor, fallback: String) -> String {
        guard let color else { return fallback }
        if color >= terminalRgbFlag { return String(format: "#%06x", color & 0xffffff) }
        return palette(color & 0xff)
    }

    public struct Painted: Hashable, Sendable {
        public var color: String
        public var backgroundColor: String?
        public var italic: Bool
        public var underline: Bool
        /// Bold selects the bright half of the sixteen, the way most terminals do.
        public var bold: Bool
        public var dim: Bool

        public init(color: String, backgroundColor: String? = nil, italic: Bool, underline: Bool, bold: Bool, dim: Bool) {
            self.color = color
            self.backgroundColor = backgroundColor
            self.italic = italic
            self.underline = underline
            self.bold = bold
            self.dim = dim
        }
    }

    /// What a run of cells should look like: inverse and bold applied, not deferred.
    public static func paint(_ style: TerminalStyle) -> Painted {
        var fg = style.fg
        // Bold on one of the eight named colours means its bright twin. Programs lean
        // on this — a bold-red error is meant to be the light red.
        if style.bold, let named = fg, named < 8 { fg = named + 8 }

        var color = resolve(fg, fallback: foreground)
        var background = style.bg.map { resolve($0, fallback: TerminalPalette.background) }

        if style.inverse {
            let swapped = background ?? TerminalPalette.background
            background = color
            color = swapped
        }
        if style.hidden { color = background ?? TerminalPalette.background }

        return Painted(
            color: color, backgroundColor: background, italic: style.italic, underline: style.underline,
            bold: style.bold, dim: style.dim
        )
    }
}

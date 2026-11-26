#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// The primitives the cockpit's look is made of.
//
// Two rules carried over from the web UI, because between them they are most of
// its character: names and prose are Allo, and everything that is *about* them —
// labels, counts, timestamps, tool rows — is Geist Mono, small, and often
// uppercase with wide tracking.

/// The mono-meta grammar: 11pt, uppercase, generously tracked.
struct Meta: View {
    let text: String
    var color: Color = Palette.mutedForeground

    init(_ text: String, color: Color = Palette.mutedForeground) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(AppFont.mono(11, relativeTo: .caption))
            .tracking(0.66)
            .foregroundStyle(color)
            // How far the mono grammar may grow under Dynamic Type. Body text scales
            // freely; a label that doubles pushes the value it labels off the row.
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// Mono at reading size: values, paths, counts.
struct Mono: View {
    let text: String
    var size: CGFloat = 12
    var color: Color = Palette.mutedForeground
    var semibold = false

    init(_ text: String, size: CGFloat = 12, color: Color = Palette.mutedForeground, semibold: Bool = false) {
        self.text = text
        self.size = size
        self.color = color
        self.semibold = semibold
    }

    var body: some View {
        Text(text)
            .font(semibold ? AppFont.monoSemiBold(size) : AppFont.mono(size))
            .foregroundStyle(color)
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// Allo at body size: names and prose.
struct BodyText: View {
    let text: String
    var size: CGFloat = 14
    var color: Color = Palette.foreground
    var medium = false

    init(_ text: String, size: CGFloat = 14, color: Color = Palette.foreground, medium: Bool = false) {
        self.text = text
        self.size = size
        self.color = color
        self.medium = medium
    }

    var body: some View {
        Text(text)
            .font(medium ? AppFont.sansMedium(size) : AppFont.sans(size))
            .foregroundStyle(color)
    }
}

/// A caption under a control: what it does, in a sentence.
struct Hint: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(AppFont.sans(12, relativeTo: .caption))
            .foregroundStyle(Palette.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A problem, said where it happened.
struct ErrorText: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(AppFont.sans(13))
            .foregroundStyle(Palette.destructive)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}

struct SectionLabel: View {
    let text: String
    var trailing: String?

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack {
            Meta(text)
            Spacer()
            if let trailing { Meta(trailing) }
        }
        .padding(.top, 8)
    }
}

/// The wordmark: the Fold pile and the name, as one image per theme.
struct Brand: View {
    var height: CGFloat = 26

    var body: some View {
        ThemedImage(day: "fold-wordmark-day", night: "fold-wordmark-night")
            .frame(height: height)
            .accessibilityLabel("slopcoder")
    }
}

struct LogoMark: View {
    var size: CGFloat = 18

    var body: some View {
        ThemedImage(day: "fold-pile-day", night: "fold-pile-night")
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
#endif

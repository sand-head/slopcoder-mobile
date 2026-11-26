#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// MARK: - marks

// Transcript marks are drawn rather than typed. Geist Mono carries none of
// ✓ ✗ ◐ ☰ ∴ ⑂ ◈, and a typed glyph the face lacks renders as whatever the OS
// substitutes, at a different size and weight from the row it sits in.

struct Dot: View {
    var color: Color
    var filled = true
    var size: CGFloat = 9

    var body: some View {
        Circle()
            .fill(filled ? color : Color.clear)
            .overlay(Circle().strokeBorder(color, lineWidth: filled ? 0 : 1.5))
            .frame(width: size, height: size)
    }
}

/// ◐ — a step under way.
struct HalfDot: View {
    var color: Color
    var size: CGFloat = 9

    var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: 1.5)
            .background(
                HStack(spacing: 0) {
                    color.frame(width: size / 2)
                    Color.clear
                }
                .clipShape(Circle())
            )
            .frame(width: size, height: size)
    }
}

/// ◈ — an approval gate.
struct Diamond: View {
    var color: Color
    var size: CGFloat = 9

    var body: some View {
        Rectangle().fill(color).frame(width: size, height: size).rotationEffect(.degrees(45))
    }
}

/// The disclosure mark: down when closed, up when open, always at the row's
/// trailing edge. The only one in the app.
struct Chevron: View {
    var open: Bool
    var color: Color = Palette.mutedForeground

    var body: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .rotationEffect(.degrees(open ? 180 : 0))
            .frame(width: 12, height: 12)
            .accessibilityHidden(true)
    }
}

/// A brain, for thinking: a light body with the folds in the full colour.
struct Brain: View {
    var color: Color
    var size: CGFloat = 13

    var body: some View {
        ZStack {
            Image("brain-body", bundle: .module).resizable().renderingMode(.template).foregroundStyle(color.opacity(0.35))
            Image("brain-folds", bundle: .module).resizable().renderingMode(.template).foregroundStyle(color)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The mark of a git hosting service — GitHub's, a Forgejo's, or the generic
/// Git one when no connection recognizes the host.
struct GitMark: View {
    var kind: GitServiceKind?
    var size: CGFloat = 14
    var color: Color = Palette.mutedForeground

    private var name: String {
        if kind == .gitHub { return "github" }
        if kind == .forgejo { return "forgejo" }
        return "git"
    }

    var body: some View {
        Image(name, bundle: .module)
            .resizable()
            .renderingMode(.template)
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The one geometry every transcript line shares — a tool call, a group of
/// them, a thinking row, a note. Its mark sits centred in a 12-wide gutter at
/// the same inset, so the dots and chevrons down the left edge form one column,
/// and every line is the same height, so the gaps between them are equal.
enum RowMetrics {
    static let minHeight: CGFloat = 36
    static let paddingVertical: CGFloat = 6
    static let paddingHorizontal: CGFloat = 6
    static let gap: CGFloat = 8
    static let gutter: CGFloat = 12
    /// The status dot's size, in every row that carries one.
    static let dot: CGFloat = 7
}

/// Running pulses in emerald; idle is a ring.
struct StatusDot: View {
    var running: Bool
    var size: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(running ? Status.ok : Color.clear)
            .overlay(Circle().strokeBorder(Palette.border, lineWidth: running ? 0 : 1))
            .frame(width: size, height: size)
            .opacity(running && dim ? 0.35 : 1)
            .onAppear { animate() }
            .onChange(of: running) { _, _ in animate() }
            .accessibilityLabel(running ? "Running" : "Idle")
    }

    private func animate() {
        guard running, !reduceMotion else {
            dim = false
            return
        }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
    }
}

/// Where a row will be once the server has answered.
///
/// Only for data that is genuinely unknown — a session list, a run log. Chrome
/// paints for real; a heading does not need a placeholder for itself.
struct Skeleton: View {
    var rows = 3
    var height: CGFloat = 44
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bright = false

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Palette.mutedForeground.opacity(0.22))
                            .frame(width: proxy.size.width * CGFloat(55 + (index * 17) % 30) / 100, height: 12)
                    }
                    .frame(height: 12)
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Palette.mutedForeground.opacity(0.14))
                            .frame(width: proxy.size.width * 0.38, height: 9)
                    }
                    .frame(height: 9)
                }
                .padding(.vertical, 12)
                .frame(minHeight: height)
                .overlay(alignment: .top) { Palette.border.frame(height: 1) }
            }
        }
        .opacity(bright || reduceMotion ? 1 : 0.5)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { bright = true }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

// MARK: - surfaces

struct Card<Content: View>: View {
    var padding: CGFloat = 12
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
    }
}

/// A surface that is glass where the OS has it, and a material everywhere else.
///
/// Glass refracts what is *behind* it, so it only earns its place on a surface
/// that floats over content — the composer, a floating bar. A glass panel over a
/// plain background is a flat tint. Below iOS 26 the fallback is not an edge
/// case, it is most of the matrix, and it has to look finished on its own.
struct GlassSurface: ViewModifier {
    var cornerRadius: CGFloat = Radius.xxl
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if reduceTransparency {
            content
                .background(Palette.card, in: shape)
                .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
        } else if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content
                .background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
        }
    }
}

extension View {
    func glassSurface(cornerRadius: CGFloat = Radius.xxl) -> some View {
        modifier(GlassSurface(cornerRadius: cornerRadius))
    }

    /// A hairline in the palette's border colour.
    func topBorder() -> some View {
        overlay(alignment: .top) { Palette.border.frame(height: 1) }
    }
}

// MARK: - buttons

enum ButtonVariant {
    case primary, outline, ghost, destructive, linkDestructive
}

struct AppButton: View {
    let label: String
    var variant: ButtonVariant = .primary
    var busy = false
    var disabled = false
    var fullWidth = false
    let action: () -> Void

    init(
        _ label: String, variant: ButtonVariant = .primary, busy: Bool = false, disabled: Bool = false,
        fullWidth: Bool = false, action: @escaping () -> Void
    ) {
        self.label = label
        self.variant = variant
        self.busy = busy
        self.disabled = disabled
        self.fullWidth = fullWidth
        self.action = action
    }

    private var background: Color {
        switch variant {
        case .primary: return Palette.primary
        case .destructive: return Palette.destructive
        default: return .clear
        }
    }

    private var foreground: Color {
        switch variant {
        case .primary: return Palette.primaryForeground
        case .destructive: return Color.dynamic("#ffffff", "#201012")
        case .ghost: return Palette.mutedForeground
        case .linkDestructive: return Palette.destructive
        case .outline: return Palette.foreground
        }
    }

    var body: some View {
        Button(action: action) {
            Group {
                if busy {
                    ProgressView().tint(foreground)
                } else if variant == .linkDestructive {
                    Text(label).font(AppFont.mono(13)).underline()
                } else {
                    Text(label).font(AppFont.sansMedium(14))
                }
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, variant == .linkDestructive ? 0 : 14)
            .padding(.vertical, 8)
            // 2rem on the web; a thumb wants more.
            .frame(minWidth: variant == .linkDestructive ? 0 : 64, minHeight: variant == .linkDestructive ? 32 : 40)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(background, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: variant == .outline ? 1 : 0))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled || busy)
        .opacity(disabled || busy ? 0.45 : 1)
        .accessibilityLabel(label)
    }
}

/// A chip: a short fact about the thing beside it.
struct Chip: View {
    let text: String
    var color: Color = Palette.mutedForeground
    var filled = false

    init(_ text: String, color: Color = Palette.mutedForeground, filled: Bool = false) {
        self.text = text
        self.color = color
        self.filled = filled
    }

    var body: some View {
        Text(text)
            .font(AppFont.mono(11, relativeTo: .caption))
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(filled ? color.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(filled ? Color.clear : Palette.border, lineWidth: 1))
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

// MARK: - fields

/// A text field the OS can fill: content type and keyboard are what iCloud
/// Keychain keys off.
struct AppField: View {
    let placeholder: String
    @Binding var text: String
    var secure = false
    var mono = false
    var contentType: UITextContentType?
    var keyboard: UIKeyboardType = .default
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}

    var body: some View {
        Group {
            if secure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .font(mono ? AppFont.mono(13) : AppFont.sans(15))
        .foregroundStyle(Palette.foreground)
        .textContentType(contentType)
        .keyboardType(keyboard)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(submitLabel)
        .onSubmit(onSubmit)
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.input, lineWidth: 1))
    }
}

/// A multi-line box for documents: a prompt, a facet, a hooks file.
struct AppEditor: View {
    @Binding var text: String
    var placeholder = ""
    var mono = false
    var minHeight: CGFloat = 120

    var body: some View {
        TextEditor(text: $text)
            .font(mono ? AppFont.mono(12) : AppFont.sans(14))
            .foregroundStyle(Palette.foreground)
            .scrollContentBackground(.hidden)
            .textInputAutocapitalization(mono ? .never : .sentences)
            .autocorrectionDisabled(mono)
            .padding(8)
            .frame(minHeight: minHeight)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.input, lineWidth: 1))
            .overlay(alignment: .topLeading) {
                if text.isEmpty, !placeholder.isEmpty {
                    Text(placeholder)
                        .font(mono ? AppFont.mono(12) : AppFont.sans(14))
                        .foregroundStyle(Palette.mutedForeground.opacity(0.7))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 16)
                        .allowsHitTesting(false)
                }
            }
    }
}

// MARK: - states

/// What a list says when it has nothing, which is not the same as not having looked.
struct EmptyState: View {
    let title: String
    var detail: String?

    init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(spacing: 6) {
            BodyText(title, color: Palette.mutedForeground)
            if let detail { Hint(detail).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
    }
}

extension View {
    /// The page ground, behind everything and under the bars.
    func pageBackground() -> some View {
        background(Palette.background.ignoresSafeArea())
    }
}
#endif

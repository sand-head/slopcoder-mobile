#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// The session's terminal, in a sheet: the machine itself.
///
/// Dark in both themes — a terminal is — and measured before it connects, so the
/// shell is told a width that is true.
struct TerminalSheet: View {
    let sessionId: String

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var terminal = LiveTerminal()
    @State private var typing = false
    @State private var pinned = true

    private static let ground = Color(css: TerminalPalette.background)
    private static let ink = Color(css: TerminalPalette.foreground)
    private static let end = "terminal-end"

    private var statusText: (text: String, alarming: Bool) {
        switch terminal.status {
        case .connecting: return ("connecting…", false)
        case .live: return ("live", false)
        case .exited: return ("shell exited", false)
        case .closed: return ("disconnected", true)
        case .error(let message): return (message, true)
        }
    }

    /// Presented over the whole window rather than as a sheet. That is how it is
    /// shown where the system can arrange it around a fold.
    var fullScreen = false

    var body: some View {
        layout
            .background(TerminalSheet.ground.ignoresSafeArea())
            .preferredColorScheme(.dark)
            .onDisappear { terminal.detach() }
    }

    /// The screen, and the keys a phone keyboard lacks.
    ///
    /// Two views that belong side by side or one above the other is exactly what
    /// an arrangement view is for, so where there is one (iOS 27.1) the system
    /// places them: keys under the screen when the window is tall, beside it when
    /// it is wide, and — on an iPhone Duo folded like a laptop — the screen on
    /// the upper half and the keys on the lower, with nothing in the fold. The
    /// keys ask for only the room they need, so on a flat display this is the
    /// same picture as the plain stack below.
    @ViewBuilder private var layout: some View {
        if #available(iOS 27.1, *), fullScreen {
            ArrangementView {
                screen
            } secondary: {
                ArrangedKeyPad(onKey: { terminal.send($0) }, onKeyboard: { typing.toggle() })
                    .splitArrangementFixedLayoutSize()
            }
            .arrangementViewStyle(.split)
        } else {
            VStack(spacing: 0) {
                screen
                TerminalKeyPad(column: false, onKey: { terminal.send($0) }, onKeyboard: { typing.toggle() })
            }
            .presentationDetents([.fraction(0.85)])
            .presentationDragIndicator(.visible)
        }
    }

    private var screen: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(terminal.title.isEmpty ? "terminal" : terminal.title)
                    .font(AppFont.mono(12))
                    .foregroundStyle(TerminalSheet.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(statusText.text)
                    .font(AppFont.mono(11))
                    .foregroundStyle(statusText.alarming ? Color(css: "#fca5a5") : Color(css: "#8a8178"))
                    .lineLimit(1)
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(TerminalSheet.ink)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close terminal")
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.top, 8)
            .padding(.bottom, 2)

            GeometryReader { proxy in
                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(terminal.lines.enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .lineLimit(1)
                                    .frame(height: LiveTerminal.lineHeight, alignment: .leading)
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            Color.clear.frame(height: 1).id(TerminalSheet.end)
                                .onAppear { pinned = true }
                                .onDisappear { pinned = false }
                        }
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .defaultScrollAnchor(.bottom)
                    .foregroundStyle(TerminalSheet.ink)
                    // Tapping the screen is asking for the keyboard.
                    .contentShape(Rectangle())
                    .onTapGesture { typing = true }
                    .onChange(of: terminal.version) { _, _ in
                        if pinned { reader.scrollTo(TerminalSheet.end, anchor: .bottom) }
                    }
                }
                // The shell is told the size of the screen it actually has, and
                // told again whenever that changes: a rotation, a fold, the
                // other app in Split View being given more room.
                .onAppear { attach(proxy.size) }
                .onChange(of: proxy.size) { _, size in attach(size) }
            }

            TerminalKeyboard(focused: $typing, onText: { terminal.send($0) }).frame(width: 0, height: 0)
        }
    }

    private func attach(_ size: CGSize) {
        guard let seam = model.seam, size.width > 0, size.height > 0 else { return }
        let cols = max(20, Int((size.width - 20) / LiveTerminal.cellWidth))
        let rows = max(6, Int(size.height / LiveTerminal.lineHeight))
        terminal.attach(baseUrl: seam.baseUrl, apiKey: seam.apiKey, sessionId: sessionId, cols: cols, rows: rows)
    }
}
/// The keys a phone keyboard has no key for. Ctrl-C is the one that matters —
/// it is the whole reason for typing into a terminal from a phone at all — but
/// a shell without arrows or tab is a text box.
///
/// A row under the screen, or a column beside it.
struct TerminalKeyPad: View {
    let column: Bool
    let onKey: (String) -> Void
    let onKeyboard: () -> Void

    private static let ink = Color(css: TerminalPalette.foreground)
    private static let keys: [(label: String, name: String, send: String)] = [
        ("^C", "Control C", TerminalKeys.ctrlC), ("^D", "Control D", TerminalKeys.ctrlD),
        ("esc", "Escape", TerminalKeys.escape), ("tab", "Tab", TerminalKeys.tab),
        ("↑", "Up", TerminalKeys.up), ("↓", "Down", TerminalKeys.down),
        ("←", "Left", TerminalKeys.left), ("→", "Right", TerminalKeys.right),
    ]

    var body: some View {
        Group {
            if column {
                // Two abreast, so the arrows sit as pairs and the column stays narrow.
                LazyVGrid(columns: [GridItem(.fixed(48), spacing: 6), GridItem(.fixed(48), spacing: 6)], spacing: 6) { buttons }
                    .frame(maxHeight: .infinity, alignment: .top)
                    .overlay(alignment: .leading) { Color.white.opacity(0.08).frame(width: 1).padding(.leading, -10) }
            } else {
                HStack(spacing: 6) { buttons }
                    .frame(maxHeight: .infinity, alignment: .top)
                    .overlay(alignment: .top) { Color.white.opacity(0.08).frame(height: 1).padding(.top, -8) }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    @ViewBuilder private var buttons: some View {
        ForEach(TerminalKeyPad.keys, id: \.label) { key in
            Button { onKey(key.send) } label: { cap { Text(key.label).font(AppFont.mono(12)) } }
                .buttonStyle(.plain)
                .accessibilityLabel(key.name)
        }
        Button(action: onKeyboard) { cap { Image(systemName: "keyboard").font(.system(size: 13)) } }
            .buttonStyle(.plain)
            .accessibilityLabel("Type a command")
    }

    private func cap(@ViewBuilder _ label: () -> some View) -> some View {
        label()
            .foregroundStyle(TerminalKeyPad.ink)
            .frame(maxWidth: .infinity, minHeight: column ? 44 : 36)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.sm))
            .contentShape(Rectangle())
    }
}

/// The key pad inside an arrangement: a row when it is placed under the screen,
/// a column when it is placed beside it.
@available(iOS 27.1, *)
private struct ArrangedKeyPad: View {
    let onKey: (String) -> Void
    let onKeyboard: () -> Void
    @Environment(\.splitArrangementAxis) private var axis

    var body: some View {
        TerminalKeyPad(column: axis == .horizontal, onKey: onKey, onKeyboard: onKeyboard)
    }
}
#endif

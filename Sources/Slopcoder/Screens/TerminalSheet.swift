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

    var body: some View {
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
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Close terminal")
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)

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
                .onAppear { attach(proxy.size) }
                .onChange(of: proxy.size) { _, size in attach(size) }
            }

            keyRow
            TerminalKeyboard(focused: $typing, onText: { terminal.send($0) }).frame(width: 0, height: 0)
        }
        .background(TerminalSheet.ground.ignoresSafeArea())
        .presentationDetents([.fraction(0.85)])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
        .onDisappear { terminal.detach() }
    }

    /// The keys a phone keyboard has no key for. Ctrl-C is the one that matters —
    /// it is the whole reason for typing into a terminal from a phone at all —
    /// but a shell without arrows or tab is a text box.
    private var keyRow: some View {
        let keys: [(label: String, send: String)] = [
            ("^C", TerminalKeys.ctrlC), ("^D", TerminalKeys.ctrlD), ("esc", TerminalKeys.escape), ("tab", TerminalKeys.tab),
            ("↑", TerminalKeys.up), ("↓", TerminalKeys.down), ("←", TerminalKeys.left), ("→", TerminalKeys.right),
        ]
        return HStack(spacing: 6) {
            ForEach(keys, id: \.label) { key in
                Button { terminal.send(key.send) } label: {
                    Text(key.label)
                        .font(AppFont.mono(12))
                        .foregroundStyle(TerminalSheet.ink)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.sm))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(key.label)
            }
            Button { typing.toggle() } label: {
                Image(systemName: "keyboard")
                    .font(.system(size: 13))
                    .foregroundStyle(TerminalSheet.ink)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.sm))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Type a command")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .overlay(alignment: .top) { Color.white.opacity(0.08).frame(height: 1) }
    }

    private func attach(_ size: CGSize) {
        guard let seam = model.seam, size.width > 0, size.height > 0 else { return }
        let cols = max(20, Int((size.width - 20) / LiveTerminal.cellWidth))
        let rows = max(6, Int(size.height / LiveTerminal.lineHeight))
        terminal.attach(baseUrl: seam.baseUrl, apiKey: seam.apiKey, sessionId: sessionId, cols: cols, rows: rows)
    }
}
#endif

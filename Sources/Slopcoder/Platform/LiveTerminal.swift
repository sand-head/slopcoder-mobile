#if canImport(UIKit)
import Foundation
import Observation
import SlopcoderCore
import SwiftUI
import UIKit

/// A live terminal for one session: the socket, the grid, and the repainting.
///
/// The screen state lives in a `TerminalEmulator` held here, not in view state.
/// A PTY emits bytes far faster than a phone can lay out — a package install is
/// thousands of writes a second — so the bytes go straight into the grid and the
/// view is told, at most once per `repaintMs`, that *something* changed.
///
/// The connection is opened when the sheet appears and closed when it goes away.
/// That is cheap on purpose: the shell belongs to the server, so closing the
/// socket detaches rather than kills, and re-opening replays the scrollback the
/// server kept.
@MainActor
@Observable
final class LiveTerminal {
    /// How often the screen is handed to the view, at most. Not per frame: a
    /// 120Hz phone would flatten the whole grid a hundred and twenty times a
    /// second during a build, for output nobody can read at that rate anyway.
    private static let repaintMs: UInt64 = 60

    private(set) var status = TerminalStatus.connecting
    private(set) var lines: [AttributedString] = []
    private(set) var title = ""
    /// Bumped on every repaint, for a view that wants to follow the tail.
    private(set) var version = 0

    @ObservationIgnored private var emulator = TerminalEmulator(cols: 80, rows: 24)
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var pump: Task<Void, Never>?
    @ObservationIgnored private var repaintPending = false
    @ObservationIgnored private var size: (cols: Int, rows: Int)?

    static let fontSize: CGFloat = 11
    static let lineHeight: CGFloat = 15

    /// One cell's width in the bundled mono face, which is what the grid is cut to.
    static let cellWidth: CGFloat = {
        let font = UIFont(name: AppFont.monoName, size: fontSize) ?? .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        return (String(repeating: "0", count: 20) as NSString).size(withAttributes: [.font: font]).width / 20
    }()

    /// Attach at a measured size. Nothing connects before the size is known: the
    /// PTY is told its width once, at attach, and the server replays the
    /// scrollback immediately — so attaching at a guessed 80×24 and correcting
    /// afterwards means every replayed line was already broken at the wrong
    /// column, and this emulator does not reflow.
    func attach(baseUrl: String, apiKey: String, sessionId: String, cols: Int, rows: Int) {
        if let size, task != nil {
            if size.cols != cols || size.rows != rows { resize(cols: cols, rows: rows) }
            return
        }
        size = (cols, rows)
        // A re-attach replays the server's scrollback from the top, so start from a
        // clean grid rather than layering it over whatever was last on screen.
        emulator = TerminalEmulator(cols: cols, rows: rows)
        status = .connecting
        paint()

        guard let url = URL(string: terminalUrl(baseUrl: baseUrl, sessionId: sessionId, cols: cols, rows: rows)) else {
            status = .error(message: "The terminal's address could not be built.")
            return
        }
        // The credential is a header, not a query parameter: a key in a URL is a
        // key in a log.
        var request = URLRequest(url: url)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let socket = URLSession.shared.webSocketTask(with: request)
        task = socket
        socket.resume()

        pump = Task { [weak self] in
            var opened = false
            while !Task.isCancelled {
                do {
                    let message = try await socket.receive()
                    guard let self else { return }
                    if !opened {
                        opened = true
                        if self.status == .connecting { self.status = .live }
                    }
                    switch message {
                    case .data(let data):
                        self.emulator.write(data)
                        self.scheduleRepaint()
                    case .string(let text):
                        switch TerminalControl.parse(text) {
                        case .exit?: self.status = .exited
                        case .error(let message)?: self.status = .error(message: message)
                        case nil: break
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    guard let self, !Task.isCancelled else { return }
                    // An exit or a named error already said something better than "closed".
                    if self.status == .live || self.status == .connecting { self.status = .closed }
                    self.task = nil
                    return
                }
            }
        }
    }

    private func resize(cols: Int, rows: Int) {
        size = (cols, rows)
        emulator.resize(cols: cols, rows: rows)
        // A resize is sent down the open socket, never a reconnect.
        task?.send(.string(TerminalControl.resize(cols: cols, rows: rows))) { _ in }
        paint()
    }

    /// Typed text, or one of `TerminalKeys`.
    func send(_ text: String) {
        guard let task, status == .live else { return }
        task.send(.data(Data(text.utf8))) { _ in }
    }

    /// Detach. The shell keeps running on the server; this only stops watching.
    func detach() {
        pump?.cancel()
        pump = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        size = nil
    }

    private func scheduleRepaint() {
        if repaintPending { return }
        repaintPending = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: LiveTerminal.repaintMs * 1_000_000)
            guard let self else { return }
            self.repaintPending = false
            self.paint()
        }
    }

    /// Flatten the grid into styled lines. Walks every cell, so it happens once
    /// per repaint rather than once per view update.
    private func paint() {
        let snapshot = emulator.snapshot()
        let showCursor = snapshot.cursorVisible && status == .live
        var painted: [AttributedString] = []
        painted.reserveCapacity(snapshot.rows.count)
        for (y, spans) in snapshot.rows.enumerated() {
            painted.append(LiveTerminal.line(spans, cursorX: showCursor && y == snapshot.cursor.y ? snapshot.cursor.x : nil))
        }
        lines = painted
        title = snapshot.title
        version += 1
    }

    private static let regular = Font.custom(AppFont.monoName, fixedSize: fontSize)
    private static let bold = Font.custom(AppFont.monoSemiBoldName, fixedSize: fontSize)

    private static func line(_ spans: [TerminalSpan], cursorX: Int?) -> AttributedString {
        var out = AttributedString()
        var column = 0
        for span in spans {
            let painted = TerminalPalette.paint(span.style)
            var piece = AttributedString(span.style.hidden ? String(repeating: " ", count: span.text.unicodeScalars.count) : span.text)
            piece.font = painted.bold ? bold : regular
            piece.foregroundColor = Color(css: painted.color).opacity(painted.dim ? 0.6 : 1)
            if let background = painted.backgroundColor { piece.backgroundColor = Color(css: background) }
            if painted.underline { piece.underlineStyle = .single }
            out.append(piece)
            column += span.text.unicodeScalars.count
        }

        guard let cursorX else {
            if out.characters.isEmpty { out.append(blank(1, cursor: false)) }
            return out
        }
        // The cursor is a cell in inverse video. Past the end of the text it is
        // a block on blank cells, which have to be made for it to sit on.
        if cursorX >= column {
            if cursorX > column { out.append(blank(cursorX - column, cursor: false)) }
            out.append(blank(1, cursor: true))
            return out
        }
        var index = out.characters.startIndex
        var remaining = cursorX
        while remaining > 0, index < out.characters.endIndex {
            index = out.characters.index(after: index)
            remaining -= 1
        }
        if index < out.characters.endIndex {
            let next = out.characters.index(after: index)
            out[index..<next].foregroundColor = Color(css: TerminalPalette.background)
            out[index..<next].backgroundColor = Color(css: TerminalPalette.foreground)
        }
        return out
    }

    private static func blank(_ count: Int, cursor: Bool) -> AttributedString {
        var piece = AttributedString(String(repeating: " ", count: count))
        piece.font = regular
        if cursor { piece.backgroundColor = Color(css: TerminalPalette.foreground) }
        return piece
    }
}

/// A keyboard with no text field: what is typed goes to the shell as it is typed.
///
/// A `UIKeyInput` view rather than a hidden text field, because a text field
/// keeps a buffer — and everything that manages a buffer (autocorrect, the
/// suggestion bar, dictation's rewrites) is wrong for a terminal, where each
/// keystroke has already been sent.
struct TerminalKeyboard: UIViewRepresentable {
    @Binding var focused: Bool
    let onText: (String) -> Void

    func makeUIView(context: Context) -> KeyInputView {
        let view = KeyInputView()
        view.onText = onText
        return view
    }

    func updateUIView(_ view: KeyInputView, context: Context) {
        view.onText = onText
        if focused, !view.isFirstResponder {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !focused, view.isFirstResponder {
            DispatchQueue.main.async { view.resignFirstResponder() }
        }
    }

    final class KeyInputView: UIView, UIKeyInput, UITextInputTraits {
        var onText: ((String) -> Void)?

        var autocorrectionType: UITextAutocorrectionType = .no
        var autocapitalizationType: UITextAutocapitalizationType = .none
        var spellCheckingType: UITextSpellCheckingType = .no
        var smartQuotesType: UITextSmartQuotesType = .no
        var smartDashesType: UITextSmartDashesType = .no
        var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
        var keyboardType: UIKeyboardType = .asciiCapable
        var keyboardAppearance: UIKeyboardAppearance = .dark
        var returnKeyType: UIReturnKeyType = .send

        override var canBecomeFirstResponder: Bool { true }

        var hasText: Bool { true }

        func insertText(_ text: String) {
            // Return is a carriage return to a PTY, not a line feed.
            onText?(text == "\n" ? TerminalKeys.enter : text)
        }

        func deleteBackward() {
            onText?("\u{7f}")
        }
    }
}
#endif

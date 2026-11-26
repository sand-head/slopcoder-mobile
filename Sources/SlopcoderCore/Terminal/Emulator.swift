// A terminal, small enough to live on a phone.
//
// The other end of this is a real PTY in the session's sandbox, so what arrives
// is not text — it is a byte stream with cursor moves, colours, erases and
// scroll regions in it. Printing it as text gives you `ESC[2K` on screen and a
// progress bar that redraws down the page instead of in place. Something has to
// keep a grid and apply those bytes to it.
//
// The cockpit does this with slopterm, which is C# compiled to WebAssembly and
// paints on a canvas. What is here is the same idea at the size the job
// actually needs: enough of the VT repertoire for a shell, `git`, a build log
// and a full-screen editor, and no more. In particular there is no reflow on
// resize (xterm.js skips it too), no mouse reporting, and no double-width glyph
// handling beyond counting a codepoint as one cell.
//
// Two details that are easy to get wrong and very visible when you do:
//
// - **Wrapping is deferred.** Writing the 80th column of an 80-column line does
//   not move to the next line; it sets a pending flag, and the *next* printable
//   character wraps. Wrapping eagerly puts a blank line after every full-width
//   line, which is most of a build log.
// - **UTF-8 arrives split.** A frame boundary falls wherever it likes, so the
//   decoder holds partial sequences across `write` calls rather than emitting a
//   replacement character for each half.

import Foundation

/// A colour: nil = the theme's default, 0-255 = palette, or a packed RGB.
public typealias TerminalColor = Int?

/// How a colour carries 24 bits, above the 256-entry palette.
public let terminalRgbFlag = 0x1000000

public func packRgb(_ r: Int, _ g: Int, _ b: Int) -> Int {
    terminalRgbFlag | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

public struct TerminalStyle: Hashable, Sendable {
    public var fg: TerminalColor = nil
    public var bg: TerminalColor = nil
    public var bold = false
    public var dim = false
    public var italic = false
    public var underline = false
    public var inverse = false
    /// Concealed text (`ESC[8m`) — rendered as spaces, still selectable as such.
    public var hidden = false

    public init() {}

    public static let plain = TerminalStyle()
}

public struct TerminalCell: Hashable, Sendable {
    public var ch: Unicode.Scalar
    public var style: TerminalStyle

    static let space = TerminalCell(ch: " ", style: .plain)

    public init(ch: Unicode.Scalar, style: TerminalStyle) {
        self.ch = ch
        self.style = style
    }
}

/// A run of cells sharing one style — what a renderer actually wants.
public struct TerminalSpan: Hashable, Sendable {
    public var text: String
    public var style: TerminalStyle

    public init(text: String, style: TerminalStyle) {
        self.text = text
        self.style = style
    }
}

private func blankRow(_ cols: Int) -> [TerminalCell] {
    [TerminalCell](repeating: .space, count: cols)
}

/// One line as runs of equal style, with trailing default-styled blanks dropped.
public func spansOf(_ row: [TerminalCell]) -> [TerminalSpan] {
    var end = row.count
    while end > 0, row[end - 1] == .space { end -= 1 }

    var spans: [TerminalSpan] = []
    for cell in row[0..<end] {
        if let last = spans.indices.last, spans[last].style == cell.style {
            spans[last].text.unicodeScalars.append(cell.ch)
        } else {
            spans.append(TerminalSpan(text: String(Character(cell.ch)), style: cell.style))
        }
    }
    return spans
}

/// Parser states. OSC and DCS-alikes are consumed, not interpreted.
private enum ParserState {
    case ground, escape, csi, osc
    /// `ESC (`, `ESC )` and friends: one more byte, then back to ground.
    case charset
    /// `ESC P`/`ESC X`/`ESC ^`/`ESC _`: a string terminated the same way OSC is.
    case string
}

/// How many scrolled-off lines to keep, so the sheet can be pulled back through.
private let scrollbackLimit = 1000

public struct TerminalEmulator: Sendable {
    public private(set) var cols: Int
    public private(set) var rows: Int

    /// The visible grid, top row first.
    private var grid: [[TerminalCell]]
    /// Lines that have scrolled off the top, oldest first, bounded.
    private var history: [[TerminalCell]] = []
    /// The main screen while the alternate one is showing, else nil.
    private var savedMain: (grid: [[TerminalCell]], x: Int, y: Int)?
    private var alternate = false

    public private(set) var cursorX = 0
    public private(set) var cursorY = 0
    public private(set) var cursorVisible = true

    private var style = TerminalStyle.plain
    private var saved: (x: Int, y: Int, style: TerminalStyle)?

    /// The scrolling region, inclusive, in grid coordinates.
    private var top = 0
    private var bottom: Int

    private var wrapPending = false
    private var autoWrap = true

    private var state = ParserState.ground
    private var params: [Int] = []
    private var paramText = String.UnicodeScalarView()
    private var prefix: Unicode.Scalar?
    private var oscText = String.UnicodeScalarView()

    /// Bytes of an incomplete UTF-8 sequence, carried to the next write.
    private var partial: [UInt8] = []

    /// The window title the shell last set, for the sheet's header.
    public private(set) var title = ""

    /// Bumped on every change, so a renderer can memoize on one number.
    public private(set) var version = 0

    public init(cols: Int = 80, rows: Int = 24) {
        self.cols = max(1, cols)
        self.rows = max(1, rows)
        bottom = self.rows - 1
        grid = (0..<self.rows).map { _ in blankRow(max(1, cols)) }
    }

    /// The visible grid plus as much scrollback as is held, oldest line first.
    public var lines: [[TerminalCell]] { alternate ? grid : history + grid }

    /// Where the visible grid starts within `lines`.
    public var viewportStart: Int { alternate ? 0 : history.count }

    public mutating func reset() {
        grid = (0..<rows).map { _ in blankRow(cols) }
        history = []
        alternate = false
        savedMain = nil
        cursorX = 0
        cursorY = 0
        cursorVisible = true
        style = .plain
        saved = nil
        top = 0
        bottom = rows - 1
        wrapPending = false
        autoWrap = true
        state = .ground
        partial = []
        title = ""
        version += 1
    }

    /// Change the grid's size. Rows are clipped or padded and the cursor is
    /// clamped; nothing is reflowed, so a line longer than the new width stays
    /// cut. Reflow is the one piece of a terminal that is genuinely hard, and a
    /// sheet that is resized about twice per session does not earn it.
    public mutating func resize(cols newCols: Int, rows newRows: Int) {
        let cols = max(1, newCols)
        let rows = max(1, newRows)
        if cols == self.cols, rows == self.rows { return }

        func fit(_ grid: [[TerminalCell]]) -> [[TerminalCell]] {
            var next: [[TerminalCell]] = grid.suffix(rows).map { row in
                if row.count == cols { return row }
                if row.count > cols { return Array(row[0..<cols]) }
                return row + [TerminalCell](repeating: .space, count: cols - row.count)
            }
            while next.count < rows { next.append(blankRow(cols)) }
            return next
        }

        // Rows lost off the top of the main screen join the scrollback rather than
        // vanishing — shrinking the sheet should not eat what was just printed.
        if !alternate, self.rows > rows {
            history.append(contentsOf: grid.prefix(self.rows - rows))
            trimHistory()
        }

        grid = fit(grid)
        if let main = savedMain { savedMain = (fit(main.grid), main.x, main.y) }

        self.cols = cols
        self.rows = rows
        top = 0
        bottom = rows - 1
        cursorX = min(cursorX, cols - 1)
        cursorY = min(cursorY, rows - 1)
        wrapPending = false
        version += 1
    }

    // MARK: - the byte stream

    public mutating func write(_ bytes: [UInt8]) {
        for scalar in decode(bytes) { consume(scalar) }
        version += 1
    }

    public mutating func write(_ data: Data) {
        write([UInt8](data))
    }

    /// UTF-8, holding back the tail of a sequence that a frame boundary split.
    private mutating func decode(_ bytes: [UInt8]) -> [Unicode.Scalar] {
        let buffer = partial.isEmpty ? bytes : partial + bytes
        partial = []

        var out: [Unicode.Scalar] = []
        out.reserveCapacity(buffer.count)
        var index = 0
        while index < buffer.count {
            let byte = buffer[index]
            var length = 1
            if byte >= 0xf0 {
                length = 4
            } else if byte >= 0xe0 {
                length = 3
            } else if byte >= 0xc0 {
                length = 2
            }

            if index + length > buffer.count {
                // The rest is the start of a sequence whose tail is in the next frame.
                partial = Array(buffer[index...])
                break
            }

            if length == 1 {
                out.append(Unicode.Scalar(byte))
            } else {
                var code = UInt32(byte) & (0xff >> UInt32(length + 1))
                var valid = true
                for offset in 1..<length {
                    let continuation = buffer[index + offset]
                    if continuation & 0xc0 != 0x80 {
                        valid = false
                        break
                    }
                    code = (code << 6) | UInt32(continuation & 0x3f)
                }
                // '?' rather than U+FFFD: the bundled mono face has no replacement
                // character, and a glyph the font lacks is better as something
                // than as nothing.
                out.append(valid ? Unicode.Scalar(code) ?? "?" : "?")
            }
            index += length
        }
        return out
    }

    private mutating func consume(_ ch: Unicode.Scalar) {
        switch state {
        case .ground: ground(ch)
        case .escape: escape(ch)
        case .csi: csi(ch)
        case .osc, .string: stringPayload(ch)
        case .charset: state = .ground
        }
    }

    private mutating func ground(_ ch: Unicode.Scalar) {
        switch ch {
        case "\u{1b}":
            state = .escape
            params = []
            paramText = String.UnicodeScalarView()
            prefix = nil
        case "\r":
            cursorX = 0
            wrapPending = false
        case "\n", "\u{0b}", "\u{0c}":
            lineFeed()
        case "\u{08}":
            if wrapPending {
                wrapPending = false
            } else {
                cursorX = max(0, cursorX - 1)
            }
        case "\t":
            cursorX = min(cols - 1, (cursorX / 8 + 1) * 8)
            wrapPending = false
        case "\u{07}", "\u{0e}", "\u{0f}":
            // Bell — a phone in a pocket does not need it — and the shift codes.
            break
        default:
            if ch.value < 0x20, ch.value != 0 { return }
            print(ch)
        }
    }

    private mutating func print(_ ch: Unicode.Scalar) {
        if wrapPending {
            cursorX = 0
            lineFeed()
            wrapPending = false
        }

        if grid.indices.contains(cursorY), grid[cursorY].indices.contains(cursorX) {
            grid[cursorY][cursorX] = TerminalCell(ch: ch, style: style)
        }

        if cursorX + 1 >= cols {
            // Deferred: the line is full, but nothing wraps until the next glyph.
            if autoWrap { wrapPending = true }
        } else {
            cursorX += 1
        }
    }

    private mutating func escape(_ ch: Unicode.Scalar) {
        switch ch {
        case "[":
            state = .csi
        case "]":
            state = .osc
            oscText = String.UnicodeScalarView()
        case "P", "X", "^", "_": // DCS, SOS, PM, APC
            state = .string
            oscText = String.UnicodeScalarView()
        case "(", ")", "*", "+", "#", "%":
            state = .charset
        case "7":
            saved = (cursorX, cursorY, style)
            state = .ground
        case "8":
            restoreCursor()
            state = .ground
        case "M":
            reverseIndex()
            state = .ground
        case "D":
            lineFeed()
            state = .ground
        case "E":
            cursorX = 0
            lineFeed()
            state = .ground
        case "c":
            reset()
        default:
            state = .ground
        }
    }

    /// OSC and the other string escapes: swallow to BEL or ST, keep the title.
    private mutating func stringPayload(_ ch: Unicode.Scalar) {
        if ch == "\u{07}" || ch == "\u{9c}" {
            endString()
            return
        }
        // ST is ESC \ — the ESC lands here, and the backslash right after it.
        if ch == "\u{1b}" {
            oscText.append(ch)
            return
        }
        if ch == "\\", oscText.last == "\u{1b}" {
            oscText.removeLast()
            endString()
            return
        }
        if oscText.count < 2048 { oscText.append(ch) }
    }

    private mutating func endString() {
        if state == .osc {
            // 0 = icon + title, 1 = icon, 2 = title. Only the title is shown.
            let text = String(oscText)
            if let semicolon = text.unicodeScalars.firstIndex(of: ";") {
                let code = String(text.unicodeScalars[..<semicolon])
                if code == "0" || code == "2" {
                    title = String(text.unicodeScalars[text.unicodeScalars.index(after: semicolon)...])
                }
            }
        }
        oscText = String.UnicodeScalarView()
        state = .ground
    }

    private mutating func csi(_ ch: Unicode.Scalar) {
        let code = ch.value
        if (0x30...0x3f).contains(code) {
            // Parameter bytes, including the ?/</=/> private prefixes.
            if paramText.isEmpty, ch == "?" || ch == "<" || ch == "=" || ch == ">" {
                prefix = ch
            } else {
                paramText.append(ch)
            }
            return
        }
        if (0x20...0x2f).contains(code) { return } // intermediates: ignored

        params = String(paramText).jsSplit(";").map { SettingsLogic.parseInt($0) ?? 0 }
        dispatch(ch)
        state = .ground
        params = []
        paramText = String.UnicodeScalarView()
        prefix = nil
    }

    private func param(_ index: Int, _ fallback: Int) -> Int {
        guard params.indices.contains(index), params[index] != 0 else { return fallback }
        return params[index]
    }

    private func rawParam(_ index: Int) -> Int {
        params.indices.contains(index) ? params[index] : 0
    }

    private mutating func dispatch(_ final: Unicode.Scalar) {
        switch final {
        case "A":
            cursorY = max(top, cursorY - param(0, 1))
            wrapPending = false
        case "B":
            cursorY = min(bottom, cursorY + param(0, 1))
            wrapPending = false
        case "C":
            cursorX = min(cols - 1, cursorX + param(0, 1))
            wrapPending = false
        case "D":
            cursorX = max(0, cursorX - param(0, 1))
            wrapPending = false
        case "E":
            cursorX = 0
            cursorY = min(bottom, cursorY + param(0, 1))
        case "F":
            cursorX = 0
            cursorY = max(top, cursorY - param(0, 1))
        case "G", "`":
            cursorX = min(cols - 1, param(0, 1) - 1)
            wrapPending = false
        case "d":
            cursorY = min(rows - 1, param(0, 1) - 1)
            wrapPending = false
        case "H", "f":
            cursorY = min(rows - 1, param(0, 1) - 1)
            cursorX = min(cols - 1, param(1, 1) - 1)
            wrapPending = false
        case "J": eraseDisplay(rawParam(0))
        case "K": eraseLine(rawParam(0))
        case "L": insertLines(param(0, 1))
        case "M": deleteLines(param(0, 1))
        case "P": deleteChars(param(0, 1))
        case "@": insertChars(param(0, 1))
        case "X": eraseChars(param(0, 1))
        case "S": scrollUp(param(0, 1))
        case "T": scrollDown(param(0, 1))
        case "m": sgr()
        case "r":
            let newTop = max(0, param(0, 1) - 1)
            let newBottom = min(rows - 1, param(1, rows) - 1)
            if newTop < newBottom {
                top = newTop
                bottom = newBottom
                cursorX = 0
                cursorY = newTop
            }
        case "h": setMode(true)
        case "l": setMode(false)
        case "s": saved = (cursorX, cursorY, style)
        case "u": restoreCursor()
        default:
            break // device reports and the rest: nothing to answer with
        }
        // A hostile or confused stream must not be able to walk the cursor off
        // the grid: every later write indexes with it.
        cursorX = min(max(0, cursorX), cols - 1)
        cursorY = min(max(0, cursorY), rows - 1)
    }

    private mutating func setMode(_ on: Bool) {
        guard prefix == "?" else { return }
        for mode in params {
            switch mode {
            case 7: autoWrap = on
            case 25: cursorVisible = on
            case 47, 1047, 1049: setAlternate(on, withCursor: mode == 1049)
            default: break // bracketed paste, mouse reporting: accepted and ignored
            }
        }
    }

    /// The alternate screen: a full-screen program (an editor, `less`, `htop`)
    /// gets its own grid and the main one comes back untouched underneath. Without
    /// this, quitting vim leaves the editor's last frame in the scrollback.
    private mutating func setAlternate(_ on: Bool, withCursor: Bool) {
        if on {
            if alternate { return }
            savedMain = (grid, cursorX, cursorY)
            alternate = true
            grid = (0..<rows).map { _ in blankRow(cols) }
            if withCursor {
                cursorX = 0
                cursorY = 0
            }
            return
        }

        guard alternate, let main = savedMain else { return }
        grid = main.grid
        if withCursor {
            cursorX = main.x
            cursorY = main.y
        }
        alternate = false
        savedMain = nil
    }

    private mutating func restoreCursor() {
        guard let saved else { return }
        cursorX = min(cols - 1, saved.x)
        cursorY = min(rows - 1, saved.y)
        style = saved.style
        wrapPending = false
    }

    // MARK: - the grid

    private mutating func lineFeed() {
        if cursorY == bottom {
            scrollUp(1)
        } else if cursorY < rows - 1 {
            cursorY += 1
        }
        wrapPending = false
    }

    private mutating func reverseIndex() {
        if cursorY == top {
            scrollDown(1)
        } else if cursorY > 0 {
            cursorY -= 1
        }
    }

    /// Removes the row at `at` and puts a blank one in at `insertAt`, which is
    /// every scroll, insert and delete there is.
    ///
    /// The count is capped where more would change nothing: past the grid's
    /// height every row is already blank, and past that plus the scrollback's
    /// limit so is all the history a scroll can leave behind. `ESC[999999999S`
    /// is one sequence, and must not be a billion iterations.
    private mutating func shift(_ count: Int, remove at: Int, insert insertAt: Int, keepHistory: Bool = false) {
        guard grid.indices.contains(at), insertAt >= 0, insertAt < grid.count else { return }
        let limit = keepHistory ? rows + scrollbackLimit : rows
        for _ in 0..<min(max(0, count), limit) {
            let gone = grid.remove(at: at)
            if keepHistory { history.append(gone) }
            grid.insert(blankRow(cols), at: min(insertAt, grid.count))
        }
    }

    private mutating func scrollUp(_ count: Int) {
        // Only the main screen keeps history, and only when the region is the
        // whole screen: a line scrolled out of a `less` pane is not scrollback.
        shift(count, remove: top, insert: bottom, keepHistory: !alternate && top == 0 && bottom == rows - 1)
        trimHistory()
    }

    private mutating func scrollDown(_ count: Int) {
        shift(count, remove: bottom, insert: top)
    }

    private mutating func trimHistory() {
        if history.count > scrollbackLimit { history.removeFirst(history.count - scrollbackLimit) }
    }

    private mutating func eraseDisplay(_ mode: Int) {
        if mode == 2 || mode == 3 {
            for y in grid.indices { grid[y] = blankRow(cols) }
            return
        }
        if mode == 1 {
            for y in 0..<min(cursorY, grid.count) { grid[y] = blankRow(cols) }
            eraseLine(1)
            return
        }
        eraseLine(0)
        if cursorY + 1 < grid.count {
            for y in (cursorY + 1)..<grid.count { grid[y] = blankRow(cols) }
        }
    }

    private mutating func eraseLine(_ mode: Int) {
        guard grid.indices.contains(cursorY) else { return }
        let from = mode == 0 ? cursorX : 0
        let to = min(mode == 1 ? cursorX : cols - 1, grid[cursorY].count - 1)
        if from <= to { for x in from...to { grid[cursorY][x] = .space } }
    }

    private mutating func eraseChars(_ count: Int) {
        guard grid.indices.contains(cursorY) else { return }
        let end = min(grid[cursorY].count, cursorX + count)
        if cursorX < end { for x in cursorX..<end { grid[cursorY][x] = .space } }
    }

    private mutating func deleteChars(_ count: Int) {
        guard grid.indices.contains(cursorY), cursorX < grid[cursorY].count else { return }
        let removed = min(count, grid[cursorY].count - cursorX)
        grid[cursorY].removeSubrange(cursorX..<(cursorX + removed))
        grid[cursorY].append(contentsOf: [TerminalCell](repeating: .space, count: cols - grid[cursorY].count))
    }

    private mutating func insertChars(_ count: Int) {
        guard grid.indices.contains(cursorY), cursorX <= grid[cursorY].count else { return }
        let inserted = min(count, cols)
        grid[cursorY].insert(contentsOf: [TerminalCell](repeating: .space, count: inserted), at: cursorX)
        grid[cursorY].removeLast(grid[cursorY].count - cols)
    }

    private mutating func insertLines(_ count: Int) {
        if cursorY < top || cursorY > bottom { return }
        shift(count, remove: bottom, insert: cursorY)
    }

    private mutating func deleteLines(_ count: Int) {
        if cursorY < top || cursorY > bottom { return }
        shift(count, remove: cursorY, insert: bottom)
    }

    // MARK: - colours and attributes

    private mutating func sgr() {
        let params = self.params.isEmpty ? [0] : self.params
        var style = self.style

        var index = 0
        while index < params.count {
            let p = params[index]
            switch p {
            case 0: style = .plain
            case 1: style.bold = true
            case 2: style.dim = true
            case 3: style.italic = true
            case 4: style.underline = true
            case 7: style.inverse = true
            case 8: style.hidden = true
            case 22:
                style.bold = false
                style.dim = false
            case 23: style.italic = false
            case 24: style.underline = false
            case 27: style.inverse = false
            case 28: style.hidden = false
            case 30...37: style.fg = p - 30
            case 39: style.fg = nil
            case 40...47: style.bg = p - 40
            case 49: style.bg = nil
            case 90...97: style.fg = p - 90 + 8
            case 100...107: style.bg = p - 100 + 8
            case 38, 48:
                let extended = extendedColor(params, index)
                if p == 38 {
                    style.fg = extended.color
                } else {
                    style.bg = extended.color
                }
                index = extended.next
            default: break
            }
            index += 1
        }

        self.style = style
    }

    /// `38;5;n` (palette) and `38;2;r;g;b` (direct), returning the index consumed.
    private func extendedColor(_ params: [Int], _ index: Int) -> (color: TerminalColor, next: Int) {
        func at(_ offset: Int) -> Int { params.indices.contains(index + offset) ? params[index + offset] : 0 }
        guard params.indices.contains(index + 1) else { return (nil, index + 1) }
        if params[index + 1] == 5 { return (at(2), index + 2) }
        if params[index + 1] == 2 { return (packRgb(at(2), at(3), at(4)), index + 4) }
        return (nil, index + 1)
    }
}

// MARK: - what a screen draws

public struct TerminalCursor: Equatable, Sendable {
    public var x: Int
    public var y: Int

    public init(x: Int, y: Int) {
        self.x = x
        self.y = y
    }
}

/// The grid flattened for drawing: the scrollback's tail plus the live screen.
public struct TerminalSnapshot: Equatable, Sendable {
    /// What to draw, newest last.
    public var rows: [[TerminalSpan]]
    /// Where the cursor is within `rows`.
    public var cursor: TerminalCursor
    public var cursorVisible: Bool
    public var title: String
    public var version: Int

    public init(rows: [[TerminalSpan]], cursor: TerminalCursor, cursorVisible: Bool, title: String, version: Int) {
        self.rows = rows
        self.cursor = cursor
        self.cursorVisible = cursorVisible
        self.title = title
        self.version = version
    }
}

extension TerminalEmulator {
    /// How much scrolled-off output a sheet renders behind the live screen.
    ///
    /// Every line is a row in a scroll view, so this is a budget, not a limit on
    /// what the emulator keeps (it holds far more). Two hundred is roughly eight
    /// screenfuls on a phone — enough to find the command that failed, few enough
    /// that presenting the sheet is instant.
    public static let visibleScrollback = 200

    public func snapshot(visibleScrollback: Int = TerminalEmulator.visibleScrollback) -> TerminalSnapshot {
        let all = lines
        let from = max(0, viewportStart - visibleScrollback)
        return TerminalSnapshot(
            rows: all[from...].map(spansOf),
            cursor: TerminalCursor(x: cursorX, y: viewportStart - from + cursorY),
            cursorVisible: cursorVisible,
            title: title,
            version: version
        )
    }
}

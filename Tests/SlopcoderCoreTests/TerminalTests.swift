// The terminal emulator, which is the part of the shake-to-open sheet that can
// actually be wrong without anyone noticing.
//
// A missed escape sequence does not throw; it prints `[2K` into the log, or
// leaves a progress bar drawing down the page, or puts the cursor a column off
// so the next command echoes over the prompt. Every case below is a shape that
// really comes out of a shell in this app's sandbox: `git`'s colour, `npm`'s
// carriage-return redraw, an editor taking the alternate screen, a UTF-8
// character split across two WebSocket frames.

import Foundation
import Testing
@testable import SlopcoderCore

private func bytes(_ text: String) -> [UInt8] { Array(text.utf8) }

/// One row as plain text, trailing blanks trimmed — what the reader would see.
private func line(_ term: TerminalEmulator, _ y: Int) -> String {
    spansOf(term.lines[term.viewportStart + y]).map(\.text).joined()
}

private func screen(_ term: TerminalEmulator) -> [String] {
    (0..<term.rows).map { line(term, $0) }
}

@Suite struct TerminalEmulatorTests {
    @Test func laysCharactersOutAndTracksTheCursor() {
        var term = TerminalEmulator(cols: 20, rows: 4)
        term.write(bytes("hello"))
        #expect(line(term, 0) == "hello")
        #expect(term.cursorX == 5)
        #expect(term.cursorY == 0)
    }

    @Test func carriageReturnRewritesTheLineInPlace() {
        // Which is how a progress bar works.
        var term = TerminalEmulator(cols: 20, rows: 4)
        term.write(bytes("50%\r100%"))
        #expect(line(term, 0) == "100%")
        #expect(screen(term)[1] == "")
    }

    @Test func wrapsOnTheCharacterAfterTheLastColumnNotOnTheLastColumn() {
        // Wrapping eagerly puts a blank line after every full-width line, which in
        // a build log is most of them.
        var term = TerminalEmulator(cols: 5, rows: 3)
        term.write(bytes("abcde"))
        #expect(line(term, 0) == "abcde")
        #expect(term.cursorY == 0)
        term.write(bytes("f"))
        #expect(line(term, 1) == "f")
        #expect(term.cursorY == 1)
    }

    @Test func backspaceAndTab() {
        var term = TerminalEmulator(cols: 10, rows: 2)
        term.write(bytes("abc\u{08} \u{08}"))
        #expect(line(term, 0) == "ab")

        var wide = TerminalEmulator(cols: 40, rows: 2)
        wide.write(bytes("a\tb"))
        #expect(line(wide, 0) == "a       b")
    }

    @Test func erases() {
        var term = TerminalEmulator(cols: 20, rows: 3)
        term.write(bytes("noise\u{1b}[2Kdone"))
        // The cursor did not move, so "done" lands where "noise" ended.
        #expect(line(term, 0) == "     done")

        var toEnd = TerminalEmulator(cols: 20, rows: 3)
        toEnd.write(bytes("abcdef\r\u{1b}[3C\u{1b}[K"))
        #expect(line(toEnd, 0) == "abc")

        var cleared = TerminalEmulator(cols: 10, rows: 3)
        cleared.write(bytes("one\r\ntwo\r\nthree"))
        cleared.write(bytes("\u{1b}[2J\u{1b}[Hfresh"))
        #expect(screen(cleared) == ["fresh", "", ""])

        var placed = TerminalEmulator(cols: 10, rows: 3)
        placed.write(bytes("\u{1b}[2;3Hx"))
        #expect(screen(placed) == ["", "  x", ""])
    }

    @Test func keepsLinesThatScrollOffTheTop() {
        var term = TerminalEmulator(cols: 10, rows: 2)
        term.write(bytes("one\r\ntwo\r\nthree"))
        #expect(screen(term) == ["two", "three"])
        #expect(term.lines.map { spansOf($0).map(\.text).joined() } == ["one", "two", "three"])
    }

    @Test func honoursAScrollRegionAndDoesNotCallItsLinesScrollback() {
        var term = TerminalEmulator(cols: 10, rows: 4)
        term.write(bytes("a\r\nb\r\nc\r\nd"))
        // Rows 1-3 scroll; row 0 is a header the program is keeping.
        term.write(bytes("\u{1b}[2;4r\u{1b}[4;1He\r\nf"))
        #expect(screen(term)[0] == "a")
        #expect(screen(term)[3] == "f")
        // 'a' is still on screen, so nothing new joined the history.
        #expect(term.viewportStart == 0)
    }

    @Test func insertsAndDeletesLines() {
        var term = TerminalEmulator(cols: 10, rows: 4)
        term.write(bytes("a\r\nb\r\nc"))
        term.write(bytes("\u{1b}[2;1H\u{1b}[L"))
        #expect(screen(term) == ["a", "", "b", "c"])
        term.write(bytes("\u{1b}[2;1H\u{1b}[M"))
        #expect(screen(term) == ["a", "b", "c", ""])
    }

    @Test func theAlternateScreenIsItsOwnGridAndHandsTheOldOneBack() {
        var term = TerminalEmulator(cols: 10, rows: 3)
        term.write(bytes("before"))
        term.write(bytes("\u{1b}[?1049h\u{1b}[2J\u{1b}[Hvim"))
        #expect(screen(term)[0] == "vim")
        term.write(bytes("\u{1b}[?1049l"))
        #expect(screen(term)[0] == "before")

        var quiet = TerminalEmulator(cols: 10, rows: 2)
        quiet.write(bytes("\u{1b}[?1049h"))
        quiet.write(bytes("one\r\ntwo\r\nthree"))
        #expect(quiet.viewportStart == 0)
        #expect(quiet.lines.count == 2)
    }

    @Test func readsColours() {
        var term = TerminalEmulator(cols: 20, rows: 2)
        term.write(bytes("\u{1b}[31mred\u{1b}[0m plain"))
        let spans = spansOf(term.lines[0])
        #expect(spans[0].text == "red")
        #expect(spans[0].style.fg == 1)
        #expect(spans[1].text == " plain")
        #expect(spans[1].style == .plain)

        var extended = TerminalEmulator(cols: 20, rows: 2)
        extended.write(bytes("\u{1b}[38;5;208mo\u{1b}[38;2;10;20;30mt"))
        let coloured = spansOf(extended.lines[0])
        #expect(coloured[0].style.fg == 208)
        #expect(coloured[1].style.fg == packRgb(10, 20, 30))
    }

    @Test func paintsBoldAsTheBrightTwinAndInverseBySwapping() {
        // Programs lean on this: a bold-red error is meant to be the light red.
        var red = TerminalStyle()
        red.fg = 1
        var boldRed = red
        boldRed.bold = true
        var bright = TerminalStyle()
        bright.fg = 9
        #expect(TerminalPalette.paint(boldRed).color != TerminalPalette.paint(red).color)
        #expect(TerminalPalette.paint(boldRed).color == TerminalPalette.paint(bright).color)

        var inverse = TerminalStyle()
        inverse.inverse = true
        #expect(TerminalPalette.paint(inverse).backgroundColor == TerminalPalette.foreground)
    }

    @Test func holdsAUTF8CharacterSplitAcrossTwoFrames() {
        var term = TerminalEmulator(cols: 10, rows: 2)
        let encoded = bytes("é👍")
        for byte in encoded { term.write([byte]) }
        #expect(line(term, 0) == "é👍")
    }

    @Test func takesTheTitleFromAnOSCSequenceAndSwallowsTheRest() {
        var term = TerminalEmulator(cols: 20, rows: 2)
        term.write(bytes("\u{1b}]0;~/slopcoder\u{07}ready"))
        #expect(term.title == "~/slopcoder")
        #expect(line(term, 0) == "ready")

        var st = TerminalEmulator(cols: 20, rows: 2)
        st.write(bytes("\u{1b}]2;title\u{1b}\\ok"))
        #expect(st.title == "title")
        #expect(line(st, 0) == "ok")
    }

    @Test func ignoresSequencesItHasNoAnswerForInsteadOfPrintingThem() {
        var term = TerminalEmulator(cols: 20, rows: 2)
        term.write(bytes("\u{1b}[6n\u{1b}[?2004hprompt"))
        #expect(line(term, 0) == "prompt")
    }

    @Test func resizingClipsAndPadsWithoutLosingWhatScrolledPast() {
        var term = TerminalEmulator(cols: 10, rows: 3)
        term.write(bytes("one\r\ntwo\r\nthree"))
        term.resize(cols: 10, rows: 2)
        #expect(screen(term) == ["two", "three"])
        #expect(term.lines.count == 3)
        term.resize(cols: 10, rows: 4)
        #expect(screen(term) == ["two", "three", "", ""])
    }

    @Test func aSnapshotCarriesTheTailOfTheScrollbackAndPlacesTheCursorInIt() {
        var term = TerminalEmulator(cols: 10, rows: 2)
        term.write(bytes((1...6).map { "l\($0)" }.joined(separator: "\r\n")))
        let snapshot = term.snapshot(visibleScrollback: 3)
        #expect(snapshot.rows.map { $0.map(\.text).joined() } == ["l2", "l3", "l4", "l5", "l6"])
        #expect(snapshot.cursor == TerminalCursor(x: 2, y: 4))
    }

    /// Bytes nothing well-behaved sends. Swift traps where JavaScript shrugs, so
    /// "never crashes" has to be shown rather than assumed.
    @Test func survivesGarbage() {
        var generator = SystemRandomNumberGenerator()
        for _ in 0..<300 {
            var term = TerminalEmulator(cols: Int.random(in: 1...12, using: &generator), rows: Int.random(in: 1...6, using: &generator))
            for _ in 0..<40 {
                let chunk = (0..<Int.random(in: 1...24, using: &generator)).map { _ -> UInt8 in
                    let roll = Int.random(in: 0..<10, using: &generator)
                    if roll < 3 { return 0x1b }
                    if roll < 6 { return UInt8.random(in: 0x30...0x7e, using: &generator) }
                    return UInt8.random(in: 0...255, using: &generator)
                }
                term.write(chunk)
                if Int.random(in: 0..<12, using: &generator) == 0 {
                    term.resize(cols: Int.random(in: 0...15, using: &generator), rows: Int.random(in: 0...8, using: &generator))
                }
            }
            let snapshot = term.snapshot()
            #expect(term.cursorX >= 0 && term.cursorX < term.cols)
            #expect(term.cursorY >= 0 && term.cursorY < term.rows)
            #expect(snapshot.rows.count >= term.rows)
        }
    }

    // MARK: the wire

    @Test func turnsTheSeamBaseURLIntoAWebSocketOne() {
        #expect(websocketUrl(baseUrl: "https://slop.example/", path: "ws/session/1/terminal") == "wss://slop.example/ws/session/1/terminal")
        #expect(websocketUrl(baseUrl: "http://127.0.0.1:5199", path: "/ws/x") == "ws://127.0.0.1:5199/ws/x")
        #expect(terminalUrl(baseUrl: "https://s", sessionId: "abc", cols: 80, rows: 24) == "wss://s/ws/session/abc/terminal?cols=80&rows=24")
    }

    @Test func readsTheControlFramesTheServerSendsAndNothingElse() {
        #expect(TerminalControl.parse(#"{"t":"exit"}"#) == .exit)
        #expect(TerminalControl.parse(#"{"t":"error","msg":"no container"}"#) == .error(message: "no container"))
        #expect(TerminalControl.parse("not json") == nil)
        #expect(TerminalControl.parse(#"{"t":"something-new"}"#) == nil)
        #expect(JSONValue.parse(TerminalControl.resize(cols: 80, rows: 24)) == ["t": "resize", "cols": 80, "rows": 24])
    }

    @Test func sendsControlCharactersAsTheSingleBytesAPTYExpects() {
        #expect(bytes(TerminalKeys.ctrlC) == [3])
        #expect(bytes(TerminalKeys.up) == [0x1b, 0x5b, 0x41])
        #expect(bytes("é") == [0xc3, 0xa9])
    }
}

private func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        out.append(UInt8(hex[index..<next], radix: 16) ?? 0)
        index = next
    }
    return out
}

@Suite struct TerminalDifferentialTests {
    /// 240 fuzzed sessions — text, escapes, resizes, resets, frames split at
    /// random bytes — and the screen, cursor, colours and title the TypeScript
    /// emulator this one replaced ended each of them on.
    @Test func endsEverySessionOnTheSameScreenAsTheEmulatorItReplaced() throws {
        let cases = try #require(JSONValue.parse(try fixture("terminal-differential.json"))?.array)
        #expect(cases.count == 240)
        var failures = 0
        for (number, item) in cases.enumerated() {
            var term = TerminalEmulator(cols: item["cols"].intValue, rows: item["rows"].intValue)
            for op in item["ops"].arrayValue {
                if let hex = op["w"].string {
                    term.write(hexBytes(hex))
                } else if let size = op["resize"].array {
                    term.resize(cols: size[0].intValue, rows: size[1].intValue)
                } else {
                    term.reset()
                }
            }

            let lines: [JSONValue] = term.lines.map { row in
                .array(spansOf(row).map { span in
                    let style = span.style
                    let flags = (style.bold ? 1 : 0) | (style.dim ? 2 : 0) | (style.italic ? 4 : 0)
                        | (style.underline ? 8 : 0) | (style.inverse ? 16 : 0) | (style.hidden ? 32 : 0)
                    let painted = TerminalPalette.paint(style)
                    return [
                        .string(span.text), style.fg.map { .number(Double($0)) } ?? .null, style.bg.map { .number(Double($0)) } ?? .null,
                        .number(Double(flags)), .string(painted.color), painted.backgroundColor.map(JSONValue.string) ?? .null,
                    ]
                })
            }
            let got: JSONValue = [
                "cols": .number(Double(term.cols)), "rows": .number(Double(term.rows)), "x": .number(Double(term.cursorX)),
                "y": .number(Double(term.cursorY)), "visible": .bool(term.cursorVisible), "title": .string(term.title),
                "start": .number(Double(term.viewportStart)), "lines": .array(lines),
            ]
            if got != item["expected"] {
                failures += 1
                if failures <= 5 {
                    let want = item["expected"]
                    let differing = ["cols", "rows", "x", "y", "visible", "title", "start", "lines"].filter { got[$0] != want[$0] }
                    Issue.record("session \(number): differs in \(differing)\n   got: \(got.serialized().prefix(500))\n  want: \(want.serialized().prefix(500))")
                }
            }
        }
        #expect(failures == 0)
    }
}

// Markdown, as far as an agent writes it.
//
// Replies arrive as markdown and four screens render it: the transcript and its
// streaming tail, a routine's answer, a sub-session's reply, an artifact. The
// parsing is here rather than in the views for the usual reason — it can be
// wrong in ways nobody notices on a simulator, and here it can be tested — and
// for one particular to this app: a partner's name has to be tinted wherever
// the prose says it, which means owning the text runs rather than handing the
// string to the system and getting an attributed blob back.
//
// It is not all of CommonMark. It is what models write: headings, paragraphs,
// lists (nested, ordered, task), fenced code, quotes, tables, rules; and inside
// them emphasis, code, links, images and bare URLs. Anything it does not
// understand stays as the text it was, which is the right failure for prose.
//
// Streaming matters: the tail is re-parsed as it grows, so an unclosed fence or
// a half-typed `**` must read as what it is so far rather than swallow the rest.

import Foundation

public indirect enum MarkdownInline: Hashable, Sendable {
    case text(String)
    case code(String)
    case strong([MarkdownInline])
    case emphasis([MarkdownInline])
    case strike([MarkdownInline])
    case link(href: String, children: [MarkdownInline])
    case image(alt: String, source: String)
    case lineBreak
}

public struct MarkdownListItem: Hashable, Sendable {
    /// Nil for an ordinary item; true or false for `- [x]` / `- [ ]`.
    public var checked: Bool?
    public var blocks: [MarkdownBlock]

    public init(checked: Bool? = nil, blocks: [MarkdownBlock]) {
        self.checked = checked
        self.blocks = blocks
    }
}

public enum MarkdownAlignment: Hashable, Sendable { case leading, center, trailing }

public indirect enum MarkdownBlock: Hashable, Sendable {
    case paragraph([MarkdownInline])
    case heading(level: Int, [MarkdownInline])
    case code(language: String, text: String)
    case quote([MarkdownBlock])
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case table(header: [[MarkdownInline]], alignments: [MarkdownAlignment], rows: [[[MarkdownInline]]])
    case rule
}

public enum Markdown {
    public static func parse(_ source: String) -> [MarkdownBlock] {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var parser = BlockParser(lines: normalized.split(separator: "\n", omittingEmptySubsequences: false).map(expandTabs))
        return parser.parseBlocks()
    }

    /// The text of a run of inlines, with the markup gone: for a table cell's
    /// width, an accessibility label, a copy.
    public static func plainText(_ inlines: [MarkdownInline]) -> String {
        inlines.map { inline -> String in
            switch inline {
            case .text(let text), .code(let text): return text
            case .strong(let children), .emphasis(let children), .strike(let children): return plainText(children)
            case .link(_, let children): return plainText(children)
            case .image(let alt, _): return alt
            case .lineBreak: return "\n"
            }
        }.joined()
    }

    public static func parseInline(_ text: String) -> [MarkdownInline] {
        var parser = InlineParser(Array(text.unicodeScalars))
        return parser.parse()
    }

    private static func expandTabs(_ line: Substring) -> String {
        guard line.contains("\t") else { return String(line) }
        var out = ""
        var column = 0
        for character in line {
            if character == "\t" {
                let spaces = 4 - column % 4
                out += String(repeating: " ", count: spaces)
                column += spaces
            } else {
                out.append(character)
                column += 1
            }
        }
        return out
    }
}

// MARK: - blocks

private struct BlockParser {
    let lines: [String]
    var index = 0

    init(lines: [String]) { self.lines = lines }

    private func indent(_ line: String) -> Int { line.prefix { $0 == " " }.count }

    private func isBlank(_ line: String) -> Bool { line.allSatisfy { $0 == " " } }

    mutating func parseBlocks() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) {
                index += 1
                continue
            }
            let trimmed = String(line.drop { $0 == " " })
            let leading = indent(line)

            if leading < 4, let fence = fenceOpen(trimmed) {
                blocks.append(parseFence(fence, indent: leading))
            } else if leading < 4, let heading = atxHeading(trimmed) {
                blocks.append(heading)
                index += 1
            } else if leading < 4, isRule(trimmed) {
                blocks.append(.rule)
                index += 1
            } else if leading < 4, trimmed.hasPrefix(">") {
                blocks.append(parseQuote())
            } else if leading < 4, listMarker(trimmed) != nil {
                blocks.append(parseList())
            } else if leading < 4, let table = parseTable() {
                blocks.append(table)
            } else if leading >= 4 {
                blocks.append(parseIndentedCode())
            } else {
                blocks.append(parseParagraph())
            }
        }
        return blocks
    }

    // MARK: fences

    private struct Fence {
        let marker: Character
        let length: Int
        let info: String
    }

    private func fenceOpen(_ trimmed: String) -> Fence? {
        guard let first = trimmed.first, first == "`" || first == "~" else { return nil }
        let length = trimmed.prefix { $0 == first }.count
        guard length >= 3 else { return nil }
        let info = trimmed.dropFirst(length).trimmingCharacters(in: .whitespaces)
        // A backtick fence's info string cannot itself hold a backtick: that is
        // an inline code span that happens to start a line.
        if first == "`", info.contains("`") { return nil }
        return Fence(marker: first, length: length, info: info)
    }

    private mutating func parseFence(_ fence: Fence, indent: Int) -> MarkdownBlock {
        index += 1
        var body: [String] = []
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.drop { $0 == " " }
            let run = trimmed.prefix { $0 == fence.marker }.count
            if self.indent(line) < 4, run >= fence.length, trimmed.dropFirst(run).allSatisfy({ $0 == " " }) {
                index += 1
                break
            }
            // Indentation up to the fence's own is the fence's, not the code's.
            body.append(String(line.dropFirst(min(indent, self.indent(line)))))
            index += 1
        }
        // An unclosed fence runs to the end: while a reply is streaming, that is
        // what a code block looks like.
        let language = fence.info.split(separator: " ").first.map(String.init) ?? ""
        return .code(language: language, text: body.joined(separator: "\n"))
    }

    private mutating func parseIndentedCode() -> MarkdownBlock {
        var body: [String] = []
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) {
                // Blank lines belong to the block only if code follows them.
                var next = index + 1
                while next < lines.count, isBlank(lines[next]) { next += 1 }
                guard next < lines.count, indent(lines[next]) >= 4 else { break }
                body.append("")
                index += 1
                continue
            }
            guard indent(line) >= 4 else { break }
            body.append(String(line.dropFirst(4)))
            index += 1
        }
        return .code(language: "", text: body.joined(separator: "\n"))
    }

    // MARK: leaf blocks

    private func atxHeading(_ trimmed: String) -> MarkdownBlock? {
        let level = trimmed.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else { return nil }
        let rest = trimmed.dropFirst(level)
        guard rest.isEmpty || rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // A closing run of #s is decoration.
        if let lastSpace = text.lastIndex(of: " "), text[text.index(after: lastSpace)...].allSatisfy({ $0 == "#" }) {
            text = String(text[..<lastSpace]).trimmingCharacters(in: .whitespaces)
        } else if !text.isEmpty, text.allSatisfy({ $0 == "#" }) {
            text = ""
        }
        return .heading(level: level, Markdown.parseInline(text))
    }

    private func isRule(_ trimmed: String) -> Bool {
        let marks = trimmed.filter { $0 != " " }
        guard marks.count >= 3, let first = marks.first, first == "-" || first == "*" || first == "_" else { return false }
        return marks.allSatisfy { $0 == first }
    }

    private struct Marker {
        let ordered: Bool
        let number: Int
        /// How wide the marker and the space after it are: the content's column.
        let width: Int
    }

    private func listMarker(_ trimmed: String) -> Marker? {
        guard let first = trimmed.first else { return nil }
        if first == "-" || first == "*" || first == "+" {
            let rest = trimmed.dropFirst()
            guard rest.isEmpty || rest.first == " " else { return nil }
            return Marker(ordered: false, number: 1, width: 2)
        }
        let digits = trimmed.prefix { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty, digits.count <= 9 else { return nil }
        let rest = trimmed.dropFirst(digits.count)
        guard let delimiter = rest.first, delimiter == "." || delimiter == ")" else { return nil }
        let after = rest.dropFirst()
        guard after.isEmpty || after.first == " " else { return nil }
        return Marker(ordered: true, number: Int(digits) ?? 1, width: digits.count + 2)
    }

    // MARK: containers

    private mutating func parseQuote() -> MarkdownBlock {
        var inner: [String] = []
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.drop { $0 == " " }
            if trimmed.hasPrefix(">") {
                var rest = trimmed.dropFirst()
                if rest.first == " " { rest = rest.dropFirst() }
                inner.append(String(rest))
                index += 1
            } else if !isBlank(line), !inner.isEmpty, isParagraphContinuation(line) {
                // Lazy continuation: a paragraph line without its `>`.
                inner.append(line)
                index += 1
            } else {
                break
            }
        }
        var nested = BlockParser(lines: inner)
        return .quote(nested.parseBlocks())
    }

    /// Whether a line would carry on a paragraph rather than start a block.
    private func isParagraphContinuation(_ line: String) -> Bool {
        let trimmed = String(line.drop { $0 == " " })
        if indent(line) >= 4 { return true }
        return fenceOpen(trimmed) == nil && atxHeading(trimmed) == nil && !isRule(trimmed)
            && !trimmed.hasPrefix(">") && listMarker(trimmed) == nil
    }

    private mutating func parseList() -> MarkdownBlock {
        guard let firstMarker = listMarker(String(lines[index].drop { $0 == " " })) else { return .paragraph([]) }
        let baseIndent = indent(lines[index])
        var items: [MarkdownListItem] = []

        while index < lines.count {
            let line = lines[index]
            let leading = indent(line)
            let trimmed = String(line.drop { $0 == " " })
            guard leading >= baseIndent, leading < baseIndent + 4, let marker = listMarker(trimmed),
                  marker.ordered == firstMarker.ordered
            else { break }
            // A rule is not a list of one item: `---` under a paragraph, `* * *`.
            if isRule(trimmed), !marker.ordered, trimmed.filter({ $0 != " " }).count >= 3 { break }

            let contentColumn = leading + marker.width
            var body: [String] = [String(trimmed.dropFirst(min(marker.width, trimmed.count)))]
            index += 1

            while index < lines.count {
                let next = lines[index]
                if isBlank(next) {
                    // A blank line stays in the item only if the item carries on after it.
                    var peek = index + 1
                    while peek < lines.count, isBlank(lines[peek]) { peek += 1 }
                    guard peek < lines.count, indent(lines[peek]) >= contentColumn else { break }
                    body.append("")
                    index += 1
                    continue
                }
                let nextIndent = indent(next)
                if nextIndent >= contentColumn {
                    body.append(String(next.dropFirst(contentColumn)))
                    index += 1
                } else if listMarker(String(next.drop { $0 == " " })) != nil {
                    // A sibling, or a list this one is nested in.
                    break
                } else if isParagraphContinuation(next), body.last.map({ !$0.isEmpty }) ?? false {
                    body.append(String(next.drop { $0 == " " }))
                    index += 1
                } else {
                    break
                }
            }

            var checked: Bool?
            if let first = body.first {
                for (box, value) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] where first.hasPrefix(box) {
                    checked = value
                    body[0] = String(first.dropFirst(box.count))
                }
            }
            var nested = BlockParser(lines: body)
            items.append(MarkdownListItem(checked: checked, blocks: nested.parseBlocks()))

            // Blank lines between items do not end the list.
            var peek = index
            while peek < lines.count, isBlank(lines[peek]) { peek += 1 }
            guard peek < lines.count, peek > index else { continue }
            let after = lines[peek]
            if indent(after) >= baseIndent, indent(after) < baseIndent + 4,
               let marker = listMarker(String(after.drop { $0 == " " })), marker.ordered == firstMarker.ordered {
                index = peek
            }
        }
        return .list(ordered: firstMarker.ordered, start: firstMarker.number, items: items)
    }

    // MARK: tables

    private func cells(_ line: String) -> [String] {
        var text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|"), !text.hasSuffix("\\|") { text.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        var inCode = false
        for character in text {
            if escaped {
                current.append(character == "|" ? "|" : "\\\(character)")
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "`" {
                inCode.toggle()
                current.append(character)
            } else if character == "|", !inCode {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(character)
            }
        }
        if escaped { current.append("\\") }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }

    private func alignments(_ line: String) -> [MarkdownAlignment]? {
        guard line.contains("-"), line.contains("|") || line.contains(":") || line.contains("-") else { return nil }
        let parts = cells(line)
        var result: [MarkdownAlignment] = []
        for part in parts {
            let dashes = part.filter { $0 == "-" }
            guard !dashes.isEmpty, part.allSatisfy({ $0 == "-" || $0 == ":" }) else { return nil }
            if part.hasPrefix(":"), part.hasSuffix(":") {
                result.append(.center)
            } else if part.hasSuffix(":") {
                result.append(.trailing)
            } else {
                result.append(.leading)
            }
        }
        return result
    }

    private mutating func parseTable() -> MarkdownBlock? {
        guard index + 1 < lines.count, lines[index].contains("|"), let alignment = alignments(lines[index + 1]) else { return nil }
        let header = cells(lines[index])
        guard header.count == alignment.count else { return nil }
        index += 2
        var rows: [[[MarkdownInline]]] = []
        while index < lines.count, !isBlank(lines[index]), lines[index].contains("|") {
            var row = cells(lines[index])
            // Short rows are padded and long ones cut, as GFM does.
            if row.count < header.count { row += Array(repeating: "", count: header.count - row.count) }
            rows.append(row.prefix(header.count).map(Markdown.parseInline))
            index += 1
        }
        return .table(header: header.map(Markdown.parseInline), alignments: alignment, rows: rows)
    }

    // MARK: paragraphs

    private mutating func parseParagraph() -> MarkdownBlock {
        var body: [String] = []
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) { break }
            let trimmed = String(line.drop { $0 == " " })
            if !body.isEmpty {
                // Setext headings: a paragraph underlined with = or -.
                if indent(line) < 4, !trimmed.isEmpty, trimmed.allSatisfy({ $0 == "=" }) {
                    index += 1
                    return .heading(level: 1, Markdown.parseInline(body.joined(separator: "\n")))
                }
                if indent(line) < 4, trimmed.count >= 2, trimmed.allSatisfy({ $0 == "-" }) {
                    index += 1
                    return .heading(level: 2, Markdown.parseInline(body.joined(separator: "\n")))
                }
                if !isParagraphContinuation(line) { break }
                // A table can start right under a paragraph.
                if index + 1 < lines.count, line.contains("|"), alignments(lines[index + 1]) != nil,
                   cells(line).count == (alignments(lines[index + 1])?.count ?? -1) {
                    break
                }
            }
            // Leading spaces go; two trailing ones are a hard break and stay.
            body.append(trimmed)
            index += 1
        }
        return .paragraph(Markdown.parseInline(body.joined(separator: "\n")))
    }
}

// MARK: - inlines

private struct InlineParser {
    let scalars: [Unicode.Scalar]
    var index = 0

    init(_ scalars: [Unicode.Scalar]) { self.scalars = scalars }

    mutating func parse() -> [MarkdownInline] {
        var out: [MarkdownInline] = []
        var text = String.UnicodeScalarView()

        func flush(_ out: inout [MarkdownInline], _ text: inout String.UnicodeScalarView) {
            if !text.isEmpty {
                out.append(.text(String(text)))
                text = String.UnicodeScalarView()
            }
        }

        while index < scalars.count {
            let scalar = scalars[index]
            switch scalar {
            case "\\":
                if index + 1 < scalars.count, scalars[index + 1] == "\n" {
                    flush(&out, &text)
                    out.append(.lineBreak)
                    index += 2
                } else if index + 1 < scalars.count, isPunctuation(scalars[index + 1]) {
                    text.append(scalars[index + 1])
                    index += 2
                } else {
                    text.append(scalar)
                    index += 1
                }
            case "\n":
                // Two or more trailing spaces before a newline is a hard break;
                // otherwise the newline is a space, as the prose was wrapped.
                var trailing = 0
                while let last = text.last, last == " " {
                    text.removeLast()
                    trailing += 1
                }
                flush(&out, &text)
                if trailing >= 2 { out.append(.lineBreak) } else { text.append(" ") }
                index += 1
            case "`":
                if let code = codeSpan() {
                    flush(&out, &text)
                    out.append(.code(code))
                } else {
                    let run = runLength(of: "`", at: index)
                    for _ in 0..<run { text.append("`") }
                    index += run
                }
            case "!":
                if index + 1 < scalars.count, scalars[index + 1] == "[", let image = linkOrImage(from: index + 1) {
                    flush(&out, &text)
                    out.append(.image(alt: Markdown.plainText(image.children), source: image.href))
                } else {
                    text.append(scalar)
                    index += 1
                }
            case "[":
                if let link = linkOrImage(from: index) {
                    flush(&out, &text)
                    out.append(.link(href: link.href, children: link.children))
                } else {
                    text.append(scalar)
                    index += 1
                }
            case "<":
                if let href = autolink() {
                    flush(&out, &text)
                    out.append(.link(href: href, children: [.text(href)]))
                } else {
                    text.append(scalar)
                    index += 1
                }
            case "*", "_", "~":
                if let styled = emphasis() {
                    flush(&out, &text)
                    out.append(styled)
                } else {
                    let run = runLength(of: scalar, at: index)
                    for _ in 0..<run { text.append(scalar) }
                    index += run
                }
            case "h":
                if let url = bareUrl() {
                    flush(&out, &text)
                    out.append(.link(href: url, children: [.text(url)]))
                } else {
                    text.append(scalar)
                    index += 1
                }
            default:
                text.append(scalar)
                index += 1
            }
        }
        flush(&out, &text)
        return merge(out)
    }

    /// Adjacent text runs, joined, so a caller sees one run where one was written.
    private func merge(_ inlines: [MarkdownInline]) -> [MarkdownInline] {
        var out: [MarkdownInline] = []
        for inline in inlines {
            if case .text(let next) = inline, case .text(let previous)? = out.last {
                out[out.count - 1] = .text(previous + next)
            } else {
                out.append(inline)
            }
        }
        return out
    }

    private func isPunctuation(_ scalar: Unicode.Scalar) -> Bool {
        scalar.isASCII && "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".unicodeScalars.contains(scalar)
    }

    private func isWhitespace(_ scalar: Unicode.Scalar?) -> Bool {
        guard let scalar else { return true }
        return scalar == " " || scalar == "\n" || scalar == "\t" || scalar.properties.isWhitespace
    }

    private func isWord(_ scalar: Unicode.Scalar?) -> Bool {
        guard let scalar else { return false }
        return isWordScalar(scalar)
    }

    private func runLength(of scalar: Unicode.Scalar, at start: Int) -> Int {
        var end = start
        while end < scalars.count, scalars[end] == scalar { end += 1 }
        return end - start
    }

    private func at(_ position: Int) -> Unicode.Scalar? {
        scalars.indices.contains(position) ? scalars[position] : nil
    }

    // MARK: code

    private mutating func codeSpan() -> String? {
        let open = runLength(of: "`", at: index)
        var search = index + open
        while search < scalars.count {
            if scalars[search] == "`" {
                let close = runLength(of: "`", at: search)
                if close == open {
                    var body = String(String.UnicodeScalarView(scalars[(index + open)..<search])).replacingOccurrences(of: "\n", with: " ")
                    // One space of padding either side is the syntax's, so that
                    // `` ` `` can hold a backtick.
                    if body.hasPrefix(" "), body.hasSuffix(" "), body.contains(where: { $0 != " " }) {
                        body = String(body.dropFirst().dropLast())
                    }
                    index = search + close
                    return body
                }
                search += close
            } else {
                search += 1
            }
        }
        return nil
    }

    // MARK: links

    private struct Link {
        let href: String
        let children: [MarkdownInline]
    }

    /// `[text](href "title")`, starting at the `[`. Leaves the cursor past it.
    private mutating func linkOrImage(from bracket: Int) -> Link? {
        var depth = 0
        var close: Int?
        var position = bracket
        while position < scalars.count {
            let scalar = scalars[position]
            if scalar == "\\" {
                position += 2
                continue
            }
            if scalar == "`" {
                // A code span inside link text hides its brackets.
                let run = runLength(of: "`", at: position)
                var search = position + run
                var closed = false
                while search < scalars.count {
                    if scalars[search] == "`" {
                        let length = runLength(of: "`", at: search)
                        if length == run {
                            position = search + length
                            closed = true
                            break
                        }
                        search += length
                    } else {
                        search += 1
                    }
                }
                if !closed { position += run }
                continue
            }
            if scalar == "[" { depth += 1 }
            if scalar == "]" {
                depth -= 1
                if depth == 0 {
                    close = position
                    break
                }
            }
            position += 1
        }
        guard let close, at(close + 1) == "(" else { return nil }

        // The destination: to the matching parenthesis, nesting allowed.
        var end = close + 2
        var parens = 1
        var angle = false
        if at(end) == "<" { angle = true }
        while end < scalars.count {
            let scalar = scalars[end]
            if scalar == "\\" {
                end += 2
                continue
            }
            if scalar == "\n", !angle { break }
            if !angle {
                if scalar == "(" { parens += 1 }
                if scalar == ")" {
                    parens -= 1
                    if parens == 0 { break }
                }
            } else if scalar == ">" {
                angle = false
            }
            end += 1
        }
        guard end < scalars.count, scalars[end] == ")", parens == 0 else { return nil }

        var destination = String(String.UnicodeScalarView(scalars[(close + 2)..<end])).trimmingCharacters(in: .whitespaces)
        // A title — `"…"` after the destination — is not shown anywhere.
        if destination.hasPrefix("<"), let closing = destination.firstIndex(of: ">") {
            destination = String(destination[destination.index(after: destination.startIndex)..<closing])
        } else if let space = destination.firstIndex(of: " ") {
            let rest = destination[space...].trimmingCharacters(in: .whitespaces)
            if rest.hasPrefix("\"") || rest.hasPrefix("'") || rest.hasPrefix("(") {
                destination = String(destination[..<space])
            }
        }
        destination = unescape(destination)

        var inner = InlineParser(Array(scalars[(bracket + 1)..<close]))
        let children = inner.parse()
        index = end + 1
        return Link(href: destination, children: children)
    }

    private func unescape(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        let source = Array(text.unicodeScalars)
        var position = 0
        while position < source.count {
            if source[position] == "\\", position + 1 < source.count, isPunctuation(source[position + 1]) {
                out.append(source[position + 1])
                position += 2
            } else {
                out.append(source[position])
                position += 1
            }
        }
        return String(out)
    }

    private mutating func autolink() -> String? {
        guard let close = scalars[index...].firstIndex(of: ">") else { return nil }
        let body = String(String.UnicodeScalarView(scalars[(index + 1)..<close]))
        guard !body.contains(" "), !body.contains("\n"),
              body.hasPrefix("http://") || body.hasPrefix("https://") || body.hasPrefix("mailto:") || body.hasPrefix("slopcoder://")
        else { return nil }
        index = close + 1
        return body
    }

    /// A URL written bare. Models do this constantly, and one that cannot be
    /// tapped is a URL someone has to select on a phone.
    private mutating func bareUrl() -> String? {
        guard !isWord(at(index - 1)) else { return nil }
        let rest = scalars[index...]
        let prefix: [Unicode.Scalar]
        if rest.starts(with: "https://".unicodeScalars) {
            prefix = Array("https://".unicodeScalars)
        } else if rest.starts(with: "http://".unicodeScalars) {
            prefix = Array("http://".unicodeScalars)
        } else {
            return nil
        }
        var end = index + prefix.count
        var parens = 0
        while end < scalars.count {
            let scalar = scalars[end]
            if isWhitespace(scalar) || scalar == "<" || scalar == ">" || scalar == "\"" || scalar == "`" { break }
            if scalar == "(" { parens += 1 }
            if scalar == ")" {
                if parens == 0 { break }
                parens -= 1
            }
            end += 1
        }
        // Sentence punctuation after a URL is the sentence's.
        while end > index + prefix.count, ".,;:!?*_~'".unicodeScalars.contains(scalars[end - 1]) { end -= 1 }
        guard end > index + prefix.count else { return nil }
        let url = String(String.UnicodeScalarView(scalars[index..<end]))
        index = end
        return url
    }

    // MARK: emphasis

    /// `*em*`, `**strong**`, `***both***`, their underscore twins, `~~strike~~`.
    ///
    /// Not the full delimiter-stack algorithm: the opener is matched with the
    /// next closing run of the same character and at least the same length,
    /// which is every case prose produces. An opener with no closer is text.
    private mutating func emphasis() -> MarkdownInline? {
        let marker = scalars[index]
        let run = runLength(of: marker, at: index)
        if marker == "~", run != 2 { return nil }
        if run > 3 { return nil }

        let before = at(index - 1)
        let after = at(index + run)
        // Left-flanking: something follows, and it is not a space.
        guard !isWhitespace(after) else { return nil }
        // An underscore inside a word is a name, not markup: `snake_case_name`.
        if marker == "_", isWord(before) { return nil }
        // `2 * 3 * 4` and `a*b` are arithmetic.
        if marker == "*", let after, isPunctuation(after), !isWhitespace(before), !(before.map(isPunctuation) ?? true) { return nil }

        var search = index + run
        while search < scalars.count {
            let scalar = scalars[search]
            if scalar == "\\" {
                search += 2
                continue
            }
            if scalar == "`" {
                // A code span is opaque to emphasis.
                let ticks = runLength(of: "`", at: search)
                var probe = search + ticks
                var closed = false
                while probe < scalars.count {
                    if scalars[probe] == "`" {
                        let length = runLength(of: "`", at: probe)
                        if length == ticks {
                            search = probe + length
                            closed = true
                            break
                        }
                        probe += length
                    } else {
                        probe += 1
                    }
                }
                if !closed { search += ticks }
                continue
            }
            if scalar == marker {
                let closing = runLength(of: marker, at: search)
                let previous = at(search - 1)
                let next = at(search + closing)
                let rightFlanking = !isWhitespace(previous)
                let wordOk = marker != "_" || !isWord(next)
                if closing >= run, rightFlanking, wordOk {
                    var inner = InlineParser(Array(scalars[(index + run)..<search]))
                    let children = inner.parse()
                    index = search + run
                    switch (marker, run) {
                    case ("~", _): return .strike(children)
                    case (_, 1): return .emphasis(children)
                    case (_, 2): return .strong(children)
                    default: return .strong([.emphasis(children)])
                    }
                }
                search += closing
                continue
            }
            search += 1
        }
        return nil
    }
}

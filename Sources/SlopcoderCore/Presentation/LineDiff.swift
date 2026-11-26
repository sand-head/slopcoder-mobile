// Line diffs for tool cards, ported from
// `SlopCoder.Contracts/Presentation/{LineDiff,UnifiedDiff}.cs`.

import Foundation

public enum DiffKind: String, Sendable { case context, add, remove, hunk }

public struct DiffLine: Hashable, Sendable {
    public var kind: DiffKind
    public var text: String
    public var oldNumber: Int?
    public var newNumber: Int?

    public init(_ kind: DiffKind, _ text: String, oldNumber: Int? = nil, newNumber: Int? = nil) {
        self.kind = kind
        self.text = text
        self.oldNumber = oldNumber
        self.newNumber = newNumber
    }
}

/// Per-side line cap for the quadratic pass, after prefix/suffix trimming.
private let maxLcsLines = 600
/// Unchanged lines kept either side of a change.
public let diffContext = 3

public func splitLines(_ text: String) -> [String] {
    if text.isEmpty { return [] }
    // Unicode scalars, not Characters: "\r\n" is one Character, and splitting on
    // "\n" by Character would never see it.
    var lines: [String] = []
    var current = String.UnicodeScalarView()
    var pendingReturn = false
    for scalar in text.unicodeScalars {
        if pendingReturn {
            pendingReturn = false
            if scalar != "\n" { current.append("\r") }
        }
        if scalar == "\r" {
            pendingReturn = true
        } else if scalar == "\n" {
            lines.append(String(current))
            current = String.UnicodeScalarView()
        } else {
            current.append(scalar)
        }
    }
    if pendingReturn { current.append("\r") }
    lines.append(String(current))
    return lines
}

/// A line diff, for the tools that hand us a before and an after but no diff.
///
/// Common prefix and suffix are trimmed before the quadratic part runs, which is
/// what makes it affordable: a real edit is a small change inside a larger block,
/// so the LCS almost never sees more than a few dozen lines.
///
/// `numbered` is false for `edit_file`, whose strings are fragments of a file
/// rather than the file — numbering a fragment from 1 states a position that is
/// not where the change is.
public func lineDiff(_ oldText: String, _ newText: String, numbered: Bool = true, context: Int = diffContext) -> [DiffLine] {
    elide(align(splitLines(oldText), splitLines(newText), numbered: numbered), context: context)
}

/// Every line as an addition — a file that did not exist before. The final
/// newline is dropped rather than counted, so a well-formed file does not end on
/// a phantom blank line the editor never showed.
public func allAdded(_ text: String, numbered: Bool = true) -> [DiffLine] {
    let body = text.unicodeScalars.last == "\n" ? String(String.UnicodeScalarView(text.unicodeScalars.dropLast())) : text
    return splitLines(body).enumerated().map { index, line in
        DiffLine(.add, line, newNumber: numbered ? index + 1 : nil)
    }
}

private func align(_ oldLines: [String], _ newLines: [String], numbered: Bool) -> [DiffLine] {
    var result: [DiffLine] = []
    var oldNo = 1
    var newNo = 1

    var head = 0
    while head < oldLines.count, head < newLines.count, oldLines[head] == newLines[head] {
        result.append(DiffLine(.context, oldLines[head], oldNumber: numbered ? oldNo : nil, newNumber: numbered ? newNo : nil))
        head += 1
        oldNo += 1
        newNo += 1
    }

    var tail = 0
    while tail < oldLines.count - head, tail < newLines.count - head,
          oldLines[oldLines.count - 1 - tail] == newLines[newLines.count - 1 - tail] {
        tail += 1
    }

    let oldMiddle = Array(oldLines[head..<(oldLines.count - tail)])
    let newMiddle = Array(newLines[head..<(newLines.count - tail)])

    if oldMiddle.count > maxLcsLines || newMiddle.count > maxLcsLines {
        // A worse diff beats a phone allocating a table with a third of a million
        // cells in it.
        for line in oldMiddle {
            result.append(DiffLine(.remove, line, oldNumber: numbered ? oldNo : nil))
            if numbered { oldNo += 1 }
        }
        for line in newMiddle {
            result.append(DiffLine(.add, line, newNumber: numbered ? newNo : nil))
            if numbered { newNo += 1 }
        }
    } else {
        appendLcs(&result, oldMiddle, newMiddle, numbered: numbered, oldNo: &oldNo, newNo: &newNo)
    }

    for index in (oldLines.count - tail)..<oldLines.count {
        result.append(DiffLine(.context, oldLines[index], oldNumber: numbered ? oldNo : nil, newNumber: numbered ? newNo : nil))
        oldNo += 1
        newNo += 1
    }

    return result
}

private func appendLcs(_ result: inout [DiffLine], _ a: [String], _ b: [String], numbered: Bool, oldNo: inout Int, newNo: inout Int) {
    let width = b.count + 1
    var table = [Int32](repeating: 0, count: (a.count + 1) * width)
    if !a.isEmpty, !b.isEmpty {
        for i in stride(from: a.count - 1, through: 0, by: -1) {
            for j in stride(from: b.count - 1, through: 0, by: -1) {
                table[i * width + j] = a[i] == b[j]
                    ? table[(i + 1) * width + j + 1] + 1
                    : max(table[(i + 1) * width + j], table[i * width + j + 1])
            }
        }
    }

    var x = 0
    var y = 0
    while x < a.count, y < b.count {
        if a[x] == b[y] {
            result.append(DiffLine(.context, a[x], oldNumber: numbered ? oldNo : nil, newNumber: numbered ? newNo : nil))
            x += 1
            y += 1
            oldNo += 1
            newNo += 1
            // Removals before additions on a tie, so a replaced line reads "was / now"
            // rather than the other way around.
        } else if table[(x + 1) * width + y] >= table[x * width + y + 1] {
            result.append(DiffLine(.remove, a[x], oldNumber: numbered ? oldNo : nil))
            x += 1
            oldNo += 1
        } else {
            result.append(DiffLine(.add, b[y], newNumber: numbered ? newNo : nil))
            y += 1
            newNo += 1
        }
    }

    while x < a.count {
        result.append(DiffLine(.remove, a[x], oldNumber: numbered ? oldNo : nil))
        x += 1
        oldNo += 1
    }

    while y < b.count {
        result.append(DiffLine(.add, b[y], newNumber: numbered ? newNo : nil))
        y += 1
        newNo += 1
    }
}

private func unchanged(_ count: Int) -> String {
    count == 1 ? "1 unchanged line" : "\(count) unchanged lines"
}

/// Drop unchanged runs more than `context` lines from any change, marking each
/// elision with a hunk row. A diff with no changes comes back empty rather than
/// as the whole text — an edit whose strings match is a no-op, and printing its
/// input back is not a diff.
private func elide(_ lines: [DiffLine], context: Int) -> [DiffLine] {
    var changed = [Bool](repeating: false, count: lines.count)
    var any = false
    for index in lines.indices {
        if lines[index].kind == .context || lines[index].kind == .hunk { continue }
        any = true
        let from = max(0, index - context)
        let to = min(lines.count - 1, index + context)
        if from <= to { for j in from...to { changed[j] = true } }
    }

    if !any { return [] }

    var result: [DiffLine] = []
    var skipped = 0
    for index in lines.indices {
        if changed[index] {
            if skipped > 0 {
                result.append(DiffLine(.hunk, unchanged(skipped)))
                skipped = 0
            }
            result.append(lines[index])
        } else {
            skipped += 1
        }
    }

    // A run elided off the end needs saying too, or the diff simply stops and
    // nothing tells the reader there was more file after it.
    if skipped > 0 { result.append(DiffLine(.hunk, unchanged(skipped))) }

    return result
}

/// Unified diff text into the same shape, for the tools that already speak diff.
/// Forgiving on purpose: anything unrecognised becomes a dim hunk row rather than
/// being dropped.
public func parseUnifiedDiff(_ text: String) -> [DiffLine] {
    var result: [DiffLine] = []
    var oldNo = 0
    var newNo = 0

    let decorations = ["+++", "---", "diff ", "index ", "new file", "deleted file", "similarity index", "rename ", "\\"]

    for raw in splitLines(text) {
        if raw.jsStarts(with: "@@") {
            (oldNo, newNo) = parseHunkHeader(raw)
            result.append(DiffLine(.hunk, raw))
        } else if decorations.contains(where: { raw.jsStarts(with: $0) }) {
            result.append(DiffLine(.hunk, raw))
        } else if raw.jsStarts(with: "+") {
            result.append(DiffLine(.add, raw.jsDropFirst(), newNumber: newNo))
            newNo += 1
        } else if raw.jsStarts(with: "-") {
            result.append(DiffLine(.remove, raw.jsDropFirst(), oldNumber: oldNo))
            oldNo += 1
        } else {
            result.append(DiffLine(.context, raw.jsStarts(with: " ") ? raw.jsDropFirst() : raw, oldNumber: oldNo, newNumber: newNo))
            oldNo += 1
            newNo += 1
        }
    }

    return result
}

/// Starting line numbers from `@@ -12,7 +12,9 @@`. Zero on anything unparseable.
private func parseHunkHeader(_ header: String) -> (Int, Int) {
    var body = header.jsDropFirst(2)
    if let end = body.jsIndex(of: "@@") { body = body.jsPrefix(upTo: end) }

    var oldNo = 0
    var newNo = 0
    for range in body.jsSplit(" ") where !range.isEmpty {
        if range.unicodeScalars.count < 2 { continue }
        let digits = range.jsDropFirst().jsSplit(",")[0]
        guard digits.isAllDigits, let value = Int(digits) else { continue }
        if range.jsStarts(with: "-") {
            oldNo = value
        } else if range.jsStarts(with: "+") {
            newNo = value
        }
    }

    return (oldNo, newNo)
}

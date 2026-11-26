import Foundation

// String operations with JavaScript's (and .NET's) meaning, at the level of
// Unicode scalars.
//
// The presentation code is a port of logic that exists three times — C#,
// TypeScript, and here — and is held to one fixture. Swift's own `hasPrefix`,
// `contains` and `Character`-based splitting apply canonical equivalence and
// grapheme clustering ("\r\n" is one Character), which is the right default for
// prose and the wrong one for agreeing with two other implementations about
// where a line ends.

func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
        return true
    case 0x2000...0x200A:
        return true
    default:
        return false
    }
}

extension String {
    /// `trim()`.
    public var jsTrim: String { jsTrimStart.jsTrimEnd }

    /// `trimEnd()` / `String.TrimEnd()` — all trailing whitespace, not just newlines.
    var jsTrimEnd: String {
        let scalars = unicodeScalars
        var end = scalars.endIndex
        while end > scalars.startIndex {
            let previous = scalars.index(before: end)
            if !isJSWhitespace(scalars[previous]) { break }
            end = previous
        }
        return end == scalars.endIndex ? self : String(scalars[scalars.startIndex..<end])
    }

    var jsTrimStart: String {
        let scalars = unicodeScalars
        var start = scalars.startIndex
        while start < scalars.endIndex, isJSWhitespace(scalars[start]) { start = scalars.index(after: start) }
        return start == scalars.startIndex ? self : String(scalars[start...])
    }

    func jsStarts(with prefix: String) -> Bool {
        unicodeScalars.starts(with: prefix.unicodeScalars)
    }

    func jsEnds(with suffix: String) -> Bool {
        unicodeScalars.reversed().starts(with: suffix.unicodeScalars.reversed())
    }

    /// `indexOf(needle, from)`, as an index into `unicodeScalars`.
    func jsIndex(of needle: String, from: String.Index? = nil) -> String.Index? {
        let haystack = unicodeScalars
        let pattern = Array(needle.unicodeScalars)
        var index = from ?? haystack.startIndex
        if pattern.isEmpty { return index }
        while index < haystack.endIndex {
            if haystack[index] == pattern[0] {
                var probe = index
                var matched = 0
                while matched < pattern.count, probe < haystack.endIndex, haystack[probe] == pattern[matched] {
                    probe = haystack.index(after: probe)
                    matched += 1
                }
                if matched == pattern.count { return index }
            }
            index = haystack.index(after: index)
        }
        return nil
    }

    /// `lastIndexOf(needle)`.
    func jsLastIndex(of needle: String) -> String.Index? {
        var found: String.Index?
        var from: String.Index? = nil
        while let next = jsIndex(of: needle, from: from) {
            found = next
            let after = unicodeScalars.index(after: next)
            if after >= unicodeScalars.endIndex { break }
            from = after
        }
        return found
    }

    func jsContains(_ needle: String) -> Bool { jsIndex(of: needle) != nil }

    /// The index `count` scalars past `index`.
    func jsIndex(_ index: String.Index, offsetBy count: Int) -> String.Index {
        unicodeScalars.index(index, offsetBy: count, limitedBy: unicodeScalars.endIndex) ?? unicodeScalars.endIndex
    }

    /// `slice(from, to)` over scalar indices.
    func jsSlice(_ from: String.Index, _ to: String.Index? = nil) -> String {
        let end = to ?? unicodeScalars.endIndex
        return from >= end ? "" : String(unicodeScalars[from..<end])
    }

    /// `slice(0, to)`.
    func jsPrefix(upTo to: String.Index) -> String {
        String(unicodeScalars[unicodeScalars.startIndex..<to])
    }

    /// The string after `prefix`, which the caller has checked is there.
    func jsDropping(prefix: String) -> String {
        jsSlice(jsIndex(unicodeScalars.startIndex, offsetBy: prefix.unicodeScalars.count))
    }

    /// `slice(1)` and friends.
    func jsDropFirst(_ count: Int = 1) -> String {
        jsSlice(jsIndex(unicodeScalars.startIndex, offsetBy: count))
    }

    /// `split(separator)` on one scalar, keeping empty pieces as JavaScript does.
    func jsSplit(_ separator: Unicode.Scalar) -> [String] {
        var parts: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in unicodeScalars {
            if scalar == separator {
                parts.append(String(current))
                current = String.UnicodeScalarView()
            } else {
                current.append(scalar)
            }
        }
        parts.append(String(current))
        return parts
    }

    /// `/^\d+$/.test(self)`.
    var isAllDigits: Bool {
        !isEmpty && unicodeScalars.allSatisfy { (0x30...0x39).contains($0.value) }
    }

    var jsHasNewline: Bool { unicodeScalars.contains("\n") }

    /// Nil for nil or empty — a JavaScript string's truthiness.
    var nonEmpty: String? { isEmpty ? nil : self }
}

extension Optional where Wrapped == String {
    /// The string when it is there and not empty: `if (value)`.
    var truthy: String? {
        if let self, !self.isEmpty { return self }
        return nil
    }
}

/// A regular expression's first match, as its groups (index 0 is the whole
/// match). Nil when it does not match.
func firstMatch(_ pattern: String, in text: String, caseInsensitive: Bool = false) -> [String?]? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else {
        return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, options: [], range: range) else { return nil }
    return (0..<match.numberOfRanges).map { index in
        Range(match.range(at: index), in: text).map { String(text[$0]) }
    }
}

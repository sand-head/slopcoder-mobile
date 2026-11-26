// Finding a partner's name in the agent's prose.
//
// The agent writes about its team — "asked Ada to take the relay while Bruno
// finishes the migration" — and those names are the only thread tying that
// sentence to the cards above and below it. Colouring them turns reading a
// delegation-heavy transcript from parsing into scanning.
//
// The cockpit does this by scanning rendered HTML. There is no HTML here: the
// markdown renderer hands us text runs, so this splits one of those instead.
// The matching rules are the same, and they are the part worth keeping in
// step — each of them is a way to get this visibly wrong.

import Foundation

/// One partner the prose may name, and the colour they are drawn in.
public struct SubSessionMention: Hashable, Sendable {
    public var persona: String
    /// A palette name (`tintFor`); an unknown or empty one renders untinted.
    public var color: String

    public init(persona: String, color: String) {
        self.persona = persona
        self.color = color
    }
}

/// A piece of a text run: plain, or one partner's name.
public struct MentionRun: Hashable, Sendable {
    public var text: String
    /// The colour this run takes, or nil for ordinary prose.
    public var color: String?

    public init(text: String, color: String?) {
        self.text = text
        self.color = color
    }
}

/// `text` split into tinted and untinted runs. A single left-to-right pass, so
/// two names can never rewrite each other's output.
///
/// Whole words only — `Adapter` must keep its ink, and a substring match that
/// tints half a word reads as a rendering bug. Longest name first, so an
/// "Ada II" is never cut short by the "Ada" sharing its prefix. Matching
/// ignores case (an agent that writes "ada" still means her) but every run
/// carries the text exactly as it was written.
public func splitMentions(_ text: String, _ mentions: [SubSessionMention]) -> [MentionRun] {
    if mentions.isEmpty || text.isEmpty { return [MentionRun(text: text, color: nil)] }

    let ordered = mentions
        .filter { !$0.persona.isEmpty && !$0.color.isEmpty }
        .stableSorted { $0.persona.jsLength > $1.persona.jsLength }
        .map { (name: Array($0.persona.unicodeScalars), lowered: $0.persona.lowercased(), color: $0.color) }
    if ordered.isEmpty { return [MentionRun(text: text, color: nil)] }

    let scalars = Array(text.unicodeScalars)
    func piece(_ from: Int, _ to: Int) -> String { String(String.UnicodeScalarView(scalars[from..<to])) }

    var runs: [MentionRun] = []
    var copied = 0
    var index = 0

    while index < scalars.count {
        defer { index += 1 }
        if index > 0, isWordScalar(scalars[index - 1]) { continue }

        for mention in ordered {
            let end = index + mention.name.count
            if end > scalars.count { continue }
            if piece(index, end).lowercased() != mention.lowered { continue }
            if end < scalars.count, isWordScalar(scalars[end]) { continue }

            if index > copied { runs.append(MentionRun(text: piece(copied, index), color: nil)) }
            runs.append(MentionRun(text: piece(index, end), color: mention.color))
            copied = end
            index = end - 1
            break
        }
    }

    if copied < scalars.count { runs.append(MentionRun(text: piece(copied, scalars.count), color: nil)) }
    return runs.isEmpty ? [MentionRun(text: text, color: nil)] : runs
}

/// `[\p{L}\p{N}_]`.
func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
    if scalar == "_" { return true }
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
         .decimalNumber, .letterNumber, .otherNumber:
        return true
    default:
        return false
    }
}

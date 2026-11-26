// Deciding, on the phone, whether what is in the composer is a command.
//
// Ported from `SlopCoder.Contracts/SlashCommandParser.cs`, and pure for the
// same reason it is pure there: the composer has to know a command from a
// prompt before it sends anything anywhere. Running the command is still the
// server's job — it needs the sandbox, the facet catalogue and the live model,
// none of which exist here.
//
// Keep the rules in step with the C#. Each of them is a way to get this
// visibly wrong: a pasted path is not a command, and neither is a bare slash.

import Foundation

public struct SlashCommand: Equatable, Sendable {
    public let name: String
    public let args: String

    public init(name: String, args: String) {
        self.name = name
        self.args = args
    }
}

/// Nil when the input is not a slash command and should be sent as a prompt.
public func parseSlashCommand(_ input: String) -> SlashCommand? {
    let trimmed = input.jsTrim
    guard trimmed.jsLength >= 2, trimmed.jsStarts(with: "/") else { return nil }

    let afterSlash = trimmed.jsIndex(trimmed.unicodeScalars.startIndex, offsetBy: 1)
    let space = trimmed.jsIndex(of: " ")
    let name = trimmed.jsSlice(afterSlash, space)
    let args = space.map { trimmed.jsSlice(trimmed.unicodeScalars.index(after: $0)).jsTrim } ?? ""

    // A bare "/" or something path-like ("/etc/passwd") is not a command.
    return name.isEmpty || name.jsContains("/") ? nil : SlashCommand(name: name, args: args)
}

/// The partial command being typed — `"/co"` → `"co"`, and a bare `"/"` → `""`,
/// which offers the lot. Nil once the name is settled: a space means the
/// arguments have started and the menu has said all it can.
public func commandPrefix(_ draft: String) -> String? {
    guard draft.jsStarts(with: "/") else { return nil }
    let rest = draft.jsDropFirst()
    if draft.jsContains(" ") || rest.jsContains("/") { return nil }
    return rest
}

/// What the menu offers for a prefix, in the order the server listed them.
public func matchCommands(_ commands: [SlashCommandInfo], prefix: String) -> [SlashCommandInfo] {
    let wanted = prefix.lowercased()
    return commands.filter { $0.name.lowercased().jsStarts(with: wanted) }
}

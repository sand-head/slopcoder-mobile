// The app's tool cards must be the cockpit's tool cards.
//
// `Fixtures/tool-cards.json` is a byte-identical copy of the file slopcoder's
// own suite replays against `ToolCards.Build` (see
// `tests/SlopCoder.Web.Tests/ToolCardTests.cs`). Nothing mechanically proves the
// two *copies* stay identical — this repo cannot reach the private one — but
// each side proving itself against the same cases is what stops the C# and the
// Swift drifting into two different ideas of what an edit looks like.
//
// When the C# side changes intentionally: regenerate there with
// `TOOLCARDS_REGENERATE=1 dotnet test --filter ToolCardTests`, copy the file
// over, and this suite says exactly which cards moved.

import Foundation
import Testing
@testable import SlopcoderCore

private func optional(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
private func optional(_ value: Int?) -> JSONValue { value.map { .number(Double($0)) } ?? .null }

/// The card as plain JSON, in the shape `ToolCardTests.Describe` emits. Written
/// by hand on both sides rather than serialized, so neither language's defaults
/// leak into the contract.
func describeCard(_ card: ToolCard) -> JSONValue {
    var object = JSONObject()
    object["verb"] = .string(card.verb)
    object["subject"] = optional(card.subject)
    object["subjectStyle"] = .string(card.subjectStyle.rawValue)
    object["facets"] = .array(card.facets.map(JSONValue.string))
    object["blocks"] = .array(card.blocks.map(describeBlock))
    // Written only when true, matching the C# encoder: an absent key is false.
    if card.bare { object["bare"] = true }
    // Likewise only when there is one.
    if let title = card.title { object["title"] = .string(title) }
    if let peek = card.peek {
        object["peek"] = ["path": .string(peek.path), "text": .string(peek.text), "facets": .array(peek.facets.map(JSONValue.string))]
    }
    return .object(object)
}

private func describeBlock(_ block: ToolBlock) -> JSONValue {
    var object = JSONObject()
    object["type"] = .string(block.type)
    object["label"] = optional(block.label)
    object["open"] = .bool(block.open)
    switch block.content {
    case .text(let tone, let text):
        object["tone"] = .string(tone.rawValue)
        object["text"] = .string(text)
    case .code(let language, let text):
        object["language"] = optional(language)
        object["text"] = .string(text)
    case .diff(let lines):
        object["lines"] = .array(lines.map { [.string($0.kind.rawValue), .string($0.text), optional($0.oldNumber), optional($0.newNumber)] })
    case .list(let entries):
        object["entries"] = .array(entries.map { [.string($0.text), optional($0.detail)] })
    case .pairs(let pairs):
        object["pairs"] = .array(pairs.map { [.string($0.key), .string($0.value)] })
    case .artifact(let name, let kind, let size, let artifactId):
        object["name"] = .string(name)
        object["kind"] = .string(kind)
        object["size"] = optional(size)
        object["artifactId"] = optional(artifactId)
    case .scene(let scene, let revision, let renderId):
        object["scene"] = .string(scene)
        object["revision"] = optional(revision)
        object["renderId"] = optional(renderId)
    case .image(let imageId, let mediaType, let size):
        object["imageId"] = .string(imageId)
        object["mediaType"] = .string(mediaType)
        object["size"] = .string(size)
    }
    return .object(object)
}

/// Replays one fixture file and reports each card that differs.
func replay(_ file: String, sourceLocation: SourceLocation = #_sourceLocation) throws -> Int {
    let fixtures = try #require(JSONValue.parse(try fixture(file))?.array, sourceLocation: sourceLocation)
    for fixture in fixtures {
        // "raw" fixtures carry a string that is not JSON, which is the point of them.
        let input = fixture["raw"] == .bool(true) ? fixture["input"].stringValue : fixture["input"].serialized()
        let images = fixture["images"].arrayValue.map {
            ToolResultImage(id: $0["id"].stringValue, mediaType: $0["mediaType"].stringValue, size: $0["size"].intValue)
        }
        let build = fixture["proposal"] == .bool(true)
            ? buildProposalCard(fixture["tool"].stringValue, inputJson: input)
            : buildToolCard(
                fixture["tool"].stringValue, inputJson: input, result: fixture["result"].string,
                isError: fixture["isError"] == .bool(true), images: images
            )
        var card = describeCard(build)
        // The server's fixture predates the peek and does not describe it.
        if !fixture["expected"].has("peek"), case .object(var object) = card {
            object["peek"] = nil
            card = .object(object)
        }
        if card != fixture["expected"] {
            Issue.record(
                "\(fixture["name"].stringValue)\n   got: \(card.serialized())\n  want: \(fixture["expected"].serialized())",
                sourceLocation: sourceLocation
            )
        }
    }
    return fixtures.count
}

@Suite struct ToolCardFixtureTests {
    @Test func toolCardsMatchTheServerFixtures() throws {
        let replayed = try replay("tool-cards.json")
        #expect(replayed > 40)
    }

    /// 1,716 generated calls — every tool this build knows, plus MCP and unknown
    /// ones, with inputs and results chosen to be awkward — and what the
    /// TypeScript client this app replaced made of each. The server's fixture
    /// pins the cards that matter; this pins the ones nobody thought to write.
    @Test func toolCardsMatchTheClientThisOneReplaced() throws {
        let replayed = try replay("tool-cards-differential.json")
        #expect(replayed > 1000)
    }
}

@Suite struct ToolCardTests {
    @Test func numbersAWholeFileDiffAndLeavesAFragmentUnnumbered() {
        let whole = lineDiff("a\nb", "a\nB")
        #expect(whole == [
            DiffLine(.context, "a", oldNumber: 1, newNumber: 1),
            DiffLine(.remove, "b", oldNumber: 2),
            DiffLine(.add, "B", newNumber: 2),
        ])
        #expect(lineDiff("a\nb", "a\nB", numbered: false).allSatisfy { $0.oldNumber == nil && $0.newNumber == nil })
    }

    @Test func elidesUnchangedRunsAndSaysHowManyItDropped() {
        let rest = (0..<20).map { "line \($0)" }
        let lines = lineDiff((["x"] + rest).joined(separator: "\n"), (["y"] + rest).joined(separator: "\n"))
        #expect(lines.filter { $0.kind == .hunk }.map(\.text) == ["17 unchanged lines"])
        #expect(lines.count == 6)
    }

    @Test func readsLineNumbersOutOfAUnifiedHunkHeader() {
        let lines = parseUnifiedDiff("@@ -10,3 +20,4 @@\n keep\n-gone\n+new")
        #expect(lines == [
            DiffLine(.hunk, "@@ -10,3 +20,4 @@"),
            DiffLine(.context, "keep", oldNumber: 10, newNumber: 20),
            DiffLine(.remove, "gone", oldNumber: 11),
            DiffLine(.add, "new", newNumber: 21),
        ])
    }

    @Test func splitsLinesOnEitherNewline() {
        #expect(splitLines("a\r\nb\nc") == ["a", "b", "c"])
        #expect(splitLines("a\rb\n") == ["a\rb", ""])
        #expect(splitLines("") == [])
    }

    @Test func opensEverythingOnAProposalAndLiftsTheCommandOutOfTheHeader() {
        let card = buildProposalCard("run_bash", inputJson: #"{"command":"rm -rf build"}"#)
        #expect(card.blocks.allSatisfy { $0.open })
        #expect(card.blocks[0] == ToolBlock(label: "command", open: true, .code(language: nil, text: "rm -rf build")))
    }

    /// Claude Code says what each command is for. That sentence is the header;
    /// the command it describes is the first thing behind the chevron, and the
    /// millisecond timeout is nowhere.
    @Test func headsADescribedClaudeCodeCommandWithItsDescription() {
        let input = #"{"command":"cd /repo; sed -n 1,130p src/Harness.cs","description":"Check StartProcessAsync signatures","timeout":120000}"#
        let card = buildToolCard("Bash", inputJson: input, result: "exit code: 0\nok", isError: false)
        #expect(card.verb == "Bash")
        #expect(card.title == "Check StartProcessAsync signatures")
        #expect(card.subjectStyle == .command)
        #expect(card.facets == ["exit 0"])
        #expect(card.blocks == [
            ToolBlock(label: "command", open: false, .code(language: nil, text: "cd /repo; sed -n 1,130p src/Harness.cs")),
            ToolBlock(label: "output", open: false, .code(language: nil, text: "ok")),
        ])

        // Gated, it is the same one command block, opened — not two.
        let proposal = buildProposalCard("PowerShell", inputJson: input)
        #expect(proposal.title == "Check StartProcessAsync signatures")
        #expect(proposal.blocks.filter { $0.label == "command" }.count == 1)
        #expect(proposal.blocks.allSatisfy { $0.open })
    }

    @Test func keepsAnUndescribedCommandInTheHeader() {
        let card = buildToolCard("Bash", inputJson: #"{"command":"ls","run_in_background":true}"#, result: nil, isError: false)
        #expect(card.title == nil)
        #expect(card == ToolCard(verb: "Bash", subject: "ls", subjectStyle: .command, facets: ["background"], blocks: []))
    }

    @Test func opensAnEditProposalOnItsDiff() {
        let card = buildProposalCard("edit_file", inputJson: #"{"path":"a.ts","old_str":"let x","new_str":"const x"}"#)
        #expect(card.blocks[0].type == "diff")
        #expect(card.blocks[0].open)
    }

    @Test func aReadKeepsItsTextForThePeekSheet() {
        let card = buildToolCard("Read", inputJson: #"{"file_path":"src/a.swift","offset":40}"#, result: "let a = 1\nlet b = 2\n\n", isError: false)
        #expect(card.peek == FilePeek(path: "src/a.swift", text: "let a = 1\nlet b = 2", facets: ["2 lines", "from 40"]))
        #expect(card.blocks == [ToolBlock(label: nil, open: false, .code(language: "swift", text: "let a = 1\nlet b = 2"))])
    }

    @Test func humanizes() {
        #expect(humanize("get_weather") == "Get weather")
        #expect(humanize("skill") == "Skill")
        #expect(humanize("a__b") == "A b")
        #expect(humanize("") == "")
    }

    @Test func formatsBytesOnTheSameDigitAsTheServer() {
        #expect([812, 1024, 186_368, 2_516_582].map(formatBytes) == ["812 B", "1 KB", "182 KB", "2.4 MB"])
    }

    @Test func readsGuidsTheWayTheServerWritesThemBack() {
        #expect(parseGuid("0199C0DE-0000-7000-8000-00000000CAFE") == "0199c0de-0000-7000-8000-00000000cafe")
        #expect(parseGuid("{0199c0de-0000-7000-8000-00000000cafe}") == "0199c0de-0000-7000-8000-00000000cafe")
        #expect(parseGuid("0199c0de00007000800000000000cafe") == "0199c0de-0000-7000-8000-00000000cafe")
        #expect(parseGuid("{0199c0de-0000-7000-8000-00000000cafe)") == nil)
        #expect(parseGuid("0199c0de-0000-7000-8000-00000000cafe}") == nil)
        #expect(parseGuid("nope") == nil)
    }

    @Test func neverTrapsWhateverTheInput() {
        for input in ["{not json", "", "null", "[1,2,3]", "\"a string\"", #"{"a":{"b":[1]}}"#, "   ", "{}", "12"] {
            for tool in ["anything", "edit_file", "Read", "Bash", "scene_exec", "publish_artifact", "mcp__x__y", "mcp__x"] {
                _ = buildToolCard(tool, inputJson: input, result: "ok", isError: false)
                _ = buildToolCard(tool, inputJson: input, result: nil, isError: true)
                _ = buildProposalCard(tool, inputJson: input)
            }
        }
    }
}

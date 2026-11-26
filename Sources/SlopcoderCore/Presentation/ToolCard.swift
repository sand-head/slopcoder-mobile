// Turning a tool call into something readable, ported from
// `SlopCoder.Contracts/Presentation/{ToolCard,ToolCards}.cs`.
//
// The vocabulary is closed: the renderer switches over *blocks*, never over tool
// names, so teaching the transcript about a new tool is an entry in the table
// below and no renderer change at all.
//
// Pure and total. A malformed input, an unknown tool, an empty string all fall
// through to `fallback` rather than throwing — a transcript rendering a thousand
// events must never be one bad payload away from a blank screen.
//
// The fallback matters most, and on the phone more than anywhere. Every MCP tool
// arrives as `mcp__<server>__<tool>` with a schema nobody here has seen, and an
// app that shipped through the App Store is always older than the server it is
// talking to, so tools added since the last release look exactly the same way to
// it. Those all have to read as something better than JSON with nobody having
// written a line for them.
//
// Held to the C# by `ToolCardTests`, which replays `Fixtures/tool-cards.json` — a
// byte-identical copy of the file the server's own suite replays. Two clients
// disagreeing about what a tool call looks like is the exact bug cards exist to
// prevent.

import Foundation

public enum SubjectStyle: String, Sendable { case plain, path, command, url }
public enum TextTone: String, Sendable { case plain, muted, error }

public struct ListEntry: Hashable, Sendable {
    public var text: String
    public var detail: String?

    public init(text: String, detail: String? = nil) {
        self.text = text
        self.detail = detail
    }
}

public struct CardPair: Hashable, Sendable {
    public var key: String
    public var value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

public struct ToolBlock: Hashable, Sendable {
    public enum Content: Hashable, Sendable {
        case text(tone: TextTone, text: String)
        case code(language: String?, text: String)
        case diff([DiffLine])
        case list([ListEntry])
        case pairs([CardPair])
        /// A published artifact, as the thing itself rather than as a sentence about
        /// it. Carries an id rather than a URL: the phone opens its own screen, the
        /// cockpit navigates its own route, and neither is told by the server how its
        /// own links are spelled. A nil id is a call that has not run yet.
        ///
        /// `name` is the artifact's slug, not the prose title; `kind` is how to say
        /// the format to a person — "Markdown", "PDF".
        case artifact(name: String, kind: String, size: String?, artifactId: String?)
        /// A look at a 3D scene: the picture the agent was handed, at the revision it
        /// shows. Ids rather than URLs, like `artifact`. A nil `renderId` is a call
        /// with no picture kept, and the block then says which scene without one.
        case scene(scene: String, revision: Int?, renderId: String?)
        /// A picture a tool returned, kept by the server with the transcript and
        /// fetched from `/tool-images/{imageId}` with the device's key.
        case image(imageId: String, mediaType: String, size: String)
    }

    public var label: String?
    /// Shown without a tap. Diffs and failures set it; nothing else does.
    public var open: Bool
    public var content: Content

    public init(label: String?, open: Bool, _ content: Content) {
        self.label = label
        self.open = open
        self.content = content
    }

    /// The block's kind as the fixture spells it.
    public var type: String {
        switch content {
        case .text: return "text"
        case .code: return "code"
        case .diff: return "diff"
        case .list: return "list"
        case .pairs: return "pairs"
        case .artifact: return "artifact"
        case .scene: return "scene"
        case .image: return "image"
        }
    }

    var isImage: Bool {
        if case .image = content { return true }
        return false
    }

    var isErrorText: Bool {
        if case .text(let tone, _) = content { return tone == .error }
        return false
    }

    var isCode: Bool {
        if case .code = content { return true }
        return false
    }
}

/// What a file read returned, for the peek sheet: the path it came from and
/// the text exactly as the model saw it.
public struct FilePeek: Hashable, Sendable {
    public var path: String
    public var text: String
    /// "182 lines", "from 40", "limit 20" — the header's chips, repeated in the sheet.
    public var facets: [String]

    public init(path: String, text: String, facets: [String]) {
        self.path = path
        self.text = text
        self.facets = facets
    }
}

public struct ToolCard: Hashable, Sendable {
    public var verb: String
    public var subject: String?
    /// What the caller said the call is for — Claude Code writes one on every
    /// shell command. When present the header reads this instead of verb and
    /// subject: "Check the build script's flags" says more on one line than
    /// "Bash cd /repo && sed -n 1,130p …" cut off at the screen's edge. The
    /// command is then the card's first block, a tap away.
    public var title: String?
    public var subjectStyle: SubjectStyle
    public var facets: [String]
    public var blocks: [ToolBlock]
    /// This card *is* its content: render the blocks and no header row. For the
    /// one call whose result is an object rather than an account of itself —
    /// publishing an artifact. A call that failed, or has not finished, is never
    /// bare: then there is an account to give, and it needs its mark and its verb.
    public var bare = false
    /// Present only on a successful text read; the card's code block carries the
    /// same text for the inline preview.
    public var peek: FilePeek?

    public init(
        verb: String, subject: String?, subjectStyle: SubjectStyle = .plain, facets: [String] = [],
        blocks: [ToolBlock] = [], title: String? = nil, bare: Bool = false, peek: FilePeek? = nil
    ) {
        self.verb = verb
        self.subject = subject
        self.subjectStyle = subjectStyle
        self.facets = facets
        self.blocks = blocks
        self.title = title
        self.bare = bare
        self.peek = peek
    }
}

/// Short scalars promoted to header chips before the rest fall to a pairs block.
private let maxFacets = 4
/// Longest value that still reads as a chip rather than as content.
private let maxFacetLength = 24
/// Longest single-line value that belongs in a pairs table rather than its own block.
private let maxPairLength = 200

// MARK: - the factory

/// - Parameters:
///   - result: the tool's output, or nil while the call is still running.
///   - images: the pictures the result carried that the server kept; empty for
///     none (and on every server that predates keeping them).
public func buildToolCard(
    _ toolName: String, inputJson: String, result: String?, isError: Bool, images: [ToolResultImage] = []
) -> ToolCard {
    let input = tryParse(inputJson)
    let kept = images.isEmpty ? nil : images

    // With the pictures to show, the lines that stood in for them
    // ("[image: image/png, 12 KB]", "[screenshot attached]") say nothing.
    var card = compose(toolName, input, kept != nil ? withoutImageLines(result) : result, isError, kept)

    // A card that does not place its own pictures gets them after its body. Open,
    // because the picture is usually the point — except where it is the side
    // effect of an act, as each browser step's screenshot is.
    if let kept, !card.blocks.contains(where: \.isImage) {
        let open = !["browser_click", "browser_type", "browser_scroll", "browser_navigate"].contains(toolName)
        card.blocks += kept.map { picture($0, open: open) }
    }

    // A failure is the one thing nobody should have to tap for. Builders that know
    // something about their own errors — the shell lifting an exit code out of the
    // first line — write the block themselves and are left alone.
    guard isError, let result, !result.jsTrim.isEmpty else { return card }
    if card.blocks.contains(where: \.isErrorText) { return card }

    card.blocks.append(ToolBlock(label: "error", open: true, .text(tone: .error, text: result.jsTrim)))
    return card
}

/// The same card, for a call held at an approval gate. Everything opens: the
/// question is whether to authorize this, and a body behind a chevron is a body
/// nobody read. A shell command additionally gets its own block, because a header
/// ellipsis is exactly the wrong place to hide the second half of a command
/// somebody is about to approve.
public func buildProposalCard(_ toolName: String, inputJson: String) -> ToolCard {
    var card = buildToolCard(toolName, inputJson: inputJson, result: nil, isError: false)
    for index in card.blocks.indices { card.blocks[index].open = true }

    if card.subjectStyle == .command, let subject = card.subject.truthy,
       !card.blocks.contains(where: { $0.isCode && $0.label == "command" }) {
        card.blocks.insert(ToolBlock(label: "command", open: true, .code(language: nil, text: subject)), at: 0)
    }

    return card
}

private func compose(_ tool: String, _ input: JSONValue?, _ result: String?, _ isError: Bool, _ images: [ToolResultImage]?) -> ToolCard {
    switch tool {
    // ---- files ----
    case "edit_file": return editFile(input, result, isError)
    case "write_file": return writeFile(input, result, isError)
    case "read_file": return readFile(input, result, isError, images)
    // Claude Code's own read: `file_path` rather than `path`, otherwise the
    // same act, so the same card and the same peek.
    case "Read": return readFile(input, result, isError, images, pathKey: "file_path")
    case "list_dir": return listDir(input, result, isError)

    // ---- search ----
    case "grep_files": return grepFiles(input, result, isError)
    case "find_files": return findFiles(input, result, isError)

    // ---- shell ----
    // `Bash` and `PowerShell` are Claude Code's own shells: the same act, with a
    // description beside the command and `run_in_background` for `background`.
    // Its `timeout` is a ceiling in milliseconds, not something a reader needs
    // in the header.
    case "run_bash", "Bash": return shell("Bash", str(input, "command"), input, result, isError)
    case "run_powershell", "PowerShell": return shell("PowerShell", str(input, "command"), input, result, isError)
    case "run_on_node":
        let node = str(input, "node").truthy
        return shell(node.map { "Run on \($0)" } ?? "Run on node", str(input, "command"), input, result, isError)
    case "bash_output", "kill_job", "shell_monitor": return job(tool, input, result, isError)

    // ---- web ----
    case "fetch_url": return fetchUrl(input, result, isError)
    case "web_search": return webSearch(input, result, isError)

    // ---- agent ----
    case "open_subsession": return subSession("Open", str(input, "name"), input, result, isError)
    // The subject is the name the agent typed, which is how it thinks of the
    // partner; legacy rows carry an id there and their reply header is the only
    // place the name appears.
    case "prompt_subsession":
        return subSession(
            "Send to",
            str(input, "subsession") ?? subSessionName(result) ?? shortId(str(input, "subsession_id")),
            input, result, isError
        )
    case "promote_subsession":
        return named(promoteVerb(input), str(input, "subsession") ?? shortId(str(input, "subsession_id")), result, isError)
    case "stop_subsession":
        return named("Stop", str(input, "subsession") ?? shortId(str(input, "subsession_id")), result, isError)
    case "close_subsession":
        return named("Set aside", str(input, "subsession") ?? shortId(str(input, "subsession_id")), result, isError)
    case "run_subagent": return subagent(input, result, isError) // legacy transcripts
    case "skill": return named("Skill", str(input, "name"), result, isError)
    case "slopcoder_help": return named("Help", str(input, "topic") ?? "contents", result, isError)

    // ---- memory ----
    case "save_memory": return saveMemory(input, result, isError)
    case "read_memory": return memory("Recall", input, result, isError)
    case "delete_memory": return memory("Forget", input, result, isError)
    case "set_notepad": return notepad(input, result, isError)

    // ---- artifacts ----
    case "publish_artifact": return publishArtifact(input, result, isError)
    case "list_artifacts": return artifacts(result, isError)
    case "read_artifact": return named("Read artifact", str(input, "slug"), result, isError)
    case "delete_artifact": return named("Delete artifact", str(input, "slug"), result, isError)

    // ---- 3D scenes ----
    case "scene_open": return scene("Open scene", str(input, "path"), [], [], result, isError)
    case "scene_exec": return sceneExec(input, result, isError)
    case "scene_inspect":
        let subject: String?
        if let target = str(input, "object").truthy {
            subject = "\(str(input, "scene") ?? "") · \(target)"
        } else {
            subject = str(input, "scene")
        }
        return named("Inspect scene", subject, result, isError, style: .path)
    case "scene_render": return sceneRender(input, result, isError)
    case "scene_history":
        let action = str(input, "action")
        let verb = action == "diff" ? "Compare revisions" : action == "revert" ? "Revert scene" : "Scene history"
        return scene(verb, str(input, "scene"), int(input, "revision").map { ["rev \($0)"] } ?? [], [], result, isError)
    case "scene_export":
        return named("Export scene", str(input, "output") ?? str(input, "scene"), result, isError, style: .path)
    case "scene_api":
        return named("Scene API", str(input, "query").truthy ?? "overview", result, isError)

    // ---- forge ----
    case "create_pull_request": return createPullRequest(input, result, isError)
    case "get_pull_request_diff": return pullRequestDiff(input, result, isError)
    case "list_issues": return forge("Issues", str(input, "repo"), input, result, isError, list: true)
    case "list_pull_requests": return forge("Pull requests", str(input, "repo"), input, result, isError, list: true)
    case "get_issue": return forge("Issue", repoNumber(input), input, result, isError, list: false)
    case "get_pull_request": return forge("Pull request", repoNumber(input), input, result, isError, list: false)
    case "create_issue": return newIssue(input, result, isError)
    case "update_issue": return forge("Update issue", repoNumber(input), input, result, isError, list: false)
    case "add_issue_comment": return comment(input, result, isError)

    // ---- browser ----
    case "browser_navigate":
        return named("Navigate", str(input, "url") ?? str(input, "path"), result, isError, style: .url)
    case "browser_click": return browser("Click", input, result, isError)
    case "browser_type": return named("Type", str(input, "text"), result, isError)
    case "browser_scroll": return browser("Scroll", input, result, isError)
    case "browser_screenshot": return named("Screenshot", nil, result, isError)
    case "browser_read_console": return consoleCard(result, isError)

    // ---- app host ----
    case "app_start": return named("Start app", str(input, "repo"), result, isError)
    case "app_stop": return named("Stop app", nil, result, isError)
    case "app_output": return consoleCard(result, isError, verb: "App output")

    // ---- sessions ----
    case "search_sessions": return searchSessions(input, result, isError)
    case "read_session": return readSession(input, result, isError)

    case "transcribe_audio": return named("Transcribe", str(input, "path"), result, isError, style: .path)

    default: return fallback(tool, input, result, isError)
    }
}

// MARK: - the fallback

/// Where the fallback looks for a subject, in the order a reader would.
private let subjectKeys = ["path", "file", "url", "query", "pattern", "command", "title", "name", "message", "text", "id"]

private func fallback(_ tool: String, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    var verb = tool

    // mcp__<server>__<tool>: the server is context, the tool is the verb.
    if tool.jsStarts(with: "mcp__") {
        let rest = tool.jsDropping(prefix: "mcp__")
        if let split = rest.jsIndex(of: "__") {
            facets.append(rest.jsPrefix(upTo: split))
            verb = rest.jsSlice(rest.jsIndex(split, offsetBy: 2))
        } else {
            verb = rest
        }
    }

    verb = humanize(verb)

    var subject: String?
    var style = SubjectStyle.plain
    var pairs: [CardPair] = []
    var blocks: [ToolBlock] = []

    if case .object(let object)? = input {
        for key in subjectKeys {
            guard let found = str(input, key), !found.isEmpty, found.jsLength <= 120 else { continue }
            subject = found
            switch key {
            case "path", "file": style = .path
            case "url": style = .url
            case "command": style = .command
            default: style = .plain
            }
            break
        }

        for (key, value) in object.entries {
            if let subject, str(input, key) == subject, subjectKeys.contains(key) { continue }

            let (rendered, multiline) = render(value)
            if rendered.isEmpty { continue }

            if !multiline, rendered.jsLength <= maxFacetLength, facets.count < maxFacets {
                facets.append(facet(key, value, rendered))
            } else if !multiline, rendered.jsLength <= maxPairLength {
                pairs.append(CardPair(key: key, value: rendered))
            } else {
                blocks.append(ToolBlock(label: key, open: false, .code(language: nil, text: rendered)))
            }
        }
    } else if let input, !input.isNull {
        blocks.append(ToolBlock(label: "input", open: false, .code(language: nil, text: render(input).0)))
    }

    if !pairs.isEmpty { blocks.insert(ToolBlock(label: "input", open: false, .pairs(pairs)), at: 0) }
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: verb, subject: subject, subjectStyle: style, facets: facets, blocks: blocks)
}

// MARK: - files

private func editFile(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let lines = lineDiff(str(input, "old_str") ?? "", str(input, "new_str") ?? "", numbered: false)
    let added = lines.filter { $0.kind == .add }.count
    let removed = lines.filter { $0.kind == .remove }.count

    var facets: [String] = []
    if added > 0 { facets.append("+\(added)") }
    if removed > 0 { facets.append("-\(removed)") }
    if bool(input, "replace_all") { facets.append("every match") }

    var blocks: [ToolBlock] = []
    if !lines.isEmpty { blocks.append(ToolBlock(label: nil, open: true, .diff(lines))) }
    appendResult(&blocks, result, isError, .text, quietWhen: "Edited ")
    return ToolCard(verb: "Edit", subject: str(input, "path"), subjectStyle: .path, facets: facets, blocks: blocks)
}

private func writeFile(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let content = str(input, "content") ?? ""
    let lines = allAdded(content)
    var blocks: [ToolBlock] = []
    if !lines.isEmpty { blocks.append(ToolBlock(label: nil, open: true, .diff(lines))) }
    appendResult(&blocks, result, isError, .text, quietWhen: "Wrote ")
    return ToolCard(verb: "Write", subject: str(input, "path"), subjectStyle: .path, facets: [lineCount(content)], blocks: blocks)
}

/// A read. Of text, the text; of an image, the image — kept by the server and
/// named here by id. An image read with nothing kept (a transcript from before
/// images were, a shared copy, one over the cap) says what the agent looked at
/// instead of setting its placeholder line as code.
private func readFile(
    _ input: JSONValue?, _ result: String?, _ isError: Bool, _ images: [ToolResultImage]?, pathKey: String = "path"
) -> ToolCard {
    let path = str(input, pathKey)
    let looked = !isError && images == nil ? result.truthy.flatMap(imageRead) : nil
    var facets: [String] = []
    if let images, let first = images.first {
        facets.append(first.mediaType)
    } else if let looked {
        if let mediaType = looked.mediaType.truthy { facets.append(mediaType) }
    } else if let result = result.truthy {
        facets.append(lineCount(result))
    }
    if let offset = int(input, "offset") { facets.append("from \(offset)") }
    if let limit = int(input, "limit") { facets.append("limit \(limit)") }

    var blocks: [ToolBlock] = []
    if let images, !images.isEmpty {
        blocks += images.map { picture($0, open: true) }
        let rest = !isError ? (result.truthy?.jsTrim ?? "") : ""
        if !rest.isEmpty { blocks.append(ToolBlock(label: "result", open: false, .text(tone: .plain, text: rest))) }
        return ToolCard(verb: "Read", subject: path, subjectStyle: .path, facets: facets, blocks: blocks)
    }
    if let looked {
        var detail = ""
        if let mediaType = looked.mediaType.truthy {
            detail = looked.size.truthy.map { " (\(mediaType), \($0))" } ?? " (\(mediaType))"
        }
        blocks.append(ToolBlock(label: nil, open: false, .text(
            tone: .muted,
            text: "The agent looked at this image\(detail). It was not kept, so it cannot be shown here."
        )))
        return ToolCard(verb: "Read", subject: path, subjectStyle: .path, facets: facets, blocks: blocks)
    }

    var peek: FilePeek?
    if !isError, let result = result.truthy {
        // Trailing newlines only: `replace(/\n+$/, '')`.
        var scalars = Substring(result).unicodeScalars
        while scalars.last == "\n" { scalars.removeLast() }
        let body = String(scalars)
        if !body.isEmpty {
            blocks.append(ToolBlock(label: nil, open: false, .code(language: languageOf(path), text: body)))
            peek = FilePeek(path: path ?? "file", text: body, facets: facets)
        }
    }

    return ToolCard(verb: "Read", subject: path, subjectStyle: .path, facets: facets, blocks: blocks, peek: peek)
}

public struct ImageRead: Equatable, Sendable {
    public var mediaType: String?
    public var size: String?

    public init(mediaType: String? = nil, size: String? = nil) {
        self.mediaType = mediaType
        self.size = size
    }
}

/// The sentence a read leaves in place of an image — read_file's
/// `[read_file: shot.png — image/png, 12 KB]`, Claude Code's
/// `[image: image/png, 12 KB]` or bare `[image]` — taken apart. Nil for
/// anything else.
public func imageRead(_ result: String) -> ImageRead? {
    guard let match = firstMatch(
        #"^\[(?:read_file: .+ — |image: )(image\/[a-z0-9.+-]+)(?:, ([^\]]+))?\]$|^\[image\]$"#,
        in: result.jsTrim, caseInsensitive: true
    ) else { return nil }
    return ImageRead(mediaType: match[1]?.lowercased(), size: match[2])
}

/// The result without the lines that stood in for pictures — the image
/// sentences above, and the "[image attached]" / "[screenshot attached]" notes
/// MCP and browser tools write — for a card that has the pictures.
private func withoutImageLines(_ result: String?) -> String? {
    guard let result else { return nil }
    return result.jsSplit("\n").filter { line in
        let bare = line.jsTrim
        return imageRead(line) == nil && bare != "[image attached]" && bare != "[screenshot attached]"
    }.joined(separator: "\n")
}

private func picture(_ image: ToolResultImage, open: Bool) -> ToolBlock {
    ToolBlock(label: nil, open: open, .image(imageId: image.id, mediaType: image.mediaType, size: formatBytes(image.size)))
}

/// "812 B", "182 KB", "2.4 MB". Rounded half-up in integers, so it lands on the
/// same digit as the C#.
public func formatBytes(_ size: Int) -> String {
    if size < 1024 { return "\(size) B" }
    if size < 1024 * 1024 { return "\((size * 2 + 1024) / 2048) KB" }
    let tenths = (size * 20 + 1024 * 1024) / (2 * 1024 * 1024)
    return "\(tenths / 10).\(tenths % 10) MB"
}

private func listDir(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var entries: [String] = []
    if !isError, let result = result.truthy, result != "(empty)" { entries = rows(result) }
    var facets: [String] = []
    var blocks: [ToolBlock] = []
    if !entries.isEmpty {
        facets.append(count(entries.count, "entry", "entries"))
        blocks.append(ToolBlock(label: nil, open: false, .list(entries.map(plainEntry))))
    }

    return ToolCard(verb: "List", subject: str(input, "path").truthy ?? ".", subjectStyle: .path, facets: facets, blocks: blocks)
}

// MARK: - search

private func grepFiles(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let glob = str(input, "glob").truthy { facets.append(glob) }
    if let path = str(input, "path").truthy { facets.append(path) }

    var blocks: [ToolBlock] = []
    if !isError, let result = result.truthy {
        let hits = rows(result)
        if !hits.isEmpty {
            facets.insert(count(hits.count, "match", "matches"), at: 0)
            blocks.append(ToolBlock(label: nil, open: false, .list(hits.map(splitHit))))
        }
    }

    return ToolCard(verb: "Search", subject: str(input, "pattern"), subjectStyle: .plain, facets: facets, blocks: blocks)
}

private func findFiles(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let path = str(input, "path").truthy { facets.append(path) }

    var blocks: [ToolBlock] = []
    if !isError, let result = result.truthy {
        let found = rows(result)
        if !found.isEmpty {
            facets.insert(count(found.count, "file", "files"), at: 0)
            blocks.append(ToolBlock(label: nil, open: false, .list(found.map(plainEntry))))
        }
    }

    return ToolCard(verb: "Find", subject: str(input, "glob"), subjectStyle: .path, facets: facets, blocks: blocks)
}

/// `path:12: matched text` → the location, with the line beside it.
private func splitHit(_ row: String) -> ListEntry {
    let scalars = row.unicodeScalars
    guard let colon = row.jsIndex(of: ":"), colon > scalars.startIndex else { return plainEntry(row) }
    let afterColon = scalars.index(after: colon)
    guard let second = row.jsIndex(of: ":", from: afterColon), second > afterColon else { return plainEntry(row) }
    let between = row.jsSlice(afterColon, second)
    return between.isAllDigits
        ? ListEntry(text: row.jsPrefix(upTo: second), detail: row.jsSlice(scalars.index(after: second)).jsTrim)
        : plainEntry(row)
}

// MARK: - shell

private func shell(_ verb: String, _ command: String?, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if bool(input, "background") || bool(input, "run_in_background") { facets.append("background") }

    var body = result
    // run_bash prefixes its output with "exit code: N". That belongs in the
    // header; left in the body it reads as the command's first line of output on
    // every single call.
    if let text = body.truthy {
        let newline = text.jsIndex(of: "\n")
        let first = newline.map { text.jsPrefix(upTo: $0) } ?? text
        if first.jsStarts(with: "exit code: ") {
            facets.insert("exit \(first.jsDropping(prefix: "exit code: ").jsTrim)", at: 0)
            body = newline.map { text.jsSlice(text.unicodeScalars.index(after: $0)) } ?? ""
        }
    }

    var blocks: [ToolBlock] = []
    let title = str(input, "description")?.jsTrim.nonEmpty
    if title != nil, let command = command.truthy {
        blocks.append(ToolBlock(label: "command", open: false, .code(language: nil, text: command)))
    }

    let output = body.truthy?.jsTrimEnd ?? ""
    if !output.isEmpty {
        blocks.append(isError
            ? ToolBlock(label: "error", open: true, .text(tone: .error, text: output))
            : ToolBlock(label: "output", open: false, .code(language: nil, text: output)))
    }

    return ToolCard(verb: verb, subject: command, subjectStyle: .command, facets: facets, blocks: blocks, title: title)
}

private func job(_ tool: String, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let verb = tool == "kill_job" ? "Kill job" : tool == "shell_monitor" ? "Watch job" : "Job output"
    var facets: [String] = []
    if let pattern = str(input, "pattern").truthy { facets.append(pattern) }
    if let offset = int(input, "offset") { facets.append("from \(offset)") }

    var blocks: [ToolBlock] = []
    if !isError, let result = result.truthy {
        blocks.append(ToolBlock(label: "output", open: false, .code(language: nil, text: result.jsTrimEnd)))
    }
    return ToolCard(verb: verb, subject: str(input, "job_id"), subjectStyle: .plain, facets: facets, blocks: blocks)
}

// MARK: - web

private func fetchUrl(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let offset = int(input, "offset") { facets.append("from \(offset)") }
    if let max = int(input, "max_chars") { facets.append("max \(max)") }

    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: "Fetch", subject: str(input, "url"), subjectStyle: .url, facets: facets, blocks: blocks)
}

private func webSearch(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    listed("Search web", str(input, "query"), result, isError, one: "result", many: "results")
}

/// A subject and the rows the tool answered with, counted in a chip.
private func listed(_ verb: String, _ subject: String?, _ result: String?, _ isError: Bool, one: String, many: String) -> ToolCard {
    var facets: [String] = []
    var blocks: [ToolBlock] = []
    if !isError, let result = result.truthy {
        let found = rows(result)
        if !found.isEmpty {
            facets.append(count(found.count, one, many))
            blocks.append(ToolBlock(label: nil, open: false, .list(found.map(plainEntry))))
        }
    }
    return ToolCard(verb: verb, subject: subject, subjectStyle: .plain, facets: facets, blocks: blocks)
}

// MARK: - agent

/// One prompt to a sub-session and its reply: the parent's own record of what
/// it said and heard. The live card above the stream shows the conversation.
private func subSession(_ verb: String, _ subject: String?, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let profile = str(input, "profile").truthy { facets.append(profile) }
    if let model = str(input, "model").truthy { facets.append(model) }

    var blocks: [ToolBlock] = []
    if let prompt = str(input, "prompt").truthy {
        blocks.append(ToolBlock(label: "prompt", open: false, .text(tone: .plain, text: prompt)))
    }
    appendResult(&blocks, stripSubSessionHeader(result), isError, .text)
    return ToolCard(verb: verb, subject: subject, subjectStyle: .plain, facets: facets, blocks: blocks)
}

/// What a promotion is called depends on what moved: the model is the part a
/// reader wants on the card, since it is the one that costs.
private func promoteVerb(_ input: JSONValue?) -> String {
    if let model = str(input, "model").truthy { return "Move to \(model)" }
    if str(input, "profile").truthy != nil { return "Change profile" }
    if str(input, "effort").truthy != nil { return "Change effort" }
    return "Change"
}

private let subSessionHeader = "[sub-session \""

/// The sub-session's name, read off the reply header — the input only carries the id.
private func subSessionName(_ result: String?) -> String? {
    // Legacy only: sub-session turns used to run inside the tool call, and the
    // reply came back under a header while the input carried nothing but an id.
    guard let result, let at = result.jsIndex(of: subSessionHeader) else { return nil }
    let start = result.jsIndex(at, offsetBy: subSessionHeader.unicodeScalars.count)
    guard let end = result.jsIndex(of: "\"", from: start), end > start else { return nil }
    return result.jsSlice(start, end)
}

/// The reply without its header line, which the card's head already says.
private func stripSubSessionHeader(_ result: String?) -> String? {
    guard let result, result.jsStarts(with: subSessionHeader) else { return result }
    guard let newline = result.jsIndex(of: "\n") else { return "" }
    return result.jsSlice(result.unicodeScalars.index(after: newline))
}

/// The first block of a UUID, enough to tell sub-sessions apart in a row.
private func shortId(_ id: String?) -> String? {
    guard let id, id.jsLength > 8 else { return id }
    return id.utf16Prefix(8)
}

private func subagent(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let model = str(input, "model").truthy { facets.append(model) }

    var blocks: [ToolBlock] = []
    if let task = str(input, "task").truthy {
        blocks.append(ToolBlock(label: "task", open: false, .text(tone: .plain, text: task)))
    }
    if let acceptance = str(input, "acceptance").truthy {
        blocks.append(ToolBlock(label: "acceptance", open: false, .text(tone: .plain, text: acceptance)))
    }
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: "Subagent", subject: str(input, "agent_type") ?? "general", subjectStyle: .plain, facets: facets, blocks: blocks)
}

// MARK: - memory

private func saveMemory(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets = memoryFacets(input)
    if bool(input, "pinned") { facets.append("pinned") }

    var blocks: [ToolBlock] = []
    if let description = str(input, "description").truthy {
        blocks.append(ToolBlock(label: "description", open: false, .text(tone: .plain, text: description)))
    }
    if let content = str(input, "content").truthy {
        blocks.append(ToolBlock(label: "content", open: false, .text(tone: .plain, text: content)))
    }
    appendResult(&blocks, result, isError, .text, quietWhen: "Saved ")
    return ToolCard(verb: "Remember", subject: str(input, "name"), subjectStyle: .plain, facets: facets, blocks: blocks)
}

/// Publishing made a thing, so the card is the thing: a header that says what
/// happened, and under it the artifact itself — name, type, size — as something
/// to open rather than to read about.
///
/// Its details come back out of the tool's own sentence, which is then dropped:
/// once its parts are the header and the card, repeating it whole is the noise a
/// card exists to remove. A result we could not read still shows as it did.
private func publishArtifact(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let published = readPublished(result)
    let format = str(input, "format") ?? published.format
    let name = str(input, "slug") ?? published.slug

    // It worked and there is a thing: the thing is the card, and the transcript's
    // usual header would only say its name a second time.
    if published.slug.truthy != nil, !isError, let name = name.truthy {
        return ToolCard(
            verb: "Publish", subject: nil, subjectStyle: .plain, facets: [],
            blocks: [ToolBlock(label: nil, open: true, .artifact(
                name: name, kind: kindLabel(format), size: published.size, artifactId: published.artifactId
            ))],
            bare: true
        )
    }

    // Still running, refused, or a sentence we could not read: an account of the
    // call, which is what the header row is for.
    var blocks: [ToolBlock] = []
    if let name = name.truthy {
        blocks.append(ToolBlock(label: nil, open: true, .artifact(name: name, kind: kindLabel(format), size: nil, artifactId: nil)))
    }
    if let description = str(input, "description").truthy {
        blocks.append(ToolBlock(label: "description", open: false, .text(tone: .plain, text: description)))
    }
    if let path = str(input, "path").truthy {
        blocks.append(ToolBlock(label: "file", open: false, .text(tone: .plain, text: path)))
    }
    if let content = str(input, "content").truthy {
        blocks.append(ToolBlock(label: "content", open: false, .text(tone: .plain, text: content)))
    }
    appendResult(&blocks, result, isError, .text)

    return ToolCard(verb: "Publish", subject: str(input, "title"), subjectStyle: .plain, facets: [], blocks: blocks)
}

/// The format as a person would say it. Unknown formats keep their own word.
private func kindLabel(_ format: String?) -> String {
    switch format {
    case "markdown": return "Markdown"
    case "text": return "Text"
    case "html": return "HTML"
    case "json": return "JSON"
    case "csv": return "CSV"
    case "binary": return "File"
    case nil, "": return "Artifact"
    default: return format ?? "Artifact"
    }
}

/// The published list, as rows rather than as a paragraph — one artifact per
/// line is what the tool writes and what a reader scans.
private func artifacts(_ result: String?, _ isError: Bool) -> ToolCard {
    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .list, quietWhen: "No artifacts published")
    return ToolCard(verb: "Artifacts", subject: nil, subjectStyle: .plain, facets: [], blocks: blocks)
}

private struct Published {
    var slug: String?
    var format: String?
    var size: String?
    var version: String?
    var artifactId: String?
}

/// What `publish_artifact` said, taken apart. Independent lookups rather than
/// one match of the whole sentence: the wording is prose written for the model
/// to read, and a card that went blank because a comma moved would be worse than
/// one showing three facets out of four.
private func readPublished(_ result: String?) -> Published {
    guard let result = result.truthy, let slug = textBetween(result, "as artifact `", "`") else { return Published() }

    // "(markdown, 12.4 KB)" — the shape that follows the slug.
    var format: String?
    var size: String?
    if let shape = textBetween(result, "` (", ")"), let comma = shape.jsIndex(of: ", "), comma > shape.unicodeScalars.startIndex {
        format = shape.jsPrefix(upTo: comma)
        size = shape.jsSlice(shape.jsIndex(comma, offsetBy: 2))
    }

    let version = textBetween(result, "Republished (v", ")").truthy.map { "v\($0)" }

    // The id, not the URL: each client spells its own route to an artifact.
    var artifactId: String?
    let marker = "/artifacts/"
    if let at = result.jsIndex(of: marker) {
        let rest = result.jsSlice(result.jsIndex(at, offsetBy: marker.unicodeScalars.count))
        // A uuid has no dots, so the sentence's full stop is the end of it.
        if let end = rest.unicodeScalars.firstIndex(where: { $0 == " " || $0 == "." || $0 == "\n" }) {
            artifactId = rest.jsPrefix(upTo: end)
        } else {
            artifactId = rest
        }
    }

    return Published(slug: slug, format: format, size: size, version: version, artifactId: artifactId)
}

/// The text between two markers, or nil when either is missing.
private func textBetween(_ text: String, _ open: String, _ close: String) -> String? {
    guard let start = text.jsIndex(of: open) else { return nil }
    let from = text.jsIndex(start, offsetBy: open.unicodeScalars.count)
    guard let end = text.jsIndex(of: close, from: from) else { return nil }
    return text.jsSlice(from, end)
}

private func memory(_ verb: String, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: verb, subject: str(input, "name"), subjectStyle: .plain, facets: memoryFacets(input), blocks: blocks)
}

private func memoryFacets(_ input: JSONValue?) -> [String] {
    var facets: [String] = []
    if let scope = str(input, "scope").truthy { facets.append(scope) }
    if let repo = str(input, "repo").truthy { facets.append(repo) }
    return facets
}

private func notepad(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let text = str(input, "text") ?? ""
    var blocks: [ToolBlock] = []
    if !text.isEmpty { blocks.append(ToolBlock(label: nil, open: false, .text(tone: .plain, text: text))) }
    appendResult(&blocks, result, isError, .text, quietWhen: "Notepad ")
    return ToolCard(verb: text.isEmpty ? "Clear notepad" : "Notepad", subject: nil, subjectStyle: .plain, facets: [], blocks: blocks)
}

// MARK: - forge

private func createPullRequest(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let repo = str(input, "repo").truthy { facets.append(repo) }
    if let head = str(input, "head").truthy {
        facets.append(str(input, "base").truthy.map { "\(head) to \($0)" } ?? head)
    }

    var blocks: [ToolBlock] = []
    if let body = str(input, "body").truthy {
        blocks.append(ToolBlock(label: "body", open: false, .text(tone: .plain, text: body)))
    }
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: "Open PR", subject: str(input, "title"), subjectStyle: .plain, facets: facets, blocks: blocks)
}

private func pullRequestDiff(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var blocks: [ToolBlock] = []
    var facets: [String] = []
    if !isError, let result = result.truthy {
        let lines = parseUnifiedDiff(result)
        let added = lines.filter { $0.kind == .add }.count
        let removed = lines.filter { $0.kind == .remove }.count
        if added > 0 { facets.append("+\(added)") }
        if removed > 0 { facets.append("-\(removed)") }
        blocks.append(ToolBlock(label: nil, open: true, .diff(lines)))
    }

    return ToolCard(verb: "PR diff", subject: repoNumber(input), subjectStyle: .plain, facets: facets, blocks: blocks)
}

private func forge(_ verb: String, _ subject: String?, _ input: JSONValue?, _ result: String?, _ isError: Bool, list: Bool) -> ToolCard {
    var facets: [String] = []
    if let state = str(input, "state").truthy { facets.append(state) }
    if let labels = str(input, "labels").truthy { facets.append(labels) }
    if let page = int(input, "page"), page > 1 { facets.append("page \(page)") }

    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, list ? .list : .text)
    return ToolCard(verb: verb, subject: subject, subjectStyle: .plain, facets: facets, blocks: blocks)
}

private func newIssue(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var blocks: [ToolBlock] = []
    if let body = str(input, "body").truthy {
        blocks.append(ToolBlock(label: "body", open: false, .text(tone: .plain, text: body)))
    }
    appendResult(&blocks, result, isError, .text)
    return ToolCard(
        verb: "New issue", subject: str(input, "title"), subjectStyle: .plain,
        facets: str(input, "repo").truthy.map { [$0] } ?? [], blocks: blocks
    )
}

private func comment(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var blocks: [ToolBlock] = []
    if let body = str(input, "body").truthy {
        blocks.append(ToolBlock(label: nil, open: false, .text(tone: .plain, text: body)))
    }
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: "Comment", subject: repoNumber(input), subjectStyle: .plain, facets: [], blocks: blocks)
}

/// `owner/repo#42`, or whichever half is present.
private func repoNumber(_ input: JSONValue?) -> String? {
    let repo = str(input, "repo").truthy
    let number = int(input, "number")
    if let repo, let number { return "\(repo)#\(number)" }
    if let repo { return repo }
    return number.map { "#\($0)" }
}

// MARK: - browser

private func browser(_ verb: String, _ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let button = str(input, "button").truthy { facets.append(button) }
    if bool(input, "double_click") { facets.append("double") }
    if let delta = int(input, "delta_y") { facets.append("dy \(delta)") }

    var subject: String?
    if let x = int(input, "x"), let y = int(input, "y") { subject = "\(x), \(y)" }
    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: verb, subject: subject, subjectStyle: .plain, facets: facets, blocks: blocks)
}

private func consoleCard(_ result: String?, _ isError: Bool, verb: String = "Console") -> ToolCard {
    var blocks: [ToolBlock] = []
    if !isError, let result = result.truthy {
        blocks.append(ToolBlock(label: nil, open: false, .code(language: nil, text: result.jsTrimEnd)))
    }
    return ToolCard(verb: verb, subject: nil, subjectStyle: .plain, facets: [], blocks: blocks)
}

// MARK: - sessions

private func searchSessions(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    listed("Search sessions", str(input, "query"), result, isError, one: "hit", many: "hits")
}

private func readSession(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    var facets: [String] = []
    if let from = int(input, "from") { facets.append("from \(from)") }
    if let total = int(input, "count") { facets.append("\(total) events") }

    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: "Read session", subject: str(input, "session_id"), subjectStyle: .plain, facets: facets, blocks: blocks)
}

// MARK: - 3D scenes

/// The line a scene tool ends its result with when the picture it returned was kept.
private let renderMarker = "Render id: "

/// `Guid.TryParse` for the forms a result could carry, as the C# writes it back:
/// lower-case, dashed.
func parseGuid(_ text: String) -> String? {
    var scalars = Array(text.unicodeScalars)
    func isHex(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x30...0x39, 0x41...0x46, 0x61...0x66: return true
        default: return false
        }
    }

    var hex: [Unicode.Scalar]
    if scalars.count == 32, scalars.allSatisfy(isHex) {
        hex = scalars
    } else {
        // Braces or parentheses, but only as a matched pair.
        if let open = scalars.first, open == "{" || open == "(" {
            guard let close = scalars.last, close == (open == "{" ? "}" : ")") else { return nil }
            scalars = Array(scalars.dropFirst().dropLast())
        }
        guard scalars.count == 36 else { return nil }
        hex = []
        for (index, scalar) in scalars.enumerated() {
            if [8, 13, 18, 23].contains(index) {
                guard scalar == "-" else { return nil }
            } else {
                guard isHex(scalar) else { return nil }
                hex.append(scalar)
            }
        }
    }

    let h = String(String.UnicodeScalarView(hex)).lowercased()
    func part(_ from: Int, _ to: Int) -> Substring {
        h[h.index(h.startIndex, offsetBy: from)..<h.index(h.startIndex, offsetBy: to)]
    }
    return "\(part(0, 8))-\(part(8, 12))-\(part(12, 16))-\(part(16, 20))-\(part(20, 32))"
}

private struct SceneResult {
    var renderId: String?
    var revision: Int?
    var text: String?
}

/// A scene tool's result: the stored picture's id, the revision it names, and
/// the text with the id line taken off — it is an address for the card, and
/// repeating it under the picture it fetched is noise. Three independent
/// lookups, so a reworded result loses a detail rather than the whole card.
private func readScene(_ result: String?) -> SceneResult {
    guard let result = result.truthy else { return SceneResult(renderId: nil, revision: nil, text: result) }

    var renderId: String?
    var text = result
    if let at = result.jsLastIndex(of: renderMarker) {
        var id = result.jsSlice(result.jsIndex(at, offsetBy: renderMarker.unicodeScalars.count)).jsTrim
        if let end = id.unicodeScalars.firstIndex(where: { $0 == " " || $0 == "\n" || $0 == "\r" }) {
            id = id.jsPrefix(upTo: end)
        }
        if let parsed = parseGuid(id) {
            renderId = parsed
            text = result.jsPrefix(upTo: at).jsTrimEnd
        }
    }

    var revision: Int?
    let word = "Revision "
    if let mark = text.jsIndex(of: word) {
        let rest = text.jsSlice(text.jsIndex(mark, offsetBy: word.unicodeScalars.count))
        let digits = String(String.UnicodeScalarView(rest.unicodeScalars.prefix { (0x30...0x39).contains($0.value) }))
        if !digits.isEmpty, let number = Int(digits), number <= 2_147_483_647 { revision = number }
    }
    return SceneResult(renderId: renderId, revision: revision, text: text)
}

private func scene(
    _ verb: String, _ scenePath: String?, _ facets: [String], _ blocks: [ToolBlock], _ result: String?, _ isError: Bool
) -> ToolCard {
    var facets = facets
    var blocks = blocks
    let read = readScene(result)
    if !isError, let revision = read.revision, facets.isEmpty { facets.append("rev \(revision)") }
    appendResult(&blocks, read.text, isError, .text)
    return ToolCard(verb: verb, subject: scenePath, subjectStyle: .path, facets: facets, blocks: blocks)
}

/// A modelling script: the script behind a disclosure, and — open, because it
/// is the point — the picture of what the script made.
private func sceneExec(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let scenePath = str(input, "scene")
    let read = readScene(result)
    var facets: [String] = []
    var blocks: [ToolBlock] = []

    if let code = str(input, "code").truthy {
        blocks.append(ToolBlock(label: "script", open: false, .code(language: "csharp", text: code)))
    } else if let scriptPath = str(input, "script_path").truthy {
        blocks.append(ToolBlock(label: "script file", open: false, .text(tone: .plain, text: scriptPath)))
    }

    if !isError, let scenePath = scenePath.truthy {
        // "No revision made" names the revision the scene stayed at; the chip is
        // for a revision this call made.
        var made = false
        if let text = read.text {
            made = text.jsTrimStart.jsStarts(with: "Note:") ? text.jsContains("\nRevision ") : text.jsStarts(with: "Revision ")
        }
        if made, let revision = read.revision { facets.append("rev \(revision)") }
        if let renderId = read.renderId {
            blocks.append(ToolBlock(label: nil, open: true, .scene(scene: scenePath, revision: read.revision, renderId: renderId)))
        }
    }

    appendResult(&blocks, read.text, isError, .text)
    return ToolCard(verb: "Model", subject: scenePath, subjectStyle: .path, facets: facets, blocks: blocks)
}

private func sceneRender(_ input: JSONValue?, _ result: String?, _ isError: Bool) -> ToolCard {
    let scenePath = str(input, "scene")
    let read = readScene(result)
    var facets: [String] = []
    if let mode = str(input, "mode").truthy { facets.append(mode) }
    if case .object(let object)? = input, let views = object["views"]?.array {
        let names = views.compactMap(\.string)
        if !names.isEmpty, names.count <= 3 {
            facets.append(names.joined(separator: " "))
        } else if names.count > 3 {
            facets.append("\(names.count) views")
        }
    }

    var blocks: [ToolBlock] = []
    if !isError, let scenePath = scenePath.truthy, let renderId = read.renderId {
        blocks.append(ToolBlock(label: nil, open: true, .scene(scene: scenePath, revision: read.revision, renderId: renderId)))
    }
    appendResult(&blocks, read.text, isError, .text)
    return ToolCard(verb: "Look at scene", subject: scenePath, subjectStyle: .path, facets: facets, blocks: blocks)
}

// MARK: - shared shapes

private func named(_ verb: String, _ subject: String?, _ result: String?, _ isError: Bool, style: SubjectStyle = .plain) -> ToolCard {
    var blocks: [ToolBlock] = []
    appendResult(&blocks, result, isError, .text)
    return ToolCard(verb: verb, subject: subject, subjectStyle: style, facets: [], blocks: blocks)
}

private enum ResultStyle { case text, list }

/// Append the tool's output, unless the tool's own error handling will replace it
/// or it says nothing the header has not already said. `quietWhen` is the prefix
/// of a result that merely confirms the card's verb and subject — "Edited
/// src/Foo.cs" under a card headed "Edit src/Foo.cs" is the header again in a box.
private func appendResult(_ blocks: inout [ToolBlock], _ result: String?, _ isError: Bool, _ style: ResultStyle, quietWhen: String? = nil) {
    guard !isError, let result = result.truthy else { return }

    let trimmed = result.jsTrim
    if trimmed.isEmpty { return }
    if let quietWhen, trimmed.jsStarts(with: quietWhen), !trimmed.jsHasNewline { return }

    if style == .list {
        let found = rows(trimmed)
        if !found.isEmpty {
            blocks.append(ToolBlock(label: "result", open: false, .list(found.map(plainEntry))))
            return
        }
    }

    blocks.append(ToolBlock(label: "result", open: false, .text(tone: .plain, text: trimmed)))
}

// MARK: - reading JSON

/// The input as JSON, or nil when it is blank or not JSON at all. Any JSON
/// value, not only an object: the fallback shows a bare array or string as is.
private func tryParse(_ json: String) -> JSONValue? {
    if json.jsTrim.isEmpty { return nil }
    return JSONValue.parse(json)
}

private func str(_ input: JSONValue?, _ key: String) -> String? {
    guard case .object(let object)? = input else { return nil }
    return object[key]?.string
}

/// Whole numbers only, matching the C# `TryGetInt32`.
private func int(_ input: JSONValue?, _ key: String) -> Int? {
    guard case .object(let object)? = input, case .number(let value)? = object[key] else { return nil }
    guard value.isFinite, value == value.rounded(), abs(value) < 9.0e15 else { return nil }
    return Int(value)
}

private func bool(_ input: JSONValue?, _ key: String) -> Bool {
    guard case .object(let object)? = input else { return false }
    return object[key] == .bool(true)
}

/// A property as display text, and whether it spans lines.
private func render(_ value: JSONValue) -> (String, Bool) {
    switch value {
    case .string(let text): return (text, text.jsHasNewline)
    case .number(let number): return (JSONValue.format(number), false)
    case .bool(let flag): return (flag ? "true" : "false", false)
    case .null: return ("", false)
    case .array(let items):
        // ["bug","docs"] is a list of two words, and printing it as JSON to save
        // three lines of code is the habit this whole change is against.
        if items.allSatisfy(isScalar) { return (items.map { render($0).0 }.joined(separator: ", "), false) }
        return (value.serialized(), true)
    case .object:
        return (value.serialized(), true)
    }
}

private func isScalar(_ value: JSONValue) -> Bool {
    switch value {
    case .string, .number, .bool: return true
    default: return false
    }
}

/// `true` shows as the bare key; everything else as key and value.
private func facet(_ key: String, _ value: JSONValue, _ rendered: String) -> String {
    let label = key.replacingOccurrences(of: "_", with: " ")
    return value == .bool(true) ? label : "\(label) \(rendered)"
}

// MARK: - small text helpers

/// `get_weather` → `Get weather`.
public func humanize(_ name: String) -> String {
    let words = name.split(whereSeparator: { $0 == "-" || $0 == "_" || $0 == " " }).map(String.init)
    guard let first = words.first else { return name }
    let head = first.prefix(1).uppercased() + first.dropFirst()
    return words.count == 1 ? head : "\(head) \(words.dropFirst().joined(separator: " "))"
}

private func lineCount(_ text: String) -> String {
    count(splitLines(text.jsTrimEnd).count, "line", "lines")
}

private func rows(_ text: String) -> [String] {
    splitLines(text.jsTrimEnd).filter { !$0.isEmpty }
}

private func count(_ n: Int, _ one: String, _ many: String) -> String {
    "\(n) \(n == 1 ? one : many)"
}

private func plainEntry(_ text: String) -> ListEntry {
    ListEntry(text: text, detail: nil)
}

/// Syntax hint from the extension. Absent is fine — the renderer falls back to plain mono.
func languageOf(_ path: String?) -> String? {
    guard let path else { return nil }
    // The extension of the last segment, the way Path.GetExtension reads it — a
    // dot in a directory name is not an extension.
    let scalars = path.unicodeScalars
    var nameStart = scalars.startIndex
    if let separator = scalars.lastIndex(where: { $0 == "/" || $0 == "\\" }) { nameStart = scalars.index(after: separator) }
    let name = path.jsSlice(nameStart)
    guard let dot = name.unicodeScalars.lastIndex(of: ".") else { return nil }
    switch name.jsSlice(dot).lowercased() {
    case ".cs": return "csharp"
    case ".ts", ".tsx": return "typescript"
    case ".js", ".jsx", ".mjs", ".cjs": return "javascript"
    case ".json": return "json"
    case ".css": return "css"
    case ".html", ".razor", ".cshtml": return "html"
    case ".xml", ".csproj", ".props", ".targets": return "xml"
    case ".md": return "markdown"
    case ".sh", ".bash": return "bash"
    case ".ps1": return "powershell"
    case ".py": return "python"
    case ".swift": return "swift"
    case ".yml", ".yaml": return "yaml"
    case ".sql": return "sql"
    case ".toml": return "toml"
    default: return nil
    }
}

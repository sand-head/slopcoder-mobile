// Folding raw events into display items, ported from
// `SlopCoder.Web.Client/Pages/TranscriptFolder.cs` and `TranscriptGrouping.cs`.
//
// Events are not polymorphic JSON. Each envelope carries `kind` (the bare C#
// type name) and `payloadJson` — a JSON *string* holding the event, so parsing
// happens twice. `SubagentEvent` (legacy) nests a second envelope inside the first.
//
// The fold is incremental: it consumes only what is new, because a 75ms push
// must not refold a thousand-event transcript. Unknown kinds are skipped
// rather than thrown on — the server adds new ones, and an app in a store is
// always older than the server it talks to.

import Foundation

public enum ItemKind: String, Sendable {
    case user, text, think, tool, note, plan, approval, question, error, divider
    case subagentStart = "subagent-start"
    case subsession
    case subsessionReply = "subsession-reply"
    case chatMention = "chat-mention"
    case directMessage = "direct-message"
}

public struct PlanStep: Hashable, Sendable, Decodable {
    public var text: String
    /// `pending`, `in_progress` or `done`.
    public var status: String
    public var dependsOn: [Int]?

    public init(text: String, status: String, dependsOn: [Int]? = nil) {
        self.text = text
        self.status = status
        self.dependsOn = dependsOn
    }
}

/// A picture a tool result carried that the server kept.
public struct ToolResultImage: Hashable, Sendable {
    public var id: String
    public var mediaType: String
    public var size: Int

    public init(id: String, mediaType: String, size: Int) {
        self.id = id
        self.mediaType = mediaType
        self.size = size
    }
}

public struct UserItem: Hashable, Sendable {
    public var text: String
    public var steering: Bool
    /// What rode with the prompt, inline as the seam persisted it.
    public var images: [ImageAttachment]

    public init(text: String, steering: Bool, images: [ImageAttachment]) {
        self.text = text
        self.steering = steering
        self.images = images
    }
}

public struct TextItem: Hashable, Sendable {
    public var text: String
    public var durationMs: Double?

    public init(text: String, durationMs: Double? = nil) {
        self.text = text
        self.durationMs = durationMs
    }
}

public struct ToolItem: Hashable, Sendable {
    public var name: String
    public var input: String
    public var result: String?
    public var isError: Bool
    public var running: Bool
    /// Pictures the result carried that the server kept; empty for none.
    public var images: [ToolResultImage] = []

    public init(name: String, input: String, result: String?, isError: Bool, running: Bool, images: [ToolResultImage] = []) {
        self.name = name
        self.input = input
        self.result = result
        self.isError = isError
        self.running = running
        self.images = images
    }
}

public enum NoteTone: String, Sendable { case muted, ok, warn }
public enum TurnBoundary: String, Sendable { case completed, cancelled }

public struct NoteItem: Hashable, Sendable {
    public var text: String
    /// The renderer draws a mark from this; the fold does not pick a character.
    public var tone: NoteTone
    /// Which turn boundary this is, if it is one — what a subagent's status reduces over.
    public var turn: TurnBoundary?
    /// How long a completed turn took, when the server timed it.
    public var durationMs: Double?

    public init(text: String, tone: NoteTone, turn: TurnBoundary? = nil, durationMs: Double? = nil) {
        self.text = text
        self.tone = tone
        self.turn = turn
        self.durationMs = durationMs
    }
}

public struct ApprovalItem: Hashable, Sendable {
    public var requestId: String
    public var toolName: String
    public var input: String
    public var reason: String
    /// The classifier refused; a human saying yes is an override.
    public var refused: Bool
    public var approved: Bool?
    /// For a tool that always asks (posting to a forge), exactly what approving
    /// it would post — rendered text, as text, in full. The evidence the verdict
    /// rests on, not decoration.
    public var preview: String?

    public init(requestId: String, toolName: String, input: String, reason: String, refused: Bool, approved: Bool? = nil, preview: String? = nil) {
        self.requestId = requestId
        self.toolName = toolName
        self.input = input
        self.reason = reason
        self.refused = refused
        self.approved = approved
        self.preview = preview
    }
}

public struct QuestionItem: Hashable, Sendable {
    public var requestId: String
    public var questions: [UserQuestion]
    public var answers: [UserQuestionAnswer]?
    public var resolved: Bool

    public init(requestId: String, questions: [UserQuestion], answers: [UserQuestionAnswer]? = nil, resolved: Bool) {
        self.requestId = requestId
        self.questions = questions
        self.answers = answers
        self.resolved = resolved
    }
}

public struct ErrorItem: Hashable, Sendable {
    public var message: String
    public var detail: String?
    public var fault: Int

    public init(message: String, detail: String? = nil, fault: Int) {
        self.message = message
        self.detail = detail
        self.fault = fault
    }
}

/// Legacy: a nested subagent's header (transcripts persisted before sub-sessions).
public struct SubagentStartItem: Hashable, Sendable {
    public var subagentId: Int
    public var task: String
    public var model: String

    public init(subagentId: Int, task: String, model: String) {
        self.subagentId = subagentId
        self.task = task
        self.model = model
    }
}

/// A sub-session the agent opened: a whole session of its own, driven by this
/// agent. Only the anchor lives here — the card reads the sub-session's own
/// transcript.
public struct SubSessionItem: Hashable, Sendable {
    public var subSessionId: String
    /// The beat it was brought on for ("push relay").
    public var name: String
    public var model: String
    public var profile: String
    public var routeReason: String?
    /// The name it goes by ("Ada"); empty on sub-sessions from before personas.
    public var persona: String
    /// Its accent (`tintFor`); empty renders untinted.
    public var color: String

    public init(subSessionId: String, name: String, model: String, profile: String, routeReason: String? = nil, persona: String, color: String) {
        self.subSessionId = subSessionId
        self.name = name
        self.model = model
        self.profile = profile
        self.routeReason = routeReason
        self.persona = persona
        self.color = color
    }
}

/// A sub-session's reply arriving. Sub-sessions run on their own clock, so a
/// reply does not return to anyone: it reaches the driving agent on its own —
/// interrupting the turn the agent was having, or starting one if it was idle.
/// It is its own item rather than a `user` one because nobody typed it, and the
/// transcript must never suggest otherwise.
public struct SubSessionReplyItem: Hashable, Sendable {
    public var subSessionId: String
    public var persona: String
    /// The beat they are on, for the line under their name.
    public var name: String
    public var text: String
    public var isError: Bool
    public var color: String
    /// It landed inside a turn the agent was already having, rather than starting
    /// one. False on rows from before the server could interrupt.
    public var interjected: Bool

    public init(subSessionId: String, persona: String, name: String, text: String, isError: Bool, color: String, interjected: Bool) {
        self.subSessionId = subSessionId
        self.persona = persona
        self.name = name
        self.text = text
        self.isError = isError
        self.color = color
        self.interjected = interjected
    }
}

/// Another agent @mentioned this one in a chat room, and the message was pushed
/// here. Like a partner's reply, nobody typed it, so it is never a `user` item.
public struct ChatMentionItem: Hashable, Sendable {
    /// The room's name, without the '#'.
    public var room: String
    /// Its place in the room, as `read_room` numbers it.
    public var seq: Int
    /// The poster's chat handle, or the owner's display name for a human post.
    public var sender: String
    /// Durable owner provenance; false on agent messages and older servers.
    public var fromUser: Bool
    public var text: String
    public var interjected: Bool

    public init(room: String, seq: Int, sender: String, fromUser: Bool, text: String, interjected: Bool) {
        self.room = room
        self.seq = seq
        self.sender = sender
        self.fromUser = fromUser
        self.text = text
        self.interjected = interjected
    }
}

/// Agent-to-agent delivery; not a user instruction and not a room mention.
public struct DirectMessageItem: Hashable, Sendable {
    public var messageId: String
    public var senderSessionId: String?
    public var sender: String
    public var text: String
    public var interjected: Bool

    public init(messageId: String, senderSessionId: String? = nil, sender: String, text: String, interjected: Bool) {
        self.messageId = messageId
        self.senderSessionId = senderSessionId
        self.sender = sender
        self.text = text
        self.interjected = interjected
    }
}

/// One thing the transcript draws.
public struct Item: Hashable, Sendable, Identifiable {
    public enum Body: Hashable, Sendable {
        case user(UserItem)
        case text(TextItem)
        case think(TextItem)
        case tool(ToolItem)
        case note(NoteItem)
        case plan([PlanStep])
        case approval(ApprovalItem)
        case question(QuestionItem)
        case error(ErrorItem)
        case divider(label: String)
        case subagentStart(SubagentStartItem)
        case subsession(SubSessionItem)
        case subsessionReply(SubSessionReplyItem)
        case chatMention(ChatMentionItem)
        case directMessage(DirectMessageItem)
    }

    public var key: String
    public var ordinal: Int
    /// Original event time, absent on old or malformed records.
    public var at: String?
    /// The subagent this belongs to, or nil for the main thread.
    public var sub: Int?
    public var body: Body

    public var id: String { key }

    public var kind: ItemKind {
        switch body {
        case .user: return .user
        case .text: return .text
        case .think: return .think
        case .tool: return .tool
        case .note: return .note
        case .plan: return .plan
        case .approval: return .approval
        case .question: return .question
        case .error: return .error
        case .divider: return .divider
        case .subagentStart: return .subagentStart
        case .subsession: return .subsession
        case .subsessionReply: return .subsessionReply
        case .chatMention: return .chatMention
        case .directMessage: return .directMessage
        }
    }

    public var tool: ToolItem? {
        if case .tool(let value) = body { return value }
        return nil
    }

    public var note: NoteItem? {
        if case .note(let value) = body { return value }
        return nil
    }

    public var approval: ApprovalItem? {
        if case .approval(let value) = body { return value }
        return nil
    }

    public var question: QuestionItem? {
        if case .question(let value) = body { return value }
        return nil
    }

    /// The prose of a text, thinking or user item.
    public var text: String? {
        switch body {
        case .user(let value): return value.text
        case .text(let value), .think(let value): return value.text
        default: return nil
        }
    }

    public init(key: String, ordinal: Int, at: String? = nil, sub: Int? = nil, body: Body) {
        self.key = key
        self.ordinal = ordinal
        self.at = at
        self.sub = sub
        self.body = body
    }
}

/// These two tools render as their own thing — the plan checklist, the question
/// card — so their tool rows are noise. A *failed* call still shows, because
/// then the row is the only evidence.
private let foldedTools: Set<String> = ["update_plan", "ask_user_question"]

/// `ThinkingLevel`'s numbers, as the TUI and the export word them.
private let effortWords = ["off", "low", "medium", "high", "max"]

private func effortWord(_ effort: JSONValue, acceptName: Bool) -> String? {
    if let number = effort.int { return effortWords.indices.contains(number) ? effortWords[number] : nil }
    // ThinkingLevel crosses the wire as its numeric enum value, not its name.
    // Accept a name too so a hand-built or older payload remains readable.
    if acceptName, let name = effort.string, !name.isEmpty { return name.lowercased() }
    return nil
}

/// What a promotion did, as one phrase — the twin of the server's
/// `SubSessionMessage.Promotion`. Each field carries only what actually moved,
/// so a partner whose profile nobody touched must not read as promoted; an
/// older server sends a profile and nothing else, which still reads right.
func promotion(profile: String, model: String, effort: JSONValue) -> String {
    var parts: [String] = []
    if !profile.isEmpty { parts.append("promoted to \(profile)") }
    if !model.isEmpty { parts.append("moved to \(model)") }
    if let word = effortWord(effort, acceptName: true) { parts.append("set to \(word) effort") }
    if parts.isEmpty { return "changed" }
    if parts.count == 1 { return parts[0] }
    return "\(parts.dropLast().joined(separator: ", ")) and \(parts[parts.count - 1])"
}

/// The model divider's label. An Auto turn carries the effort the router settled
/// on (`ModelSelected.Effort`), and a change of effort alone is what puts a new
/// divider in the stream — so it has to be on the line, or two dividers in a row
/// read as the same thing said twice. A fixed-model turn's effort is the dial's,
/// already on screen, and older rows carry none.
public func modelDivider(model: String, autoRouted: Bool, effort: JSONValue) -> String {
    if !autoRouted { return model }
    if let word = effortWord(effort, acceptName: false) { return "\(model) · auto · \(word) effort" }
    return "\(model) · auto"
}

public struct TranscriptFolder: Sendable {
    public private(set) var all: [Item] = []
    private var processed = 0
    /// Open tool calls, keyed by subagent then name, awaiting their result. The
    /// value is the slot in `all`, not the item.
    private var openTools: [String: Int] = [:]
    private var directMessages: Set<String> = []

    /// Bumped whenever an item is added or replaced, and never otherwise.
    ///
    /// Every push from the hub re-folds, and almost none of them change anything
    /// here — a turn's text streams through the accumulator and only lands as an
    /// event when it is finished. Without a way to tell the difference, the
    /// screen would publish a fresh array per push and redraw every row.
    public private(set) var revision = 0

    public init() {}

    public mutating func reset() {
        all = []
        processed = 0
        openTools.removeAll()
        directMessages.removeAll()
        revision += 1
    }

    /// Fold everything not yet seen. Pass the whole window each time; the cursor
    /// makes repeat calls cheap.
    @discardableResult
    public mutating func fold(_ events: [AgentEventEnvelope]) -> [Item] {
        if processed < events.count {
            for index in processed..<events.count { consume(events[index], sub: nil, parentAt: nil) }
        }
        processed = events.count
        return all
    }

    /// A prepended page shifts everything; the caller must refold from scratch.
    @discardableResult
    public mutating func refold(_ events: [AgentEventEnvelope]) -> [Item] {
        reset()
        return fold(events)
    }

    /// Append, and say so. Returns the slot, for the things that come back to it.
    @discardableResult
    private mutating func add(_ item: Item) -> Int {
        revision += 1
        all.append(item)
        return all.count - 1
    }

    private mutating func replace(_ index: Int, _ item: Item) {
        revision += 1
        all[index] = item
    }

    private mutating func consume(_ envelope: AgentEventEnvelope, sub: Int?, parentAt: String?) {
        // A payload we cannot read is not worth a crash.
        guard let payload = JSONValue.parse(envelope.payloadJson), payload.object != nil else { return }

        let own = payload["at"].string
        let rawAt = WireDate.isValid(own) ? own : parentAt
        let lane = sub.map(String.init) ?? "main"
        func item(_ body: Item.Body) -> Item {
            Item(key: "\(envelope.ordinal):\(lane)", ordinal: envelope.ordinal, at: rawAt, sub: sub, body: body)
        }
        func str(_ name: String) -> String { payload[name].stringValue }

        switch envelope.kind {
        case "UserPrompt", "SteeringPrompt":
            add(item(.user(UserItem(
                text: str("text"),
                steering: envelope.kind == "SteeringPrompt",
                images: readImages(payload["images"])
            ))))

        case "AssistantText":
            add(item(.text(TextItem(text: str("text"), durationMs: payload["durationMs"].double))))

        case "ThinkingText":
            add(item(.think(TextItem(text: str("text"), durationMs: payload["durationMs"].double))))

        case "ToolCallStarted":
            let name = str("toolName")
            if foldedTools.contains(name) { break }
            let slot = add(item(.tool(ToolItem(name: name, input: str("inputJson"), result: nil, isError: false, running: true))))
            openTools["\(lane):\(name)"] = slot

        case "ToolCallFinished":
            let name = str("toolName")
            let isError = payload["isError"].truthy
            if let open = openTools["\(lane):\(name)"], var started = all[open].tool {
                started.result = str("result")
                started.isError = isError
                started.running = false
                let images = toolImages(payload["images"])
                if !images.isEmpty { started.images = images }
                var replaced = all[open]
                replaced.body = .tool(started)
                replace(open, replaced)
                openTools["\(lane):\(name)"] = nil
                break
            }
            // A folded tool that failed: show it after all, since nothing else will.
            if foldedTools.contains(name), isError {
                add(item(.tool(ToolItem(name: name, input: "", result: str("result"), isError: true, running: false))))
            }

        // Both reuse the tool row — a command is a tool call with a shell on the
        // other end, and setup output is one with the sandbox on it.
        case "CommandExecuted":
            add(item(.tool(ToolItem(
                name: "command", input: str("command"), result: str("output"),
                isError: payload["isError"].truthy, running: false
            ))))

        case "SetupOutput":
            let label = str("label")
            add(item(.tool(ToolItem(
                name: label.isEmpty ? "setup" : label, input: "", result: str("output"),
                isError: payload["isError"].truthy, running: false
            ))))

        case "PlanUpdated":
            let steps = payload["steps"].arrayValue.map { step in
                PlanStep(
                    text: step["text"].stringValue,
                    status: step["status"].stringValue,
                    dependsOn: step["dependsOn"].array?.compactMap(\.int)
                )
            }
            add(item(.plan(steps)))

        case "ApprovalRequested":
            let preview = str("preview")
            add(item(.approval(ApprovalItem(
                requestId: str("requestId"),
                toolName: str("toolName"),
                input: str("inputJson"),
                reason: str("reason"),
                refused: payload["refused"].truthy,
                approved: nil,
                preview: preview.isEmpty ? nil : preview
            ))))

        case "ApprovalResolved":
            let requestId = str("requestId")
            if let at = all.firstIndex(where: { $0.approval?.requestId == requestId }), var card = all[at].approval {
                card.approved = payload["approved"].truthy
                var replaced = all[at]
                replaced.body = .approval(card)
                replace(at, replaced)
            }

        case "QuestionAsked":
            add(item(.question(QuestionItem(
                requestId: str("requestId"),
                questions: payload["questions"].decoded([UserQuestion].self) ?? [],
                answers: nil,
                resolved: false
            ))))

        case "QuestionAnswered":
            let requestId = str("requestId")
            if let at = all.firstIndex(where: { $0.question?.requestId == requestId }), var card = all[at].question {
                card.answers = payload["answers"].decoded([UserQuestionAnswer].self)
                card.resolved = true
                var replaced = all[at]
                replaced.body = .question(card)
                replace(at, replaced)
            }

        case "AgentError":
            add(item(.error(ErrorItem(message: str("message"), detail: payload["detail"].string, fault: payload["fault"].intValue))))

        case "ModelSelected":
            add(item(.divider(label: modelDivider(
                model: str("model"), autoRouted: payload["autoRouted"] == .bool(true), effort: payload["effort"]
            ))))

        case "ContextCompacted":
            add(item(.divider(label: "context compacted")))

        case "TurnCompleted":
            add(item(.note(NoteItem(text: "done", tone: .ok, turn: .completed, durationMs: payload["durationMs"].double))))

        case "TurnCancelled":
            add(item(.note(NoteItem(text: "stopped (by you)", tone: .warn, turn: .cancelled))))

        case "CompletionRetry":
            add(item(.note(NoteItem(
                text: "retrying (\(js(payload, "attempt"))/\(js(payload, "maxAttempts"))) — \(str("reason"))", tone: .warn
            ))))

        case "SandboxStatus":
            add(item(.note(NoteItem(text: str("message"), tone: .muted))))

        case "CheckpointRestored":
            add(item(.note(NoteItem(text: "rewound to checkpoint \(js(payload, "number"))", tone: .muted))))

        case "SubagentStarted":
            add(item(.subagentStart(SubagentStartItem(
                subagentId: payload["subagentId"].intValue, task: str("task"), model: str("model")
            ))))

        case "SubSessionOpened":
            let profile = str("profile")
            add(item(.subsession(SubSessionItem(
                subSessionId: str("subSessionId"),
                name: str("name"),
                model: str("model"),
                profile: profile.isEmpty ? "general" : profile,
                routeReason: payload["routeReason"].string,
                persona: str("persona"),
                color: str("color")
            ))))

        case "SubSessionReplied":
            add(item(.subsessionReply(SubSessionReplyItem(
                subSessionId: str("subSessionId"),
                persona: str("persona"),
                name: str("name"),
                text: str("text"),
                isError: payload["isError"] == .bool(true),
                color: str("color"),
                interjected: payload["interjected"] == .bool(true)
            ))))

        case "DirectMessageReceived":
            let messageId = str("messageId")
            if !messageId.isEmpty {
                if directMessages.contains(messageId) { break }
                directMessages.insert(messageId)
            }
            let sender = payload["senderSessionId"].stringValue
            add(item(.directMessage(DirectMessageItem(
                messageId: messageId,
                senderSessionId: sender.isEmpty ? nil : sender,
                sender: str("sender"),
                text: str("text"),
                interjected: payload["interjected"] == .bool(true)
            ))))

        // Like a reply: nobody typed it, so it is never drawn as a prompt.
        case "ChatMentionReceived":
            add(item(.chatMention(ChatMentionItem(
                room: str("room"),
                seq: payload["seq"].intValue,
                sender: str("sender"),
                fromUser: payload["fromUser"] == .bool(true),
                text: str("text"),
                interjected: payload["interjected"] == .bool(true)
            ))))

        // The card reads its closed state off the sub-session itself; the close
        // tool's own row already marks the moment in the stream. A revival has no
        // tool row of its own — prompting renders as a prompt — so that one gets
        // a note, and so does a profile change.
        case "SubSessionClosed":
            break

        case "SubSessionReopened":
            add(item(.note(NoteItem(text: "sub-session picked back up", tone: .muted))))

        case "SubSessionPromoted":
            add(item(.note(NoteItem(
                text: "sub-session \(promotion(profile: str("profile"), model: str("model"), effort: payload["effort"]))",
                tone: .muted
            ))))

        case "SubagentEvent":
            // A second envelope inside the first: same shape, one level down.
            let inner = AgentEventEnvelope(
                ordinal: envelope.ordinal,
                kind: payload["innerKind"].stringValue,
                payloadJson: payload["innerPayloadJson"].string ?? "{}"
            )
            consume(inner, sub: payload["subagentId"].intValue, parentAt: rawAt)

        // UsageReport drives the context gauge, not the stream. Checkpoints
        // attach a rewind affordance to the prompt above rather than standing
        // alone. Neither produces an item, and neither is an error.
        default:
            break
        }
    }
}

/// A field as a template literal would have printed it, `undefined` included —
/// so a malformed record reads as malformed rather than as a tidy lie.
private func js(_ payload: JSONValue, _ name: String) -> String {
    payload.has(name) ? payload[name].display : "undefined"
}

/// A prompt's images as the seam persisted them: `mediaType` and `base64Data`,
/// or nothing for a text-only prompt and for every prompt from before
/// attachments existed. A malformed entry is dropped rather than rendered as
/// a broken picture.
private func readImages(_ raw: JSONValue) -> [ImageAttachment] {
    raw.arrayValue.compactMap { entry in
        guard let mediaType = entry["mediaType"].string,
              let base64Data = entry["base64Data"].string, !base64Data.isEmpty
        else { return nil }
        return ImageAttachment(mediaType: mediaType, base64Data: base64Data)
    }
}

/// `ToolCallFinished.images`, as far as it is well formed: a server older than
/// kept images sends nothing, and an entry missing a part is skipped rather
/// than drawn as a broken picture.
private func toolImages(_ value: JSONValue) -> [ToolResultImage] {
    value.arrayValue.compactMap { entry in
        guard let id = entry["id"].string, let mediaType = entry["mediaType"].string, let size = entry["size"].int else {
            return nil
        }
        return ToolResultImage(id: id, mediaType: mediaType, size: size)
    }
}

/// A one-line summary of a tool's input, for the collapsed row.
public func summarize(_ input: String, limit: Int = 80) -> String {
    if input.isEmpty { return "" }

    var text = input
    if let parsed = JSONValue.parse(input) {
        // The first string, in the order the server wrote the fields.
        let values: [JSONValue]
        switch parsed {
        case .object(let object): values = object.values
        case .array(let array): values = array
        default: values = []
        }
        if let first = values.lazy.compactMap(\.string).first { text = first }
    }

    text = text.collapsingWhitespace
    return text.jsLength > limit ? "\(text.utf16Prefix(limit - 1))…" : text
}

// MARK: - subagent grouping

/// One subagent's whole thread, collapsed into a single row anchored where the
/// subagent first appeared — the port of `TranscriptGrouping.Group`.
///
/// Without this every event a subagent emits lands in the main stream as it
/// happens, so a fan-out of three reads as one interleaved flood with no way to
/// tell whose tool call is whose. Here the main thread keeps its order and each
/// subagent's items are gathered under its own header, however they interleave.
public struct SubagentGroup: Hashable, Sendable {
    public var key: String
    public var subagentId: Int
    public var task: String
    public var model: String
    public var items: [Item]

    public init(key: String, subagentId: Int, task: String, model: String, items: [Item]) {
        self.key = key
        self.subagentId = subagentId
        self.task = task
        self.model = model
        self.items = items
    }
}

public enum Row: Hashable, Sendable, Identifiable {
    case item(Item)
    case subagent(SubagentGroup)

    public var id: String {
        switch self {
        case .item(let item): return item.key
        case .subagent(let group): return group.key
        }
    }
}

/// What a subagent's thread has come to, in the order the web decides it.
public enum SubagentState: String, Sendable { case running, done, cancelled, failed }

public func groupSubagents(_ items: [Item]) -> [Row] {
    var rows: [Row] = []
    var slots: [Int: Int] = [:]

    func groupSlot(_ id: Int) -> Int {
        if let slot = slots[id] { return slot }
        // Anchored at first sight.
        rows.append(.subagent(SubagentGroup(key: "sub:\(id)", subagentId: id, task: "", model: "", items: [])))
        slots[id] = rows.count - 1
        return rows.count - 1
    }

    func update(_ slot: Int, _ change: (inout SubagentGroup) -> Void) {
        guard case .subagent(var group) = rows[slot] else { return }
        change(&group)
        rows[slot] = .subagent(group)
    }

    for item in items {
        if case .subagentStart(let start) = item.body {
            // The header is the start event itself; a subagent that has said nothing
            // yet still gets its row, so the fan-out is visible as it begins.
            update(groupSlot(start.subagentId)) {
                $0.task = start.task
                $0.model = start.model
            }
        } else if let sub = item.sub {
            // A thread whose start scrolled out of the loaded window still groups;
            // it just has no task to show until the earlier page arrives.
            update(groupSlot(sub)) { $0.items.append(item) }
        } else {
            rows.append(.item(item))
        }
    }

    return rows
}

/// A failure dominates, then a stop, then a clean finish; otherwise the thread
/// is still going — the precedence `TranscriptGrouping.DeriveState` uses.
public func subagentState(_ items: [Item]) -> SubagentState {
    var done = false
    var cancelled = false
    for item in items {
        if item.kind == .error { return .failed }
        if item.note?.turn == .cancelled { cancelled = true }
        if item.note?.turn == .completed { done = true }
    }
    return cancelled ? .cancelled : done ? .done : .running
}

/// What a still-running subagent is doing: its latest tool, else a hint.
public func subagentDetail(_ items: [Item]) -> String {
    for item in items.reversed() {
        if let tool = item.tool { return tool.running ? "\(tool.name)…" : tool.name }
    }
    return items.contains { $0.kind == .think } ? "thinking…" : "working…"
}

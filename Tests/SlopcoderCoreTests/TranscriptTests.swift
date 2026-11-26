// The fold. The double-encoded payload and the nested subagent envelope are the
// two shapes most likely to be got wrong, so both are pinned here.

import Foundation
import Testing
@testable import SlopcoderCore

/// Builds envelopes the way the server nests them: `payloadJson` is a JSON
/// *string*, not an object.
final class Events {
    private var ordinal = 0

    func event(_ kind: String, _ payload: JSONValue) -> AgentEventEnvelope {
        defer { ordinal += 1 }
        return AgentEventEnvelope(ordinal: ordinal, kind: kind, payloadJson: payload.serialized())
    }

    /// A subagent's event, wrapped the way the server nests it.
    func sub(_ id: Int, _ innerKind: String, _ inner: JSONValue) -> AgentEventEnvelope {
        event("SubagentEvent", ["subagentId": .number(Double(id)), "innerKind": .string(innerKind), "innerPayloadJson": .string(inner.serialized())])
    }
}

private let partner = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

@Suite struct TranscriptFolderTests {
    @Test func rendersAPromptAndAReply() {
        let e = Events()
        var folder = TranscriptFolder()
        let items = folder.fold([e.event("UserPrompt", ["text": "hello"]), e.event("AssistantText", ["text": "hi there"])])
        #expect(items.map(\.kind) == [.user, .text])
        #expect(items.map(\.key) == ["0:main", "1:main"])
    }

    @Test func retainsValidPayloadTimesWithoutFabricatingMissingOrMalformedDates() {
        let e = Events()
        var folder = TranscriptFolder()
        let items = folder.fold([
            e.event("UserPrompt", ["text": "one", "at": "2026-11-22T12:34:00Z"]),
            e.event("AssistantText", ["text": "two"]),
            e.event("AssistantText", ["text": "three", "at": "not-a-date"]),
        ])
        #expect(items.map(\.at) == ["2026-11-22T12:34:00Z", nil, nil])
    }

    @Test func preservesNestedEventTimeOrAValidEnclosingTimeWhenAbsent() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("SubagentEvent", ["subagentId": 1, "at": "2026-11-21T10:00:00Z", "innerKind": "AssistantText",
                                      "innerPayloadJson": .string(#"{"text":"inner","at":"2026-11-22T10:00:00Z"}"#)]),
            e.event("SubagentEvent", ["subagentId": 2, "at": "2026-11-21T10:00:00Z", "innerKind": "AssistantText",
                                      "innerPayloadJson": .string(#"{"text":"fallback"}"#)]),
        ])
        #expect(folder.all.map(\.at) == ["2026-11-22T10:00:00Z", "2026-11-21T10:00:00Z"])
    }

    /// Images ride the prompt as the seam persisted them, or not at all.
    @Test func carriesAPromptsImagesThroughAndReadsAnOldPromptAsHavingNone() {
        let e = Events()
        var folder = TranscriptFolder()
        let items = folder.fold([
            e.event("UserPrompt", ["text": "what is this", "images": [["mediaType": "image/jpeg", "base64Data": "QUJD"]]]),
            e.event("UserPrompt", ["text": "plain"]),
            e.event("UserPrompt", ["text": "odd", "images": [["mediaType": "image/png"], .null]]),
        ])
        let images: [[ImageAttachment]] = items.map { if case .user(let user) = $0.body { return user.images } else { return [] } }
        #expect(images == [[ImageAttachment(mediaType: "image/jpeg", base64Data: "QUJD")], [], []])
    }

    @Test func foldsAFinishedToolCallBackIntoTheRowThatStartedIt() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("ToolCallStarted", ["toolName": "Read", "inputJson": #"{"path":"a.ts"}"#]),
            e.event("ToolCallFinished", ["toolName": "Read", "result": "contents", "isError": false]),
        ])
        #expect(folder.all.count == 1)
        #expect(folder.all[0].tool == ToolItem(name: "Read", input: #"{"path":"a.ts"}"#, result: "contents", isError: false, running: false))
    }

    @Test func keepsThePicturesAFinishedToolCallCarriedAndOnlyWellFormedOnes() {
        let e = Events()
        var folder = TranscriptFolder()
        let id = "0199c0de-0000-7000-8000-00000000cafe"
        folder.fold([
            e.event("ToolCallStarted", ["toolName": "Read", "inputJson": "{}"]),
            e.event("ToolCallFinished", ["toolName": "Read", "result": "[image: image/png, 1 KB]", "isError": false,
                                         "images": [["id": .string(id), "mediaType": "image/png", "size": 812], ["id": "x"], .null]]),
            e.event("ToolCallStarted", ["toolName": "Read", "inputJson": "{}"]),
            e.event("ToolCallFinished", ["toolName": "Read", "result": "text", "isError": false]),
        ])
        #expect(folder.all[0].tool?.images == [ToolResultImage(id: id, mediaType: "image/png", size: 812)])
        #expect(folder.all[1].tool?.images == [])
    }

    @Test func leavesAnUnfinishedToolCallMarkedRunning() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([e.event("ToolCallStarted", ["toolName": "Bash", "inputJson": "{}"])])
        #expect(folder.all[0].tool?.running == true)
    }

    @Test func suppressesUpdatePlanWhichRendersAsThePlanItself() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("ToolCallStarted", ["toolName": "update_plan", "inputJson": "{}"]),
            e.event("PlanUpdated", ["steps": [["text": "do it", "status": "in_progress"]]]),
        ])
        #expect(folder.all.map(\.kind) == [.plan])
        #expect(folder.all[0].body == .plan([PlanStep(text: "do it", status: "in_progress", dependsOn: nil)]))
    }

    @Test func showsASuppressedToolAfterAllWhenItFailed() {
        // Otherwise the failure has no representation anywhere.
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("ToolCallStarted", ["toolName": "update_plan", "inputJson": "{}"]),
            e.event("ToolCallFinished", ["toolName": "update_plan", "result": "bad plan", "isError": true]),
        ])
        #expect(folder.all.count == 1)
        #expect(folder.all[0].tool?.isError == true)
    }

    @Test func unwrapsASubagentEventAndTagsItWithItsId() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([e.sub(3, "AssistantText", ["text": "from the subagent"])])
        #expect(folder.all[0].kind == .text)
        #expect(folder.all[0].sub == 3)
        #expect(folder.all[0].text == "from the subagent")
        #expect(folder.all[0].key == "0:3")
    }

    @Test func anchorsASubSessionWhereItWasOpenedAndLetsItsClosePass() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("SubSessionOpened", ["subSessionId": .string(partner), "name": "relay tests", "model": "claude-sonnet-5",
                                         "profile": "coder", "routeReason": .null, "persona": "Ada", "color": "violet"]),
            e.event("SubSessionClosed", ["subSessionId": .string(partner)]),
        ])
        #expect(folder.all.count == 1)
        #expect(folder.all[0].sub == nil)
        #expect(folder.all[0].body == .subsession(SubSessionItem(
            subSessionId: partner, name: "relay tests", model: "claude-sonnet-5", profile: "coder",
            routeReason: nil, persona: "Ada", color: "violet"
        )))
        // Its own item, never grouped: the card reads the sub-session's own stream.
        #expect(groupSubagents(folder.all) == [.item(folder.all[0])])
    }

    @Test func aPartnersReplyIsItsOwnItemNeverOneThatReadsAsTheUsers() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("SubSessionReplied", ["subSessionId": .string(partner), "persona": "Ada", "name": "push relay", "turn": 2,
                                          "text": "Relay.cs, Push.cs and Dedupe.cs are the ones that matter.",
                                          "isError": false, "color": "violet"]),
            e.event("SubSessionReplied", ["subSessionId": .string(partner), "persona": "Ada", "name": "push relay", "turn": 4,
                                          "text": "the relay tests pass now.", "isError": false, "color": "violet", "interjected": true]),
        ])
        // Nobody typed it, so it must never fold into a `user` item. No flag on
        // the wire (or an older server): it started the turn.
        #expect(folder.all[0].body == .subsessionReply(SubSessionReplyItem(
            subSessionId: partner, persona: "Ada", name: "push relay",
            text: "Relay.cs, Push.cs and Dedupe.cs are the ones that matter.", isError: false, color: "violet", interjected: false
        )))
        guard case .subsessionReply(let second) = folder.all[1].body else { Issue.record("not a reply"); return }
        #expect(second.interjected)
    }

    @Test func aPromotionSaysWhatActuallyMoved() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            // Only the model: a partner whose profile nobody touched must not read
            // as promoted. ThinkingLevel is a numeric enum on the server's wire.
            e.event("SubSessionPromoted", ["subSessionId": .string(partner), "model": "claude-opus-5", "effort": 3]),
            // And an older server, which knows only about profiles.
            e.event("SubSessionPromoted", ["subSessionId": .string(partner), "profile": "coder"]),
            e.event("SubSessionReopened", ["subSessionId": .string(partner)]),
            e.event("SubSessionPromoted", ["subSessionId": .string(partner), "profile": "coder", "model": "m", "effort": "High"]),
            e.event("SubSessionPromoted", ["subSessionId": .string(partner)]),
        ])
        #expect(folder.all.map { $0.note?.text ?? "" } == [
            "sub-session moved to claude-opus-5 and set to high effort",
            "sub-session promoted to coder",
            "sub-session picked back up",
            "sub-session promoted to coder, moved to m and set to high effort",
            "sub-session changed",
        ])
    }

    @Test func foldsAResolutionIntoTheApprovalCardItBelongsTo() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("ApprovalRequested", ["requestId": "abc", "toolName": "Bash", "inputJson": "rm -rf /",
                                          "reason": "looks destructive", "refused": true]),
            e.event("ApprovalResolved", ["requestId": "abc", "approved": false]),
        ])
        #expect(folder.all.count == 1)
        // Absent on the wire reads as no preview — the card renders on this
        // field being nil.
        #expect(folder.all[0].approval == ApprovalItem(
            requestId: "abc", toolName: "Bash", input: "rm -rf /", reason: "looks destructive",
            refused: true, approved: false, preview: nil
        ))
    }

    /// A tool that always asks (posting to a forge) says exactly what approving
    /// it would post. If the fold dropped it, the phone would ask for a verdict
    /// on evidence the cockpit shows.
    @Test func carriesAPreviewThroughToTheApprovalCard() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([e.event("ApprovalRequested", ["requestId": "abc", "toolName": "PostComment", "inputJson": "{}",
                                                   "reason": "posting to a forge", "refused": false, "preview": "The comment, rendered."])])
        #expect(folder.all[0].approval?.preview == "The comment, rendered.")
        #expect(folder.all[0].approval?.approved == nil)
    }

    @Test func foldsAnAnswerIntoItsQuestion() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("QuestionAsked", ["requestId": "q1", "questions": [["text": "Which?", "options": ["a", "b"], "allowFreeText": true]]]),
        ])
        #expect(folder.all[0].question?.resolved == false)
        #expect(folder.all[0].question?.questions == [UserQuestion(text: "Which?", options: ["a", "b"], allowFreeText: true)])
        let before = folder.all[0]
        folder.fold([
            e.event("QuestionAsked", [:]),
            e.event("QuestionAnswered", ["requestId": "q1", "answers": [["question": "Which?", "answer": "a"]]]),
        ])
        #expect(folder.all[0].question?.resolved == true)
        #expect(folder.all[0].question?.answers == [UserQuestionAnswer(question: "Which?", answer: "a")])
        // An item changes value exactly when it changes; the one already drawn does not.
        #expect(before.question?.resolved == false)
    }

    /// Every push from the hub re-folds. Almost none of them add an event, and the
    /// screen needs to be able to tell, or it redraws the whole window.
    @Test func onlyMovesItsRevisionWhenTheFoldActuallyChanged() {
        let e = Events()
        var folder = TranscriptFolder()
        var events = [e.event("UserPrompt", ["text": "go"])]
        folder.fold(events)
        let settled = folder.revision
        folder.fold(events)
        folder.fold(events)
        #expect(folder.revision == settled)
        events.append(e.event("AssistantText", ["text": "done"]))
        #expect(folder.fold(events).count == 2)
        #expect(folder.revision > settled)
    }

    @Test func skipsWhatItCannotRead() {
        // The server adds event kinds; an app in a store is always older than it.
        let e = Events()
        var folder = TranscriptFolder()
        let items = folder.fold([
            e.event("SomethingInventedNextYear", ["whatever": true]),
            e.event("UsageReport", ["inputTokens": 10, "outputTokens": 2]),
            AgentEventEnvelope(ordinal: 2, kind: "AssistantText", payloadJson: "not json"),
            e.event("AssistantText", ["text": "still here"]),
        ])
        #expect(items.map(\.kind) == [.text])
    }

    @Test func wordsTheNotesAndDividers() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("ModelSelected", ["model": "opus", "autoRouted": true, "effort": 3]),
            e.event("ModelSelected", ["model": "opus", "autoRouted": true]),
            e.event("ModelSelected", ["model": "opus", "autoRouted": false, "effort": 3]),
            e.event("ContextCompacted", [:]),
            e.event("TurnCompleted", ["durationMs": 1250]),
            e.event("TurnCancelled", [:]),
            e.event("CompletionRetry", ["attempt": 2, "maxAttempts": 5, "reason": "overloaded"]),
            e.event("CheckpointRestored", ["number": 4]),
            e.event("SandboxStatus", ["message": "starting sandbox"]),
            e.event("CommandExecuted", ["command": "ls", "output": "a\nb", "isError": false]),
            e.event("SetupOutput", ["output": "ok"]),
            e.event("AgentError", ["message": "boom", "fault": 2]),
        ])
        let labels: [String] = folder.all.map { item in
            switch item.body {
            case .divider(let label): return label
            case .note(let note): return "\(note.tone.rawValue):\(note.text)"
            case .tool(let tool): return "tool:\(tool.name):\(tool.input)"
            case .error(let error): return "error:\(error.message):\(error.fault)"
            default: return "?"
            }
        }
        #expect(labels == [
            "opus · auto · high effort", "opus · auto", "opus", "context compacted",
            "ok:done", "warn:stopped (by you)", "warn:retrying (2/5) — overloaded",
            "muted:rewound to checkpoint 4", "muted:starting sandbox",
            "tool:command:ls", "tool:setup:", "error:boom:2",
        ])
        #expect(folder.all[4].note?.durationMs == 1250)
        #expect(folder.all[4].note?.turn == .completed)
    }

    @Test func aDirectMessageIsDeliveredOnce() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("DirectMessageReceived", ["messageId": "m1", "senderSessionId": "s9", "sender": "ada", "text": "hi"]),
            e.event("DirectMessageReceived", ["messageId": "m1", "senderSessionId": "s9", "sender": "ada", "text": "hi"]),
            e.event("ChatMentionReceived", ["room": "ops", "seq": 12, "sender": "bo", "text": "@you", "fromUser": true]),
        ])
        #expect(folder.all.map(\.kind) == [.directMessage, .chatMention])
        #expect(folder.all[0].body == .directMessage(DirectMessageItem(messageId: "m1", senderSessionId: "s9", sender: "ada", text: "hi", interjected: false)))
        #expect(folder.all[1].body == .chatMention(ChatMentionItem(room: "ops", seq: 12, sender: "bo", fromUser: true, text: "@you", interjected: false)))
    }
}

@Suite struct SummarizeTests {
    @Test func picksTheFirstStringOutOfAJSONInput() {
        #expect(summarize(#"{"path":"src/app.ts","limit":10}"#) == "src/app.ts")
        // In the order the server wrote it, not the alphabet's.
        #expect(summarize(#"{"zeta":"first","alpha":"second"}"#) == "first")
        #expect(summarize(#"{"limit":10,"query":"  spaced\n out "}"#) == "spaced out")
    }

    @Test func fallsBackToTheRawTextWhenItIsNotJSON() {
        #expect(summarize("ls -la") == "ls -la")
        #expect(summarize("") == "")
    }

    @Test func truncatesRatherThanWrappingTheRow() {
        let cut = summarize(String(repeating: "x", count: 200))
        #expect(cut.count == 80)
        #expect(cut.hasSuffix("…"))
    }
}

@Suite struct SubagentGroupingTests {
    @Test func gathersEachSubagentUnderOneRowAnchoredWhereItFirstAppeared() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("UserPrompt", ["text": "fan out"]),
            e.event("SubagentStarted", ["subagentId": 1, "task": "search the tree", "model": "haiku"]),
            e.event("SubagentStarted", ["subagentId": 2, "task": "read the docs", "model": "haiku"]),
            e.sub(1, "ToolCallStarted", ["toolName": "grep", "inputJson": "{}"]),
            e.sub(2, "ToolCallStarted", ["toolName": "read_file", "inputJson": "{}"]),
            e.sub(1, "ToolCallFinished", ["toolName": "grep", "result": "", "isError": false]),
            e.event("AssistantText", ["text": "meanwhile, on the main thread"]),
            e.sub(2, "AssistantText", ["text": "the docs say…"]),
            e.sub(1, "TurnCompleted", [:]),
        ])
        let rows = groupSubagents(folder.all)
        #expect(rows.map(\.id) == ["0:main", "sub:1", "sub:2", "6:main"])
        guard case .subagent(let one) = rows[1], case .subagent(let two) = rows[2] else { Issue.record("not grouped"); return }
        #expect(one.subagentId == 1)
        #expect(one.task == "search the tree")
        #expect(one.model == "haiku")
        #expect(two.task == "read the docs")
        // Interleaving does not fragment either thread, and the start row itself
        // is the group, not an item inside it.
        #expect(one.items.map(\.kind) == [.tool, .note])
        #expect(two.items.map(\.kind) == [.tool, .text])
        // Each thread pairs its own tool calls.
        #expect(one.items[0].tool?.running == false)
        #expect(two.items[0].tool?.running == true)
    }

    @Test func stillGroupsAThreadWhoseStartIsNotInTheLoadedWindow() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([e.sub(7, "AssistantText", ["text": "late"])])
        let rows = groupSubagents(folder.all)
        #expect(rows.count == 1)
        guard case .subagent(let group) = rows[0] else { Issue.record("not grouped"); return }
        #expect(group.subagentId == 7)
        #expect(group.task == "")
    }

    @Test func keepsARowForASubagentThatHasSaidNothingYet() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([e.event("SubagentStarted", ["subagentId": 1, "task": "think", "model": "opus"])])
        guard case .subagent(let group) = groupSubagents(folder.all)[0] else { Issue.record("not grouped"); return }
        #expect(group.items.isEmpty)
        #expect(subagentState([]) == .running)
    }

    func thread(_ kinds: String...) -> [Item] {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold(kinds.map { e.sub(1, $0, $0 == "AgentError" ? ["message": "boom"] : [:]) })
        return folder.all
    }

    @Test func derivesAThreadsState() {
        #expect(subagentState(thread("ThinkingText")) == .running)
        #expect(subagentState(thread("ThinkingText", "TurnCompleted")) == .done)
        // A failure wins over a completion, and over a stop.
        #expect(subagentState(thread("AgentError", "TurnCompleted")) == .failed)
        #expect(subagentState(thread("TurnCancelled", "TurnCompleted")) == .cancelled)
        #expect(subagentState(thread("TurnCancelled", "AgentError")) == .failed)
    }

    @Test func saysWhatARunningSubagentIsDoing() {
        let e = Events()
        var folder = TranscriptFolder()
        var events = [e.sub(1, "ToolCallStarted", ["toolName": "grep", "inputJson": "{}"])]
        folder.fold(events)
        #expect(subagentDetail(folder.all) == "grep…")
        events.append(e.sub(1, "ToolCallFinished", ["toolName": "grep", "result": "", "isError": false]))
        folder.fold(events)
        #expect(subagentDetail(folder.all) == "grep")
        #expect(subagentDetail([]) == "working…")
        #expect(subagentDetail(thread("ThinkingText")) == "thinking…")
    }
}

@Suite struct TranscriptLayoutTests {
    var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    func fold(_ events: [AgentEventEnvelope]) -> [Item] {
        var folder = TranscriptFolder()
        return folder.fold(events)
    }

    @Test func gathersConsecutiveToolCallsIntoOneRowAndLeavesALoneOneAlone() {
        let e = Events()
        let items = fold([
            e.event("UserPrompt", ["text": "go"]),
            e.event("CommandExecuted", ["command": "ls", "output": ""]),
            e.event("AssistantText", ["text": "now reading"]),
            e.event("ToolCallStarted", ["toolName": "read_file", "inputJson": "{}"]),
            e.event("ToolCallFinished", ["toolName": "read_file", "result": "x", "isError": false]),
            e.event("ToolCallStarted", ["toolName": "read_file", "inputJson": "{}"]),
            e.event("ToolCallFinished", ["toolName": "read_file", "result": "boom", "isError": true]),
            e.event("ToolCallStarted", ["toolName": "run_bash", "inputJson": "{}"]),
        ])
        let rows = TranscriptLayout.rows(items, calendar: utc)
        #expect(rows.map(\.id) == ["0:main", "1:main", "2:main", "tools:3:main"])
        guard case .toolRun(let run) = rows[3] else { Issue.record("not a run"); return }
        #expect(run.tools.map(\.key) == ["3:main", "5:main", "7:main"])
        #expect(run.phrase == "Read 2 files, ran 1 command, 1 failed…")
        #expect(run.running)
        #expect(run.failed)
    }

    /// A run the reader opened must stay open while later calls join it, which
    /// it only can if its identity is the call that started it.
    @Test func aRunKeepsItsIdentityAsItGrows() {
        let e = Events()
        var events = [
            e.event("CommandExecuted", ["command": "a", "output": ""]),
            e.event("CommandExecuted", ["command": "b", "output": ""]),
        ]
        let before = TranscriptLayout.rows(fold(events), calendar: utc).map(\.id)
        events.append(e.event("CommandExecuted", ["command": "c", "output": ""]))
        let after = TranscriptLayout.rows(fold(events), calendar: utc).map(\.id)
        #expect(before == ["tools:0:main"])
        #expect(after == before)
    }

    @Test func setsADateAboveTheFirstRowOfEachDay() {
        let e = Events()
        let items = fold([
            e.event("UserPrompt", ["text": "a", "at": "2026-11-22T23:50:00Z"]),
            e.event("AssistantText", ["text": "b", "at": "2026-11-22T23:59:00Z"]),
            e.event("AssistantText", ["text": "undated"]),
            e.event("UserPrompt", ["text": "c", "at": "2026-11-23T00:01:00Z"]),
        ])
        let rows = TranscriptLayout.rows(items, calendar: utc)
        #expect(rows.map(\.id) == ["date:0:main", "0:main", "1:main", "2:main", "date:3:main", "3:main"])

        // The day is the reader's, not the server's: ten to midnight UTC is
        // already tomorrow in Berlin, and the whole exchange is one day there.
        var berlin = Calendar(identifier: .gregorian)
        berlin.timeZone = TimeZone(identifier: "Europe/Berlin")!
        #expect(TranscriptLayout.rows(items, calendar: berlin).map(\.id) == ["date:0:main", "0:main", "1:main", "2:main", "3:main"])
    }

    @Test func aDateMarkerDoesNotSplitNothingAndBreaksARunOnlyWhereTheDayChanges() {
        let e = Events()
        let items = fold([
            e.event("CommandExecuted", ["command": "a", "output": "", "at": "2026-11-22T10:00:00Z"]),
            e.event("CommandExecuted", ["command": "b", "output": "", "at": "2026-11-22T10:01:00Z"]),
            e.event("CommandExecuted", ["command": "c", "output": "", "at": "2026-11-23T10:00:00Z"]),
        ])
        #expect(TranscriptLayout.rows(items, calendar: utc).map(\.id) == ["date:0:main", "tools:0:main", "date:2:main", "2:main"])
    }

    @Test func namesThePartnersTheProseMayMention() {
        let e = Events()
        let items = fold([
            e.event("SubSessionOpened", ["subSessionId": "s1", "name": "relay", "persona": "Ada", "color": "violet"]),
            e.event("SubSessionOpened", ["subSessionId": "s2", "name": "legacy"]),
        ])
        #expect(TranscriptLayout.mentions(items) == [SubSessionMention(persona: "Ada", color: "violet")])
    }

    @Test func readsTheContextGaugeAndTheStatusLine() {
        #expect(TranscriptLayout.contextPercent(nil) == nil)
        #expect(TranscriptLayout.contextPercent(UsageReport(inputTokens: 1, contextWindowTokens: 0)) == nil)
        #expect(TranscriptLayout.contextPercent(UsageReport(inputTokens: 100, cacheReadInputTokens: 300, cacheCreationInputTokens: 50, contextWindowTokens: 1000)) == 45)
        #expect(TranscriptLayout.contextPercent(UsageReport(inputTokens: 5000, contextWindowTokens: 1000)) == 100)

        #expect(TranscriptLayout.statusLine(nil) == nil)
        #expect(TranscriptLayout.statusLine(SessionState(status: .running, pendingApprovalIds: ["a"], pendingQuestionIds: ["q"])) == "Waiting for permission")
        #expect(TranscriptLayout.statusLine(SessionState(status: .running, pendingQuestionIds: ["q"])) == "Waiting for an answer")
        #expect(TranscriptLayout.statusLine(SessionState(status: .running, stopRequested: true)) == "Stopping")
        #expect(TranscriptLayout.statusLine(SessionState(status: .running)) == "Running")
        #expect(TranscriptLayout.statusLine(SessionState()) == "Idle")
    }

    @Test func opensTheDialsOnWhatTheSessionIsRunningAs() {
        let state = SessionState(connectionId: "c1", selectedModel: "opus", autoRoute: false, thinkingLevel: .high, approvalMode: .always, facetName: "plan")
        #expect(TranscriptLayout.turnOptions(state) == TurnOptions(
            selection: ModelSelection(auto: false, connectionId: "c1", modelId: "opus"), thinking: .high, approval: .always, facet: "plan"
        ))
    }
}

@Suite struct MediaTests {
    /// The key reaches everything its owner can, so it rides only to the server
    /// it belongs to — never to an address that merely appeared in a reply.
    @Test func sendsTheKeyOnlyToTheServerItBelongsTo() {
        let base = "https://slop.example.com/"
        #expect(Media.resolve("/artifacts/a/raw", baseUrl: base) == MediaSource(uri: "https://slop.example.com/artifacts/a/raw", authed: true))
        #expect(Media.resolve("artifacts/a/raw", baseUrl: base) == MediaSource(uri: "https://slop.example.com/artifacts/a/raw", authed: true))
        #expect(Media.resolve("https://SLOP.example.com/x.png", baseUrl: base) == MediaSource(uri: "https://SLOP.example.com/x.png", authed: true))
        #expect(Media.resolve("https://evil.example.com/x.png", baseUrl: base) == MediaSource(uri: "https://evil.example.com/x.png", authed: false))
        #expect(Media.resolve("https://slop.example.com.evil.io/x.png", baseUrl: base)?.authed == false)
        #expect(Media.resolve("http://slop.example.com/x.png", baseUrl: base)?.authed == false)
        #expect(Media.resolve("https://example.com/x.png", baseUrl: nil) == MediaSource(uri: "https://example.com/x.png", authed: false))
    }

    @Test func refusesWhatCannotBeShown() {
        #expect(Media.resolve("", baseUrl: "https://s") == nil)
        #expect(Media.resolve("//evil.example.com/x.png", baseUrl: "https://s") == nil)
        #expect(Media.resolve("/relative.png", baseUrl: nil) == nil)
        #expect(Media.resolve("file:///etc/passwd", baseUrl: "https://s") == nil)
        #expect(Media.resolve("data:text/html;base64,PGI+", baseUrl: "https://s") == nil)
        #expect(Media.resolve("data:image/png;base64,QUJD", baseUrl: nil) == MediaSource(uri: "data:image/png;base64,QUJD", authed: false))
    }

    @Test func tellsMediaFromText() {
        #expect(Media.mightBeMedia(kind: "File"))
        #expect(Media.mightBeMedia(kind: "Markdown") == false)
        #expect(Media.isAudio("audio/mpeg; codecs=x"))
        #expect(Media.isAudio("audio/") == false)
        #expect(Media.isVideo("video/mp4"))
        #expect(Media.isImage("IMAGE/PNG"))
        #expect([512, 1024, 186_368, 2_516_582].map(Media.megabytes) == ["1 KB", "1 KB", "182 KB", "2.4 MB"])
    }

    @Test func previewsTheOpeningOfARead() {
        let long = (1...40).map { "line \($0)" }.joined(separator: "\n")
        let preview = FilePeekPreview.preview(long)
        #expect(preview.cut)
        #expect(preview.text.split(separator: "\n").count == 12)
        #expect(FilePeekPreview.preview("a\nb").cut == false)
        #expect(FilePeekPreview.preview(String(repeating: "x", count: 5000)).text.count == 1600)
        #expect(FilePeekPreview.lineCount(long) == 40)
    }

    @Test func showsTheLastFewThingsOnAPartnersCard() {
        let e = Events()
        var folder = TranscriptFolder()
        folder.fold([
            e.event("UserPrompt", ["text": "do it"]),
            e.event("ThinkingText", ["text": "hm"]),
            e.event("AssistantText", ["text": "on it"]),
            e.event("ApprovalRequested", ["requestId": "a1", "toolName": "Bash", "inputJson": "{}"]),
            e.event("ApprovalResolved", ["requestId": "a1", "approved": true]),
            e.event("ApprovalRequested", ["requestId": "a2", "toolName": "Bash", "inputJson": "{}"]),
            e.event("TurnCompleted", [:]),
        ])
        // Thinking, the answered approval and the turn note are not card material.
        #expect(SubSessionPresentation.tail(folder.all).map(\.key) == ["0:main", "2:main", "5:main"])
        #expect(SubSessionPresentation.tail(folder.all, length: 1).map(\.key) == ["5:main"])
    }

    @Test func wordsAPartnersSpendAndState() {
        #expect(SubSessionPresentation.spend(tokens: 812, cost: nil) == "812 tok")
        #expect(SubSessionPresentation.spend(tokens: 8_250, cost: 0.105) == "8.3k tok ≈ $0.10")
        #expect(SubSessionPresentation.spend(tokens: 38_400, cost: 1) == "38k tok ≈ $1.00")
        #expect(SubSessionPresentation.spend(tokens: 2_400_000, cost: nil) == "2.4M tok")

        let now = TimeContext.fixed("2026-11-25T12:00:00Z")
        #expect(SubSessionPresentation.statusLabel(state: nil, failed: true) == "gone")
        #expect(SubSessionPresentation.statusLabel(state: nil, failed: false) == "")
        #expect(SubSessionPresentation.statusLabel(state: SessionState(status: .running, closed: true), failed: false) == "set aside")
        #expect(SubSessionPresentation.statusLabel(state: SessionState(status: .running, pendingQuestionIds: ["q"]), failed: false) == "waiting for you")
        #expect(SubSessionPresentation.statusLabel(state: SessionState(status: .running), failed: false) == "working")
        #expect(SubSessionPresentation.statusLabel(state: SessionState(lastActivityAt: "2026-11-25T11:55:00Z"), failed: false, in: now) == "idle · 5m ago")
    }
}

@Suite struct ArtifactPresentationTests {
    @Test func wordsAnArtifactsSize() {
        #expect([812, 1024, 186_368, 2_516_582, 15_728_640].map(ArtifactPresentation.bytes) == ["812 B", "1 KB", "182 KB", "2.4 MB", "15 MB"])
        let artifact = ArtifactSummary(id: "a", size: 186_368, version: 3, updatedAt: "2026-11-25T08:00:00Z")
        #expect(ArtifactPresentation.meta(artifact, in: .fixed("2026-11-25T12:00:00Z")) == "182 KB · v3 · Nov 25")
    }

    @Test func showsAnEarlierEditionUnderTheLatestsIdentity() async throws {
        let transport = RoutedTransport { request in
            if request.url.hasSuffix("/versions/2") {
                return (200, #"{"version":{"version":2,"title":"Old title","format":"text","contentType":"text/plain","size":10},"description":"as it was","text":"old body"}"#)
            }
            if request.url.hasSuffix("/versions/9") { return (404, "") }
            return (200, #"{"artifact":{"id":"a","slug":"weekly","title":"New title","format":"markdown","contentType":"text/markdown","size":99,"version":3,"shared":true,"sharePath":"a/tok"},"text":"new body"}"#)
        }
        let seam = Seam(baseUrl: "https://s", apiKey: "k", transport: transport)

        let latest = try await ArtifactPresentation.load(seam, id: "a", version: nil)
        #expect(latest?.text == "new body")
        #expect(latest?.pinned == nil)
        // Asking for the latest by number is asking for the latest.
        #expect(try await ArtifactPresentation.load(seam, id: "a", version: 3) == latest)

        let old = try await ArtifactPresentation.load(seam, id: "a", version: 2)
        #expect(old?.pinned == 2)
        #expect(old?.text == "old body")
        #expect(old?.artifact.title == "Old title")
        #expect(old?.artifact.format == .text)
        // Still the same artifact: its slug and its share link are the latest's.
        #expect(old?.artifact.slug == "weekly")
        #expect(old?.artifact.sharePath == "a/tok")

        let gone = try await ArtifactPresentation.load(seam, id: "a", version: 9)
        #expect(gone?.missingVersion == 9)
        #expect(gone?.text == "new body")
    }

    /// The web view carries the device's key on its first request, so it goes
    /// nowhere but the page it was opened on.
    @Test func keepsTheArtifactsWebViewOnItsOwnPage() {
        let page = "https://s/artifacts/a/view"
        #expect(ArtifactPresentation.mayLoad(page, page: page))
        #expect(ArtifactPresentation.mayLoad("\(page)#section", page: page))
        #expect(ArtifactPresentation.mayLoad("\(page)?x=1", page: page) == false)
        #expect(ArtifactPresentation.mayLoad("https://s/artifacts/b/view", page: page) == false)
        #expect(ArtifactPresentation.mayLoad("https://evil.example/", page: page) == false)
        #expect(ArtifactPresentation.opensExternally("https://example.com/docs", page: page))
        #expect(ArtifactPresentation.opensExternally("\(page)#x", page: page) == false)
        #expect(ArtifactPresentation.opensExternally("javascript:alert(1)", page: page) == false)
        #expect(ArtifactPresentation.opensExternally("file:///etc/passwd", page: page) == false)
    }
}

@Suite struct UsageFormatTests {
    @Test func compactsTokenCounts() {
        #expect([0, 812, 1_000, 8_250, 38_400, 2_400_000, 24_000_000].map(UsageFormat.compact) == ["0", "812", "1.0k", "8.3k", "38k", "2.4M", "24M"])
    }

    @Test func wordsMoneyWithoutRoundingAFractionOfACentToNothing() {
        #expect(UsageFormat.money(nil) == "—")
        #expect(UsageFormat.money(0) == "$0.00")
        #expect(UsageFormat.money(0.004) == "$0.004")
        #expect(UsageFormat.money(0.105) == "$0.10")
        #expect(UsageFormat.money(12.5) == "$12.50")
    }

    @Test func saysWhatIsLeftOfAPlansWindow() {
        #expect(UsageFormat.windowLabel(LimitWindow(label: "5-Hour", usedPercent: 38.4)) == "5-hour · 62% left")
        #expect(UsageFormat.windowLabel(LimitWindow(label: "Weekly", usedPercent: 140)) == "weekly · 0% left")
        #expect(UsageFormat.windowLabel(LimitWindow(label: "Weekly")) == "weekly · usage unknown")
        #expect(UsageFormat.planBilled(2))
        #expect(UsageFormat.planBilled(3))
        #expect(UsageFormat.planBilled(0) == false)
        #expect(UsageFormat.planBilled(nil) == false)
    }

    @Test func notesHowFreshAnAllowanceIs() {
        let now = TimeContext.fixed("2026-11-25T12:00:00Z")
        let codex = PlanQuotaSummary(observedAt: "2026-11-25T11:20:00Z", isStale: true, kind: .openAICodex, canRefresh: true)
        #expect(UsageFormat.quotaNote(codex, in: now) == "advisory · observed 11:20 · stale")
        // A Claude plan is only ever observed, as it runs a turn.
        let claude = PlanQuotaSummary(observedAt: "2026-11-25T09:05:00Z", kind: .claudeCode)
        #expect(UsageFormat.quotaNote(claude, in: now) == "advisory · as of the last turn, 09:05")
        #expect(UsageFormat.quotaNote(PlanQuotaSummary(), in: now) == "advisory")
    }
}

@Suite struct ReviewFormatTests {
    let pull = CodeReviewTarget(forgeKind: .forgejo, canonicalAuthority: "git.sand.town", repositoryOwner: "sand", repositoryName: "slop", pullRequestNumber: 42, headSha: "0123456789abcdef", kind: .pullRequest)

    @Test func namesWhatIsBeingReviewed() {
        #expect(ReviewFormat.targetLabel(pull) == "sand/slop#42")
        var range = pull
        range.kind = .commitRange
        range.rangeBaseSha = "fedcba9876543210"
        #expect(ReviewFormat.targetLabel(range) == "sand/slop fedcba9876..0123456789")
        var local = pull
        local.canonicalAuthority = "local"
        local.kind = .workingChanges
        local.rangeBaseSha = "abc"
        #expect(ReviewFormat.targetLabel(local) == "local workspace · uncommitted changes on abc")
        #expect(ReviewFormat.shortSha(nil) == "—")
        #expect(ReviewFormat.anchor(path: "a.swift", side: .head, start: 3, end: 3) == "a.swift:3")
        #expect(ReviewFormat.anchor(path: "a.swift", side: .base, start: 3, end: 9) == "a.swift:3-9 (base)")
    }

    @Test func wordsEachState() {
        #expect(ReviewFormat.isActive(.falsifying))
        #expect(ReviewFormat.isActive(.completed) == false)
        #expect(ReviewFormat.stateLabel(.completed, mode: .agent) == "ready for comments")
        #expect(ReviewFormat.stateLabel(.completed, mode: .pipeline) == "completed")
        #expect(ReviewFormat.stateLabel(CodeReviewAnalysisState(rawValue: 99)) == "unknown")
        #expect(ReviewFormat.publicationStateLabel(.partiallyPublished) == "partially published")
        #expect(ReviewFormat.publicationStateLabel(.published) == "published")
        #expect(ReviewFormat.itemStateLabel(.notPublishable) == "not publishable")
        #expect(ReviewFormat.tally(CodeReviewFindingCounts(p0: 1, p1: 0, p2: 3, p3: 0, open: 2)) == "P0 1 · P2 3")
    }

    @Test func saysWhatWasCoveredAndNeverLeavesAnAgentReviewLookingThorough() {
        var review = CodeReviewSessionReview()
        review.review.mode = .agent
        #expect(ReviewFormat.coverageLine(review) == "agent comments only · no automated coverage")
        review.review.mode = .pipeline
        review.review.state = .investigating
        #expect(ReviewFormat.coverageLine(review) == "not yet planned")
        review.review.state = .completed
        review.review.reviewCompleteness = .completeWithExclusions
        review.coverage = CodeReviewCoverage(reviewed: 12, inProgress: 0, excluded: 2, notReviewed: 1)
        #expect(ReviewFormat.coverageLine(review) == "complete, with exclusions · 12 reviewed · 1 not reviewed · 2 excluded")
    }

    /// A refused decision is never an overwrite.
    @Test func explainsADecisionThatDidNotSave() {
        #expect(ReviewFormat.decisionMessage(.updated) == nil)
        #expect(ReviewFormat.decisionMessage(.unchanged) == nil)
        #expect(ReviewFormat.decisionMessage(.versionConflict)?.contains("changed since you opened it") == true)
        #expect(ReviewFormat.decisionMessage(.superseded)?.contains("newer commit") == true)
        #expect(ReviewFormat.decisionMessage(nil)?.contains("gone, or is not yours") == true)

        var list = CodeReviewFindingList(state: .completed, consolidationDigest: "d")
        #expect(ReviewFormat.decidable(list))
        list.superseded = true
        #expect(ReviewFormat.decidable(list) == false)
        #expect(ReviewFormat.decidable(CodeReviewFindingList(state: .completed)) == false)
        #expect(ReviewFormat.decidable(CodeReviewFindingList(state: .investigating, consolidationDigest: "d")) == false)
    }

    @Test func knowsWhatCanStillBePublishedAndSaysWhatPublishingDid() {
        #expect(ReviewFormat.publishable(nil) == false)
        #expect(ReviewFormat.publishable(CodeReviewPublishableFinding(findingId: "f", placement: .inline)))
        #expect(ReviewFormat.publishable(CodeReviewPublishableFinding(findingId: "f", placement: .inline, refusal: "outside the diff")) == false)
        #expect(ReviewFormat.publishable(CodeReviewPublishableFinding(findingId: "f", placement: .inline, publishedIn: "p1")) == false)
        #expect(ReviewFormat.publishable(CodeReviewPublishableFinding(findingId: "f")) == false)

        #expect(ReviewFormat.publishMessage(nil) == "This review is gone, or is not yours.")
        #expect(ReviewFormat.publishMessage(CodeReviewPublishResult(status: .replayed)) == "This was already sent; showing that publication.")
        #expect(ReviewFormat.publishMessage(CodeReviewPublishResult(status: .ran, publication: CodeReviewPublicationView(state: .published, target: .issues))) == "Opened as issues in the repository.")
        #expect(ReviewFormat.publishMessage(CodeReviewPublishResult(status: .ran, publication: CodeReviewPublicationView(state: .failed, error: "403"))) == "Nothing was published. 403")
        #expect(ReviewFormat.publishMessage(CodeReviewPublishResult(status: .headMoved, reason: "The head moved.")) == "The head moved.")
        #expect(ReviewFormat.publishMessage(CodeReviewPublishResult(status: .busy)) == "Nothing was published.")
        #expect(ReviewFormat.safeHttpUrl("https://git.sand.town/x") == "https://git.sand.town/x")
        #expect(ReviewFormat.safeHttpUrl("javascript:alert(1)") == nil)
        #expect(ReviewFormat.safeHttpUrl(nil) == nil)
    }

    @Test func writesTheFixSessionsPromptAndRepository() {
        var detail = CodeReviewFindingDetail(trigger: "On a 404", badBehavior: "It crashes", causalChange: "The guard was removed", suggestedRemediation: " ")
        detail.finding = CodeReviewFindingSummary(id: "f", rank: 2, path: "src/a.swift", side: .head, startLine: 3, endLine: 5, title: "Crash on 404")
        let request = ReviewFormat.fixRequest(target: pull, detail: detail)
        #expect(request.repoUrl == "https://git.sand.town/sand/slop")
        #expect(request.prompt == "Fix this code review finding and open a PR with the fix.\n\nsand/slop#42 — #2 Crash on 404\nsrc/a.swift:3-5\n\nOn a 404\nIt crashes\nThe guard was removed")
        var github = pull
        github.forgeKind = .gitHub
        github.canonicalAuthority = "github.com"
        #expect(ReviewFormat.fixRequest(target: github, detail: detail).repoUrl == "https://github.com/sand/slop.git")
    }
}

@Suite struct ReviewCardTests {
    @Test func tagsAFindingByAuthorDecisionAndScore() {
        var finding = CodeReviewFindingSummary(id: "f", disposition: .accepted, provenance: .pipeline)
        finding.score.total = 71
        #expect(ReviewFormat.cardTags(finding).map(\.label) == ["accepted", "71"])
        #expect(ReviewFormat.cardTags(finding).first?.primary == true)
        let comment = CodeReviewFindingSummary(id: "f", disposition: .dismissed, provenance: .agentSession, hasSuggestion: true)
        #expect(ReviewFormat.cardTags(comment).map(\.label) == ["agent", "suggestion", "dismissed"])
    }

    @Test func numbersDiffRowsOnTheAnchoredSideAndMarksSkippedLines() {
        var diff = CodeReviewFindingDiff(side: .head)
        diff.lines = [
            CodeReviewFindingDiffLine(kind: .context, oldLine: 1, newLine: 1, text: "a"),
            CodeReviewFindingDiffLine(kind: .delete, oldLine: 2, newLine: nil, text: "b"),
            CodeReviewFindingDiffLine(kind: .add, oldLine: nil, newLine: 2, text: "c"),
            CodeReviewFindingDiffLine(kind: .context, oldLine: 9, newLine: 8, text: "d"),
        ]
        let rows = ReviewFormat.diffRows(diff)
        #expect(rows.map(\.number) == [1, nil, 2, 8])
        #expect(rows.map(\.gapBefore) == [false, false, false, true])
        diff.side = .base
        #expect(ReviewFormat.diffRows(diff).map(\.number) == [1, 2, nil, 9])
    }
}

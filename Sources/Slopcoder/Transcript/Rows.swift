#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// What every row needs from the session it sits in.
struct RowContext {
    /// A sub-session: its prompts come from the parent's agent, not from you.
    var parentDriven = false
    var roster: [SubSessionInfo] = []
    var mentions: [SubSessionMention] = []
    /// The only trustworthy source of approval liveness. An approval answered on
    /// a laptop is still sitting in the scrollback here.
    var pendingApprovals: [String] = []
    var pendingQuestions: [String] = []
    var onApprove: (String, Bool) -> Void = { _, _ in }
    var onAnswer: (String, [UserQuestionAnswer]?) -> Void = { _, _ in }
    var onOpenSession: (String) -> Void = { _ in }
}

/// ⑂ — a sub-session or subagent.
struct Fork: View {
    var color: Color

    var body: some View {
        Image(systemName: "arrow.triangle.branch")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: RowMetrics.gutter)
            .accessibilityHidden(true)
    }
}

/// A row that opens: a mark, a line of summary, a chevron, and what is under it.
struct Collapsible<Mark: View, Content: View>: View {
    let name: String
    var medium = true
    var strong = false
    @Binding var open: Bool
    @ViewBuilder var mark: () -> Mark
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: RowMetrics.gap) {
                    mark().frame(width: RowMetrics.gutter)
                    Text(name)
                        .font(medium ? AppFont.sansMedium(Reading.summarySize) : AppFont.sans(Reading.summarySize))
                        .foregroundStyle(strong ? Palette.foreground : Palette.mutedForeground)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Chevron(open: open)
                }
                .padding(.vertical, RowMetrics.paddingVertical)
                .padding(.horizontal, RowMetrics.paddingHorizontal)
                .frame(minHeight: RowMetrics.minHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? "Expanded" : "Collapsed")

            if open {
                VStack(alignment: .leading, spacing: 4, content: content)
                    .padding(.leading, 24)
                    .padding(.trailing, 4)
                    .padding(.bottom, 6)
            }
        }
    }
}

struct DisplayRowView: View {
    let row: DisplayRow
    let context: RowContext

    var body: some View {
        switch row {
        case .dateMarker(_, let at):
            Text(TranscriptLayout.dateLabel(at))
                .font(AppFont.sans(Reading.dateSize, relativeTo: .caption2))
                .foregroundStyle(Palette.mutedForeground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        case .toolRun(let run):
            ToolRunBlock(run: run, context: context)
        case .subagent(let group):
            SubagentBlock(group: group, context: context)
        case .item(let item):
            TranscriptRow(item: item, context: context)
        }
    }
}

/// "Read 3 files, ran 2 commands" — and, opened, each of them.
private struct ToolRunBlock: View {
    let run: ToolRun
    let context: RowContext
    @State private var open = false

    var body: some View {
        Collapsible(name: run.phrase, medium: false, open: $open) {
            Dot(color: run.failed ? Palette.destructive : Palette.mutedForeground, size: RowMetrics.dot)
        } content: {
            ForEach(run.tools) { tool in TranscriptRow(item: tool, context: context) }
        }
    }
}

/// One legacy subagent's whole thread under one header.
private struct SubagentBlock: View {
    let group: SubagentGroup
    let context: RowContext
    @State private var open = false

    var body: some View {
        let state = subagentState(group.items)
        let failure = group.items.lazy.compactMap { item -> String? in
            if case .error(let error) = item.body { return error.message }
            return nil
        }.first
        let detail: String = {
            switch state {
            case .failed: return summarize(failure ?? "failed", limit: 40)
            case .cancelled: return "stopped"
            case .done: return "done"
            case .running: return subagentDetail(group.items)
            }
        }()
        let tone: Color = {
            switch state {
            case .failed: return Palette.destructive
            case .done: return Status.ok
            case .cancelled: return Palette.mutedForeground
            case .running: return Status.running
            }
        }()

        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Fork(color: Status.subagent)
                    Text("subagent #\(group.subagentId)").font(AppFont.monoSemiBold(12.5)).foregroundStyle(Palette.foreground).fixedSize()
                    Mono([group.model, summarize(group.task)].filter { !$0.isEmpty }.joined(separator: " · ")).lineLimit(1)
                    Spacer(minLength: 0)
                    if state == .failed {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.destructive)
                    } else {
                        Dot(color: tone, filled: state != .cancelled, size: 7)
                    }
                    Mono(detail, size: 11, color: tone).lineLimit(1)
                    Chevron(open: open)
                }
                .padding(6)
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Subagent \(group.subagentId), \(group.task.isEmpty ? "no task" : group.task), \(detail)")
            .accessibilityValue(open ? "Expanded" : "Collapsed")

            if open {
                VStack(alignment: .leading, spacing: 4) {
                    if group.items.isEmpty {
                        Mono("Nothing yet.").padding(.vertical, 4)
                    } else {
                        ForEach(group.items) { item in TranscriptRow(item: item, context: context) }
                    }
                }
                .padding(.leading, 10)
                .padding(.bottom, 4)
                .overlay(alignment: .leading) { Status.subagent.opacity(0.45).frame(width: 2) }
                .padding(.leading, 11)
            }
        }
    }
}

struct TranscriptRow: View {
    let item: Item
    let context: RowContext
    @State private var open = false

    var body: some View {
        switch item.body {
        case .user(let user):
            userBubble(user)
        case .subsessionReply(let reply):
            replyRow(reply)
        case .directMessage(let message):
            directMessage(message)
        case .chatMention(let mention):
            chatMention(mention)
        case .text(let text):
            Prose(text.text, mentions: context.mentions)
                .padding(.top, 6)
                .padding(.bottom, 10)
        case .think(let thought):
            Collapsible(name: Captions.thoughtFor(thought.durationMs), open: $open) {
                Brain(color: Palette.mutedForeground)
            } content: {
                Text(thought.text)
                    .font(AppFont.sans(12.5).italic())
                    .foregroundStyle(Palette.mutedForeground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .tool(let tool):
            ToolCardView(
                card: buildToolCard(tool.name, inputJson: tool.input, result: tool.result, isError: tool.isError, images: tool.images),
                state: tool.running ? .running : tool.isError ? .failed : .ok
            )
        case .plan(let steps):
            Collapsible(name: Captions.planProgress(steps), strong: true, open: $open) {
                Image(systemName: "list.bullet").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.mutedForeground)
            } content: {
                ForEach(Array(steps.enumerated()), id: \.offset) { _, step in planStep(step) }
            }
        case .approval(let approval):
            ApprovalCard(
                approval: approval,
                pending: context.pendingApprovals.contains(approval.requestId),
                onDecide: { context.onApprove(approval.requestId, $0) }
            )
        case .question(let question):
            QuestionCard(
                question: question,
                pending: context.pendingQuestions.contains(question.requestId),
                onAnswer: { context.onAnswer(question.requestId, $0) }
            )
        case .error(let error):
            errorRow(error)
        case .subagentStart:
            // The header is the group's; see `SubagentBlock`.
            EmptyView()
        case .subsession(let sub):
            let known = context.roster.first { $0.id == sub.subSessionId }
            SubSessionCard(
                item: sub, queued: known?.queued ?? 0, spent: known?.newTokens ?? 0, cost: known?.cost,
                onOpen: context.onOpenSession
            )
        case .divider(let label):
            HStack(spacing: 10) {
                Palette.border.frame(height: 1)
                Meta(label).fixedSize()
                Palette.border.frame(height: 1)
            }
            .padding(.vertical, 8)
        case .note(let note):
            HStack(spacing: RowMetrics.gap) {
                Dot(
                    color: note.tone == .ok ? Status.ok : note.tone == .warn ? Status.running : Palette.mutedForeground,
                    filled: note.tone != .muted, size: RowMetrics.dot
                )
                .frame(width: RowMetrics.gutter)
                Text(note.turn == .completed ? Captions.turnCompleteLabel(note.durationMs, subagent: item.sub != nil) : note.text)
                    .font(AppFont.sans(Reading.noteSize))
                    .foregroundStyle(Palette.mutedForeground)
                Spacer(minLength: 0)
            }
            .padding(.vertical, RowMetrics.paddingVertical)
            .padding(.horizontal, RowMetrics.paddingHorizontal)
            .frame(minHeight: RowMetrics.minHeight)
        }
    }

    // MARK: rows

    private func userBubble(_ user: UserItem) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            VStack(alignment: .leading, spacing: 6) {
                if !user.images.isEmpty { PromptImages(images: user.images) }
                if !user.text.isEmpty {
                    Text(user.text)
                        .font(AppFont.sans(Reading.userSize))
                        .foregroundStyle(Palette.foreground)
                        .lineSpacing(Reading.userLineSpacing)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(
                Palette.userBubble,
                in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 4, topTrailingRadius: 18)
            )

            // Who said it, where that is not simply "you": a parent agent's
            // prompt must never read as something the user typed.
            if context.parentDriven || user.steering {
                Meta(context.parentDriven ? (user.steering ? "parent agent · mid-turn" : "parent agent") : "you · steering")
                    .padding(.horizontal, 3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 24)
        .padding(.vertical, 12)
    }

    /// The rule above a message somebody other than the user or the agent sent.
    private func attributed<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4, content: content)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .topBorder()
            .padding(.top, 12)
            .padding(.bottom, 4)
    }

    private func replyRow(_ reply: SubSessionReplyItem) -> some View {
        let tint = Tint.color(reply.color) ?? Status.subagent
        let who = reply.persona.isEmpty ? reply.name : reply.persona
        var caption = Text(who).font(AppFont.sansMedium(Reading.summarySize)).foregroundStyle(Palette.foreground) + Text(" replied")
        if !reply.name.isEmpty, reply.name != who { caption = caption + Text(" · \(reply.name)") }
        if reply.isError { caption = caption + Text(" · hit an error") }
        if reply.interjected { caption = caption + Text(" · mid-turn") }
        return attributed {
            HStack(spacing: 6) {
                Fork(color: tint)
                caption.font(AppFont.sans(Reading.summarySize)).foregroundStyle(Palette.mutedForeground)
            }
            Text(reply.text)
                .font(AppFont.sans(Reading.proseSmallSize))
                .lineSpacing(Reading.proseSmallLineSpacing)
                .foregroundStyle(reply.isError ? Palette.destructive : Palette.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 18)
        }
    }

    private func sender(_ name: String, tint: Color?, suffix: String) -> Text {
        var text = Text("")
        if let tint { text = text + Text("@").font(AppFont.sansMedium(Reading.captionSize)).foregroundStyle(tint) }
        return text + Text(name).font(AppFont.sansMedium(Reading.captionSize)).foregroundStyle(Palette.foreground) + Text(suffix)
    }

    private func directMessage(_ message: DirectMessageItem) -> some View {
        let tint = Tint.color(handleTint(message.sender)) ?? Status.subagent
        let caption = sender(message.sender, tint: tint, suffix: " · direct agent message\(message.interjected ? " · mid-turn" : "")")
            .font(AppFont.sans(Reading.captionSize))
            .foregroundStyle(Palette.mutedForeground)
        return attributed {
            if let senderId = message.senderSessionId {
                Button { context.onOpenSession(senderId) } label: { caption }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open agent session for \(message.sender)")
            } else {
                caption
            }
            Text(message.text)
                .font(AppFont.sans(Reading.captionSize))
                .foregroundStyle(Palette.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 18)
        }
    }

    private func chatMention(_ mention: ChatMentionItem) -> some View {
        let tint = mention.fromUser ? nil : Tint.color(handleTint(mention.sender)) ?? Status.subagent
        let name = mention.fromUser ? "\(mention.sender) · owner" : mention.sender
        return attributed {
            sender(name, tint: tint, suffix: " · #\(mention.room) · message \(mention.seq)\(mention.interjected ? " · mid-turn" : "")")
                .font(AppFont.sans(Reading.captionSize))
                .foregroundStyle(Palette.mutedForeground)
            Text(mention.text)
                .font(AppFont.sans(Reading.captionSize))
                .foregroundStyle(Palette.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 18)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(mention.sender) mentioned this agent in former room #\(mention.room)")
    }

    private func planStep(_ step: PlanStep) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
                if step.status == "done" {
                    Dot(color: Status.ok, size: 8)
                } else if step.status == "in_progress" {
                    HalfDot(color: Status.running, size: 9)
                } else {
                    Dot(color: Palette.mutedForeground, filled: false, size: 8)
                }
            }
            .frame(width: 10)
            Text(step.text)
                .font(AppFont.sans(12.5))
                .foregroundStyle(step.status == "done" ? Palette.mutedForeground : Palette.foreground)
                .strikethrough(step.status == "done")
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func errorRow(_ error: ErrorItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.destructive)
                Text(error.message)
                    .font(AppFont.sans(13))
                    .foregroundStyle(Palette.destructive)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let detail = error.detail, !detail.isEmpty {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
                } label: {
                    Meta(open ? "hide detail" : "what the provider said")
                }
                .buttonStyle(.plain)
                if open {
                    ScrollView {
                        Text(detail)
                            .font(AppFont.mono(11.5))
                            .foregroundStyle(Palette.destructive)
                            .textSelection(.enabled)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 260)
                    .fixedSize(horizontal: false, vertical: true)
                    .background(Palette.destructive.opacity(0.05), in: RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.destructive.opacity(0.3), lineWidth: 1))
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.destructive.opacity(0.05), in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.destructive.opacity(0.3), lineWidth: 1))
        .padding(.vertical, 6)
    }
}

/// The photos that rode a prompt, as thumbnails that open full screen.
private struct PromptImages: View {
    let images: [ImageAttachment]
    @State private var viewing: Int?

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(images.enumerated()), id: \.offset) { index, attachment in
                Button { viewing = index } label: {
                    Group {
                        if let image = decode(attachment) {
                            Image(uiImage: image).resizable().scaledToFill()
                        } else {
                            Palette.muted
                        }
                    }
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.primary.opacity(0.25), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Attached image \(index + 1) of \(images.count)")
                .accessibilityHint("Opens full screen")
            }
        }
        .fullScreenCover(isPresented: Binding(get: { viewing != nil }, set: { if !$0 { viewing = nil } })) {
            if let index = viewing, images.indices.contains(index), let image = decode(images[index]) {
                ImageViewer(image: image, label: "Attached image \(index + 1) of \(images.count)")
            }
        }
    }

    private func decode(_ attachment: ImageAttachment) -> UIImage? {
        Data(base64Encoded: attachment.base64Data).flatMap(UIImage.init(data:))
    }
}

/// A tool call stopped at the gate: what it would do, and the two answers.
private struct ApprovalCard: View {
    let approval: ApprovalItem
    let pending: Bool
    let onDecide: (Bool) -> Void

    var body: some View {
        let verdict = Captions.approvalVerdict(approved: approval.approved, pending: pending, refused: approval.refused)
        let border = pending ? Status.running.opacity(0.5) : approval.approved == false ? Palette.destructive.opacity(0.3) : Palette.border
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Permission request").font(AppFont.sansMedium(12.5)).foregroundStyle(Palette.foreground)
                Spacer(minLength: 0)
                if let verdict {
                    Text(verdict).font(AppFont.sansMedium(10, relativeTo: .caption2)).foregroundStyle(Palette.mutedForeground)
                }
            }

            if !approval.reason.isEmpty {
                Text(approval.reason).font(AppFont.sans(12)).foregroundStyle(Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }

            // Everything open: the question is whether to authorize this, and a
            // body behind a chevron is a body nobody read.
            ToolCardView(card: buildProposalCard(approval.toolName, inputJson: approval.input), state: .pending, forceOpen: true)

            // For a tool that posts to a forge: exactly what approving it would
            // post, in full, as text. The evidence the verdict rests on.
            if let preview = approval.preview {
                VStack(alignment: .leading, spacing: 4) {
                    Meta("What will be posted — read it before approving")
                    Text(preview)
                        .font(AppFont.mono(11.5))
                        .foregroundStyle(Palette.foreground)
                        .lineSpacing(5)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
            }

            if pending {
                HStack(spacing: 8) {
                    Spacer()
                    // The classifier already refused: saying yes is an override,
                    // and the buttons say so.
                    AppButton(approval.refused ? "Keep refused" : "Deny", variant: .outline) { onDecide(false) }
                    AppButton(approval.refused ? "Run anyway" : "Approve", variant: approval.refused ? .destructive : .primary) { onDecide(true) }
                }
            }
        }
        .padding(12)
        .background(pending ? Status.running.opacity(0.06) : Palette.muted.opacity(0.2), in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(border, lineWidth: 1))
        .padding(.vertical, 8)
    }
}

/// The agent asking something: options, a free-text box, or both.
private struct QuestionCard: View {
    let question: QuestionItem
    let pending: Bool
    let onAnswer: ([UserQuestionAnswer]?) -> Void

    @State private var picked: [Int: String] = [:]
    @State private var typed: [Int: String] = [:]

    private func answer(_ index: Int) -> String? {
        if let choice = picked[index] { return choice }
        let text = (typed[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private var complete: Bool {
        question.questions.indices.allSatisfy { answer($0) != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Meta(pending ? "question" : "answered")
            ForEach(Array(question.questions.enumerated()), id: \.offset) { index, asked in
                VStack(alignment: .leading, spacing: 6) {
                    Text(asked.text).font(AppFont.sans(13.5)).foregroundStyle(Palette.foreground).fixedSize(horizontal: false, vertical: true)
                    if pending {
                        ForEach(asked.options, id: \.self) { option in
                            let chosen = picked[index] == option
                            Button {
                                picked[index] = option
                                typed[index] = ""
                            } label: {
                                Text(option)
                                    .font(AppFont.sans(13))
                                    .foregroundStyle(Palette.foreground)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10)
                                    .frame(minHeight: 44)
                                    .background(chosen ? Palette.primary.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.md))
                                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(chosen ? Palette.primary : Palette.border, lineWidth: 1))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(chosen ? .isSelected : [])
                        }
                        if asked.allowFreeText {
                            AppField(
                                placeholder: asked.options.isEmpty ? "Type an answer…" : "Or type an answer…",
                                text: Binding(
                                    get: { typed[index] ?? "" },
                                    set: { text in
                                        typed[index] = text
                                        // Typing takes the answer back from a picked option.
                                        if !text.trimmingCharacters(in: .whitespaces).isEmpty { picked[index] = nil }
                                    }
                                )
                            )
                            .accessibilityLabel("Answer to: \(asked.text)")
                        }
                    } else {
                        let given = question.answers.flatMap { $0.indices.contains(index) ? $0[index].answer : nil }
                        Mono(given ?? "dismissed")
                    }
                }
            }
            if pending {
                HStack(spacing: 8) {
                    Spacer()
                    AppButton("Dismiss", variant: .outline) { onAnswer(nil) }
                    AppButton("Answer", disabled: !complete) {
                        onAnswer(question.questions.enumerated().map { index, asked in
                            UserQuestionAnswer(question: asked.text, answer: answer(index) ?? "")
                        })
                    }
                }
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(pending ? Palette.primary.opacity(0.4) : Palette.border, lineWidth: 1))
        .padding(.vertical, 8)
    }
}
#endif

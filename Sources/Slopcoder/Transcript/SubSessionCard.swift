#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// A sub-session the agent opened, as a live card in the parent's transcript.
///
/// Only the anchor lives in the parent; the card reads the sub-session's own
/// stream, so it knows both that the partner is stopped and which approval it
/// is stopped on. Opening the activity pushes the partner's whole session.
struct SubSessionCard: View {
    let item: SubSessionItem
    var queued = 0
    var spent = 0
    var cost: Double?
    let onOpen: (String) -> Void

    @Environment(AppModel.self) private var model
    @State private var store: SessionStore?
    @State private var expanded = true

    var body: some View {
        let state = store?.state
        let items = store?.items ?? []
        let failed = store?.error != nil
        let prompt = items.first { $0.kind == .user }
        let tail = SubSessionPresentation.tail(items.filter { $0.key != prompt?.key })
        let running = state?.status == .running
        let closed = state?.closed == true
        let waiting = !(state?.pendingApprovalIds.isEmpty ?? true) || !(state?.pendingQuestionIds.isEmpty ?? true)
        let tint = Tint.color(item.color) ?? Status.subagent
        let tone = closed ? Palette.mutedForeground : waiting ? Status.running : running ? tint : Palette.mutedForeground
        let label = SubSessionPresentation.statusLabel(state: state, failed: failed)
        let who = item.persona.isEmpty ? item.name : item.persona
        let beat = !item.persona.isEmpty && !item.name.isEmpty && item.name != item.persona ? item.name : nil

        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Fork(color: tint)
                    VStack(alignment: .leading, spacing: 2) {
                        (Text(who).font(AppFont.sansMedium(13)).foregroundStyle(tint)
                            + Text(beat.map { " · \($0)" } ?? "").font(AppFont.sans(13)).foregroundStyle(Palette.foreground))
                            .lineLimit(2)
                        Text("\(item.profile) · \(item.model)").font(AppFont.sans(Reading.summarySize)).foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer(minLength: 0)
                    if running || waiting { Dot(color: tone, size: 7) }
                    Text(label)
                        .font(AppFont.sans(Reading.summarySize))
                        .foregroundStyle(running || waiting ? tone : Palette.mutedForeground)
                        .lineLimit(1)
                    Chevron(open: expanded)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 10)
                .frame(minHeight: 40)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "Sub-session \(who)\(beat.map { ", \($0)" } ?? ""), \(item.profile), \(item.model), \(label)"
                    + (queued > 0 ? ", \(queued) queued" : "")
                    + (spent > 0 ? ", \(SubSessionPresentation.spend(tokens: spent, cost: cost))" : "")
            )
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

            if expanded, let prompt, let text = prompt.text {
                VStack(alignment: .leading, spacing: 3) {
                    Text("→ Parent session → \(who)").font(AppFont.sans(Reading.summarySize)).foregroundStyle(Palette.mutedForeground)
                    Text(text).font(AppFont.sans(13)).foregroundStyle(Palette.foreground).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 10)
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .topBorder()
            }

            if expanded {
                if !tail.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(tail) { entry in TailRow(item: entry, recipient: who) }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .topBorder()
                } else if prompt == nil {
                    Meta(failed ? "This sub-session is no longer available." : state != nil ? "Nothing yet." : "Loading…")
                        .padding(.horizontal, 10)
                        .padding(.bottom, 8)
                }
            }

            HStack {
                Spacer()
                Button { onOpen(item.subSessionId) } label: {
                    Text("Open activity ↗").font(AppFont.sans(Reading.summarySize)).foregroundStyle(Palette.mutedForeground)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(who) activity")
            }
        }
        .background(closed ? Palette.card : tint.opacity(0.05), in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(closed ? Palette.border : tint.opacity(0.45), lineWidth: 1))
        .padding(.vertical, 6)
        // Subscribed while the card is on screen, and let go when it scrolls
        // away: a transcript with a dozen partners is not a dozen live streams.
        .task {
            guard store == nil, let seam = model.seam, let hub = model.hub else { return }
            let opened = SessionStore(seam: seam, hub: hub, id: item.subSessionId)
            store = opened
            await opened.start()
        }
        .onDisappear {
            store?.stop()
            store = nil
        }
    }
}

private struct TailRow: View {
    let item: Item
    let recipient: String

    var body: some View {
        switch item.body {
        case .user(let user):
            VStack(alignment: .leading, spacing: 3) {
                Text("→ Parent session → \(recipient)").font(AppFont.sans(Reading.summarySize)).foregroundStyle(Palette.mutedForeground)
                Text(user.text).font(AppFont.sans(13)).foregroundStyle(Palette.foreground).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .text(let text):
            Prose(SubSessionPresentation.clipped(text.text), size: .small)
        case .tool(let tool):
            ToolCardView(
                card: buildToolCard(tool.name, inputJson: tool.input, result: tool.result, isError: tool.isError, images: tool.images),
                state: tool.running ? .running : tool.isError ? .failed : .ok
            )
        case .error(let error):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.destructive)
                Text(error.message).font(AppFont.sans(12.5)).foregroundStyle(Palette.destructive).lineLimit(2)
            }
        case .approval(let approval):
            Mono("! waiting for approval: \(approval.toolName) — open to decide", color: Status.running).lineLimit(1)
        case .question(let question):
            Mono("? \(question.questions.first?.text ?? "asked a question") — open to answer", color: Status.running).lineLimit(1)
        case .plan(let steps):
            Mono("plan · \(steps.filter { $0.status == "done" }.count)/\(steps.count) done").lineLimit(1)
        default:
            EmptyView()
        }
    }
}
#endif

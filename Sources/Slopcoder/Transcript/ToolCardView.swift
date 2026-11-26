#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

enum ToolCardState {
    case running, ok, failed, pending
}

/// A tool call, as a card.
///
/// The view switches over *blocks*, never over tool names, so teaching the
/// transcript about a new tool is an entry in `ToolCard`'s table and no change
/// here at all.
struct ToolCardView: View {
    let card: ToolCard
    let state: ToolCardState
    /// Everything shown: a call held at an approval gate, where a body behind a
    /// chevron is a body nobody read.
    var forceOpen = false

    @State private var tapped = false

    var body: some View {
        let expanded = tapped || forceOpen
        let hidden = card.blocks.contains { !$0.open }
        let shown = card.blocks.filter { expanded || $0.open }

        if card.bare {
            // The card *is* its content: the artifact, and no header row.
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(card.blocks.enumerated()), id: \.offset) { _, block in
                    ToolBlockView(block: block)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if hidden {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { tapped.toggle() }
                    } label: {
                        head(expanded: expanded, chevron: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(card.title ?? "\(card.verb) \(card.subject ?? "")".trimmingCharacters(in: .whitespaces))
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                } else {
                    head(expanded: expanded, chevron: false)
                }

                if !shown.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(shown.enumerated()), id: \.offset) { _, block in
                            if let peek = card.peek, block.type == "code" {
                                FilePeekCard(peek: peek)
                            } else {
                                ToolBlockView(block: block)
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)
                }
            }
        }
    }

    private func head(expanded: Bool, chevron: Bool) -> some View {
        HStack(spacing: RowMetrics.gap) {
            mark.frame(width: RowMetrics.gutter)
            // A description, where the caller wrote one, says more on one line
            // than a verb and a command cut off at the screen's edge.
            if let title = card.title {
                Text(title).font(AppFont.sansMedium(12.5)).foregroundStyle(Palette.foreground).lineLimit(1)
            } else {
                Text(card.verb)
                    .font(AppFont.sansMedium(12.5))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                    .fixedSize()
                if let subject = card.subject, !subject.isEmpty {
                    Text(subject)
                        .font(AppFont.mono(12))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                        // A path's tail is the part that tells files apart.
                        .truncationMode(card.subjectStyle == .path ? .head : .tail)
                }
            }
            HStack(spacing: 4) {
                ForEach(Array(card.facets.enumerated()), id: \.offset) { _, facet in FacetChip(text: facet) }
            }
            .layoutPriority(-1)
            Spacer(minLength: 0)
            if chevron { Chevron(open: expanded) }
        }
        .padding(.vertical, RowMetrics.paddingVertical)
        .padding(.horizontal, RowMetrics.paddingHorizontal)
        .frame(minHeight: RowMetrics.minHeight)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var mark: some View {
        switch state {
        case .failed:
            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.destructive)
        case .pending:
            Diamond(color: Status.running)
        case .running:
            Dot(color: Status.running, size: RowMetrics.dot)
        case .ok:
            Dot(color: Status.ok, size: RowMetrics.dot)
        }
    }
}

/// A short fact in the header: `+3`, `exit 1`, `12 matches`.
private struct FacetChip: View {
    let text: String

    var body: some View {
        let added = text.hasPrefix("+")
        let bad = text.hasPrefix("-") || (text.hasPrefix("exit ") && text != "exit 0")
        let color = added ? Status.ok : bad ? Palette.destructive : Palette.mutedForeground
        Text(text)
            .font(AppFont.mono(10.5, relativeTo: .caption2))
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(color.opacity(added ? 0.16 : 0.14), in: RoundedRectangle(cornerRadius: 4))
            // No fixed size: a chip can be a branch name as easily as "+3", and
            // one that refuses to shrink pushes the whole card past the edge of
            // the transcript and under whatever sits beside it.
    }
}

struct ToolBlockView: View {
    let block: ToolBlock
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let label = block.label, !label.isEmpty { Meta(label) }
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch block.content {
        case .diff(let lines):
            DiffView(lines: lines)
        case .code(_, let text):
            Surface {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(text).font(AppFont.mono(11.5)).foregroundStyle(Palette.foreground).lineSpacing(3).textSelection(.enabled)
                }
            }
        case .text(let tone, let text):
            Surface(error: tone == .error) {
                LinkedText(
                    text: text,
                    color: tone == .error ? Palette.destructive : tone == .muted ? Palette.mutedForeground : Palette.foreground
                )
                .lineSpacing(3)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .list(let entries):
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        // Truncated rather than held at full width: a long path must
                        // not widen the card it is in.
                        LinkedText(text: entry.text, font: AppFont.mono(12)).lineLimit(1).truncationMode(.middle).layoutPriority(1)
                        if let detail = entry.detail, !detail.isEmpty {
                            LinkedText(text: detail, font: AppFont.mono(12), color: Palette.mutedForeground).lineLimit(1)
                        }
                    }
                }
            }
        case .pairs(let pairs):
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(pairs.enumerated()), id: \.offset) { _, pair in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Mono(pair.key).frame(minWidth: 68, alignment: .leading)
                        Text(pair.value).font(AppFont.sans(12.5)).foregroundStyle(Palette.foreground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        case .artifact(let name, let kind, let size, let artifactId):
            ArtifactBlock(name: name, kind: kind, size: size, artifactId: artifactId)
        case .image(let imageId, let mediaType, let size):
            VStack(alignment: .leading, spacing: 4) {
                KeptImage(kind: .tool, id: imageId, label: "Image a tool returned, \(mediaType), \(size). Opens full screen.")
                Mono("\(mediaType) · \(size)", size: 10.5).lineLimit(1)
            }
        case .scene(let scene, let revision, let renderId):
            VStack(alignment: .leading, spacing: 4) {
                if let renderId {
                    KeptImage(
                        kind: .scene, id: renderId,
                        label: "Render of \(scene)\(revision.map { " at revision \($0)" } ?? ""). Opens full screen."
                    )
                }
                Mono(revision.map { "\(scene) · rev \($0)" } ?? scene, size: 10.5).lineLimit(1)
            }
        }
    }
}

/// The box a block's text sits in, capped so a long output scrolls in place.
private struct Surface<Content: View>: View {
    var error = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            content().padding(.horizontal, 8).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 260)
        .fixedSize(horizontal: false, vertical: true)
        .background(error ? Palette.destructive.opacity(0.05) : Palette.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(error ? Palette.destructive.opacity(0.3) : Palette.border, lineWidth: 1))
    }
}

private struct DiffView: View {
    let lines: [DiffLine]
    @State private var full = false

    private static let preview = 12

    var body: some View {
        let shown = full ? lines : Array(lines.prefix(DiffView.preview))
        let numbered = lines.contains { $0.oldNumber != nil || $0.newNumber != nil }
        VStack(alignment: .leading, spacing: 4) {
            // Sideways scrolling, not wrapping: a wrapped diff line reads as two.
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { _, line in DiffRow(line: line, numbered: numbered) }
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.muted.opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))

            if lines.count > DiffView.preview, !full {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { full = true }
                } label: {
                    Mono("show \(lines.count - DiffView.preview) more lines")
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct DiffRow: View {
    let line: DiffLine
    let numbered: Bool

    var body: some View {
        let added = line.kind == .add
        let removed = line.kind == .remove
        let color = added ? Status.ok : removed ? Palette.destructive : line.kind == .hunk ? Palette.mutedForeground : Palette.foreground
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            if numbered {
                Text((added ? line.newNumber : line.oldNumber).map(String.init) ?? "")
                    .font(AppFont.mono(11))
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: 34, alignment: .trailing)
            }
            // The sign, not just the tint: red and green alone are not a diff to
            // everyone.
            Text(added ? "+" : removed ? "-" : " ")
                .font(AppFont.mono(11.5))
                .foregroundStyle(color)
                .frame(width: 14, alignment: .trailing)
                .padding(.trailing, 4)
            Text(line.text).font(AppFont.mono(11.5)).foregroundStyle(color).fixedSize()
        }
        .padding(.trailing, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(added ? Status.ok.opacity(0.1) : removed ? Palette.destructive.opacity(0.1) : Color.clear)
    }
}

/// A published artifact, as the thing itself: its name, its kind, and a tap
/// that opens it. A picture or a sound is shown inline beneath.
private struct ArtifactBlock: View {
    let name: String
    let kind: String
    let size: String?
    let artifactId: String?
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                if let artifactId { router.show(.artifact(id: artifactId, version: nil)) }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 14))
                        .foregroundStyle(Palette.primary)
                        .frame(width: 30, height: 30)
                        .background(Palette.primary.opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.sm))
                    VStack(alignment: .leading, spacing: 1) {
                        Mono(name, size: 12.5, color: Palette.foreground).lineLimit(1)
                        Meta(size.map { "\(kind) · \($0)" } ?? kind)
                    }
                    Spacer(minLength: 0)
                    if artifactId != nil {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.mutedForeground)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .background(Palette.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(artifactId == nil)
            .accessibilityLabel("\(name), \(kind)\(size.map { ", \($0)" } ?? "")")

            if let artifactId { ArtifactMedia(artifactId: artifactId, name: name, kind: kind) }
        }
    }
}

/// An artifact's picture or sound, under its card.
///
/// The card event carries a name and a kind, not a content type, so a binary
/// artifact has to be asked about — once it is on screen, once per artifact, and
/// never more than two at a time (`ArtifactInfoCache`).
struct ArtifactMedia: View {
    let artifactId: String
    let name: String
    let kind: String

    private enum Lookup {
        case waiting
        case ready(ArtifactInfoCache.Known)
        case failed
    }

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @State private var lookup = Lookup.waiting
    @State private var attempt = 0

    var body: some View {
        if Media.mightBeMedia(kind: kind), let seam = model.seam {
            Group {
                switch lookup {
                case .waiting:
                    EmptyView()
                case .failed:
                    note("Could not check this artifact. Tap to try again.") {
                        lookup = .waiting
                        attempt += 1
                    }
                case .ready(.gone):
                    note("This artifact no longer exists.", action: nil)
                case .ready(.summary(let info)):
                    media(info, seam: seam)
                }
            }
            .task(id: attempt) {
                guard let cache = model.artifactInfo else { return }
                do {
                    lookup = .ready(try await cache.info(artifactId))
                } catch is CancellationError {
                    return
                } catch {
                    lookup = .failed
                }
            }
        }
    }

    @ViewBuilder private func media(_ info: ArtifactSummary, seam: Seam) -> some View {
        let open = { router.show(.artifact(id: artifactId, version: nil)) }
        if Media.isImage(info.contentType) {
            if info.size > Media.maxInlineImageBytes {
                note("Image, \(Media.megabytes(info.size)) - too large to preview here. Open it to view.", action: open)
            } else {
                InlineImage(
                    source: MediaSource(uri: seam.artifactRawUrl(artifactId), authed: true),
                    label: "Image artifact: \(info.title.isEmpty ? name : info.title). Opens full screen.",
                    onTap: open
                )
            }
        } else if Media.isAudio(info.contentType) {
            InlineAudio(url: seam.artifactRawUrl(artifactId), headers: seam.authHeaders, title: info.title.isEmpty ? name : info.title)
        } else if Media.isVideo(info.contentType) {
            note("Video, \(Media.megabytes(info.size)) - opens on the artifact's page.", action: open)
        }
    }

    @ViewBuilder private func note(_ text: String, action: (() -> Void)?) -> some View {
        if let action {
            Button(action: action) { Mono(text, size: 11) }.buttonStyle(.plain)
        } else {
            Mono(text, size: 11)
        }
    }
}

/// The opening of a file read, and a tap that opens the whole of it.
struct FilePeekCard: View {
    let peek: FilePeek
    @State private var open = false

    var body: some View {
        let preview = FilePeekPreview.preview(peek.text)
        let lines = FilePeekPreview.lineCount(peek.text)
        VStack(alignment: .leading, spacing: 4) {
            Button { open = true } label: {
                Text(preview.text)
                    .font(AppFont.mono(11.5))
                    .foregroundStyle(Palette.foreground)
                    .lineSpacing(3)
                    .lineLimit(FilePeekPreview.previewLines)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Palette.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Preview of \(peek.path)")
            .accessibilityHint("Opens the whole read")

            Button { open = true } label: {
                Mono(preview.cut ? "open all \(lines) lines >" : "open >", size: 11)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(peek.path), \(lines) \(lines == 1 ? "line" : "lines")")
        }
        .sheet(isPresented: $open) {
            AppSheet(title: peek.path, detents: [.large]) {
                if !peek.facets.isEmpty { Mono(peek.facets.joined(separator: " · "), size: 11) }
                ScrollView(.horizontal) {
                    Text(peek.text)
                        .font(AppFont.mono(11.5))
                        .foregroundStyle(Palette.foreground)
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .padding(10)
                        .accessibilityLabel("Contents of \(peek.path)")
                }
                .background(Palette.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
            }
        }
    }
}
#endif

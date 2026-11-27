#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

enum ProseSize {
    /// A reply in the transcript.
    case body
    /// Prose quoted inside a card, a step down.
    case small
    /// A document read for its own sake: an artifact, where headings are headings.
    case document

    var fontSize: CGFloat { self == .small ? Reading.proseSmallSize : Reading.proseSize }
    var lineSpacing: CGFloat { self == .small ? Reading.proseSmallLineSpacing : Reading.proseLineSpacing }
    var paragraphGap: CGFloat { self == .small ? Reading.paragraphSmallGap : Reading.paragraphGap }
    var listItemGap: CGFloat { self == .small ? Reading.listItemSmallGap : Reading.listItemGap }
}

/// Prose, rendered the one way.
///
/// Four screens render markdown — the transcript's replies and its streaming
/// tail, a routine's answer, a sub-session's reply, an artifact — and they must
/// not drift, so they all come here.
struct Prose: View {
    let text: String
    var size: ProseSize = .body
    /// Partners whose names are tinted wherever the prose says them.
    var mentions: [SubSessionMention] = []

    @Environment(AppModel.self) private var model

    init(_ text: String, size: ProseSize = .body, mentions: [SubSessionMention] = []) {
        self.text = text
        self.size = size
        self.mentions = mentions
    }

    var body: some View {
        MarkdownBlocks(blocks: Markdown.parse(text), size: size, mentions: mentions)
            .environment(\.openURL, OpenURLAction { url in
                // A relative link is the web's own spelling of one of the app's
                // screens; the system would have nowhere to take it.
                model.follow(url.absoluteString) ? .handled : .discarded
            })
    }
}

struct MarkdownBlocks: View {
    let blocks: [MarkdownBlock]
    let size: ProseSize
    let mentions: [SubSessionMention]

    var body: some View {
        VStack(alignment: .leading, spacing: size.paragraphGap) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, size: size, mentions: mentions)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let size: ProseSize
    let mentions: [SubSessionMention]

    var body: some View {
        switch block {
        case .paragraph(let inlines):
            InlineRuns(inlines: inlines, size: size, mentions: mentions)
        case .heading(let level, let inlines):
            Text(Inlines.attributed(inlines, font: headingFont(level), mono: 12, mentions: mentions))
                .foregroundStyle(level == 6 ? Palette.mutedForeground : Palette.foreground)
                .padding(.top, size == .document ? 8 : 10)
                .accessibilityAddTraits(.isHeader)
                .textSelection(.enabled)
        case .code(let language, let text):
            CodeBlock(language: language, text: text)
        case .quote(let blocks):
            MarkdownBlocks(blocks: blocks, size: size, mentions: mentions)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Palette.border.frame(width: 2) }
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: size.listItemGap) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        marker(ordered: ordered, number: start + index, checked: item.checked)
                        MarkdownBlocks(blocks: item.blocks, size: size, mentions: mentions)
                    }
                }
            }
            .padding(.leading, Reading.listIndent)
        case .table(let header, let alignments, let rows):
            TableBlock(header: header, alignments: alignments, rows: rows, size: size, mentions: mentions)
        case .rule:
            Palette.border.frame(height: 1).padding(.vertical, 8)
        }
    }

    @ViewBuilder private func marker(ordered: Bool, number: Int, checked: Bool?) -> some View {
        if let checked {
            Image(systemName: checked ? "checkmark.square" : "square")
                .font(.system(size: size.fontSize - 1))
                .foregroundStyle(checked ? Status.ok : Palette.mutedForeground)
                .accessibilityLabel(checked ? "Done" : "To do")
        } else {
            Text(ordered ? "\(number)." : "•")
                .font(ordered ? AppFont.mono(size.fontSize - 1.5) : AppFont.sans(size.fontSize))
                .foregroundStyle(Palette.mutedForeground)
                .frame(minWidth: ordered ? 18 : 10, alignment: .trailing)
        }
    }

    /// In a message, every heading is a modest bold line — a reply that opens
    /// with `# Summary` should not shout. A document keeps its hierarchy.
    private func headingFont(_ level: Int) -> Font {
        if size == .document {
            let sizes: [CGFloat] = [24, 21, 19, 17, 16, 15]
            return AppFont.sansMedium(sizes[max(0, min(5, level - 1))], relativeTo: .headline)
        }
        return AppFont.sansMedium(level <= 4 ? 17 : level == 5 ? 16 : 15, relativeTo: .headline)
    }
}

/// A paragraph: text runs, with any pictures it holds drawn between them.
private struct InlineRuns: View {
    let inlines: [MarkdownInline]
    let size: ProseSize
    let mentions: [SubSessionMention]
    @Environment(AppModel.self) private var model

    private enum Piece {
        case text([MarkdownInline])
        case image(alt: String, source: String)
    }

    private var pieces: [Piece] {
        var result: [Piece] = []
        var run: [MarkdownInline] = []
        for inline in inlines {
            if case .image(let alt, let source) = inline {
                if !run.isEmpty { result.append(.text(run)) }
                run = []
                result.append(.image(alt: alt, source: source))
            } else {
                run.append(inline)
            }
        }
        if !run.isEmpty { result.append(.text(run)) }
        return result
    }

    var body: some View {
        let pieces = self.pieces
        if pieces.count == 1, case .text(let run) = pieces[0] {
            text(run)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(pieces.enumerated()), id: \.offset) { _, piece in
                    switch piece {
                    case .text(let run):
                        text(run)
                    case .image(let alt, let source):
                        let label = alt.trimmingCharacters(in: .whitespaces).isEmpty ? "Image" : alt
                        if let resolved = Media.resolve(source, baseUrl: model.seam?.baseUrl) {
                            InlineImage(source: resolved, label: label, bare: true)
                        } else {
                            // An image that cannot be shown is said, not left as a gap.
                            Mono("[image: \(label)]")
                        }
                    }
                }
            }
        }
    }

    private func text(_ run: [MarkdownInline]) -> some View {
        Text(Inlines.attributed(run, font: AppFont.sans(size.fontSize), mono: size.fontSize - 2, mentions: mentions))
            .foregroundStyle(Palette.foreground)
            .lineSpacing(size.lineSpacing)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

/// Markdown inlines as one attributed string.
enum Inlines {
    static func attributed(_ inlines: [MarkdownInline], font: Font, mono: CGFloat, mentions: [SubSessionMention]) -> AttributedString {
        var out = AttributedString()
        append(inlines, to: &out, font: font, mono: mono, mentions: mentions, style: Style())
        return out
    }

    private struct Style {
        var strong = false
        var emphasis = false
        var strike = false
        var link: URL?
    }

    private static func append(
        _ inlines: [MarkdownInline], to out: inout AttributedString, font: Font, mono: CGFloat,
        mentions: [SubSessionMention], style: Style
    ) {
        for inline in inlines {
            switch inline {
            case .text(let text):
                // A name inside a link keeps the link's ink: tinting half of a
                // link reads as two links.
                if style.link == nil, !mentions.isEmpty {
                    for run in splitMentions(text, mentions) {
                        var piece = styled(run.text, font: font, style: style)
                        if let tint = Tint.color(run.color) {
                            piece.foregroundColor = tint
                            piece.font = AppFont.sansMedium(Reading.proseSize)
                        }
                        out.append(piece)
                    }
                } else {
                    out.append(styled(text, font: font, style: style))
                }
            case .code(let code):
                var piece = AttributedString(code)
                piece.font = AppFont.mono(mono)
                piece.backgroundColor = Palette.muted.opacity(0.6)
                if let link = style.link { piece.link = link }
                out.append(piece)
            case .strong(let children):
                var next = style
                next.strong = true
                append(children, to: &out, font: font, mono: mono, mentions: mentions, style: next)
            case .emphasis(let children):
                var next = style
                next.emphasis = true
                append(children, to: &out, font: font, mono: mono, mentions: mentions, style: next)
            case .strike(let children):
                var next = style
                next.strike = true
                append(children, to: &out, font: font, mono: mono, mentions: mentions, style: next)
            case .link(let href, let children):
                var next = style
                // A link with no usable address still reads as its text.
                next.link = URL(string: href) ?? href.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap(URL.init(string:))
                append(children, to: &out, font: font, mono: mono, mentions: mentions, style: next)
            case .image(let alt, _):
                out.append(styled("[image: \(alt.isEmpty ? "Image" : alt)]", font: font, style: style))
            case .lineBreak:
                out.append(AttributedString("\n"))
            }
        }
    }

    private static func styled(_ text: String, font: Font, style: Style) -> AttributedString {
        var piece = AttributedString(text)
        var resolved = style.strong ? font.weight(.semibold) : font
        if style.emphasis { resolved = resolved.italic() }
        piece.font = resolved
        if style.strike { piece.strikethroughStyle = .single }
        if let link = style.link {
            piece.link = link
            piece.foregroundColor = Palette.primary
        }
        return piece
    }
}

/// A fenced block: its language, a Copy, and the code scrolling sideways rather
/// than wrapping — a wrapped line of code is a different line of code.
struct CodeBlock: View {
    let language: String
    let text: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language).font(AppFont.mono(11)).foregroundStyle(Palette.mutedForeground)
                Spacer()
                Button {
                    copyText(text)
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        copied = false
                    }
                } label: {
                    Text(copied ? "Copied!" : "Copy").font(AppFont.mono(11)).foregroundStyle(Palette.primary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy code")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Palette.muted.opacity(0.7))
            .overlay(alignment: .bottom) { Palette.border.frame(height: 1) }

            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(AppFont.mono(12.5))
                    .foregroundStyle(Palette.foreground)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Palette.muted.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, lineWidth: 1))
        .padding(.vertical, 4)
    }
}

private struct TableBlock: View {
    let header: [[MarkdownInline]]
    let alignments: [MarkdownAlignment]
    let rows: [[[MarkdownInline]]]
    let size: ProseSize
    let mentions: [SubSessionMention]

    private func alignment(_ column: Int) -> Alignment {
        guard alignments.indices.contains(column) else { return .leading }
        switch alignments[column] {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }

    private func cell(_ inlines: [MarkdownInline], column: Int, bold: Bool) -> some View {
        Text(Inlines.attributed(inlines, font: bold ? AppFont.sansMedium(size.fontSize - 1) : AppFont.sans(size.fontSize - 1), mono: size.fontSize - 3, mentions: mentions))
            .foregroundStyle(Palette.foreground)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: alignment(column))
            .padding(.vertical, 4)
            .padding(.horizontal, 8)
    }

    var body: some View {
        // A wide table scrolls sideways; squeezing six columns into a phone's
        // width makes each one a column of single words.
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { column, inlines in
                        cell(inlines, column: column, bold: true).frame(minWidth: 72)
                    }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Palette.border.frame(height: 1).gridCellColumns(max(1, header.count))
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, inlines in
                            cell(inlines, column: column, bold: false)
                        }
                    }
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Palette.border, lineWidth: 1))
        .padding(.vertical, 4)
    }
}

/// Plain text with its links live: tool output, which is not markdown.
struct LinkedText: View {
    let text: String
    var font: Font = AppFont.mono(11.5)
    var color: Color = Palette.foreground
    @Environment(AppModel.self) private var model

    private var attributed: AttributedString {
        var out = AttributedString()
        for segment in linkSegments(text) {
            var piece = AttributedString(segment.text)
            piece.font = font
            if let href = segment.href, let url = URL(string: href) {
                piece.link = url
                piece.foregroundColor = Palette.primary
            }
            out.append(piece)
        }
        return out
    }

    var body: some View {
        Text(attributed)
            .foregroundStyle(color)
            .textSelection(.enabled)
            .environment(\.openURL, OpenURLAction { url in
                model.follow(url.absoluteString) ? .handled : .discarded
            })
    }
}
#endif

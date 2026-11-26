#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// A sheet with a title and a Done: the platform's own, at a height that fits.
struct AppSheet<Content: View>: View {
    let title: String
    var detents: Set<PresentationDetent> = [.medium, .large]
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14, content: content)
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { ConfirmBarButton("Done") { dismiss() } }
            }
        }
        .presentationDetents(detents)
        .presentationDragIndicator(.visible)
    }
}

/// One line of a picker.
struct SheetOption: Identifiable, Hashable {
    var key: String
    var label: String
    var description: String?
    var kind: GitServiceKind?
    var showsMark = false

    var id: String { key }
}

/// Pick one of a few, with a line of explanation under each.
struct SheetGroup: View {
    var label: String?
    let options: [SheetOption]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label { Meta(label) }
            VStack(spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    Button {
                        Haptics.select()
                        onSelect(option.key)
                    } label: {
                        OptionRow(option: option, checked: option.key == selected)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .top) { if index > 0 { Palette.border.frame(height: 1) } }
                }
            }
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
        }
    }
}

/// Pick any number.
struct SheetMultiGroup: View {
    var label: String?
    let options: [SheetOption]
    let selected: [String]
    var empty = ""
    let onToggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label { Meta(label) }
            if options.isEmpty {
                if !empty.isEmpty { Hint(empty) }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                        Button {
                            Haptics.select()
                            onToggle(option.key)
                        } label: {
                            OptionRow(option: option, checked: selected.contains(option.key))
                        }
                        .buttonStyle(.plain)
                        .overlay(alignment: .top) { if index > 0 { Palette.border.frame(height: 1) } }
                    }
                }
                .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
            }
        }
    }
}

private struct OptionRow: View {
    let option: SheetOption
    let checked: Bool

    var body: some View {
        HStack(spacing: 10) {
            if option.showsMark {
                GitMark(kind: option.kind, size: 16, color: option.kind == nil ? Palette.mutedForeground : Palette.foreground)
            }
            VStack(alignment: .leading, spacing: 2) {
                BodyText(option.label).lineLimit(1)
                if let description = option.description, !description.isEmpty {
                    Text(description).font(AppFont.sans(12)).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            if checked {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.primary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}

/// A short row of mutually exclusive choices, where each is a word.
struct SheetSegments: View {
    let label: String
    let options: [SheetOption]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Meta(label)
            Picker(label, selection: Binding(get: { selected }, set: { onSelect($0) })) {
                ForEach(options) { option in Text(option.label).tag(option.key) }
            }
            .pickerStyle(.segmented)
        }
    }
}

/// Whether the server is there, said once at the top of a page.
///
/// "You are offline" and "this page is a few seconds stale" deserve different
/// words. The second is held back for a moment: every reconnect after a screen
/// sleep would otherwise flash it.
struct ConnectionBanner: View {
    var onRetry: (() -> Void)?
    @Environment(ConnectionStatus.self) private var connection
    @State private var lingering = false
    @State private var asked = false

    private static let liveGraceNs: UInt64 = 2_500_000_000

    var body: some View {
        let down = !connection.reachable
        Group {
            if down || (!connection.live && lingering) {
                let tint = down ? Palette.destructive : Palette.mutedForeground
                Button {
                    if down { onRetry?() } else { asked.toggle() }
                } label: {
                    VStack(spacing: 4) {
                        HStack(spacing: 8) {
                            Mono(down ? "Cannot reach slopcoder" : "Reconnecting to live updates…", size: 11.5, color: tint)
                            if down, onRetry != nil {
                                Text("retry").font(AppFont.mono(11.5)).underline().foregroundStyle(tint)
                            }
                        }
                        // The phone has no console; this is the only account of a
                        // connection that never arrives.
                        if asked, !down {
                            Mono(connection.reason ?? "no error reported — the handshake has not finished", size: 10.5, color: tint)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 16)
                    .background(tint.opacity(down ? 0.14 : 0.10), in: RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: connection.live) {
            if connection.live {
                lingering = false
                asked = false
                return
            }
            try? await Task.sleep(nanoseconds: ConnectionBanner.liveGraceNs)
            if !Task.isCancelled { lingering = true }
        }
    }
}
#endif

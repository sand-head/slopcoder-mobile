#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// The parts every settings page is made of: the scrolling page itself, a row
// with a switch and a menu, labelled fields, and the sheet an editor lives in.

/// A settings page: the connection banner, any problem, then the content — or a
/// skeleton while the first read is out.
struct SettingsScroll<Content: View>: View {
    var error: String?
    var loading = false
    var onRefresh: (() async -> Void)?
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(onRetry: onRefresh.map { run in { Task { await run() } } })
                if let error { ErrorText(error) }
                if loading { Skeleton(rows: 3) } else { content() }
            }
            .padding(20)
            .padding(.bottom, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .pageBackground()
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await onRefresh?() }
    }
}

/// A labelled group of rows, with how many there are.
struct SettingsSection<Content: View>: View {
    let label: String
    var count: Int?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Meta(count.map { "\(label) · \($0)" } ?? label).padding(.bottom, 6)
            content()
        }
    }
}

enum TagTone { case muted, warn, ok }

struct SettingsTag: View {
    let text: String
    var tone = TagTone.muted

    var body: some View {
        let color = tone == .warn ? Palette.destructive : tone == .ok ? Status.ok : Palette.mutedForeground
        Text(text.uppercased())
            .font(AppFont.mono(10))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(color.opacity(0.4)))
    }
}

/// Something a row's "…" menu can do.
struct RowAction: Identifiable {
    let title: String
    var symbol: String?
    var destructive = false
    let run: () -> Void
    var id: String { title }
}

/// One thing in a list: a title, what it is, and optionally a switch and a menu.
struct ListRow<Extra: View>: View {
    let title: String
    var subtitle: String?
    var tag: String?
    var tagTone = TagTone.muted
    var warn: String?
    var switchValue: Bool?
    var onSwitch: ((Bool) -> Void)?
    var disabled = false
    var dimmed = false
    var chevron = false
    var menu: [RowAction] = []
    var onTap: (() -> Void)?
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Button { onTap?() } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        BodyText(title, size: 14.5, medium: true).lineLimit(1)
                        if let tag { SettingsTag(text: tag, tone: tagTone) }
                    }
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(AppFont.sans(12.5)).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                    }
                    if let warn, !warn.isEmpty {
                        Text(warn).font(AppFont.sans(12.5)).foregroundStyle(Palette.destructive).lineLimit(2)
                    }
                    extra()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onTap == nil)
            .opacity(dimmed ? 0.55 : 1)

            if let onSwitch {
                Toggle(
                    "\(title) enabled",
                    isOn: Binding(get: { switchValue ?? false }, set: { onSwitch($0) })
                )
                .labelsHidden()
                .tint(Palette.primary)
                .disabled(disabled)
            }
            if chevron { Mono("›", size: 15) }
            if !menu.isEmpty {
                Menu {
                    ForEach(menu) { action in
                        Button(role: action.destructive ? .destructive : nil, action: action.run) {
                            if let symbol = action.symbol {
                                Label(action.title, systemImage: symbol)
                            } else {
                                Text(action.title)
                            }
                        }
                    }
                } label: {
                    Text("…")
                        .font(AppFont.mono(16))
                        .foregroundStyle(Palette.foreground)
                        .frame(width: 32, height: 36)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Actions for \(title)")
            }
        }
        .padding(.vertical, 10)
        .topBorder()
    }
}

extension ListRow where Extra == EmptyView {
    init(
        title: String, subtitle: String? = nil, tag: String? = nil, tagTone: TagTone = .muted, warn: String? = nil,
        switchValue: Bool? = nil, onSwitch: ((Bool) -> Void)? = nil, disabled: Bool = false, dimmed: Bool = false,
        chevron: Bool = false, menu: [RowAction] = [], onTap: (() -> Void)? = nil
    ) {
        self.init(
            title: title, subtitle: subtitle, tag: tag, tagTone: tagTone, warn: warn, switchValue: switchValue,
            onSwitch: onSwitch, disabled: disabled, dimmed: dimmed, chevron: chevron, menu: menu, onTap: onTap,
            extra: { EmptyView() }
        )
    }
}

/// A field with its name above it and, optionally, a line of help below.
struct FormField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var hint: String?
    var secure = false
    var mono = false
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never
    var editable = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Meta(label)
            AppField(placeholder: placeholder, text: $text, secure: secure, mono: mono, keyboard: keyboard)
                .textInputAutocapitalization(capitalization)
                .disabled(!editable)
                .opacity(editable ? 1 : 0.55)
                .accessibilityLabel(label)
            if let hint { Hint(hint) }
        }
    }
}

/// A box for a document or a list: monospaced, never corrected.
struct CodeBox: View {
    var label: String?
    @Binding var text: String
    var placeholder = ""
    var hint: String?
    var minHeight: CGFloat = 160
    var editable = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label { Meta(label) }
            AppEditor(text: $text, placeholder: placeholder, mono: true, minHeight: minHeight)
                .disabled(!editable)
                .opacity(editable ? 1 : 0.55)
                .accessibilityLabel(label ?? placeholder)
            if let hint { Hint(hint) }
        }
    }
}

struct ChoiceRow: View {
    let label: String
    let value: String
    var hint: String?
    var disabled = false
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: action) {
                HStack(spacing: 10) {
                    Meta(label)
                    BodyText(value, size: 15).lineLimit(1).frame(maxWidth: .infinity, alignment: .trailing)
                    Mono("›", size: 13)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel("\(label): \(value)")
            if let hint { Hint(hint) }
        }
    }
}

struct SwitchRow: View {
    let label: String
    var detail: String?
    @Binding var isOn: Bool
    var disabled = false

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                BodyText(label)
                if let detail { Text(detail).font(AppFont.sans(12.5)).foregroundStyle(Palette.mutedForeground) }
            }
        }
        .tint(Palette.primary)
        .disabled(disabled)
        .frame(minHeight: 44)
    }
}

/// Something to copy out whole: a key, a command, a URL. Tap to copy.
struct CopyBox: View {
    var label: String?
    let value: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label { Meta(label) }
            Button {
                copyText(value)
                copied = true
            } label: {
                Text(value)
                    .font(AppFont.mono(12.5))
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Palette.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.md))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Copies it")
            if copied { Mono("copied") }
        }
    }
}

/// The outcome of a save or a check, in a line.
struct Note: View {
    let text: String
    let ok: Bool

    var body: some View {
        HStack(spacing: 6) {
            if ok { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Status.ok) }
            Text(text).font(AppFont.sans(12)).foregroundStyle(ok ? Status.ok : Palette.destructive)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A row of the settings hub.
struct HubRow: View {
    let label: String
    var count: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                BodyText(label, size: 15).frame(maxWidth: .infinity, alignment: .leading)
                if let count { Mono(count) }
                Mono("›", size: 15)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .topBorder()
        .accessibilityLabel(count.map { "\(label), \($0)" } ?? label)
    }
}

// MARK: - confirmations

/// A question with one consequential answer.
struct Confirmation: Identifiable {
    let id = UUID()
    let title: String
    var message: String?
    let action: String
    var destructive = true
    let run: () -> Void
}

/// Something to tell the person, with nothing to decide.
struct Notice: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

extension View {
    func confirms(_ confirmation: Binding<Confirmation?>) -> some View {
        alert(
            confirmation.wrappedValue?.title ?? "",
            isPresented: Binding(get: { confirmation.wrappedValue != nil }, set: { if !$0 { confirmation.wrappedValue = nil } }),
            presenting: confirmation.wrappedValue
        ) { item in
            Button("Cancel", role: .cancel) {}
            Button(item.action, role: item.destructive ? .destructive : nil) {
                if item.destructive { Haptics.refuse() }
                item.run()
            }
        } message: { item in
            if let message = item.message { Text(message) }
        }
    }

    func tells(_ notice: Binding<Notice?>) -> some View {
        alert(
            notice.wrappedValue?.title ?? "",
            isPresented: Binding(get: { notice.wrappedValue != nil }, set: { if !$0 { notice.wrappedValue = nil } }),
            presenting: notice.wrappedValue
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { item in
            Text(item.message)
        }
    }
}

// MARK: - editors

/// The sheet a form lives in: Cancel on the left, the one confirming action on
/// the right, and a question before unsaved work is thrown away.
struct EditorSheet<Content: View>: View {
    let title: String
    let confirm: String
    var ready = true
    var dirty = false
    var error: String?
    let onConfirm: () -> Void
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var discarding = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ConnectionBanner()
                    if let error { ErrorText(error) }
                    content()
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if dirty { discarding = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if !confirm.isEmpty { Button(confirm, action: onConfirm).disabled(!ready) }
                }
            }
        }
        .interactiveDismissDisabled(dirty)
        .alert("Discard changes?", isPresented: $discarding) {
            Button("Keep editing", role: .cancel) {}
            Button("Discard", role: .destructive) { dismiss() }
        }
    }
}

/// What went wrong, for a person: the server's own words when it had any.
func problemText(_ error: Error) -> String { describe(error) }
#endif

#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// Where the assistant can be reached, and reach you: chat bots, a mailbox, an
/// ntfy topic. Nobody reaches the agent until they have been paired.
struct ChannelsPage: View {
    @Environment(AppModel.self) private var model
    @State private var channels: [ChannelSummary]?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmation: Confirmation?
    @State private var notice: Notice?
    @State private var editing: ChannelDraftTarget?

    var body: some View {
        SettingsScroll(error: error, loading: channels == nil && error == nil, onRefresh: load) {
            Hint("Where your assistant can be reached, and reach you. Discord, Fluxer and Telegram bots are two-way: paired people talk to one ongoing conversation, in DMs and in the server channels you list, and its answers, approvals and questions come back to them. Email is the same conversation over SMTP and IMAP, in whatever mail app you already use. ntfy is delivery only — a topic for automation notifications. Nobody reaches the agent until you pair them: an unknown sender gets a code and nothing else.")
            ForEach(channels ?? []) { channel in
                ChannelCard(
                    channel: channel, busy: busy,
                    onToggle: { on in Task { _ = await run { try await $0.setChannelEnabled(channel.id, enabled: on) } } },
                    onTest: { Task { _ = await run(done: "Test message sent.") { try await $0.testChannel(channel.id) } } },
                    onEdit: { editing = ChannelDraftTarget(channel: channel) },
                    onDelete: { remove(channel) },
                    onUnpair: { peer in Task { _ = await run { try await $0.unpairChannel(channel.id, peerId: peer) } } },
                    onPair: { code in await pair(channel, code) }
                )
            }
            if channels?.isEmpty == true { Hint("No channels connected yet.").padding(.vertical, 8) }
        }
        .navigationTitle("Channels")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = ChannelDraftTarget(channel: nil) } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Connect a channel")
            }
        }
        .confirms($confirmation)
        .tells($notice)
        .task { await load() }
        .sheet(item: $editing, onDismiss: { Task { await load() } }) { ChannelEditor(channel: $0.channel) }
    }

    private func remove(_ channel: ChannelSummary) {
        confirmation = Confirmation(
            title: "Delete this channel?",
            message: "“\(channel.displayName)” stops receiving and its credential is forgotten. The conversation it fed stays in your session list.",
            action: "Delete"
        ) {
            Task { _ = await run { try await $0.deleteChannel(channel.id) ? nil : "That channel is already gone." } }
        }
    }

    private func pair(_ channel: ChannelSummary, _ code: String) async -> Bool {
        let trimmed = code.jsTrim
        if trimmed.isEmpty {
            notice = Notice(title: "Enter the code the bot sent you.", message: "")
            return false
        }
        let paired = await run { try await $0.pairChannel(channel.id, code: trimmed) }
        if paired { Haptics.confirm() }
        return paired
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            channels = try await seam.channels()
            error = nil
        } catch {
            if isCancellation(error) { return }
            self.error = problemText(error)
        }
    }

    /// Run a command that answers with what went wrong, or nil. True when it worked.
    private func run(done: String? = nil, _ command: (Seam) async throws -> String?) async -> Bool {
        guard let seam = model.seam, !busy else { return false }
        busy = true
        defer { busy = false }
        do {
            let refused = try await command(seam)
            if let refused {
                Haptics.error()
                notice = Notice(title: "That did not work", message: refused)
            } else if let done {
                notice = Notice(title: done, message: "")
            }
            await load()
            return refused == nil
        } catch {
            Haptics.error()
            notice = Notice(title: "Could not reach slopcoder", message: problemText(error))
            return false
        }
    }
}

private struct ChannelDraftTarget: Identifiable {
    let id = UUID()
    let channel: ChannelSummary?
}

private struct ChannelCard: View {
    let channel: ChannelSummary
    let busy: Bool
    let onToggle: (Bool) -> Void
    let onTest: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onUnpair: (String) -> Void
    let onPair: (String) async -> Bool
    @State private var code = ""

    var body: some View {
        Card {
            HStack(spacing: 8) {
                SettingsTag(text: SettingsLogic.channelLabel(channel.kind))
                BodyText(channel.displayName, size: 15, medium: true).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Toggle("\(channel.displayName) enabled", isOn: Binding(get: { channel.enabled }, set: onToggle))
                    .labelsHidden()
                    .tint(Palette.primary)
                    .disabled(busy)
                Menu {
                    Button(action: onTest) { Label("Send test", systemImage: "paperplane") }
                    Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
                } label: {
                    Text("…").font(AppFont.mono(16)).foregroundStyle(Palette.foreground).frame(width: 32, height: 36)
                }
                .accessibilityLabel("Actions for \(channel.displayName)")
            }
            if !channel.hasSecret { Mono("no credential set", color: Palette.destructive) }
            ForEach(SettingsLogic.channelFacts(channel), id: \.label) { fact in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Meta(fact.label).frame(width: 84, alignment: .leading)
                    if fact.mono {
                        Mono(fact.value, color: Palette.foreground).lineLimit(1)
                    } else {
                        BodyText(fact.value, size: 13.5).lineLimit(1)
                    }
                }
            }
            if let trouble = channel.lastError, !trouble.isEmpty { ErrorText(trouble) }
            if !channel.pairedPeers.isEmpty {
                Meta("paired")
                ForEach(channel.pairedPeers, id: \.self) { peer in
                    HStack(spacing: 8) {
                        Mono(peer, color: Palette.foreground).lineLimit(1).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        AppButton("Unpair", variant: .linkDestructive, disabled: busy) { onUnpair(peer) }
                            .accessibilityLabel("Unpair \(peer)")
                    }
                }
            }
            if SettingsLogic.channelPairs(channel.kind) {
                HStack(spacing: 8) {
                    AppField(placeholder: "pairing code", text: $code, keyboard: .numbersAndPunctuation, onSubmit: submit)
                        .accessibilityLabel("Pairing code for \(channel.displayName)")
                    AppButton("Pair", disabled: busy, action: submit)
                        .accessibilityLabel("Pair with \(channel.displayName)")
                }
                Mono(waiting)
            }
        }
        .opacity(channel.enabled ? 1 : 0.7)
    }

    private var waiting: String {
        if let newest = channel.pendingPairings.first {
            return "\(channel.pendingPairings.count) code(s) waiting, newest issued \(RoutineFormat.clock(newest.issuedAt))"
        }
        return channel.kind == .email ? "Write to the mailbox to get a code." : "Message the bot to get a code."
    }

    private func submit() {
        let entered = code
        Task { if await onPair(entered) { code = "" } }
    }
}

private struct ChannelEditor: View {
    let channel: ChannelSummary?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var form: ChannelForm
    @State private var original: ChannelForm
    @State private var saving = false
    @State private var error: String?
    @State private var choosingKind = false

    init(channel: ChannelSummary?) {
        self.channel = channel
        let form = channel.map { SettingsLogic.channelFormOf($0) } ?? ChannelForm()
        _form = State(initialValue: form)
        _original = State(initialValue: form)
    }

    private var editing: Bool { channel != nil }
    private var keep: String { editing ? " Leave empty to keep the stored one." : "" }

    private func secretLabel(_ what: String) -> String {
        editing ? "Replace \(what)" : what.prefix(1).uppercased() + what.dropFirst()
    }

    var body: some View {
        EditorSheet(
            title: channel.map { "Edit '\($0.displayName)'" } ?? "Connect a channel",
            confirm: editing ? "Save changes" : "Connect",
            ready: !form.displayName.jsTrim.isEmpty && !saving, dirty: form != original, error: error,
            onConfirm: { Task { await save() } }
        ) {
            ChoiceRow(
                label: "kind",
                value: SettingsLogic.channelKinds.first { $0.kind == form.kind }?.label ?? "Channel",
                hint: editing ? "A channel keeps its kind; connect a new one to change it." : nil,
                disabled: editing || saving
            ) { choosingKind = true }
            FormField(label: "Name", text: $form.displayName, placeholder: "phone", capitalization: .words, editable: !saving)
            fields
            if !editing { Hint("Nobody reaches the agent until you pair them: an unknown sender gets a code and nothing else.") }
        }
        .sheet(isPresented: $choosingKind) {
            AppSheet(title: "Kind") {
                SheetGroup(
                    options: SettingsLogic.channelKinds.map { SheetOption(key: String($0.kind.rawValue), label: $0.label) },
                    selected: String(form.kind.rawValue),
                    onSelect: { key in
                        // A different kind is a different form; only the name carries over.
                        var fresh = ChannelForm(kind: ChannelKind(rawValue: Int(key) ?? 0))
                        fresh.displayName = form.displayName
                        form = fresh
                        choosingKind = false
                    }
                )
            }
        }
    }

    @ViewBuilder private var fields: some View {
        if form.kind == .telegram {
            FormField(
                label: secretLabel("bot token"), text: $form.secret, placeholder: "123456:ABC-DEF…",
                hint: "Create a bot with @BotFather, paste the token, then message the bot to get a pairing code.\(keep)",
                secure: true, editable: !saving
            )
        } else if form.kind == .email {
            emailFields
        } else if form.kind == .discord || form.kind == .fluxer {
            botFields(discord: form.kind == .discord)
        } else {
            FormField(label: "Server", text: $form.server, placeholder: "https://ntfy.sh", mono: true, keyboard: .URL, editable: !saving)
            FormField(
                label: "Topic", text: $form.topic, placeholder: "slopcoder-a1b2c3",
                hint: "Anyone who knows a topic name can read it — pick an unguessable one.", mono: true, editable: !saving
            )
            FormField(
                label: secretLabel("access token"), text: $form.secret, placeholder: "optional — tk_…",
                hint: "Only needed for a protected topic.\(keep)", secure: true, editable: !saving
            )
        }
    }

    @ViewBuilder private var emailFields: some View {
        FormField(label: "SMTP host", text: $form.smtpHost, placeholder: "smtp.gmail.com", mono: true, keyboard: .URL, editable: !saving)
        FormField(label: "SMTP port", text: $form.smtpPort, mono: true, keyboard: .numbersAndPunctuation, editable: !saving)
        SheetSegments(
            label: "SMTP security",
            options: [
                SheetOption(key: "starttls", label: "STARTTLS (587)"), SheetOption(key: "ssl", label: "SSL/TLS (465)"),
                SheetOption(key: "none", label: "None"),
            ],
            selected: form.smtpSecurity, onSelect: { form.smtpSecurity = $0 }
        )
        FormField(
            label: "IMAP host", text: $form.imapHost, placeholder: "imap.gmail.com",
            hint: "Use an app password, not your account password. Leave the IMAP host blank for delivery-only — the channel will send notifications and never read the mailbox.",
            mono: true, keyboard: .URL, editable: !saving
        )
        if !form.imapHost.jsTrim.isEmpty {
            FormField(label: "IMAP port", text: $form.imapPort, mono: true, keyboard: .numbersAndPunctuation, editable: !saving)
            SheetSegments(
                label: "IMAP security",
                options: [SheetOption(key: "ssl", label: "SSL/TLS (993)"), SheetOption(key: "starttls", label: "STARTTLS (143)")],
                selected: form.imapSecurity, onSelect: { form.imapSecurity = $0 }
            )
            FormField(label: "Folder", text: $form.folder, placeholder: "INBOX", mono: true, editable: !saving)
            FormField(
                label: "Poll every (seconds)", text: $form.pollSeconds, hint: "At least 30 — a mailbox is not a websocket.",
                mono: true, keyboard: .numbersAndPunctuation, editable: !saving
            )
        }
        FormField(label: "From address", text: $form.fromAddress, placeholder: "assistant@example.com", mono: true, keyboard: .emailAddress, editable: !saving)
        FormField(label: "From name", text: $form.fromName, placeholder: "slopcoder", capitalization: .words, editable: !saving)
        FormField(label: "Username", text: $form.username, placeholder: "same as the from address", mono: true, keyboard: .emailAddress, editable: !saving)
        FormField(
            label: secretLabel("password"), text: $form.secret, placeholder: "app password",
            hint: "Gmail, Fastmail and a self-hosted Dovecot all take an app password here.\(keep)", secure: true, editable: !saving
        )
        FormField(
            label: "Allow from", text: $form.allowFrom, placeholder: "you@example.com, phone@example.com",
            hint: "Addresses you list here are paired without a code. Anyone else who writes in gets a code and nothing else.",
            mono: true, keyboard: .emailAddress, editable: !saving
        )
    }

    @ViewBuilder
    private func botFields(discord: Bool) -> some View {
        FormField(
            label: secretLabel("bot token"), text: $form.secret, placeholder: "paste the bot token",
            hint: (discord
                ? "Create an application at discord.com/developers/applications, add a bot, enable the Message Content intent, invite it with the bot and applications.commands scopes, then DM it for a pairing code."
                : "Create an application on your Fluxer instance (fluxer.app unless you self-host) and paste the bot token it hands back, then DM the bot for a pairing code.") + keep,
            secure: true, editable: !saving
        )
        FormField(
            label: "Listen in channels", text: $form.listenChannelIds, placeholder: "optional — 1234567890, 9876543210",
            hint: "Server channel ids, comma-separated. DMs always work; a server channel is only read if it is listed here. Turn on Developer Mode to copy a channel id."
                + (discord
                    ? " Your automations' chat commands are registered as slash commands in the servers listed here: they appear in those servers immediately and in DMs within an hour. Use a bot application that is slopcoder's alone — registering replaces every command that application had."
                    : ""),
            mono: true, keyboard: .numbersAndPunctuation, editable: !saving
        )
        FormField(
            label: "Deliver to channels", text: $form.deliverToChannelIds, placeholder: "optional — 1234567890",
            hint: "Automation notifications and relayed answers are posted here as well as DM'd to everyone paired.",
            mono: true, keyboard: .numbersAndPunctuation, editable: !saving
        )
        if !discord {
            FormField(
                label: "Instance URL", text: $form.instance, placeholder: "optional — https://fluxer.example",
                hint: "Your self-hosted instance's web address, e.g. https://fluxer.example — slopcoder reads its /.well-known/fluxer to find the API and gateway. It must be https. Leave empty for fluxer.app.",
                mono: true, keyboard: .URL, editable: !saving
            )
        }
    }

    private func save() async {
        guard let seam = model.seam, !saving else { return }
        saving = true
        defer { saving = false }
        error = nil
        do {
            let secret = form.secret.jsTrim
            let draft = ChannelDraft(
                kind: form.kind, displayName: form.displayName.jsTrim, secret: secret.isEmpty ? nil : secret,
                settings: SettingsLogic.channelSettingsJson(form), enabled: channel?.enabled ?? true
            )
            let refused: String?
            if let channel {
                refused = try await seam.updateChannel(channel.id, draft)
            } else {
                refused = try await seam.createChannel(draft)
            }
            if let refused {
                Haptics.error()
                error = refused
                return
            }
            Haptics.confirm()
            dismiss()
        } catch {
            Haptics.error()
            self.error = error is SeamError ? "The server could not be reached. Nothing was saved." : problemText(error)
        }
    }
}
#endif

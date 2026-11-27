#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// Writing a routine: describe it in a sentence and the model drafts the form,
/// or fill it in yourself.
///
/// A form, presented as a sheet: Cancel on the left, Create on the right. What
/// the form *decides* — which kinds need a channel, what a command word may look
/// like, that the schedule is a column and not a trigger row — is
/// `RoutineEditor` in the core, shared with nothing here; this only lays it out.
///
/// The schedule is the server's to read. "every weekday at 7am" becomes a cron
/// only through `POST /automations/schedule`, so a card's ✓ line is whatever
/// that call last said and nothing here guesses at it.
struct RoutineEditorScreen: View {
    let routineId: String?
    /// Opened from "+ Add trigger": a fresh card is already waiting.
    var addTrigger = false

    @Environment(AppModel.self) private var app
    /// The form's data and work, made when the sheet is first drawn and gone
    /// with it.
    @State private var kept = Kept<RoutineEditorModel>()

    var body: some View {
        let app = self.app
        let routineId = self.routineId
        let addTrigger = self.addTrigger
        RoutineEditorView(editor: kept.model {
            RoutineEditorModel(
                routineId: routineId, addTrigger: addTrigger,
                seam: { app.seam }, router: app.router, feedback: .haptics
            )
        })
    }
}

private struct RoutineEditorView: View {
    @Bindable var editor: RoutineEditorModel

    private enum SheetKind: String, Identifiable {
        case model, facet, reply, attach, trigger, secret
        var id: String { rawValue }
    }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var more = false
    @State private var sheet: SheetKind?
    @State private var editingKey: String?
    @State private var confirmingDiscard = false

    private var form: RoutineForm { editor.form }
    private var channels: [ChannelSummary] { editor.channels }
    private var busy: Bool { editor.busy }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ConnectionBanner()
                    if let error = editor.error { ErrorText(error) }
                    if !editor.loaded { Skeleton(rows: 3) } else { fields }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(editor.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    CancelBarButton { if editor.dirty { confirmingDiscard = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    ConfirmBarButton(editor.creating ? "Create" : "Save") { Task { await save(thenRun: false) } }.disabled(!editor.ready)
                }
            }
        }
        // A swipe down must not throw away a form somebody filled in.
        .interactiveDismissDisabled(editor.dirty)
        .confirmationDialog("Discard changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        }
        .task {
            switch await editor.load() {
            case .heartbeat:
                dismiss()
                return
            case .addingTrigger(let key):
                editingKey = key
                sheet = .trigger
            case .form:
                break
            }
            await editor.readStoredSchedule()
        }
        .onDisappear { editor.close() }
        .sheet(item: $sheet) { kind in
            switch kind {
            case .model: modelSheet
            case .facet: facetSheet
            case .reply: replySheet
            case .attach: AttachSheet(attachments: attachments, nodeDescription: "runs shell there, unattended")
            case .trigger: triggerSheet
            case .secret:
                SecretSheet(secrets: editor.minted, server: app.auth.credential?.server) { leave() }
            }
        }
    }

    // MARK: the form

    @ViewBuilder private var fields: some View {
        // Describe it, and let a model fill the form in.
        VStack(alignment: .leading, spacing: 8) {
            Meta("describe it")
            AppEditor(
                text: $editor.description,
                placeholder: "Every weekday morning check the deploy and tell me on Discord if anything looks wrong.",
                minHeight: 76
            )
            .disabled(busy)
            HStack(spacing: 10) {
                AppButton(
                    editor.reading.isEmpty ? "Draft the form" : "Redraft", variant: .outline, busy: editor.drafting,
                    disabled: !editor.canDraft
                ) { Task { await editor.draft() } }
                if let draftedBy = editor.draftedBy {
                    Mono("drafted in \(jsToFixed(Double(editor.draftElapsedMs) / 1000, 1))s · \(draftedBy)").lineLimit(1)
                } else {
                    Hint("Optional. The form below is the truth either way.")
                }
            }
            if !editor.reading.isEmpty {
                Meta("the agent read this as")
                ForEach(Array(editor.reading.enumerated()), id: \.offset) { _, line in Mono(line, color: Palette.foreground) }
            }
        }

        VStack(alignment: .leading, spacing: 8) {
            Meta("name")
            AppField(placeholder: "morning-digest", text: Binding(get: { editor.form.name }, set: { editor.setName($0) }))
        }

        ChoiceRow(label: "model", value: editor.modelLabel, disabled: busy) { sheet = .model }

        VStack(alignment: .leading, spacing: 8) {
            Meta("prompt")
            AppEditor(
                text: Binding(get: { editor.form.prompt }, set: { editor.setPrompt($0) }),
                placeholder: "What to do each run. It arrives with no conversation around it — answer NO_REPLY when there is nothing to say.",
                minHeight: 160
            )
            .disabled(busy)
        }

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Meta("triggers")
                Spacer()
                Button {
                    editingKey = editor.addCard()
                    sheet = .trigger
                } label: { Mono("+ add", color: Palette.primary) }.buttonStyle(.plain).disabled(busy)
            }
            if form.triggers.isEmpty { Hint("Nothing starts this yet — add a schedule, or a trigger.") }
            ForEach(form.triggers) { card in
                Button {
                    editingKey = card.key
                    sheet = .trigger
                } label: {
                    TriggerCardRow(card: card, channels: channels)
                }
                .buttonStyle(.plain)
            }
        }

        ChoiceRow(label: "reply to", value: RoutineEditor.deliveryLabel(form.delivery, channels: channels), disabled: busy) { sheet = .reply }

        // More options, folded, with a line that says what the fold holds so a
        // closed one still says what the routine will run as.
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { more.toggle() }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Meta("more options")
                        Mono(RoutineEditor.moreSummary(form)).lineLimit(1)
                    }
                    Spacer()
                    Chevron(open: more)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if more {
                ChoiceRow(label: "facet", value: form.facet, disabled: busy) { sheet = .facet }
                ChoiceRow(
                    label: "repositories & nodes",
                    value: form.repoUrls.isEmpty && form.nodeIds.isEmpty ? "none" : "\(form.repoUrls.count) · \(form.nodeIds.count)",
                    disabled: busy
                ) { sheet = .attach }
                if !form.nodeIds.isEmpty {
                    Mono("runs shell on \(form.nodeIds.count) \(form.nodeIds.count == 1 ? "machine" : "machines"), unattended", color: Palette.destructive)
                }

                Meta("time zone")
                AppField(placeholder: "UTC", text: Binding(get: { editor.form.timeZone }, set: { editor.setTimeZone($0) }))

                Meta("active hours")
                HStack(spacing: 8) {
                    AppField(placeholder: "any", text: Binding(get: { editor.form.activeStart }, set: { editor.setActiveStart($0) }), keyboard: .numbersAndPunctuation)
                    Mono("–")
                    AppField(placeholder: "any", text: Binding(get: { editor.form.activeEnd }, set: { editor.setActiveEnd($0) }), keyboard: .numbersAndPunctuation)
                }
                if !editor.activeHoursOk {
                    ErrorText("active hours read as HH:MM")
                } else {
                    Hint("Runs may only start inside this window. Blank means any time.")
                }

                Toggle(isOn: Binding(get: { editor.form.continuity }, set: { editor.setContinuity($0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        BodyText("Remember between runs")
                        Hint("Each run continues the same session instead of starting clean.")
                    }
                }
                .tint(Palette.primary)
            }
        }

        if let problem = RoutineEditor.formProblem(form) { Hint(problem) }

        HStack(spacing: 8) {
            AppButton(editor.creating ? "Create" : "Save", busy: editor.saving, disabled: !editor.ready) { Task { await save(thenRun: false) } }
            AppButton(editor.creating ? "Create and run once" : "Save and run once", variant: .outline, disabled: !editor.ready) {
                Task { await save(thenRun: true) }
            }
        }
    }

    private var attachments: Attachments {
        Attachments(
            repos: form.repoUrls,
            nodes: form.nodeIds,
            recentRepos: editor.recentChoices,
            ownedRepos: editor.owned,
            ownedLoaded: editor.ownedLoaded,
            ownedError: editor.ownedError,
            availableNodes: editor.enabledNodes.map { SheetOption(key: $0.id, label: $0.name, description: $0.host) },
            searchRepos: { [editor] term in await editor.searchRepos(term) },
            onChange: { [editor] repos, nodes in editor.attach(repos: repos, nodes: nodes) }
        )
    }

    // MARK: sheets

    private var modelSheet: some View {
        AppSheet(title: "Model") {
            SheetGroup(
                options: [SheetOption(key: "", label: "Auto", description: "Let the router pick per run")]
                    + orderModels(editor.models).map { SheetOption(key: $0.modelId, label: $0.modelDisplayName.isEmpty ? $0.modelId : $0.modelDisplayName, description: $0.connectionName) },
                selected: form.model
            ) { key in
                editor.pickModel(key)
                sheet = nil
            }
        }
    }

    private var facetSheet: some View {
        AppSheet(title: "Facet") {
            SheetGroup(
                options: editor.facets.map { SheetOption(key: $0.name, label: $0.name, description: $0.description) },
                selected: form.facet
            ) { key in
                editor.pickFacet(key)
                sheet = nil
            }
            if editor.facets.isEmpty { Hint("No facets on this account.") }
        }
    }

    private var replySheet: some View {
        AppSheet(title: "Reply to") {
            SheetGroup(
                options: [
                    SheetOption(key: "push", label: "Push notification", description: "To this phone and the cockpit"),
                    SheetOption(key: "none", label: "Nobody", description: "Log only"),
                ] + channels.filter(\.enabled).map {
                    SheetOption(key: RoutineEditor.channelKey($0.id), label: $0.displayName, description: $0.kind.name)
                },
                selected: form.delivery
            ) { key in
                editor.pickDelivery(key)
                sheet = nil
            }
        }
    }

    @ViewBuilder private var triggerSheet: some View {
        if let card = editor.card(editingKey) {
            AppSheet(title: card.slot.name, detents: [.large]) {
                // The kind picker: one line per thing that can start a routine.
                VStack(spacing: 0) {
                    ForEach(RoutineEditor.slotsFor(card, channels: channels), id: \.self) { slot in
                        let reason = RoutineEditor.unavailable(slot, card: card, cards: form.triggers, channels: channels)
                        Button { editor.pickSlot(card, slot) } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    BodyText(slot.name)
                                    Text(reason ?? slot.summary).font(AppFont.sans(12)).foregroundStyle(Palette.mutedForeground)
                                }
                                Spacer()
                                if card.slot == slot {
                                    Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.primary)
                                }
                            }
                            .padding(.vertical, 8)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(reason != nil)
                        .opacity(reason != nil ? 0.5 : 1)
                        .topBorder()
                    }
                }

                triggerFields(card)

                if card.slot != .none {
                    Toggle("Enabled", isOn: Binding(get: { card.enabled }, set: { on in editor.edit(card.key) { $0.enabled = on } }))
                        .font(AppFont.sans(14))
                        .tint(Palette.primary)
                }
                AppButton("Remove trigger", variant: .linkDestructive) {
                    editor.removeCard(card.key)
                    sheet = nil
                }
            }
        }
    }

    @ViewBuilder private func triggerFields(_ card: TriggerCard) -> some View {
        switch card.slot {
        case .none:
            EmptyView()
        case .schedule:
            Meta(card.rawCron ? "cron" : "when")
            AppField(
                placeholder: card.rawCron ? "0 7 * * 1-5" : "every weekday at 7am",
                text: Binding(get: { card.when }, set: { editor.scheduleTyped(card.key, $0) }), mono: card.rawCron
            )
            Button { editor.edit(card.key) { $0.rawCron.toggle() } } label: {
                Mono(card.rawCron ? "say it in English instead" : "type a cron instead", color: Palette.primary)
            }
            .buttonStyle(.plain)
        case .fluxer, .discord, .telegram:
            channelPicker(card)
            Meta("command")
            AppField(placeholder: "digest", text: Binding(get: { card.match }, set: { text in editor.edit(card.key) { $0.match = text } }), mono: true)
        case .email:
            channelPicker(card)
            Meta("claims mail for")
            AppField(placeholder: "reports", text: Binding(get: { card.match }, set: { text in editor.edit(card.key) { $0.match = text } }), mono: true)
            Hint("A plus-tag on the mailbox's address: mail to you+reports@… starts this routine.")
        case .webhook:
            Mono(RoutineEditor.hookPath(automationId: editor.routineId, card: card), color: Palette.foreground).textSelection(.enabled)
            Meta("only when the payload matches (optional)")
            AppField(placeholder: "{\"ref\":\"refs/heads/main\"}", text: Binding(get: { card.match }, set: { text in editor.edit(card.key) { $0.match = text } }), mono: true)
        case .heartbeat:
            SheetSegments(
                label: "rides",
                options: [
                    SheetOption(key: RoutineEditor.heartbeatAlways, label: "every beat"),
                    SheetOption(key: RoutineEditor.heartbeatNeeded, label: "when it needs you"),
                ],
                selected: card.match == RoutineEditor.heartbeatNeeded ? RoutineEditor.heartbeatNeeded : RoutineEditor.heartbeatAlways
            ) { key in editor.edit(card.key) { $0.match = key } }
        }

        if card.slot != .none {
            // ✕ when it is wrong, ✓ when it would fire, and otherwise what is
            // still missing — said quietly, since they are still typing.
            if let problem = RoutineEditor.problem(card) {
                Label(problem, systemImage: "xmark").font(AppFont.sans(12)).foregroundStyle(Palette.destructive)
            } else if RoutineEditor.isValid(card) {
                Label(RoutineEditor.confirmation(card), systemImage: "checkmark").font(AppFont.sans(12)).foregroundStyle(Status.ok)
            } else {
                Hint(RoutineEditor.pending(card))
            }
        }
    }

    @ViewBuilder private func channelPicker(_ card: TriggerCard) -> some View {
        let offered = channels.filter { $0.kind == card.slot.channelKind }
        SheetGroup(
            label: card.slot == .email ? "mailbox" : "connection",
            options: offered.map { SheetOption(key: $0.id, label: $0.displayName) },
            selected: card.channelId ?? ""
        ) { key in editor.edit(card.key) { $0.channelId = key } }
        if offered.isEmpty { Hint("Connect one in the cockpit’s settings.") }
    }

    // MARK: leaving

    private func save(thenRun: Bool) async {
        switch await editor.save(thenRun: thenRun) {
        case .showSecrets: sheet = .secret
        case .done: leave()
        case nil: break
        }
    }

    private func leave() {
        sheet = nil
        dismiss()
        editor.openSaved()
    }
}

/// One trigger on the form, closed: what it is, and whether it would fire.
private struct TriggerCardRow: View {
    let card: TriggerCard
    let channels: [ChannelSummary]

    var body: some View {
        let problem = RoutineEditor.problem(card)
        let valid = RoutineEditor.isValid(card)
        HStack(alignment: .top, spacing: 10) {
            Group {
                if problem != nil {
                    Image(systemName: "xmark").foregroundStyle(Palette.destructive)
                } else if valid {
                    Image(systemName: "checkmark").foregroundStyle(Status.ok)
                } else {
                    Image(systemName: "circle.dotted").foregroundStyle(Palette.mutedForeground)
                }
            }
            .font(.system(size: 11, weight: .bold))
            .frame(width: 14)
            .padding(.top, 3)

            VStack(alignment: .leading, spacing: 2) {
                BodyText("\(card.slot == .none ? "Trigger" : card.slot.name) · \(RoutineEditor.cardSummary(card, channels: channels))").lineLimit(2)
                Text(problem ?? (valid ? RoutineEditor.confirmation(card) : RoutineEditor.pending(card)))
                    .font(AppFont.sans(12))
                    .foregroundStyle(problem != nil ? Palette.destructive : Palette.mutedForeground)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.mutedForeground).padding(.top, 4)
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(problem != nil ? Palette.destructive.opacity(0.35) : Palette.border, lineWidth: 1))
        .opacity(card.enabled ? 1 : 0.6)
        .contentShape(Rectangle())
    }
}
#endif

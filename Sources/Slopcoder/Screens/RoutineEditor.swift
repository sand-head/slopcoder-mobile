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

    private enum SheetKind: String, Identifiable {
        case model, facet, reply, attach, trigger, secret
        var id: String { rawValue }
    }

    /// Which fields a person has touched since the last draft: a redraft may
    /// fill what was left alone, and must not overwrite what was typed.
    private struct Touched {
        var name = false
        var prompt = false
        var model = false
        var delivery = false
        var triggers = false
    }

    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var facets: [FacetOption] = []
    @State private var models: [ModelCandidate] = []
    @State private var channels: [ChannelSummary] = []
    @State private var nodes: [RemoteNodeSummary] = []
    @State private var recent: [RecentRepo] = []
    @State private var owned: [RepoChoice] = []
    @State private var ownedLoaded = false
    @State private var ownedError: String?

    @State private var form = RoutineEditor.emptyForm(timeZone: RoutineFormat.deviceZone() ?? "UTC")
    @State private var loaded = false
    @State private var loadedName = ""
    @State private var loadedEnabled = true
    @State private var dirty = false
    @State private var more = false
    @State private var description = ""
    @State private var drafting = false
    @State private var reading: [String] = []
    @State private var draftedBy: String?
    @State private var draftElapsedMs = 0
    @State private var touched = Touched()
    @State private var saving = false
    @State private var error: String?
    @State private var minted: [AutomationWebhookSecret] = []
    @State private var savedId: String?
    @State private var sheet: SheetKind?
    @State private var editingKey: String?
    @State private var confirmingDiscard = false
    @State private var parses: [String: Task<Void, Never>] = [:]

    private static let parseDebounceNs: UInt64 = 400_000_000

    private var creating: Bool { routineId == nil }
    private var busy: Bool { saving || drafting }
    private var ready: Bool { RoutineEditor.canSave(form) && !busy && loaded }
    private var zone: String { form.timeZone.trimmingCharacters(in: .whitespaces).isEmpty ? "UTC" : form.timeZone.trimmingCharacters(in: .whitespaces) }

    private var modelLabel: String {
        form.model.isEmpty ? "auto" : models.first { $0.modelId == form.model }?.modelDisplayName ?? form.model
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ConnectionBanner()
                    if let error { ErrorText(error) }
                    if !loaded { Skeleton(rows: 3) } else { fields }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(creating ? "New routine" : loadedName.isEmpty ? "Edit routine" : "Edit \(loadedName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if dirty { confirmingDiscard = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(creating ? "Create" : "Save") { Task { await save(thenRun: false) } }.disabled(!ready)
                }
            }
        }
        // A swipe down must not throw away a form somebody filled in.
        .interactiveDismissDisabled(dirty)
        .confirmationDialog("Discard changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        }
        .task { await load() }
        .onDisappear { for task in parses.values { task.cancel() } }
        .sheet(item: $sheet) { kind in
            switch kind {
            case .model: modelSheet
            case .facet: facetSheet
            case .reply: replySheet
            case .attach: AttachSheet(attachments: attachments, nodeDescription: "runs shell there, unattended")
            case .trigger: triggerSheet
            case .secret:
                SecretSheet(secrets: minted, server: model.auth.credential?.server) { leave() }
            }
        }
    }

    // MARK: the form

    @ViewBuilder private var fields: some View {
        // Describe it, and let a model fill the form in.
        VStack(alignment: .leading, spacing: 8) {
            Meta("describe it")
            AppEditor(
                text: $description,
                placeholder: "Every weekday morning check the deploy and tell me on Discord if anything looks wrong.",
                minHeight: 76
            )
            .disabled(busy)
            HStack(spacing: 10) {
                AppButton(
                    reading.isEmpty ? "Draft the form" : "Redraft", variant: .outline, busy: drafting,
                    disabled: saving || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ) { Task { await draft() } }
                if let draftedBy {
                    Mono("drafted in \(jsToFixed(Double(draftElapsedMs) / 1000, 1))s · \(draftedBy)").lineLimit(1)
                } else {
                    Hint("Optional. The form below is the truth either way.")
                }
            }
            if !reading.isEmpty {
                Meta("the agent read this as")
                ForEach(Array(reading.enumerated()), id: \.offset) { _, line in Mono(line, color: Palette.foreground) }
            }
        }

        VStack(alignment: .leading, spacing: 8) {
            Meta("name")
            AppField(placeholder: "morning-digest", text: Binding(
                get: { form.name },
                set: {
                    touched.name = true
                    form.name = $0
                    dirty = true
                }
            ))
        }

        ChoiceRow(label: "model", value: modelLabel, disabled: busy) { sheet = .model }

        VStack(alignment: .leading, spacing: 8) {
            Meta("prompt")
            AppEditor(
                text: Binding(
                    get: { form.prompt },
                    set: {
                        touched.prompt = true
                        form.prompt = $0
                        dirty = true
                    }
                ),
                placeholder: "What to do each run. It arrives with no conversation around it — answer NO_REPLY when there is nothing to say.",
                minHeight: 160
            )
            .disabled(busy)
        }

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Meta("triggers")
                Spacer()
                Button { addCard() } label: { Mono("+ add", color: Palette.primary) }.buttonStyle(.plain).disabled(busy)
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
                AppField(placeholder: "UTC", text: Binding(get: { form.timeZone }, set: zoneTyped))

                Meta("active hours")
                HStack(spacing: 8) {
                    AppField(placeholder: "any", text: Binding(get: { form.activeStart }, set: { text in
                        form.activeStart = text
                        dirty = true
                    }), keyboard: .numbersAndPunctuation)
                    Mono("–")
                    AppField(placeholder: "any", text: Binding(get: { form.activeEnd }, set: { text in
                        form.activeEnd = text
                        dirty = true
                    }), keyboard: .numbersAndPunctuation)
                }
                if !RoutineEditor.timeOk(form.activeStart) || !RoutineEditor.timeOk(form.activeEnd) {
                    ErrorText("active hours read as HH:MM")
                } else {
                    Hint("Runs may only start inside this window. Blank means any time.")
                }

                Toggle(isOn: Binding(get: { form.continuity }, set: { on in
                    form.continuity = on
                    dirty = true
                })) {
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
            AppButton(creating ? "Create" : "Save", busy: saving, disabled: !ready) { Task { await save(thenRun: false) } }
            AppButton(creating ? "Create and run once" : "Save and run once", variant: .outline, disabled: !ready) {
                Task { await save(thenRun: true) }
            }
        }
    }

    private var attachments: Attachments {
        Attachments(
            repos: form.repoUrls,
            nodes: form.nodeIds,
            recentRepos: recent.map(recentToChoice),
            ownedRepos: owned,
            ownedLoaded: ownedLoaded,
            ownedError: ownedError,
            availableNodes: nodes.filter(\.enabled).map { SheetOption(key: $0.id, label: $0.name, description: $0.host) },
            searchRepos: { term in
                guard let seam = model.seam else { return [] }
                return ((try? await seam.searchRepos(term)) ?? []).map(rowToChoice)
            },
            onChange: { repos, nodes in
                form.repoUrls = repos
                form.nodeIds = nodes
                dirty = true
            }
        )
    }

    // MARK: sheets

    private var modelSheet: some View {
        AppSheet(title: "Model") {
            SheetGroup(
                options: [SheetOption(key: "", label: "Auto", description: "Let the router pick per run")]
                    + orderModels(models).map { SheetOption(key: $0.modelId, label: $0.modelDisplayName.isEmpty ? $0.modelId : $0.modelDisplayName, description: $0.connectionName) },
                selected: form.model
            ) { key in
                touched.model = true
                form.model = key
                dirty = true
                sheet = nil
            }
        }
    }

    private var facetSheet: some View {
        AppSheet(title: "Facet") {
            SheetGroup(
                options: facets.map { SheetOption(key: $0.name, label: $0.name, description: $0.description) },
                selected: form.facet
            ) { key in
                form.facet = key
                dirty = true
                sheet = nil
            }
            if facets.isEmpty { Hint("No facets on this account.") }
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
                touched.delivery = true
                form.delivery = key
                dirty = true
                sheet = nil
            }
        }
    }

    @ViewBuilder private var triggerSheet: some View {
        if let card = form.triggers.first(where: { $0.key == editingKey }) {
            AppSheet(title: card.slot.name, detents: [.large]) {
                // The kind picker: one line per thing that can start a routine.
                VStack(spacing: 0) {
                    ForEach(RoutineEditor.slotsFor(card, channels: channels), id: \.self) { slot in
                        let reason = RoutineEditor.unavailable(slot, card: card, cards: form.triggers, channels: channels)
                        Button { pickSlot(card, slot) } label: {
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
                    Toggle("Enabled", isOn: Binding(get: { card.enabled }, set: { on in edit(card.key) { $0.enabled = on } }))
                        .font(AppFont.sans(14))
                        .tint(Palette.primary)
                }
                AppButton("Remove trigger", variant: .linkDestructive) { removeCard(card.key) }
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
                text: Binding(get: { card.when }, set: { scheduleTyped(card.key, $0) }), mono: card.rawCron
            )
            Button { edit(card.key) { $0.rawCron.toggle() } } label: {
                Mono(card.rawCron ? "say it in English instead" : "type a cron instead", color: Palette.primary)
            }
            .buttonStyle(.plain)
        case .fluxer, .discord, .telegram:
            channelPicker(card)
            Meta("command")
            AppField(placeholder: "digest", text: Binding(get: { card.match }, set: { text in edit(card.key) { $0.match = text } }), mono: true)
        case .email:
            channelPicker(card)
            Meta("claims mail for")
            AppField(placeholder: "reports", text: Binding(get: { card.match }, set: { text in edit(card.key) { $0.match = text } }), mono: true)
            Hint("A plus-tag on the mailbox's address: mail to you+reports@… starts this routine.")
        case .webhook:
            Mono(RoutineEditor.hookPath(automationId: routineId, card: card), color: Palette.foreground).textSelection(.enabled)
            Meta("only when the payload matches (optional)")
            AppField(placeholder: "{\"ref\":\"refs/heads/main\"}", text: Binding(get: { card.match }, set: { text in edit(card.key) { $0.match = text } }), mono: true)
        case .heartbeat:
            SheetSegments(
                label: "rides",
                options: [
                    SheetOption(key: RoutineEditor.heartbeatAlways, label: "every beat"),
                    SheetOption(key: RoutineEditor.heartbeatNeeded, label: "when it needs you"),
                ],
                selected: card.match == RoutineEditor.heartbeatNeeded ? RoutineEditor.heartbeatNeeded : RoutineEditor.heartbeatAlways
            ) { key in edit(card.key) { $0.match = key } }
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
        ) { key in edit(card.key) { $0.channelId = key } }
        if offered.isEmpty { Hint("Connect one in the cockpit’s settings.") }
    }

    // MARK: editing

    private func edit(_ key: String, _ change: (inout TriggerCard) -> Void) {
        guard let index = form.triggers.firstIndex(where: { $0.key == key }) else { return }
        change(&form.triggers[index])
        dirty = true
        touched.triggers = true
    }

    private func setParse(_ key: String, _ change: (inout TriggerCard) -> Void) {
        guard let index = form.triggers.firstIndex(where: { $0.key == key }) else { return }
        change(&form.triggers[index])
    }

    private func addCard() {
        let card = RoutineEditor.newCard()
        form.triggers.append(card)
        dirty = true
        touched.triggers = true
        editingKey = card.key
        sheet = .trigger
    }

    private func removeCard(_ key: String) {
        parses[key]?.cancel()
        parses[key] = nil
        form.triggers.removeAll { $0.key == key }
        dirty = true
        touched.triggers = true
        sheet = nil
    }

    private func pickSlot(_ card: TriggerCard, _ slot: TriggerSlot) {
        if RoutineEditor.unavailable(slot, card: card, cards: form.triggers, channels: channels) != nil { return }
        Haptics.select()
        parses[card.key]?.cancel()
        edit(card.key) {
            $0.slot = slot
            $0.channelId = nil
            $0.match = slot == .heartbeat ? RoutineEditor.heartbeatAlways : ""
            $0.when = ""
            $0.rawCron = false
            $0.parse = nil
            $0.parsing = false
        }
    }

    private func scheduleTyped(_ key: String, _ text: String) {
        edit(key) { $0.when = text }
        parse(key, text, immediate: false)
    }

    private func zoneTyped(_ text: String) {
        form.timeZone = text
        dirty = true
        // The same words mean a different moment in a different zone.
        for card in form.triggers where card.slot == .schedule { parse(card.key, card.when, immediate: false) }
    }

    /// Ask the server what a typed schedule means. Debounced, and each keystroke
    /// cancels the last, so a slow answer to an old phrase never overwrites the
    /// answer to the current one.
    @discardableResult
    private func parse(_ key: String, _ text: String, immediate: Bool) -> Task<Void, Never>? {
        parses[key]?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let seam = model.seam else {
            parses[key] = nil
            setParse(key) {
                $0.parse = nil
                $0.parsing = false
            }
            return nil
        }
        setParse(key) { $0.parsing = true }
        let zone = self.zone
        let task = Task {
            if !immediate { try? await Task.sleep(nanoseconds: RoutineEditorScreen.parseDebounceNs) }
            if Task.isCancelled { return }
            let read: ScheduleParse
            do {
                read = try await seam.parseSchedule(trimmed, timeZoneId: zone)
            } catch {
                if Task.isCancelled { return }
                read = ScheduleParse(ok: false, error: "the server could not be reached to read that")
            }
            if Task.isCancelled { return }
            setParse(key) {
                $0.parse = read
                $0.parsing = false
            }
        }
        parses[key] = task
        return task
    }

    /// A stored schedule arrives as a cron. If the server can say it in English
    /// and reads that English back as the same cron, show the English.
    private func preferEnglish(_ key: String, cron: String) async {
        guard let seam = model.seam else { return }
        setParse(key) { $0.parsing = true }
        guard let read = try? await seam.parseSchedule(cron, timeZoneId: zone) else {
            setParse(key) { $0.parsing = false }
            return
        }
        if read.ok, let readCron = read.cron, !readCron.isEmpty, let sentence = read.sentence, !sentence.isEmpty,
           let again = try? await seam.parseSchedule(sentence, timeZoneId: zone), again.ok, again.cron == readCron {
            setParse(key) {
                $0.when = sentence
                $0.rawCron = false
                $0.parse = again
                $0.parsing = false
            }
            return
        }
        setParse(key) {
            $0.parse = read
            $0.parsing = false
        }
    }

    // MARK: work

    private func load() async {
        guard let seam = model.seam, !loaded else { return }
        async let facetList = try? seam.facets()
        async let modelList = try? seam.models()
        async let channelList = try? seam.channels()
        async let nodeList = try? seam.nodes()
        async let recentList = try? seam.recentRepos()
        facets = await facetList ?? []
        models = await modelList ?? []
        channels = await channelList ?? []
        nodes = await nodeList ?? []
        recent = await recentList ?? []

        Task {
            if let listing = try? await seam.repos() {
                owned = listing.repos.map(rowToChoice)
                ownedError = listing.errors.isEmpty ? nil : "Couldn't list repositories — \(listing.errors.joined(separator: "; "))"
            }
            ownedLoaded = true
        }

        guard let routineId else {
            // A new routine opens on one empty trigger card: something has to start it.
            if form.triggers.isEmpty { form.triggers = [RoutineEditor.newCard()] }
            dirty = false
            loaded = true
            return
        }

        guard let detail = try? await seam.routine(routineId) else {
            error = "That routine could not be loaded."
            loaded = true
            return
        }
        let routine = detail.routine
        // The heartbeat is not a form; its controls are on its own page.
        if routine.kind == .heartbeat {
            dismiss()
            return
        }
        var filled = RoutineEditor.formOf(routine, channels: channels, facets: facets.map(\.name))
        if addTrigger {
            let card = RoutineEditor.newCard()
            filled.triggers.append(card)
            editingKey = card.key
        }
        loadedName = routine.name
        loadedEnabled = routine.enabled
        form = filled
        loaded = true
        dirty = addTrigger
        if addTrigger { sheet = .trigger }
        if let schedule = filled.triggers.first(where: { $0.slot == .schedule }) {
            await preferEnglish(schedule.key, cron: schedule.when)
        }
    }

    private func draft() async {
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let seam = model.seam, !busy, !text.isEmpty else { return }
        drafting = true
        error = nil
        defer { drafting = false }
        do {
            let zoneId = form.timeZone.trimmingCharacters(in: .whitespaces)
            let result = try await seam.draftRoutine(text, timeZoneId: zoneId.isEmpty ? nil : zoneId)
            draftElapsedMs = result.elapsedMs
            guard result.ok else {
                Haptics.error()
                error = result.error ?? "No model could draft that. Fill the form in yourself."
                return
            }
            draftedBy = result.draftedBy
            reading = result.reading
            await adopt(result)
            Haptics.success()
        } catch {
            Haptics.error()
            self.error = "Drafting could not reach the server. Fill the form in yourself."
        }
    }

    /// Take a draft into the form — but only into the fields nobody has typed in
    /// since the last one. A redraft that overwrote a hand-fixed prompt would be
    /// the last time anyone pressed it.
    private func adopt(_ result: RoutineDraftResult) async {
        if !touched.name, let name = result.name, !name.isEmpty { form.name = name }
        if !touched.prompt, let prompt = result.prompt, !prompt.isEmpty { form.prompt = prompt }
        if !touched.model, let picked = result.model, models.contains(where: { $0.modelId == picked }) { form.model = picked }
        if !touched.delivery { form.delivery = RoutineEditor.keyFor(result.deliveryKind, targetId: result.deliveryTargetId) }

        var schedules: [TriggerCard] = []
        if !touched.triggers, !result.triggers.isEmpty {
            for task in parses.values { task.cancel() }
            parses = [:]
            let cards = result.triggers.map { RoutineEditor.cardOfProposal($0, channels: channels) }
            form.triggers = cards
            schedules = cards.filter { $0.slot == .schedule }
        }
        dirty = true
        touched = Touched()
        for card in schedules { await parse(card.key, card.when, immediate: true)?.value }
    }

    /// Save, and answer with the routine's id — or nil when it was refused.
    private func persist() async -> String? {
        guard let seam = model.seam, !saving else { return nil }
        saving = true
        error = nil
        defer { saving = false }
        do {
            if let routineId {
                let updated = try await seam.updateRoutine(routineId, RoutineEditor.toDraft(form, enabled: loadedEnabled))
                if let problem = updated.error { return refused(problem) }
                minted = updated.webhooks
                dirty = false
                return routineId
            }
            let created = try await seam.createRoutine(RoutineEditor.toDraft(form, enabled: true))
            if let problem = created.error { return refused(problem) }
            minted = created.webhooks
            dirty = false
            if let first = created.webhooks.first { return first.automationId }
            // A create answers with secrets, not with the row. Without a webhook
            // there is no id in the answer, so the newest routine of this name is it.
            let wanted = form.name.trimmingCharacters(in: .whitespaces)
            let all = (try? await seam.routines()) ?? []
            return all.filter { $0.kind == .job && $0.name == wanted }.max { $0.createdAt < $1.createdAt }?.id ?? ""
        } catch {
            return refused("The server could not be reached. Nothing was saved.")
        }
    }

    private func refused(_ why: String) -> String? {
        Haptics.error()
        error = why
        return nil
    }

    private func save(thenRun: Bool) async {
        guard let target = await persist() else { return }
        if thenRun, !target.isEmpty, let seam = model.seam {
            if let why = try? await seam.runRoutineNow(target) {
                Haptics.error()
                error = why
                return
            }
        }
        Haptics.confirm()
        savedId = target.isEmpty ? nil : target
        // A minted webhook secret is readable exactly once: show it before leaving.
        if !minted.isEmpty { sheet = .secret } else { leave() }
    }

    private func leave() {
        sheet = nil
        let created = creating ? savedId : nil
        dismiss()
        if let created { router.push(.routine(id: created, run: nil)) }
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

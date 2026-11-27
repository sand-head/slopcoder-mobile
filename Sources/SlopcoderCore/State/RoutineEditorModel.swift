// The routine editor's data and work: the catalogs the form offers, the form
// itself and which of its fields a person has touched, the server's reading of
// each typed schedule, the natural-language draft, and saving.
//
// What the form *decides* — which kinds need a channel, what a command word
// may look like, how a form becomes a draft — is `RoutineEditor`, the rules
// this builds on. The view keeps which sheet is open, which trigger card it is
// editing, whether "more options" is unfolded and whether it is asking to
// discard; it lays out the rest.

import Foundation
import Observation

@MainActor
@Observable
public final class RoutineEditorModel {
    /// Which fields a person has touched since the last draft: a redraft may
    /// fill what was left alone, and must not overwrite what was typed.
    public struct Touched: Equatable, Sendable {
        public var name = false
        public var prompt = false
        public var model = false
        public var delivery = false
        public var triggers = false

        public init() {}
    }

    /// What opening the form came to, for the screen to act on.
    public enum Opened: Equatable, Sendable {
        /// The form is ready.
        case form
        /// The heartbeat is not a form; its controls are on its own page.
        case heartbeat
        /// Opened from "+ Add trigger": this card is waiting to be edited.
        case addingTrigger(String)
    }

    /// What a save came to, when it was not refused.
    public enum Saved: Equatable, Sendable {
        /// A minted webhook secret is readable exactly once: show it before leaving.
        case showSecrets
        case done
    }

    public let routineId: String?
    public let addTrigger: Bool

    public private(set) var facets: [FacetOption] = []
    public private(set) var models: [ModelCandidate] = []
    public private(set) var channels: [ChannelSummary] = []
    public private(set) var nodes: [RemoteNodeSummary] = []
    public private(set) var recent: [RecentRepo] = []
    public private(set) var owned: [RepoChoice] = []
    public private(set) var ownedLoaded = false
    public private(set) var ownedError: String?

    public private(set) var form: RoutineForm
    public private(set) var loaded = false
    public private(set) var loadedName = ""
    public private(set) var loadedEnabled = true
    public private(set) var dirty = false
    public var description = ""
    public private(set) var drafting = false
    public private(set) var reading: [String] = []
    public private(set) var draftedBy: String?
    public private(set) var draftElapsedMs = 0
    public private(set) var touched = Touched()
    public private(set) var saving = false
    public private(set) var error: String?
    public private(set) var minted: [AutomationWebhookSecret] = []
    public private(set) var savedId: String?

    @ObservationIgnored private var parses: [String: Task<Void, Never>] = [:]
    /// A stored schedule to read back as English once the form is on screen.
    @ObservationIgnored private var storedSchedule: (key: String, cron: String)?
    @ObservationIgnored private let seam: @MainActor () -> Seam?
    @ObservationIgnored private let router: Router
    @ObservationIgnored private let feedback: Feedback
    @ObservationIgnored private let debounce: @Sendable (_ milliseconds: Int) async -> Void

    public static let parseDebounceMs = 400

    public init(
        routineId: String?,
        addTrigger: Bool = false,
        seam: @escaping @MainActor () -> Seam?,
        router: Router,
        feedback: Feedback = .silent,
        timeZone: String = RoutineFormat.deviceZone() ?? "UTC",
        debounce: @escaping @Sendable (_ milliseconds: Int) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0) * 1_000_000) }
    ) {
        self.routineId = routineId
        self.addTrigger = addTrigger
        self.seam = seam
        self.router = router
        self.feedback = feedback
        self.debounce = debounce
        form = RoutineEditor.emptyForm(timeZone: timeZone)
    }

    // MARK: what the form shows

    public var creating: Bool { routineId == nil }
    public var busy: Bool { saving || drafting }
    public var ready: Bool { RoutineEditor.canSave(form) && !busy && loaded }
    public var canDraft: Bool { !saving && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var title: String {
        creating ? "New routine" : loadedName.isEmpty ? "Edit routine" : "Edit \(loadedName)"
    }

    /// The zone typed schedules are read in.
    public var zone: String {
        let typed = form.timeZone.trimmingCharacters(in: .whitespaces)
        return typed.isEmpty ? "UTC" : typed
    }

    public var modelLabel: String {
        form.model.isEmpty ? "auto" : models.first { $0.modelId == form.model }?.modelDisplayName ?? form.model
    }

    public var recentChoices: [RepoChoice] { recent.map(recentToChoice) }
    public var enabledNodes: [RemoteNodeSummary] { nodes.filter(\.enabled) }
    public var activeHoursOk: Bool { RoutineEditor.timeOk(form.activeStart) && RoutineEditor.timeOk(form.activeEnd) }

    public func card(_ key: String?) -> TriggerCard? { form.triggers.first { $0.key == key } }

    // MARK: opening

    /// Read the catalogs, then the routine into the form. Once only.
    public func load() async -> Opened {
        guard let seam = seam(), !loaded else { return .form }
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
            return .form
        }

        guard let detail = try? await seam.routine(routineId) else {
            error = "That routine could not be loaded."
            loaded = true
            return .form
        }
        let routine = detail.routine
        if routine.kind == .heartbeat { return .heartbeat }
        var filled = RoutineEditor.formOf(routine, channels: channels, facets: facets.map(\.name))
        var added: String?
        if addTrigger {
            let card = RoutineEditor.newCard()
            filled.triggers.append(card)
            added = card.key
        }
        loadedName = routine.name
        loadedEnabled = routine.enabled
        form = filled
        loaded = true
        dirty = addTrigger
        if let schedule = filled.triggers.first(where: { $0.slot == .schedule }) {
            storedSchedule = (schedule.key, schedule.when)
        }
        return added.map(Opened.addingTrigger) ?? .form
    }

    /// A stored schedule arrives as a cron. If the server can say it in English
    /// and reads that English back as the same cron, show the English. Called
    /// once the form `load` filled is on screen.
    public func readStoredSchedule() async {
        guard let (key, cron) = storedSchedule else { return }
        storedSchedule = nil
        guard let seam = seam() else { return }
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

    /// The screen went: no schedule reading is wanted any more.
    public func close() {
        for task in parses.values { task.cancel() }
    }

    // MARK: editing

    public func setName(_ text: String) {
        touched.name = true
        form.name = text
        dirty = true
    }

    public func setPrompt(_ text: String) {
        touched.prompt = true
        form.prompt = text
        dirty = true
    }

    public func pickModel(_ key: String) {
        touched.model = true
        form.model = key
        dirty = true
    }

    public func pickFacet(_ key: String) {
        form.facet = key
        dirty = true
    }

    public func pickDelivery(_ key: String) {
        touched.delivery = true
        form.delivery = key
        dirty = true
    }

    public func attach(repos: [String], nodes: [String]) {
        form.repoUrls = repos
        form.nodeIds = nodes
        dirty = true
    }

    public func setActiveStart(_ text: String) {
        form.activeStart = text
        dirty = true
    }

    public func setActiveEnd(_ text: String) {
        form.activeEnd = text
        dirty = true
    }

    public func setContinuity(_ on: Bool) {
        form.continuity = on
        dirty = true
    }

    public func setTimeZone(_ text: String) {
        form.timeZone = text
        dirty = true
        // The same words mean a different moment in a different zone.
        for card in form.triggers where card.slot == .schedule { parse(card.key, card.when, immediate: false) }
    }

    public func edit(_ key: String, _ change: (inout TriggerCard) -> Void) {
        guard let index = form.triggers.firstIndex(where: { $0.key == key }) else { return }
        change(&form.triggers[index])
        dirty = true
        touched.triggers = true
    }

    /// A fresh trigger card, for the screen to open.
    public func addCard() -> String {
        let card = RoutineEditor.newCard()
        form.triggers.append(card)
        dirty = true
        touched.triggers = true
        return card.key
    }

    public func removeCard(_ key: String) {
        parses[key]?.cancel()
        parses[key] = nil
        form.triggers.removeAll { $0.key == key }
        dirty = true
        touched.triggers = true
    }

    public func pickSlot(_ card: TriggerCard, _ slot: TriggerSlot) {
        if RoutineEditor.unavailable(slot, card: card, cards: form.triggers, channels: channels) != nil { return }
        feedback.select()
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

    public func scheduleTyped(_ key: String, _ text: String) {
        edit(key) { $0.when = text }
        parse(key, text, immediate: false)
    }

    public func searchRepos(_ term: String) async -> [RepoChoice] {
        guard let seam = seam() else { return [] }
        return ((try? await seam.searchRepos(term)) ?? []).map(rowToChoice)
    }

    private func setParse(_ key: String, _ change: (inout TriggerCard) -> Void) {
        guard let index = form.triggers.firstIndex(where: { $0.key == key }) else { return }
        change(&form.triggers[index])
    }

    /// Ask the server what a typed schedule means. Debounced, and each keystroke
    /// cancels the last, so a slow answer to an old phrase never overwrites the
    /// answer to the current one.
    @discardableResult
    private func parse(_ key: String, _ text: String, immediate: Bool) -> Task<Void, Never>? {
        parses[key]?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let seam = seam() else {
            parses[key] = nil
            setParse(key) {
                $0.parse = nil
                $0.parsing = false
            }
            return nil
        }
        setParse(key) { $0.parsing = true }
        let zone = self.zone
        let debounce = self.debounce
        let task = Task {
            if !immediate { await debounce(RoutineEditorModel.parseDebounceMs) }
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

    // MARK: drafting

    public func draft() async {
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let seam = seam(), !busy, !text.isEmpty else { return }
        drafting = true
        error = nil
        defer { drafting = false }
        do {
            let zoneId = form.timeZone.trimmingCharacters(in: .whitespaces)
            let result = try await seam.draftRoutine(text, timeZoneId: zoneId.isEmpty ? nil : zoneId)
            draftElapsedMs = result.elapsedMs
            guard result.ok else {
                feedback.error()
                error = result.error ?? "No model could draft that. Fill the form in yourself."
                return
            }
            draftedBy = result.draftedBy
            reading = result.reading
            await adopt(result)
            feedback.success()
        } catch {
            feedback.error()
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

    // MARK: saving

    /// Save, and run once if asked. Nil when it was refused or could not be
    /// sent; `error` says why.
    public func save(thenRun: Bool) async -> Saved? {
        guard let target = await persist() else { return nil }
        if thenRun, !target.isEmpty, let seam = seam() {
            if let why = try? await seam.runRoutineNow(target) {
                feedback.error()
                error = why
                return nil
            }
        }
        feedback.confirm()
        savedId = target.isEmpty ? nil : target
        return minted.isEmpty ? .done : .showSecrets
    }

    /// The form has gone; a routine it created opens in its place.
    public func openSaved() {
        if creating, let savedId { router.select(.routine(id: savedId, run: nil)) }
    }

    /// Save, and answer with the routine's id — or nil when it was refused.
    private func persist() async -> String? {
        guard let seam = seam(), !saving else { return nil }
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
        feedback.error()
        error = why
        return nil
    }
}

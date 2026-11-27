// What the routine editor decides, kept out of the screen.
//
// A port of `Pages/Routines/TriggerEdit.cs` and the parts of `Editor.razor`
// that assemble the server's draft. The rules here are the ones the web form
// and the server already agree on — which kinds need a channel, what a
// command word may look like, that a routine has one clock and it is a
// column rather than a trigger row — and a second, phone-shaped copy of any
// of them would be a copy that drifts. So this is one module, pure and
// table-testable, and the screen only lays it out.
//
// The one thing the server owns outright is the schedule: "every weekday at
// 7am" becomes a cron only through `POST /automations/schedule`, so a card's
// `parse` is whatever that call last said and nothing here guesses at it.

import Foundation

// MARK: - trigger cards

/// One line of the kind picker. Not `AutomationTriggerKind`, because the picker
/// is not that enum: the schedule is a column on the routine rather than a
/// trigger row, and one chat-command kind is three lines in the menu — a
/// Discord command and a Telegram command differ only in which connection they
/// may name, which is exactly what somebody choosing a trigger is choosing
/// between.
public enum TriggerSlot: String, Sendable, CaseIterable {
    case none, schedule, fluxer, discord, telegram, email, webhook, heartbeat

    /// The picker's lines, in the order the cockpit lists them.
    public static let picker: [TriggerSlot] = [.schedule, .fluxer, .discord, .telegram, .email, .webhook, .heartbeat]

    /// The contract kind a slot writes; nil is the synthesized schedule.
    public var kind: AutomationTriggerKind? {
        switch self {
        case .fluxer, .discord, .telegram: return .channelCommand
        case .email: return .email
        case .webhook: return .webhook
        case .heartbeat: return .heartbeat
        case .none, .schedule: return nil
        }
    }

    /// The connections a slot's channel picker may offer; nil is "none".
    public var channelKind: ChannelKind? {
        switch self {
        case .fluxer: return .fluxer
        case .discord: return .discord
        case .telegram: return .telegram
        case .email: return .email
        default: return nil
        }
    }

    /// What the picker calls a slot.
    public var name: String {
        switch self {
        case .schedule: return "Schedule"
        case .fluxer: return "Fluxer command"
        case .discord: return "Discord command"
        case .telegram: return "Telegram command"
        case .email: return "Email"
        case .webhook: return "Webhook"
        case .heartbeat: return "Heartbeat"
        case .none: return "Choose a trigger kind"
        }
    }

    /// The line under the name: what this kind fires on.
    public var summary: String {
        switch self {
        case .schedule: return "fires on its own"
        case .fluxer: return "fires when someone types it in Fluxer"
        case .discord: return "fires when someone types it in Discord"
        case .telegram: return "fires when a command reaches your bot"
        case .email: return "fires when mail arrives for it"
        case .webhook: return "fires when a POST arrives"
        case .heartbeat: return "rides the periodic check-in"
        case .none: return ""
        }
    }

    /// The ✓ line's note — what happens once it fires. The schedule's is the one
    /// exception: it is the parse, and `confirmation` writes that.
    public var note: String {
        switch self {
        case .fluxer, .discord: return "replies where it was called · text after the command is appended to the prompt"
        case .telegram: return "replies in the same chat · text after the command is appended to the prompt"
        case .email: return "replies to the sender · the mail is attached to the prompt"
        case .webhook: return "secret shown once after create · payload is attached to the prompt as JSON"
        case .heartbeat: return "every 30 min · 08:00–22:00 · uses the heartbeat notepad"
        case .none, .schedule: return ""
        }
    }

    var isChatCommand: Bool { self == .fluxer || self == .discord || self == .telegram }
}

/// One trigger while it is being edited.
public struct TriggerCard: Hashable, Sendable, Identifiable {
    /// A stable key for the list. `id` cannot be it: a card the user just added
    /// has no id until the server assigns one, and two of them would collide.
    public var key: String
    /// The stored trigger's id, or the empty Guid for a card the user just added.
    public var triggerId: String
    public var slot: TriggerSlot
    public var enabled: Bool
    /// The connection this listens on, for the chat-command and email kinds.
    public var channelId: String?
    /// The command word, the plus-tag, the webhook's optional JSON filter, or the
    /// heartbeat's `always`/`needed` — whatever this kind matches on.
    public var match: String
    /// What the user typed into a schedule card: English, or raw cron.
    public var when: String
    /// Whether the schedule field is a raw cron box rather than English.
    public var rawCron: Bool
    /// What the server made of `when`, once it has answered.
    public var parse: ScheduleParse?
    /// A parse is in flight: the ✓ line waits rather than flashing an error.
    public var parsing: Bool

    public var id: String { key }

    public init(key: String, triggerId: String, slot: TriggerSlot, enabled: Bool, channelId: String? = nil, match: String, when: String, rawCron: Bool, parse: ScheduleParse? = nil, parsing: Bool) {
        self.key = key
        self.triggerId = triggerId
        self.slot = slot
        self.enabled = enabled
        self.channelId = channelId
        self.match = match
        self.when = when
        self.rawCron = rawCron
        self.parse = parse
        self.parsing = parsing
    }
}

public enum RoutineEditor {
    /// The server's two words for how a heartbeat trigger rides the beat.
    public static let heartbeatAlways = "always"
    public static let heartbeatNeeded = "needed"

    /// The facet a new routine runs as, which is the cockpit's default too.
    public static let defaultFacet = "execute"

    /// The next card's number. Cards are made wherever a form is, so the
    /// counter is shared.
    private static let nextKey = Locked(1)

    /// A fresh card with nothing picked.
    public static func newCard(_ slot: TriggerSlot = .none) -> TriggerCard {
        let key: Int = nextKey.withLock { next in
            defer { next += 1 }
            return next
        }
        return TriggerCard(
            key: "card-\(key)", triggerId: emptyGuid, slot: slot, enabled: true, channelId: nil,
            match: slot == .heartbeat ? heartbeatAlways : "", when: "", rawCron: false, parse: nil, parsing: false
        )
    }

    /// The same word the server accepts; see `AutomationTriggerRules.CommandWord`.
    static func isCommandWord(_ word: String) -> Bool {
        firstMatch("^[a-z][a-z0-9-]{0,31}$", in: word) != nil && !word.jsHasNewline
    }

    /// The command as the server will store it: no leading slash, no surrounding space.
    public static func commandWord(_ match: String) -> String {
        var word = Substring(match.jsTrim).unicodeScalars
        while word.first == "/" { word.removeFirst() }
        return String(word)
    }

    /// Whether a card would survive the server's validation.
    public static func isValid(_ card: TriggerCard) -> Bool {
        switch card.slot {
        case .none: return false
        case .schedule: return card.parse?.ok == true && !(card.parse?.cron ?? "").isEmpty
        case .fluxer, .discord, .telegram: return card.channelId != nil && isCommandWord(commandWord(card.match))
        case .email: return card.channelId != nil && !card.match.jsTrim.isEmpty
        case .webhook, .heartbeat: return true
        }
    }

    /// Why a card is not ready, in the words the ✕ line uses. Nil when it is — or
    /// when the user has typed nothing yet, which is not an error to shout about
    /// while they are still filling the card in.
    public static func problem(_ card: TriggerCard) -> String? {
        let typed = !card.match.jsTrim.isEmpty
        switch card.slot {
        case .schedule:
            if card.parsing || card.when.jsTrim.isEmpty { return nil }
            if let parse = card.parse, !parse.ok {
                return parse.error ?? "couldn’t read that — try \"every weekday at 7am\""
            }
            return nil
        case .fluxer, .discord, .telegram:
            if typed, !isCommandWord(commandWord(card.match)) {
                return "a command word is lowercase letters, digits and hyphens, starting with a letter"
            }
            if typed, card.channelId == nil {
                return "pick the \(card.slot.name.replacingOccurrences(of: " command", with: "")) connection it listens on"
            }
            return nil
        case .email:
            return typed && card.channelId == nil ? "pick the mailbox it listens on" : nil
        default:
            return nil
        }
    }

    /// What is still missing, before the user has typed enough to be wrong.
    public static func pending(_ card: TriggerCard) -> String {
        switch card.slot {
        case .schedule: return card.parsing ? "reading that…" : "say when, in English — \"every weekday at 7am\""
        case .email: return "say what mail it claims, and which mailbox"
        default: return "say the word it answers to, and where"
        }
    }

    /// The ✓ line: the parse for a schedule, the kind's note otherwise.
    public static func confirmation(_ card: TriggerCard, in context: TimeContext = .current) -> String {
        if card.slot != .schedule { return card.slot.note }
        guard let parse = card.parse, parse.ok else { return "" }
        var first = ""
        if let at = WireDate.parse(parse.firstRun) {
            first = " · first run \(context.format(at, template: "EEE")), \(context.format(at, template: "MMMd")), \(context.format(at, pattern: "HH:mm"))"
        }
        // A zone the server did not name is left out rather than printed as a blank.
        return "\(parse.cron ?? "")\(parse.zone.truthy.map { " · \($0)" } ?? "")\(first)"
    }

    /// One line that says what a card is, for the row it sits in before it is
    /// opened: "Every weekday at 07:00", "/digest on Discord · bot", "POST
    /// /api/hooks/…", "rides every beat".
    public static func cardSummary(_ card: TriggerCard, channels: [ChannelSummary]) -> String {
        let channel = channels.first { $0.id == card.channelId }?.displayName.nonEmpty
        switch card.slot {
        case .none:
            return "pick a kind"
        case .schedule:
            if let parse = card.parse, parse.ok, let sentence = parse.sentence.truthy { return sentence }
            return card.when.jsTrim.nonEmpty ?? "say when"
        case .fluxer, .discord, .telegram:
            let word = commandWord(card.match)
            return "\(word.isEmpty ? "a command" : "/\(word)")\(channel.map { " on \($0)" } ?? "")"
        case .email:
            return "\(card.match.jsTrim.nonEmpty ?? "mail")\(channel.map { " at \($0)" } ?? "")"
        case .webhook:
            return card.match.jsTrim.nonEmpty.map { "POST · \($0)" } ?? "POST /api/hooks/…"
        case .heartbeat:
            return card.match == heartbeatNeeded ? "when the check-in needs you" : "every beat"
        }
    }

    private static func chatSlot(_ kind: ChannelKind?) -> TriggerSlot {
        switch kind {
        case ChannelKind.fluxer?: return .fluxer
        case ChannelKind.telegram?: return .telegram
        default: return .discord
        }
    }

    /// Which line of the picker a stored trigger is on. A chat command is told
    /// apart by the connection it names, so a command whose channel is gone falls
    /// back to Discord with an empty picker rather than vanishing from the form.
    public static func slotOf(_ trigger: AutomationTrigger, channels: [ChannelSummary]) -> TriggerSlot {
        switch trigger.kind {
        case .email: return .email
        case .webhook: return .webhook
        case .heartbeat: return .heartbeat
        default: return chatSlot(channels.first { $0.id == trigger.channelId }?.kind)
        }
    }

    /// A stored trigger as a card on the form.
    public static func cardOf(_ trigger: AutomationTrigger, channels: [ChannelSummary]) -> TriggerCard {
        var card = newCard(slotOf(trigger, channels: channels))
        card.triggerId = trigger.id
        card.enabled = trigger.enabled
        card.channelId = trigger.channelId
        card.match = trigger.match ?? ""
        return card
    }

    /// The routine's own clock as a card. The synthesized schedule carries the
    /// routine's id rather than one of its own, and starts as the raw cron: the
    /// screen asks the server whether it reads back as a sentence.
    public static func scheduleCardOf(_ routine: AutomationSummary) -> TriggerCard? {
        if routine.cronExpression.isEmpty { return nil }
        var card = newCard(.schedule)
        card.triggerId = routine.id
        card.enabled = routine.scheduleEnabled
        card.when = routine.cronExpression
        card.rawCron = true
        return card
    }

    /// One proposed trigger from a draft as a card on the form.
    public static func cardOfProposal(_ proposed: RoutineDraftTrigger, channels: [ChannelSummary]) -> TriggerCard {
        guard let kind = proposed.kind else {
            var card = newCard(.schedule)
            card.when = proposed.when ?? ""
            return card
        }
        let slot: TriggerSlot
        switch kind {
        case .email: slot = .email
        case .webhook: slot = .webhook
        case .heartbeat: slot = .heartbeat
        default: slot = chatSlot(channels.first { $0.id == proposed.channelId }?.kind)
        }
        var card = newCard(slot)
        card.channelId = proposed.channelId
        card.match = proposed.match ?? (slot == .heartbeat ? heartbeatAlways : "")
        return card
    }

    /// One card as a stored trigger. The secret is nil throughout — the phone
    /// never holds one — and the id rides along so a webhook keeps its URL. Nil
    /// for a schedule, which is a column, not a trigger row.
    public static func toTrigger(_ card: TriggerCard) -> AutomationTrigger? {
        guard let kind = card.slot.kind else { return nil }
        return AutomationTrigger(
            kind: kind, channelId: card.channelId, match: card.match.jsTrim, secret: nil, id: card.triggerId, enabled: card.enabled
        )
    }

    /// Whether a slot can be picked for this card. A command kind needs a
    /// connection of that kind to name, and there is only ever one schedule.
    public static func unavailable(_ slot: TriggerSlot, card: TriggerCard, cards: [TriggerCard], channels: [ChannelSummary]) -> String? {
        if slot == .schedule, card.slot != .schedule, cards.contains(where: { $0.key != card.key && $0.slot == .schedule }) {
            return "this routine has one"
        }
        if let kind = slot.channelKind, card.slot != slot, !channels.contains(where: { $0.kind == kind }) {
            return "connect one in the cockpit’s settings"
        }
        return nil
    }

    /// The picker's lines for one card. Email is only offered when it is
    /// relevant — a mailbox is connected, or the card already is one — since an
    /// existing email trigger has to be editable rather than quietly dropped.
    public static func slotsFor(_ card: TriggerCard, channels: [ChannelSummary]) -> [TriggerSlot] {
        TriggerSlot.picker.filter { $0 != .email || card.slot == .email || channels.contains { $0.kind == .email } }
    }

    // MARK: - the form

    public static func channelKey(_ id: String) -> String { "channel:\(id)" }

    /// One select, three shapes: "push", "none", or "channel:<id>".
    public static func keyFor(_ kind: DeliveryKind, targetId: String?) -> String {
        if kind == .channel, let targetId = targetId.truthy { return channelKey(targetId) }
        if kind == DeliveryKind.none { return "none" }
        return "push"
    }

    public static func deliveryOf(_ key: String) -> DeliveryKind {
        if key == "none" { return DeliveryKind.none }
        if key.jsStarts(with: "channel:") { return .channel }
        return .push
    }

    public static func targetOf(_ key: String) -> String? {
        key.jsStarts(with: "channel:") ? key.jsDropping(prefix: "channel:").nonEmpty : nil
    }

    /// "push", "Discord · bot-name", "nobody (log only)" — the reply row's value.
    public static func deliveryLabel(_ key: String, channels: [ChannelSummary]) -> String {
        if key == "none" { return "nobody (log only)" }
        if let target = targetOf(key) {
            guard let channel = channels.first(where: { $0.id == target }) else { return "a channel that is gone" }
            return "\(channel.kind.name ?? "undefined") · \(channel.displayName)"
        }
        return "push notification"
    }

    /// A time as the server takes it — a `TimeOnly`, "07:00:00" — from what a
    /// person types into a small box: "7:00", "07:00", "7". Nil for blank, which
    /// means "any time", and nil for nonsense, which the ✕ line names.
    public static func timeOf(_ text: String) -> String? {
        guard let match = firstMatch(#"^\s*(\d{1,2})(?::(\d{2}))?\s*$"#, in: text),
              let hours = match[1].flatMap({ Int($0) })
        else { return nil }
        let minutes = match[2].flatMap { Int($0) } ?? 0
        if hours > 23 || minutes > 59 { return nil }
        return String(format: "%02d:%02d:00", hours, minutes)
    }

    /// Whether a typed time is either blank or readable.
    public static func timeOk(_ text: String) -> Bool {
        text.jsTrim.isEmpty || timeOf(text) != nil
    }

    /// A `TimeOnly` ("07:00:00") as the small box shows it.
    private static func shortTime(_ time: String?) -> String {
        time.truthy.map { $0.utf16Prefix(5) } ?? ""
    }

    public static func emptyForm(timeZone: String) -> RoutineForm {
        RoutineForm(
            name: "", prompt: "", model: "", facet: defaultFacet, repoUrls: [], nodeIds: [], timeZone: timeZone,
            activeStart: "", activeEnd: "", continuity: false, delivery: "push", triggers: []
        )
    }

    /// The form, filled from a stored routine.
    public static func formOf(_ routine: AutomationSummary, channels: [ChannelSummary], facets: [String]) -> RoutineForm {
        let stored = routine.facet ?? ""
        let known = !stored.isEmpty && facets.contains { $0.lowercased() == stored.lowercased() }
        return RoutineForm(
            name: routine.name,
            prompt: routine.prompt,
            model: routine.model ?? "",
            facet: known ? stored : defaultFacet,
            repoUrls: routine.repoUrls,
            nodeIds: routine.nodeIds,
            timeZone: routine.timeZoneId,
            activeStart: shortTime(routine.activeHoursStart),
            activeEnd: shortTime(routine.activeHoursEnd),
            continuity: routine.continuity,
            delivery: keyFor(routine.deliveryKind, targetId: routine.deliveryTargetId),
            triggers: (scheduleCardOf(routine).map { [$0] } ?? []) + routine.triggers.map { cardOf($0, channels: channels) }
        )
    }

    /// Name, prompt, one trigger that would actually fire, and no unreadable time.
    public static func canSave(_ form: RoutineForm) -> Bool { formProblem(form) == nil }

    /// Why the form cannot be saved yet, in one line; nil when it can.
    public static func formProblem(_ form: RoutineForm) -> String? {
        if form.name.jsTrim.isEmpty { return "give it a name" }
        if form.prompt.jsTrim.isEmpty { return "say what it should do each run" }
        if !form.triggers.contains(where: isValid) { return "add a trigger that would fire" }
        if !timeOk(form.activeStart) || !timeOk(form.activeEnd) { return "active hours read as HH:MM" }
        return nil
    }

    /// The form as the server takes it. The schedule is the routine's own cron
    /// column rather than a trigger row, so its card is folded back out here; a
    /// card with no kind is one the user added and never filled, and is dropped
    /// exactly as "remove" would have.
    public static func toDraft(_ form: RoutineForm, enabled: Bool) -> AutomationDraft {
        let schedule = form.triggers.first { $0.slot == .schedule }
        let cron = schedule?.parse?.ok == true ? (schedule?.parse?.cron ?? "") : ""
        let zone = schedule?.parse?.zone.truthy ?? form.timeZone.jsTrim.nonEmpty ?? "UTC"

        return AutomationDraft(
            name: form.name.jsTrim,
            prompt: form.prompt,
            cronExpression: cron,
            timeZoneId: zone,
            enabled: enabled,
            facet: form.facet,
            model: form.model.jsTrim.isEmpty ? nil : form.model,
            repoUrls: form.repoUrls,
            continuity: form.continuity,
            activeHoursStart: timeOf(form.activeStart),
            activeHoursEnd: timeOf(form.activeEnd),
            deliveryKind: deliveryOf(form.delivery),
            deliveryTargetId: targetOf(form.delivery),
            triggers: form.triggers.compactMap(toTrigger),
            scheduleEnabled: schedule?.enabled ?? true,
            nodeIds: form.nodeIds
        )
    }

    /// What the fold holds, in the fact-line voice the detail screen uses, so a
    /// closed "more options" still says what the routine will run as.
    public static func moreSummary(_ form: RoutineForm) -> String {
        var bits = [form.facet, form.timeZone.jsTrim.nonEmpty ?? "UTC"]
        let start = form.activeStart.jsTrim
        let end = form.activeEnd.jsTrim
        if !start.isEmpty || !end.isEmpty { bits.append("\(start.nonEmpty ?? "any")–\(end.nonEmpty ?? "any")") }
        if !form.repoUrls.isEmpty { bits.append("\(form.repoUrls.count) \(form.repoUrls.count == 1 ? "repo" : "repos")") }
        if !form.nodeIds.isEmpty { bits.append("\(form.nodeIds.count) \(form.nodeIds.count == 1 ? "node" : "nodes")") }
        if form.continuity { bits.append("remembers") }
        return bits.joined(separator: " · ")
    }

    public struct HeartbeatSettings: Equatable, Sendable {
        public var interval: String
        public var activeStart: String
        public var activeEnd: String
        public var model: String

        public init(interval: String, activeStart: String, activeEnd: String, model: String) {
            self.interval = interval
            self.activeStart = activeStart
            self.activeEnd = activeEnd
            self.model = model
        }
    }

    /// The heartbeat's own controls, written as a full draft: every other field
    /// is carried across unchanged, so saving the interval cannot quietly clear
    /// the delivery target or the triggers. As `Detail.razor` does it.
    public static func heartbeatDraft(_ beat: AutomationSummary, _ settings: HeartbeatSettings) -> AutomationDraft {
        AutomationDraft(
            name: beat.name,
            prompt: beat.prompt,
            cronExpression: settings.interval,
            timeZoneId: beat.timeZoneId,
            enabled: beat.enabled,
            facet: beat.facet,
            model: settings.model.jsTrim.isEmpty ? nil : settings.model,
            repoUrls: beat.repoUrls,
            continuity: beat.continuity,
            activeHoursStart: timeOf(settings.activeStart),
            activeHoursEnd: timeOf(settings.activeEnd),
            deliveryKind: beat.deliveryKind,
            deliveryTargetId: beat.deliveryTargetId,
            triggers: beat.triggers.map { trigger in
                var copy = trigger
                copy.secret = nil
                return copy
            },
            scheduleEnabled: beat.scheduleEnabled,
            nodeIds: beat.nodeIds
        )
    }

    /// The cadences the heartbeat card offers, as the cockpit lists them.
    public static let heartbeatIntervals: [(key: String, label: String)] = [
        ("*/15 * * * *", "15 minutes"), ("*/30 * * * *", "30 minutes"), ("0 * * * *", "hour"), ("0 */3 * * *", "3 hours"),
    ]

    /// The webhook URL the caller will POST to. The trigger id is a path segment,
    /// not a query: a routine with two webhooks then tells which one fired from the
    /// URL alone. The `?secret=` is for callers that cannot set a header.
    public static func hookUrl(server: String, automationId: String, triggerId: String, secret: String) -> String {
        "\(trimTrailingSlashes(server))/api/hooks/\(automationId)/\(triggerId)?secret=\(secret)"
    }

    /// The webhook path as far as it is known before the save.
    public static func hookPath(automationId: String?, card: TriggerCard) -> String {
        "/api/hooks/\(automationId ?? "…")/\(card.triggerId == emptyGuid ? "(assigned on save)" : card.triggerId)"
    }

    /// The first eight hex digits of a trigger id, as the cockpit's chip prints it.
    public static func shortId(_ id: String) -> String {
        id.replacingOccurrences(of: "-", with: "").utf16Prefix(8)
    }
}

/// The form, as the screen holds it.
public struct RoutineForm: Hashable, Sendable {
    public var name: String
    public var prompt: String
    /// A model id, or "" for auto.
    public var model: String
    public var facet: String
    public var repoUrls: [String]
    public var nodeIds: [String]
    public var timeZone: String
    /// "07:00" as typed; blank means any time.
    public var activeStart: String
    public var activeEnd: String
    public var continuity: Bool
    /// "push", "none", or "channel:<id>".
    public var delivery: String
    public var triggers: [TriggerCard]

    public init(name: String, prompt: String, model: String, facet: String, repoUrls: [String], nodeIds: [String], timeZone: String, activeStart: String, activeEnd: String, continuity: Bool, delivery: String, triggers: [TriggerCard]) {
        self.name = name
        self.prompt = prompt
        self.model = model
        self.facet = facet
        self.repoUrls = repoUrls
        self.nodeIds = nodeIds
        self.timeZone = timeZone
        self.activeStart = activeStart
        self.activeEnd = activeEnd
        self.continuity = continuity
        self.delivery = delivery
        self.triggers = triggers
    }
}

// The routine editor and the settings pages, against the client they replaced.
// See `DifferentialTests` for what these fixtures are and are not.

import Foundation
import Testing
@testable import SlopcoderCore

private let context = TimeContext.fixed("2026-11-25T12:00:00Z")
private let english = Locale(identifier: "en_US")

private func text(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
private func number(_ value: Int?) -> JSONValue { value.map { .number(Double($0)) } ?? .null }
private func strings(_ values: [String]) -> JSONValue { .array(values.map(JSONValue.string)) }

private func card(_ value: JSONValue) -> TriggerCard {
    TriggerCard(
        key: value["key"].stringValue, triggerId: value["id"].stringValue,
        slot: TriggerSlot(rawValue: value["slot"].stringValue) ?? .none, enabled: value["enabled"].boolValue,
        channelId: value["channelId"].string, match: value["match"].stringValue, when: value["when"].stringValue,
        rawCron: value["rawCron"].boolValue, parse: value["parse"].decoded(ScheduleParse.self), parsing: value["parsing"].boolValue
    )
}

private func describe(_ parse: ScheduleParse?) -> JSONValue {
    guard let parse else { return .null }
    return ["ok": .bool(parse.ok), "cron": text(parse.cron), "zone": text(parse.zone), "sentence": text(parse.sentence),
            "firstRun": text(parse.firstRun), "error": text(parse.error)]
}

private func describe(_ card: TriggerCard) -> JSONValue {
    ["key": "k", "id": .string(card.triggerId), "slot": .string(card.slot.rawValue), "enabled": .bool(card.enabled),
     "channelId": text(card.channelId), "match": .string(card.match), "when": .string(card.when),
     "rawCron": .bool(card.rawCron), "parse": describe(card.parse), "parsing": .bool(card.parsing)]
}

private func describe(_ trigger: AutomationTrigger) -> JSONValue {
    ["kind": .number(Double(trigger.kind.rawValue)), "channelId": text(trigger.channelId), "match": text(trigger.match),
     "secret": text(trigger.secret), "id": .string(trigger.id), "enabled": .bool(trigger.enabled)]
}

private func form(_ value: JSONValue) -> RoutineForm {
    RoutineForm(
        name: value["name"].stringValue, prompt: value["prompt"].stringValue, model: value["model"].stringValue,
        facet: value["facet"].stringValue, repoUrls: value["repoUrls"].arrayValue.map(\.stringValue),
        nodeIds: value["nodeIds"].arrayValue.map(\.stringValue), timeZone: value["timeZone"].stringValue,
        activeStart: value["activeStart"].stringValue, activeEnd: value["activeEnd"].stringValue,
        continuity: value["continuity"].boolValue, delivery: value["delivery"].stringValue,
        triggers: value["triggers"].arrayValue.map(card)
    )
}

private func describe(_ form: RoutineForm) -> JSONValue {
    ["name": .string(form.name), "prompt": .string(form.prompt), "model": .string(form.model), "facet": .string(form.facet),
     "repoUrls": strings(form.repoUrls), "nodeIds": strings(form.nodeIds), "timeZone": .string(form.timeZone),
     "activeStart": .string(form.activeStart), "activeEnd": .string(form.activeEnd), "continuity": .bool(form.continuity),
     "delivery": .string(form.delivery), "triggers": .array(form.triggers.map(describe))]
}

private func describe(_ draft: AutomationDraft) -> JSONValue {
    ["name": .string(draft.name), "prompt": .string(draft.prompt), "cronExpression": .string(draft.cronExpression),
     "timeZoneId": .string(draft.timeZoneId), "enabled": .bool(draft.enabled), "facet": text(draft.facet),
     "model": text(draft.model), "repoUrls": strings(draft.repoUrls), "continuity": .bool(draft.continuity),
     "activeHoursStart": text(draft.activeHoursStart), "activeHoursEnd": text(draft.activeHoursEnd),
     "deliveryKind": .number(Double(draft.deliveryKind.rawValue)), "deliveryTargetId": text(draft.deliveryTargetId),
     "triggers": .array(draft.triggers.map(describe)), "scheduleEnabled": .bool(draft.scheduleEnabled), "nodeIds": strings(draft.nodeIds)]
}

private func channels(_ value: JSONValue) -> [ChannelSummary] { value.decoded([ChannelSummary].self) ?? [] }

private func channelForm(_ value: JSONValue) -> ChannelForm {
    var form = ChannelForm(kind: ChannelKind(rawValue: value["kind"].intValue))
    form.displayName = value["displayName"].stringValue
    form.secret = value["secret"].stringValue
    form.server = value["server"].stringValue
    form.topic = value["topic"].stringValue
    form.listenChannelIds = value["listenChannelIds"].stringValue
    form.deliverToChannelIds = value["deliverToChannelIds"].stringValue
    form.instance = value["instance"].stringValue
    form.smtpHost = value["smtpHost"].stringValue
    form.smtpPort = value["smtpPort"].stringValue
    form.smtpSecurity = value["smtpSecurity"].stringValue
    form.imapHost = value["imapHost"].stringValue
    form.imapPort = value["imapPort"].stringValue
    form.imapSecurity = value["imapSecurity"].stringValue
    form.username = value["username"].stringValue
    form.fromAddress = value["fromAddress"].stringValue
    form.fromName = value["fromName"].stringValue
    form.folder = value["folder"].stringValue
    form.pollSeconds = value["pollSeconds"].stringValue
    form.allowFrom = value["allowFrom"].stringValue
    return form
}

private func describe(_ form: ChannelForm) -> JSONValue {
    ["kind": .number(Double(form.kind.rawValue)), "displayName": .string(form.displayName), "secret": .string(form.secret),
     "server": .string(form.server), "topic": .string(form.topic), "listenChannelIds": .string(form.listenChannelIds),
     "deliverToChannelIds": .string(form.deliverToChannelIds), "instance": .string(form.instance),
     "smtpHost": .string(form.smtpHost), "smtpPort": .string(form.smtpPort), "smtpSecurity": .string(form.smtpSecurity),
     "imapHost": .string(form.imapHost), "imapPort": .string(form.imapPort), "imapSecurity": .string(form.imapSecurity),
     "username": .string(form.username), "fromAddress": .string(form.fromAddress), "fromName": .string(form.fromName),
     "folder": .string(form.folder), "pollSeconds": .string(form.pollSeconds), "allowFrom": .string(form.allowFrom)]
}

private func run(_ fn: String, _ a: [JSONValue]) -> JSONValue? {
    switch fn {
    // ---- routine editor ----
    case "isValid": return .bool(RoutineEditor.isValid(card(a[0])))
    case "problem": return text(RoutineEditor.problem(card(a[0])))
    case "pending": return .string(RoutineEditor.pending(card(a[0])))
    case "confirmation": return .string(RoutineEditor.confirmation(card(a[0]), in: context))
    case "cardSummary": return .string(RoutineEditor.cardSummary(card(a[0]), channels: channels(a[1])))
    case "slotsFor": return strings(RoutineEditor.slotsFor(card(a[0]), channels: channels(a[1])).map(\.rawValue))
    case "hookPath": return .string(RoutineEditor.hookPath(automationId: a[0].string, card: card(a[1])))
    case "toTrigger": return RoutineEditor.toTrigger(card(a[0])).map(describe) ?? .null
    case "unavailable":
        let slot = TriggerSlot(rawValue: a[0].stringValue) ?? .none
        return text(RoutineEditor.unavailable(slot, card: card(a[1]), cards: a[2].arrayValue.map(card), channels: channels(a[3])))
    case "slotWords":
        let slot = TriggerSlot(rawValue: a[0].stringValue) ?? .none
        return [.string(slot.name), .string(slot.summary), .string(slot.note), number(slot.kind?.rawValue), number(slot.channelKind?.rawValue)]
    case "commandWord": return .string(RoutineEditor.commandWord(a[0].stringValue))
    case "timeOf": return text(RoutineEditor.timeOf(a[0].stringValue))
    case "timeOk": return .bool(RoutineEditor.timeOk(a[0].stringValue))
    case "keyFor": return .string(RoutineEditor.keyFor(DeliveryKind(rawValue: a[0].intValue), targetId: a[1].string))
    case "deliveryKey":
        let key = a[0].stringValue
        return [.number(Double(RoutineEditor.deliveryOf(key).rawValue)), text(RoutineEditor.targetOf(key)),
                .string(RoutineEditor.deliveryLabel(key, channels: sampleChannels))]
    case "formOf":
        return a[0].decoded(AutomationSummary.self).map {
            describe(RoutineEditor.formOf($0, channels: channels(a[1]), facets: a[2].arrayValue.map(\.stringValue)))
        }
    case "scheduleCardOf":
        return a[0].decoded(AutomationSummary.self).map { RoutineEditor.scheduleCardOf($0).map(describe) ?? .null }
    case "moreSummary": return .string(RoutineEditor.moreSummary(form(a[0])))
    case "formProblem": return text(RoutineEditor.formProblem(form(a[0])))
    case "canSave": return .bool(RoutineEditor.canSave(form(a[0])))
    case "toDraft": return describe(RoutineEditor.toDraft(form(a[0]), enabled: a[1].boolValue))
    case "heartbeatDraft":
        let settings = RoutineEditor.HeartbeatSettings(
            interval: a[1]["interval"].stringValue, activeStart: a[1]["activeStart"].stringValue,
            activeEnd: a[1]["activeEnd"].stringValue, model: a[1]["model"].stringValue
        )
        return a[0].decoded(AutomationSummary.self).map { describe(RoutineEditor.heartbeatDraft($0, settings)) }
    case "cardOfProposal":
        return a[0].decoded(RoutineDraftTrigger.self).map { describe(RoutineEditor.cardOfProposal($0, channels: channels(a[1]))) }
    case "hookUrl":
        return .string(RoutineEditor.hookUrl(server: a[0].stringValue, automationId: a[1].stringValue, triggerId: a[2].stringValue, secret: a[3].stringValue))
    case "shortId": return .string(RoutineEditor.shortId(a[0].stringValue))
    case "emptyForm": return describe(RoutineEditor.emptyForm(timeZone: a[0].stringValue))

    // ---- settings ----
    case "providerLabel": return .string(SettingsLogic.providerLabel(ProviderKind(rawValue: a[0].intValue)))
    case "providerForm":
        let words = SettingsLogic.providerForm(ProviderKind(rawValue: a[0].intValue))
        return ["title": .string(words.title), "description": .string(words.description), "namePlaceholder": .string(words.namePlaceholder),
                "keyLabel": .string(words.keyLabel), "keyPlaceholder": .string(words.keyPlaceholder),
                "baseUrlLabel": text(words.baseUrlLabel), "baseUrlPlaceholder": .string(words.baseUrlPlaceholder)]
    case "connectionMeta": return a[0].decoded(ConnectionSummary.self).map { .string(SettingsLogic.connectionMeta($0, in: context)) }
    case "tierLabel": return .string(SettingsLogic.tierLabel(a[0].int.map(ModelTier.init(rawValue:))))
    case "gitHost": return a[0].decoded(GitConnectionSummary.self).map { .string(SettingsLogic.gitHost($0)) }
    case "timeSpanMs": return .number(SettingsLogic.timeSpanMs(a[0].stringValue))
    case "mcpTarget": return a[0].decoded(McpServerSummary.self).map { .string(SettingsLogic.mcpTarget($0)) }
    case "parseSecrets":
        let parsed = SettingsLogic.parseSecrets(a[0].stringValue)
        return ["secrets": .object(JSONObject(parsed.secrets.mapValues(JSONValue.string))), "error": text(parsed.error)]
    case "nodeTarget": return a[0].decoded(RemoteNodeSummary.self).map { .string(SettingsLogic.nodeTarget($0)) }
    case "installCommand": return .string(SettingsLogic.installCommand(a[0].stringValue))
    case "checkHooks":
        let checked = SettingsLogic.checkHooks(a[0].stringValue)
        return ["ok": .bool(checked.ok), "message": .string(checked.message)]
    case "checkHooksBad": return .bool(SettingsLogic.checkHooks(a[0].stringValue).ok)
    case "describeSkill": return .string(SettingsLogic.describeSkill(a[0].stringValue))
    case "groupMemories":
        let groups = SettingsLogic.groupMemories(a[0].decoded([MemorySummary].self) ?? [], locale: english)
        return .array(groups.map { [.string($0.key), .string($0.title), strings($0.entries.map(\.name))] })
    case "channelKindWords":
        let kind = ChannelKind(rawValue: a[0].intValue)
        return [.string(SettingsLogic.channelLabel(kind)), .bool(SettingsLogic.channelPairs(kind))]
    case "channelFacts":
        return a[0].decoded(ChannelSummary.self).map { channel in
            .array(SettingsLogic.channelFacts(channel, in: context).map { fact in
                var object: JSONObject = ["label": .string(fact.label), "value": .string(fact.value)]
                if fact.mono { object["mono"] = true }
                return .object(object)
            })
        }
    case "channelFormOf": return a[0].decoded(ChannelSummary.self).map { describe(SettingsLogic.channelFormOf($0)) }
    case "channelSettingsJson": return .string(SettingsLogic.channelSettingsJson(channelForm(a[0])))
    case "gitIdentityProblem": return text(SettingsLogic.gitIdentityProblem(a[0].string, field: a[1].stringValue))
    case "day": return .string(SettingsLogic.day(a[0].stringValue, in: context))
    case "stamp": return .string(SettingsLogic.stamp(a[0].stringValue, in: context))
    case "secondsLeft": return .number(Double(SettingsLogic.secondsLeft(a[0].stringValue, in: context)))
    default: return nil
    }
}

/// The channels `deliveryLabel` is asked about: the fixture's own, by id and name.
private let sampleChannels: [ChannelSummary] = [
    ChannelSummary(id: "ch-d", kind: .discord, displayName: "bot"),
    ChannelSummary(id: "ch-t", kind: .telegram, displayName: "tg"),
    ChannelSummary(id: "ch-f", kind: .fluxer, displayName: "flux"),
    ChannelSummary(id: "ch-n", kind: .ntfy, displayName: "phone"),
    ChannelSummary(id: "ch-e", kind: .email, displayName: "mail"),
    ChannelSummary(id: "ch-bad", kind: .email, displayName: "broken"),
]

@Suite struct EditorDifferentialTests {
    @Test func theEditorAndSettingsDecideAsTheClientTheyReplacedDid() throws {
        let result = try replayLogic("editor-differential.json", run)
        #expect(result.count > 1000)
        #expect(result.unhandled.isEmpty, "nothing ran: \(result.unhandled.sorted())")
    }
}

// What the TypeScript client this app replaced answered, for the logic both
// were ported from the server's C#: wording, links, mentions, model ordering,
// the repository picker. `Fixtures/logic-differential.json` was generated from
// that client with the clock pinned to 2026-11-25T12:00:00Z in UTC, en-US.
//
// It is a regression net rather than a specification — where the server's own
// wording changes, the case here changes with it.

import Foundation
import Testing
@testable import SlopcoderCore

private let context = TimeContext.fixed("2026-11-25T12:00:00Z")

private func text(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }

private func choice(_ value: JSONValue) -> RepoChoice {
    RepoChoice(
        key: value["key"].stringValue, label: value["label"].stringValue, description: value["description"].string,
        kind: value["kind"].int.map(GitServiceKind.init(rawValue:))
    )
}

private func describe(_ choice: RepoChoice) -> JSONValue {
    var object = JSONObject()
    object["key"] = .string(choice.key)
    object["label"] = .string(choice.label)
    if let description = choice.description { object["description"] = .string(description) }
    if let kind = choice.kind { object["kind"] = .number(Double(kind.rawValue)) }
    return .object(object)
}

private func caps(_ value: JSONValue) -> ThinkingCaps? {
    guard value.object != nil else { return nil }
    return ThinkingCaps(
        supportedThinkingLevels: value["supportedThinkingLevels"].array?.map { ThinkingLevel(rawValue: $0.intValue) },
        alwaysThinks: value["alwaysThinks"] == .bool(true)
    )
}

private func describe(_ target: LinkTarget) -> JSONValue {
    switch target {
    case .artifact(let id, let version): return ["kind": "artifact", "id": .string(id), "version": version.map { .number(Double($0)) } ?? .null]
    case .session(let id): return ["kind": "session", "id": .string(id)]
    case .routine(let id): return ["kind": "routine", "id": .string(id)]
    case .external(let url): return ["kind": "external", "url": .string(url)]
    case .unsupported(let url): return ["kind": "unsupported", "url": .string(url)]
    }
}

/// Drops keys whose value is null on both sides' behalf: JavaScript writes
/// `description: undefined` as nothing at all.
private func normalized(_ value: JSONValue) -> JSONValue {
    switch value {
    case .array(let items): return .array(items.map(normalized))
    case .object(let object): return .object(JSONObject(object.entries.filter { !$0.value.isNull }.map { ($0.key, normalized($0.value)) }))
    default: return value
    }
}

private func run(_ fn: String, _ a: [JSONValue]) -> JSONValue? {
    switch fn {
    case "duration": return .string(RoutineFormat.duration(a[0].double ?? 0))
    case "until": return .string(RoutineFormat.until(a[0].stringValue, in: context))
    case "clock": return .string(RoutineFormat.clock(a[0].stringValue, in: context))
    case "when": return .string(RoutineFormat.when(a[0].stringValue, in: context))
    case "soon": return .string(RoutineFormat.soon(a[0].stringValue, in: context))
    case "ago": return .string(Captions.ago(a[0].stringValue, in: context))
    case "ordinal": return .string(RoutineFormat.ordinal(a[0].intValue))
    case "firstWords": return .string(RoutineFormat.firstWords(a[0].stringValue))
    case "parseSlash":
        return parseSlashCommand(a[0].stringValue).map { ["name": .string($0.name), "args": .string($0.args)] } ?? .null
    case "commandPrefix": return text(commandPrefix(a[0].stringValue))
    case "splitMentions":
        let mentions = a[1].arrayValue.map { SubSessionMention(persona: $0["persona"].stringValue, color: $0["color"].stringValue) }
        return .array(splitMentions(a[0].stringValue, mentions).map { ["text": .string($0.text), "color": text($0.color)] })
    case "resolveLink": return describe(resolveLink(a[0].stringValue, baseUrl: a[1].string))
    case "linkSegments": return .array(linkSegments(a[0].stringValue).map { ["text": .string($0.text), "href": text($0.href)] })
    case "handleTint": return .string(handleTint(a[0].stringValue))
    case "toolRunPhrase":
        return .string(Captions.toolRunPhrase(a[0].arrayValue.map { (name: $0["name"].stringValue, isError: $0["isError"] == .bool(true)) }))
    case "offeredLevels": return .array(offeredLevels(caps(a[0])).map { .number(Double($0.rawValue)) })
    case "isSwitch": return .bool(isSwitch(caps(a[0])))
    case "runsAs": return .number(Double(runsAs(ThinkingLevel(rawValue: a[0].intValue), caps(a[1])).rawValue))
    case "levelLabel": return .string(levelLabel(ThinkingLevel(rawValue: a[0].intValue), caps(a[1])))
    case "orderModels":
        return .array(orderModels(a[0].decoded([ModelCandidate].self) ?? []).map { .string($0.modelDisplayName) })
    case "findCandidate":
        return text(findCandidate(a[0].decoded([ModelCandidate].self) ?? [], connectionId: a[1].string, modelId: a[2].string)?.modelDisplayName)
    case "kindFromUrl": return kindFromUrl(a[0].stringValue).map { .number(Double($0.rawValue)) } ?? .null
    case "urlIn": return text(urlIn(a[0].stringValue))
    case "offer":
        let offered = offer(
            query: a[0].stringValue, recent: a[1].arrayValue.map(choice), owned: a[2].arrayValue.map(choice),
            found: a[3].arrayValue.map(choice), searching: a[4].boolValue
        )
        return ["label": .string(offered.label), "options": .array(offered.options.map(describe)), "empty": .string(offered.empty)]
    case "shouldSearch": return .bool(shouldSearch(a[0].arrayValue.map(choice), query: a[1].stringValue, ownedLoaded: a[2].boolValue))
    case "summarize": return .string(summarize(a[0].stringValue))
    case "modelDivider": return .string(modelDivider(model: a[0].stringValue, autoRouted: a[1].boolValue, effort: a[2]))
    case "formatBytes": return .string(formatBytes(a[0].intValue))
    case "humanize": return .string(humanize(a[0].stringValue))
    case "imageRead":
        return imageRead(a[0].stringValue).map { ["mediaType": text($0.mediaType), "size": text($0.size)] } ?? .null
    case "heartbeatMeta": return a[0].decoded(HeartbeatStatus.self).map { .string(RoutineFormat.heartbeatMeta($0, in: context)) }
    case "notepadLine": return a[0].decoded(HeartbeatStatus.self).map { .string(RoutineFormat.notepadLine($0)) }
    case "spend": return a[0].decoded(RunDetail.self).map { .string(RoutineFormat.spend($0)) }
    case "runNote": return a[0].decoded(RunDetail.self).map { .string(RoutineFormat.runNote($0, in: context)) }
    case "failureMeta": return a[0].decoded(RoutineFailure.self).map { .string(RoutineFormat.failureMeta($0)) }
    case "nextLabel": return .string(RoutineFormat.nextLabel(a[0].string, paused: a[1].boolValue, in: context))
    case "groupRuns":
        let runs = a[0].decoded([RunSummary].self) ?? []
        return .array(RoutineFormat.groupRuns(runs, in: context).map { [.string($0.label), .array($0.runs.map { .string($0.id) })] })
    default: return nil
    }
}

/// Replays a `{fn, args, expected}` fixture through `run`, recording each case
/// that differs. Returns how many ran and which functions nothing handled.
func replayLogic(
    _ file: String, _ run: (String, [JSONValue]) -> JSONValue?, sourceLocation: SourceLocation = #_sourceLocation
) throws -> (count: Int, unhandled: Set<String>) {
    let cases = try #require(JSONValue.parse(try fixture(file))?.array, sourceLocation: sourceLocation)
    var unhandled = Set<String>()
    var failures = 0
    for item in cases {
        let fn = item["fn"].stringValue
        guard let got = run(fn, item["args"].arrayValue) else {
            unhandled.insert(fn)
            continue
        }
        if normalized(got) != normalized(item["expected"]) {
            failures += 1
            if failures <= 40 {
                Issue.record(
                    "\(fn)(\(item["args"].serialized().prefix(300)))\n   got: \(got.serialized().prefix(600))\n  want: \(item["expected"].serialized().prefix(600))",
                    sourceLocation: sourceLocation
                )
            }
        }
    }
    return (cases.count, unhandled)
}

@Suite struct DifferentialTests {
    @Test func theLogicAnswersAsTheClientItReplacedDid() throws {
        let result = try replayLogic("logic-differential.json", run)
        #expect(result.count > 600)
        #expect(result.unhandled.isEmpty, "nothing ran: \(result.unhandled.sorted())")
    }
}

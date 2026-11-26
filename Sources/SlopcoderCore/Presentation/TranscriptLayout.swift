// What the transcript draws, row by row: the folded items with consecutive tool
// calls gathered into one line and a date set between days.
//
// Kept out of the view because both decisions are easy to get subtly wrong and
// invisible when you do — a run whose key changes as it grows loses its
// open/closed state on every push, and a date marker computed in UTC puts
// "yesterday" in the middle of an evening.

import Foundation

/// Consecutive tool calls, collapsed into "Read 3 files, ran 2 commands".
public struct ToolRun: Hashable, Sendable {
    public var key: String
    /// Oldest first — the order the work happened in.
    public var tools: [Item]

    public var running: Bool { tools.contains { $0.tool?.running == true } }
    public var failed: Bool { tools.contains { $0.tool?.isError == true } }

    public var phrase: String {
        Captions.toolRunPhrase(tools.compactMap(\.tool)) + (running ? "…" : "")
    }

    public init(key: String, tools: [Item]) {
        self.key = key
        self.tools = tools
    }
}

public enum DisplayRow: Hashable, Sendable, Identifiable {
    case item(Item)
    case subagent(SubagentGroup)
    case toolRun(ToolRun)
    case dateMarker(key: String, at: String)

    public var id: String {
        switch self {
        case .item(let item): return item.key
        case .subagent(let group): return group.key
        case .toolRun(let run): return run.key
        case .dateMarker(let key, _): return key
        }
    }

    /// The approval or question request this row is, if it is one.
    public var requestId: String? {
        guard case .item(let item) = self else { return nil }
        return item.approval?.requestId ?? item.question?.requestId
    }
}

public enum TranscriptLayout {
    /// The rows to draw, oldest first.
    public static func rows(_ items: [Item], calendar: Calendar = .current) -> [DisplayRow] {
        groupToolRuns(insertDateMarkers(groupSubagents(items), calendar: calendar))
    }

    /// A date above the first row of each day, on the reader's own calendar.
    static func insertDateMarkers(_ rows: [Row], calendar: Calendar) -> [DisplayRow] {
        var result: [DisplayRow] = []
        var lastDay: DateComponents?
        for row in rows {
            let at: String?
            switch row {
            case .item(let item): at = item.at
            case .subagent(let group): at = group.items.first { $0.at != nil }?.at
            }
            if let at, let date = WireDate.parse(at) {
                let day = calendar.dateComponents([.year, .month, .day], from: date)
                if day != lastDay {
                    result.append(.dateMarker(key: "date:\(row.id)", at: at))
                    lastDay = day
                }
            }
            switch row {
            case .item(let item): result.append(.item(item))
            case .subagent(let group): result.append(.subagent(group))
            }
        }
        return result
    }

    /// Runs of two or more tool rows become one. The run is keyed by its *first*
    /// tool, which does not change as later calls join it — so a run the reader
    /// opened stays open while it grows.
    static func groupToolRuns(_ rows: [DisplayRow]) -> [DisplayRow] {
        var result: [DisplayRow] = []
        var pending: [Item] = []

        func flush() {
            if pending.count == 1 {
                result.append(.item(pending[0]))
            } else if pending.count > 1 {
                result.append(.toolRun(ToolRun(key: "tools:\(pending[0].key)", tools: pending)))
            }
            pending = []
        }

        for row in rows {
            if case .item(let item) = row, item.kind == .tool {
                pending.append(item)
            } else {
                flush()
                result.append(row)
            }
        }
        flush()
        return result
    }

    /// The partners the prose may name, from the sub-sessions this transcript opened.
    public static func mentions(_ items: [Item]) -> [SubSessionMention] {
        items.compactMap { item in
            guard case .subsession(let sub) = item.body, !sub.persona.isEmpty else { return nil }
            return SubSessionMention(persona: sub.persona, color: sub.color)
        }
    }

    /// "9/25/2026 2:05 PM" — the date between turns.
    public static func dateLabel(_ at: String, in context: TimeContext = .current) -> String {
        guard let date = WireDate.parse(at) else { return "" }
        return "\(context.format(date, template: "yMd")) \(context.format(date, template: "jmm"))"
    }

    /// How much of the model's window the last request filled, or nil before one.
    public static func contextPercent(_ usage: UsageReport?) -> Int? {
        guard let usage, usage.contextWindowTokens != 0 else { return nil }
        let prompt = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        return min(100, Int((100.0 * Double(prompt) / Double(usage.contextWindowTokens)).rounded(.toNearestOrAwayFromZero)))
    }

    /// The composer's status line.
    public static func statusLine(_ state: SessionState?) -> String? {
        guard let state else { return nil }
        if !state.pendingApprovalIds.isEmpty { return "Waiting for permission" }
        if !state.pendingQuestionIds.isEmpty { return "Waiting for an answer" }
        if state.stopRequested { return "Stopping" }
        return state.status == .running ? "Running" : "Idle"
    }

    /// The dials a session opens with: what it is running as right now.
    public static func turnOptions(_ state: SessionState) -> TurnOptions {
        TurnOptions(
            selection: ModelSelection(auto: state.autoRoute, connectionId: state.connectionId, modelId: state.selectedModel),
            thinking: state.thinkingLevel,
            approval: state.approvalMode,
            facet: state.facetName
        )
    }
}

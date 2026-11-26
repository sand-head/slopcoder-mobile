// How a routine reads: the wording every Routines surface shares.
//
// A port of `Pages/Routines/RoutineFormat.cs` and the parts of `TimeFormat.cs`
// it leans on. The board, the detail screen and the sessions strip all draw the
// same three outcomes and the same handful of trigger kinds, and a second copy
// of "notified is emerald" is a copy that will drift — so this is one module,
// pure and testable, and no screen decides any of it for itself.
//
// Colour is the one thing that is *not* here: it needs the palette, so it lives
// beside the bars in the app target.
//
// Everything takes ISO strings, because that is what the seam sends. The clock
// they are read on is the phone's, which is also the zone the board is asked
// for — so "today" means the same thing on both sides of the call.

import Foundation

private let minute = 60_000.0
private let hour = 3_600_000.0
private let day = 86_400_000.0

public enum RoutineFormat {
    // MARK: time

    /// "480ms", "12.3s", "4m 02s", "1h 12m" — the scale picks the two useful units.
    public static func duration(_ ms: Double) -> String {
        if ms < 1_000 { return "\(Int(ms.rounded(.toNearestOrAwayFromZero)))ms" }
        if ms < minute {
            let seconds = jsToFixed(ms / 1000, 1)
            return "\(seconds.hasSuffix(".0") ? String(seconds.dropLast(2)) : seconds)s"
        }
        if ms < hour {
            let seconds = Int((ms.truncatingRemainder(dividingBy: minute) / 1000).rounded(.down))
            return "\(Int((ms / minute).rounded(.down)))m \(seconds < 10 ? "0" : "")\(seconds)s"
        }
        return "\(Int((ms / hour).rounded(.down)))h \(Int((ms.truncatingRemainder(dividingBy: hour) / minute).rounded(.down)))m"
    }

    private static func ms(_ iso: String) -> Double? {
        WireDate.parse(iso).map { $0.timeIntervalSince1970 * 1000 }
    }

    /// "in 5m", "in 2h", "in 3d" — a deadline the reader is waiting on. A time
    /// already past reads as "now", because that is what it means to them.
    public static func until(_ iso: String, in context: TimeContext = .current) -> String {
        guard let at = ms(iso) else { return "now" }
        let delta = at - context.nowMs
        if delta <= minute { return "now" }
        if delta < hour { return "in \(Int((delta / minute).rounded(.down)))m" }
        if delta < day { return "in \(Int((delta / hour).rounded(.down)))h" }
        return "in \(Int((delta / day).rounded(.down)))d"
    }

    /// Just the time, on the reader's own clock: "07:00".
    public static func clock(_ iso: String, in context: TimeContext = .current) -> String {
        guard let at = WireDate.parse(iso) else { return "" }
        return context.format(at, pattern: "HH:mm")
    }

    private static func weekday(_ date: Date, _ context: TimeContext) -> String { context.format(date, template: "EEE") }
    private static func monthDay(_ date: Date, _ context: TimeContext) -> String { context.format(date, template: "MMMd") }

    /// When something happened, as near as it needs to be: "today 07:00",
    /// "yesterday 14:20", "Tue 07:00" inside the last week, then "Sep 1".
    public static func when(_ iso: String, in context: TimeContext = .current) -> String {
        guard let at = WireDate.parse(iso) else { return "" }
        let dayStart = context.startOfDay(at)
        let today = context.startOfDay(context.now)
        let daysAgo = context.calendar.dateComponents([.day], from: dayStart, to: today).day ?? 0

        if daysAgo == 0 { return "today \(clock(iso, in: context))" }
        if daysAgo == 1 { return "yesterday \(clock(iso, in: context))" }
        if daysAgo > 1, daysAgo < 7 { return "\(weekday(at, context)) \(clock(iso, in: context))" }
        return monthDay(at, context)
    }

    /// The shortest honest way to say when something next fires, for a line that
    /// lists several: "8m" within the hour, "12:00" later today, then "Tue 07:00",
    /// then "Sep 12". No "in", no "next" — the line has already said it.
    public static func soon(_ iso: String, in context: TimeContext = .current) -> String {
        guard let at = WireDate.parse(iso) else { return "" }
        let delta = at.timeIntervalSince1970 * 1000 - context.nowMs

        if delta < 0 { return "due" }
        if delta < hour { return "\(max(1, Int((delta / minute).rounded(.down))))m" }
        if context.startOfDay(at) == context.startOfDay(context.now) { return clock(iso, in: context) }
        if delta < 7 * day { return "\(weekday(at, context)) \(clock(iso, in: context))" }
        return monthDay(at, context)
    }

    /// The phone's own IANA zone, which is what "today" is counted in.
    public static func deviceZone() -> String? {
        TimeZone.current.identifier.nonEmpty
    }

    // MARK: outcomes

    /// The outcome as the tables and alerts write it.
    public static func outcomeLabel(_ outcome: RunOutcome?) -> String {
        switch outcome {
        case RunOutcome.notified?: return "notified"
        case RunOutcome.quiet?: return "quiet"
        case RunOutcome.failed?: return "failed"
        default: return "running"
        }
    }

    /// The same, but honest about a skip. A skipped run paints as a quiet bar —
    /// nothing was said and nothing is wrong — yet a row that calls it "quiet" hides
    /// that the run never happened.
    public static func statusLabel(_ status: AutomationRunStatus) -> String {
        status == .skipped ? "skipped" : outcomeLabel(outcomeOf(status))
    }

    /// The outcome a status paints as, or nil while the run is still going.
    public static func outcomeOf(_ status: AutomationRunStatus) -> RunOutcome? {
        switch status {
        case .completed: return .notified
        case .quiet, .skipped: return .quiet
        case .failed: return .failed
        default: return nil
        }
    }

    // MARK: routines

    public static func plural(_ n: Int, _ word: String) -> String { n == 1 ? word : "\(word)s" }

    public static func needs(_ failures: Int) -> String {
        failures == 1 ? "1 failed run needs you" : "\(failures) failed runs need you"
    }

    /// "1st", "2nd", "3rd", "11th" — a streak reads as a count, not a number.
    public static func ordinal(_ n: Int) -> String {
        // The teens are the exception: 11th, 12th, 13th, not 11st.
        if (11...13).contains(n % 100) { return "\(n)th" }
        let suffix = n % 10 == 1 ? "st" : n % 10 == 2 ? "nd" : n % 10 == 3 ? "rd" : "th"
        return "\(n)\(suffix)"
    }

    /// "connection refused · 12.3s · 3rd failure in a row".
    public static func failureMeta(_ failure: RoutineFailure) -> String {
        var parts: [String] = []
        if let error = failure.error.truthy { parts.append(error) }
        if let ms = failure.durationMs { parts.append(duration(ms)) }
        // A streak of one is just "it failed", which the line above already said.
        if failure.streak > 1 { parts.append("\(ordinal(failure.streak)) failure in a row") }
        return parts.joined(separator: " · ")
    }

    /// The card's right-hand word: "next Tue 07:00 (in 21h)", "paused" when the
    /// schedule is off, "on trigger" when there is no clock to be next.
    public static func nextLabel(_ at: String?, paused: Bool, in context: TimeContext = .current) -> String {
        if paused { return "paused" }
        guard let at = at.truthy else { return "on trigger" }
        return "next \(when(at, in: context)) (\(until(at, in: context)))"
    }

    /// "last 07:00 · notified", or that it has never run.
    public static func lastLabel(_ card: RoutineCard, in context: TimeContext = .current) -> String {
        guard let last = card.lastRun else { return "never run" }
        return "last \(clock(last.startedAt, in: context)) · \(statusLabel(last.status))"
    }

    /// "every 30 min · 08:00–22:00 · next in 8m".
    public static func heartbeatMeta(_ beat: HeartbeatStatus, in context: TimeContext = .current) -> String {
        var parts = [beat.intervalSentence]
        if let start = beat.activeStart.truthy, let end = beat.activeEnd.truthy {
            parts.append("\(hhmm(start))–\(hhmm(end))")
        }
        if !beat.enabled {
            parts.append("paused")
        } else if let next = beat.nextFire.truthy {
            parts.append("next \(until(next, in: context))")
        } else {
            parts.append("next unscheduled")
        }
        return parts.joined(separator: " · ")
    }

    /// A `TimeOnly` arrives as "07:00:00"; the seconds are noise.
    public static func hhmm(_ time: String) -> String { time.utf16Prefix(5) }

    /// "Notepad · 4 items · watch the CI queue, chase the flaky test".
    public static func notepadLine(_ beat: HeartbeatStatus) -> String {
        if beat.notepadItems.isEmpty { return "Notepad · empty" }
        let first = beat.notepadItems.prefix(2).joined(separator: ", ")
        return "Notepad · \(beat.notepadItems.count) \(plural(beat.notepadItems.count, "item")) · \(first)"
    }

    /// A trigger named by the service it listens on, when one is known: a chat
    /// command on a Discord connection is a "Discord command", which is what the
    /// picker offered and what the row should say back.
    public static func triggerKindName(_ kind: AutomationTriggerKind?, channel: ChannelKind? = nil) -> String {
        if kind == .channelCommand {
            switch channel {
            case ChannelKind.discord?: return "Discord command"
            case ChannelKind.fluxer?: return "Fluxer command"
            case ChannelKind.telegram?: return "Telegram command"
            default: return "Chat command"
            }
        }
        switch kind {
        case AutomationTriggerKind.email?: return "Email"
        case AutomationTriggerKind.webhook?: return "Webhook"
        case AutomationTriggerKind.heartbeat?: return "Heartbeat"
        // Nil is the synthesized schedule: a column on the routine, not a row.
        default: return "Schedule"
        }
    }

    // MARK: the ledger

    /// The runs the Runs tab lists. The server sends a merged list across every
    /// routine; when it is missing — an older host, or a board with nothing in the
    /// window — the cards' own last runs still make an honest, if short, one.
    public static func ledger(_ board: RoutineBoard) -> [RunSummary] {
        if let recent = board.recentRuns, !recent.isEmpty { return recent }
        return board.routines.compactMap(\.lastRun).stableSorted { $0.startedAt > $1.startedAt }
    }

    public struct RunGroup: Equatable, Sendable {
        public var label: String
        public var runs: [RunSummary]

        public init(label: String, runs: [RunSummary]) {
            self.label = label
            self.runs = runs
        }
    }

    /// "today" / "yesterday" / "earlier", in that order, skipping the empty ones.
    public static func groupRuns(_ runs: [RunSummary], in context: TimeContext = .current) -> [RunGroup] {
        let today = context.startOfDay(context.now)
        var groups = [RunGroup(label: "today", runs: []), RunGroup(label: "yesterday", runs: []), RunGroup(label: "earlier", runs: [])]

        for run in runs {
            var index = 2
            if let started = WireDate.parse(run.startedAt) {
                let days = context.calendar.dateComponents([.day], from: context.startOfDay(started), to: today).day ?? 2
                index = days == 0 ? 0 : days == 1 ? 1 : 2
            }
            groups[index].runs.append(run)
        }

        return groups.filter { !$0.runs.isEmpty }
    }

    /// The opening of what a routine said — one line has room for about this much.
    public static func firstWords(_ said: String, max: Int = 60) -> String {
        let flat = said.unicodeScalars.split(whereSeparator: isJSWhitespace).map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
        return flat.jsLength <= max ? flat : "\(flat.utf16Prefix(max - 1).jsTrimEnd)…"
    }

    // MARK: one run

    /// "4m 02s · 38k tokens · $0.11 · claude-sonnet", with the missing parts left
    /// out rather than written as a dash: a run whose provider reported no usage
    /// should read as short, not as broken.
    public static func spend(_ detail: RunDetail) -> String {
        var parts: [String] = []
        if let ms = detail.run.durationMs { parts.append(duration(ms)) }

        let tokens = (detail.inputTokens ?? 0) + (detail.outputTokens ?? 0)
        if tokens > 0 { parts.append(tokens >= 1000 ? "\(tokens / 1000)k tokens" : "\(tokens) tokens") }
        if let cost = detail.estimatedCost { parts.append("$\(jsToFixed(cost, 2))") }
        if let model = detail.model.truthy { parts.append(model) }

        return parts.joined(separator: " · ")
    }

    /// How the turn ended, in the transcript's own end-of-turn wording.
    public static func runNote(_ detail: RunDetail, in context: TimeContext = .current) -> String {
        let run = detail.run
        switch run.status {
        case .failed: return "failed · \(run.error ?? "no error was recorded")"
        case .skipped: return "skipped · \(run.error ?? "the session was busy")"
        case .quiet: return "quiet · NO_REPLY"
        case .running: return "running…"
        default:
            var ended = ""
            if let at = WireDate.parse(detail.endedAt) { ended = " · \(context.format(at, pattern: "HH:mm:ss"))" }
            return "end of turn · \(run.delivered ? "notified" : "not delivered")\(ended)"
        }
    }
}

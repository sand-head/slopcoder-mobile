// The transcript's disclosure captions, in the web cockpit's words.
//
// A port of `TranscriptGrouping.ToolRunPhrase`, `SessionDetail.PlanProgress`,
// the thinking row's "Thought for …" and `NoteLabel` — the same rules, so a
// collapsed run reads "Read 2 files, edited 2 files, ran 2 commands" here as it
// does there, rather than a tally of tool names.

import Foundation

private struct Phrasing: Hashable {
    let verb: String
    let singular: String
    let plural: String
}

private func files(_ verb: String) -> Phrasing { Phrasing(verb: verb, singular: "1 file", plural: "{0} files") }
private let search = Phrasing(verb: "ran", singular: "1 search", plural: "{0} searches")
private let checkedJob = Phrasing(verb: "checked", singular: "1 job", plural: "{0} jobs")
private let review = Phrasing(verb: "requested", singular: "1 code review", plural: "{0} code reviews")

/// Verb, singular and plural-with-count per tool name, as the web phrases them.
private let phrasing: [String: Phrasing] = [
    "read_file": files("read"),
    "write_file": files("wrote"),
    "edit_file": files("edited"),
    "list_dir": Phrasing(verb: "listed", singular: "1 directory", plural: "{0} directories"),
    "grep_files": search,
    "find_files": search,
    "run_bash": Phrasing(verb: "ran", singular: "1 command", plural: "{0} commands"),
    "bash_output": checkedJob,
    "shell_monitor": checkedJob,
    "kill_job": Phrasing(verb: "stopped", singular: "1 job", plural: "{0} jobs"),
    "fetch_url": Phrasing(verb: "fetched", singular: "1 page", plural: "{0} pages"),
    "web_search": Phrasing(verb: "ran", singular: "1 web search", plural: "{0} web searches"),
    "skill": Phrasing(verb: "used", singular: "1 skill", plural: "{0} skills"),
    "publish_artifact": Phrasing(verb: "requested", singular: "1 artifact publication", plural: "{0} artifact publications"),
    "code_review_start": review,
    "code_review_start_range": review,
    "code_review_start_snapshot": review,
]

public enum Captions {
    /// "Read 3 files, ran 2 commands, 1 failed". Sibling tools merge into one clause
    /// (grep and find are both searches); an unknown tool — an MCP server's — reads
    /// "called {name}" or "called {name} ×N". Clauses keep first-appearance order, so
    /// the phrase follows the order the work happened in. Calls are oldest first.
    public static func toolRunPhrase(_ calls: [(name: String, isError: Bool)]) -> String {
        var order: [Phrasing] = []
        var counts: [Phrasing: Int] = [:]
        for call in calls {
            let kind = phrasing[call.name] ?? Phrasing(verb: "called", singular: call.name, plural: "\(call.name) ×{0}")
            if counts[kind] == nil { order.append(kind) }
            counts[kind, default: 0] += 1
        }
        var clauses = order.map { kind -> String in
            let count = counts[kind] ?? 1
            guard count != 1 else { return "\(kind.verb) \(kind.singular)" }
            // Only the first placeholder, as `String.replace` with a string does.
            var plural = kind.plural
            if let range = plural.range(of: "{0}") { plural.replaceSubrange(range, with: String(count)) }
            return "\(kind.verb) \(plural)"
        }
        let failed = calls.filter(\.isError).count
        if failed > 0 { clauses.append("\(failed) failed") }
        let phrase = clauses.joined(separator: ", ")
        return phrase.isEmpty ? "" : phrase.prefix(1).uppercased() + phrase.dropFirst()
    }

    public static func toolRunPhrase(_ tools: [ToolItem]) -> String {
        toolRunPhrase(tools.map { (name: $0.name, isError: $0.isError) })
    }

    /// "3 of 4 steps complete".
    public static func planProgress(_ steps: [PlanStep]) -> String {
        "\(steps.filter { $0.status == "done" }.count) of \(steps.count) steps complete"
    }

    /// "Thought for 8s" when the provider timed it; "Thinking" when it did not.
    public static func thoughtFor(_ durationMs: Double?) -> String {
        durationMs.map { "Thought for \(RoutineFormat.duration($0))" } ?? "Thinking"
    }

    /// A completed turn's note: "Turn complete · completed in 1.2s" for the session's
    /// own turn, "done · completed in …" for a subagent's, as the web labels them.
    public static func turnCompleteLabel(_ durationMs: Double?, subagent: Bool) -> String {
        let base = subagent ? "done" : "Turn complete"
        return durationMs.map { "\(base) · completed in \(RoutineFormat.duration($0))" } ?? base
    }

    /// "just now", "5m ago", "2h ago", "3d ago" — the web's TimeFormat.Ago.
    public static func ago(_ at: String, in context: TimeContext = .current) -> String {
        guard let then = WireDate.parse(at) else { return "just now" }
        let delta = context.nowMs - then.timeIntervalSince1970 * 1000
        if !(delta >= 60_000) { return "just now" }
        if delta < 3_600_000 { return "\(Int((delta / 60_000).rounded(.down)))m ago" }
        if delta < 86_400_000 { return "\(Int((delta / 3_600_000).rounded(.down)))h ago" }
        return "\(Int((delta / 86_400_000).rounded(.down)))d ago"
    }

    /// The server's cap on repository names in a summary (SessionSummary.MaxRepoNames).
    private static let maxRepoNames = 32

    /// What a recent-sessions row says the session works on, as the web's
    /// RecentWorkspaceLabel: "No repositories", the one repository's name, "N
    /// repositories". Nil when the server did not say — unknown is never zero — and
    /// for a client-machine workspace, whose label this app's contract cannot build.
    public static func workspaceLabel(_ session: SessionSummary) -> String? {
        if session.clientWorkspace != nil { return nil }
        guard let names = session.repoNames else { return nil }
        if names.isEmpty { return "No repositories" }
        if names.count == 1 { return names[0] }
        if names.count >= maxRepoNames { return "\(maxRepoNames)+ repositories" }
        return "\(names.count) repositories"
    }

    /// The approval card's verdict, worded as the web's; nil while it is open.
    public static func approvalVerdict(approved: Bool?, pending: Bool, refused: Bool) -> String? {
        if approved == true { return "approved" }
        if approved == false { return "denied" }
        if !pending { return "Read-only · no longer pending" }
        if refused { return "refused" }
        return nil
    }

    /// The session header's subtitle: what the session works on. One repository is
    /// named, with its branch once the workspace has been asked; several are
    /// counted; none says so. The repository list is the session state's, so the
    /// subtitle never waits on the workspace.
    public static func sessionSubtitle(_ repoNames: [String], branches: [String: String] = [:]) -> String {
        if repoNames.isEmpty { return "No repositories" }
        if repoNames.count > 1 { return "\(repoNames.count) repositories" }
        let name = repoNames[0]
        if let branch = branches[name], !branch.isEmpty { return "\(name) · \(branch)" }
        return name
    }
}

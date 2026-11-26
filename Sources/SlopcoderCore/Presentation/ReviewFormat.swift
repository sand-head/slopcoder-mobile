// How a code review reads: the wording the reviews screens share.
//
// Reviews are requested by an agent's tools, never from the phone; what the
// phone does is read them, decide findings, and — behind a confirmation that
// shows exactly what will be posted — publish them to a forge. The words here
// are the web cockpit's, so a state means the same thing on both.

import Foundation

public enum ReviewFormat {
    public static func isActive(_ state: CodeReviewAnalysisState) -> Bool {
        switch state {
        case .queued, .snapshotting, .captured, .planning, .investigating, .validating, .falsifying, .consolidating: return true
        default: return false
        }
    }

    public static func stateLabel(_ state: CodeReviewAnalysisState) -> String {
        switch state {
        case .queued: return "queued"
        case .snapshotting: return "capturing"
        case .captured: return "captured"
        case .planning: return "planning"
        case .investigating: return "reviewing"
        case .validating: return "validating"
        case .falsifying: return "verifying"
        case .consolidating: return "consolidating"
        case .completed: return "completed"
        case .partial: return "partial"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        case .superseded: return "superseded"
        default: return "unknown"
        }
    }

    /// An agent review that finished has not *completed* anything a pipeline
    /// would call a review: it is ready to be commented on.
    public static func stateLabel(_ state: CodeReviewAnalysisState, mode: CodeReviewMode) -> String {
        mode == .agent && state == .completed ? "ready for comments" : stateLabel(state)
    }

    public static func modeLabel(_ mode: CodeReviewMode) -> String {
        mode == .agent ? "agent review" : "pipeline review"
    }

    public static func kindLabel(_ target: CodeReviewTarget) -> String {
        switch target.kind {
        case .pullRequest: return "pull request"
        case .commitRange: return "commit range"
        case .workingChanges: return "uncommitted changes"
        case .snapshot: return "files snapshot"
        default: return "review"
        }
    }

    public static let localAuthority = "local"

    public static func isLocal(_ target: CodeReviewTarget) -> Bool { target.canonicalAuthority == localAuthority }

    public static func location(of target: CodeReviewTarget) -> String {
        isLocal(target) ? "local workspace" : "\(target.repositoryOwner)/\(target.repositoryName)"
    }

    public static func shortSha(_ sha: String?) -> String {
        guard let sha else { return "—" }
        return sha.jsLength > 10 ? sha.utf16Prefix(10) : sha
    }

    public static func targetLabel(_ target: CodeReviewTarget) -> String {
        let place = location(of: target)
        switch target.kind {
        case .pullRequest: return "\(place)#\(target.pullRequestNumber)"
        case .commitRange: return "\(place) \(shortSha(target.rangeBaseSha))..\(shortSha(target.headSha))"
        case .workingChanges: return "\(place) · uncommitted changes on \(shortSha(target.rangeBaseSha))"
        case .snapshot: return "\(place) · files snapshot"
        default: return place
        }
    }

    /// `src/a.swift:12-18`, with `(base)` for a line that only exists on the old side.
    public static func anchor(path: String, side: CodeReviewAnchorSide, start: Int, end: Int) -> String {
        "\(path):\(start == end ? "\(start)" : "\(start)-\(end)")\(side == .base ? " (base)" : "")"
    }

    public static func dispositionLabel(_ disposition: CodeReviewFindingDisposition) -> String {
        switch disposition {
        case .accepted: return "accepted"
        case .dismissed: return "dismissed"
        default: return "open"
        }
    }

    public static func incompleteReason(_ reason: CodeReviewCaptureIncompleteReason) -> String {
        switch reason {
        case .snapshotLimitReached: return "some files were left out at a size or count limit, or could not be read"
        case .paginationLimitReached: return "the list of changed files was cut off at its page limit"
        case .responseTooLarge: return "a page of changed files was too large to read"
        case .fileCountMismatch: return "fewer files were listed than the pull request reports"
        case .sourceUnavailable: return "the source could not be read in full"
        case .sourceMalformed: return "the source returned something that could not be read"
        default: return ""
        }
    }

    public static func completenessLabel(_ completeness: CodeReviewCompleteness?) -> String {
        switch completeness {
        case CodeReviewCompleteness.complete?: return "complete"
        case CodeReviewCompleteness.completeWithExclusions?: return "complete, with exclusions"
        case CodeReviewCompleteness.partial?: return "partial"
        case CodeReviewCompleteness.stale?: return "stale"
        case CodeReviewCompleteness.pending?: return "pending"
        case CodeReviewCompleteness.notAssessed?: return "no automated coverage"
        default: return "—"
        }
    }

    /// What was actually looked at. An agent review covers nothing automatically,
    /// and says so rather than leaving a blank that reads as "all of it".
    public static func coverageLine(_ review: CodeReviewSessionReview) -> String {
        let item = review.review
        if item.mode == .agent { return "agent comments only · no automated coverage" }
        guard let coverage = review.coverage else {
            return isActive(item.state) ? "not yet planned" : completenessLabel(item.reviewCompleteness)
        }
        var line = "\(completenessLabel(item.reviewCompleteness)) · \(coverage.reviewed) reviewed"
        if coverage.notReviewed > 0 { line += " · \(coverage.notReviewed) not reviewed" }
        if coverage.excluded > 0 { line += " · \(coverage.excluded) excluded" }
        if coverage.inProgress > 0 { line += " · \(coverage.inProgress) in progress" }
        return line
    }

    /// Why a decision did not save, or nil when it did. A refused update is never
    /// an overwrite: the screen says so and reloads.
    public static func decisionMessage(_ status: CodeReviewFindingUpdateStatus?) -> String? {
        switch status {
        case CodeReviewFindingUpdateStatus.updated?, CodeReviewFindingUpdateStatus.unchanged?:
            return nil
        case CodeReviewFindingUpdateStatus.versionConflict?:
            return "Not saved: this finding changed since you opened it (another tab or device?). It has been reloaded — check it and decide again."
        case CodeReviewFindingUpdateStatus.consolidationChanged?:
            return "Not saved: the review’s findings were rebuilt since you loaded them. The list has been reloaded."
        case CodeReviewFindingUpdateStatus.superseded?:
            return "Not saved: a newer commit of this pull request has been captured, so this review no longer takes decisions. Open the newer review to decide there."
        case CodeReviewFindingUpdateStatus.invalid?:
            return "Not saved: that is not a decision this page can make."
        default:
            return "Not saved: the review or finding is gone, or is not yours."
        }
    }

    /// Whether the review still takes decisions: finished, consolidated, and not
    /// overtaken by a newer head.
    public static func decidable(_ list: CodeReviewFindingList) -> Bool {
        !list.superseded && list.consolidationDigest != nil && (list.state == .completed || list.state == .partial)
    }

    public static func eventLabel(_ event: CodeReviewPublicationEvent) -> String {
        event == .requestChanges ? "request changes" : "comment"
    }

    public static func publicationStateLabel(_ state: CodeReviewPublicationState) -> String {
        state == .partiallyPublished ? "partially published" : (state.name ?? "unknown").lowercased()
    }

    public static func itemStateLabel(_ state: CodeReviewPublicationItemState) -> String {
        state == .notPublishable ? "not publishable" : (state.name ?? "unknown").lowercased()
    }

    public static func placementLabel(_ placement: CodeReviewPublicationPlacement?) -> String {
        switch placement {
        case CodeReviewPublicationPlacement.inline?: return "inline"
        case CodeReviewPublicationPlacement.summary?: return "summary"
        case CodeReviewPublicationPlacement.issue?: return "issue"
        default: return "—"
        }
    }

    /// Whether a finding can still be posted: it has somewhere to go, nothing
    /// refuses it, and it has not been posted already.
    public static func publishable(_ place: CodeReviewPublishableFinding?) -> Bool {
        guard let place else { return false }
        return place.placement != nil && place.refusal == nil && place.publishedIn == nil
    }

    public static func retryable(_ publication: CodeReviewPublicationView) -> Bool {
        publication.state == .partiallyPublished || publication.state == .failed
    }

    public static func previewWhere(_ item: CodeReviewPublicationPreviewItem) -> String {
        let place = "\(item.path), \(item.side == .base ? "old" : "new") "
        return item.startLine.map { "\(place)lines \($0)–\(item.line)" } ?? "\(place)line \(item.line)"
    }

    /// What publishing did, in a sentence.
    public static func publishMessage(_ result: CodeReviewPublishResult?) -> String {
        guard let result else { return "This review is gone, or is not yours." }
        if result.status == .replayed { return "This was already sent; showing that publication." }
        if result.status == .ran, let publication = result.publication {
            switch publication.state {
            case .published:
                return publication.target == .issues ? "Opened as issues in the repository." : "Published to the pull request."
            case .partiallyPublished:
                return "Published in part: some findings were not posted (see below). You can retry the rest."
            case .obsolete:
                return "The review was superseded while publishing. Whatever reached the forge is recorded below."
            default:
                return "Nothing was published. \(publication.error ?? "")".jsTrim
            }
        }
        if let reason = result.reason, !reason.isEmpty { return reason }
        return "Nothing was published."
    }

    public static func severityName(_ severity: CodeReviewSeverity) -> String {
        switch severity {
        case .p0: return "P0"
        case .p1: return "P1"
        case .p2: return "P2"
        default: return "P3"
        }
    }

    /// "P0 1 · P2 3" — only the severities that have any.
    public static func tally(_ counts: CodeReviewFindingCounts) -> String {
        [("P0", counts.p0), ("P1", counts.p1), ("P2", counts.p2), ("P3", counts.p3)]
            .filter { $0.1 > 0 }
            .map { "\($0.0) \($0.1)" }
            .joined(separator: " · ")
    }

    /// A forge link, if it is one a person can safely be handed.
    public static func safeHttpUrl(_ url: String?) -> String? {
        guard let url, let scheme = URLComponents(string: url)?.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return nil
        }
        return url
    }

    /// The prompt and repository a "Fix it" session starts with.
    public static func fixRequest(target: CodeReviewTarget, detail: CodeReviewFindingDetail) -> (prompt: String, repoUrl: String) {
        let finding = detail.finding
        var parts = [detail.trigger, detail.badBehavior, detail.causalChange]
        if !detail.suggestedRemediation.jsTrim.isEmpty { parts.append("Suggested fix: \(detail.suggestedRemediation)") }
        let claim = parts.filter { !$0.isEmpty }.joined(separator: "\n")
        let base = "https://\(target.canonicalAuthority)/\(target.repositoryOwner)/\(target.repositoryName)"
        let repoUrl = target.forgeKind == .forgejo ? base : "\(base).git"
        let prompt = "Fix this code review finding and open a PR with the fix.\n\n\(targetLabel(target)) — #\(finding.rank) \(finding.title)\n\(anchor(path: finding.path, side: finding.side, start: finding.startLine, end: finding.endLine))\n\n\(claim)"
        return (prompt, repoUrl)
    }
}

extension ReviewFormat {
    public struct Tag: Equatable, Sendable {
        public var label: String
        public var primary = false
    }

    /// The small labels on a finding's header: who wrote it, whether it carries a
    /// suggestion, what was decided, and — for a pipeline finding — its score.
    public static func cardTags(_ finding: CodeReviewFindingSummary) -> [Tag] {
        var tags: [Tag] = []
        if finding.provenance == .agentSession { tags.append(Tag(label: "agent")) }
        if finding.hasSuggestion { tags.append(Tag(label: "suggestion")) }
        if finding.disposition == .accepted {
            tags.append(Tag(label: dispositionLabel(finding.disposition), primary: true))
        } else if finding.disposition == .dismissed {
            tags.append(Tag(label: dispositionLabel(finding.disposition)))
        }
        if finding.provenance == .pipeline { tags.append(Tag(label: String(finding.score.total))) }
        return tags
    }

    public struct DiffRow: Equatable, Sendable {
        public var line: CodeReviewFindingDiffLine
        /// The line's number on the side the finding is anchored to.
        public var number: Int?
        /// Lines were skipped between the previous numbered row and this one.
        public var gapBefore: Bool

        public init(line: CodeReviewFindingDiffLine, number: Int? = nil, gapBefore: Bool) {
            self.line = line
            self.number = number
            self.gapBefore = gapBefore
        }
    }

    public static func diffRows(_ diff: CodeReviewFindingDiff) -> [DiffRow] {
        var previous: Int?
        return diff.lines.map { line in
            let number = diff.side == .head ? line.newLine : line.oldLine
            let gap = previous.map { last in number.map { $0 > last + 1 } ?? false } ?? false
            if let number { previous = number }
            return DiffRow(line: line, number: number, gapBefore: gap)
        }
    }
}

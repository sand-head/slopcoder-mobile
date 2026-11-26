#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

// Code reviews: the ones a session started or commented on, and one review's
// findings. Reviews are requested by the agent's tools, never from here; the
// phone reads them, decides findings, and — behind a sheet that shows exactly
// what will be posted — publishes them to the forge.

private func severityColor(_ severity: CodeReviewSeverity) -> Color {
    switch severity {
    case .p0: return Palette.destructive
    case .p1: return Palette.warning
    default: return Palette.foreground
    }
}

/// Polls `load` every three seconds for as long as the surrounding task lives.
private func poll(_ load: () async -> Void) async {
    while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(3))
        if Task.isCancelled { return }
        await load()
    }
}

// MARK: - The session's reviews

struct ReviewsScreen: View {
    let sessionId: String
    @Environment(AppModel.self) private var model
    @State private var reviews: [CodeReviewSessionReview]?
    @State private var trouble: String?

    private var running: Bool { (reviews ?? []).contains { ReviewFormat.isActive($0.review.state) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let trouble { ErrorText(trouble).padding(.bottom, 12) }
                if reviews == nil, trouble == nil { Skeleton(rows: 3) }
                if let reviews, reviews.isEmpty {
                    Hint("No code reviews in this session yet. Ask the agent to review a pull request, a commit range, uncommitted changes or a directory’s files; each review shows up here.")
                }
                ForEach(reviews ?? [], id: \.review.id) { review in
                    Button {
                        model.router.push(.review(id: review.review.id))
                    } label: {
                        ReviewRow(review: review)
                    }
                    .buttonStyle(.plain)
                    Divider().overlay(Palette.border)
                }
            }
            .padding(20)
            .readingWidth()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .pageBackground()
        .navigationTitle("Reviews")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await read() }
        .task { await read() }
        .task(id: running) {
            guard running else { return }
            await poll(read)
        }
    }

    private func read() async {
        guard let seam = model.seam else { return }
        do {
            if let list = try await seam.sessionReviews(sessionId) {
                reviews = list
                trouble = nil
            } else {
                trouble = "These reviews are gone, or are not yours."
            }
        } catch {
            if isCancellation(error) { return }
            trouble = "Could not read this session’s reviews."
        }
    }
}

private struct ReviewRow: View {
    let review: CodeReviewSessionReview

    var body: some View {
        let item = review.review
        let active = ReviewFormat.isActive(item.state)
        let state = ReviewFormat.stateLabel(item.state, mode: item.mode)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Mono(ReviewFormat.targetLabel(item.target), size: 12.5, color: Palette.foreground).lineLimit(1)
                    Mono("\(ReviewFormat.kindLabel(item.target)) · \(ReviewFormat.modeLabel(item.mode))\(review.startedHere ? "" : " · commented on here")")
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if active { StatusDot(running: true) }
                Mono(state, color: active ? Palette.mutedForeground : Palette.foreground)
            }
            Mono(ReviewFormat.coverageLine(review)).lineLimit(2)
            if let counts = item.findings, review.findingTotal > 0 {
                Mono("\(ReviewFormat.tally(counts)) · \(counts.open) open", color: Palette.foreground).lineLimit(1)
            }
            if item.captureCompleteness == .incomplete {
                Mono("capture incomplete: \(ReviewFormat.incompleteReason(review.incompleteReason))").lineLimit(2)
            }
            if item.supersededByRunId != nil { Mono("stale: a newer head was captured") }
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Review \(ReviewFormat.targetLabel(item.target)), \(state)")
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - One review

struct ReviewDetailScreen: View {
    let reviewId: String
    @Environment(AppModel.self) private var model
    @State private var detail: CodeReviewDetail?
    @State private var findings: CodeReviewFindingList?
    @State private var missing = false
    @State private var trouble: String?
    @State private var busy = false
    /// Bumped whenever something was decided or published, so the publication
    /// panel re-reads what can still be posted.
    @State private var generation = 0

    private var running: Bool { detail.map { ReviewFormat.isActive($0.state) } ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if missing {
                    BodyText("No such review: it does not exist, or it belongs to someone else.")
                } else {
                    if detail == nil { Skeleton(rows: 4) }
                    if let detail {
                        ReviewSummary(detail: detail, busy: busy, onCancel: { Task { await cancel() } })
                    }
                    if let trouble { ErrorText(trouble) }
                    if let detail {
                        VStack(alignment: .leading, spacing: 10) {
                            Meta(detail.mode == .agent ? "Comments" : "Findings")
                            if let findings {
                                FindingsBlock(
                                    findings: findings, detail: detail, generation: generation,
                                    onChanged: { Task { await load() } }
                                )
                            } else if trouble == nil {
                                Skeleton(rows: 2, height: 40)
                            }
                        }
                    }
                }
            }
            .padding(20)
            .readingWidth()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .pageBackground()
        .navigationTitle(detail.map { ReviewFormat.targetLabel($0.target) } ?? "Review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .task(id: running) {
            guard running else { return }
            await poll(load)
        }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            guard let fresh = try await seam.reviewDetail(reviewId) else {
                missing = true
                return
            }
            detail = fresh
            if let list = try await seam.reviewFindings(reviewId) { findings = list }
            generation += 1
        } catch {
            if isCancellation(error) { return }
            trouble = "Could not load the review."
        }
    }

    private func cancel() async {
        guard let seam = model.seam else { return }
        busy = true
        defer { busy = false }
        do {
            if let result = try await seam.cancelReview(reviewId) {
                if !result.cancelled {
                    trouble = "The review had already ended (\(ReviewFormat.stateLabel(result.state)))."
                }
            } else {
                missing = true
            }
            await load()
        } catch {
            trouble = "Could not cancel the review."
        }
    }
}

private struct ReviewSummary: View {
    let detail: CodeReviewDetail
    let busy: Bool
    let onCancel: () -> Void
    @State private var confirming = false

    var body: some View {
        let snapshot = detail.snapshot
        let progress = detail.progress
        let active = ReviewFormat.isActive(detail.state)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Mono(ReviewFormat.targetLabel(detail.target), size: 13, color: Palette.foreground).lineLimit(1)
                    if let title = snapshot?.title, !title.isEmpty { BodyText(title).lineLimit(2) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if active {
                    AppButton("Cancel", variant: .ghost, disabled: busy) { confirming = true }
                        .accessibilityLabel("Cancel this review")
                }
            }
            Mono(
                "\(ReviewFormat.kindLabel(detail.target)) · base \(snapshot.map { ReviewFormat.shortSha($0.baseSha) } ?? "—") · head \(ReviewFormat.shortSha(detail.target.headSha)) · \(ReviewFormat.modeLabel(detail.mode))\(detail.mode == .agent ? "" : " · pipeline v\(detail.pipelineVersion)")"
            )
            .lineLimit(3)

            if detail.supersededByRunId != nil {
                ReviewNotice(
                    title: "Stale: a newer commit of this pull request has been captured.",
                    detail: "These findings are about \(ReviewFormat.shortSha(detail.target.headSha)), which is no longer the pull request’s head. They stay readable, but this review takes no more decisions.",
                    destructive: false
                )
            }
            if detail.state == .failed {
                ReviewNotice(title: "The review failed.", detail: detail.failureReason ?? "No reason was recorded.", destructive: true)
            }

            HStack(spacing: 8) {
                if active { StatusDot(running: true) }
                Mono(ReviewFormat.stateLabel(detail.state, mode: detail.mode), color: Palette.foreground)
                Mono(coverage(progress)).lineLimit(2)
            }
            if detail.target.kind != .pullRequest, let path = detail.sourcePath, !path.isEmpty {
                Mono("from \(path == "." ? "the workspace root" : path)").lineLimit(1)
            }
        }
        .alert("Cancel this review?", isPresented: $confirming) {
            Button("Keep it running", role: .cancel) {}
            Button("Cancel review", role: .destructive, action: onCancel)
        } message: {
            Text("Work in progress stops and the review ends as cancelled. Findings are only produced by a review that finishes.")
        }
    }

    private func coverage(_ progress: CodeReviewProgress) -> String {
        var line = ReviewFormat.completenessLabel(progress.completeness)
        if let coverage = progress.coverage {
            line += " · \(coverage.reviewed) reviewed · \(coverage.notReviewed) not reviewed"
            if coverage.excluded > 0 { line += " · \(coverage.excluded) excluded" }
        }
        return line
    }
}

private struct ReviewNotice: View {
    let title: String
    let detail: String
    let destructive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            BodyText(title, color: destructive ? Palette.destructive : Palette.foreground, medium: true)
            Hint(detail)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            (destructive ? Palette.destructive.opacity(0.1) : Palette.muted.opacity(0.6)),
            in: RoundedRectangle(cornerRadius: Radius.md)
        )
    }
}

// MARK: - Findings and publishing

/// The preview a person is about to confirm. The request id is minted when the
/// preview arrives, so a resend of the same confirmation is the same publication.
private struct PendingPublication: Identifiable {
    let id = UUID()
    let findingId: String
    var preview: CodeReviewPublicationPreview?
    var requestId = ""
}

private struct FindingsBlock: View {
    let findings: CodeReviewFindingList
    let detail: CodeReviewDetail
    let generation: Int
    let onChanged: () -> Void

    @Environment(AppModel.self) private var model
    @State private var overview: CodeReviewPublicationOverview?
    @State private var loadError: String?
    @State private var pending: PendingPublication?
    @State private var previewBusyId: String?
    @State private var busyId: String?
    @State private var cardMessages: [String: String] = [:]
    @State private var sheetMessage: String?
    @State private var retrying: CodeReviewPublicationView?
    @State private var retryResult: String?

    private var local: Bool { ReviewFormat.isLocal(detail.target) }
    private var agent: Bool { detail.mode == .agent }
    private var issues: Bool {
        (overview?.target ?? (detail.target.kind == .pullRequest ? .pullRequestReview : .issues)) == .issues
    }
    private var repository: String { overview?.repository ?? ReviewFormat.location(of: detail.target) }
    private var heading: String { issues ? "Raise as issues in \(repository)" : "Publish to the pull request" }

    var body: some View {
        if findings.consolidationDigest == nil {
            Hint(
                ReviewFormat.isActive(findings.state)
                    ? "Findings appear here once every candidate has been verified and the results consolidated."
                    : "This review ended without consolidated findings."
            )
        } else if findings.findings.isEmpty {
            Hint("No finding survived verification.")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if !local {
                    Meta(heading)
                    if let overview {
                        if !overview.canPublish {
                            Hint(overview.blocker ?? "")
                        } else if !overview.findings.contains(where: { ReviewFormat.publishable($0) }) {
                            Hint("Nothing here can still be published: every finding was already posted, or cannot be raised.")
                        }
                    } else {
                        Hint(loadError ?? "Checking what can be published…")
                    }
                }
                ForEach(findings.findings, id: \.id) { finding in
                    FindingCard(
                        reviewId: findings.reviewId,
                        digest: findings.consolidationDigest ?? "",
                        canDecide: ReviewFormat.decidable(findings),
                        finding: finding,
                        agent: agent,
                        place: place(of: finding),
                        issues: issues,
                        publishing: busyId == finding.id || previewBusyId == finding.id,
                        publishMessage: cardMessages[finding.id],
                        target: detail.target,
                        disabled: busyId != nil || previewBusyId != nil,
                        onDecided: onChanged,
                        onPreview: { openPreview(finding.id) }
                    )
                }
                if local {
                    Meta("Elevating")
                    Hint("This review is of code in a local workspace that no connected forge knows, so there is nowhere to raise its findings. They stay here.")
                } else if let overview, !overview.publications.isEmpty {
                    Meta("Publications").padding(.top, 6)
                    ForEach(overview.publications, id: \.id) { publication in
                        PublicationCard(
                            publication: publication,
                            canRetry: overview.canPublish && busyId == nil,
                            onRetry: { retrying = publication }
                        )
                    }
                }
            }
            .task(id: generation) { if !local { await loadOverview() } }
            .sheet(item: $pending, onDismiss: { sheetMessage = nil }) { item in
                PublishSheet(
                    heading: heading, repository: repository, preview: item.preview, message: sheetMessage,
                    busy: busyId != nil,
                    onConfirm: {
                        if sheetMessage != nil { pending = nil } else { Task { await publish(item) } }
                    }
                )
            }
            .alert(
                "Retry this publication?",
                isPresented: Binding(get: { retrying != nil }, set: { if !$0 { retrying = nil } }),
                presenting: retrying
            ) { publication in
                Button("Cancel", role: .cancel) {}
                Button("Retry") { Task { await retry(publication.id) } }
            } message: { _ in
                Text("The forge is checked for what an earlier attempt already posted; only what is missing is sent.")
            }
            .alert(
                "Retry", isPresented: Binding(get: { retryResult != nil }, set: { if !$0 { retryResult = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(retryResult ?? "")
            }
        }
    }

    /// Where this finding would go — known only while the review can be published.
    private func place(of finding: CodeReviewFindingSummary) -> CodeReviewPublishableFinding? {
        guard let overview, overview.canPublish else { return nil }
        return overview.findings.first { $0.findingId == finding.id }
    }

    private func loadOverview() async {
        guard let seam = model.seam else { return }
        do {
            overview = try await seam.reviewPublications(findings.reviewId)
            loadError = overview == nil ? "This review is gone, or is not yours." : nil
        } catch {
            if isCancellation(error) { return }
            loadError = "Could not check what can be published."
        }
    }

    private func openPreview(_ findingId: String) {
        guard let seam = model.seam else {
            cardMessages[findingId] = "Not connected. Reconnect and try again."
            return
        }
        cardMessages[findingId] = nil
        sheetMessage = nil
        previewBusyId = findingId
        Task {
            defer { previewBusyId = nil }
            do {
                if let preview = try await seam.previewReviewPublication(findings.reviewId, findingIds: [findingId], event: .comment) {
                    pending = PendingPublication(findingId: findingId, preview: preview, requestId: UUID().uuidString.lowercased())
                } else {
                    cardMessages[findingId] = "This review is gone, or is not yours."
                }
            } catch {
                cardMessages[findingId] = "Could not prepare the preview. Try again."
            }
        }
    }

    private func publish(_ item: PendingPublication) async {
        guard let seam = model.seam, let preview = item.preview else { return }
        busyId = item.findingId
        defer { busyId = nil }
        do {
            let result = try await seam.publishReview(
                requestId: item.requestId, findings.reviewId,
                CodeReviewPublishRequest(findingIds: preview.items.map(\.findingId), event: preview.event)
            )
            sheetMessage = ReviewFormat.publishMessage(result)
            await loadOverview()
            onChanged()
        } catch {
            sheetMessage = "The server could not be reached. Nothing is known to be published; reload to see what happened."
        }
    }

    private func retry(_ publicationId: String) async {
        guard let seam = model.seam else { return }
        busyId = publicationId
        do {
            retryResult = ReviewFormat.publishMessage(try await seam.retryReviewPublication(findings.reviewId, publicationId: publicationId))
        } catch {
            retryResult = "The server could not be reached; reload to see what happened."
        }
        busyId = nil
        await loadOverview()
    }
}

private struct PublicationCard: View {
    let publication: CodeReviewPublicationView
    let canRetry: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Mono(
                    ReviewFormat.publicationStateLabel(publication.state),
                    color: publication.state == .published
                        ? Palette.primary : publication.state == .failed ? Palette.destructive : Palette.foreground
                )
                if publication.target != .issues { Mono(ReviewFormat.eventLabel(publication.event)) }
                Mono(ReviewFormat.shortSha(publication.headSha))
                Mono("\(publication.attempts) \(publication.attempts == 1 ? "attempt" : "attempts")")
                Spacer(minLength: 0)
                if ReviewFormat.retryable(publication) {
                    AppButton("Retry", variant: .outline, disabled: !canRetry, action: onRetry)
                }
            }
            if let error = publication.error { ErrorText(error) }
            ForEach(publication.items, id: \.findingId) { item in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Mono("#\(item.rank)")
                        Mono(ReviewFormat.severityName(item.severity), color: severityColor(item.severity))
                        BodyText(item.title).lineLimit(1)
                    }
                    Mono("\(ReviewFormat.placementLabel(item.placement)) · \(ReviewFormat.itemStateLabel(item.state))")
                    if let link = ReviewFormat.safeHttpUrl(item.remoteUrl), let url = URL(string: link) {
                        Link(destination: url) {
                            Text(link).font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary).lineLimit(1)
                        }
                    }
                    if let error = item.error, item.state != .published { ErrorText(error) }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))
    }
}

/// Exactly what will be posted, and the one button that posts it.
private struct PublishSheet: View {
    let heading: String
    let repository: String
    let preview: CodeReviewPublicationPreview?
    let message: String?
    let busy: Bool
    let onConfirm: () -> Void

    var body: some View {
        let toIssues = preview?.target == .issues
        AppSheet(title: heading, detents: [.large]) {
            if let preview {
                if toIssues {
                    BodyText("An issue in \(preview.repository ?? repository), about the reviewed commit \(ReviewFormat.shortSha(preview.headSha)), carrying the review’s coverage note.")
                } else {
                    BodyText("One review on the pull request, submitted as \(ReviewFormat.eventLabel(preview.event)), on commit \(ReviewFormat.shortSha(preview.headSha)). The head is checked again before anything is sent.")
                    if let notice = preview.coverageNotice { ErrorText("\(notice) It says so in the review.") }
                    Meta("Review body")
                    Pre(preview.reviewBody)
                }
                ForEach(preview.items.filter { $0.body != nil }, id: \.findingId) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Meta("#\(item.rank) · \(item.title)")
                        Mono("\(toIssues ? "issue" : "inline") · \(ReviewFormat.previewWhere(item))")
                        if toIssues {
                            Meta("Title")
                            Mono(item.issueTitle ?? "")
                        }
                        Pre(item.body ?? "")
                    }
                }
                let refused = preview.items.filter { $0.refusal != nil }
                if !refused.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Meta("Will not be posted")
                        ForEach(refused, id: \.findingId) { item in
                            Mono("#\(item.rank) · \(item.title): \(item.refusal ?? "")")
                        }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Mono("preparing the preview…")
                }
            }
            BodyText(
                toIssues
                    ? "Each issue is visible to everyone who can see the repository’s issues, and cannot be taken back from here."
                    : "This is visible to everyone who can see the pull request, and cannot be taken back from here."
            )
            if let message { BodyText(message, medium: true) }
            AppButton(
                message != nil ? "Close" : toIssues ? "Open issues" : "Post review",
                busy: busy, disabled: busy || preview == nil, fullWidth: true, action: onConfirm
            )
        }
    }
}

private struct Pre: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(AppFont.mono(12))
            .foregroundStyle(Palette.foreground)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Pill: View {
    let label: String
    var primary = false

    var body: some View {
        Text(label.uppercased())
            .font(AppFont.mono(10.5))
            .foregroundStyle(primary ? Palette.primary : Palette.mutedForeground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Palette.mutedForeground.opacity(0.1), in: Capsule())
    }
}

/// One finding: where it is, what it claims, and what can be done about it.
private struct FindingCard: View {
    let reviewId: String
    let digest: String
    let canDecide: Bool
    let finding: CodeReviewFindingSummary
    let agent: Bool
    let place: CodeReviewPublishableFinding?
    let issues: Bool
    let publishing: Bool
    let publishMessage: String?
    let target: CodeReviewTarget
    let disabled: Bool
    let onDecided: () -> Void
    let onPreview: () -> Void

    @Environment(AppModel.self) private var model
    @State private var busy = false
    @State private var fixing = false
    @State private var message: String?
    @State private var detail: CodeReviewFindingDetail?
    @State private var diff: CodeReviewFindingDiff?
    @State private var diffLoaded = false

    private var shown: CodeReviewFindingSummary { detail?.finding ?? finding }

    var body: some View {
        let shown = self.shown
        let ok = ReviewFormat.publishable(place)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 6) {
                    Mono("#\(shown.rank)")
                    Mono(ReviewFormat.severityName(shown.severity), color: severityColor(shown.severity))
                    BodyText(shown.title, medium: true).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                }
                let tags = ReviewFormat.cardTags(shown)
                if !tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(tags, id: \.label) { Pill(label: $0.label, primary: $0.primary) }
                    }
                }
                Mono(
                    "\(ReviewFormat.anchor(path: shown.path, side: shown.side, start: shown.startLine, end: shown.endLine))\(shown.inline ? "" : " · summary-level")\(shown.reports > 1 ? " · \(shown.reports) reports" : "")"
                )
                .lineLimit(1)
                .truncationMode(.head)
                if let prior = shown.priorDisposition, shown.disposition == .open {
                    Mono("previously \(ReviewFormat.dispositionLabel(prior.disposition))")
                }
            }
            .padding(12)

            VStack(alignment: .leading, spacing: 10) {
                if let detail {
                    claim(detail)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Mono("loading the finding…")
                    }
                }
                actions(shown: shown, ok: ok)
            }
            .padding(12)
            .topBorder()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))
        .task(id: finding.id) { await load() }
    }

    @ViewBuilder
    private func claim(_ detail: CodeReviewFindingDetail) -> some View {
        let remedy = detail.suggestedRemediation.jsTrim
        VStack(alignment: .leading, spacing: 8) {
            AnchoredDiff(diff: diff, loaded: diffLoaded)
            if agent || detail.finding.provenance == .agentSession {
                Meta("Comment")
                BodyText(detail.badBehavior)
                if !remedy.isEmpty {
                    Meta("Suggested fix")
                    BodyText(detail.suggestedRemediation)
                }
                if detail.suggestion != nil {
                    Meta("Suggested change")
                    if let suggestion = diff?.suggestion {
                        SuggestionDiff(suggestion: suggestion, path: detail.finding.path)
                    } else {
                        Hint(diffLoaded ? "The suggestion could not be loaded." : "loading the suggestion…")
                    }
                }
                Hint("Written by an agent session. The server checked its anchor against the pinned commits; its claim was not independently verified, and it has no score.")
            } else {
                Meta("Claim")
                labelled("When: ", detail.trigger)
                labelled("What goes wrong: ", detail.badBehavior)
                labelled("Why this change causes it: ", detail.causalChange)
                if !remedy.isEmpty { labelled("Suggested fix: ", detail.suggestedRemediation) }
                Meta("Verifier")
                labelled("supported", " by an independent verifier.")
                BodyText(detail.verifierRationale)
            }
        }
    }

    private func labelled(_ label: String, _ text: String) -> some View {
        (Text(label).font(AppFont.sansMedium(14)) + Text(text).font(AppFont.sans(14)))
            .foregroundStyle(Palette.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actions(shown: CodeReviewFindingSummary, ok: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let place {
                Mono(publishNote(place, shown: shown, ok: ok)).lineLimit(2)
            }
            HStack(spacing: 8) {
                if ok {
                    AppButton(
                        issues ? "Open as issue" : "Publish", busy: publishing,
                        disabled: disabled || busy || !canDecide, action: onPreview
                    )
                }
                AppButton("Fix it", variant: .outline, busy: fixing, disabled: disabled || busy || detail == nil) {
                    Task { await fixIt() }
                }
                if shown.disposition == .dismissed {
                    AppButton("Reopen", variant: .ghost, busy: busy, disabled: disabled || busy || !canDecide) {
                        Task { await decide(.open) }
                    }
                } else {
                    AppButton("Dismiss", variant: .ghost, busy: busy, disabled: disabled || busy || !canDecide) {
                        Task { await decide(.dismissed) }
                    }
                }
            }
            if !canDecide {
                Hint("This review no longer takes decisions: a newer head was captured, or the review did not finish.")
            }
            if let publishMessage { BodyText(publishMessage, size: 13, color: Palette.destructive) }
            if let message { ErrorText(message) }
        }
        .padding(.top, 10)
        .topBorder()
    }

    private func publishNote(_ place: CodeReviewPublishableFinding, shown: CodeReviewFindingSummary, ok: Bool) -> String {
        if place.publishedIn != nil { return "already published" }
        guard ok else { return place.refusal ?? "not publishable" }
        return "\(shown.provenance == .agentSession ? "agent comment" : "supported") · \(ReviewFormat.placementLabel(place.placement))\(shown.hasSuggestion ? " · with suggestion" : "")"
    }

    private func load() async {
        guard let seam = model.seam else { return }
        do {
            async let finding = seam.reviewFinding(reviewId, findingId: finding.id)
            async let lines = seam.reviewFindingDiff(reviewId, findingId: self.finding.id)
            let (fresh, freshDiff) = try await (finding, lines)
            if let fresh { detail = fresh }
            diff = freshDiff
            diffLoaded = true
        } catch {
            if isCancellation(error) { return }
            message = "Could not load this finding. Try again."
        }
    }

    /// Start a session whose first turn is "fix this", and go to it.
    private func fixIt() async {
        guard let seam = model.seam, let detail, !fixing else { return }
        fixing = true
        defer { fixing = false }
        do {
            let request = ReviewFormat.fixRequest(target: target, detail: detail)
            let selection = ModelSelection.autoRoute
            guard let id = try await seam.createSession(
                CreateSessionRequest(selection: selection, initialPrompt: request.prompt, repoUrls: [request.repoUrl])
            ) else {
                message = "Could not start a fix session. Try again."
                return
            }
            _ = try await seam.start(id, StartSessionRequest(prompt: request.prompt, selection: selection))
            model.router.push(.session(id: id))
        } catch {
            message = "Could not start a fix session. Try again."
        }
    }

    /// Send the decision against the version this card is showing; a refusal is
    /// worded, and either way the card re-reads the finding.
    private func decide(_ disposition: CodeReviewFindingDisposition) async {
        guard let seam = model.seam else { return }
        busy = true
        defer { busy = false }
        do {
            let seen = shown
            let result = try await seam.setFindingDisposition(
                reviewId, findingId: seen.id,
                CodeReviewFindingDispositionRequest(
                    disposition: disposition, expectedVersion: seen.version,
                    expectedConsolidationDigest: detail?.consolidationDigest ?? digest
                )
            )
            message = ReviewFormat.decisionMessage(result?.status)
            if let fresh = try await seam.reviewFinding(reviewId, findingId: finding.id) { detail = fresh }
            onDecided()
        } catch {
            message = "Not saved: the server could not be reached. Try again."
        }
    }
}

// MARK: - Diffs

private let diffAdd = Color.dynamic("#009966", "#00d492")

private struct DiffRow: View {
    let kind: CodeReviewDiffLineKind
    let text: String
    let truncated: Bool
    let anchored: Bool
    let number: Int?

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Mono(kind == .add ? "+" : kind == .delete ? "−" : " ", color: color).frame(width: 12, alignment: .leading)
            Mono(number.map(String.init) ?? "").frame(width: 38, alignment: .leading)
            Text(text + (truncated ? " …" : ""))
                .font(AppFont.mono(12))
                .foregroundStyle(kind == .context ? Palette.mutedForeground : Palette.foreground)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 6)
        .background(background)
    }

    private var color: Color {
        kind == .add ? diffAdd : kind == .delete ? Palette.destructive : Palette.mutedForeground
    }

    private var background: Color {
        if kind == .add { return diffAdd.opacity(0.08) }
        if kind == .delete { return Palette.destructive.opacity(0.08) }
        return anchored ? Palette.muted.opacity(0.55) : .clear
    }
}

private struct DiffFrame<Content: View>: View {
    let path: String
    let trailing: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Mono(path, color: Palette.foreground).lineLimit(1).truncationMode(.head)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Mono(trailing)
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 8)
            .background(Palette.muted.opacity(0.4))
            content()
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border))
    }
}

/// The lines a finding is anchored to, with context, from the review's pinned
/// commits. When they cannot be shown truthfully, it says why instead.
private struct AnchoredDiff: View {
    let diff: CodeReviewFindingDiff?
    let loaded: Bool

    var body: some View {
        if let diff {
            if diff.status == .contentUnavailable {
                Hint("The review’s pinned copy of the code is no longer cached on the server, so the anchored lines can’t be shown. The location is \(ReviewFormat.anchor(path: diff.path, side: diff.side, start: diff.startLine, end: diff.endLine)).")
            } else if diff.status == .anchorMismatch {
                Hint("The pinned code no longer matches what this finding anchored, so no lines are shown rather than the wrong ones.")
            } else {
                DiffFrame(path: diff.path, trailing: "\(ReviewFormat.shortSha(diff.fromSha)) → \(ReviewFormat.shortSha(diff.headSha))") {
                    ForEach(Array(ReviewFormat.diffRows(diff).enumerated()), id: \.offset) { _, row in
                        if row.gapBefore { Mono("…").padding(.vertical, 2).padding(.leading, 8) }
                        DiffRow(
                            kind: row.line.kind, text: row.line.text, truncated: row.line.textTruncated,
                            anchored: row.line.anchored, number: row.number
                        )
                    }
                    if diff.truncated { Mono("more lines not shown").padding(.vertical, 2).padding(.leading, 8) }
                }
            }
        } else {
            Hint(loaded ? "The anchored lines could not be loaded." : "loading the anchored lines…")
        }
    }
}

private struct SuggestionDiff: View {
    let suggestion: CodeReviewFindingSuggestion
    let path: String

    var body: some View {
        if suggestion.status == .contentUnavailable {
            Hint("The review’s pinned copy of the code is no longer cached on the server, so the suggestion can’t be shown against the lines it replaces.")
        } else if suggestion.status == .baseMismatch {
            Hint("The pinned code no longer matches the lines this suggestion was written against, so it is not shown and will not be published.")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                DiffFrame(path: path, trailing: "before → after") {
                    ForEach(Array(suggestion.lines.enumerated()), id: \.offset) { _, line in
                        DiffRow(
                            kind: line.kind, text: line.text, truncated: line.textTruncated, anchored: false,
                            number: line.newLine ?? line.oldLine
                        )
                    }
                    if !suggestion.lines.contains(where: { $0.kind == .add }) {
                        Mono("the suggestion deletes these lines").padding(.vertical, 2).padding(.leading, 8)
                    }
                }
                Hint(
                    (suggestion.applicable
                        ? "Published as a GitHub suggestion, which can be applied from the pull request."
                        : "Forgejo can’t apply suggestions: it is published as a plain “suggested replacement” block to copy by hand.")
                        + " An agent wrote it; it was not tested or verified."
                )
            }
        }
    }
}
#endif

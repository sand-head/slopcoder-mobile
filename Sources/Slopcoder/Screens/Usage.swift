#if canImport(UIKit)
import SlopcoderCore
import SwiftUI

/// What has been spent: tokens and cost over a range, per day and per model,
/// and what is left of any subscription plan's windows.
///
/// The headline is *new* tokens — uncached input, cache writes, output. In an
/// agent loop the prompt prefix is re-read on every step, so the full footprint
/// runs to many times that and, shown alone, reads as consumption it is not.
struct UsageScreen: View {
    @Environment(AppModel.self) private var model
    @State private var range = UsageRange.days30
    @State private var data: UsageDashboard?
    @State private var error: String?
    @State private var quotas: [PlanQuotaSummary] = []
    @State private var quotaBusy = false

    private static let ranges: [(label: String, value: UsageRange)] = [
        ("7d", .days7), ("30d", .days30), ("90d", .days90), ("All", .all),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ConnectionBanner(onRetry: { Task { await load() } })

                Picker("Range", selection: $range) {
                    ForEach(UsageScreen.ranges, id: \.label) { item in Text(item.label).tag(item.value) }
                }
                .pickerStyle(.segmented)
                .onChange(of: range) { _, _ in Haptics.select() }

                if let error {
                    ErrorText(error)
                    Button { Task { await load() } } label: {
                        Text("Try again").font(AppFont.mono(12)).underline().foregroundStyle(Palette.primary)
                    }
                    .buttonStyle(.plain)
                }
                if data == nil, error == nil { Skeleton(rows: 3) }

                // A failed fetch renders nothing: an allowance that cannot be
                // read is not worth an error on the page about spend.
                ForEach(quotas, id: \.connectionId) { quota in
                    QuotaCard(quota: quota, busy: quotaBusy) { Task { await refreshQuotas() } }
                }

                if let data {
                    Totals(totals: data.totals)
                    Daily(buckets: data.daily)
                    VStack(alignment: .leading, spacing: 0) {
                        SectionLabel("by model", trailing: data.breakdown.isEmpty ? nil : String(data.breakdown.count))
                        if data.breakdown.isEmpty { Hint("Nothing in this range.").padding(.top, 6) }
                        ForEach(Array(data.breakdown.enumerated()), id: \.offset) { _, row in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    BodyText(row.model).lineLimit(1)
                                    Mono("\(row.connectionName ?? "unknown connection") · \(row.totals.completions) calls\(UsageFormat.attribution(row.attributionQuality))").lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                VStack(alignment: .trailing, spacing: 2) {
                                    Mono(UsageFormat.compact(row.totals.newTokens), size: 12.5, color: Palette.foreground)
                                    Mono(UsageFormat.planBilled(row.providerKind) ? "plan" : UsageFormat.money(row.totals.estimatedCost))
                                }
                            }
                            .padding(.vertical, 8)
                            .frame(minHeight: 44)
                            .topBorder()
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .pageBackground()
        .navigationTitle("Usage")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await load() }
        .task(id: range) { await load() }
    }

    private func load() async {
        guard let seam = model.seam else { return }
        data = nil
        error = nil
        async let quotaList = try? seam.planQuotas(refresh: false)
        do {
            data = try await seam.usage(range)
        } catch is CancellationError {
            return
        } catch {
            self.error = describe(error)
        }
        quotas = await quotaList ?? []
    }

    private func refreshQuotas() async {
        guard let seam = model.seam, !quotaBusy else { return }
        quotaBusy = true
        defer { quotaBusy = false }
        if let fresh = try? await seam.planQuotas(refresh: true) { quotas = fresh }
    }
}

private struct Totals: View {
    let totals: UsageTotals

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom, spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Meta("new tokens")
                    Text(UsageFormat.compact(totals.newTokens)).font(AppFont.sansMedium(26, relativeTo: .title)).foregroundStyle(Palette.foreground)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Meta("cost")
                    Text(UsageFormat.money(totals.estimatedCost)).font(AppFont.sansMedium(26, relativeTo: .title)).foregroundStyle(Palette.foreground)
                }
            }
            Mono("\(UsageFormat.compact(totals.cacheReadTokens)) re-read from cache · \(UsageFormat.compact(totals.totalTokens)) in total · \(totals.completions) calls")
            if totals.hasUnpriced {
                Mono("Some models here have no price; the cost is a floor.", color: Palette.destructive)
            }
        }
        .padding(14)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
    }
}

private struct Daily: View {
    let buckets: [UsageBucket]

    var body: some View {
        if let first = buckets.first, let last = buckets.last {
            let values = buckets.map(\.totals.newTokens)
            let peak = max(values.max() ?? 0, 1)
            let busiest = buckets[values.firstIndex(of: values.max() ?? 0) ?? 0]
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel("per day")
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(Array(buckets.enumerated()), id: \.offset) { index, _ in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(values[index] == 0 ? Palette.mutedForeground.opacity(0.2) : Palette.primary)
                            .frame(height: values[index] == 0 ? 2 : max(3, 56 * CGFloat(values[index]) / CGFloat(peak)))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 56, alignment: .bottom)
                .accessibilityElement()
                .accessibilityLabel("New tokens per day, \(first.day) to \(last.day)")
                Mono("\(first.day) – \(last.day) · busiest \(busiest.day) at \(UsageFormat.compact(values.max() ?? 0))")
            }
        }
    }
}

/// A subscription plan's windows: what is left, and when it comes back.
private struct QuotaCard: View {
    let quota: PlanQuotaSummary
    let busy: Bool
    let onRefresh: () -> Void

    var body: some View {
        let claude = quota.kind == .claudeCode
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Meta("\(claude ? "claude" : "codex") allowance · \(quota.connectionName)")
                if let plan = quota.planType, !plan.isEmpty { Mono(plan.lowercased(), size: 11) }
            }

            if let error = quota.error, !error.isEmpty {
                ErrorText(error)
            } else if quota.windows.isEmpty {
                Hint(claude
                    ? "No allowance reported yet. Claude Code reports it during a turn on this connection."
                    : "No allowance reported yet.")
            } else {
                ForEach(Array(quota.windows.enumerated()), id: \.offset) { _, window in
                    let left = UsageFormat.percentLeft(window)
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Mono(UsageFormat.windowLabel(window), size: 12.5)
                            Spacer()
                            if let resets = window.resetsAt, !resets.isEmpty { Mono("resets \(RoutineFormat.clock(resets))", size: 12.5) }
                        }
                        if let left {
                            GeometryReader { proxy in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Palette.mutedForeground.opacity(0.2))
                                    // The bar is what is left, and goes red when
                                    // little of it is.
                                    Capsule().fill(left <= 20 ? Palette.destructive : Palette.primary)
                                        .frame(width: proxy.size.width * CGFloat(left) / 100)
                                }
                            }
                            .frame(height: 6)
                        }
                    }
                }
            }

            HStack(spacing: 8) {
                Mono(UsageFormat.quotaNote(quota))
                // Codex is polled on request; a Claude plan is only ever observed,
                // so asking again can learn nothing new and is not offered.
                if quota.canRefresh {
                    Button(action: onRefresh) {
                        Text(busy ? "refreshing…" : "refresh").font(AppFont.mono(12)).underline()
                            .foregroundStyle(busy ? Palette.mutedForeground : Palette.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                }
            }
        }
        .padding(14)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, lineWidth: 1))
    }
}
#endif

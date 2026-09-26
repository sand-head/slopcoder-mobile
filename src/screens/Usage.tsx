/**
 * What has been spent, across every session.
 *
 * The figure that leads is **new tokens** — uncached input, cache writes, output
 * — because in an agent loop the prompt prefix is re-read on every step, so the
 * full footprint runs to many times that and, shown alone, reads as consumption
 * it is not. The server's own contract says as much; this screen just refuses to
 * put the bigger, more flattering, less true number on top.
 *
 * Cost is a floor, not a total: `hasUnpriced` means some model in the range has
 * no price and contributed nothing to the estimate. Saying so is the difference
 * between an estimate and a wrong number.
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import {
  UsageAttributionQuality,
  UsageRange,
  newTokens,
  totalTokens,
  type CodexQuotaSummary,
  type UsageBucket,
  type UsageDashboard,
  type UsageTotals,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { Body, Hint, Meta, Mono, SectionLabel, Skeleton } from '../ui/kit';
import { SheetSegments } from '../ui/Sheet';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { tapSelect } from '../ui/haptics';
import { font, mix, radius, useTheme } from '../theme';

const RANGES = [
  { key: 'Days7', label: '7d', value: UsageRange.Days7 },
  { key: 'Days30', label: '30d', value: UsageRange.Days30 },
  { key: 'Days90', label: '90d', value: UsageRange.Days90 },
  { key: 'All', label: 'All', value: UsageRange.All },
];

/** 1.2M rather than 1,234,567 — the magnitude is the point, not the digits. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function money(value: number | null | undefined): string {
  if (value == null) return '—';
  // Three places only when two would round to nothing; otherwise $0.620 sits
  // oddly beside $3.72.
  return value > 0 && value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

export function UsageScreen({ navigation }: { navigation: any }) {
  const { c } = useTheme();
  const seam = useAuth(s => s.seam);

  const [range, setRange] = useState(UsageRange.Days30);
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Quotas load on their own line: they are advisory and slow (a refresh asks
  // the upstream), so a failure here must not blank the figures above.
  const [quotas, setQuotas] = useState<CodexQuotaSummary[] | null>(null);
  const [quotaBusy, setQuotaBusy] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Usage' });
  }, [navigation]);

  useEffect(() => {
    if (!seam) return;
    let cancelled = false;
    setData(null);
    setError(null);
    seam
      .usage(range)
      .then(d => !cancelled && setData(d))
      // The message, not the exception: OfflineError already says the useful
      // thing, and a stringified TypeError says nothing to anybody.
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setRefreshing(false));
    return () => {
      cancelled = true;
    };
  }, [seam, range, attempt]);

  // Quotas once per visit (and per pull-to-refresh), from the server's cache;
  // the explicit "refresh" under each card is what asks the upstream again.
  useEffect(() => {
    if (!seam) return;
    let cancelled = false;
    setQuotas(null);
    seam
      .codexQuotas(false)
      .then(q => !cancelled && setQuotas(q))
      .catch(() => !cancelled && setQuotas([]));
    return () => {
      cancelled = true;
    };
  }, [seam, attempt]);

  /** Re-ask the upstream for one connection's windows; the card re-reads after. */
  const refreshQuotas = async (force: boolean) => {
    if (!seam || quotaBusy) return;
    setQuotaBusy(true);
    try {
      setQuotas(await seam.codexQuotas(force));
    } catch {
      // The old rows stay; the numbers above are unaffected either way.
    } finally {
      setQuotaBusy(false);
    }
  };

  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt(a => a + 1);
  }, []);

  return (
    // The scroll view *is* the screen, with nothing wrapped around it. UIKit
    // only collapses the large title against a scroll view it has found, and it
    // finds it by walking first children down from the screen — a `Screen` in
    // between, though still a first child, was one step too many and the bar
    // never adopted the page. It painted a background the navigator's
    // `contentStyle` already paints, so it cost nothing to drop.
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 18 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.mutedForeground} />
      }>
      <ConnectionBanner onRetry={refresh} />

      <SheetSegments
        options={RANGES.map(r => ({ key: r.key, label: r.label }))}
        selected={RANGES.find(r => r.value === range)?.key ?? 'Days30'}
        onSelect={key => {
          tapSelect();
          setRange(RANGES.find(r => r.key === key)?.value ?? UsageRange.Days30);
        }}
      />

      {error ? (
        <View style={{ gap: 8 }}>
          <Body accessibilityLiveRegion="polite" style={{ color: c.destructive, fontSize: 13 }}>
            {error}
          </Body>
          <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button">
            <Mono style={{ color: c.primary, textDecorationLine: 'underline' }}>Try again</Mono>
          </Pressable>
        </View>
      ) : null}
      {!data && !error ? <Skeleton rows={3} /> : null}

      {/* Advisory Codex allowances, only when there is one to show: an empty
          list is "no Codex connection", which is not a section. Null still
          loading is deliberately silent — the figures above lead. */}
      {quotas && quotas.length > 0 ? (
        quotas.map(q => <QuotaCard key={q.connectionId} quota={q} busy={quotaBusy} onRefresh={() => void refreshQuotas(true)} />)
      ) : null}

      {data ? (
        <>
          <Totals totals={data.totals} />
          <Daily buckets={data.daily} />

          <View>
            <SectionLabel label="by model" count={data.breakdown.length || undefined} />
            {data.breakdown.length === 0 ? (
              <Hint>Nothing in this range.</Hint>
            ) : (
              data.breakdown.map(row => (
                <View
                  key={`${row.connectionName ?? ''}:${row.model}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 52,
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: c.border,
                  }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14 }}>
                      {row.model}
                    </Body>
                    <Mono numberOfLines={1}>
                      {row.connectionName ?? 'unknown connection'} · {row.totals.completions} calls
                      {row.attributionQuality === UsageAttributionQuality.Exact
                        ? ''
                        : row.attributionQuality === UsageAttributionQuality.InferredLegacy
                          ? ' · inferred'
                          : ' · unattributed'}
                    </Mono>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Mono style={{ fontSize: 12.5, color: c.foreground }}>
                      {compact(newTokens(row.totals))}
                    </Mono>
                    <Mono>{money(row.totals.estimatedCost)}</Mono>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function Totals({ totals }: { totals: UsageTotals }) {
  const { c } = useTheme();

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.lg,
        padding: 14,
        gap: 10,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Meta>new tokens</Meta>
          <Body style={{ fontFamily: font.sansMedium, fontSize: 26 }}>
            {compact(newTokens(totals))}
          </Body>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Meta>cost</Meta>
          <Body style={{ fontFamily: font.sansMedium, fontSize: 26 }}>
            {money(totals.estimatedCost)}
          </Body>
        </View>
      </View>

      <View style={{ gap: 3 }}>
        <Mono>
          {compact(totals.cacheReadTokens)} re-read from cache · {compact(totalTokens(totals))} in
          total · {totals.completions} calls
        </Mono>
        {totals.hasUnpriced ? (
          // Without this the number reads as the bill rather than part of it.
          <Mono style={{ color: c.destructive }}>
            Some models here have no price; the cost is a floor.
          </Mono>
        ) : null}
      </View>
    </View>
  );
}

/** New tokens per day. Bars, because the shape is the question, not the values. */
function Daily({ buckets }: { buckets: UsageBucket[] }) {
  const { c } = useTheme();
  if (buckets.length === 0) return null;

  const values = buckets.map(b => newTokens(b.totals));
  const peak = Math.max(...values, 1);
  const busiest = buckets[values.indexOf(Math.max(...values))];

  return (
    <View style={{ gap: 6 }}>
      <SectionLabel label="per day" />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 2,
          height: 64,
          paddingTop: 4,
        }}>
        {buckets.map((bucket, index) => (
          <View
            key={bucket.day}
            style={{
              flex: 1,
              // A day with nothing still gets a sliver, so the axis reads as a
              // run of days rather than a gap in the data.
              height: Math.max(2, (values[index] / peak) * 60),
              borderRadius: 2,
              backgroundColor: values[index] === 0 ? mix(c.mutedForeground, 20) : c.primary,
            }}
          />
        ))}
      </View>
      <Mono>
        {buckets[0].day} – {buckets[buckets.length - 1].day} · busiest {busiest.day} at{' '}
        {compact(Math.max(...values))}
      </Mono>
    </View>
  );
}

/** `HH:MM` from an ISO stamp — reset times are hours away, so the clock is the part that matters. */
function clock(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * One Codex connection's allowance: a bar per window with the percent left and
 * when it resets. Advisory by contract — slopcoder reads the plan's own usage
 * page, it does not meter it — so the card says so and links nothing: the
 * authoritative numbers are a browser away, and a phone cannot open them.
 */
function QuotaCard({ quota, busy, onRefresh }: { quota: CodexQuotaSummary; busy: boolean; onRefresh: () => void }) {
  const { c } = useTheme();

  return (
    <View
      style={{
        backgroundColor: c.card,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.lg,
        padding: 14,
        gap: 10,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <SectionLabel label={`codex allowance · ${quota.connectionName}`} />
        {quota.planType ? <Mono style={{ fontSize: 11 }}>{quota.planType.toLowerCase()}</Mono> : null}
      </View>

      {quota.error ? (
        <Body accessibilityLiveRegion="polite" style={{ fontSize: 13, color: c.destructive }}>
          {quota.error}
        </Body>
      ) : quota.windows.length === 0 ? (
        <Hint>No allowance reported yet.</Hint>
      ) : (
        quota.windows.map((w, i) => {
          const left = w.usedPercent != null ? Math.min(100, Math.max(0, 100 - w.usedPercent)) : null;
          return (
            <View key={`${w.label}-${i}`} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Mono style={{ fontSize: 12.5 }}>
                  {w.label.toLowerCase()}
                  {left != null ? ` · ${Math.round(left)}% left` : ' · usage unknown'}
                </Mono>
                {w.resetsAt ? <Mono style={{ fontSize: 12.5 }}>resets {clock(w.resetsAt)}</Mono> : null}
              </View>
              {left != null ? (
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    overflow: 'hidden',
                    backgroundColor: mix(c.mutedForeground, 20),
                  }}>
                  <View
                    style={{
                      width: `${left.toFixed(1)}%`,
                      flex: 1,
                      borderRadius: 2,
                      // What is gone, not what is left: a nearly-empty bar in
                      // the running colour would read as nearly-burned-down.
                      backgroundColor: left <= 20 ? c.destructive : c.primary,
                    }}
                  />
                </View>
              ) : null}
            </View>
          );
        })
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Mono style={{ fontSize: 12 }}>
          advisory
          {quota.observedAt ? ` · observed ${clock(quota.observedAt)}` : ''}
          {quota.isStale ? ' · stale' : ''}
        </Mono>
        <Pressable onPress={onRefresh} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Refresh Codex allowance">
          <Mono style={{ fontSize: 12, color: busy ? c.mutedForeground : c.primary, textDecorationLine: 'underline' }}>
            {busy ? 'refreshing…' : 'refresh'}
          </Mono>
        </Pressable>
      </View>
    </View>
  );
}

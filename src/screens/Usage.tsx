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
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  UsageAttributionQuality,
  UsageRange,
  newTokens,
  totalTokens,
  type UsageBucket,
  type UsageDashboard,
  type UsageTotals,
} from '../api/contracts';
import { useAuth } from '../state/auth';
import { Body, Hint, Meta, Mono, SectionLabel, Skeleton } from '../ui/kit';
import { SheetSegments } from '../ui/Sheet';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { useHeaderInset } from '../navigation/headers';
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

  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt(a => a + 1);
  }, []);

  const probe = useInsetProbe();

  return (
    // A fragment, not a view: the bar's large title only collapses against a
    // scroll view UIKit has found, and it looks for it by walking first
    // children down from the screen. A `Screen` in between was one level too
    // many — and it painted a background the navigator's `contentStyle` already
    // paints. The probe is a sibling *after* the list, which leaves the walk
    // alone.
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 18 }}
        {...probe.scroll}
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
      <InsetProbe {...probe.reading} />
    </>
  );
}

/**
 * TEMPORARY — remove with the commit that settles the large-title bug.
 *
 * The one number that tells us whether UIKit ever adopted this page's scroll
 * view. When it has, the resting `contentOffset.y` is exactly minus the inset
 * it applied, because that is how a scroll view sits "at the top" with an
 * inset. So, at rest:
 *
 *   rest ≈ -header  → UIKit adopted it and applied the whole bar. The title
 *                     not collapsing is then something else entirely.
 *   rest ≈ -safe    → only the safe area. The bar contributed nothing, which
 *                     means it never found this scroll view.
 *   rest ≈ 0        → nothing adjusted it at all.
 *
 * `contentInset` on the scroll event is no use here: React Native reports the
 * scroll view's own `contentInset`, which nobody sets, rather than
 * `adjustedContentInset`, which is where the bar's contribution lands.
 */
function useInsetProbe() {
  const header = useHeaderInset();
  const safe = useSafeAreaInsets();
  const [live, setLive] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const latest = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    latest.current = event.nativeEvent.contentOffset.y;
    setLive(latest.current);
  }, []);
  // Where it settled, which is the reading that means something — mid-drag and
  // mid-bounce the offset is whatever the finger made it.
  const settle = useCallback(() => setRest(latest.current), []);

  return {
    scroll: {
      scrollEventThrottle: 32,
      onScroll,
      onMomentumScrollEnd: settle,
      onScrollEndDrag: settle,
    },
    reading: { live, rest, header, safe: safe.top },
  };
}

/** TEMPORARY — see {@link useInsetProbe}. */
function InsetProbe({
  live,
  rest,
  header,
  safe,
}: {
  live: number;
  rest: number | null;
  header: number;
  safe: number;
}) {
  const { c } = useTheme();
  const verdict =
    rest === null
      ? 'scroll to the top and lift your finger'
      : Math.abs(rest + header) < 6
        ? 'ADOPTED — bar is in the inset'
        : Math.abs(rest + safe) < 6
          ? 'NOT ADOPTED — safe area only'
          : Math.abs(rest) < 6
            ? 'NO ADJUSTMENT AT ALL'
            : 'neither — read the numbers';

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 8,
        bottom: 100,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: radius.md,
        backgroundColor: mix(c.foreground, 12),
        borderWidth: 1,
        borderColor: c.border,
      }}>
      <Mono style={{ fontSize: 11, color: c.foreground }}>
        rest {rest === null ? '—' : rest.toFixed(1)} · live {live.toFixed(1)}
      </Mono>
      <Mono style={{ fontSize: 11, color: c.foreground }}>
        header {header.toFixed(1)} · safe {safe.toFixed(1)}
      </Mono>
      <Mono style={{ fontSize: 11, color: c.primary }}>{verdict}</Mono>
    </View>
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

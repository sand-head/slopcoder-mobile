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
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import { BackButton, Body, Hint, Meta, Mono, Screen, SectionLabel } from '../ui/kit';
import { SheetSegments } from '../ui/Sheet';
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
  const insets = useSafeAreaInsets();
  const seam = useAuth(s => s.seam);

  const [range, setRange] = useState(UsageRange.Days30);
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seam) return;
    let cancelled = false;
    setData(null);
    seam
      .usage(range)
      .then(d => !cancelled && setData(d))
      .catch(e => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [seam, range]);

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: insets.top + 8,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
        <BackButton onPress={() => navigation.goBack()} />
        <Body style={{ flex: 1, fontFamily: font.sansMedium, fontSize: 14 }}>Usage</Body>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 24,
          gap: 18,
        }}>
        <SheetSegments
          options={RANGES.map(r => ({ key: r.key, label: r.label }))}
          selected={RANGES.find(r => r.value === range)?.key ?? 'Days30'}
          onSelect={key => setRange(RANGES.find(r => r.key === key)?.value ?? UsageRange.Days30)}
        />

        {error ? <Body style={{ color: c.destructive, fontSize: 13 }}>{error}</Body> : null}
        {!data && !error ? <Hint>Loading…</Hint> : null}

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
    </Screen>
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

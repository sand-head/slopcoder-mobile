/**
 * What a model offers, and in what order the models are listed — ported from
 * `SlopCoder.Contracts/ThinkingLevel.cs` (`ThinkingLevels`), the web's
 * `ThinkingPicker.razor` helpers, and `ModelOrdering.cs`.
 *
 * A persisted thinking pick can outlive the model it was made on (an Auto
 * turn, a model switch), so every level still has to land somewhere. The
 * providers map an unoffered level the same way {@link runsAs} does, and the
 * dial shows that rather than the stale pick — otherwise the phone would say
 * "Off" over a turn that is about to think at Low.
 */
import { ThinkingLevel, type ModelCandidate } from './contracts';

const ALL_EFFORTS: readonly ThinkingLevel[] = [
  ThinkingLevel.Low,
  ThinkingLevel.Medium,
  ThinkingLevel.High,
  ThinkingLevel.Max,
];

/** What a model says about thinking; both fields absent means unknown. */
export interface ThinkingCaps {
  supportedThinkingLevels?: readonly ThinkingLevel[] | null;
  alwaysThinks?: boolean;
}

function efforts(supported: readonly ThinkingLevel[] | null | undefined): ThinkingLevel[] {
  const listed = (supported ?? []).filter(level => level !== ThinkingLevel.Off);
  return listed.length > 0 ? [...new Set(listed)].sort((a, b) => a - b) : [...ALL_EFFORTS];
}

/**
 * The levels to offer, in dial order. Unknown support offers every effort; Off
 * is offered unless the model always thinks.
 */
export function offeredLevels(caps: ThinkingCaps | null | undefined): ThinkingLevel[] {
  const list = efforts(caps?.supportedThinkingLevels);
  return caps?.alwaysThinks ? list : [ThinkingLevel.Off, ...list];
}

/**
 * The level `level` runs as: itself when offered, otherwise the nearest
 * offered level above it, otherwise the highest. Up first, because the rungs a
 * template or API lacks are usually folded into the next one (Opus 5.5's Off
 * is Low; Qwen 3.8's High is xhigh).
 */
export function runsAs(level: ThinkingLevel, caps: ThinkingCaps | null | undefined): ThinkingLevel {
  const offered = offeredLevels(caps);
  if (offered.includes(level)) return level;
  return offered.find(candidate => candidate > level) ?? offered[offered.length - 1];
}

/**
 * A model with exactly one effort is an on/off switch (Qwen 3.5/3.6's
 * `enable_thinking`); calling that level Medium would imply a dial.
 */
export function isSwitch(caps: ThinkingCaps | null | undefined): boolean {
  const listed = (caps?.supportedThinkingLevels ?? []).filter(level => level !== ThinkingLevel.Off);
  return new Set(listed).size === 1;
}

const LABELS: Record<ThinkingLevel, string> = {
  [ThinkingLevel.Off]: 'Off',
  [ThinkingLevel.Low]: 'Low',
  [ThinkingLevel.Medium]: 'Medium',
  [ThinkingLevel.High]: 'High',
  [ThinkingLevel.Max]: 'Max',
};

const KEYS: Record<ThinkingLevel, string> = {
  [ThinkingLevel.Off]: 'off',
  [ThinkingLevel.Low]: 'low',
  [ThinkingLevel.Medium]: 'medium',
  [ThinkingLevel.High]: 'high',
  [ThinkingLevel.Max]: 'max',
};

/** The stable key for a level — the same words the web's dial uses. */
export function levelKey(level: ThinkingLevel): string {
  return KEYS[level];
}

/** The label on the dial: a switch model's one effort reads "On". */
export function levelLabel(level: ThinkingLevel, caps: ThinkingCaps | null | undefined): string {
  return level !== ThinkingLevel.Off && isSwitch(caps) ? 'On' : LABELS[level];
}

// ---- ordering ----

function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Newest release first; an unknown date sorts after every known one. Dates are
 * `yyyy-MM-dd`, so string order is date order.
 */
function compareNewest(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a > b ? -1 : a < b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * The picker's one order (`ModelOrdering.ByProviderTierNewest`): by provider,
 * then connection, then up the tier ladder, then newest first, then by name.
 * Returns a new array; the input is left alone.
 */
export function orderModels(models: readonly ModelCandidate[]): ModelCandidate[] {
  return [...models].sort(
    (a, b) =>
      a.kind - b.kind ||
      compareText(a.connectionName, b.connectionName) ||
      compareText(a.connectionId, b.connectionId) ||
      a.tier - b.tier ||
      compareNewest(a.releaseDate, b.releaseDate) ||
      compareText(a.modelDisplayName, b.modelDisplayName),
  );
}

/**
 * The candidate behind a selection, or null. Matched on the connection as well
 * as the id when there is one: the same model can be listed by two connections,
 * and their thinking metadata need not agree.
 */
export function findCandidate(
  models: readonly ModelCandidate[],
  connectionId: string | null | undefined,
  modelId: string | null | undefined,
): ModelCandidate | null {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  const sameId = models.filter(m => m.modelId.toLowerCase() === id);
  return (connectionId ? sameId.find(m => m.connectionId === connectionId) : undefined) ?? sameId[0] ?? null;
}

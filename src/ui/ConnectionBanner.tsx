/**
 * One line, only when something is actually wrong.
 *
 * Unreachable is loud, because nothing works until it is fixed. A dropped hub is
 * quiet, because reads still work and the only cost is that the page stops
 * updating itself — the same distinction the store draws.
 */
import React from 'react';
import { Pressable } from 'react-native';
import { useConnection } from '../state/connection';
import { Mono } from './kit';
import { mix, useTheme } from '../theme';

export function ConnectionBanner({ onRetry }: { onRetry?: () => void }) {
  const { c } = useTheme();
  const reachable = useConnection(s => s.reachable);
  const live = useConnection(s => s.live);

  if (reachable && live) return null;

  const down = !reachable;

  return (
    <Pressable
      onPress={down ? onRetry : undefined}
      disabled={!down || !onRetry}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 16,
        backgroundColor: down ? mix(c.destructive, 14) : mix(c.mutedForeground, 10),
      }}>
      <Mono style={{ fontSize: 11.5, color: down ? c.destructive : c.mutedForeground }}>
        {down ? 'Cannot reach slopcoder' : 'Reconnecting to live updates…'}
      </Mono>
      {down && onRetry ? (
        <Mono style={{ fontSize: 11.5, color: c.destructive, textDecorationLine: 'underline' }}>
          retry
        </Mono>
      ) : null}
    </Pressable>
  );
}

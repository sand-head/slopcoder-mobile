/**
 * One line, only when something is actually wrong.
 *
 * Unreachable is loud, because nothing works until it is fixed. A dropped hub is
 * quiet, because reads still work and the only cost is that the page stops
 * updating itself — the same distinction the store draws.
 *
 * The quiet one also waits a moment. Every cold start is a second or two of not
 * being live, and a bar that appears on launch and then vanishes reads as a
 * fault rather than as a handshake.
 */
import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { useConnection } from '../state/connection';
import { Mono } from './kit';
import { mix, useTheme } from '../theme';

/** How long the hub may be away before it is worth saying so. */
const LIVE_GRACE_MS = 2_500;

export function ConnectionBanner({ onRetry }: { onRetry?: () => void }) {
  const { c } = useTheme();
  const reachable = useConnection(s => s.reachable);
  const live = useConnection(s => s.live);
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (live) {
      setLingering(false);
      return;
    }

    const timer = setTimeout(() => setLingering(true), LIVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [live]);

  const down = !reachable;
  if (!down && (live || !lingering)) return null;

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

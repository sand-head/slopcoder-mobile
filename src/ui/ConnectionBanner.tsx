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
 *
 * And it can be asked why. A phone has no console, so a connection that never
 * arrives is a bar that says "reconnecting" and nothing else — which is not a
 * symptom anyone can act on. Tapping it shows what the transport last said.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useConnection } from '../state/connection';
import { Mono } from './kit';
import { mix, useTheme } from '../theme';

/** How long the hub may be away before it is worth saying so. */
const LIVE_GRACE_MS = 2_500;

export function ConnectionBanner({ onRetry }: { onRetry?: () => void }) {
  const { c } = useTheme();
  const reachable = useConnection(s => s.reachable);
  const live = useConnection(s => s.live);
  const reason = useConnection(s => s.reason);
  const [lingering, setLingering] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (live) {
      setLingering(false);
      setAsked(false);
      return;
    }

    const timer = setTimeout(() => setLingering(true), LIVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [live]);

  const down = !reachable;
  if (!down && (live || !lingering)) return null;

  const tint = down ? c.destructive : c.mutedForeground;

  return (
    <Pressable
      onPress={down ? onRetry : () => setAsked(!asked)}
      disabled={down && !onRetry}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 16,
        gap: 4,
        backgroundColor: down ? mix(c.destructive, 14) : mix(c.mutedForeground, 10),
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Mono style={{ fontSize: 11.5, color: tint }}>
          {down ? 'Cannot reach slopcoder' : 'Reconnecting to live updates…'}
        </Mono>
        {down && onRetry ? (
          <Mono style={{ fontSize: 11.5, color: tint, textDecorationLine: 'underline' }}>retry</Mono>
        ) : null}
      </View>

      {/* Verbatim, untruncated. A transport error is only useful whole, and the
          one person reading it is the one who can fix the server. */}
      {asked && !down ? (
        <Mono style={{ fontSize: 10.5, color: tint, textAlign: 'center' }}>
          {reason ?? 'no error reported — the handshake has not finished'}
        </Mono>
      ) : null}
    </Pressable>
  );
}

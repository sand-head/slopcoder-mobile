import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatRoomListing, SessionSummary } from '../api/contracts';
import { serialRefresh } from '../api/rooms';
import { useAuth } from './auth';
import { useSessionHub } from './hub';

/**
 * The two kinds of conversation in the chat switcher. Nothing is fetched while
 * the drawer is closed; once open, registry and room signals keep both lists
 * live without subscribing every covered screen to a second hub.
 */
export function useChatDirectory(visible: boolean) {
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [rooms, setRooms] = useState<ChatRoomListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      const [nextSessions, nextRooms] = await Promise.all([
        seam.sessions(),
        seam.chatRooms(),
      ]);
      setSessions(nextSessions);
      setRooms(nextRooms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [seam]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const refresh = useMemo(() => serialRefresh(() => load()), [load]);
  useEffect(() => {
    if (!visible || !hub) return;
    const registry = hub.addRegistryListener(() => refresh(false));
    const room = hub.addRoomListener(() => refresh(false));
    return () => {
      registry();
      room();
    };
  }, [visible, hub, refresh]);

  return { sessions, rooms, error, reload: load };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionSummary } from '../api/contracts';
import { serialRefresh } from '../api/sessionIdentity';
import { useAuth } from './auth';
import { useSessionHub } from './hub';

/**
 * The session switcher loads only while visible, and coalesces registry
 * updates so bursts cannot race list reads.
 */
export function useChatDirectory(visible: boolean) {
  const seam = useAuth(s => s.seam);
  const { hub } = useSessionHub();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!seam) return;
    try {
      setSessions(await seam.sessions());
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
    return () => {
      registry();
    };
  }, [visible, hub, refresh]);

  return { sessions, error, reload: load };
}

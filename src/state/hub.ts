/**
 * One hub connection for the whole app, tied to the current credential.
 *
 * Sessions come and go as screens push and pop; the socket does not. Screens
 * register a listener for the session they are showing and the hub multiplexes.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SessionHub } from '../api/hub';
import { useAuth } from './auth';
import { useConnection } from './connection';

export function useSessionHub(): { hub: SessionHub | null; connected: boolean } {
  const credential = useAuth(s => s.credential);
  const [hub, setHub] = useState<SessionHub | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!credential) {
      setHub(null);
      setConnected(false);
      return;
    }

    const next = new SessionHub({
      baseUrl: credential.server,
      apiKey: credential.apiKey,
      onStateChange: connectedNow => {
        setConnected(connectedNow);
        useConnection.getState().setLive(connectedNow);
      },
    });

    void next.start().catch(() => setConnected(false));
    setHub(next);

    // iOS suspends sockets in the background; SignalR's own reconnect handles
    // the wake, but only once something pokes it. Coming back to the front is
    // that poke.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !next.connected) void next.start().catch(() => {});
    });

    return () => {
      subscription.remove();
      void next.stop();
    };
  }, [credential]);

  return { hub, connected };
}

/**
 * One hub connection for the whole app, tied to the current credential.
 *
 * Sessions come and go as screens push and pop; the socket does not. Screens
 * register a listener for the session they are showing and the hub multiplexes.
 *
 * The connection is module state rather than a hook's, because two screens are
 * mounted at once for as long as a session sits open over the list. A hub each
 * meant two sockets and two subscriptions per session — and, worse, that
 * leaving the session tore one of them down and announced the connection lost
 * while the list's was still live. Nothing ever said otherwise, so the app sat
 * behind "Reconnecting to live updates…" until it was killed.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SessionHub } from '../api/hub';
import { useAuth, type Credential } from './auth';
import { useConnection } from './connection';

/** Long enough to cover a navigation, short enough that a logout is not a leak. */
const IDLE_GRACE_MS = 5_000;

let shared: { key: string; hub: SessionHub; refs: number } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Two credentials are the same connection only if both halves match. */
function keyOf(credential: Credential): string {
  return `${credential.server} ${credential.apiKey}`;
}

function acquire(credential: Credential): SessionHub {
  if (shared && shared.key !== keyOf(credential)) teardown();

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!shared) {
    const hub = new SessionHub({
      baseUrl: credential.server,
      apiKey: credential.apiKey,
      onStateChange: live => useConnection.getState().setLive(live),
      onTrouble: reason => useConnection.getState().setReason(reason),
    });

    shared = { key: keyOf(credential), hub, refs: 0 };
    // The hub owns its own retry from here: a failed first handshake is not a
    // reason to stop trying, and nothing out here would notice if it were.
    void hub.start().catch(() => {});
  }

  shared.refs++;
  return shared.hub;
}

function release(hub: SessionHub): void {
  if (!shared || shared.hub !== hub) return;

  shared.refs--;
  if (shared.refs > 0) return;

  // Navigating from one screen that wants the hub to another releases before it
  // acquires, and dropping the socket in that gap would cost a reconnect — and
  // a banner — on every push and pop.
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (shared && shared.refs === 0) teardown();
  }, IDLE_GRACE_MS);
}

function teardown(): void {
  const current = shared;
  shared = null;

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!current) return;

  useConnection.getState().setLive(false);
  void current.hub.stop();
}

export function useSessionHub(): { hub: SessionHub | null; connected: boolean } {
  const credential = useAuth(s => s.credential);
  const [hub, setHub] = useState<SessionHub | null>(null);
  // Read from the store rather than kept per screen: there is one connection,
  // so there is one answer, and every screen showing it agrees.
  const connected = useConnection(s => s.live);

  useEffect(() => {
    if (!credential) {
      teardown();
      setHub(null);
      return;
    }

    const acquired = acquire(credential);
    setHub(acquired);
    useConnection.getState().setLive(acquired.connected);
    useConnection.getState().setReason(acquired.lastFailure);

    // iOS suspends sockets in the background; SignalR's own reconnect handles
    // the wake, but only once something pokes it. Coming back to the front is
    // that poke.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !acquired.connected) void acquired.start().catch(() => {});
    });

    return () => {
      subscription.remove();
      release(acquired);
    };
  }, [credential]);

  return { hub, connected };
}

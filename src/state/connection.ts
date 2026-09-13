/**
 * Whether the server is there, as one fact the whole app agrees on.
 *
 * Two signals feed it and they mean different things:
 *
 * - **reachable** — HTTP calls complete. False means the server cannot be
 *   contacted at all, so nothing works and saying so is the only useful thing
 *   the UI can do.
 * - **live** — the SignalR hub is connected. False on its own is milder: reads
 *   still work, the transcript is simply not updating itself, and the gap
 *   machinery will heal it on reconnect.
 *
 * Keeping them apart matters, because "you are offline" and "this page is a few
 * seconds stale" deserve different words and only one of them should stop you
 * typing.
 */
import { create } from 'zustand';

interface ConnectionState {
  reachable: boolean;
  live: boolean;
  /** Bumped on every recovery, so screens can re-fetch without polling. */
  recoveries: number;
  setReachable: (reachable: boolean) => void;
  setLive: (live: boolean) => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  reachable: true,
  live: false,
  recoveries: 0,

  setReachable: reachable => {
    if (get().reachable === reachable) return;
    set(state => ({
      reachable,
      recoveries: reachable ? state.recoveries + 1 : state.recoveries,
    }));
  },

  setLive: live => {
    if (get().live === live) return;
    set({ live });
  },
}));

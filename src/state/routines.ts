/**
 * Whether a routine's latest run failed — one fact, visible from every screen.
 *
 * The cockpit's rail carries a red pip on the Routines icon for exactly this
 * reason: "something broke overnight" should reach you on whatever page you
 * happen to be on, not only on the one page that lists routines. The menu
 * button is this app's rail, so it carries the same pip.
 *
 * Whoever already knows writes it — the sessions strip reads
 * `/automations/status` on every load, and the board knows from its failures —
 * so the pip costs no request of its own. A screen that only reads it may be
 * showing a fact from a minute ago, which is what a pip is for.
 */
import { create } from 'zustand';

interface RoutineAlert {
  anyFailed: boolean;
  setFailed: (failed: boolean) => void;
}

export const useRoutineAlert = create<RoutineAlert>((set, get) => ({
  anyFailed: false,
  setFailed: failed => {
    if (get().anyFailed === failed) return;
    set({ anyFailed: failed });
  },
}));
